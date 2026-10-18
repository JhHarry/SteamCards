//! 共享状态：快照、SSE 广播、任务取消令牌。
use crate::model::{Progress, Snapshot};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{broadcast, Mutex, Notify, RwLock};

pub struct CancelToken {
    flag: AtomicBool,
    notify: Notify,
}

impl CancelToken {
    pub fn new() -> Self {
        CancelToken {
            flag: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_one();
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    /// 等待取消（若已取消则立即返回）。
    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.notify.notified().await;
    }
}

pub struct Shared {
    pub snapshot: RwLock<Snapshot>,
    pub tx: broadcast::Sender<String>,
    pub cancel: Mutex<Option<Arc<CancelToken>>>,
    pub running: AtomicBool,
    pub out_dir: PathBuf,
    pub cache_path: PathBuf,
    pub version: String,
    pub started: Instant,
    pub web_dir: Option<PathBuf>,
}

impl Shared {
    pub fn new(
        out_dir: PathBuf,
        cache_path: PathBuf,
        web_dir: Option<PathBuf>,
    ) -> Arc<Shared> {
        let (tx, _rx) = broadcast::channel(2048);
        Arc::new(Shared {
            snapshot: RwLock::new(Snapshot::default()),
            tx,
            cancel: Mutex::new(None),
            running: AtomicBool::new(false),
            out_dir,
            cache_path,
            version: env!("CARGO_PKG_VERSION").to_string(),
            started: Instant::now(),
            web_dir,
        })
    }

    pub fn emit(&self, value: &Value) {
        let _ = self.tx.send(value.to_string());
    }

    pub fn snapshot_value(snap: &Snapshot) -> Value {
        let mut value = serde_json::to_value(snap).unwrap_or_else(|_| json!({}));
        if let Value::Object(ref mut map) = value {
            map.insert("type".to_string(), json!("snapshot"));
        }
        value
    }

    /// 更新快照，并把 snapshot 事件广播给所有已连接的浏览器。
    pub async fn set_snapshot(&self, snap: Snapshot) {
        let value = Shared::snapshot_value(&snap);
        {
            let mut guard = self.snapshot.write().await;
            *guard = snap;
        }
        self.emit(&value);
    }

    pub async fn current_snapshot(&self) -> Snapshot {
        self.snapshot.read().await.clone()
    }

    pub fn uptime_secs(&self) -> u64 {
        self.started.elapsed().as_secs()
    }
}

pub type EventSink = Arc<dyn Fn(Value) + Send + Sync>;

impl Shared {
    pub fn sink(&self) -> EventSink {
        let tx = self.tx.clone();
        Arc::new(move |value: Value| {
            let _ = tx.send(value.to_string());
        })
    }
}

impl Shared {
    /// 静默更新快照里的进度（不额外广播，progress 事件本身会广播）。
    pub async fn store_progress(&self, progress: &Progress) {
        let mut guard = self.snapshot.write().await;
        guard.state = "running".to_string();
        guard.progress = Some(progress.clone());
    }
}
