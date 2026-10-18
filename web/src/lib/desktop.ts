//! Tauri 桌面壳桥接层：桌面应用内用 invoke / listen，浏览器里用 fetch / SSE。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HistoryEntry, HistoryFile, ServerEvent } from "../types";

export const IS_DESKTOP =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Result = { ok: boolean; error?: string };
type ConnectionListener = (status: "connecting" | "connected" | "disconnected") => void;

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "操作失败";
}

export async function desktopState(): Promise<unknown> {
  return invoke("api_state");
}

export async function desktopStart(payload: unknown): Promise<Result> {
  try {
    await invoke("start_valuation", { request: payload });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export async function desktopCancel(): Promise<Result> {
  try {
    await invoke("cancel_valuation");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export async function desktopOpenFolder(): Promise<Result> {
  try {
    await invoke("open_folder");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export async function desktopSaveCsv(kind: "detail" | "summary"): Promise<void> {
  await invoke("save_csv", { kind });
}

export function desktopWindow(
  action: "minimize" | "maximize" | "close" | "drag",
): void {
  const command = action === "maximize" ? "win_toggle_maximize" : "win_" + action;
  void invoke(command).catch(() => {
    /* 窗口命令失败不影响业务 */
  });
}

/** 订阅 Rust 侧通过 Tauri 事件桥发来的事件（等价于浏览器的 SSE）。 */
export function desktopSubscribe(
  onEvent: (event: ServerEvent) => void,
  onStatus: ConnectionListener,
): () => void {
  onStatus("connecting");
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void listen<ServerEvent>("steamcards-event", (event) => {
    if (!disposed) onEvent(event.payload);
  })
    .then((fn) => {
      unlisten = fn;
      if (disposed) fn();
      else onStatus("connected");
    })
    .catch(() => {
      if (!disposed) onStatus("disconnected");
    });
  return () => {
    disposed = true;
    unlisten?.();
  };
}
export async function desktopHistoryList(): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("history_list");
}

export async function desktopHistoryLoad(id: string): Promise<HistoryFile> {
  return invoke<HistoryFile>("history_load", { id });
}

export async function desktopHistoryDelete(id: string): Promise<void> {
  await invoke("history_delete", { id });
}
