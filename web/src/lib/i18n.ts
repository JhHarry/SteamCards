/**
 * 轻量界面本地化：系统语言为中文时保持中文；其它语言在渲染后把静态文案替换为英文。
 * 通过 MutationObserver 兼容 React 的后续渲染，不需要改每个组件。
 */
const params = new URLSearchParams(window.location.search);
const override = params.get("lang") || window.localStorage.getItem("steamcards_lang");
const system = (navigator.languages?.[0] || navigator.language || "zh").toLowerCase();
export const LANG: "zh" | "en" = override
  ? override.toLowerCase().startsWith("en")
    ? "en"
    : "zh"
  : system.startsWith("zh")
    ? "zh"
    : "en";

const DICT: Record<string, string> = {
  "Steam 卡牌估值": "Steam Card Valuation",
  "独立桌面应用 · 数据全部在本机处理": "Standalone desktop app · all data processed locally",
  "本地运行中": "Running locally",
  "外观主题": "Appearance theme",
  "亮色主题": "Light theme",
  "暗色主题": "Dark theme",
  "跟随系统": "Follow system",
  "最小化": "Minimize",
  "最大化 / 还原": "Maximize / Restore",
  "最大化": "Maximize",
  "关闭": "Close",
  "工作台": "Workspace",
  "主导航": "Main navigation",
  "输入 SteamID 开始估值": "Enter a SteamID to start",
  "估值": "Valuation",
  "汇总与卡牌明细": "Summary and card details",
  "结果": "Results",
  "完整运行日志": "Full run log",
  "日志": "Logs",
  "历史结果": "History",
  "估值完成后会自动保存在这里，按账号分组。": "Completed valuations are saved here automatically, grouped by account.",
  "主内容区": "Main content",
  "Steam 库存卡牌": "Steam Inventory ",
  "资产估值": "Valuation",
  "扫描库存里的集换式卡牌，按市场最低价估值并导出 CSV。支持 10 种货币、本地缓存与限流自动切源。":
    "Scan trading cards in your inventory, value them at the lowest market price and export CSV. Supports 10 currencies, local cache and automatic source switching when rate limited.",
  "10 种货币": "10 currencies",
  "限流自动切源": "Auto source switch on rate limit",
  "价格缓存": "Price cache",
  "实时进度": "Live progress",
  "估值参数": "Valuation settings",
  "填写 SteamID 并选择查询选项": "Enter a SteamID and choose query options",
  "SteamID64 / 个人资料链接": "SteamID64 / profile link",
  "7656119XXXXXXXXXX 或 https://steamcommunity.com/profiles/…":
    "7656119XXXXXXXXXX or https://steamcommunity.com/profiles/…",
  "支持 17 位 SteamID64、profiles 链接或 /id/ 自定义主页链接；需在 Steam 隐私设置中将「游戏详情」设为公开。 库存接口被限流时会自动复用最近的库存缓存，优先保证价格查询继续。":
    "Supports 17-digit SteamID64, profiles links or /id/ custom profile links. Set Game details to public in Steam privacy settings. When the inventory API is rate limited, the most recent inventory cache is reused so price queries can continue.",
  "货币": "Currency",
  "CNY 人民币": "CNY Chinese Yuan",
  "USD 美元": "USD US Dollar",
  "EUR 欧元": "EUR Euro",
  "GBP 英镑": "GBP British Pound",
  "JPY 日元": "JPY Japanese Yen",
  "RUB 卢布": "RUB Russian Ruble",
  "BRL 雷亚尔": "BRL Brazilian Real",
  "TRY 里拉": "TRY Turkish Lira",
  "UAH 格里夫纳": "UAH Ukrainian Hryvnia",
  "PLN 兹罗提": "PLN Polish Zloty",
  "手续费": "Fee",
  "只查前 N 种": "Limit to first N types",
  "种": "types",
  "离线模式": "Offline mode",
  "只用本地价格缓存，不访问市场": "Use local price cache only; no market requests",
  "忽略缓存": "Ignore cache",
  "强制重新查询市场最低价": "Force refresh market lowest prices",
  "开始估值": "Start valuation",
  "查询受 Steam 市场限流影响，自动限速保护": "Subject to Steam market rate limits; automatic throttling enabled",
  "就绪 · 等待开始估值": "Ready · waiting to start",
  "Server-Sent Events 实时进度流": "Server-Sent Events live progress stream",
  "后端已连接": "Backend connected",
  "后端连接中": "Connecting to backend",
  "后端已断开 · 自动重连": "Backend disconnected · reconnecting",
  "本地模拟": "Local simulation",
  "估值结果": "Valuation results",
  "还没有估值结果": "No valuation results yet",
  "在「估值」页填写 SteamID 并开始运行，完成后会自动跳转到这里。也可以直接开启演示模式，用本地模拟数据预览完整流程。":
    "Enter a SteamID on the Valuation page and start a run; you will be taken here when it finishes. You can also enable demo mode to preview the full flow with local simulated data.",
  "去估值": "Go to valuation",
  "运行日志": "Run log",
  "条": "entries",
  "等待开始估值": "Waiting to start",
  "· 实时推送": "· live stream",
  "自动滚动到最新日志": "Auto-scroll to latest logs",
  "自动滚动": "Auto-scroll",
  "清空日志": "Clear logs",
  "全部": "All",
  "信息": "Info",
  "警告": "Warning",
  "错误": "Error",
  "调试": "Debug",
  "全部级别": "All levels",
  "还没有日志": "No logs yet",
  "开始一次估值后，阶段切换、库存扫描、限流重试与完成信息都会实时显示在这里。":
    "After you start a run, stage changes, inventory scans, rate-limit retries and completion messages appear here in real time.",
  "演示数据": "Demo data",
  "离线": "Offline",
  "删除历史结果": "Delete history record",
  "删除这条历史记录": "Delete this history record",
  "估值中": "Valuing",
  "已完成": "Completed",
  "已停止": "Stopped",
  "运行失败 · 请查看日志": "Run failed · check logs",
  "关闭通知": "Dismiss notification",
  "运行结果": "Run results",
  "当前结果": "Current result",
  "卡牌明细": "Card details",
  "汇总": "Summary",
  "导出 CSV": "Export CSV",
  "下载明细 CSV": "Download detail CSV",
  "下载汇总 CSV": "Download summary CSV",
  "打开目录": "Open folder",
  "新的估值": "New valuation",
  "还没有结果": "No results yet",
  "重置筛选": "Reset filters",
  "状态": "Status",
  "全部状态": "All statuses",
  "卡牌": "Card",
  "游戏": "Game",
  "数量": "Count",
  "最低价": "Lowest",
  "成交量": "Volume",
  "可交易": "Tradable",
  "可出售": "Marketable",
  "闪亮": "Foil",
  "普通": "Normal",
  "搜索卡牌或游戏": "Search cards or games",
};

const ATTRS: Record<string, string> = {
  "独立桌面应用 · 数据全部在本机处理": "Standalone desktop app · all data processed locally",
  "外观主题": "Appearance theme",
  "亮色主题": "Light theme",
  "暗色主题": "Dark theme",
  "跟随系统": "Follow system",
  "最小化": "Minimize",
  "最大化 / 还原": "Maximize / Restore",
  "最大化": "Maximize",
  "关闭": "Close",
  "主导航": "Main navigation",
  "输入 SteamID 开始估值": "Enter a SteamID to start",
  "汇总与卡牌明细": "Summary and card details",
  "完整运行日志": "Full run log",
  "主内容区": "Main content",
  "Server-Sent Events 实时进度流": "Server-Sent Events live progress stream",
  "自动滚动到最新日志": "Auto-scroll to latest logs",
  "删除历史结果": "Delete history record",
  "删除这条历史记录": "Delete this history record",
  "关闭通知": "Dismiss notification",
};

const PATTERNS: Array<[RegExp, string]> = [
  [/^估值中 · (\d+) \/ (\d+) 种$/, "Valuing · $1 / $2 types"],
  [/^已完成 · (\d+) 种 \/ (\d+) 张 · 用时 (.+)$/, "Completed · $1 types / $2 cards · $3"],
  [/^已停止 · 保留 (\d+) 种部分结果$/, "Stopped · kept $1 types"],
  [/^删除「(.+)」这条历史结果？$/, "Delete the history record for “$1”?"],
  [/^(\d+) 种$/, "$1 types"],
  [/^(\d+) 张$/, "$1 cards"],
  [/^(\d+) 条$/, "$1 entries"],
  [/^(\d+) 个游戏$/, "$1 games"],
  [/^(\d+) 个闪亮$/, "$1 foil"],
  [/^(\d+) 种货币$/, "$1 currencies"],
];

function translate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !/[\u4e00-\u9fff]/.test(trimmed)) return null;
  const exact = DICT[trimmed];
  if (exact) return value.replace(trimmed, exact);
  for (const [re, replacement] of PATTERNS) {
    if (re.test(trimmed)) return value.replace(re, replacement);
  }
  return null;
}

function translateNode(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const next = translate(node.nodeValue ?? "");
    if (next != null && next !== node.nodeValue) node.nodeValue = next;
    return;
  }
  if (!(node instanceof Element)) return;
  const tag = node.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "CODE" || tag === "PRE") return;
  for (const attr of ["placeholder", "title", "aria-label"]) {
    const value = node.getAttribute(attr);
    if (!value) continue;
    const next = ATTRS[value.trim()] ?? translate(value);
    if (next != null && next !== value) node.setAttribute(attr, next);
  }
  const children = node.childNodes;
  for (let i = 0; i < children.length; i += 1) translateNode(children[i]);
}

let scheduled = false;
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    translateNode(document.body);
  });
}

export function installI18n(): void {
  if (LANG === "zh") return;
  document.documentElement.lang = "en";
  translateNode(document.body);
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["placeholder", "title", "aria-label"],
  });
}