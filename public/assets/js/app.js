/**
 * 前端渲染与交互（零依赖）
 * 数据来源：./data/latest.json（由 scripts/fetch.mjs 定时生成）
 */

const PAGE_SIZE = 20;
const REFRESH_INTERVAL = 5 * 60 * 1000;

const state = {
  data: null,
  category: 'all',
  sort: 'heat',
  query: '',
  limit: PAGE_SIZE,
  snapshot: null
};

const $ = (id) => document.getElementById(id);
const catLabel = (id) => state.data?.categories?.find((c) => c.id === id)?.label || id;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || '') ? url : '#';
}

const pad = (n) => String(n).padStart(2, '0');

function fmtClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtFull(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 36e5) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 864e5) return `${Math.floor(diff / 36e5)} 小时前`;
  if (diff < 1728e5) return '昨天';
  const d = new Date(t);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function weekday(iso) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(iso).getDay()];
}

function toast(message, ms = 2400) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove('is-visible'), ms);
}

/* ---------------- 渲染 ---------------- */

function renderSkeleton() {
  $('list').innerHTML = Array.from({ length: 7 })
    .map(
      () => `<li class="skeleton">
        <div class="sk sk--rank"></div>
        <div><div class="sk sk--title"></div><div class="sk sk--line"></div></div>
        <div class="sk sk--heat"></div>
      </li>`
    )
    .join('');
}

function renderHeader() {
  const { data } = state;
  const generated = new Date(data.generatedAt);
  $('heroDate').textContent = `${generated.getFullYear()} 年 ${generated.getMonth() + 1} 月 ${generated.getDate()} 日 · ${weekday(
    generated
  )} · 第 ${String(
    Math.ceil((generated - new Date(generated.getFullYear(), 0, 1)) / 864e5)
  ).padStart(3, '0')} 天`;
  $('brandTagline').textContent = data.site?.tagline || '中外要闻 · 游戏前线';

  const total = data.stats?.total ?? 0;
  const ok = data.stats?.sourcesOk ?? 0;
  const all = data.stats?.sources ?? 0;
  const cats = data.categories?.length ?? 0;

  $('heroStats').innerHTML = [
    { v: total, l: '榜单条目' },
    { v: `${ok}/${all}`, l: '在线信源' },
    { v: cats, l: '内容分类' },
    { v: `${data.stats?.windowHours ?? 48}h`, l: '抓取窗口' }
  ]
    .map((s) => `<div class="stat"><b>${esc(s.v)}</b><span>${esc(s.l)}</span></div>`)
    .join('');

  $('statusText').textContent = `更新于 ${fmtClock(data.generatedAt)} · ${ok}/${all} 源在线`;
  $('generatedLine').textContent = `本榜生成于 ${fmtFull(data.generatedAt)}，每小时自动刷新；历史快照按日归档。`;
  $('buildTime').textContent = fmtFull(data.generatedAt);

  $('heroPreview').innerHTML = `
    <div class="preview__head"><span>榜单速览</span><span>TOP 3</span></div>
    ${data.topics
      .slice(0, 3)
      .map(
        (t) => `<div class="preview__item">
          <span class="preview__rank">${String(t.rank).padStart(2, '0')}</span>
          <span class="preview__title">${esc(t.title)}</span>
        </div>`
      )
      .join('')}`;
}

function renderTabs() {
  const topics = state.data.topics;
  const items = [{ id: 'all', label: '全部', count: topics.length }].concat(
    state.data.categories.map((c) => ({
      id: c.id,
      label: c.label,
      count: topics.filter((t) => t.category === c.id).length
    }))
  );

  $('tabs').innerHTML = items
    .map(
      (item) => `<button class="tab${state.category === item.id ? ' is-active' : ''}"
        role="tab" aria-selected="${state.category === item.id}" data-cat="${item.id}">
        ${esc(item.label)}<span class="tab__count">${item.count}</span>
      </button>`
    )
    .join('');
}

function filteredTopics() {
  const q = state.query.trim().toLowerCase();
  let list = state.data.topics.slice();

  if (state.category !== 'all') list = list.filter((t) => t.category === state.category);
  if (q) {
    list = list.filter((t) => {
      const haystack = [
        t.title,
        t.summary,
        ...(t.sources || []).map((s) => s.name)
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  if (state.sort === 'time') {
    list.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  } else {
    list.sort((a, b) => b.heat - a.heat || a.rank - b.rank);
  }
  return list;
}

function rowHtml(topic, index) {
  const topClass =
    state.sort === 'heat' && index === 0
      ? ' row--top'
      : state.sort === 'heat' && index === 1
        ? ' row--top2'
        : state.sort === 'heat' && index === 2
          ? ' row--top3'
          : '';

  const multi =
    topic.sources.length > 1
      ? `<span class="chip chip--multi">${topic.sources.length} 源印证</span>`
      : '';
  const lang =
    topic.lang === 'en' ? '<span class="chip chip--en" title="英文原文">EN</span>' : '';
  const factorTip = `热度 ${topic.heat} ｜ 时效 ${topic.factors.recency} · 权重 ${topic.factors.authority} · 交叉 ${topic.factors.coverage} · 信号 ${topic.factors.signal}`;

  return `<li class="row${topClass}">
    <div class="row__rank" aria-label="第 ${index + 1} 位">${String(index + 1).padStart(2, '0')}</div>
    <div class="row__body">
      <a class="row__title" href="${esc(safeUrl(topic.url))}" target="_blank" rel="noopener noreferrer"
         lang="${topic.lang === 'en' ? 'en' : 'zh-CN'}">${esc(topic.title)}</a>
      ${topic.summary ? `<p class="row__summary">${esc(topic.summary)}</p>` : ''}
      <div class="row__meta">
        <span class="chip chip--${esc(topic.category)}"><i class="chip__dot"></i>${esc(catLabel(topic.category))}</span>
        <span>${esc(topic.sources[0]?.name || '')}</span>
        <span class="meta__sep">·</span>
        <span title="${esc(fmtFull(topic.publishedAt))}">${esc(relTime(topic.publishedAt))}</span>
        ${multi}${lang}
      </div>
    </div>
    <div class="row__heat" title="${esc(factorTip)}">
      <span class="heat__value">${topic.heat}</span>
      <span class="heat__label">热度</span>
      <span class="meter"><i style="width:${Math.max(3, topic.heat)}%"></i></span>
    </div>
  </li>`;
}

function renderList() {
  const list = filteredTopics();
  const visible = list.slice(0, state.limit);
  const container = $('list');

  if (!list.length) {
    container.innerHTML = '';
    $('emptyState').hidden = false;
    $('moreWrap').hidden = true;
    return;
  }

  $('emptyState').hidden = true;
  container.innerHTML = visible.map((t, i) => rowHtml(t, i)).join('');
  $('moreWrap').hidden = list.length <= state.limit;
  $('moreBtn').textContent = `加载更多（还有 ${list.length - state.limit} 条）`;
}

function renderRadar() {
  const topics = state.data.topics;
  const rows = state.data.categories.map((c) => {
    const list = topics.filter((t) => t.category === c.id);
    const avg = list.length
      ? Math.round(list.reduce((sum, t) => sum + t.heat, 0) / list.length)
      : 0;
    return { ...c, count: list.length, avg };
  });
  const max = Math.max(1, ...rows.map((r) => r.count));

  $('radar').innerHTML = rows
    .map(
      (r) => `<div class="radar__row">
        <span class="radar__name"><i class="chip__dot chip--${r.id}"></i>${esc(r.label)}</span>
        <span class="radar__bar"><i style="width:${Math.round((r.count / max) * 100)}%"></i></span>
        <span class="radar__val">${r.count} · ${r.avg}</span>
      </div>`
    )
    .join('');
}

function renderFlashes() {
  const flashes = state.data.flashes || [];
  $('flashHint').textContent = `${flashes.length} 条`;
  $('flashes').innerHTML = flashes
    .map(
      (f) => `<li class="flash">
        <span class="flash__time">${fmtClock(f.publishedAt)}</span>
        <a class="flash__title" href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener noreferrer">
          ${esc(f.title)}
          <span class="flash__src">${esc(f.source)}</span>
        </a>
      </li>`
    )
    .join('');
}

function renderSources() {
  const list = state.data.sourceStatus || [];
  const ok = list.filter((s) => s.ok).length;
  $('srcHint').textContent = `${ok}/${list.length} 在线`;
  $('sources').innerHTML = list
    .map(
      (s) => `<li class="source${s.ok ? '' : ' source--down'}" title="${esc(
        s.ok ? `最近抓取 ${s.count} 条 / ${s.ms}ms` : `抓取失败：${s.error || '未知原因'}`
      )}">
        <span class="source__dot"></span>
        <span class="source__name">${esc(s.name)}</span>
        <span class="source__count">${s.ok ? s.count : '—'}</span>
      </li>`
    )
    .join('');
}

async function renderArchive() {
  const box = $('archive');
  try {
    const res = await fetch('./data/archive/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('no archive');
    const { dates } = await res.json();
    if (!dates?.length) throw new Error('empty');
    box.innerHTML = dates
      .slice(0, 10)
      .map(
        (d) => `<button type="button" class="archive__day${
          state.snapshot === d.date ? ' is-current' : ''
        }" data-date="${esc(d.date)}" title="${esc(d.total)} 条 · ${esc(d.top || '')}">
          ${esc(d.date.slice(5))}
        </button>`
      )
      .join('');
  } catch {
    box.innerHTML = '<span class="archive__empty">归档将在首次每日构建后生成</span>';
  }
}

function renderAll() {
  renderHeader();
  renderTabs();
  renderList();
  renderRadar();
  renderFlashes();
  renderSources();
  renderArchive();
}

/* ---------------- 数据加载 ---------------- */

async function loadLatest({ silent = false } = {}) {
  const btn = $('refreshBtn');
  if (!silent) btn.classList.add('is-spinning');
  try {
    const res = await fetch(`./data/latest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const changed = !state.data || data.generatedAtMs !== state.data.generatedAtMs;
    state.data = data;
    state.snapshot = null;
    $('snapshotBanner').hidden = true;
    if (changed) {
      document.title = `${data.topics[0]?.title.slice(0, 24) || '热点'} · 热点聚合`;
      renderAll();
    }
    if (silent && changed) toast(`已更新至 ${fmtClock(data.generatedAt)} 的榜单`);
  } catch (error) {
    console.error(error);
    if (!state.data) {
      $('list').innerHTML = '';
      $('emptyState').hidden = false;
      $('emptyState').querySelector('.list__empty-title').textContent = '数据加载失败';
      $('emptyState').querySelector('.list__empty-hint').textContent =
        '请检查网络或稍后重试；若为本地预览，请先执行 npm run fetch 生成数据。';
      $('statusText').textContent = '数据不可用';
    } else if (!silent) {
      toast('刷新失败，已保留当前数据');
    }
  } finally {
    btn.classList.remove('is-spinning');
  }
}

async function loadSnapshot(date) {
  try {
    const res = await fetch(`./data/archive/${date}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error('missing');
    const snap = await res.json();
    state.snapshot = date;
    state.data = {
      ...snap,
      categories: state.data.categories,
      sourceStatus: [],
      flashes: [],
      stats: { ...snap.stats, sources: 0, sourcesOk: 0 }
    };
    state.limit = PAGE_SIZE;
    renderAll();
    $('snapshotBanner').hidden = false;
    $('snapshotText').textContent = `正在查看 ${date} 的历史快照（${snap.topics.length} 条，仅保留前 40 条）`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    toast('该日期的归档不存在');
  }
}

/* ---------------- 事件 ---------------- */

function bindEvents() {
  $('tabs').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-cat]');
    if (!btn) return;
    state.category = btn.dataset.cat;
    state.limit = PAGE_SIZE;
    renderTabs();
    renderList();
    history.replaceState(null, '', state.category === 'all' ? location.pathname : `#${state.category}`);
  });

  $('sortToggle').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-sort]');
    if (!btn) return;
    state.sort = btn.dataset.sort;
    [...$('sortToggle').children].forEach((b) => b.classList.toggle('is-active', b === btn));
    state.limit = PAGE_SIZE;
    renderList();
  });

  let searchTimer;
  $('searchInput').addEventListener('input', (event) => {
    const value = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = value;
      state.limit = PAGE_SIZE;
      renderList();
    }, 120);
  });

  $('searchInput').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.target.value = '';
      state.query = '';
      renderList();
      event.target.blur();
    }
  });

  $('searchBox').addEventListener('click', (event) => {
    if (window.innerWidth <= 640 && !$('searchBox').classList.contains('is-open')) {
      event.preventDefault();
      $('searchBox').classList.add('is-open');
      $('searchInput').focus();
    }
  });

  document.addEventListener('click', (event) => {
    const box = $('searchBox');
    if (
      window.innerWidth <= 640 &&
      box.classList.contains('is-open') &&
      !box.contains(event.target)
    ) {
      box.classList.remove('is-open');
    }
  });

  $('moreBtn').addEventListener('click', () => {
    state.limit += PAGE_SIZE;
    renderList();
  });

  $('refreshBtn').addEventListener('click', async () => {
    await loadLatest({ silent: false });
    if (state.data) toast(`数据时间 ${fmtClock(state.data.generatedAt)}`);
  });

  $('themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('newshub-theme', next);
    } catch {
      /* 忽略隐私模式下的存储异常 */
    }
  });

  $('archive').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-date]');
    if (btn) loadSnapshot(btn.dataset.date);
  });

  $('snapshotBack').addEventListener('click', () => loadLatest());

  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    if (event.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      event.preventDefault();
      $('searchBox').classList.add('is-open');
      $('searchInput').focus();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !state.snapshot) loadLatest({ silent: true });
  });

  setInterval(() => {
    if (document.visibilityState === 'visible' && !state.snapshot) loadLatest({ silent: true });
  }, REFRESH_INTERVAL);

  setInterval(() => {
    if (state.data && !state.snapshot) renderList();
  }, 60_000);
}

function initTheme() {
  const urlTheme = new URLSearchParams(location.search).get('theme');
  let theme = ['light', 'dark'].includes(urlTheme) ? urlTheme : null;
  try {
    theme = theme || localStorage.getItem('newshub-theme');
  } catch {
    /* noop */
  }
  if (!theme) {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
}

function initHash() {
  const hash = location.hash.replace('#', '');
  if (hash && ['china', 'world', 'tech', 'game'].includes(hash)) state.category = hash;
}

initTheme();
initHash();
bindEvents();
renderSkeleton();
loadLatest();
