import { Minus, Square, X } from "lucide-react";
import { backendLabel, type ConnectionStatus } from "../lib/api";
import { IS_DESKTOP, desktopWindow } from "../lib/desktop";
import type { Theme } from "../lib/theme";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

const CONNECTION_META: Record<
  ConnectionStatus,
  { label: string; color: string; dot: string }
> = {
  connected: { label: "后端已连接", color: "var(--ok)", dot: "dot dot-live" },
  connecting: { label: "连接中", color: "var(--text-secondary)", dot: "dot dot-running" },
  disconnected: { label: "后端未连接", color: "var(--danger)", dot: "dot dot-danger" },
  mock: { label: "演示模式", color: "var(--warn)", dot: "dot dot-warn" },
};

interface TitleBarProps {
  connection: ConnectionStatus;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

export default function TitleBar({ connection, theme, onThemeChange }: TitleBarProps) {
  const meta = CONNECTION_META[connection];
  const desktopConnected = IS_DESKTOP && connection === "connected";
  const label = desktopConnected ? "本地运行中" : meta.label;
  const hint =
    connection === "mock"
      ? "URL 带 ?mock=1：前端本地模拟数据，无需后端"
      : connection === "connected"
        ? IS_DESKTOP
          ? "独立桌面应用 · 数据全部在本机处理"
          : "后端地址 " + backendLabel()
        : "正在尝试连接 " + backendLabel() + "…";

  const handleDoubleClick = () => {
    if (IS_DESKTOP) desktopWindow("maximize");
  };

  return (
    <header
      className="titlebar"
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
      style={IS_DESKTOP ? { paddingRight: 0 } : undefined}
    >
      <div className="flex min-w-0 items-center gap-2.5" data-tauri-drag-region>
        <Logo size={26} />
        <div className="flex min-w-0 items-baseline gap-2" data-tauri-drag-region>
          <span
            className="truncate text-[13.5px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--text)" }}
            data-tauri-drag-region
          >
            Steam 卡牌估值
          </span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2.5" data-tauri-drag-region style={IS_DESKTOP ? { paddingRight: 8 } : undefined}>
        <div
          className="hidden items-center gap-2 rounded-lg border px-2.5 py-1 md:flex"
          title={hint}
          style={{
            borderColor: "var(--border)",
            background: "color-mix(in srgb, var(--panel-bg-strong) 62%, transparent)",
          }}
        >
          <span className={meta.dot} />
          <span
            className="text-[11.5px] font-medium leading-none"
            style={{ color: meta.color }}
          >
            {label}
          </span>
        </div>
        <ThemeToggle theme={theme} onChange={onThemeChange} />
      </div>

      {IS_DESKTOP && (
        <div className="win-controls no-drag">
          <button
            type="button"
            className="win-btn"
            title="最小化"
            aria-label="最小化"
            onClick={() => desktopWindow("minimize")}
          >
            <Minus size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="win-btn"
            title="最大化 / 还原"
            aria-label="最大化"
            onClick={() => desktopWindow("maximize")}
          >
            <Square size={11} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="win-btn win-btn-close"
            title="关闭"
            aria-label="关闭"
            onClick={() => desktopWindow("close")}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>
      )}
    </header>
  );
}