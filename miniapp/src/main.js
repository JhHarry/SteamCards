import hbSDK from '@heybox/hb-sdk';
import './styles.css';
import {
  resolveSteamId,
  fetchInventory,
  priceCards,
  createCancelSignal,
  loadHistory,
  saveHistory,
  clearHistory,
  clearPriceCache,
  summarize,
  describeError,
  CancelledError
} from './steam.js';

const byId = (id) => document.getElementById(id);

const views = {
  home: byId('view-home'),
  progress: byId('view-progress'),
  results: byId('view-results')
};

const state = {
  busy: false,
  signal: null,
  rows: [],
  summary: null,
  mode: 'quick',
  steamid: '',
  history: [],
  historyOnly: false,
  userSteamId: '',
  accountLoaded: false
};

function showView(name) {
  for (const key of Object.keys(views)) {
    views[key].hidden = key !== name;
  }
  if (name === 'results') window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setProgress(percent, text, detail, countText) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  byId('progress-fill').style.width = clamped + '%';
  byId('progress-percent').textContent = clamped + '%';
  if (text) byId('progress-text').textContent = text;
  if (detail != null) byId('progress-detail').textContent = detail;
  if (countText != null) byId('progress-count').textContent = countText;
}

function showError(message) {
  const error = byId('error-text');
  error.textContent = message || '';
  if (message) byId('approval-hint').hidden = true;
}

function showApprovalHint() {
  byId('approval-hint').hidden = false;
}

function toast(message, status) {
  Promise.resolve(hbSDK.ui.showToast({ message, status })).catch(() => {
    showError(message);
  });
}

function money(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function dateText(seconds) {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function modeText(mode) {
  if (mode === 'demo') return '演示数据';
  return mode === 'exact' ? '精确逐卡价' : '快速参考价';
}

function setStartBusy(busy) {
  state.busy = busy;
  const btn = byId('start-btn');
  btn.disabled = busy;
  btn.textContent = busy ? '估值中...' : '用它估值';
  const oneClick = byId('oneclick-btn');
  oneClick.disabled = busy;
  oneClick.textContent = busy ? '估值中...' : '▶ 一键估值我的库存';
}

function hideAccountLoading() {
  byId('account-loading').hidden = true;
}

function showManualAccount(hint) {
  hideAccountLoading();
  byId('account-ready').hidden = true;
  byId('account-hint').hidden = !hint;
  byId('account-hint').textContent = hint || '';
  byId('oneclick-btn').hidden = true;
  byId('show-manual-btn').hidden = true;
  byId('manual-panel').hidden = false;
}

function showBoundAccount(userInfo, steamId) {
  hideAccountLoading();
  const profile = userInfo && userInfo.profile;
  const avatar = byId('account-avatar');
  const avatarUrl = profile && profile.avatar;
  if (avatarUrl) {
    avatar.src = avatarUrl;
    avatar.hidden = false;
  } else {
    avatar.hidden = true;
  }
  byId('account-name').textContent = (profile && profile.nickname) ? profile.nickname : '小黑盒用户';
  byId('account-steamid').textContent = 'SteamID ' + steamId;
  byId('account-ready').hidden = false;
  byId('account-hint').hidden = true;
  byId('oneclick-btn').hidden = false;
  byId('show-manual-btn').hidden = false;
  byId('manual-panel').hidden = true;
  state.userSteamId = steamId;
}

async function loadAccount() {
  try {
    const result = await hbSDK.user.getInfo();
    state.accountLoaded = true;
    if (!result.isHeyboxAppLoggedIn) {
      showManualAccount('未登录小黑盒账号。可以手动输入 SteamID 或个人资料链接。');
      return;
    }
    if (!result.userInfo) {
      showManualAccount('未获取到小黑盒账号资料。可以手动输入 SteamID 或个人资料链接。');
      return;
    }
    const steamId = result.userInfo.steam_id ? String(result.userInfo.steam_id) : '';
    if (!steamId) {
      const profile = result.userInfo.profile;
      const name = profile && profile.nickname ? profile.nickname : '小黑盒账号';
      showManualAccount(name + ' 未返回绑定的 SteamID。请在小黑盒中绑定 Steam 账号，或手动输入 SteamID/链接。');
      return;
    }
    showBoundAccount(result.userInfo, steamId);
  } catch (error) {
    state.accountLoaded = true;
    const hint = error && error.code === 'PERMISSION_NOT_IN_SNAPSHOT'
      ? '当前版本未声明 userInfo 权限，无法读取小黑盒账号。请更新小程序版本或手动输入。'
      : '无法读取小黑盒账号资料：' + ((error && error.message) || '未知错误') + '。可以手动输入 SteamID 或个人资料链接。';
    showManualAccount(hint);
  }
}

function startOneClick() {
  if (!state.userSteamId || state.busy) return;
  byId('steamid').value = state.userSteamId;
  byId('mode').value = 'quick';
  byId('limit').value = '0';
  runValuation();
}

async function renderHistory() {
  state.history = await loadHistory();
  const section = byId('history-section');
  const list = byId('history-list');
  list.replaceChildren();
  if (!state.history.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  for (const entry of state.history) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'history-row';
    const left = document.createElement('div');
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = 'SteamID ' + entry.steamid + ' · ' + modeText(entry.mode);
    const sub = document.createElement('div');
    sub.className = 'history-sub';
    sub.textContent = dateText(entry.at) + ' · ' + entry.summary.types + ' 种 / ' + entry.summary.copies + ' 张';
    left.appendChild(meta);
    left.appendChild(sub);
    const amount = document.createElement('div');
    amount.className = 'history-amount';
    amount.textContent = '¥' + money(entry.summary.gross);
    row.appendChild(left);
    row.appendChild(amount);
    row.addEventListener('click', () => {
      showResult(entry.summary, [], entry.mode, true);
    });
    list.appendChild(row);
  }
}

function renderResultRows() {
  const needle = byId('result-search').value.trim().toLowerCase();
  const list = byId('result-list');
  list.replaceChildren();
  const rows = state.rows.filter((row) => {
    if (!needle) return true;
    return row.name.toLowerCase().includes(needle) || row.game.toLowerCase().includes(needle);
  });
  byId('result-count').textContent = state.historyOnly
    ? '历史汇总'
    : rows.length + ' / ' + state.rows.length + ' 种';

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = state.historyOnly
      ? '历史记录仅保存汇总，卡牌明细需重新估值后查看。'
      : '没有匹配的卡牌，试试调整搜索关键词。';
    list.appendChild(empty);
    return;
  }

  for (const row of rows.slice(0, 300)) {
    const item = document.createElement('div');
    item.className = 'card-row';
    const main = document.createElement('div');
    main.className = 'card-main';
    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = row.name;
    const game = document.createElement('div');
    game.className = 'card-game';
    game.textContent = row.game + ' · ×' + row.count + (row.foil ? ' · 闪亮' : '');
    main.appendChild(name);
    main.appendChild(game);
    const price = document.createElement('div');
    price.className = 'card-price';
    const value = document.createElement('strong');
    const sub = document.createElement('small');
    if (row.status === 'ok') {
      value.textContent = '¥' + money(row.total);
      sub.textContent = (row.count > 1 ? '单价 ¥' + money(row.unit) : '单价');
    } else {
      value.className = 'card-unpriced';
      value.textContent = row.status === 'not_marketable' ? '不可售' : '未获取';
      sub.textContent = row.count > 1 ? '×' + row.count : ' ';
    }
    price.appendChild(value);
    price.appendChild(sub);
    item.appendChild(main);
    item.appendChild(price);
    list.appendChild(item);
  }
}

function showResult(summary, rows, mode, historyOnly) {
  state.summary = summary;
  state.rows = rows;
  state.mode = mode;
  state.historyOnly = Boolean(historyOnly);
  byId('sum-gross').textContent = '¥' + money(summary.gross);
  byId('sum-gross-sub').textContent = summary.types + ' 种 / ' + summary.copies + ' 张';
  byId('sum-net').textContent = '¥' + money(summary.net);
  byId('sum-types').textContent = String(summary.types);
  byId('sum-copies').textContent = String(summary.copies);
  byId('sum-priced').textContent = String(summary.priced);
  byId('sum-unpriced').textContent = String(summary.unpriced);
  byId('result-mode').textContent = historyOnly ? '历史汇总' : modeText(mode);
  byId('result-search').value = '';
  renderResultRows();
  showView('results');
}

async function runValuation() {
  if (state.busy) return;
  const input = byId('steamid').value.trim();
  if (!input) {
    showError('请输入 SteamID64 或个人资料链接');
    return;
  }
  const mode = byId('mode').value === 'exact' ? 'exact' : 'quick';
  const limitValue = Math.max(0, Math.floor(Number(byId('limit').value) || 0));
  state.signal = createCancelSignal();
  setStartBusy(true);
  byId('cancel-btn').disabled = false;
  showError('');
  showView('progress');
  setProgress(2, '正在解析 Steam 账号...', '支持 SteamID64、profiles 或 /id/ 自定义链接', '');
  try {
    const steamid = await resolveSteamId(input);
    state.steamid = steamid;
    setProgress(6, '正在读取库存...', 'SteamID64: ' + steamid, '');
    const inventory = await fetchInventory(steamid, state.signal, (progress) => {
      setProgress(12, progress.message, '仅读取公开库存，不上传账号数据', '第 ' + progress.page + ' 页');
    });
    let cards = inventory.cards;
    if (!cards.length) {
      throw new Error('库存中没有找到集换式卡牌，或库存未公开。');
    }
    if (limitValue > 0) cards = cards.slice(0, limitValue);
    setProgress(18, '库存读取完成', '共 ' + cards.length + ' 种卡牌 / ' + cards.reduce((sum, card) => sum + card.count, 0) + ' 张，准备取价', cards.length + ' 种');
    const result = await priceCards(cards, mode, state.signal, (progress) => {
      const ratio = progress.total > 0 ? progress.done / progress.total : 0;
      setProgress(20 + ratio * 72, progress.message, mode === 'quick' ? '批量市场参考价，结果会有一定误差' : '逐卡精确价，速度受 Steam 限流影响', progress.done + ' / ' + progress.total);
    });
    setProgress(96, '正在整理结果...', '', '');
    const summary = result.summary;
    const history = await saveHistory({
      at: Math.floor(Date.now() / 1000),
      steamid,
      mode: result.mode,
      summary
    });
    state.history = history;
    setProgress(100, '估值完成', summary.priced + ' 种已定价，' + summary.unpriced + ' 种未定价', '');
    showResult(summary, result.rows, result.mode, false);
    await renderHistory();
    if (summary.priced === 0) {
      toast('没有获取到有效价格，可尝试加速器或稍后再试', 'error');
    } else {
      toast('估值完成', 'success');
    }
  } catch (error) {
    const message = describeError(error);
    showView('home');
    showError(message);
    if (error instanceof CancelledError || error.code === 'CANCELLED') {
      toast('已取消');
      return;
    }
    if (error.code === 'PERMISSION_DENIED' || error.code === 'PERMISSION_NOT_IN_SNAPSHOT') {
      showApprovalHint();
    }
    toast(message, 'error');
  } finally {
    setStartBusy(false);
    state.signal = null;
  }
}

function cancelValuation() {
  if (!state.signal) return;
  state.signal.cancel();
  byId('cancel-btn').disabled = true;
  byId('progress-text').textContent = '正在取消...';
}

function bindEvents() {
  byId('start-btn').addEventListener('click', runValuation);
  byId('cancel-btn').addEventListener('click', cancelValuation);
  byId('back-home-btn').addEventListener('click', () => {
    showView('home');
    renderHistory();
  });
  byId('result-search').addEventListener('input', renderResultRows);
  byId('oneclick-btn').addEventListener('click', startOneClick);
  byId('show-manual-btn').addEventListener('click', () => {
    byId('manual-panel').hidden = false;
    byId('show-manual-btn').hidden = true;
    byId('steamid').focus();
  });
  byId('demo-btn').addEventListener('click', () => {
    const names = ['Voltaic1', 'Wildlife1', 'Amicia', 'Arthur', 'Béatrice', 'Fishing', 'Grenade Bros', 'Stone Vanguard'];
    const games = ['Counter-Strike 2', 'Dota 2', 'A Plague Tale: Innocence', 'A Plague Tale: Innocence', 'A Plague Tale: Innocence', 'A Way Out', 'A Way Out', 'Black Myth: Wukong'];
    const rows = names.map((name, index) => {
      const count = index === 1 ? 2 : 1;
      const unit = Math.round((0.4 + index * 0.37) * 100) / 100;
      return {
        hash: 'demo-' + index,
        name,
        game: games[index],
        appid: '0',
        foil: index === 1,
        count,
        marketable: true,
        unit,
        total: Math.round(unit * count * 100) / 100,
        status: 'ok'
      };
    });
    const summary = summarize(rows);
    showResult(summary, rows, 'demo', false);
    byId('approval-hint').hidden = true;
  });
  byId('clear-cache-btn').addEventListener('click', async () => {
    await clearPriceCache();
    toast('价格缓存已清空', 'success');
  });
  byId('clear-history-btn').addEventListener('click', async () => {
    await clearHistory();
    state.history = [];
    await renderHistory();
    toast('历史结果已清空');
  });
  byId('steamid').addEventListener('input', () => showError(''));
}

async function boot() {
  bindEvents();
  try {
    await hbSDK.viewport.setNavigationBarStyle({ foregroundStyle: 'light' });
  } catch (error) {
    void error;
  }
  await Promise.all([renderHistory(), loadAccount()]);
}

boot();