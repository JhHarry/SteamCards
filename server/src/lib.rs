//! Steam 卡牌估值核心库：库存抓取、价格查询、缓存、CSV 输出、进度事件。
//!
//! 既被命令行/HTTP 服务端（server 二进制）使用，也被桌面外壳（Tauri）复用。
pub mod cache;
pub mod demo;
pub mod history;
pub mod model;
pub mod pipeline;
pub mod pricing;
pub mod state;
pub mod steam;

use std::path::{Path, PathBuf};

/// 默认价格缓存路径：~/.steamcards_cache.json
pub fn default_cache_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".steamcards_cache.json")
}

/// 用系统文件管理器打开目录。
pub fn open_path_dir(dir: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(dir).spawn().map(|_| ())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(dir).spawn().map(|_| ())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(dir).spawn().map(|_| ())
    }
}