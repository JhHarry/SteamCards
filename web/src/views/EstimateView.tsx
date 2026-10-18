import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coins,
  Database,
  Layers,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Terminal,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { ValuationController } from "../hooks/useValuation";
import { backendLabel } from "../lib/api";
import { IS_DESKTOP } from "../lib/desktop";
import {
  CURRENCIES,
  duration,
  integer,
  money,
  rateLabel,
} from "../lib/format";
import {
  normalizeSteamId,
  toStartPayload,
  validateForm,
  type EstimateForm,
} from "../lib/form";
import type { LogEntry } from "../types";
import LogLine from "../components/LogLine";
import Logo from "../components/Logo";

interface EstimateViewProps {
  controller: ValuationController;
  form: EstimateForm;
  onFormChange: (patch: Partial<EstimateForm>) => void;
  onViewResults: () => void;
}

interface ToggleRowProps {
  icon: LucideIcon;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  disabled,
  onChange,
}: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        borderColor: "var(--border)",
        background: "transparent",
      }}
    >
      <Icon
        size={14}
        strokeWidth={2}
        style={{ color: checked ? "var(--accent)" : "var(--text-tertiary)" }}
      />
      <span className="min-w-0 flex-1">
        <span
          className="block text-[12px] font-medium leading-tight"
          style={{ color: "var(--text)" }}
        >
          {label}
        </span>
        <span
          className="mt-0.5 block truncate text-[10.5px] leading-tight"
          style={{ color: "var(--text-tertiary)" }}
        >
          {description}
        </span>
      </span>
      <span className="switch" data-on={checked} aria-hidden="true" />
    </button>
  );
}

function HeroCard() {
  return (
    <section className="panel relative overflow-hidden">
      <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative flex items-center justify-between gap-6 p-5">
        <div className="min-w-0">
          <div
            className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--accent)" }}
          >
            <span className="h-px w-6" style={{ background: "var(--accent)" }} />
            Steam Card Valuer
          </div>
          <h1
            className="mt-2 text-[22px] font-bold leading-[1.2] tracking-[-0.02em]"
            style={{ color: "var(--text)" }}
          >
            Steam 库存卡牌
            <span className="text-gradient-accent">资产估值</span>
          </h1>
          <p
            className="mt-2 max-w-xl text-[12.5px] leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            扫描库存里的集换式卡牌，按市场最低价估值并导出 CSV。支持 10 种货币、本地缓存与限流自动切源。
          </p>
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            <span className="chip">
              <Coins size={11} /> 10 种货币
            </span>
            <span className="chip">
              <ShieldCheck size={11} /> 限流自动切源
            </span>
            <span className="chip">
              <Database size={11} /> 价格缓存
            </span>
            <span className="chip">
              <Terminal size={11} /> 实时进度
            </span>
          </div>
        </div>
                <div className="relative hidden shrink-0 lg:grid place-items-center" aria-hidden="true">
          <Logo size={96} />
        </div>
      </div>
    </section>
  );
}

function ProgressCard({ controller }: { controller: ValuationController }) {
  const { progress, state, stageMessage, retry, logs } = controller;
  const running = state === "running";
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const stats = progress?.stats;
  const formCurrency = CURRENCIES[0].label.split(" ")[0];
  const recent = logs.slice(-8);

  const heading = running
    ? "估值进行中"
    : state === "done"
      ? "估值完成"
      : state === "cancelled"
        ? "已停止 · 部分结果"
        : "正在启动…";
  const headingColor = running
    ? "var(--accent)"
    : state === "cancelled"
      ? "var(--warn)"
      : "var(--ok)";

  return (
    <section className="panel fade-in p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 place-items-center rounded-xl"
            style={{
              background: running ? "var(--accent-soft)" : "var(--ok-soft)",
              color: headingColor,
            }}
          >
            {running ? (
              <Loader2 size={16} className="spin" />
            ) : state === "cancelled" ? (
              <AlertTriangle size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
          </span>
          <div>
            <div className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>
              {heading}
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
              {stageMessage ?? (running ? "等待进度事件…" : "准备中…")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="chip">
            <Clock3 size={11} /> 已用 <b>{duration(progress?.elapsed)}</b>
          </span>
          <span className="chip">
            <RefreshCw size={11} /> 剩余 <b>{duration(progress?.eta)}</b>
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="flex items-end gap-2.5">
          <span
            className="tabular text-[38px] font-bold leading-none tracking-[-0.02em]"
            style={{ color: "var(--text)" }}
          >
            {Math.round(pct)}
            <span className="ml-0.5 text-[17px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              %
            </span>
          </span>
          <span className="mb-1 text-[11.5px]" style={{ color: "var(--text-tertiary)" }}>
            已完成 <b className="tabular" style={{ color: "var(--text-secondary)" }}>{integer(done)}</b> /{" "}
            {integer(total)} 种
          </span>
        </div>
        <div className="text-right text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          <div>
            速度{" "}
            <b className="tabular" style={{ color: "var(--text-secondary)" }}>
              {rateLabel(progress?.rate)}
            </b>
          </div>
          <div className="mt-0.5">
            毛额{" "}
            <b className="tabular" style={{ color: "var(--text-secondary)" }}>
              {progress ? money(progress.gross, formCurrency) : "—"}
            </b>
          </div>
        </div>
      </div>

      <div
        className={`progress-track mt-3 ${!progress || total === 0 ? "progress-indeterminate" : ""}`}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="估值进度"
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div
        className="mt-3 flex items-center gap-2 rounded-xl border px-3 py-2"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--main-bg) 48%, transparent)" }}
      >
        <span className="dot dot-running" />
        <span className="shrink-0 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {running ? "正在查询" : "最后处理"}
        </span>
        <span
          className="truncate text-[12px] font-medium"
          style={{ color: "var(--text)" }}
        >
          {progress?.name || "等待第一张卡牌…"}
        </span>
        {progress?.game && (
          <span className="badge badge-neutral ml-auto shrink-0">{progress.game}</span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "已用时间", value: duration(progress?.elapsed) },
          { label: "预计剩余", value: duration(progress?.eta) },
          { label: "查询速度", value: rateLabel(progress?.rate) },
          { label: "当前毛额", value: progress ? money(progress.gross, formCurrency) : "—" },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl border px-2.5 py-2"
            style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel-bg-strong) 45%, transparent)" }}
          >
            <div className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>
              {item.label}
            </div>
            <div className="tabular mt-0.5 truncate text-[12.5px] font-semibold" style={{ color: "var(--text)" }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="chip chip-ok" title="市场有挂单、已按最低价计入毛额">
          有价 <b>{integer(stats?.ok ?? 0)}</b>
        </span>
        <span className="chip chip-warn" title="卡牌可交易，但市场当前没有挂单">
          无挂单 <b>{integer(stats?.no_listing ?? 0)}</b>
        </span>
        <span className="chip" title="该卡牌无法在 Steam 市场交易">
          不可售 <b>{integer(stats?.not_marketable ?? 0)}</b>
        </span>
        <span className="chip chip-warn" title="离线模式且本地缓存中没有价格">
          未缓存 <b>{integer(stats?.not_cached ?? 0)}</b>
        </span>
        <span className="chip chip-violet" title="直接命中本地价格缓存，未发起市场请求">
          缓存命中 <b>{integer(stats?.cached ?? 0)}</b>
        </span>
        <span className="chip chip-danger" title="Steam 市场接口限流或请求失败">
          限流 <b>{integer(stats?.blocked ?? 0)}</b>
        </span>
        {(stats?.error ?? 0) > 0 && (
          <span className="chip chip-danger">错误 <b>{integer(stats?.error ?? 0)}</b></span>
        )}
      </div>

      {retry && (
        <div
          className="mt-3 flex items-center gap-2 rounded-xl border px-3 py-2"
          style={{
            borderColor: "color-mix(in srgb, var(--warn) 42%, transparent)",
            background: "var(--warn-soft)",
          }}
        >
          <RefreshCw size={13} className="spin" style={{ color: "var(--warn)" }} />
          <span className="text-[11.5px] font-medium" style={{ color: "var(--warn)" }}>
            {retry.message} · {retry.seconds}s 后重试
          </span>
        </div>
      )}

      <details
        className="mt-3 rounded-xl border"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--main-bg) 55%, transparent)" }}
      >
        <summary
          className="flex items-center gap-2 px-3 py-2 text-[11.5px] font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          <ChevronRight size={13} className="details-chevron" />
          <Terminal size={12} />
          实时日志
          <span className="badge badge-neutral h-4 px-1.5 text-[10px]">{logs.length}</span>
          <span className="ml-auto text-[10.5px]" style={{ color: "var(--text-tertiary)" }}>
            最近 {recent.length} 条
          </span>
        </summary>
        <div className="border-t px-3 py-2" style={{ borderColor: "var(--border)" }}>
          {recent.length === 0 ? (
            <div className="py-2 text-center text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              暂无日志
            </div>
          ) : (
            recent.map((entry: LogEntry) => <LogLine key={entry.id} entry={entry} />)
          )}
        </div>
      </details>
    </section>
  );
}

export default function EstimateView({
  controller,
  form,
  onFormChange,
  onViewResults,
}: EstimateViewProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const running = controller.state === "running";
  const busy = controller.starting;
  const disabled = running || busy;
  const done = controller.state === "done" || controller.state === "cancelled";

  const submit = () => {
    const message = validateForm(form);
    if (message) {
      setFormError(message);
      return;
    }
    setFormError(null);
    void controller.start(toStartPayload(form));
  };

  const update = (patch: Partial<EstimateForm>) => {
    if (formError) setFormError(null);
    onFormChange(patch);
  };

  const steamIdValid =
    form.steamid.trim() === "" || normalizeSteamId(form.steamid) != null;
  const showProgress =
    controller.progress != null ||
    running ||
    controller.starting ||
    controller.stageMessage != null ||
    controller.state === "done" ||
    controller.state === "cancelled";

  return (
    <div className="page">
      <HeroCard />

      {!controller.mock && controller.connection === "disconnected" && (
        <div
          className="panel mt-4 flex items-start gap-2.5 p-3.5"
          style={{ borderColor: "color-mix(in srgb, var(--danger) 38%, var(--border))", background: "var(--danger-soft)" }}
        >
          <WifiOff size={15} className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
          <div className="min-w-0 text-[11.5px] leading-relaxed">
            <div className="font-semibold" style={{ color: "var(--danger)" }}>
              {IS_DESKTOP ? "本地后端未响应" : "未连接到 Rust 后端"}
            </div>
            <div style={{ color: "var(--text-secondary)" }}>
              {IS_DESKTOP ? (
                <>请关闭应用后重新打开（后端随桌面应用一起启动）。</>
              ) : (
                <>
                  正在尝试连接 <span className="mono">{backendLabel()}</span>。请先启动后端服务；或在 URL 加上{" "}
                  <span className="mono">?mock=1</span> 使用前端演示数据。
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {controller.state === "error" && controller.error && (
        <div
          className="panel fade-in mt-4 flex items-start gap-2.5 p-3.5"
          style={{ borderColor: "color-mix(in srgb, var(--danger) 38%, var(--border))", background: "var(--danger-soft)" }}
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
          <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed">
            <div className="font-semibold" style={{ color: "var(--danger)" }}>估值失败</div>
            <div style={{ color: "var(--text-secondary)" }}>{controller.error}</div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost shrink-0"
            onClick={controller.dismissError}
            title="关闭"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {showProgress && <div className="mt-4"><ProgressCard controller={controller} /></div>}

      <div className="mt-4">
        <section className="panel min-w-0 p-5">
          <header className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>
                估值参数
              </h2>
              <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                填写 SteamID 并选择查询选项
              </p>
            </div>
          </header>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label className="field-label" htmlFor="steamid">
              <UserRound size={12} />
              SteamID64 / 个人资料链接
            </label>
            <div className="relative">
              <UserRound className="input-icon" size={16} style={{ color: "var(--text-tertiary)" }} />
              <input
                id="steamid"
                className="input input-lg mono"
                value={form.steamid}
                disabled={disabled}
                placeholder="7656119XXXXXXXXXX 或 https://steamcommunity.com/profiles/…"
                onChange={(event) => update({ steamid: event.target.value })}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={formError != null}
              />
              {form.steamid && !disabled && (
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg"
                  style={{ color: "var(--text-tertiary)" }}
                  onClick={() => update({ steamid: "" })}
                  aria-label="清空 SteamID"
                  title="清空"
                >
                  <X size={14} />
                </button>
              )}
              {form.steamid && steamIdValid && (
                <CheckCircle2
                  size={15}
                  className="absolute right-10 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--ok)" }}
                />
              )}
            </div>
            <div className="mt-1.5 flex items-start justify-between gap-3">
              <p className="text-[10.5px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
                支持 17 位 SteamID64、profiles 链接或 /id/ 自定义主页链接；需在 Steam 隐私设置中将「游戏详情」设为公开。
                库存接口被限流时会自动复用最近的库存缓存，优先保证价格查询继续。
              </p>
              {form.steamid && !steamIdValid && (
                <span className="badge badge-warn shrink-0">ID 格式待确认</span>
              )}
            </div>
            {formError && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--danger)" }}>
                <AlertTriangle size={12} /> {formError}
              </p>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="field-label" htmlFor="currency">
                  <Coins size={12} /> 货币
                </label>
                <div className="relative">
                  <select
                    id="currency"
                    className="input select"
                    value={form.currency}
                    disabled={disabled}
                    onChange={(event) => update({ currency: Number(event.target.value) })}
                  >
                    {CURRENCIES.map((currency) => (
                      <option key={currency.code} value={currency.code}>
                        {currency.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: "var(--text-tertiary)" }}
                  />
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="fee">
                  <Coins size={12} /> 手续费
                </label>
                <div className="relative">
                  <input
                    id="fee"
                    type="number"
                    min={0}
                    max={90}
                    step={0.5}
                    className="input number-input pr-8"
                    value={form.feePercent}
                    disabled={disabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      update({ feePercent: Number.isFinite(value) ? value : 0 });
                    }}
                  />
                  <span
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    %
                  </span>
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="limit">
                  <Layers size={12} /> 只查前 N 种
                </label>
                <div className="relative">
                  <input
                    id="limit"
                    type="number"
                    min={0}
                    step={1}
                    className="input number-input pr-8"
                    value={form.limit}
                    disabled={disabled}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      update({ limit: Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0 });
                    }}
                  />
                  <span
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    种
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <ToggleRow
                icon={WifiOff}
                label="离线模式"
                description="只用本地价格缓存，不访问市场"
                checked={form.offline}
                disabled={disabled}
                onChange={(value) => update({ offline: value })}
              />
              <ToggleRow
                icon={RefreshCw}
                label="忽略缓存"
                description="强制重新查询市场最低价"
                checked={form.noCache}
                disabled={disabled}
                onChange={(value) => update({ noCache: value })}
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2.5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              {running ? (
                <button
                  type="button"
                  className="btn btn-danger btn-lg"
                  onClick={controller.cancel}
                  disabled={controller.cancelling}
                >
                  {controller.cancelling ? <Loader2 size={16} className="spin" /> : <Square size={15} />}
                  {controller.cancelling ? "正在停止…" : "停止估值"}
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn btn-primary btn-lg min-w-[150px]"
                  disabled={busy}
                >
                  {busy ? <Loader2 size={16} className="spin" /> : <Play size={15} />}
                  {busy ? "启动中…" : done ? "重新估值" : "开始估值"}
                </button>
              )}
              {done && controller.summary && (
                <button type="button" className="btn btn-secondary btn-lg" onClick={onViewResults}>
                  查看结果 <ArrowRight size={14} />
                </button>
              )}
              <span className="ml-auto hidden items-center gap-1 text-[10.5px] lg:flex" style={{ color: "var(--text-tertiary)" }}>
                <Lock size={10} />
                查询受 Steam 市场限流影响，自动限速保护
              </span>
            </div>
          </form>
        </section>

      </div>
    </div>
  );
}