//! Steam 卡牌估值 · 独立桌面应用（Tauri 2 + React 前端）
//!
//! 不启动 HTTP 服务、不依赖浏览器：Rust 后端逻辑直接编译进这个可执行文件，
//! React 前端被 Tauri 内嵌，通过 invoke / event 与 Rust 通信。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use steamcards_core::model::{Snapshot, StartRequest};
use steamcards_core::pipeline;
use steamcards_core::state::{CancelToken, Shared};
use serde_json::{json, Value};
use tauri::{Emitter, Manager, State, WebviewWindow};

struct AppState {
    shared: Arc<Shared>,
}

fn validate(request: &StartRequest) -> Result<(), String> {
    if !request.demo && request.steamid.trim().is_empty() {
        return Err("请填写 SteamID64、个人资料链接或自定义主页链接".to_string());
    }
    if request.currency <= 0 || request.currency > 100 {
        return Err("货币代码不合法".to_string());
    }
    if !(0.0..=0.9).contains(&request.fee) {
        return Err("手续费必须在 0 ~ 0.9 之间".to_string());
    }
    if request.limit < 0 {
        return Err("只查前 N 种不能是负数".to_string());
    }
    Ok(())
}

#[tauri::command]
async fn api_state(state: State<'_, AppState>) -> Result<Value, String> {
    let snapshot = state.shared.current_snapshot().await;
    Ok(Shared::snapshot_value(&snapshot))
}

#[tauri::command]
async fn start_valuation(
    state: State<'_, AppState>,
    request: StartRequest,
) -> Result<Value, String> {
    validate(&request)?;
    if state
        .shared
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("已有任务在运行，请先停止或等待完成".to_string());
    }
    let cancel = Arc::new(CancelToken::new());
    *state.shared.cancel.lock().await = Some(cancel.clone());

    let mut snapshot = Snapshot::default();
    snapshot.state = "running".to_string();
    snapshot.demo = request.demo;
    snapshot.progress = Some(Default::default());
    state.shared.set_snapshot(snapshot).await;

    let shared = state.shared.clone();
    let request_clone = request.clone();
    tauri::async_runtime::spawn(async move {
        pipeline::run_job(shared, request_clone, cancel).await;
    });
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn cancel_valuation(state: State<'_, AppState>) -> Result<Value, String> {
    let token = { state.shared.cancel.lock().await.clone() };
    match token {
        Some(token) => {
            token.cancel();
            Ok(json!({ "ok": true, "cancelled": true }))
        }
        None => Ok(json!({ "ok": true, "cancelled": false })),
    }
}

#[tauri::command]
async fn save_csv(state: State<'_, AppState>, kind: String) -> Result<String, String> {
    let snapshot = state.shared.current_snapshot().await;
    let paths = snapshot.paths.ok_or_else(|| "还没有生成 CSV 文件".to_string())?;
    let source = if kind == "summary" { paths.summary } else { paths.detail };
    let source_path = PathBuf::from(&source);
    if !source_path.exists() {
        return Err("CSV 文件不存在，请重新估值".to_string());
    }
    let file_name = source_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "steam_cards.csv".to_string());

    let target = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title("保存 CSV")
            .set_file_name(&file_name)
            .add_filter("CSV 文件", &["csv"])
            .save_file()
    })
    .await
    .map_err(|e| format!("打开保存对话框失败：{e}"))?;

    match target {
        Some(target_path) => {
            std::fs::copy(&source_path, &target_path)
                .map_err(|e| format!("保存文件失败：{e}"))?;
            Ok(target_path.to_string_lossy().into_owned())
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
async fn open_folder(state: State<'_, AppState>) -> Result<Value, String> {
    let snapshot = state.shared.current_snapshot().await;
    let dir = snapshot
        .paths
        .as_ref()
        .and_then(|paths| Path::new(&paths.detail).parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| state.shared.out_dir.clone());
    steamcards_core::open_path_dir(&dir).map_err(|e| format!("打开目录失败：{e}"))?;
    Ok(json!({ "ok": true, "path": dir.to_string_lossy() }))
}

// ---- 历史结果 ----

#[tauri::command]
fn history_list() -> Result<Value, String> {
    serde_json::to_value(steamcards_core::history::list_results())
        .map_err(|e| format!("读取历史记录失败：{e}"))
}

#[tauri::command]
fn history_load(id: String) -> Result<Value, String> {
    let file = steamcards_core::history::load_result(&id)?;
    serde_json::to_value(file).map_err(|e| format!("读取历史记录失败：{e}"))
}

#[tauri::command]
fn history_delete(id: String) -> Result<(), String> {
    steamcards_core::history::delete_result(&id)
}

// ---- 无边框窗口控制 ----

#[tauri::command]
fn win_minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn win_toggle_maximize(window: WebviewWindow) -> Result<(), String> {
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    if maximized {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn win_close(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn win_start_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

fn default_out_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .download_dir()
        .map(|dir| dir.join("SteamCards"))
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

#[cfg(windows)]
fn configure_webview2_environment() {
    // MSIX 安装后应用目录只读，把 WebView2 用户数据放到 LocalAppData。
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let dir = PathBuf::from(local).join("SteamCards").join("EBWebView");
            let _ = std::fs::create_dir_all(&dir);
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
        }
    }
    // 打包时会带上固定版本 WebView2 运行时（WebView2Runtime 子目录），
    // 这样安装后不依赖系统里是否已安装 WebView2。
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let runtime = dir.join("WebView2Runtime");
            if runtime.join("msedgewebview2.exe").is_file() {
                std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &runtime);
            }
        }
    }
}

/// 首次启动：按工作区（去掉任务栏）计算窗口大小并居中。
/// 宽度：横屏取工作区 25/32，竖屏取 5/6；高度：工作区高度上下各留 28px，
/// 这样右侧内容不会出现滚动条，也不会碰到任务栏。
fn apply_default_window_position(window: &WebviewWindow) {
    let mut work_area: Option<tauri::PhysicalRect<i32, u32>> = None;
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let area = *monitor.work_area();
        let size = area.size;
        let portrait = size.height > size.width;
        let (num, den) = if portrait { (5u64, 6u64) } else { (25u64, 32u64) };
        let scale = monitor.scale_factor();
        // 无边框窗口首次 set_size 会在高度上多出约 30 逻辑像素（不可见区域），提前扣除
        let extra_height = (30.0 * scale).round() as u32;
        let margin = (56.0 * scale).round() as u32;
        let desired_height = size.height.saturating_sub(margin).max(500);
        let target = tauri::PhysicalSize::new(
            ((size.width as u64 * num / den) as u32).max(640),
            desired_height.saturating_sub(extra_height).max(500),
        );
        work_area = Some(area);
        let _ = window.set_size(tauri::Size::Physical(target));
    }

    let window = window.clone();
    let _ = window.show();
    let _ = window.set_focus();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        if let Some(area) = work_area {
            let actual = window.inner_size().unwrap_or(tauri::PhysicalSize::new(0, 0));
            if actual.width == 0 || actual.height == 0 {
                return;
            }
            let x = area.position.x + ((area.size.width as i32 - actual.width as i32) / 2);
            let y = area.position.y + ((area.size.height as i32 - actual.height as i32) / 2);
            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
                x, y,
            )));
        }
    });
}

fn main() {
    #[cfg(windows)]
    configure_webview2_environment();

    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                apply_default_window_position(&window);
            }
            let handle = app.handle().clone();
            let shared = Shared::new(
                default_out_dir(&handle),
                steamcards_core::default_cache_path(),
                None,
            );
            app.manage(AppState {
                shared: shared.clone(),
            });

            // 把核心库的 broadcast 事件桥接成 Tauri 事件，前端用 listen 订阅。
            let mut receiver = shared.tx.subscribe();
            let event_app = handle.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match receiver.recv().await {
                        Ok(message) => {
                            if let Ok(value) = serde_json::from_str::<Value>(&message) {
                                let _ = event_app.emit("steamcards-event", value);
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api_state,
            start_valuation,
            cancel_valuation,
            save_csv,
            open_folder,
            win_minimize,
            win_toggle_maximize,
            win_close,
            win_start_drag,
            history_list,
            history_load,
            history_delete
        ])
        .run(tauri::generate_context!())
        .expect("启动 Steam Cards 桌面应用失败");
}