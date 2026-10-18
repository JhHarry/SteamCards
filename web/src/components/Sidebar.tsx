import { useEffect, useMemo, useState } from "react";
import { Calculator, ChevronDown, CircleDot, History, ScrollText, Table2, Trash2, UserRound } from "lucide-react";
import type { HistoryEntry, RunState, Summary } from "../types";

export type AppView = "estimate" | "results" | "logs";

interface NavItem {
  view: AppView;
  label: string;
  icon: typeof Calculator;
  hint: string;
}

const NAV_ITEMS: NavItem[] = [
  { view: "estimate", label: "估值", icon: Calculator, hint: "输入 SteamID 开始估值" },
  { view: "results", label: "结果", icon: Table2, hint: "汇总与卡牌明细" },
  { view: "logs", label: "日志", icon: ScrollText, hint: "完整运行日志" },
];

interface SidebarProps {
  view: AppView;
  onNavigate: (view: AppView) => void;
  state: RunState;
  summary: Summary | null;
  logCount: number;
  mock: boolean;
  history: HistoryEntry[];
  onOpenHistory: (entry: HistoryEntry) => void;
  onDeleteHistory: (entry: HistoryEntry) => void;
  activeHistoryId: string | null;
}

function formatSavedAt(seconds: number): string {
  const date = new Date(seconds * 1000);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function Sidebar({
  view,
  onNavigate,
  state,
  summary,
  logCount,
  mock,
  history,
  onOpenHistory,
  onDeleteHistory,
  activeHistoryId,
}: SidebarProps) {
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { steamid64: string; nickname: string; entries: HistoryEntry[] }
    >();
    for (const entry of history) {
      const group = map.get(entry.steamid64) ?? {
        steamid64: entry.steamid64,
        nickname: "",
        entries: [],
      };
      if (!group.nickname && entry.nickname) group.nickname = entry.nickname;
      group.entries.push(entry);
      map.set(entry.steamid64, group);
    }
    const list = [...map.values()];
    for (const group of list) {
      group.entries.sort((a, b) => b.saved_at - a.saved_at);
    }
    list.sort((a, b) => (b.entries[0]?.saved_at ?? 0) - (a.entries[0]?.saved_at ?? 0));
    return list;
  }, [history]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (groups.length === 0) return;
    setExpanded((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return { [groups[0].steamid64]: true };
    });
  }, [groups]);
  return (
    <aside className="sidebar">
      <div
        className="px-4 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: "var(--text-tertiary)" }}
      >
        工作台
      </div>

      <nav className="flex flex-col gap-0.5 px-3" aria-label="主导航">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = view === item.view;
          const badge =
            item.view === "results" && summary
              ? summary.types
              : item.view === "logs" && logCount > 0
                ? logCount
                : null;
          return (
            <button
              key={item.view}
              type="button"
              className="nav-item"
              data-active={active}
              onClick={() => onNavigate(item.view)}
              title={item.hint}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={16} strokeWidth={2} />
              <span className="flex-1 text-left">{item.label}</span>
              {item.view === "estimate" && state === "running" && (
                <span className="dot dot-running" aria-label="运行中" />
              )}
              {badge != null && (
                <span
                  className="tabular rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: active ? "var(--accent-soft)" : "var(--active)",
                    color: active ? "var(--accent)" : "var(--text-tertiary)",
                  }}
                >
                  {badge > 999 ? "999+" : badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div
        className="mt-2 flex min-h-0 flex-1 flex-col border-t px-3 pb-1 pt-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div
          className="flex items-center gap-1.5 px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "var(--text-tertiary)" }}
        >
          <History size={11} /> 历史结果
        </div>
        <div className="scroll-region -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          {groups.length === 0 ? (
            <p className="px-1 py-1 text-[10.5px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
              估值完成后会自动保存在这里，按账号分组。
            </p>
          ) : (
            groups.map((group) => {
              const open = expanded[group.steamid64] ?? false;
              return (
                <div key={group.steamid64} className="mb-1">
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--active)]"
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [group.steamid64]: !prev[group.steamid64],
                      }))
                    }
                    title={group.nickname || group.steamid64}
                  >
                    <UserRound size={13} style={{ color: "var(--accent)" }} />
                    <span
                      className="min-w-0 flex-1 truncate text-[11.5px] font-semibold"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {group.nickname || group.steamid64}
                    </span>
                    <span className="mono text-[9.5px]" style={{ color: "var(--text-tertiary)" }}>
                      {group.entries.length}
                    </span>
                    <ChevronDown
                      size={12}
                      style={{
                        color: "var(--text-tertiary)",
                        transform: open ? "rotate(0deg)" : "rotate(-90deg)",
                        transition: "transform 0.15s ease",
                      }}
                    />
                  </button>
                  {open && (
                    <div
                      className="ml-2 flex flex-col gap-0.5 border-l pl-2"
                      style={{ borderColor: "var(--border)" }}
                    >
                      {group.entries.map((entry) => {
                        const active = activeHistoryId === entry.id;
                        return (
                          <div key={entry.id} className="group flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => onOpenHistory(entry)}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors"
                              style={{
                                background: "transparent",
                                color: "var(--text-tertiary)",
                              }}
                              title={entry.generated_at}
                              aria-current={active ? "true" : undefined}
                            >
                              <span className="mono shrink-0 text-[9.5px]">
                                {formatSavedAt(entry.saved_at)}
                              </span>
                              <span className="tabular ml-auto shrink-0 text-[10px] font-medium">
                                {entry.gross.toFixed(2)}
                              </span>
                            </button>
                            <button
                              type="button"
                              aria-label="删除历史结果"
                              title="删除这条历史记录"
                              onClick={(event) => {
                                event.stopPropagation();
                                onDeleteHistory(entry);
                              }}
                              className="grid h-5 w-5 shrink-0 place-items-center rounded opacity-60 transition-opacity hover:bg-[var(--active)] hover:opacity-100"
                              style={{ color: "var(--text-tertiary)" }}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {mock && (
        <div className="px-3 pb-2">
          <div
            className="rounded-xl border p-2.5"
            style={{
              borderColor: "var(--border)",
              background: "color-mix(in srgb, var(--panel-bg-strong) 55%, transparent)",
            }}
          >
            <div className="flex items-center gap-1.5">
              <CircleDot size={12} style={{ color: "var(--warn)" }} />
              <span className="text-[10.5px] font-semibold" style={{ color: "var(--warn)" }}>
                演示模式已开启
              </span>
            </div>
            <p
              className="mt-1 text-[10.5px] leading-relaxed"
              style={{ color: "var(--text-tertiary)" }}
            >
              使用内置 240 张假卡牌模拟完整估值流程，无需后端。
            </p>
          </div>
        </div>
      )}

    </aside>
  );
}