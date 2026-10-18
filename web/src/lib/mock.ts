import type {
  CardRow,
  Paths,
  Progress,
  RowStatus,
  ServerEvent,
  StartPayload,
  Stats,
  Summary,
} from "../types";
import { CURRENCIES } from "./format";

/**
 * Front-end simulation used when the URL carries ?mock=1 or VITE_MOCK=1.
 * It replays the same event stream the Rust backend emits so the whole UI
 * (progress, logs, results, downloads) can be exercised without a server.
 */

export const MOCK_TOTAL = 240;
const TICK_MS = 60;
const INTRO_TICKS = 8;

const DEMO_GAMES: Array<[string, number]> = [
  ["Counter-Strike 2", 730],
  ["Dota 2", 570],
  ["Team Fortress 2", 440],
  ["PUBG: BATTLEGROUNDS", 578080],
  ["Apex Legends", 1172470],
  ["Rust", 252490],
  ["Warframe", 230410],
  ["Path of Exile", 238960],
  ["Terraria", 105600],
  ["Stardew Valley", 413150],
  ["Hollow Knight", 367520],
  ["Slay the Spire", 646570],
];

const CARD_NAMES = [
  "Aurora",
  "Nightfall",
  "Ember Warden",
  "Frostbound",
  "Stormcaller",
  "Cinder King",
  "Sunken Temple",
  "Gilded Herald",
  "Voidwalker",
  "Ironclad",
  "Wildbloom",
  "Moonlit Path",
  "Ashen Crown",
  "Crystal Vanguard",
  "Silent Blade",
  "Thunder Peak",
  "Dawnbreaker",
  "Grave Lantern",
  "Runeblade",
  "Wandering Star",
  "Hollow Mask",
  "Sapphire Sprite",
  "Crimson Banner",
  "Glacier Guard",
  "Mistwalker",
  "Obsidian Sigil",
  "Sunspire",
  "Twilight Fox",
  "Verdant Guardian",
  "Wraithbane",
];

export interface MockEngine {
  start: (payload: StartPayload) => void;
  cancel: () => void;
  dispose: () => void;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function emptyStats(): Stats {
  return {
    ok: 0,
    no_listing: 0,
    not_marketable: 0,
    not_cached: 0,
    blocked: 0,
    error: 0,
    cancelled: 0,
    cached: 0,
  };
}

function createRows(): CardRow[] {
  const rows: CardRow[] = [];
  for (let index = 0; index < MOCK_TOTAL; index += 1) {
    const [game, appid] = DEMO_GAMES[index % DEMO_GAMES.length];
    const foil = Math.random() < 0.09;
    const baseName = CARD_NAMES[(index * 7) % CARD_NAMES.length];
    const name = `${game} - ${baseName}${foil ? " (Foil)" : ""}`;

    const roll = Math.random();
    let status: RowStatus;
    if (roll < 0.79) status = "ok";
    else if (roll < 0.86) status = "no_listing";
    else if (roll < 0.925) status = "not_marketable";
    else if (roll < 0.96) status = "not_cached";
    else if (roll < 0.985) status = "blocked";
    else status = "error";

    const count = Math.random() < 0.74 ? 1 : Math.random() < 0.82 ? 2 : 3;
    const lowest =
      status === "ok" ? round2(0.06 + Math.pow(Math.random(), 2.4) * 12) : null;

    rows.push({
      hash: `demo${index.toString(16).padStart(8, "0")}`,
      name,
      game,
      appid: String(appid),
      foil,
      count,
      marketable: status !== "not_marketable",
      tradable: status !== "not_marketable" && Math.random() > 0.05,
      lowest,
      value: lowest == null ? 0 : round2(lowest * count),
      volume:
        status === "ok" ? Math.floor(randomBetween(4, 1400)) : null,
      status,
    });
  }
  return rows;
}

function currencyName(code: number): string {
  return CURRENCIES.find((item) => item.code === code)?.label.split(" ")[0] ?? "CNY";
}

function buildSummary(
  payload: StartPayload,
  rows: CardRow[],
  elapsed: number,
  cachedHits: number,
  requests: number,
  cancelled: boolean,
): Summary {
  const gross = round2(rows.reduce((sum, row) => sum + row.value, 0));
  const net = round2(gross * (1 - payload.fee));
  const copies = rows.reduce((sum, row) => sum + row.count, 0);
  const sellable = rows
    .filter((row) => row.status === "ok")
    .reduce((sum, row) => sum + row.count, 0);
  const priced = rows.filter((row) => row.lowest != null).length;
  const games = new Set(rows.map((row) => row.game)).size;
  const foilTypes = rows.filter((row) => row.foil).length;
  const currency = currencyName(payload.currency);
  const currencyLabel =
    CURRENCIES.find((item) => item.code === payload.currency)?.label ?? currency;
  return {
    steamid64: payload.steamid || "76561199000000000",
    nickname: "演示账号",
    currency,
    currency_label: currencyLabel,
    types: rows.length,
    copies,
    games,
    foil_types: foilTypes,
    priced,
    unpriced: rows.length - priced,
    sellable,
    gross,
    fee: payload.fee,
    net,
    generated_at: new Date().toISOString(),
    elapsed,
    requests,
    cached: cachedHits,
    aborted_at: null,
    cancelled,
    cancelled_types: cancelled ? MOCK_TOTAL - rows.length : 0,
    demo: true,
    offline: payload.offline,
  };
}

export function createMockEngine(emit: (event: ServerEvent) => void): MockEngine {
  let timer: number | null = null;
  let writeTimer: number | null = null;
  let active = false;
  let payload: StartPayload | null = null;
  let rows: CardRow[] = [];
  let cachedFlags: boolean[] = [];
  let done = 0;
  let gross = 0;
  let stats = emptyStats();
  let cachedHits = 0;
  let requests = 0;
  let startAt = 0;
  let tickCount = 0;
  let stage = "";
  let retrySent = false;

  const log = (level: "info" | "warn" | "error" | "debug", message: string) => {
    emit({ type: "log", level, message });
  };

  const emitStage = (next: string, message: string) => {
    if (stage === next) return;
    stage = next;
    emit({ type: "stage", stage: next, message });
  };

  const clearTimers = () => {
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
    if (writeTimer != null) {
      window.clearTimeout(writeTimer);
      writeTimer = null;
    }
  };

  const processedRows = () => rows.slice(0, done);

  const buildProgress = (): Progress => {
    const elapsed = Math.max(0.001, (performance.now() - startAt) / 1000);
    const rate = done / elapsed;
    const eta = rate > 0 ? Math.max(0, (MOCK_TOTAL - done) / rate) : 0;
    const current = rows[Math.min(done, rows.length - 1)];
    return {
      done,
      total: MOCK_TOTAL,
      elapsed,
      eta,
      rate,
      gross: round2(gross),
      hash: current?.hash ?? "",
      name: current?.name ?? "",
      game: current?.game ?? "",
      status: current?.status ?? "",
      stats: { ...stats },
      requests,
      cached: cachedHits,
    };
  };

  const finish = (cancelled: boolean) => {
    if (!payload) return;
    clearTimers();
    const elapsed = Math.max(0.1, (performance.now() - startAt) / 1000);
    const processed = processedRows();
    const summary = buildSummary(
      payload,
      processed,
      elapsed,
      cachedHits,
      requests,
      cancelled,
    );
    const paths: Paths = {
      detail: "demo/steam_cards_demo.csv",
      summary: "demo/steam_cards_demo_summary.csv",
    };
    active = false;
    emit({
      type: "done",
      summary,
      paths,
      rows: processed.map((row, index) =>
        row.status === "cancelled"
          ? row
          : index >= done
            ? { ...row, status: "cancelled" as RowStatus }
            : row,
      ),
    });
  };

  const step = () => {
    if (!active || !payload) return;
    tickCount += 1;

    if (tickCount < 3) {
      emitStage("resolve", "正在解析 SteamID…");
      return;
    }
    if (tickCount < 5) {
      emitStage("profile", "读取个人资料与库存可见性…");
      return;
    }
    if (tickCount < INTRO_TICKS) {
      emitStage("inventory", "扫描库存中的集换式卡牌…");
      return;
    }

    if (stage !== "pricing") {
      emitStage("pricing", "查询 Steam 市场最低价…");
      log("info", `已识别 ${MOCK_TOTAL} 种可交易卡牌，开始查询市场价`);
    }

    const row = rows[done];
    if (!row) return;
    const wasCached = cachedFlags[done] === true;
    done += 1;

    if (row.status === "ok") {
      gross = round2(gross + row.value);
      stats.ok += 1;
      if (wasCached) {
        cachedHits += 1;
        stats.cached += 1;
      } else {
        requests += 1;
      }
    } else {
      if (row.status === "not_marketable" || row.status === "not_cached") {
        // no market request needed for these
      } else {
        requests += 1;
      }
      if (row.status in stats) stats[row.status] += 1;
      if (row.status === "blocked") {
        log("warn", `限流：${row.name} 暂时无法查询`);
      }
    }

    if (done === 148 && !retrySent) {
      retrySent = true;
      emit({ type: "retry", message: "Steam 市场接口限流，正在退避重试", seconds: 8 });
      log("warn", "Steam 市场返回 429，等待 8 秒后重试");
    } else if (done % 17 === 0) {
      log(
        "info",
        `[${done}/${MOCK_TOTAL}] ${row.name} · ${row.status === "ok" ? "已取价" : row.status}`,
      );
    } else if (done % 53 === 0) {
      log("debug", `进度 ${done}/${MOCK_TOTAL}，已用 ${(performance.now() - startAt).toFixed(0)}ms`);
    }

    emit({ type: "progress", ...buildProgress() });

    if (done >= MOCK_TOTAL) {
      clearTimers();
      emit({ type: "stage", stage: "write", message: "写入 CSV 明细与汇总…" });
      log("info", "正在写入 CSV 文件…");
      writeTimer = window.setTimeout(() => {
        writeTimer = null;
        finish(false);
      }, 700);
    }
  };

  const start = (nextPayload: StartPayload) => {
    clearTimers();
    payload = nextPayload;
    rows = createRows();
    cachedFlags = rows.map((row) => row.status === "ok" && Math.random() < 0.3);
    done = 0;
    gross = 0;
    stats = emptyStats();
    cachedHits = 0;
    requests = 0;
    tickCount = 0;
    stage = "";
    retrySent = false;
    active = true;
    startAt = performance.now();

    emit({
      type: "snapshot",
      state: "running",
      demo: true,
      progress: null,
      summary: null,
      paths: null,
      error: null,
    });
    log("info", "演示模式已启动：使用内置 240 种卡牌，不访问 Steam 网络");
    log("info", "（URL 带 ?mock=1 时前端使用本地模拟数据）");
    emitStage("resolve", "正在解析 SteamID…");

    timer = window.setInterval(step, TICK_MS);
  };

  const cancel = () => {
    if (!active) return;
    log("warn", "收到停止请求，写入已查询的部分结果…");
    emit({ type: "stage", stage: "write", message: "写入部分结果…" });
    finish(true);
  };

  const dispose = () => {
    active = false;
    clearTimers();
  };

  return { start, cancel, dispose };
}