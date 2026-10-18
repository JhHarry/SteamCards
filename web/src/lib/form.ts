import type { StartPayload } from "../types";

export interface EstimateForm {
  steamid: string;
  currency: number;
  feePercent: number;
  limit: number;
  offline: boolean;
  noCache: boolean;
  demo: boolean;
  debug: boolean;
}

export const DEMO_STEAMID = "76561199000000000";

export const DEFAULT_FORM: EstimateForm = {
  steamid: "",
  currency: 23,
  feePercent: 15,
  limit: 0,
  offline: false,
  noCache: false,
  demo: false,
  debug: false,
};

/** Accepts 17-digit SteamID64, profiles link, /id/ custom URL or a bare vanity name. */
export function normalizeSteamId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d{17}$/.test(trimmed)) return trimmed;
  // steamcommunity.com/profiles/7656119xxxxxxxxxx 或 /id/custom-name（保留原始输入，交给后端解析）
  if (/(^|\/)profiles\/7656119\d{10}/.test(trimmed)) return trimmed;
  if (/steamcommunity\.com\/id\/[A-Za-z0-9_.-]+/i.test(trimmed)) return trimmed;
  // 纯自定义域名（Steam 的 /id/<name> 中的 name）
  if (/^[A-Za-z0-9_.-]{2,64}$/.test(trimmed)) return trimmed;
  return null;
}

export function validateForm(form: EstimateForm): string | null {
  if (form.demo) return null;
  if (!form.steamid.trim()) return "请输入 SteamID64、个人资料链接或自定义主页链接";
  if (!normalizeSteamId(form.steamid)) {
    return "无法识别：请输入 17 位 SteamID64、profiles 链接，或 /id/自定义域名链接";
  }
  return null;
}

export function toStartPayload(form: EstimateForm): StartPayload {
  const steamid = normalizeSteamId(form.steamid);
  return {
    steamid: form.demo && !steamid ? DEMO_STEAMID : (steamid ?? ""),
    currency: form.currency,
    fee: form.feePercent / 100,
    limit: form.limit > 0 ? Math.floor(form.limit) : 0,
    offline: form.offline,
    no_cache: form.noCache,
    demo: form.demo,
    debug: form.debug,
  };
}