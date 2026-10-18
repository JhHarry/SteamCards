//! 价格查询：本地缓存 + 自适应限速 + 抖动退避 + 熔断信号。
//!
//! 抓取策略（准确 + 高效）：
//! - 成功时保持节奏，连续成功会逐渐加快（最低 1.1s/张）；
//! - 被限流时只做短时间的抖动退避（2.5s / 5s / 10s / 20s），并自适应放慢节奏；
//! - 单张卡最多尝试 5 次；连续多张失败后由上层暂停恢复，而不是长时间卡死；
//! - 命中缓存不请求、不刷新时间戳，保证价格数据新鲜且不浪费请求。
use crate::cache::{CacheEntry, PriceCache};
use crate::state::{CancelToken, EventSink};
use crate::steam::{curl_get, jitter_ms, parse_money, sleep_cancel, url_encode, SteamError, APPID};
use serde_json::json;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_PRICE_ATTEMPTS: u32 = 4;
const MIN_INTERVAL_SECS: f64 = 3.0;
const MAX_INTERVAL_SECS: f64 = 6.0;

#[derive(Debug, Clone)]
pub struct PriceResult {
    pub ok: i64,
    pub lowest: Option<f64>,
    pub median: Option<f64>,
    pub volume: Option<i64>,
    pub error: Option<String>,
    pub cached: bool,
}

impl PriceResult {
    fn not_cached() -> Self {
        PriceResult {
            ok: -1,
            lowest: None,
            median: None,
            volume: None,
            error: Some("not_cached".into()),
            cached: false,
        }
    }

    fn no_listing() -> Self {
        PriceResult {
            ok: 0,
            lowest: None,
            median: None,
            volume: None,
            error: Some("no_listing".into()),
            cached: false,
        }
    }

    fn blocked() -> Self {
        PriceResult {
            ok: -2,
            lowest: None,
            median: None,
            volume: None,
            error: Some("blocked".into()),
            cached: false,
        }
    }

    fn http_error(status: u16) -> Self {
        PriceResult {
            ok: -1,
            lowest: None,
            median: None,
            volume: None,
            error: Some(format!("HTTP {}", status)),
            cached: false,
        }
    }

    fn from_entry(entry: CacheEntry) -> Self {
        PriceResult {
            ok: entry.ok,
            lowest: entry.lowest,
            median: entry.median,
            volume: entry.volume,
            error: None,
            cached: true,
        }
    }

    fn to_entry(&self) -> CacheEntry {
        CacheEntry {
            ok: self.ok,
            lowest: self.lowest,
            median: self.median,
            volume: self.volume,
            ts: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
        }
    }
}

pub struct Pricer {
    pub cache: PriceCache,
    pub currency: i64,
    interval: f64,
    base_interval: f64,
    max_interval: f64,
    max_age: i64,
    last: Option<Instant>,
    cooldown: Option<Instant>,
    success_streak: u32,
    pub requested: u64,
    pub blocked: u64,
    pub cached: u64,
    since_ok: u32,
}

impl Pricer {
    pub fn new(cache: PriceCache, currency: i64, min_interval: f64, max_age: i64) -> Self {
        // 默认 2.0s/张，观察到市场接口对突发请求很敏感；自适应范围 1.6~4.0s
        // 当前 IP 对 priceoverview 较敏感：默认 3.5s/张、自适应 3.0~6.0s，尽量稳定不触发 429。
        // 可通过环境变量 STEAMCARDS_PRICE_INTERVAL 覆盖（秒），限流严重时用于慢速续跑。
        let mut interval = min_interval.max(3.5);
        if let Ok(value) = std::env::var("STEAMCARDS_PRICE_INTERVAL") {
            if let Ok(seconds) = value.trim().parse::<f64>() {
                interval = seconds.clamp(1.0, 120.0);
            }
        }
        let interval = interval.clamp(MIN_INTERVAL_SECS, MAX_INTERVAL_SECS.max(interval));
        let max_interval = MAX_INTERVAL_SECS.max(interval * 1.5);
        Pricer {
            cache,
            currency,
            base_interval: interval,
            interval,
            max_interval,
            max_age,
            last: None,
            cooldown: None,
            success_streak: 0,
            requested: 0,
            blocked: 0,
            cached: 0,
            since_ok: 0,
        }
    }

    /// 当前自适应请求间隔（秒），便于调试。
    pub fn current_interval(&self) -> f64 {
        self.interval
    }

    fn on_success(&mut self) {
        self.success_streak += 1;
        self.cooldown = None;
        self.since_ok = 0;
        if self.success_streak >= 10 {
            self.interval = (self.interval * 0.96).max(self.base_interval);
            self.success_streak = 0;
        }
    }

    fn on_throttled(&mut self, attempts: u32) -> u64 {
        // 被限流时只温和放慢节奏，退避也从更短开始，避免一次 429 就把整体拖到 6s/张
        self.interval = (self.interval * 1.06).min(self.max_interval);
        self.success_streak = 0;
        let base = match attempts {
            1 => 2_000,
            2 => 5_000,
            3 => 10_000,
            _ => 20_000,
        };
        jitter_ms(base)
    }

    async fn wait(&mut self, cancel: &CancelToken) -> Result<(), SteamError> {
        let now = Instant::now();
        let mut wait_secs: f64 = 0.0;
        if let Some(last) = self.last {
            let elapsed = now.duration_since(last).as_secs_f64();
            wait_secs = wait_secs.max(self.interval - elapsed);
        }
        if let Some(cooldown) = self.cooldown {
            if cooldown > now {
                wait_secs = wait_secs.max(cooldown.duration_since(now).as_secs_f64());
            }
        }
        if wait_secs > 0.0 {
            let ok = sleep_cancel((wait_secs * 1000.0).ceil() as u64, cancel).await;
            if !ok {
                return Err(SteamError::Cancelled);
            }
        }
        if cancel.is_cancelled() {
            return Err(SteamError::Cancelled);
        }
        self.last = Some(Instant::now());
        Ok(())
    }

    pub async fn one(
        &mut self,
        hash: &str,
        offline: bool,
        cancel: &CancelToken,
        sink: &EventSink,
        debug: bool,
    ) -> Result<PriceResult, SteamError> {
        if let Some(entry) = self.cache.get(hash, self.currency, self.max_age) {
            self.cached += 1;
            return Ok(PriceResult::from_entry(entry));
        }
        if offline {
            return Ok(PriceResult::not_cached());
        }
        let url = format!(
            "https://steamcommunity.com/market/priceoverview/?appid={}&currency={}&market_hash_name={}",
            APPID,
            self.currency,
            url_encode(hash)
        );
        let mut attempts = 0u32;
        loop {
            self.wait(cancel).await?;
            let (status, body) = curl_get(&url, None, &[], cancel).await?;
            self.requested += 1;
            if debug {
                sink(json!({"type": "log", "level": "debug",
                    "message": format!("价格 HTTP {}：{}", status, crate::steam::snippet(&body, 120))}));
            }
            if status == 200 && body.trim_start().starts_with('{') {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(body.trim()) {
                    if value.is_object() {
                        if value.get("success").and_then(|v| v.as_bool()) != Some(true) {
                            self.on_success();
                            let result = PriceResult::no_listing();
                            self.cache.put(hash, self.currency, result.to_entry());
                            return Ok(result);
                        }
                        self.on_success();
                        let volume = value
                            .get("volume")
                            .and_then(|v| v.as_str())
                            .map(|s| s.replace(',', ""))
                            .and_then(|s| s.parse::<i64>().ok());
                        let mut lowest = parse_money(value.get("lowest_price").and_then(|v| v.as_str()));
                        let median = parse_money(value.get("median_price").and_then(|v| v.as_str()));
                        // 少数物品只有 median_price（成交价中位数），用它兜底更“准确”
                        if lowest.is_none() {
                            lowest = median;
                        }
                        let result = PriceResult {
                            ok: 1,
                            lowest,
                            median,
                            volume,
                            error: None,
                            cached: false,
                        };
                        self.cache.put(hash, self.currency, result.to_entry());
                        return Ok(result);
                    }
                }
            }
            attempts += 1;
            self.blocked += 1;
            self.since_ok += 1;
            if attempts >= MAX_PRICE_ATTEMPTS || self.since_ok >= 8 {
                let result = if status == 429 || status == 0 {
                    PriceResult::blocked()
                } else {
                    PriceResult::http_error(status)
                };
                return Ok(result);
            }
            let delay = self.on_throttled(attempts);
            self.cooldown = Some(Instant::now() + Duration::from_millis(delay));
            sink(json!({"type": "retry",
                "message": format!("市场接口限流（HTTP {}），约 {:.0}s 后重试（第 {}/{} 次）", status, delay as f64 / 1000.0, attempts, MAX_PRICE_ATTEMPTS),
                "seconds": delay / 1000}));
        }
    }

    /// 该卡在缓存中是否已有新鲜价格（批量兜底填充后用于判断是否命中）。
    pub fn has_fresh(&self, hash: &str) -> bool {
        self.cache.get(hash, self.currency, self.max_age).is_some()
    }

    /// 写入一条缓存价格（批量兜底取价用）。
    pub fn put_entry(&mut self, hash: &str, entry: CacheEntry) {
        self.cache.put(hash, self.currency, entry);
    }

    pub fn save(&mut self) {
        self.cache.save();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_cache() -> PriceCache {
        let path = std::env::temp_dir().join(format!(
            "steamcards-price-test-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.subsec_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_file(&path);
        PriceCache::load(PathBuf::from(path))
    }

    #[test]
    fn adaptive_interval_moves_in_right_direction() {
        let mut pricer = Pricer::new(temp_cache(), 23, 1.1, 86_400);
        let start = pricer.current_interval();
        for _ in 0..12 {
            pricer.on_success();
        }
        assert!(pricer.current_interval() <= start);
        let after_success = pricer.current_interval();
        let delay = pricer.on_throttled(1);
        assert!(delay >= 1_800 && delay <= 3_200, "unexpected jitter: {}", delay);
        assert!(pricer.current_interval() > after_success);
        assert!(pricer.current_interval() <= pricer.max_interval);
    }
}