import type { HistoryEntry, HistoryFile, ServerEvent, Snapshot, StartPayload } from "../types";
import {
  IS_DESKTOP,
  desktopCancel,
  desktopHistoryDelete,
  desktopHistoryList,
  desktopHistoryLoad,
  desktopOpenFolder,
  desktopSaveCsv,
  desktopStart,
  desktopState,
  desktopSubscribe,
} from "./desktop";

export const IS_MOCK =
  new URLSearchParams(window.location.search).get("mock") === "1" ||
  import.meta.env.VITE_MOCK === "1";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "mock";

export function backendLabel(): string {
  if (IS_DESKTOP) return "本地桌面应用";
  const { hostname, port, host } = window.location;
  // Vite dev / preview servers proxy /api to the Rust backend on 8787.
  if (port === "5173" || port === "4173" || port === "4174") {
    return `${hostname || "127.0.0.1"}:8787`;
  }
  return host || "127.0.0.1:8787";
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export async function fetchSnapshot(): Promise<Snapshot | null> {
  if (IS_DESKTOP) {
    try {
      return (await desktopState()) as Snapshot;
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch("/api/state", {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Snapshot;
  } catch {
    return null;
  }
}

export interface StartResult {
  ok: boolean;
  error?: string;
}

export async function startRun(payload: StartPayload): Promise<StartResult> {
  if (IS_DESKTOP) return desktopStart(payload);
  try {
    const res = await fetch("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: errorMessage(data, `启动失败（HTTP ${res.status}）`) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `无法连接后端：${(error as Error).message}` };
  }
}

export async function cancelRun(): Promise<StartResult> {
  if (IS_DESKTOP) return desktopCancel();
  try {
    const res = await fetch("/api/cancel", { method: "POST" });
    const data = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: errorMessage(data, `停止失败（HTTP ${res.status}）`) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `无法连接后端：${(error as Error).message}` };
  }
}

export async function openOutputFolder(): Promise<StartResult> {
  if (IS_DESKTOP) return desktopOpenFolder();
  try {
    const res = await fetch("/api/open-folder", { method: "POST" });
    const data = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: errorMessage(data, `打开目录失败（HTTP ${res.status}）`) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `无法连接后端：${(error as Error).message}` };
  }
}

export function downloadCsv(kind: "detail" | "summary", filename?: string): void {
  if (IS_DESKTOP) {
    void desktopSaveCsv(kind).catch((error) => {
      console.error("保存 CSV 失败", error);
    });
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = `/api/download/${kind}`;
  anchor.download = filename ?? (kind === "detail" ? "steam_cards.csv" : "steam_cards_summary.csv");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Subscribe to /api/events with explicit reconnect handling.
 * Returns a disposer that stops the stream and any pending retry.
 */
export function connectEvents(
  onEvent: (event: ServerEvent) => void,
  onStatus: (status: ConnectionStatus) => void,
): () => void {
  if (IS_DESKTOP) return desktopSubscribe(onEvent, onStatus);
  let source: EventSource | null = null;
  let retryTimer: number | null = null;
  let attempt = 0;
  let disposed = false;

  const scheduleReconnect = () => {
    if (disposed || retryTimer != null) return;
    const delay = Math.min(10000, 1000 * 2 ** Math.min(attempt, 4));
    attempt += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      open();
    }, delay);
  };

  const open = () => {
    if (disposed) return;
    if (attempt > 0) onStatus("connecting");
    let next: EventSource;
    try {
      next = new EventSource("/api/events");
    } catch {
      onStatus("disconnected");
      scheduleReconnect();
      return;
    }
    source = next;
    next.onopen = () => {
      attempt = 0;
      onStatus("connected");
    };
    next.onmessage = (message: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(message.data) as ServerEvent;
        if (parsed && typeof parsed === "object" && "type" in parsed) onEvent(parsed);
      } catch {
        /* ignore malformed frames */
      }
    };
    next.onerror = () => {
      onStatus("disconnected");
      next.close();
      if (source === next) source = null;
      scheduleReconnect();
    };
  };

  open();

  return () => {
    disposed = true;
    if (retryTimer != null) window.clearTimeout(retryTimer);
    source?.close();
    source = null;
  };
}
/** 历史结果（仅桌面版；浏览器模式返回空列表）。 */
export async function historyList(): Promise<HistoryEntry[]> {
  if (!IS_DESKTOP) return [];
  try {
    return await desktopHistoryList();
  } catch {
    return [];
  }
}

export async function historyLoad(id: string): Promise<HistoryFile | null> {
  if (!IS_DESKTOP) return null;
  try {
    return await desktopHistoryLoad(id);
  } catch {
    return null;
  }
}

export async function historyDelete(id: string): Promise<void> {
  if (!IS_DESKTOP) return;
  await desktopHistoryDelete(id);
}
