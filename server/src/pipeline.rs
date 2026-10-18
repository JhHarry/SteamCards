//! 任务流水线：解析 SteamID → 抓库存 → 查价格 → 写 CSV，并持续广播进度事件。
use crate::cache::{self, CacheEntry, PriceCache};
use crate::demo;
use crate::model::{CardRow, PathsOut, Progress, StartRequest, Stats, Summary};
use crate::pricing::{PriceResult, Pricer};
use crate::state::{CancelToken, Shared};
use crate::steam::{self, sleep_cancel, Card, SteamError};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const INVENTORY_CACHE_MAX_AGE: i64 = 24 * 3600;

struct InventoryInput {
    cards: Vec<Card>,
    other: i64,
    total: i64,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn error_text(err: &SteamError) -> String {
    match err {
        SteamError::User(message) => {
            let first = message.lines().next().unwrap_or("");
            let mut text: String = first.chars().take(120).collect();
            if first.chars().count() > 120 {
                text.push('…');
            }
            text
        }
        SteamError::Cancelled => "已取消".to_string(),
    }
}

const CURRENCY_NAME: &[(i64, &str)] = &[
    (1, "USD"),
    (2, "GBP"),
    (3, "EUR"),
    (5, "RUB"),
    (23, "CNY"),
    (24, "JPY"),
    (29, "BRL"),
    (33, "TRY"),
    (34, "UAH"),
    (35, "PLN"),
];

const CURRENCY_NAME_CN: &[(i64, &str)] = &[
    (1, "美元"),
    (2, "英镑"),
    (3, "欧元"),
    (5, "卢布"),
    (23, "人民币"),
    (24, "日元"),
    (29, "雷亚尔"),
    (33, "里拉"),
    (34, "格里夫纳"),
    (35, "兹罗提"),
];

pub fn currency_label(currency: i64) -> String {
    for (code, name) in CURRENCY_NAME {
        if *code == currency {
            return (*name).to_string();
        }
    }
    currency.to_string()
}

pub fn currency_label_full(currency: i64) -> String {
    let code = currency_label(currency);
    for (value, name) in CURRENCY_NAME_CN {
        if *value == currency {
            return format!("{} {}", code, name);
        }
    }
    code
}

pub fn emit_stage(shared: &Shared, stage: &str, message: &str) {
    shared.emit(&json!({"type": "stage", "stage": stage, "message": message}));
}

pub fn emit_log(shared: &Shared, level: &str, message: &str) {
    shared.emit(&json!({"type": "log", "level": level, "message": message}));
}

fn progress_event(progress: &Progress) -> Value {
    let mut value = serde_json::to_value(progress).unwrap_or_else(|_| json!({}));
    if let Value::Object(ref mut map) = value {
        map.insert("type".to_string(), json!("progress"));
    }
    value
}

async fn push_progress(shared: &Shared, progress: &Progress) {
    shared.store_progress(progress).await;
    shared.emit(&progress_event(progress));
}

fn abs(path: &Path) -> String {
    std::path::absolute(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

fn now_timestamp() -> String {
    // 只依赖标准库：Unix 时间转 UTC 日期时间字符串
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Howard Hinnant civil_from_days
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02} UTC",
        year, m, d, hour, minute, second
    )
}

fn fmt_price(value: Option<f64>) -> String {
    match value {
        Some(v) => format!("{:.2}", v),
        None => String::new(),
    }
}

fn csv_escape(text: &str) -> String {
    if text.contains(',') || text.contains('"') || text.contains('\n') || text.contains('\r') {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.to_string()
    }
}

fn csv_line(fields: &[String]) -> String {
    let mut out = String::new();
    for (idx, field) in fields.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        out.push_str(&csv_escape(field));
    }
    out.push_str("\r\n");
    out
}

pub fn write_detail(path: &Path, rows: &[CardRow]) -> Result<(), SteamError> {
    let mut text = String::from("\u{feff}");
    text.push_str(&csv_line(&[
        "market_hash_name".into(),
        "name".into(),
        "game".into(),
        "appid".into(),
        "foil".into(),
        "count".into(),
        "marketable".into(),
        "tradable".into(),
        "unit_price".into(),
        "total_value".into(),
        "volume".into(),
        "status".into(),
    ]));
    for row in rows {
        text.push_str(&csv_line(&[
            row.hash.clone(),
            row.name.clone(),
            row.game.clone(),
            row.appid.clone(),
            if row.foil { "yes".into() } else { "no".into() },
            row.count.to_string(),
            if row.marketable { "1".into() } else { "0".into() },
            if row.tradable { "1".into() } else { "0".into() },
            fmt_price(row.lowest),
            format!("{:.2}", row.value),
            row.volume.map(|v| v.to_string()).unwrap_or_default(),
            row.status.clone(),
        ]));
    }
    fs::write(path, text).map_err(|e| SteamError::user(format!("写文件失败：{}", e)))
}

pub fn write_summary(path: &Path, summary: &Summary) -> Result<(), SteamError> {
    let mut text = String::from("\u{feff}");
    text.push_str(&csv_line(&[
        "steamid64".into(),
        "nickname".into(),
        "currency".into(),
        "card_types".into(),
        "card_copies".into(),
        "games".into(),
        "foil_types".into(),
        "priced_types".into(),
        "unpriced_types".into(),
        "sellable_copies".into(),
        "gross_value".into(),
        "fee_rate".into(),
        "net_value".into(),
        "generated_at".into(),
    ]));
    text.push_str(&csv_line(&[
        summary.steamid64.clone(),
        summary.nickname.clone(),
        summary.currency_label.clone(),
        summary.types.to_string(),
        summary.copies.to_string(),
        summary.games.to_string(),
        summary.foil_types.to_string(),
        summary.priced.to_string(),
        summary.unpriced.to_string(),
        summary.sellable.to_string(),
        format!("{:.2}", summary.gross),
        format!("{:.2}", summary.fee),
        format!("{:.2}", summary.net),
        summary.generated_at.clone(),
    ]));
    fs::write(path, text).map_err(|e| SteamError::user(format!("写文件失败：{}", e)))
}

struct Outcome {
    rows: Vec<CardRow>,
    summary: Summary,
    paths: PathsOut,
}

struct DemoMeta {
    kind: &'static str,
    price: f64,
    volume: i64,
    cached: bool,
}

fn card_to_row(card: &Card) -> CardRow {
    CardRow {
        hash: card.hash.clone(),
        name: card.name.clone(),
        game: card.game.clone(),
        appid: card.appid.clone(),
        foil: card.foil,
        count: card.count,
        marketable: card.marketable,
        tradable: card.tradable,
        lowest: None,
        value: 0.0,
        volume: None,
        status: String::new(),
    }
}

fn status_for(result: &PriceResult, marketable: bool) -> &'static str {
    if !marketable {
        "not_marketable"
    } else if result.ok == 1 {
        "ok"
    } else if result.ok == 0 {
        "no_listing"
    } else if result.ok == -2 {
        "blocked"
    } else if result.error.as_deref() == Some("not_cached") {
        "not_cached"
    } else {
        "error"
    }
}

fn demo_result(meta: &DemoMeta) -> PriceResult {
    match meta.kind {
        "no_listing" => PriceResult {
            ok: 0,
            lowest: None,
            median: None,
            volume: None,
            error: Some("no_listing".into()),
            cached: meta.cached,
        },
        _ => PriceResult {
            ok: 1,
            lowest: Some(meta.price),
            median: None,
            volume: Some(meta.volume),
            error: None,
            cached: meta.cached,
        },
    }
}

fn mark_cancelled(rows: &mut [CardRow], stats: &mut Stats) -> u64 {
    let mut count = 0;
    for row in rows {
        row.status = "cancelled".to_string();
        row.lowest = None;
        row.volume = None;
        row.value = 0.0;
        stats.cancelled += 1;
        count += 1;
    }
    count
}

fn aggregate(cards: &[Card]) -> Vec<Card> {
    let mut map: HashMap<(String, bool), Card> = HashMap::new();
    for card in cards {
        let key = (card.hash.clone(), card.foil);
        match map.get_mut(&key) {
            Some(existing) => {
                existing.count += card.count;
                existing.marketable = existing.marketable || card.marketable;
                existing.tradable = existing.tradable || card.tradable;
            }
            None => {
                map.insert(key, card.clone());
            }
        }
    }
    let mut rows: Vec<Card> = map.into_values().collect();
    rows.sort_by(|a, b| a.game.cmp(&b.game).then_with(|| a.hash.cmp(&b.hash)));
    rows
}

/// 价格接口被限流时，用 Steam 市场搜索接口按游戏批量补全缓存。
/// 相比逐张重试，请求数约为原来的 1/3，且搜索接口对限流更宽松；
/// 返回 USD 分并按 Steam 汇率换算成 CNY 写入缓存。
async fn batch_fill_from_search(
    rows: &[CardRow],
    from_idx: usize,
    pricer: &mut Pricer,
    shared: &Shared,
    cancel: &CancelToken,
) -> Result<usize, SteamError> {
    let mut appids: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for row in &rows[from_idx..] {
        if row.marketable && !pricer.has_fresh(&row.hash) && seen.insert(row.appid.clone()) {
            appids.push(row.appid.clone());
        }
    }
    if appids.is_empty() {
        return Ok(0);
    }
    let total_games = appids.len();
    emit_log(
        shared,
        "info",
        &format!(
            "价格接口被限流，切换到 Steam 市场搜索接口批量取价（{} 个游戏，预计约 {} 分钟）…",
            total_games,
            ((total_games as f64 * 1.1) / 60.0).ceil() as u64
        ),
    );
    let mut inserted = 0usize;
    for (i, appid) in appids.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(SteamError::Cancelled);
        }
        match steam::fetch_search_prices_for_game(appid, cancel).await {
            Ok(prices) if !prices.is_empty() => {
                let map: HashMap<&str, &steam::SearchPrice> =
                    prices.iter().map(|p| (p.hash.as_str(), p)).collect();
                for row in rows.iter().skip(from_idx) {
                    if !row.marketable || pricer.has_fresh(&row.hash) {
                        continue;
                    }
                    if let Some(price) = map.get(row.hash.as_str()) {
                        let cny = steam::usd_cents_to_cny(price.usd_cents);
                        if cny > 0.0 {
                            pricer.put_entry(
                                &row.hash,
                                CacheEntry {
                                    ok: 1,
                                    lowest: Some(cny),
                                    median: None,
                                    volume: price.volume,
                                    ts: now_secs(),
                                },
                            );
                            inserted += 1;
                        }
                    }
                }
            }
            Ok(_) => {}
            Err(SteamError::Cancelled) => return Err(SteamError::Cancelled),
            Err(SteamError::User(message)) => {
                emit_log(shared, "warn", &format!("批量取价失败（游戏 {}）：{}", appid, message))
            }
        }
        if i == 0 || (i + 1) % 10 == 0 || i + 1 == total_games {
            emit_log(
                shared,
                "info",
                &format!(
                    "批量取价进度 {}/{} 游戏，已补全 {} 种卡牌价格",
                    i + 1,
                    total_games,
                    inserted
                ),
            );
        }
        if !steam::sleep_cancel(steam::jitter_ms(900), cancel).await {
            return Err(SteamError::Cancelled);
        }
    }
    pricer.save();
    emit_log(
        shared,
        "info",
        &format!(
            "批量取价完成：补全 {} 种卡牌（按 Steam 汇率换算为 CNY），继续完成剩余卡牌…",
            inserted
        ),
    );
    Ok(inserted)
}

async fn run_inner(
    shared: Arc<Shared>,
    req: &StartRequest,
    cancel: &Arc<CancelToken>,
) -> Result<Outcome, SteamError> {
    let t0 = Instant::now();
    let sink = shared.sink();
    let demo = req.demo;

    let mut initial = Progress::default();
    initial.total = 0;
    shared.store_progress(&initial).await;
    shared.emit(&progress_event(&initial));

    let cache_path = shared.cache_path.clone();
    let jar = steam::cookie_jar_path(&cache_path);
    if let Some(dir) = jar.parent() {
        let _ = fs::create_dir_all(dir);
    }

    let (sid, nick, mut rows, demo_meta, other_cnt, total_inv, inventory_cache_age): (
        String,
        String,
        Vec<CardRow>,
        Vec<DemoMeta>,
        i64,
        i64,
        u64,
    ) = if demo {
        emit_stage(&shared, "inventory", "正在生成演示库存 ...");
        let cards = demo::generate(req.limit);
        let mut demo_rows = Vec::with_capacity(cards.len());
        let mut meta = Vec::with_capacity(cards.len());
        let mut total = 4i64;
        for item in &cards {
            demo_rows.push(card_to_row(&item.card));
            total += item.card.count;
            meta.push(DemoMeta {
                kind: item.kind,
                price: item.price,
                volume: item.volume,
                cached: item.cached,
            });
        }
        for page in 1..=3u32 {
            if !sleep_cancel(120, cancel).await {
                return Err(SteamError::Cancelled);
            }
            shared.emit(&json!({"type": "inventory", "page": page, "items": total, "total": total,
                "message": format!("演示库存第 {} 页，累计 {} 件", page, total)}));
        }
        (
            "76561199000000000".to_string(),
            "演示账号".to_string(),
            demo_rows,
            meta,
            4,
            total,
            0,
        )
    } else {
        emit_stage(&shared, "resolve", "正在解析 SteamID ...");
        let sid = steam::normalize_steam_id(&req.steamid, cancel, &sink).await?;
        emit_log(&shared, "info", &format!("SteamID64: {}", sid));
        emit_stage(&shared, "profile", "正在读取账号信息 ...");
        let nick = steam::fetch_profile_name(&sid, &jar, cancel)
            .await
            .unwrap_or_default();
        emit_stage(&shared, "inventory", "正在抓取卡牌库存 ...");

        let inv_cache_path = cache::inventory_cache_path(&cache_path);
        let mut inv_cache = cache::InventoryCache::load(inv_cache_path);
        // 第一次只请求一次：若恰好被限流/瞬时失败且本地有新鲜库存缓存，
        // 就直接复用缓存继续查询价格，不把时间浪费在 30s 级的盲等上。
        let first_try = steam::fetch_inventory(&sid, &jar, cancel, &sink, req.debug, 1).await;
        let (inventory_input, from_cache, cache_age_secs) = match first_try {
            Ok(inventory) => {
                let (cards, other) = steam::split_cards(&inventory);
                (
                    InventoryInput {
                        cards,
                        other,
                        total: inventory.total,
                    },
                    false,
                    0u64,
                )
            }
            Err(SteamError::Cancelled) => return Err(SteamError::Cancelled),
            Err(err) => {
                emit_stage(&shared, "inventory", "库存接口受限，正在尝试本地缓存 ...");
                match inv_cache.get_fresh(&sid, INVENTORY_CACHE_MAX_AGE) {
                    Some(entry) => {
                        emit_log(
                            &shared,
                            "warn",
                            &format!(
                                "库存接口暂时不可用（{}）。已复用 {} 前的库存缓存（{} 种卡牌），直接继续查询价格。",
                                error_text(&err),
                                cache::human_age(now_secs() - entry.ts),
                                entry.cards.len()
                            ),
                        );
                        (
                            InventoryInput {
                                cards: entry.cards,
                                other: entry.other,
                                total: entry.total,
                            },
                            true,
                            (now_secs() - entry.ts).max(0) as u64,
                        )
                    }
                    None => {
                        emit_log(
                            &shared,
                            "warn",
                            "库存接口被限流/失败，正在做更长时间的重试（本地没有可用的库存缓存）...",
                        );
                        let inventory =
                            steam::fetch_inventory(&sid, &jar, cancel, &sink, req.debug, 5).await?;
                        let (cards, other) = steam::split_cards(&inventory);
                        (
                            InventoryInput {
                                cards,
                                other,
                                total: inventory.total,
                            },
                            false,
                            0u64,
                        )
                    }
                }
            }
        };
        let InventoryInput { cards, other, total } = inventory_input;
        if cards.is_empty() {
            return Err(SteamError::user("该账号库存里没有集换式卡牌（或卡牌被隐藏）。"));
        }
        let total_cards: i64 = cards.iter().map(|c| c.count).sum();
        let mut unique: HashSet<(String, bool)> = HashSet::new();
        for card in &cards {
            unique.insert((card.hash.clone(), card.foil));
        }
        emit_log(
            &shared,
            "info",
            &format!(
                "库存 {} 件：卡牌 {} 张 / {} 种，其它物品 {} 件{}",
                total,
                total_cards,
                unique.len(),
                other,
                if from_cache { "（来源：本地库存缓存）" } else { "" }
            ),
        );
        let aggregated = aggregate(&cards);
        if !from_cache {
            inv_cache.put(&sid, total, other, &aggregated);
            inv_cache.save();
        }
        let rows: Vec<CardRow> = aggregated.iter().map(card_to_row).collect();
        (sid, nick, rows, Vec::new(), other, total, cache_age_secs)
    };

    let all_types = rows.len();
    if req.limit > 0 && req.limit as usize <= rows.len() {
        rows.truncate(req.limit as usize);
        emit_log(
            &shared,
            "info",
            &format!("按 --limit 只查前 {} 种（库存共 {} 种）", rows.len(), all_types),
        );
    }
    if rows.is_empty() {
        return Err(SteamError::user("没有需要查询价格的卡牌。"));
    }

    // ---- 价格 ----
    let mut pricer: Option<Pricer> = if demo {
        None
    } else {
        let cache = PriceCache::load(cache_path.clone());
        let mut pricer = Pricer::new(cache, req.currency, 3.5, 86_400);
        if req.no_cache {
            pricer.cache.clear_currency(req.currency);
            emit_log(
                &shared,
                "info",
                &format!("已清空货币 {} 的旧缓存", currency_label(req.currency)),
            );
        }
        Some(pricer)
    };

    let total = rows.len() as u64;
    let mut stats = Stats::default();
    let mut progress = Progress {
        total,
        ..Default::default()
    };
    let mut gross = 0.0f64;
    let mut blocked_streak = 0u32;
    let mut batch_attempted = false;
    let mut recovery_pauses = 0u32;
    let mut aborted_at = 0u64;
    let mut cancelled = false;
    let mut demo_cached_count = 0u64;

    emit_stage(&shared, "pricing", "开始查询市场价格 ...");
    push_progress(&shared, &progress).await;

    let mut idx = 0usize;
    while idx < rows.len() {
        if cancel.is_cancelled() {
            let remaining = mark_cancelled(&mut rows[idx..], &mut stats);
            cancelled = true;
            emit_log(
                &shared,
                "warn",
                &format!(
                    "已取消：已查询 {} 种结果会写入 CSV，剩余 {} 种标记 cancelled",
                    idx, remaining
                ),
            );
            break;
        }
        let marketable = rows[idx].marketable;
        let mut result: PriceResult = if !marketable {
            PriceResult {
                ok: 0,
                lowest: None,
                median: None,
                volume: None,
                error: Some("not_marketable".into()),
                cached: false,
            }
        } else if demo {
            let meta = &demo_meta[idx];
            if meta.cached {
                demo_cached_count += 1;
            } else if !sleep_cancel(60, cancel).await {
                let remaining = mark_cancelled(&mut rows[idx..], &mut stats);
                cancelled = true;
                emit_log(
                    &shared,
                    "warn",
                    &format!(
                        "已取消：已查询 {} 种结果会写入 CSV，剩余 {} 种标记 cancelled",
                        idx, remaining
                    ),
                );
                break;
            }
            demo_result(meta)
        } else {
            let pricer_ref = pricer.as_mut().expect("pricer");
            match pricer_ref
                .one(&rows[idx].hash, req.offline, cancel, &sink, req.debug)
                .await
            {
                Ok(result) => result,
                Err(SteamError::Cancelled) => {
                    let remaining = mark_cancelled(&mut rows[idx..], &mut stats);
                    cancelled = true;
                    emit_log(
                        &shared,
                        "warn",
                        &format!(
                            "已取消：已查询 {} 种结果会写入 CSV，剩余 {} 种标记 cancelled",
                            idx, remaining
                        ),
                    );
                    break;
                }
                Err(other) => return Err(other),
            }
        };

        // priceoverview 被限流时，自动切换到市场搜索接口批量补价，避免整轮卡在 429 重试上。
        if !batch_attempted && result.ok == -2 && req.currency == 23 && !demo && !req.offline {
            batch_attempted = true;
            match batch_fill_from_search(
                &rows,
                idx,
                pricer.as_mut().expect("pricer"),
                &shared,
                cancel,
            )
            .await
            {
                Ok(inserted) => {
                    if inserted > 0
                        && pricer
                            .as_ref()
                            .map(|p| p.has_fresh(&rows[idx].hash))
                            .unwrap_or(false)
                    {
                        if let Some(p) = pricer.as_mut() {
                            result = p
                                .one(&rows[idx].hash, req.offline, cancel, &sink, req.debug)
                                .await?;
                        }
                    }
                }
                Err(SteamError::Cancelled) => {
                    let remaining = mark_cancelled(&mut rows[idx..], &mut stats);
                    cancelled = true;
                    emit_log(
                        &shared,
                        "warn",
                        &format!(
                            "已取消：已查询 {} 种结果会写入 CSV，剩余 {} 种标记 cancelled",
                            idx, remaining
                        ),
                    );
                    break;
                }
                Err(other) => {
                    emit_log(&shared, "warn", &format!("批量取价失败：{:?}", other));
                }
            }
        }

        let status = status_for(&result, marketable);
        rows[idx].status = status.to_string();
        rows[idx].lowest = result.lowest;
        rows[idx].volume = result.volume;
        rows[idx].value = if status == "ok" {
            result.lowest.unwrap_or(0.0) * rows[idx].count as f64
        } else {
            0.0
        };
        stats.bump(status);
        if result.cached {
            stats.cached += 1;
        }
        if status == "ok" {
            gross += rows[idx].value;
        }
        blocked_streak = if result.ok == -2 {
            blocked_streak + 1
        } else {
            0
        };

        let elapsed = t0.elapsed().as_secs_f64();
        let done = (idx + 1) as u64;
        let rate = if elapsed > 0.0 {
            done as f64 / elapsed
        } else {
            0.0
        };
        let eta = if done > 0 {
            elapsed / done as f64 * (total - done) as f64
        } else {
            0.0
        };
        progress = Progress {
            done,
            total,
            elapsed,
            eta,
            rate,
            gross,
            hash: rows[idx].hash.clone(),
            name: rows[idx].name.clone(),
            game: rows[idx].game.clone(),
            status: rows[idx].status.clone(),
            stats: stats.clone(),
            requests: pricer.as_ref().map(|p| p.requested).unwrap_or(0),
            cached: pricer
                .as_ref()
                .map(|p| p.cached)
                .unwrap_or(demo_cached_count),
        };
        push_progress(&shared, &progress).await;

        if blocked_streak >= 2 {
            const MAX_RECOVERY_PAUSES: u32 = 6;
            if recovery_pauses < MAX_RECOVERY_PAUSES {
                recovery_pauses += 1;
                let pause_ms = steam::jitter_ms(35_000);
                let pause_secs = (pause_ms as f64 / 1000.0).round() as u64;
                emit_log(
                    &shared,
                    "warn",
                    &format!(
                        "市场接口连续限流，暂停约 {}s 后继续（恢复 {}/{}），不会放弃剩余卡牌",
                        pause_secs, recovery_pauses, MAX_RECOVERY_PAUSES
                    ),
                );
                shared.emit(&json!({
                    "type": "retry",
                    "message": format!("市场接口连续限流，暂停约 {}s 后继续（{}/{}）", pause_secs, recovery_pauses, MAX_RECOVERY_PAUSES),
                    "seconds": pause_secs
                }));
                if !sleep_cancel(pause_ms, cancel).await {
                    let remaining = mark_cancelled(&mut rows[idx..], &mut stats);
                    cancelled = true;
                    emit_log(
                        &shared,
                        "warn",
                        &format!(
                            "已取消：已查询 {} 种结果会写入 CSV，剩余 {} 种标记 cancelled",
                            idx, remaining
                        ),
                    );
                    break;
                }
                blocked_streak = 0;
                idx += 1;
                continue;
            }
            aborted_at = done;
            let remaining = rows.len() - idx - 1;
            for rest in &mut rows[idx + 1..] {
                rest.status = "blocked".to_string();
                rest.lowest = None;
                rest.volume = None;
                rest.value = 0.0;
            }
            stats.blocked += remaining as u64;
            emit_log(
                &shared,
                "warn",
                &format!(
                    "连续限流且恢复暂停已用完，熔断：剩余 {} 种标记为 blocked（已查到的价格已缓存）",
                    remaining
                ),
            );
            break;
        }
        idx += 1;
    }

    if let Some(pricer) = pricer.as_mut() {
        pricer.save();
    }

    // ---- 汇总 ----
    let mut games: HashSet<&str> = HashSet::new();
    let mut copies = 0i64;
    let mut foil_types = 0u64;
    let mut priced = 0u64;
    let mut sellable = 0i64;
    let mut gross_total = 0.0f64;
    for row in &rows {
        copies += row.count;
        if !row.game.is_empty() {
            games.insert(row.game.as_str());
        }
        if row.foil {
            foil_types += 1;
        }
        if row.status == "ok" && row.marketable {
            priced += 1;
            sellable += row.count;
            gross_total += row.value;
        }
    }
    let types = rows.len() as u64;
    let summary = Summary {
        steamid64: sid.clone(),
        nickname: nick.clone(),
        currency: currency_label(req.currency),
        currency_label: currency_label_full(req.currency),
        types,
        copies: copies as u64,
        games: games.len() as u64,
        foil_types,
        priced,
        unpriced: types - priced,
        sellable: sellable as u64,
        gross: gross_total,
        fee: req.fee,
        net: gross_total * (1.0 - req.fee),
        generated_at: now_timestamp(),
        elapsed: t0.elapsed().as_secs_f64(),
        requests: pricer.as_ref().map(|p| p.requested).unwrap_or(0),
        cached: pricer
            .as_ref()
            .map(|p| p.cached)
            .unwrap_or(demo_cached_count),
        aborted_at: if aborted_at > 0 { Some(aborted_at) } else { None },
        cancelled,
        cancelled_types: stats.cancelled,
        demo,
        offline: req.offline,
        inventory_cached: inventory_cache_age > 0,
        inventory_cache_age_secs: inventory_cache_age,
    };

    let _ = (total_inv, other_cnt); // 仅日志用途

    // ---- 写文件 ----
    emit_stage(&shared, "write", "正在写出 CSV ...");
    let _ = fs::create_dir_all(&shared.out_dir);
    let detail_path = shared.out_dir.join(format!("steam_cards_{}.csv", sid));
    let summary_path = shared
        .out_dir
        .join(format!("steam_cards_{}_summary.csv", sid));
    write_detail(&detail_path, &rows)?;
    write_summary(&summary_path, &summary)?;
    let paths = PathsOut {
        detail: abs(&detail_path),
        summary: abs(&summary_path),
    };

    // 按账号把完整结果保存到用户目录，供界面「历史结果」回看。
    if !demo {
        match crate::history::save_result(&summary, &rows, &paths) {
            Ok(entry) => emit_log(
                &shared,
                "info",
                &format!(
                    "结果已保存到历史记录：{} · {} 种 / 毛额 {:.2} {}",
                    if entry.nickname.is_empty() { "未知账号" } else { &entry.nickname },
                    entry.types,
                    entry.gross,
                    entry.currency
                ),
            ),
            Err(message) => emit_log(&shared, "warn", &format!("保存历史结果失败：{}", message)),
        }
    }

    Ok(Outcome {
        rows,
        summary,
        paths,
    })
}

pub async fn run_job(shared: Arc<Shared>, req: StartRequest, cancel: Arc<CancelToken>) {
    let result = run_inner(shared.clone(), &req, &cancel).await;
    shared.running.store(false, Ordering::SeqCst);
    *shared.cancel.lock().await = None;

    match result {
        Ok(outcome) => {
            shared.emit(&json!({
                "type": "done",
                "summary": outcome.summary,
                "paths": outcome.paths,
                "rows": outcome.rows,
            }));
            let mut snapshot = shared.current_snapshot().await;
            snapshot.state = if outcome.summary.cancelled {
                "cancelled".to_string()
            } else {
                "done".to_string()
            };
            snapshot.demo = req.demo;
            snapshot.summary = Some(outcome.summary);
            snapshot.paths = Some(outcome.paths);
            snapshot.error = None;
            shared.set_snapshot(snapshot).await;
        }
        Err(SteamError::Cancelled) => {
            emit_log(&shared, "warn", "已取消。");
            let mut snapshot = shared.current_snapshot().await;
            snapshot.state = "cancelled".to_string();
            snapshot.demo = req.demo;
            snapshot.error = None;
            shared.set_snapshot(snapshot).await;
        }
        Err(SteamError::User(message)) => {
            shared.emit(&json!({"type": "error", "message": message}));
            let mut snapshot = shared.current_snapshot().await;
            snapshot.state = "error".to_string();
            snapshot.demo = req.demo;
            snapshot.error = Some(message);
            shared.set_snapshot(snapshot).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Stats;

    #[test]
    fn currency_labels() {
        assert_eq!(currency_label(23), "CNY");
        assert_eq!(currency_label(999), "999");
    }

    #[test]
    fn csv_escaping() {
        assert_eq!(csv_escape("730-Frost"), "730-Frost");
        assert_eq!(csv_escape("a,b"), "\"a,b\"");
        assert_eq!(csv_escape("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn cancel_marking() {
        let mut rows = vec![CardRow {
            hash: "a".into(),
            ..Default::default()
        }];
        let mut stats = Stats::default();
        let count = mark_cancelled(&mut rows, &mut stats);
        assert_eq!(count, 1);
        assert_eq!(rows[0].status, "cancelled");
        assert_eq!(stats.cancelled, 1);
    }

    #[test]
    fn aggregate_merges_duplicates() {
        let cards = vec![
            Card {
                hash: "730-Frost".into(),
                name: "Frost".into(),
                game: "CS2".into(),
                appid: "730".into(),
                foil: false,
                count: 1,
                marketable: true,
                tradable: false,
            },
            Card {
                hash: "730-Frost".into(),
                name: "Frost".into(),
                game: "CS2".into(),
                appid: "730".into(),
                foil: false,
                count: 2,
                marketable: false,
                tradable: true,
            },
        ];
        let rows = aggregate(&cards);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].count, 3);
        assert!(rows[0].marketable);
        assert!(rows[0].tradable);
    }
}