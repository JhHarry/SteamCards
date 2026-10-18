//! 数据模型：进度、统计、汇总、卡牌行、快照、启动请求。
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct Stats {
    pub ok: u64,
    pub no_listing: u64,
    pub not_marketable: u64,
    pub not_cached: u64,
    pub blocked: u64,
    pub error: u64,
    pub cancelled: u64,
    pub cached: u64,
}

impl Stats {
    pub fn bump(&mut self, status: &str) {
        match status {
            "ok" => self.ok += 1,
            "no_listing" => self.no_listing += 1,
            "not_marketable" => self.not_marketable += 1,
            "not_cached" => self.not_cached += 1,
            "blocked" => self.blocked += 1,
            "cancelled" => self.cancelled += 1,
            _ => self.error += 1,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct Progress {
    pub done: u64,
    pub total: u64,
    pub elapsed: f64,
    pub eta: f64,
    pub rate: f64,
    pub gross: f64,
    pub hash: String,
    pub name: String,
    pub game: String,
    pub status: String,
    pub stats: Stats,
    pub requests: u64,
    pub cached: u64,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct Summary {
    pub steamid64: String,
    pub nickname: String,
    /// 货币代码字符串，如 "CNY"（前端直接展示）
    pub currency: String,
    /// 完整货币标签，如 "CNY 人民币"
    pub currency_label: String,
    pub types: u64,
    pub copies: u64,
    pub games: u64,
    pub foil_types: u64,
    pub priced: u64,
    pub unpriced: u64,
    pub sellable: u64,
    pub gross: f64,
    pub fee: f64,
    pub net: f64,
    pub generated_at: String,
    pub elapsed: f64,
    pub requests: u64,
    pub cached: u64,
    /// 熔断时已查询的种数；未熔断为 null
    pub aborted_at: Option<u64>,
    pub cancelled: bool,
    pub cancelled_types: u64,
    pub demo: bool,
    pub offline: bool,
    /// 本次是否使用了本地库存缓存（库存接口受限时的兜底）
    pub inventory_cached: bool,
    /// 使用的库存缓存距今秒数（未使用缓存为 0）
    pub inventory_cache_age_secs: u64,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct PathsOut {
    pub detail: String,
    pub summary: String,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct CardRow {
    pub hash: String,
    pub name: String,
    pub game: String,
    pub appid: String,
    pub foil: bool,
    pub count: i64,
    pub marketable: bool,
    pub tradable: bool,
    pub lowest: Option<f64>,
    pub value: f64,
    pub volume: Option<i64>,
    pub status: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Snapshot {
    pub state: String,
    pub demo: bool,
    pub progress: Option<Progress>,
    pub summary: Option<Summary>,
    pub paths: Option<PathsOut>,
    pub error: Option<String>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Snapshot {
            state: "idle".to_string(),
            demo: false,
            progress: None,
            summary: None,
            paths: None,
            error: None,
        }
    }
}

fn default_currency() -> i64 {
    23
}

fn default_fee() -> f64 {
    0.15
}

#[derive(Deserialize, Clone, Debug)]
pub struct StartRequest {
    #[serde(default)]
    pub steamid: String,
    #[serde(default = "default_currency")]
    pub currency: i64,
    #[serde(default = "default_fee")]
    pub fee: f64,
    #[serde(default)]
    pub limit: i64,
    #[serde(default)]
    pub offline: bool,
    #[serde(default)]
    pub no_cache: bool,
    #[serde(default)]
    pub demo: bool,
    #[serde(default)]
    pub debug: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct ApiError {
    pub ok: bool,
    pub error: String,
}

pub fn api_error(msg: impl Into<String>) -> ApiError {
    ApiError {
        ok: false,
        error: msg.into(),
    }
}