import type { RowStatus } from "../types";

export interface CurrencyOption {
  code: number;
  label: string;
  symbol: string;
}

/** Mirrors steamcards.py CURRENCY_CHOICES. */
export const CURRENCIES: CurrencyOption[] = [
  { code: 23, label: "CNY 人民币", symbol: "¥" },
  { code: 1, label: "USD 美元", symbol: "$" },
  { code: 3, label: "EUR 欧元", symbol: "€" },
  { code: 2, label: "GBP 英镑", symbol: "£" },
  { code: 24, label: "JPY 日元", symbol: "¥" },
  { code: 5, label: "RUB 卢布", symbol: "₽" },
  { code: 29, label: "BRL 雷亚尔", symbol: "R$" },
  { code: 33, label: "TRY 里拉", symbol: "₺" },
  { code: 34, label: "UAH 格里夫纳", symbol: "₴" },
  { code: 35, label: "PLN 兹罗提", symbol: "zł" },
];

const SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  RUB: "₽",
  BRL: "R$",
  TRY: "₺",
  UAH: "₴",
  PLN: "zł",
};

export function currencySymbol(currency: string | number | undefined): string {
  if (currency == null) return "";
  if (typeof currency === "number") {
    const found = CURRENCIES.find((item) => item.code === currency);
    return found?.symbol ?? "";
  }
  return SYMBOLS[currency.toUpperCase()] ?? "";
}

export function currencyLabel(currency: string | number | undefined): string {
  if (currency == null) return "";
  if (typeof currency === "number") {
    return CURRENCIES.find((item) => item.code === currency)?.label ?? String(currency);
  }
  return currency.toUpperCase();
}

/** "1234.56 CNY" — two decimals plus the currency code. */
export function money(
  value: number | null | undefined,
  currency: string | number | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const formatted = value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const code = currencyLabel(currency);
  return code ? `${formatted} ${code}` : formatted;
}

/** Compact money for dense table cells. */
export function moneyCompact(
  value: number | null | undefined,
  currency: string | number | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const code = currencyLabel(currency);
  return `${value.toFixed(2)} ${code}`.trim();
}

export function integer(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("zh-CN");
}

export function percent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "0%";
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped.toFixed(1).replace(/\.0$/, "")}%`;
}

/** mm:ss, or h:mm:ss once the run passes an hour. */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

export function rateLabel(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return "—";
  return `${rate.toFixed(1)} 张/s`;
}

export function clockTime(ts: number | null | undefined): string {
  if (ts == null) return "--:--:--";
  const date = new Date(ts);
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Backend sends UTC "YYYY-MM-DD HH:MM:SS" (no zone); mark it as UTC so the
  // browser converts it to the user's local time instead of guessing.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso)
    ? `${iso.replace(" ", "T")}Z`
    : iso;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export interface StatusMeta {
  label: string;
  tone: "ok" | "warn" | "danger" | "neutral" | "info" | "violet";
  description: string;
}

export const STATUS_META: Record<RowStatus, StatusMeta> = {
  ok: { label: "可售", tone: "ok", description: "市场有挂单，已按最低价计算" },
  no_listing: { label: "无挂单", tone: "warn", description: "卡牌可售，但市场当前没有挂单" },
  not_marketable: { label: "不可售", tone: "neutral", description: "该卡牌无法在 Steam 市场交易" },
  not_cached: { label: "未缓存", tone: "warn", description: "离线模式且本地缓存中没有价格" },
  blocked: { label: "限流", tone: "danger", description: "Steam 市场接口限流，未能查询" },
  cancelled: { label: "已取消", tone: "neutral", description: "运行被取消，未处理该卡牌" },
  error: { label: "查询失败", tone: "danger", description: "查询市场价时发生错误" },
};

export function statusMeta(status: string | null | undefined): StatusMeta {
  if (status && status in STATUS_META) return STATUS_META[status as RowStatus];
  return { label: status ?? "未知", tone: "neutral", description: "" };
}

export const STATUS_ORDER: RowStatus[] = [
  "ok",
  "no_listing",
  "not_marketable",
  "not_cached",
  "blocked",
  "error",
  "cancelled",
];
