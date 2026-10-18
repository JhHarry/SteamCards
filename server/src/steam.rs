//! Steam 接口：curl 子进程、SteamID 解析、库存分页、卡牌解析、价格/URL 工具。
use crate::state::{EventSink, CancelToken};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

pub const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

pub const APPID: u32 = 753;
pub const CONTEXT: u32 = 6;
pub const INV_PAGE: u32 = 2000;

pub const INVENTORY_HINT: &str = "请依次检查：\n  ① 账号是否存在、个人资料是否可访问；\n  ② Steam 隐私设置 →「个人资料」→「游戏详情」设为「公开」（不只是把个人资料设为公开）；\n  ③ 库存没有被设为私密。\n如果确认都已公开仍失败：SteamCommunity 302 / Steam++ / Watt Toolkit 等本地加速工具\n对 inventory 接口支持不稳定，可尝试重启或关闭加速工具，或换一个能直连\nsteamcommunity.com 的网络。";

#[derive(Debug, Clone)]
pub enum SteamError {
    /// 可以直接展示给用户的中文错误
    User(String),
    /// 用户取消
    Cancelled,
}

impl SteamError {
    pub fn user(msg: impl Into<String>) -> Self {
        SteamError::User(msg.into())
    }
}

pub fn snippet(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        if out.chars().count() >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out.replace('\n', " ")
}

/// 在 [base - base/4, base + base/4] 范围内加随机抖动，避免固定节奏触发风控。
pub fn jitter_ms(base_ms: u64) -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64 ^ (d.as_secs() << 13))
        .unwrap_or(1);
    let spread = (base_ms / 4).max(1);
    base_ms.saturating_sub(spread) + seed % (spread * 2 + 1)
}

/// 库存接口的退避节奏（毫秒）：首轮很短，之后逐步拉长；单轮最长 25s 左右。
pub fn inventory_retry_delay(attempt: u32) -> u64 {
    let base = match attempt {
        1 => 3_000,
        2 => 7_000,
        3 => 15_000,
        _ => 25_000,
    };
    jitter_ms(base)
}

pub fn sleep_cancel(ms: u64, cancel: &CancelToken) -> impl std::future::Future<Output = bool> + '_ {
    async move {
        if cancel.is_cancelled() {
            return false;
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(ms)) => !cancel.is_cancelled(),
            _ = cancel.cancelled() => false,
        }
    }
}

/// 调用本机 curl，返回 (HTTP 状态码, 响应体文本)。网络失败返回 (0, "")。
pub async fn curl_get(
    url: &str,
    cookie_jar: Option<&Path>,
    headers: &[String],
    cancel: &CancelToken,
) -> Result<(u16, String), SteamError> {
    let mut cmd = Command::new("curl");
    cmd.arg("-s")
        .arg("--compressed")
        .arg("--max-time")
        .arg("40")
        .arg("-w")
        .arg("\n__STATUS__%{http_code}");
    if let Some(jar) = cookie_jar {
        cmd.arg("-c").arg(jar).arg("-b").arg(jar);
    }
    for header in headers {
        cmd.arg("-H").arg(header);
    }
    // 浏览器同款 UA：Steam/S302 对 curl 默认 UA 的限流明显更严格
    cmd.arg("-A").arg(DEFAULT_USER_AGENT).arg("-H").arg("Accept-Language: en-US,en;q=0.9");
    cmd.arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // GUI 桌面应用里每次 spawn curl 都会弹出一个控制台窗口；用 CREATE_NO_WINDOW 静默运行。
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            SteamError::user("找不到 curl，请先安装 curl 并加入 PATH（Windows 10+ 自带）")
        } else {
            SteamError::user(format!("无法启动 curl：{e}"))
        }
    })?;
    let stdout = child.stdout.take();
    let reader = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(mut out) = stdout {
            let _ = out.read_to_end(&mut buf).await;
        }
        buf
    });
    let started = Instant::now();
    loop {
        if cancel.is_cancelled() {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(SteamError::Cancelled);
        }
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {}
            Err(e) => {
                let _ = child.kill().await;
                return Err(SteamError::user(format!("curl 执行失败：{e}")));
            }
        }
        if started.elapsed() > Duration::from_secs(55) {
            let _ = child.kill().await;
            let _ = child.wait().await;
            break;
        }
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
    let buf = reader.await.unwrap_or_default();
    let text = String::from_utf8_lossy(&buf).into_owned();
    let marker = "\n__STATUS__";
    if let Some(idx) = text.rfind(marker) {
        let status = text[idx + marker.len()..].trim().parse::<u16>().unwrap_or(0);
        let body = text[..idx].to_string();
        Ok((status, body))
    } else {
        Ok((0, text))
    }
}


// ---------------------------------------------------------------------------
// 价格兜底：market/search/render 接口
// priceoverview 被限流时，改用 Steam 市场搜索接口按游戏批量拿最低售价（USD 分），
// 再按 Steam 的 CNY 汇率换算。正常路径仍优先使用 priceoverview 的精确 CNY 价格。
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct SearchPrice {
    pub hash: String,
    pub usd_cents: i64,
    pub volume: Option<i64>,
}

/// 实测的 Steam 市场 USD→CNY 换算率（样本中位数）。
pub const USD_CNY_RATE: f64 = 6.74;

pub fn usd_cents_to_cny(cents: i64) -> f64 {
    if cents <= 0 {
        return 0.0;
    }
    ((cents as f64 / 100.0) * USD_CNY_RATE * 100.0).round() / 100.0
}

/// 解析 market/search/render 的 JSON 响应；解析失败返回空列表。
pub fn parse_search_results(body: &str) -> Vec<SearchPrice> {
    let value: Value = match serde_json::from_str(body.trim()) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    if let Some(results) = value.get("results").and_then(|v| v.as_array()) {
        for item in results {
            let hash = match item.get("hash_name").and_then(|v| v.as_str()) {
                Some(hash) => hash.to_string(),
                None => continue,
            };
            let usd_cents = item
                .get("sell_price")
                .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                .unwrap_or(0);
            if usd_cents <= 0 {
                continue;
            }
            let volume = item
                .get("sell_listings")
                .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())));
            out.push(SearchPrice {
                hash,
                usd_cents,
                volume,
            });
        }
    }
    out
}

/// 按游戏 (appid) 分页抓取该游戏所有集换式卡牌的市场搜索价。
/// 返回的是 USD 分；调用方负责换算成 CNY。
pub async fn fetch_search_prices_for_game(
    appid: &str,
    cancel: &CancelToken,
) -> Result<Vec<SearchPrice>, SteamError> {
    let mut prices = Vec::new();
    let mut start = 0i64;
    let page = 10i64;
    let mut total = i64::MAX;
    let headers = vec![
        "Accept: application/json, text/javascript, */*; q=0.01".to_string(),
        "X-Requested-With: XMLHttpRequest".to_string(),
        "Referer: https://steamcommunity.com/market/".to_string(),
    ];
    while start < total {
        if cancel.is_cancelled() {
            return Err(SteamError::Cancelled);
        }
        let url = format!(
            "https://steamcommunity.com/market/search/render/?query=&start={}&count={}&search_descriptions=0&sort_column=popular&sort_dir=desc&appid={}&norender=1&category_753_Game%5B%5D=tag_app_{}&category_753_item_class%5B%5D=tag_item_class_2",
            start, page, APPID, appid
        );
        let (status, body) = curl_get(&url, None, &headers, cancel).await?;
        if status != 200 {
            return Err(SteamError::user(format!(
                "市场搜索接口 HTTP {}（备用取价也被限流）",
                status
            )));
        }
        let value: Value = match serde_json::from_str(body.trim()) {
            Ok(value) => value,
            Err(_) => break,
        };
        if value.get("success").and_then(|v| v.as_bool()) != Some(true) {
            break;
        }
        total = value.get("total_count").and_then(|v| v.as_i64()).unwrap_or(0);
        let page_items = parse_search_results(&body);
        if page_items.is_empty() {
            break;
        }
        prices.extend(page_items);
        start += page;
        if !sleep_cancel(jitter_ms(850), cancel).await {
            return Err(SteamError::Cancelled);
        }
    }
    Ok(prices)
}

pub fn is_steam_id(s: &str) -> bool {
    s.len() == 17 && s.chars().all(|c| c.is_ascii_digit())
}

fn find_id_after(text: &str, needle: &str) -> Option<String> {
    let idx = text.find(needle)?;
    let rest = &text[idx + needle.len()..];
    let candidate: String = rest.chars().take(17).collect();
    if is_steam_id(&candidate) {
        Some(candidate)
    } else {
        None
    }
}

/// 接受 17 位 ID / profiles 链接 / id 自定义链接 / 纯自定义名。
pub async fn normalize_steam_id(arg: &str, cancel: &CancelToken, sink: &EventSink) -> Result<String, SteamError> {
    let s = arg.trim();
    if is_steam_id(s) {
        return Ok(s.to_string());
    }
    if let Some(id) = find_id_after(s, "/profiles/") {
        return Ok(id);
    }
    let mut name = s;
    if let Some(pos) = s.find("steamcommunity.com/id/") {
        let rest = &s[pos + "steamcommunity.com/id/".len()..];
        name = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    }
    if is_steam_id(name) {
        return Ok(name.to_string());
    }
    let url = format!(
        "https://steamcommunity.com/id/{}/?xml=1",
        url_encode(name)
    );
    sink(json!({"type": "log", "level": "info", "message": format!("解析自定义 ID {:?} ...", name)}));
    let (status, body) = curl_get(&url, None, &[], cancel).await?;
    if let Some(start) = body.find("<steamID64>") {
        let rest = &body[start + "<steamID64>".len()..];
        let candidate: String = rest.chars().take(17).collect();
        if is_steam_id(&candidate) {
            return Ok(candidate);
        }
    }
    Err(SteamError::user(format!(
        "无法解析 SteamID64（HTTP {}）。请检查自定义主页链接是否存在，或直接使用 17 位数字 ID。",
        status
    )))
}

pub async fn fetch_profile_name(
    sid: &str,
    jar: &Path,
    cancel: &CancelToken,
) -> Result<String, SteamError> {
    let url = format!("https://steamcommunity.com/profiles/{}/?xml=1", sid);
    let (_status, body) = curl_get(&url, Some(jar), &[], cancel).await?;
    if let Some(start) = body.find("<steamID><![CDATA[") {
        let rest = &body[start + "<steamID><![CDATA[".len()..];
        if let Some(end) = rest.find("]]>") {
            return Ok(rest[..end].trim().to_string());
        }
    }
    Ok(String::new())
}

#[derive(Debug, Default, Clone)]
pub struct RawInventory {
    pub assets: HashMap<(String, String), i64>,
    pub descriptions: HashMap<(String, String), Value>,
    pub total: i64,
}

fn parse_amount(value: &Value) -> i64 {
    if let Some(v) = value.as_i64() {
        return v;
    }
    if let Some(s) = value.as_str() {
        return s.parse::<i64>().unwrap_or(1);
    }
    1
}

pub async fn fetch_inventory(
    sid: &str,
    jar: &Path,
    cancel: &CancelToken,
    sink: &EventSink,
    debug: bool,
    max_attempts: u32,
) -> Result<RawInventory, SteamError> {
    let mut inv = RawInventory::default();
    let mut start: Option<String> = None;
    let mut page = 0u32;
    let headers = vec![
        format!(
            "Referer: https://steamcommunity.com/profiles/{}/inventory/",
            sid
        ),
        "X-Requested-With: XMLHttpRequest".to_string(),
        "Accept: application/json, text/javascript, */*; q=0.01".to_string(),
    ];
    while page < 200 {
        if cancel.is_cancelled() {
            return Err(SteamError::Cancelled);
        }
        let mut url = format!(
            "https://steamcommunity.com/inventory/{}/{}/{}?l=english&count={}",
            sid, APPID, CONTEXT, INV_PAGE
        );
        if let Some(asset_id) = &start {
            url.push_str("&start_assetid=");
            url.push_str(asset_id);
        }
        let mut attempt = 0u32;
        let data: Value = loop {
            if cancel.is_cancelled() {
                return Err(SteamError::Cancelled);
            }
            let (status, body) = curl_get(&url, Some(jar), &headers, cancel).await?;
            if debug {
                sink(json!({"type": "log", "level": "debug",
                    "message": format!("库存第 {} 页：HTTP {}，{} 字节 {}", page + 1, status, body.len(), snippet(&body, 120))}));
            }
            if status == 200 {
                let text = body.trim();
                if !text.is_empty() && text != "null" {
                    match serde_json::from_str::<Value>(text) {
                        Ok(Value::Object(map)) => break Value::Object(map),
                        Ok(_) => { /* null 等 -> 走重试 */ }
                        Err(_) => {
                            return Err(SteamError::user(format!(
                                "库存接口返回非 JSON（HTTP {}）：{}",
                                status,
                                snippet(text, 160)
                            )));
                        }
                    }
                }
            } else if status == 403 {
                return Err(SteamError::user(
                    "库存不可访问（HTTP 403）。这通常表示库存或「游戏详情」被设为私密：\n请在 Steam 隐私设置 →「个人资料」→「游戏详情」设为「公开」。",
                ));
            }
            attempt += 1;
            if attempt >= max_attempts.max(1) {
                let msg = match status {
                    0 => "库存请求超时（curl 无响应）。请检查网络 / 代理后重试。".to_string(),
                    429 => "库存接口被 Steam 限流（HTTP 429），已自动退避约 3 分钟仍失败。\nSteam 对同一出口 IP 有频率限制，通常等 1~2 分钟即可恢复；如果一直 429，\n多半是代理/加速工具（SteamCommunity 302、Steam++ 等）的出口 IP 被限流，\n可尝试重启或关闭代理，或换一个能直连 steamcommunity.com 的网络。".to_string(),
                    200 => "Steam 库存接口暂时返回空数据（HTTP 200 / null），已重试约 100 秒。\n这通常是 Steam 对该 IP 的限流或瞬时故障，不是库存私密：请等 1~2 分钟后重试。\n若反复出现，再检查 ① 游戏详情是否公开 ② 是否使用了加速工具。".to_string(),
                    other => format!("库存不可访问（HTTP {}）。\n{}", other, INVENTORY_HINT),
                };
                return Err(SteamError::user(msg));
            }
            let delay = match status {
                429 => inventory_retry_delay(attempt),
                200 => jitter_ms(match attempt { 1 => 2_500, 2 => 5_000, 3 => 10_000, _ => 20_000 }),
                0 => jitter_ms(match attempt { 1 => 2_500, 2 => 5_000, 3 => 10_000, _ => 20_000 }),
                _ => jitter_ms(match attempt { 1 => 2_000, 2 => 4_000, 3 => 8_000, _ => 15_000 }),
            };
            let total_attempts = max_attempts.max(1);
            sink(json!({"type": "retry", "message": format!("库存接口返回 HTTP {}，约 {}s 后重试（{}/{}）", status, (delay as f64 / 1000.0).round() as u64, attempt, total_attempts), "seconds": delay / 1000}));
            if !sleep_cancel(delay, cancel).await {
                return Err(SteamError::Cancelled);
            }
        };
        if data.get("success").and_then(|v| v.as_bool()) == Some(false) {
            let err = data
                .get("Error")
                .or_else(|| data.get("error"))
                .and_then(|v| v.as_str())
                .unwrap_or("未知原因");
            return Err(SteamError::user(format!("库存接口报错：{}", err)));
        }
        if let Some(total) = data.get("total_inventory_count").and_then(|v| v.as_i64()) {
            inv.total = total;
        }
        if let Some(assets) = data.get("assets").and_then(|v| v.as_array()) {
            for asset in assets {
                let classid = asset.get("classid").and_then(|v| v.as_str()).unwrap_or("");
                let instanceid = asset.get("instanceid").and_then(|v| v.as_str()).unwrap_or("0");
                if classid.is_empty() {
                    continue;
                }
                let amount = asset.get("amount").map(parse_amount).unwrap_or(1);
                let key = (classid.to_string(), instanceid.to_string());
                *inv.assets.entry(key).or_insert(0) += amount;
            }
        }
        if let Some(descs) = data.get("descriptions").and_then(|v| v.as_array()) {
            for desc in descs {
                let classid = desc.get("classid").and_then(|v| v.as_str()).unwrap_or("");
                let instanceid = desc.get("instanceid").and_then(|v| v.as_str()).unwrap_or("0");
                if classid.is_empty() {
                    continue;
                }
                inv.descriptions
                    .insert((classid.to_string(), instanceid.to_string()), desc.clone());
            }
        }
        page += 1;
        let items: i64 = inv.assets.values().sum();
        sink(json!({"type": "inventory", "page": page, "items": items, "total": inv.total,
                    "message": format!("库存第 {} 页，累计 {} 件", page, items)}));
        let more = data.get("more_items").and_then(|v| v.as_bool()).unwrap_or(false);
        if !more {
            break;
        }
        let next = data.get("last_assetid").and_then(|v| v.as_str()).map(|s| s.to_string());
        match next {
            Some(id) if Some(&id) != start.as_ref() => start = Some(id),
            _ => break,
        }
        if !sleep_cancel(1000, cancel).await {
            return Err(SteamError::Cancelled);
        }
    }
    Ok(inv)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Card {
    pub hash: String,
    pub name: String,
    pub game: String,
    pub appid: String,
    pub foil: bool,
    pub count: i64,
    pub marketable: bool,
    pub tradable: bool,
}

/// 把库存资产拆成卡牌列表与其它物品计数。
pub fn split_cards(inv: &RawInventory) -> (Vec<Card>, i64) {
    let mut cards = Vec::new();
    let mut other = 0i64;
    for (key, count) in &inv.assets {
        let desc = match inv.descriptions.get(key) {
            Some(d) => d,
            None => continue,
        };
        let tags = desc.get("tags").and_then(|v| v.as_array());
        let mut item_class = String::new();
        let mut game_internal = String::new();
        let mut game_name = String::new();
        let mut border = String::new();
        if let Some(tags) = tags {
            for tag in tags {
                let category = tag.get("category").and_then(|v| v.as_str()).unwrap_or("");
                let internal = tag.get("internal_name").and_then(|v| v.as_str()).unwrap_or("");
                match category {
                    "item_class" => item_class = internal.to_string(),
                    "Game" => {
                        game_internal = internal.to_string();
                        game_name = tag
                            .get("localized_tag_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                    }
                    "cardborder" => border = internal.to_string(),
                    _ => {}
                }
            }
        }
        if item_class != "item_class_2" {
            other += count;
            continue;
        }
        let hash = desc
            .get("market_hash_name")
            .or_else(|| desc.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let name = desc
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let marketable = desc
            .get("marketable")
            .map(|v| v.as_i64().unwrap_or(0) != 0 || v.as_bool().unwrap_or(false))
            .unwrap_or(false);
        let tradable = desc
            .get("tradable")
            .map(|v| v.as_i64().unwrap_or(0) != 0 || v.as_bool().unwrap_or(false))
            .unwrap_or(false);
        cards.push(Card {
            hash,
            name,
            game: game_name,
            appid: game_internal.replace("app_", ""),
            foil: border == "cardborder_1",
            count: *count,
            marketable,
            tradable,
        });
    }
    (cards, other)
}

/// 解析 Steam 价格字符串，兼容 "$1,234.56" / "1.234,56 €" / "¥ 4.50"。
pub fn parse_money(input: Option<&str>) -> Option<f64> {
    let raw = input?;
    if raw.trim().is_empty() {
        return None;
    }
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',' || *c == '-')
        .collect();
    let start = cleaned.find(|c: char| c.is_ascii_digit())?;
    let num = &cleaned[start..];
    if num.is_empty() {
        return None;
    }
    let has_dot = num.contains('.');
    let has_comma = num.contains(',');
    let normalized: String = if has_dot && has_comma {
        let last_dot = num.rfind('.').unwrap_or(0);
        let last_comma = num.rfind(',').unwrap_or(0);
        if last_comma > last_dot {
            num.replace('.', "").replace(',', ".")
        } else {
            num.replace(',', "")
        }
    } else if has_comma {
        let parts: Vec<&str> = num.split(',').collect();
        if parts.len() == 2 && parts[1].len() == 2 && parts[0].len() <= 3 {
            format!("{}.{}", parts[0], parts[1])
        } else {
            num.replace(',', "")
        }
    } else {
        num.to_string()
    };
    normalized.parse::<f64>().ok()
}

/// URL 百分号编码（RFC 3986 unreserved 之外全部编码）。
pub fn url_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push_str("%20"),
            other => out.push_str(&format!("%{:02X}", other)),
        }
    }
    out
}

pub fn cookie_jar_path(cache_path: &Path) -> PathBuf {
    let dir = cache_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
    dir.join(".steamcards_cookies")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn money_parsing() {
        assert_eq!(parse_money(Some("¥ 4.50")), Some(4.5));
        assert_eq!(parse_money(Some("$1,234.56")), Some(1234.56));
        assert_eq!(parse_money(Some("1.234,56 €")), Some(1234.56));
        assert_eq!(parse_money(Some("0,45 €")), Some(0.45));
        assert_eq!(parse_money(Some("12,50€")), Some(12.5));
        assert_eq!(parse_money(Some("")), None);
        assert_eq!(parse_money(None), None);
    }

    #[test]
    fn url_encoding() {
        assert_eq!(url_encode("730-Frost #1"), "730-Frost%20%231");
        assert_eq!(url_encode("中文"), "%E4%B8%AD%E6%96%87");
    }

    #[test]
    fn steam_id_detection() {
        assert!(is_steam_id("76561198000000000"));
        assert!(!is_steam_id("7656119800000000"));
        assert_eq!(
            find_id_after("https://steamcommunity.com/profiles/76561198000000000/", "/profiles/"),
            Some("76561198000000000".to_string())
        );
    }

    #[test]
    fn retry_delay_is_growing() {
        for attempt in 1..=4u32 {
            let delay = inventory_retry_delay(attempt);
            assert!(delay >= 2_000, "delay too small: {}", delay);
        }
        assert!(inventory_retry_delay(4) >= inventory_retry_delay(1));
    }

    #[test]
    fn split_cards_works() {
        let mut inv = RawInventory::default();
        inv.assets.insert(("1".into(), "0".into()), 2);
        inv.assets.insert(("2".into(), "0".into()), 1);
        inv.descriptions.insert(
            ("1".into(), "0".into()),
            json!({
                "classid": "1", "instanceid": "0",
                "market_hash_name": "730-Frost", "name": "Frost",
                "marketable": 1, "tradable": 1,
                "tags": [
                    {"category": "item_class", "internal_name": "item_class_2"},
                    {"category": "Game", "internal_name": "app_730", "localized_tag_name": "CS2"},
                    {"category": "cardborder", "internal_name": "cardborder_0"}
                ]
            }),
        );
        inv.descriptions.insert(
            ("2".into(), "0".into()),
            json!({
                "classid": "2", "instanceid": "0",
                "market_hash_name": "bg", "name": "bg",
                "marketable": 1, "tradable": 1,
                "tags": [{"category": "item_class", "internal_name": "item_class_3"}]
            }),
        );
        let (cards, other) = split_cards(&inv);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].hash, "730-Frost");
        assert_eq!(cards[0].count, 2);
        assert_eq!(cards[0].game, "CS2");
        assert_eq!(cards[0].appid, "730");
        assert_eq!(other, 1);
    }
}