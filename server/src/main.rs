//! Steam 卡牌估值 · 轻量 Rust 后端
//!
//! 单二进制：内嵌前端静态资源（web/dist），通过 SSE 把进度推给浏览器。
//! 默认监听 127.0.0.1:8787 并自动打开浏览器。
include!(concat!(env!("OUT_DIR"), "/embedded_web.rs"));

use axum::extract::rejection::JsonRejection;
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use steamcards_core::model::{api_error, Progress, Snapshot, StartRequest};
use steamcards_core::pipeline;
use steamcards_core::state::{CancelToken, Shared};
use steamcards_core::steam;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

// ---------------------------------------------------------------------------
// 前端静态资源（编译期内嵌）
// ---------------------------------------------------------------------------
fn embedded_lookup(path: &str) -> Option<&'static [u8]> {
    EMBEDDED_WEB
        .iter()
        .find(|(name, _)| *name == path)
        .map(|(_, bytes)| *bytes)
}

fn mime_for(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") {
        "text/javascript; charset=utf-8"
    } else if lower.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if lower.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else if lower.ends_with(".woff") {
        "font/woff"
    } else if lower.ends_with(".map") {
        "application/json; charset=utf-8"
    } else {
        "application/octet-stream"
    }
}

fn sanitize_path(raw: &str) -> String {
    let mut segments: Vec<&str> = Vec::new();
    for segment in raw.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            segments.pop();
            continue;
        }
        segments.push(segment);
    }
    segments.join("/")
}

async fn load_asset(shared: &Shared, path: &str) -> Option<(Vec<u8>, String)> {
    if let Some(dir) = &shared.web_dir {
        let full = dir.join(path);
        if full.is_file() {
            if let Ok(bytes) = tokio::fs::read(&full).await {
                return Some((bytes, path.to_string()));
            }
        }
    }
    embedded_lookup(path).map(|bytes| (bytes.to_vec(), path.to_string()))
}

async fn web_handler(
    State(shared): State<Arc<Shared>>,
    method: Method,
    uri: Uri,
) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let raw = uri.path().trim_start_matches('/');
    let path = sanitize_path(raw);
    if path.starts_with("api/") {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    let mut candidates: Vec<String> = Vec::new();
    if path.is_empty() {
        candidates.push("index.html".to_string());
    } else {
        candidates.push(path.clone());
        if !path.contains('.') {
            candidates.push("index.html".to_string());
        }
    }
    for candidate in candidates {
        if let Some((bytes, resolved)) = load_asset(&shared, &candidate).await {
            let cache = if resolved.starts_with("assets/") {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            };
            let mut headers = HeaderMap::new();
            headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static(mime_for(&resolved)),
            );
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
            return (headers, bytes).into_response();
        }
    }
    (
        StatusCode::NOT_FOUND,
        "404 - 前端资源不存在（请先在 web/ 目录执行 npm run build 再重新编译 server）",
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async fn health(State(shared): State<Arc<Shared>>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "version": shared.version,
        "uptime_secs": shared.uptime_secs(),
        "running": shared.running.load(Ordering::Relaxed),
    }))
}

async fn get_state(State(shared): State<Arc<Shared>>) -> Json<Value> {
    let snapshot = shared.current_snapshot().await;
    Json(Shared::snapshot_value(&snapshot))
}

fn validate(req: &StartRequest) -> Result<(), String> {
    if !req.demo && req.steamid.trim().is_empty() {
        return Err("请填写 SteamID64（17 位数字），或勾选演示模式".to_string());
    }
    if req.currency <= 0 || req.currency > 100 {
        return Err("货币代码不合法".to_string());
    }
    if !(0.0..=0.9).contains(&req.fee) {
        return Err("手续费必须在 0 ~ 0.9 之间".to_string());
    }
    if req.limit < 0 {
        return Err("只查前 N 种不能是负数".to_string());
    }
    Ok(())
}

async fn start(
    State(shared): State<Arc<Shared>>,
    payload: Result<Json<StartRequest>, JsonRejection>,
) -> Response {
    let req = match payload {
        Ok(Json(req)) => req,
        Err(rejection) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(api_error(format!("请求参数不合法：{}", rejection.body_text()))),
            )
                .into_response();
        }
    };
    if let Err(message) = validate(&req) {
        return (StatusCode::BAD_REQUEST, Json(api_error(message))).into_response();
    }
    if shared
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return (StatusCode::CONFLICT, Json(api_error("已有任务在运行，请先停止或等待完成")))
            .into_response();
    }
    let cancel = Arc::new(CancelToken::new());
    *shared.cancel.lock().await = Some(cancel.clone());

    let mut snapshot = Snapshot::default();
    snapshot.state = "running".to_string();
    snapshot.demo = req.demo;
    snapshot.progress = Some(Progress::default());
    shared.set_snapshot(snapshot).await;

    let request = req.clone();
    let shared_for_job = shared.clone();
    tokio::spawn(async move {
        pipeline::run_job(shared_for_job, request, cancel).await;
    });
    Json(json!({ "ok": true })).into_response()
}

async fn cancel_job(State(shared): State<Arc<Shared>>) -> Json<Value> {
    let token = { shared.cancel.lock().await.clone() };
    match token {
        Some(token) => {
            token.cancel();
            Json(json!({ "ok": true, "cancelled": true }))
        }
        None => Json(json!({ "ok": true, "cancelled": false })),
    }
}

async fn events(
    State(shared): State<Arc<Shared>>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let initial = {
        let snapshot = shared.current_snapshot().await;
        Shared::snapshot_value(&snapshot).to_string()
    };
    let receiver = shared.tx.subscribe();
    let live = BroadcastStream::new(receiver).filter_map(|item| {
        item.ok()
            .map(|text| Ok::<_, Infallible>(Event::default().data(text)))
    });
    let init = tokio_stream::once(Ok::<_, Infallible>(Event::default().data(initial)));
    Sse::new(init.chain(live))
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("ping"))
}

async fn download(shared: Arc<Shared>, detail: bool) -> Response {
    let snapshot = shared.current_snapshot().await;
    let path = match snapshot.paths {
        Some(paths) => {
            if detail {
                paths.detail
            } else {
                paths.summary
            }
        }
        None => return (StatusCode::NOT_FOUND, "还没有生成 CSV 文件").into_response(),
    };
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::NOT_FOUND, "CSV 文件不存在").into_response(),
    };
    let filename = Path::new(&path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "steam_cards.csv".to_string());
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/csv; charset=utf-8"),
    );
    if let Ok(value) = HeaderValue::from_str(&format!(
        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
        filename,
        steam::url_encode(&filename)
    )) {
        headers.insert(header::CONTENT_DISPOSITION, value);
    }
    (headers, bytes).into_response()
}

async fn download_detail(State(shared): State<Arc<Shared>>) -> Response {
    download(shared, true).await
}

async fn download_summary(State(shared): State<Arc<Shared>>) -> Response {
    download(shared, false).await
}

fn open_dir(dir: &Path) -> std::io::Result<()> {
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

async fn open_folder(State(shared): State<Arc<Shared>>) -> Json<Value> {
    let snapshot = shared.current_snapshot().await;
    let dir = snapshot
        .paths
        .as_ref()
        .and_then(|paths| Path::new(&paths.detail).parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| shared.out_dir.clone());
    match open_dir(&dir) {
        Ok(()) => Json(json!({ "ok": true, "path": dir.to_string_lossy() })),
        Err(err) => Json(json!({ "ok": false, "error": err.to_string() })),
    }
}

fn build_router(shared: Arc<Shared>) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/state", get(get_state))
        .route("/api/start", post(start))
        .route("/api/cancel", post(cancel_job))
        .route("/api/events", get(events))
        .route("/api/download/detail", get(download_detail))
        .route("/api/download/summary", get(download_summary))
        .route("/api/open-folder", post(open_folder))
        .fallback(web_handler)
        .with_state(shared)
}

// ---------------------------------------------------------------------------
// 启动参数
// ---------------------------------------------------------------------------
struct Args {
    host: String,
    port: u16,
    no_open: bool,
    web_dir: Option<PathBuf>,
    out_dir: PathBuf,
    cache_path: PathBuf,
}

fn usage() -> &'static str {
    "用法：steamcards-server [选项]

选项：
  -p, --port <端口>       监听端口（默认 8787）
      --host <地址>       监听地址（默认 127.0.0.1）
      --no-open           启动后不自动打开浏览器
      --web-dir <目录>    从磁盘目录提供前端（默认使用编译期内嵌的 web/dist）
      --out-dir <目录>    CSV 输出目录（默认当前目录）
      --cache <文件>      价格缓存文件（默认 ~/.steamcards_cache.json）
  -h, --help              显示帮助
"
}

fn default_cache_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".steamcards_cache.json")
}

fn parse_args() -> Result<Args, String> {
    let mut args = Args {
        host: "127.0.0.1".to_string(),
        port: 8787,
        no_open: false,
        web_dir: None,
        out_dir: std::env::current_dir().map_err(|e| format!("无法获取当前目录：{}", e))?,
        cache_path: default_cache_path(),
    };
    let mut iter = std::env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "-p" | "--port" => {
                let value = iter.next().ok_or("--port 需要一个值")?;
                args.port = value.parse().map_err(|_| "端口必须是数字")?;
            }
            "--host" => {
                args.host = iter.next().ok_or("--host 需要一个值")?;
            }
            "--no-open" => args.no_open = true,
            "--web-dir" => {
                let value = iter.next().ok_or("--web-dir 需要一个目录")?;
                args.web_dir = Some(PathBuf::from(value));
            }
            "--out-dir" => {
                let value = iter.next().ok_or("--out-dir 需要一个目录")?;
                args.out_dir = PathBuf::from(value);
            }
            "--cache" => {
                let value = iter.next().ok_or("--cache 需要一个文件路径")?;
                args.cache_path = PathBuf::from(value);
            }
            "-h" | "--help" => {
                print!("{}", usage());
                std::process::exit(0);
            }
            other => return Err(format!("未知参数：{}", other)),
        }
    }
    args.out_dir = std::path::absolute(&args.out_dir).unwrap_or(args.out_dir.clone());
    if let Some(dir) = &args.web_dir {
        if !dir.is_dir() {
            return Err(format!("--web-dir 目录不存在：{}", dir.display()));
        }
    }
    Ok(args)
}

fn open_url(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

fn curl_available() -> bool {
    std::process::Command::new("curl")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[tokio::main]
async fn main() {
    let args = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            eprintln!("错误：{message}\n\n{}", usage());
            std::process::exit(1);
        }
    };
    if !curl_available() {
        eprintln!("⚠️  未找到 curl：查询价格与库存都会失败。Windows 10+ 自带，或安装后加入 PATH。");
    }
    let out_dir_display = args.out_dir.to_string_lossy().into_owned();
    let cache_display = args.cache_path.to_string_lossy().into_owned();
    let shared = Shared::new(
        args.out_dir.clone(),
        args.cache_path.clone(),
        args.web_dir.clone(),
    );
    let app = build_router(shared);
    let addr: SocketAddr = match format!("{}:{}", args.host, args.port).parse() {
        Ok(addr) => addr,
        Err(_) => {
            eprintln!("错误：监听地址不合法 {}:{}", args.host, args.port);
            std::process::exit(1);
        }
    };
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!(
                "错误：无法监听 {}（{}）。端口可能被占用，试试 --port 其它端口。",
                addr, err
            );
            std::process::exit(1);
        }
    };
    println!("╭──────────────────────────────────────────────╮");
    println!("│  Steam 卡牌估值 · Rust 轻量后端               │");
    println!("╰──────────────────────────────────────────────╯");
    println!("  地址     http://{}/", addr);
    println!("  输出目录 {}", out_dir_display);
    println!("  价格缓存 {}", cache_display);
    println!("  停止服务 按 Ctrl+C");
    println!();
    if !args.no_open {
        let url = format!("http://{}/", addr);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            open_url(&url);
        });
    }
    let server = axum::serve(listener, app);
    tokio::select! {
        result = server => {
            if let Err(err) = result {
                eprintln!("服务异常退出：{}", err);
            }
        }
        _ = tokio::signal::ctrl_c() => {
            println!("\n已停止。");
        }
    }
}