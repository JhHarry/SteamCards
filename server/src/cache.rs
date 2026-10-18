//! 轻量 JSON 价格缓存（替代 Python 版的 SQLite，避免 C 依赖，单文件可读可删）。
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CacheEntry {
    pub ok: i64,
    pub lowest: Option<f64>,
    pub median: Option<f64>,
    pub volume: Option<i64>,
    pub ts: i64,
}

#[derive(Serialize, Deserialize, Default)]
struct CacheFile {
    version: u32,
    entries: HashMap<String, HashMap<String, CacheEntry>>,
}

pub struct PriceCache {
    path: PathBuf,
    data: CacheFile,
    dirty: usize,
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl PriceCache {
    pub fn load(path: PathBuf) -> PriceCache {
        let mut data = CacheFile {
            version: 1,
            entries: HashMap::new(),
        };
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<CacheFile>(&text) {
                data = parsed;
            }
        }
        PriceCache {
            path,
            data,
            dirty: 0,
        }
    }

    pub fn get(&self, hash: &str, currency: i64, max_age: i64) -> Option<CacheEntry> {
        let entry = self.data.entries.get(hash)?.get(&currency.to_string())?.clone();
        if entry.ok < 0 {
            return None;
        }
        if now_ts() - entry.ts > max_age {
            return None;
        }
        Some(entry)
    }

    pub fn put(&mut self, hash: &str, currency: i64, entry: CacheEntry) {
        self.data
            .entries
            .entry(hash.to_string())
            .or_default()
            .insert(currency.to_string(), entry);
        self.dirty += 1;
        if self.dirty >= 20 {
            self.save();
        }
    }

    pub fn clear_currency(&mut self, currency: i64) {
        let key = currency.to_string();
        for map in self.data.entries.values_mut() {
            map.remove(&key);
        }
        self.dirty += 1;
        self.save();
    }

    pub fn save(&mut self) {
        if let Some(dir) = self.path.parent() {
            if !dir.as_os_str().is_empty() {
                let _ = fs::create_dir_all(dir);
            }
        }
        let text = match serde_json::to_string(&self.data) {
            Ok(t) => t,
            Err(_) => return,
        };
        let tmp = self.path.with_extension("json.tmp");
        if fs::write(&tmp, text).is_ok() {
            let _ = fs::rename(&tmp, &self.path);
        }
        self.dirty = 0;
    }

}


// ---------------------------------------------------------------------------
// 库存缓存：库存接口被限流时可直接复用最近一次成功抓取的卡牌列表，继续查价格。
// ---------------------------------------------------------------------------
use crate::steam::Card;

const INVENTORY_CACHE_MAX_AGE_SECS: i64 = 7 * 24 * 3600;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InventoryEntry {
    pub ts: i64,
    pub total: i64,
    pub other: i64,
    pub cards: Vec<Card>,
}

#[derive(Serialize, Deserialize, Default)]
struct InventoryFile {
    entries: HashMap<String, InventoryEntry>,
}

pub struct InventoryCache {
    path: PathBuf,
    data: InventoryFile,
}

/// 库存缓存与价格缓存放在同一目录（默认 ~/.steamcards_inventory.json）。
pub fn inventory_cache_path(price_cache_path: &std::path::Path) -> PathBuf {
    price_cache_path.with_file_name(".steamcards_inventory.json")
}

impl InventoryCache {
    pub fn load(path: PathBuf) -> InventoryCache {
        let mut data = InventoryFile {
            entries: HashMap::new(),
        };
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<InventoryFile>(&text) {
                data = parsed;
            }
        }
        InventoryCache { path, data }
    }

    pub fn get_fresh(&self, sid: &str, max_age: i64) -> Option<InventoryEntry> {
        let entry = self.data.entries.get(sid)?.clone();
        let max_age = if max_age <= 0 {
            INVENTORY_CACHE_MAX_AGE_SECS
        } else {
            max_age
        };
        if now_ts() - entry.ts > max_age {
            return None;
        }
        Some(entry)
    }

    pub fn put(&mut self, sid: &str, total: i64, other: i64, cards: &[Card]) {
        // 只保留最近 30 天的库存缓存，最多 30 个账号，避免文件无限增长
        let cutoff = now_ts() - 30 * 24 * 3600;
        self.data.entries.retain(|_, entry| entry.ts >= cutoff);
        if self.data.entries.len() >= 30 {
            if let Some(oldest) = self
                .data
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.ts)
                .map(|(sid, _)| sid.clone())
            {
                self.data.entries.remove(&oldest);
            }
        }
        self.data.entries.insert(
            sid.to_string(),
            InventoryEntry {
                ts: now_ts(),
                total,
                other,
                cards: cards.to_vec(),
            },
        );
    }

    pub fn save(&mut self) {
        if let Some(dir) = self.path.parent() {
            if !dir.as_os_str().is_empty() {
                let _ = fs::create_dir_all(dir);
            }
        }
        let text = match serde_json::to_string(&self.data) {
            Ok(text) => text,
            Err(_) => return,
        };
        let tmp = self.path.with_extension("json.tmp");
        if fs::write(&tmp, text).is_ok() {
            let _ = fs::rename(&tmp, &self.path);
        }
    }
}

/// 把秒数转成“X 分钟前 / X 小时前”。
pub fn human_age(seconds: i64) -> String {
    let seconds = seconds.max(0);
    if seconds < 60 {
        format!("{} 秒", seconds)
    } else if seconds < 3600 {
        format!("{} 分钟", seconds / 60)
    } else if seconds < 86_400 {
        format!("{} 小时", seconds / 3600)
    } else {
        format!("{} 天", seconds / 86_400)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inventory_cache_roundtrip_and_expiry() {
        use crate::steam::Card;
        let dir = std::env::temp_dir().join(format!("steamcards-inv-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join(".steamcards_inventory.json");
        let _ = fs::remove_file(&path);
        let mut cache = InventoryCache::load(path.clone());
        let cards = vec![Card {
            hash: "730-Frost".into(),
            name: "Frost".into(),
            game: "CS2".into(),
            appid: "730".into(),
            foil: false,
            count: 2,
            marketable: true,
            tradable: true,
        }];
        cache.put("76561198000000000", 3, 1, &cards);
        cache.save();
        let loaded = InventoryCache::load(path.clone());
        let hit = loaded.get_fresh("76561198000000000", 3600).expect("inventory hit");
        assert_eq!(hit.cards.len(), 1);
        assert_eq!(hit.cards[0].count, 2);
        assert!(loaded.get_fresh("76561198000000000", -1).is_some(), "负数使用默认有效期");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn age_formatting() {
        assert_eq!(human_age(30), "30 秒");
        assert_eq!(human_age(120), "2 分钟");
        assert_eq!(human_age(7200), "2 小时");
        assert_eq!(human_age(172800), "2 天");
    }

    #[test]
    fn cache_roundtrip_and_expiry() {
        let dir = std::env::temp_dir().join(format!("steamcards-cache-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("prices.json");
        let _ = fs::remove_file(&path);
        let mut cache = PriceCache::load(path.clone());
        cache.put(
            "730-Frost",
            23,
            CacheEntry {
                ok: 1,
                lowest: Some(0.45),
                median: None,
                volume: Some(10),
                ts: now_ts(),
            },
        );
        cache.save();
        let loaded = PriceCache::load(path.clone());
        let hit = loaded.get("730-Frost", 23, 86400).expect("cache hit");
        assert_eq!(hit.lowest, Some(0.45));
        assert!(loaded.get("730-Frost", 23, -1).is_none(), "max_age<0 应过期");
        assert!(loaded.get("730-Frost", 1, 86400).is_none(), "不同货币不命中");
        let _ = fs::remove_dir_all(&dir);
    }
}