//! 历史估值结果：按账号分组保存到用户目录，供界面随时回看。
//!
//! 目录结构：%USERPROFILE%\.steamcards_history\<steamid64>\<unix秒>.json
//! 文件名使用补零的 unix 秒，天然按时间排序。
use crate::model::{CardRow, PathsOut, Summary};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HistoryEntry {
    pub id: String,
    pub steamid64: String,
    pub nickname: String,
    pub generated_at: String,
    pub saved_at: i64,
    pub types: u64,
    pub copies: u64,
    pub gross: f64,
    pub net: f64,
    pub currency: String,
    pub currency_label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HistoryFile {
    pub entry: HistoryEntry,
    pub summary: Summary,
    pub rows: Vec<CardRow>,
    pub paths: PathsOut,
}

pub fn history_root() -> PathBuf {
    if let Ok(dir) = std::env::var("STEAMCARDS_HISTORY_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".steamcards_history")
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn safe_id(id: &str) -> Option<(String, String)> {
    let mut parts = id.split('/');
    let sid = parts.next()?;
    let file = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    if sid.is_empty()
        || file.is_empty()
        || sid.contains("..")
        || file.contains("..")
        || file.contains('/')
        || file.contains('\\')
    {
        return None;
    }
    if !sid.chars().all(|c| c.is_ascii_digit()) || !file.ends_with(".json") {
        return None;
    }
    Some((sid.to_string(), file.to_string()))
}

/// 保存一次估值结果（demo 不保存）。
pub fn save_result(
    summary: &Summary,
    rows: &[CardRow],
    paths: &PathsOut,
) -> Result<HistoryEntry, String> {
    if summary.demo {
        return Err("演示结果不写入历史".to_string());
    }
    if summary.steamid64.is_empty() {
        return Err("缺少 SteamID，无法保存历史".to_string());
    }
    let saved_at = now_secs();
    let dir = history_root().join(&summary.steamid64);
    fs::create_dir_all(&dir).map_err(|e| format!("创建历史目录失败：{e}"))?;
    let file_name = format!("{:020}.json", saved_at);
    let id = format!("{}/{}", summary.steamid64, file_name);
    let entry = HistoryEntry {
        id: id.clone(),
        steamid64: summary.steamid64.clone(),
        nickname: summary.nickname.clone(),
        generated_at: summary.generated_at.clone(),
        saved_at,
        types: summary.types,
        copies: summary.copies,
        gross: summary.gross,
        net: summary.net,
        currency: summary.currency.clone(),
        currency_label: summary.currency_label.clone(),
    };
    let file = HistoryFile {
        entry: entry.clone(),
        summary: summary.clone(),
        rows: rows.to_vec(),
        paths: paths.clone(),
    };
    let text = serde_json::to_string(&file).map_err(|e| format!("序列化历史失败：{e}"))?;
    let path = dir.join(file_name);
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| format!("写入历史失败：{e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("保存历史失败：{e}"))?;
    Ok(entry)
}

/// 列出所有历史结果，按保存时间倒序。
pub fn list_results() -> Vec<HistoryEntry> {
    let mut entries = Vec::new();
    let root = history_root();
    let Ok(dirs) = fs::read_dir(&root) else {
        return entries;
    };
    for dir_entry in dirs.flatten() {
        let dir_path = dir_entry.path();
        if !dir_path.is_dir() {
            continue;
        }
        let Ok(files) = fs::read_dir(&dir_path) else {
            continue;
        };
        for file_entry in files.flatten() {
            let path = file_entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(text) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(file) = serde_json::from_str::<HistoryFile>(&text) else {
                continue;
            };
            entries.push(file.entry);
        }
    }
    entries.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    entries
}

/// 读取一条历史结果。
pub fn load_result(id: &str) -> Result<HistoryFile, String> {
    let (sid, file_name) = safe_id(id).ok_or_else(|| "历史记录 ID 不合法".to_string())?;
    let path = history_root().join(sid).join(file_name);
    let text = fs::read_to_string(&path).map_err(|_| "找不到这条历史记录".to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("历史记录已损坏：{e}"))
}

/// 删除一条历史记录。
pub fn delete_result(id: &str) -> Result<(), String> {
    let (sid, file_name) = safe_id(id).ok_or_else(|| "历史记录 ID 不合法".to_string())?;
    let path: PathBuf = history_root().join(sid).join(file_name);
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path).map_err(|e| format!("删除历史失败：{e}"))?;
    if let Some(parent) = path.parent() {
        if parent != Path::new("") {
            let _ = fs::remove_dir(parent);
        }
    }
    Ok(())
}
