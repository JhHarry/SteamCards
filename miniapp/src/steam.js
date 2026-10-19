import hbSDK from '@heybox/hb-sdk';

export const CURRENCY = 23;
export const FEE_RATE = 0.15;
export const USD_CNY_RATE = 6.74;
export const PRICE_CACHE_KEY = 'steamcards_price_cache_v1';
export const HISTORY_KEY = 'steamcards_history_v1';
const PRICE_MAX_AGE_SECONDS = 24 * 60 * 60;
const NETWORK_TIMEOUT = 25000;

export class EngineError extends Error {
  constructor(message, code = 'ENGINE_ERROR', status = 0) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.status = status;
  }
}

export class CancelledError extends Error {
  constructor() {
    super('已取消');
    this.name = 'CancelledError';
    this.code = 'CANCELLED';
  }
}

let memoryPriceCache = null;
let memoryHistory = null;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.cancelled) return reject(new CancelledError());
    setTimeout(() => {
      if (signal && signal.cancelled) reject(new CancelledError());
      else resolve();
    }, ms);
  });
}

export function createCancelSignal() {
  const signal = {
    cancelled: false,
    cleanups: [],
    cancel() {
      if (signal.cancelled) return;
      signal.cancelled = true;
      for (const fn of signal.cleanups.splice(0)) {
        try { fn(); } catch (error) { void error; }
      }
    },
    addCleanup(fn) {
      signal.cleanups.push(fn);
    },
    throwIfCancelled() {
      if (signal.cancelled) throw new CancelledError();
    }
  };
  return signal;
}

async function rawRequest(url, options = {}) {
  const params = options.params;
  const headers = options.headers;
  const timeout = options.timeout || NETWORK_TIMEOUT;
  try {
    const response = await hbSDK.network.request({
      url,
      method: 'GET',
      params,
      headers,
      timeout,
      validateStatus: () => true
    });
    let data = response.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (error) { void error; }
    }
    return { status: response.status, data, headers: response.headers };
  } catch (error) {
    const code = (error && error.code) || 'NETWORK_ERROR';
    const message = (error && error.message) || '网络请求失败';
    const status = (error && error.status) || 0;
    throw new EngineError(message, code, status);
  }
}

const JSON_HEADERS = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: 'https://steamcommunity.com/'
};

async function fetchText(url, options = {}) {
  const result = await rawRequest(url, options);
  if (result.status !== 200) {
    throw new EngineError('请求失败（HTTP ' + result.status + '）', 'HTTP_STATUS', result.status);
  }
  return result.data;
}

export async function resolveSteamId(input) {
  const value = (input || '').trim();
  if (!value) throw new EngineError('请输入 SteamID64 或个人资料链接', 'INVALID_INPUT');
  if (/^\d{17}$/.test(value)) return value;

  const profiles = value.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (profiles) return profiles[1];

  let vanity = '';
  const idMatch = value.match(/steamcommunity\.com\/id\/([^/?#]+)/i);
  if (idMatch) vanity = idMatch[1];
  else if (/^[A-Za-z0-9_.-]{2,64}$/.test(value)) vanity = value;
  if (!vanity) {
    throw new EngineError('无法识别该链接。请输入 17 位 SteamID64、profiles 链接，或 /id/自定义域名链接。', 'INVALID_INPUT');
  }

  const encoded = encodeURIComponent(vanity);
  let xml = '';
  try {
    xml = await fetchText('https://steamcommunity.com/id/' + encoded + '/?xml=1', { headers: JSON_HEADERS });
  } catch (error) {
    if (error.status === 429) throw error;
  }
  const fromXml = typeof xml === 'string' ? xml.match(/<steamID64>\s*(\d{17})\s*<\/steamID64>/i) : null;
  if (fromXml) return fromXml[1];

  try {
    const html = await fetchText('https://steamcommunity.com/id/' + encoded + '/', { headers: JSON_HEADERS });
    const fromHtml = typeof html === 'string'
      ? html.match(/["']steamid["']\s*:\s*["'](\d{17})["']/i)
      : null;
    if (fromHtml) return fromHtml[1];
  } catch (error) {
    if (error.status === 429) throw error;
  }
  throw new EngineError('无法解析该自定义链接。请确认主页存在，或直接使用 17 位 SteamID64。', 'RESOLVE_FAILED');
}

function parseAmount(value) {
  const amount = typeof value === 'number' ? value : parseInt(String(value || '1'), 10);
  return Number.isFinite(amount) && amount > 0 ? amount : 1;
}

function isTrueNumber(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0;
}

function splitCards(assets, descriptions) {
  const cards = [];
  let other = 0;
  const descByKey = new Map();
  for (const desc of descriptions || []) {
    descByKey.set(String(desc.classid) + '_' + String(desc.instanceid || '0'), desc);
  }
  for (const asset of assets || []) {
    const key = String(asset.classid) + '_' + String(asset.instanceid || '0');
    const desc = descByKey.get(key);
    const amount = parseAmount(asset.amount);
    if (!desc) { other += amount; continue; }
    let itemClass = '';
    let gameInternal = '';
    let gameName = '';
    let border = '';
    for (const tag of desc.tags || []) {
      if (tag.category === 'item_class') itemClass = tag.internal_name || '';
      else if (tag.category === 'Game') {
        gameInternal = tag.internal_name || '';
        gameName = tag.localized_tag_name || '';
      } else if (tag.category === 'cardborder') {
        border = tag.internal_name || '';
      }
    }
    if (itemClass !== 'item_class_2') { other += amount; continue; }
    const hash = desc.market_hash_name || desc.name || '';
    if (!hash) { other += amount; continue; }
    cards.push({
      hash,
      name: desc.name || hash,
      game: gameName || '未知游戏',
      appid: gameInternal.replace('app_', '') || '0',
      foil: border === 'cardborder_1',
      count: amount,
      marketable: isTrueNumber(desc.marketable),
      tradable: isTrueNumber(desc.tradable)
    });
  }
  return { cards, other };
}

export async function fetchInventory(steamid, signal, onProgress) {
  const assets = [];
  const descriptions = [];
  let total = 0;
  let startAsset = null;
  let page = 0;
  let more = true;
  while (more && page < 20) {
    page += 1;
    signal.throwIfCancelled();
    const params = { l: 'english', count: 2000 };
    if (startAsset) params.start_assetid = startAsset;
    const result = await rawRequest('https://steamcommunity.com/inventory/' + steamid + '/753/6', {
      params,
      headers: JSON_HEADERS
    });
    if (result.status === 429) {
      throw new EngineError('Steam 库存接口被限流（HTTP 429），请稍后重试或开启加速器。', 'RATE_LIMIT', 429);
    }
    if (result.status === 401 || result.status === 403) {
      throw new EngineError('库存不可访问。请确认账号存在、个人资料公开，并且「游戏详情」设为公开。', 'INVENTORY_PRIVATE', result.status);
    }
    if (result.status !== 200 || !result.data || typeof result.data !== 'object') {
      throw new EngineError('库存获取失败（HTTP ' + result.status + '）。请确认库存公开，或稍后重试。', 'INVENTORY_FAILED', result.status);
    }
    const data = result.data;
    if (Array.isArray(data.assets)) assets.push(...data.assets);
    if (Array.isArray(data.descriptions)) descriptions.push(...data.descriptions);
    if (Number.isFinite(Number(data.total_inventory_count))) total = Number(data.total_inventory_count);
    more = Boolean(data.more_items);
    startAsset = data.last_assetid || null;
    if (onProgress) {
      onProgress({
        stage: 'inventory',
        page,
        items: assets.length,
        total,
        message: '库存第 ' + page + ' 页，累计 ' + assets.length + ' 件物品'
      });
    }
    if (more) await sleep(450, signal);
  }
  const split = splitCards(assets, descriptions);
  return { cards: split.cards, other: split.other, total: total || assets.length };
}

export function parseMoney(input) {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, '');
  const start = cleaned.search(/\d/);
  if (start < 0) return null;
  let num = cleaned.slice(start);
  if (!num) return null;
  const hasDot = num.indexOf('.') >= 0;
  const hasComma = num.indexOf(',') >= 0;
  if (hasDot && hasComma) {
    if (num.lastIndexOf(',') > num.lastIndexOf('.')) num = num.replace(/\./g, '').replace(',', '.');
    else num = num.replace(/,/g, '');
  } else if (hasComma) {
    const parts = num.split(',');
    if (parts.length === 2 && parts[1].length === 2 && parts[0].length <= 3) num = parts[0] + '.' + parts[1];
    else num = num.replace(/,/g, '');
  }
  const value = Number(num);
  return Number.isFinite(value) ? value : null;
}

function searchItemPrice(item) {
  const cents = Number(item && item.sell_price);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  const text = String((item && item.sell_price_text) || '');
  const isCny = /¥|￥|CNY|人民币/i.test(text);
  if (isCny) return Math.round(cents) / 100;
  return Math.round((cents / 100) * USD_CNY_RATE * 100) / 100;
}

async function loadCache() {
  if (memoryPriceCache) return memoryPriceCache;
  try {
    const result = await hbSDK.storage.getStorage({ key: PRICE_CACHE_KEY });
    memoryPriceCache = result && result.data && typeof result.data === 'object' ? result.data : {};
  } catch (error) {
    void error;
    memoryPriceCache = {};
  }
  return memoryPriceCache;
}

async function saveCache(cache) {
  memoryPriceCache = cache;
  try {
    await hbSDK.storage.setStorage({ key: PRICE_CACHE_KEY, data: cache });
  } catch (error) {
    void error;
  }
}

export async function clearPriceCache() {
  memoryPriceCache = {};
  try {
    await hbSDK.storage.setStorage({ key: PRICE_CACHE_KEY, data: {} });
  } catch (error) {
    void error;
  }
}

function freshPrice(cache, hash) {
  const entry = cache ? cache[hash] : null;
  if (!entry || !Number.isFinite(Number(entry.p))) return null;
  if (Date.now() / 1000 - Number(entry.t || 0) > PRICE_MAX_AGE_SECONDS) return null;
  return Number(entry.p);
}

function setCachedPrice(cache, hash, price) {
  cache[hash] = { p: Math.round(price * 100) / 100, t: Math.floor(Date.now() / 1000) };
}

async function fetchQuickPrices(cards, signal, onProgress) {
  const cache = await loadCache();
  const groups = new Map();
  for (const card of cards) {
    if (!card.marketable) continue;
    if (freshPrice(cache, card.hash) != null) continue;
    if (!groups.has(card.appid)) groups.set(card.appid, new Set());
    groups.get(card.appid).add(card.hash);
  }
  const totalGames = groups.size;
  let processedGames = 0;
  let requestCount = 0;
  for (const entry of groups) {
    const appid = entry[0];
    const hashSet = entry[1];
    signal.throwIfCancelled();
    processedGames += 1;
    let start = 0;
    let totalCount = Infinity;
    let pages = 0;
    let foundAny = false;
    while (pages < 5 && start < totalCount) {
      signal.throwIfCancelled();
      pages += 1;
      const url = 'https://steamcommunity.com/market/search/render/?query=&start=' + start
        + '&count=10&search_descriptions=0&sort_column=popular&sort_dir=desc&appid=753&norender=1'
        + '&category_753_Game%5B%5D=tag_app_' + encodeURIComponent(appid)
        + '&category_753_item_class%5B%5D=tag_item_class_2';
      const result = await rawRequest(url, { headers: JSON_HEADERS });
      requestCount += 1;
      if (result.status === 429) {
        await saveCache(cache);
        throw new EngineError('Steam 市场搜索接口被限流（HTTP 429）。建议稍后再试，或改用精确模式仅查少量卡牌。', 'RATE_LIMIT', 429);
      }
      if (result.status !== 200 || !result.data || typeof result.data !== 'object' || result.data.success !== true) break;
      const data = result.data;
      totalCount = Number(data.total_count) || 0;
      const results = Array.isArray(data.results) ? data.results : [];
      if (!results.length) break;
      for (const item of results) {
        const hash = item && item.hash_name;
        if (!hash || !hashSet.has(hash)) continue;
        const price = searchItemPrice(item);
        if (price != null && price > 0) {
          setCachedPrice(cache, hash, price);
          foundAny = true;
        }
      }
      start += results.length;
      if (results.length < 10) break;
      await sleep(850, signal);
    }
    if (foundAny && processedGames % 5 === 0) await saveCache(cache);
    if (onProgress) {
      onProgress({
        stage: 'pricing',
        mode: 'quick',
        done: processedGames,
        total: totalGames,
        message: '快速取价 ' + processedGames + '/' + totalGames + ' 个游戏（' + requestCount + ' 次请求）'
      });
    }
    await sleep(700, signal);
  }
  await saveCache(cache);
  return { cache, requestCount };
}

async function fetchExactPrices(cards, signal, onProgress) {
  const cache = await loadCache();
  const unique = [];
  const seen = new Set();
  for (const card of cards) {
    if (!card.marketable || seen.has(card.hash)) continue;
    seen.add(card.hash);
    if (freshPrice(cache, card.hash) == null) unique.push(card);
  }
  let done = 0;
  for (const card of unique) {
    signal.throwIfCancelled();
    const result = await rawRequest('https://steamcommunity.com/market/priceoverview/', {
      headers: JSON_HEADERS,
      params: { appid: 753, currency: CURRENCY, market_hash_name: card.hash }
    });
    if (result.status === 429) {
      await saveCache(cache);
      throw new EngineError('Steam 精确价格接口被限流（HTTP 429）。建议改用快速参考价，或稍后重试。', 'RATE_LIMIT', 429);
    }
    if (result.status === 200 && result.data && result.data.success === true) {
      const lowest = parseMoney(result.data.lowest_price);
      const median = parseMoney(result.data.median_price);
      const price = lowest == null ? median : lowest;
      if (price != null && price > 0) setCachedPrice(cache, card.hash, price);
    }
    done += 1;
    if (onProgress) {
      onProgress({
        stage: 'pricing',
        mode: 'exact',
        done,
        total: unique.length,
        message: '精确取价 ' + done + '/' + unique.length + '：' + card.name
      });
    }
    await sleep(750, signal);
  }
  await saveCache(cache);
  return { cache, requestCount: unique.length };
}

export async function priceCards(cards, mode, signal, onProgress) {
  const result = mode === 'exact'
    ? await fetchExactPrices(cards, signal, onProgress)
    : await fetchQuickPrices(cards, signal, onProgress);
  const cache = result.cache;
  const rows = cards.map((card) => {
    const price = freshPrice(cache, card.hash);
    const unit = price == null ? 0 : price;
    return {
      hash: card.hash,
      name: card.name,
      game: card.game,
      appid: card.appid,
      foil: card.foil,
      count: card.count,
      marketable: card.marketable,
      unit,
      total: Math.round(unit * card.count * 100) / 100,
      status: price == null ? (card.marketable ? 'not_cached' : 'not_marketable') : 'ok'
    };
  });
  const summary = summarize(rows);
  return { rows, summary, mode, requestCount: result.requestCount };
}

export function summarize(rows) {
  let gross = 0;
  let priced = 0;
  let foil = 0;
  let copies = 0;
  let marketable = 0;
  const games = new Set();
  for (const row of rows) {
    copies += row.count;
    games.add(row.game);
    if (row.foil) foil += 1;
    if (row.marketable) marketable += row.count;
    if (row.status === 'ok') {
      priced += 1;
      gross += row.total;
    }
  }
  gross = Math.round(gross * 100) / 100;
  const fee = Math.round(gross * FEE_RATE * 100) / 100;
  return {
    types: rows.length,
    copies,
    games: games.size,
    foilTypes: foil,
    marketable,
    priced,
    unpriced: rows.length - priced,
    gross,
    fee,
    net: Math.round((gross - fee) * 100) / 100
  };
}

export async function loadHistory() {
  if (memoryHistory) return memoryHistory;
  try {
    const result = await hbSDK.storage.getStorage({ key: HISTORY_KEY });
    memoryHistory = Array.isArray(result && result.data) ? result.data : [];
  } catch (error) {
    void error;
    memoryHistory = [];
  }
  return memoryHistory;
}

export async function saveHistory(entry) {
  const history = await loadHistory();
  const next = [entry, ...history].slice(0, 12);
  memoryHistory = next;
  try {
    await hbSDK.storage.setStorage({ key: HISTORY_KEY, data: next });
  } catch (error) {
    void error;
  }
  return next;
}

export async function clearHistory() {
  memoryHistory = [];
  try {
    await hbSDK.storage.setStorage({ key: HISTORY_KEY, data: [] });
  } catch (error) {
    void error;
  }
}

export function describeError(error) {
  const code = (error && error.code) || '';
  if (error instanceof CancelledError || code === 'CANCELLED') return '已取消本次估值。';
  if (code === 'PERMISSION_DENIED') return '缺少 network 权限。请在小黑盒开放平台为本小程序申请 network 权限并获批后再试。';
  if (code === 'PERMISSION_NOT_IN_SNAPSHOT') return '当前小程序版本未声明 network 权限，请重新发布包含权限声明的版本。';
  if (code === 'METHOD_FORBIDDEN') return '当前客户端不支持网络能力，请升级小黑盒客户端后重试。';
  if (code === 'INVALID_PARAMS') return '网络请求参数不合法，请检查输入的链接。';
  if (code === 'RATE_LIMIT' || (error && error.status === 429)) return 'Steam 接口正在限流，请稍后再试，或使用加速器/精确模式少量查询。';
  if (code === 'INVENTORY_PRIVATE' || code === 'INVENTORY_FAILED') return error.message;
  if (code === 'RESOLVE_FAILED' || code === 'INVALID_INPUT') return error.message;
  if (code === 'NETWORK_ERROR') return '网络请求失败。请确认手机网络、加速器以及 network 权限是否生效。';
  return (error && error.message) || '估值失败，请稍后重试。';
}
