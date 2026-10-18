import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Calculator,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Layers,
  Search,
  ShoppingBag,
  Table2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ValuationController } from "../hooks/useValuation";
import {
  CURRENCIES,
  STATUS_META,
  STATUS_ORDER,
  dateTime,
  duration,
  integer,
  money,
  moneyCompact,
} from "../lib/format";
import type { HistoryFile, RowStatus } from "../types";
import { rowsToCsv, summaryToCsv, triggerDownload } from "../lib/csv";

const MAX_ROWS = 300;

interface ResultsViewProps {
  controller: ValuationController;
  historyView?: HistoryFile | null;
  onGoEstimate: () => void;
}

function StatusBadge({ status }: { status: RowStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.not_cached;
  return (
    <span className={`badge badge-${meta.tone}`} title={meta.description}>
      {meta.label}
    </span>
  );
}

function EmptyResults({
  onGoEstimate,
  cancelled,
}: {
  onGoEstimate: () => void;
  cancelled: boolean;
}) {
  return (
    <div className="page">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--accent)" }}
          >
            Valuation Result
          </div>
          <h1 className="mt-1 text-[24px] font-bold tracking-[-0.02em]" style={{ color: "var(--text)" }}>
            估值结果
          </h1>
        </div>
      </div>
      <section className="panel mt-5 flex flex-col items-center justify-center px-6 py-16 text-center">
        <span
          className="grid h-14 w-14 place-items-center rounded-2xl"
          style={{
            background: cancelled ? "var(--warn-soft)" : "var(--accent-soft)",
            color: cancelled ? "var(--warn)" : "var(--accent)",
          }}
        >
          {cancelled ? <AlertTriangle size={24} /> : <Table2 size={24} />}
        </span>
        <h2 className="mt-4 text-[16px] font-semibold" style={{ color: "var(--text)" }}>
          {cancelled ? "运行已取消" : "还没有估值结果"}
        </h2>
        <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {cancelled
            ? "本次运行在生成部分结果之前就被取消，没有可展示的数据。重新运行一次即可。"
            : "在「估值」页填写 SteamID 并开始运行，完成后会自动跳转到这里。也可以直接开启演示模式，用本地模拟数据预览完整流程。"}
        </p>
        <button type="button" className="btn btn-primary mt-5" onClick={onGoEstimate}>
          <Calculator size={15} />
          去估值
          <ArrowRight size={14} />
        </button>
      </section>
    </div>
  );
}

export default function ResultsView({ controller, historyView, onGoEstimate }: ResultsViewProps) {
  const summary = historyView?.summary ?? controller.summary;
  const rows = historyView?.rows ?? controller.rows;
  const state = historyView ? "done" : controller.state;
  const mock = historyView ? false : controller.mock;
  const historyMode = historyView != null;
  const [statusFilter, setStatusFilter] = useState<RowStatus | "all">("all");
  const [query, setQuery] = useState("");

  const currency = summary?.currency ?? CURRENCIES[0].label.split(" ")[0];

  const counts = useMemo(() => {
    const map: Partial<Record<RowStatus, number>> = {};
    for (const row of rows) map[row.status] = (map[row.status] ?? 0) + 1;
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        row.game.toLowerCase().includes(needle)
      );
    });
  }, [query, rows, statusFilter]);

  const visible = filtered.slice(0, MAX_ROWS);

  if (!summary) {
    return <EmptyResults onGoEstimate={onGoEstimate} cancelled={state === "cancelled"} />;
  }

  const feeAmount = Math.max(0, summary.gross - summary.net);
  const cancelled = summary.cancelled || state === "cancelled";
  // aborted_at: null = not aborted, >0 = number of card types queried when the
  // rate limiter circuit-break fired (backend contract).
  const abortedCount =
    typeof summary.aborted_at === "number" && summary.aborted_at > 0
      ? summary.aborted_at
      : null;
  const limited = abortedCount != null && !cancelled;
  const inventoryCached = summary.inventory_cached === true;
  const inventoryCacheAge = (() => {
    const seconds = summary.inventory_cache_age_secs ?? 0;
    if (seconds <= 0) return "一段时间";
    if (seconds < 3600) return Math.max(1, Math.round(seconds / 60)) + " 分钟";
    if (seconds < 86400) return Math.round(seconds / 3600) + " 小时";
    return Math.round(seconds / 86400) + " 天";
  })();

  const cards = [
    {
      key: "gross",
      label: "毛额",
      value: money(summary.gross, currency),
      sub: `${integer(summary.types)} 种 · ${integer(summary.copies)} 张`,
      Icon: Banknote,
      color: "var(--accent)",
      bg: "var(--accent-soft)",
    },
    {
      key: "net",
      label: "到手金额",
      value: money(summary.net, currency),
      sub: `扣除手续费 ${money(feeAmount, currency)}`,
      Icon: CheckCircle2,
      color: "var(--ok)",
      bg: "var(--ok-soft)",
    },
    {
      key: "types",
      label: "卡牌种数",
      value: integer(summary.types),
      sub: `覆盖 ${integer(summary.games)} 款游戏 · ${integer(summary.foil_types)} 种闪卡`,
      Icon: Layers,
      color: "var(--info)",
      bg: "var(--info-soft)",
    },
    {
      key: "sellable",
      label: "可售张数",
      value: integer(summary.sellable),
      sub: `${integer(summary.priced)} 种有价 · ${integer(summary.unpriced)} 种无价`,
      Icon: ShoppingBag,
      color: "var(--violet)",
      bg: "var(--violet-soft)",
    },
  ];

  return (
    <div className="page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--accent)" }}
          >
            Valuation Result
          </div>
          <h1 className="mt-1 flex flex-wrap items-center gap-2.5 text-[24px] font-bold tracking-[-0.02em]" style={{ color: "var(--text)" }}>
            估值结果
            {cancelled && <span className="badge badge-warn">已取消</span>}
            {limited && <span className="badge badge-danger">限流中止</span>}
            {historyMode && <span className="badge badge-info">历史结果</span>}
            {mock && <span className="badge badge-accent">演示数据</span>}
            {summary.offline && <span className="badge badge-info">离线</span>}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
            <span className="flex items-center gap-1">
              <span className="dot dot-live" />
              {summary.nickname || "未知用户"}
            </span>
            <span className="mono" style={{ color: "var(--text-tertiary)" }}>
              {summary.steamid64}
            </span>
            <span style={{ color: "var(--text-tertiary)" }}>生成于 {dateTime(summary.generated_at)}</span>
            <span style={{ color: "var(--text-tertiary)" }}>
              {summary.currency_label || CURRENCIES.find((c) => c.label.startsWith(String(currency)))?.label || currency}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (historyMode) {
                triggerDownload(`steam_cards_${summary.steamid64}.csv`, rowsToCsv(rows));
              } else {
                controller.download("detail");
              }
            }}
            disabled={rows.length === 0}
            title="下载卡牌明细 CSV"
          >
            <Download size={13} /> 下载明细 CSV
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (historyMode) {
                triggerDownload(
                  `steam_cards_${summary.steamid64}_summary.csv`,
                  summaryToCsv(summary),
                );
              } else {
                controller.download("summary");
              }
            }}
            title="下载汇总 CSV"
          >
            <FileSpreadsheet size={13} /> 下载汇总 CSV
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={controller.openFolder}
            disabled={historyMode || mock || controller.paths == null}
            title={historyMode ? "历史结果保存在用户目录，可用上方按钮导出 CSV" : mock ? "演示模式没有输出目录" : "打开输出目录"}
          >
            <FolderOpen size={13} /> 打开目录
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onGoEstimate}>
            <Calculator size={13} /> 新的估值
          </button>
        </div>
      </div>

      {cancelled && (
        <div
          className="panel fade-in mt-4 flex items-start gap-2.5 p-3.5"
          style={{
            borderColor: "color-mix(in srgb, var(--warn) 42%, var(--border))",
            background: "var(--warn-soft)",
          }}
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} />
          <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed">
            <div className="font-semibold" style={{ color: "var(--warn)" }}>运行已取消，以下是部分结果</div>
            <div style={{ color: "var(--text-secondary)" }}>
              已完成 {integer(summary.types)} 种卡牌的估值，取消时尚未处理的{" "}
              {integer(summary.cancelled_types)} 种卡牌已跳过。明细 CSV 中只包含已处理的记录。
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={onGoEstimate}>
            重新估值 <ArrowRight size={13} />
          </button>
        </div>
      )}

      {inventoryCached && (
        <div
          className="panel fade-in mt-4 flex items-start gap-2.5 p-3.5"
          style={{
            borderColor: "color-mix(in srgb, var(--warn) 42%, var(--border))",
            background: "var(--warn-soft)",
          }}
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} />
          <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed">
            <div className="font-semibold" style={{ color: "var(--warn)" }}>使用了本地库存缓存</div>
            <div style={{ color: "var(--text-secondary)" }}>
              库存接口当前受限，本次使用了 {inventoryCacheAge}前的库存快照（共 {integer(summary.types)} 种卡牌）。
              如果近期获得或出售过卡牌，结果可能不是最新；稍后重新估值即可刷新库存。
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={onGoEstimate}>
            重新估值 <ArrowRight size={13} />
          </button>
        </div>
      )}

      {limited && (
        <div
          className="panel fade-in mt-4 flex items-start gap-2.5 p-3.5"
          style={{
            borderColor: "color-mix(in srgb, var(--danger) 36%, var(--border))",
            background: "var(--danger-soft)",
          }}
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
          <div className="min-w-0 text-[11.5px] leading-relaxed">
            <div className="font-semibold" style={{ color: "var(--danger)" }}>Steam 市场限流，运行提前结束</div>
            <div style={{ color: "var(--text-secondary)" }}>
              已查询 {integer(abortedCount ?? 0)} 种卡牌后触发熔断，结果是中止前的部分数据，
              价格可能不完整。稍后重试或开启离线模式使用本地缓存。
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.Icon;
          return (
            <section key={card.key} className="panel fade-in p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
                  {card.label}
                </span>
                <span
                  className="grid h-7 w-7 place-items-center rounded-lg"
                  style={{ background: card.bg, color: card.color }}
                >
                  <Icon size={14} />
                </span>
              </div>
              <div className="tabular mt-2 truncate text-[21px] font-bold leading-tight tracking-[-0.01em]" style={{ color: "var(--text)" }} title={card.value}>
                {card.value}
              </div>
              <div className="mt-1 truncate text-[10.5px]" style={{ color: "var(--text-tertiary)" }}>
                {card.sub}
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="chip"><Download size={11} /> 查询请求 <b>{integer(summary.requests)}</b></span>
        <span className="chip chip-violet">缓存命中 <b>{integer(summary.cached)}</b></span>
        <span className="chip">运行用时 <b>{duration(summary.elapsed)}</b></span>
        <span className="chip">可售率 <b>{summary.types > 0 ? Math.round((summary.sellable / Math.max(1, summary.copies)) * 100) : 0}%</b></span>
        {summary.currency && <span className="chip">货币 <b>{currency}</b></span>}
      </div>

      <section className="panel mt-4 overflow-hidden">
        <header
          className="flex flex-wrap items-center gap-3 border-b p-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="grid h-7 w-7 place-items-center rounded-lg"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            >
              <Table2 size={14} />
            </span>
            <h2 className="text-[13.5px] font-semibold" style={{ color: "var(--text)" }}>
              卡牌明细
            </h2>
            <span className="badge badge-neutral">
              {integer(filtered.length)} / {integer(rows.length)}
            </span>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative shrink-0">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                style={{ color: "var(--text-tertiary)" }}
              />
              <input
                className="input search-input"
                placeholder="搜索卡牌 / 游戏…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="搜索卡牌或游戏"
              />
              {query && (
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded"
                  onClick={() => setQuery("")}
                  aria-label="清空搜索"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </header>

        <div
          className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            type="button"
            className="chip chip-button"
            data-active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          >
            全部 <b>{integer(rows.length)}</b>
          </button>
          {STATUS_ORDER.filter((status) => (counts[status] ?? 0) > 0).map((status) => {
            const meta = STATUS_META[status];
            return (
              <button
                key={status}
                type="button"
                className="chip chip-button"
                data-active={statusFilter === status}
                onClick={() => setStatusFilter(status)}
                title={meta.description}
              >
                {meta.label} <b>{integer(counts[status] ?? 0)}</b>
              </button>
            );
          })}
        </div>

        <div className="scroll-region max-h-[600px] overflow-auto">
          <table className="data-table min-w-[640px] w-full table-fixed">
            <colgroup>
              <col style={{ width: "32%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>卡牌</th>
                <th>游戏</th>
                <th className="num">数量</th>
                <th className="num">单价（{currency}）</th>
                <th className="num">总价（{currency}）</th>
                <th className="num">成交量</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="flex flex-col items-center gap-1 py-10 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                      <Search size={18} />
                      {rows.length === 0
                        ? "本次运行没有返回明细数据（可能来自状态快照）；重新运行一次即可查看完整明细。"
                        : "没有匹配的卡牌，试试调整筛选或搜索关键词。"}
                    </div>
                  </td>
                </tr>
              )}
              {visible.map((row, index) => (
                <tr key={`${row.hash}-${index}`}>
                  <td>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 max-w-[300px] truncate font-medium" style={{ color: "var(--text)" }} title={row.name}>
                        {row.name}
                      </span>
                      {row.foil && <span className="badge badge-warn h-[18px] px-1.5 text-[10px]">闪</span>}
                    </div>
                  </td>
                  <td>
                    <span className="block max-w-[150px] truncate" title={row.game}>
                      {row.game}
                    </span>
                  </td>
                  <td className="num tabular whitespace-nowrap">{integer(row.count)}</td>
                  <td className="num tabular whitespace-nowrap">{row.lowest == null ? "—" : moneyCompact(row.lowest, currency)}</td>
                  <td className="tabular whitespace-nowrap text-right" style={{ color: row.value > 0 ? "var(--text)" : "var(--text-tertiary)" }}>
                    {row.value > 0 ? moneyCompact(row.value, currency) : "—"}
                  </td>
                  <td className="num tabular whitespace-nowrap">{row.volume == null ? "—" : integer(row.volume)}</td>
                  <td className="whitespace-nowrap"><StatusBadge status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer
          className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-[11px]"
          style={{ borderColor: "var(--border)", color: "var(--text-tertiary)" }}
        >
          <span>
            {filtered.length > MAX_ROWS
              ? `为保持流畅，仅渲染前 ${MAX_ROWS} 行（当前筛选共 ${integer(filtered.length)} 行），使用搜索和状态筛选查看其余记录。`
              : `当前显示 ${integer(filtered.length)} 行`}
          </span>
          <span>下载的明细 CSV 包含全部 {integer(rows.length)} 行</span>
        </footer>
      </section>
    </div>
  );
}