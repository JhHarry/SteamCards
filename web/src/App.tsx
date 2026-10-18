import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar, { type AppView } from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import TitleBar from "./components/TitleBar";
import ToastStack from "./components/Toast";
import Wallpaper from "./components/Wallpaper";
import { useValuation } from "./hooks/useValuation";
import {
  DEFAULT_FORM,
  toStartPayload,
  type EstimateForm,
} from "./lib/form";
import { IS_DESKTOP } from "./lib/desktop";
import { historyDelete, historyList, historyLoad } from "./lib/api";
import type { HistoryEntry, HistoryFile } from "./types";
import { useTheme } from "./lib/theme";
import EstimateView from "./views/EstimateView";
import LogsView from "./views/LogsView";
import ResultsView from "./views/ResultsView";

const VALID_VIEWS: AppView[] = ["estimate", "results", "logs"];

function initialView(): AppView {
  const requested = new URLSearchParams(window.location.search).get("view");
  return VALID_VIEWS.includes(requested as AppView)
    ? (requested as AppView)
    : "estimate";
}

export default function App() {
  const controller = useValuation();
  const { theme, setTheme } = useTheme();
  const [view, setView] = useState<AppView>(initialView);
  const [form, setForm] = useState<EstimateForm>(DEFAULT_FORM);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyView, setHistoryView] = useState<HistoryFile | null>(null);
  const previousState = useRef(controller.state);
  const autoStarted = useRef(false);
  const { start, cancel } = controller;

  const updateForm = useCallback((patch: Partial<EstimateForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const refreshHistory = useCallback(() => {
    void historyList().then(setHistory);
  }, []);

  // 启动时加载历史结果；每次运行完成/取消后再刷新一次（后端在返回前已写入历史）。
  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (controller.state === "done" || controller.state === "cancelled") {
      refreshHistory();
    }
    if (controller.state === "running") {
      setHistoryView(null);
    }
  }, [controller.state, controller.summary?.generated_at, refreshHistory]);

  const openHistory = useCallback(async (entry: HistoryEntry) => {
    const file = await historyLoad(entry.id);
    if (!file) {
      controller.pushToast("读取历史结果失败", "error", "历史结果");
      return;
    }
    setHistoryView(file);
    setView("results");
  }, [controller]);

  const deleteHistory = useCallback(async (entry: HistoryEntry) => {
    if (!window.confirm(`删除「${entry.nickname || entry.steamid64}」这条历史结果？`)) {
      return;
    }
    try {
      await historyDelete(entry.id);
    } catch {
      controller.pushToast("删除历史结果失败", "error", "历史结果");
      return;
    }
    setHistoryView((prev) => (prev?.entry.id === entry.id ? null : prev));
    refreshHistory();
  }, [controller, refreshHistory]);

  const navigate = useCallback((next: AppView) => {
    setHistoryView(null);
    setView(next);
  }, []);

  // Jump to results as soon as a run finishes (done or cancelled).
  useEffect(() => {
    const previous = previousState.current;
    if (previous === "running" && (controller.state === "done" || controller.state === "cancelled")) {
      setHistoryView(null);
      setView("results");
    }
    previousState.current = controller.state;
  }, [controller.state]);

  // 桌面窗口拖拽缩放时临时关闭毛玻璃/动画，避免 WebView2 合成器在 resize 后花屏或空白。
  useEffect(() => {
    if (!IS_DESKTOP) return;
    let timer: number | undefined;
    const onResize = () => {
      document.documentElement.classList.add("is-resizing");
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        document.documentElement.classList.remove("is-resizing");
        // 强制一次布局，确保 resize 结束后 content 立即重绘
        void document.body.offsetHeight;
      }, 220);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timer != null) window.clearTimeout(timer);
      document.documentElement.classList.remove("is-resizing");
    };
  }, []);

  // Convenience for headless screenshots / demos:
  // ?mock=1&autostart=1  → local simulation
  // ?autostart=1         → POST /api/start with a demo run on the backend
  useEffect(() => {
    if (autoStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("autostart") !== "1") return;
    autoStarted.current = true;
    const payload = { ...toStartPayload({ ...DEFAULT_FORM, demo: true }), demo: true };
    const timer = window.setTimeout(() => {
      void start(payload);
    }, 350);
    // Verification helper: ?cancelAfter=<ms> stops the mock run early.
    const cancelAfter = Number(params.get("cancelAfter"));
    const cancelTimer =
      Number.isFinite(cancelAfter) && cancelAfter > 0
        ? window.setTimeout(() => cancel(), cancelAfter)
        : null;
    return () => {
      window.clearTimeout(timer);
      if (cancelTimer != null) window.clearTimeout(cancelTimer);
    };
  }, [start, cancel]);

  return (
    <>
      <div className="app-shell">
      <Wallpaper />
      <TitleBar connection={controller.connection} theme={theme} onThemeChange={setTheme} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          view={view}
          onNavigate={navigate}
          state={controller.state}
          summary={controller.summary}
          logCount={controller.logs.length}
          mock={controller.mock}
          history={history}
          onOpenHistory={(entry) => void openHistory(entry)}
          onDeleteHistory={(entry) => void deleteHistory(entry)}
          activeHistoryId={historyView?.entry.id ?? null}
        />

        <main className="app-main scroll-region" aria-label="主内容区">
          {view === "estimate" && (
            <EstimateView
              controller={controller}
              form={form}
              onFormChange={updateForm}
              onViewResults={() => setView("results")}
            />
          )}
          {view === "results" && (
            <ResultsView
              controller={controller}
              historyView={historyView}
              onGoEstimate={() => navigate("estimate")}
            />
          )}
          {view === "logs" && (
            <LogsView
              logs={controller.logs}
              onClear={controller.clearLogs}
              state={controller.state}
              connection={controller.connection}
              mock={controller.mock}
            />
          )}
        </main>
      </div>

      <StatusBar
        connection={controller.connection}
        state={controller.state}
        demo={controller.demo}
        progress={controller.progress}
        summary={controller.summary}
        mock={controller.mock}
      />

      </div>

      <ToastStack toasts={controller.toasts} onDismiss={controller.dismissToast} />
    </>
  );
}