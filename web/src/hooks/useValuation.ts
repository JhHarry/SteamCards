import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CardRow,
  LogEntry,
  Paths,
  Progress,
  RetryInfo,
  RunState,
  ServerEvent,
  StartPayload,
  Summary,
} from "../types";
import {
  IS_MOCK,
  cancelRun,
  connectEvents,
  downloadCsv,
  fetchSnapshot,
  openOutputFolder,
  startRun,
  type ConnectionStatus,
} from "../lib/api";
import { createMockEngine, type MockEngine } from "../lib/mock";
import { rowsToCsv, summaryToCsv, triggerDownload } from "../lib/csv";

const MAX_LOGS = 1200;

export type ToastTone = "info" | "success" | "warn" | "error";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  title?: string;
}

export interface ValuationController {
  mock: boolean;
  connection: ConnectionStatus;
  state: RunState;
  demo: boolean;
  progress: Progress | null;
  summary: Summary | null;
  rows: CardRow[];
  paths: Paths | null;
  error: string | null;
  logs: LogEntry[];
  retry: RetryInfo | null;
  stageMessage: string | null;
  starting: boolean;
  cancelling: boolean;
  toasts: Toast[];
  start: (payload: StartPayload) => Promise<void>;
  cancel: () => void;
  dismissToast: (id: number) => void;
  pushToast: (message: string, tone?: ToastTone, title?: string) => void;
  dismissError: () => void;
  clearLogs: () => void;
  download: (kind: "detail" | "summary") => void;
  openFolder: () => void;
}

export function useValuation(): ValuationController {
  const [connection, setConnection] = useState<ConnectionStatus>(
    IS_MOCK ? "mock" : "connecting",
  );
  const [state, setState] = useState<RunState>("idle");
  const [demo, setDemo] = useState(IS_MOCK);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<CardRow[]>([]);
  const [paths, setPaths] = useState<Paths | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [retry, setRetry] = useState<RetryInfo | null>(null);
  const [stageMessage, setStageMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const logIdRef = useRef(0);
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef<number[]>([]);
  const retryTimerRef = useRef<number | null>(null);
  const mockRef = useRef<MockEngine | null>(null);

  const appendLog = useCallback(
    (level: LogEntry["level"], message: string, kind: LogEntry["kind"] = "log") => {
      logIdRef.current += 1;
      const entry: LogEntry = {
        id: logIdRef.current,
        ts: Date.now(),
        level,
        message,
        kind,
      };
      setLogs((prev) => {
        const next = prev.concat(entry);
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
      });
    },
    [],
  );

  const pushToast = useCallback(
    (message: string, tone: ToastTone = "info", title?: string) => {
      toastIdRef.current += 1;
      const id = toastIdRef.current;
      setToasts((prev) => {
        // 同一通知短时间内重复触发时只保留一条，避免点两次停止出现两条相同提示
        if (prev.some((toast) => toast.message === message && toast.title === title)) {
          return prev;
        }
        return [...prev.slice(-3), { id, message, tone, title }];
      });
      const timer = window.setTimeout(
        () => setToasts((prev) => prev.filter((toast) => toast.id !== id)),
        tone === "error" ? 9000 : 5200,
      );
      toastTimersRef.current.push(timer);
    },
    [],
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showRetry = useCallback((info: RetryInfo) => {
    setRetry(info);
    if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = window.setTimeout(
      () => {
        setRetry(null);
        retryTimerRef.current = null;
      },
      Math.max(2000, info.seconds * 1000 + 1500),
    );
  }, []);

  const handleEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.type) {
        case "snapshot": {
          setConnection((prev) => (prev === "mock" ? prev : "connected"));
          setState(event.state);
          setDemo(event.demo);
          setError(event.error);
          setProgress(event.progress);
          setSummary(event.summary);
          setPaths(event.paths);
          if (event.state === "running") {
            setStageMessage(
              event.progress && event.progress.total > 0
                ? "已恢复运行状态，等待进度事件…"
                : "运行已开始，等待进度事件…",
            );
          }
          break;
        }
        case "stage": {
          setStageMessage(event.message);
          appendLog("info", event.message, "stage");
          break;
        }
        case "log": {
          appendLog(event.level, event.message, "log");
          break;
        }
        case "inventory": {
          appendLog(
            "info",
            event.message ||
              `已读取库存第 ${event.page} 页：${event.items} 张（累计 ${event.total}）`,
            "inventory",
          );
          break;
        }
        case "retry": {
          showRetry({ message: event.message, seconds: event.seconds, at: Date.now() });
          appendLog(
            "warn",
            `${event.message}（${event.seconds}s 后重试）`,
            "retry",
          );
          break;
        }
        case "progress": {
          setState("running");
          setError(null);
          setProgress({
            done: event.done,
            total: event.total,
            elapsed: event.elapsed,
            eta: event.eta,
            rate: event.rate,
            gross: event.gross,
            hash: event.hash,
            name: event.name,
            game: event.game,
            status: event.status,
            stats: event.stats,
            requests: event.requests,
            cached: event.cached,
          });
          break;
        }
        case "done": {
          setSummary(event.summary);
          setRows(event.rows);
          setPaths(event.paths);
          setDemo(event.summary.demo);
          setState(event.summary.cancelled ? "cancelled" : "done");
          setStageMessage(null);
          setRetry(null);
          setProgress((prev) =>
            prev
              ? {
                  ...prev,
                  done: event.summary.types,
                  total: Math.max(prev.total, event.summary.types),
                  eta: 0,
                  rate: prev.rate,
                  gross: event.summary.gross,
                }
              : prev,
          );
          appendLog(
            event.summary.cancelled ? "warn" : "info",
            event.summary.cancelled
              ? `已停止：处理了 ${event.summary.types} 种卡牌，部分结果已生成`
              : `估值完成：${event.summary.types} 种卡牌，毛额 ${event.summary.gross.toFixed(2)} ${event.summary.currency}`,
            "system",
          );
          if (event.summary.cancelled) {
            pushToast("已停止估值，已保留部分结果", "warn", "运行已取消");
          }
          break;
        }
        case "error": {
          setState("error");
          setError(event.message);
          appendLog("error", event.message, "system");
          pushToast(event.message, "error", "运行失败");
          break;
        }
        default:
          break;
      }
    },
    [appendLog, pushToast, showRetry],
  );

  // SSE stream (real backend) — mock mode stays fully local.
  useEffect(() => {
    if (IS_MOCK) {
      setConnection("mock");
      setDemo(true);
      return;
    }
    let cancelled = false;
    const disconnect = connectEvents(handleEvent, (status) => {
      if (!cancelled) setConnection(status);
    });
    fetchSnapshot().then((snapshot) => {
      if (cancelled || !snapshot) return;
      handleEvent({ type: "snapshot", ...snapshot });
      setConnection((prev) => (prev === "connected" ? prev : "connected"));
    });
    return () => {
      cancelled = true;
      disconnect();
    };
  }, [handleEvent]);

  // Mock engine lifecycle.
  useEffect(() => {
    if (!IS_MOCK) return;
    const engine = createMockEngine(handleEvent);
    mockRef.current = engine;
    return () => {
      engine.dispose();
      if (mockRef.current === engine) mockRef.current = null;
    };
  }, [handleEvent]);

  useEffect(
    () => () => {
      toastTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (state !== "running") setCancelling(false);
  }, [state]);

  const start = useCallback(
    async (payload: StartPayload) => {
      setStarting(true);
      setError(null);
      setRows([]);
      setSummary(null);
      setPaths(null);
      setProgress(null);
      setRetry(null);
      setStageMessage(null);
      setLogs([]);
      setState("idle");
      setDemo(payload.demo || IS_MOCK);
      try {
        if (IS_MOCK) {
          const engine = mockRef.current ?? createMockEngine(handleEvent);
          mockRef.current = engine;
          engine.start(payload);
          setConnection("mock");
          return;
        }
        const result = await startRun(payload);
        if (!result.ok) {
          const message = result.error ?? "启动失败";
          setState("error");
          setError(message);
          pushToast(message, "error", "无法开始估值");
          return;
        }
        appendLog("info", "已发送启动请求，等待后端事件…", "system");
      } finally {
        setStarting(false);
      }
    },
    [appendLog, handleEvent, pushToast],
  );

  const cancel = useCallback(() => {
    setCancelling(true);
    if (IS_MOCK) {
      mockRef.current?.cancel();
      return;
    }
    const watchdog = window.setTimeout(() => setCancelling(false), 12000);
    void cancelRun()
      .then((result) => {
        if (!result.ok) {
          pushToast(result.error ?? "停止失败", "error");
          setCancelling(false);
        } else {
          appendLog("warn", "已发送停止请求", "system");
        }
      })
      .finally(() => window.clearTimeout(watchdog));
  }, [appendLog, pushToast]);

  const download = useCallback(
    (kind: "detail" | "summary") => {
      if (IS_MOCK) {
        if (kind === "detail") {
          if (rows.length === 0) {
            pushToast("还没有可下载的明细", "warn");
            return;
          }
          triggerDownload("steam_cards_demo.csv", rowsToCsv(rows));
        } else {
          if (!summary) {
            pushToast("还没有可下载的汇总", "warn");
            return;
          }
          triggerDownload(
            "steam_cards_demo_summary.csv",
            summaryToCsv(summary),
          );
        }
        pushToast("演示模式：已生成模拟 CSV 文件", "info");
        return;
      }
      downloadCsv(kind);
    },
    [pushToast, rows, summary],
  );

  const openFolder = useCallback(() => {
    if (IS_MOCK) {
      pushToast("演示模式没有输出目录，CSV 由浏览器直接生成", "info");
      return;
    }
    void openOutputFolder().then((result) => {
      if (!result.ok) pushToast(result.error ?? "打开输出目录失败", "error");
    });
  }, [pushToast]);

  const dismissError = useCallback(() => setError(null), []);
  const clearLogs = useCallback(() => setLogs([]), []);

  return {
    mock: IS_MOCK,
    connection,
    state,
    demo,
    progress,
    summary,
    rows,
    paths,
    error,
    logs,
    retry,
    stageMessage,
    starting,
    cancelling,
    toasts,
    start,
    cancel,
    dismissToast,
    pushToast,
    dismissError,
    clearLogs,
    download,
    openFolder,
  };
}