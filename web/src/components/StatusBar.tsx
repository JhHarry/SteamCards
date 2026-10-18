import type { ConnectionStatus } from "../lib/api";
import { duration, integer } from "../lib/format";
import type { Progress, RunState, Summary } from "../types";

const CONNECTION_TEXT: Record<ConnectionStatus, string> = {
  connected: "后端已连接",
  connecting: "后端连接中",
  disconnected: "后端已断开 · 自动重连",
  mock: "本地模拟",
};

interface StatusBarProps {
  connection: ConnectionStatus;
  state: RunState;
  demo: boolean;
  progress: Progress | null;
  summary: Summary | null;
  mock: boolean;
}

function stateText(
  state: RunState,
  progress: Progress | null,
  summary: Summary | null,
): string {
  switch (state) {
    case "running": {
      const done = progress?.done ?? 0;
      const total = progress?.total ?? 0;
      return `估值中 · ${integer(done)}/${integer(total)} 种`;
    }
    case "done":
      return summary
        ? `已完成 · ${integer(summary.types)} 种 / ${integer(summary.copies)} 张 · 用时 ${duration(summary.elapsed)}`
        : "已完成";
    case "cancelled":
      return summary
        ? `已停止 · 保留 ${integer(summary.types)} 种部分结果`
        : "已停止";
    case "error":
      return "运行失败 · 请查看日志";
    default:
      return "就绪 · 等待开始估值";
  }
}

export default function StatusBar({
  connection,
  state,
  demo,
  progress,
  summary,
  mock,
}: StatusBarProps) {
  const dotClass =
    state === "running"
      ? "dot dot-running"
      : state === "error"
        ? "dot dot-danger"
        : connection === "connected"
          ? "dot dot-live"
          : mock
            ? "dot dot-warn"
            : connection === "disconnected"
              ? "dot dot-danger"
              : "dot";

  return (
    <footer className="statusbar">
      <span className="flex items-center gap-1.5">
        <span className={dotClass} />
        <span style={{ color: "var(--text-secondary)" }}>
          {stateText(state, progress, summary)}
        </span>
      </span>
      {demo && (
        <span className="badge badge-accent h-[18px] px-1.5 text-[10px]">
          演示数据
        </span>
      )}
      {summary?.offline && (
        <span className="badge badge-info h-[18px] px-1.5 text-[10px]">离线</span>
      )}

      <span className="ml-auto flex items-center gap-2.5">
        <span className="hidden items-center gap-1.5 sm:flex" title="Server-Sent Events 实时进度流">
          <span
            className={
              connection === "connected"
                ? "dot dot-live"
                : connection === "disconnected"
                  ? "dot dot-danger"
                  : mock
                    ? "dot dot-warn"
                    : "dot dot-running"
            }
          />
          {CONNECTION_TEXT[connection]}
        </span>      </span>
    </footer>
  );
}