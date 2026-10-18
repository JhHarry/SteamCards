export type RunState = "idle" | "running" | "done" | "error" | "cancelled";

export type RowStatus =
  | "ok"
  | "no_listing"
  | "not_marketable"
  | "not_cached"
  | "blocked"
  | "cancelled"
  | "error";

export interface Stats {
  ok: number;
  no_listing: number;
  not_marketable: number;
  not_cached: number;
  blocked: number;
  error: number;
  cancelled: number;
  cached: number;
}

export interface Progress {
  done: number;
  total: number;
  elapsed: number;
  eta: number;
  rate: number;
  gross: number;
  hash: string;
  name: string;
  game: string;
  status: string;
  stats: Stats;
  requests: number;
  cached: number;
}

export interface Summary {
  steamid64: string;
  nickname: string;
  currency: string;
  currency_label: string;
  types: number;
  copies: number;
  games: number;
  foil_types: number;
  priced: number;
  unpriced: number;
  sellable: number;
  gross: number;
  fee: number;
  net: number;
  generated_at: string;
  elapsed: number;
  requests: number;
  cached: number;
  /** null = 未熔断；>0 = 熔断时已查询的卡牌种数 */
  aborted_at: number | null;
  cancelled: boolean;
  cancelled_types: number;
  demo: boolean;
  offline: boolean;
  /** 本次是否使用了本地库存缓存（库存接口受限时兜底） */
  inventory_cached?: boolean;
  /** 库存缓存距今秒数 */
  inventory_cache_age_secs?: number;
}

export interface CardRow {
  hash: string;
  name: string;
  game: string;
  appid: string;
  foil: boolean;
  count: number;
  marketable: boolean;
  tradable: boolean;
  lowest: number | null;
  value: number;
  volume: number | null;
  status: RowStatus;
}

export interface Paths {
  detail: string;
  summary: string;
}

export interface Snapshot {
  state: RunState;
  demo: boolean;
  progress: Progress | null;
  summary: Summary | null;
  paths: Paths | null;
  error: string | null;
}

export interface LogEntry {
  id: number;
  ts: number;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  kind: "log" | "stage" | "retry" | "inventory" | "system";
}

export interface RetryInfo {
  message: string;
  seconds: number;
  at: number;
}

export interface StartPayload {
  steamid: string;
  currency: number;
  fee: number;
  limit: number;
  offline: boolean;
  no_cache: boolean;
  demo: boolean;
  debug: boolean;
}

export type ServerEvent =
  | ({
      type: "snapshot";
    } & Snapshot)
  | { type: "stage"; stage: string; message: string }
  | { type: "log"; level: LogEntry["level"]; message: string }
  | { type: "inventory"; page: number; items: number; total: number; message: string }
  | { type: "retry"; message: string; seconds: number }
  | ({ type: "progress" } & Progress)
  | { type: "done"; summary: Summary; paths: Paths; rows: CardRow[] }
  | { type: "error"; message: string };
export interface HistoryEntry {
  id: string;
  steamid64: string;
  nickname: string;
  generated_at: string;
  saved_at: number;
  types: number;
  copies: number;
  gross: number;
  net: number;
  currency: string;
  currency_label: string;
}

export interface HistoryFile {
  entry: HistoryEntry;
  summary: Summary;
  rows: CardRow[];
  paths: Paths;
}
