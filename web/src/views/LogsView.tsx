import { ArrowDownToLine, ScrollText, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import LogLine from "../components/LogLine";
import type { ConnectionStatus } from "../lib/api";
import type { LogEntry, RunState } from "../types";

type LevelFilter = "all" | "info" | "warn" | "error" | "debug";

const LEVELS: Array<{ value: LevelFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "info", label: "信息" },
  { value: "warn", label: "警告" },
  { value: "error", label: "错误" },
  { value: "debug", label: "调试" },
];

interface LogsViewProps {
  logs: LogEntry[];
  onClear: () => void;
  state: RunState;
  connection: ConnectionStatus;
  mock: boolean;
}

export default function LogsView({ logs, onClear, state, connection, mock }: LogsViewProps) {
  const [level, setLevel] = useState<LevelFilter>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const counts = useMemo(() => {
    const map: Record<LevelFilter, number> = { all: logs.length, info: 0, warn: 0, error: 0, debug: 0 };
    for (const entry of logs) map[entry.level] += 1;
    return map;
  }, [logs]);

  const filtered = useMemo(
    () => (level === "all" ? logs : logs.filter((entry) => entry.level === level)),
    [level, logs],
  );

  useEffect(() => {
    if (!autoScroll) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [autoScroll, filtered.length, logs.length]);

  const runningHint =
    state === "running"
      ? "运行中，日志实时刷新"
      : state === "done"
        ? "运行已完成"
        : state === "cancelled"
          ? "运行已取消"
          : state === "error"
            ? "运行出错"
            : "等待开始估值";

  return (
    <div className="page flex h-full flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--accent)" }}
          >
            Runtime Log
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-[-0.02em]" style={{ color: "var(--text)" }}>
            运行日志
            <span className="badge badge-neutral">{counts.all} 条</span>
          </h1>
          <p className="mt-1 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
            {runningHint}
            {mock ? " · 演示模式（本地模拟）" : connection === "connected" ? " · 实时推送" : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="chip chip-button"
            data-active={autoScroll}
            onClick={() => setAutoScroll((value) => !value)}
            title="自动滚动到最新日志"
          >
            <ArrowDownToLine size={11} />
            自动滚动
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClear}
            disabled={logs.length === 0}
          >
            <Trash2 size={13} /> 清空日志
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {LEVELS.map((item) => (
          <button
            key={item.value}
            type="button"
            className="chip chip-button"
            data-active={level === item.value}
            onClick={() => setLevel(item.value)}
          >
            {item.label} <b>{counts[item.value]}</b>
          </button>
        ))}
      </div>

      <section
        className="panel mt-3 flex min-h-[360px] flex-1 flex-col overflow-hidden"
        style={{ height: "calc(100vh - 300px)" }}
      >
        <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
          <ScrollText size={13} style={{ color: "var(--text-tertiary)" }} />
          <span className="text-[11.5px] font-medium" style={{ color: "var(--text-secondary)" }}>
            {level === "all" ? "全部级别" : LEVELS.find((item) => item.value === level)?.label}
          </span>
          <span className="ml-auto text-[10.5px]" style={{ color: "var(--text-tertiary)" }}>
            {filtered.length} / {logs.length} 条
          </span>
        </div>
        <div ref={scrollRef} className="scroll-region flex-1 overflow-auto px-4 py-2">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
              <span
                className="grid h-12 w-12 place-items-center rounded-2xl"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                <ScrollText size={20} />
              </span>
              <div className="text-[12.5px] font-medium" style={{ color: "var(--text-secondary)" }}>
                还没有日志
              </div>
              <div className="max-w-sm text-[11px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                开始一次估值后，阶段切换、库存扫描、限流重试与完成信息都会实时显示在这里。
              </div>
            </div>
          ) : (
            filtered.map((entry) => <LogLine key={entry.id} entry={entry} />)
          )}
        </div>
      </section>
    </div>
  );
}
