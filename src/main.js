/* 应用入口：装配数据、路由、渲染与全局交互 */

import { createStore, createRemoteStore } from './state/store.js';
import { api, auth, files as fileApi } from './api/client.js';
import * as cloudAuth from './api/cloudAuth.js';
import * as A from './state/actions.js';
import * as S from './state/selectors.js';
import { routeOf, href, navigate, absoluteShare } from './router.js';
import { $, setHTML, delegate } from './lib/dom.js';
import { esc, shanghaiDate, formatDateTime } from './lib/format.js';
import { renderMarkdown } from './lib/markdown.js';
import { bookmarkSheet, todayEntry } from './components/bookmark.js';
import { icon } from './lib/icons.js';
import { GROWTH_RULES } from './data/growth.js';
import { renderHeader, renderMobileNav, renderDemoStrip, renderFooter } from './components/layout.js';
import pageRegistry from './pages/index.js';

const config = window.__GONGYE_CONFIG__ || {};
const isRemote = config.mode === 'production';
// 云服务邮箱验证码：前端拿云端证明，后端换成站点会话
const isCloudAuth = isRemote && config.authMode === 'cloud';
const store = isRemote ? createRemoteStore() : createStore({ key: config.storageKey });

const viewEl = $('#view');
const headerEl = $('#site-header');
const navEl = $('#mobile-nav');
const footerEl = $('#site-footer');
const overlayEl = $('#overlay');

/* 仅在本次会话内使用的界面状态（不写入持久数据） */
const ui = {
  replyTarget: null,
  compose: null,
  pendingConfirm: null,
  images: [],
  files: [],
  toastTimer: 0
};

const COMPOSE_DRAFT_KEY = 'gongye-compose-draft';
const MAX_POST_IMAGE_COUNT = 9;
// 原图上限：手机照片会先压缩，压缩后的大小才计入
const MAX_IMAGE_FILE_BYTES = 25 * 1024 * 1024;
const IMAGE_MAX_SIDE = 1920;
// 静态演示版把图片存进浏览器本地存储，只能给很小的总量；试用后端逐张上传，不受这个限制
const MAX_POST_IMAGE_BYTES = 800 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
let pendingImageCount = 0;
let imageReadGeneration = 0;
let directMessagePollTimer = 0;
let directMessagePollBusy = false;

const ctx = {
  config,
  db: null,
  me: null,
  route: null,
  ui,
  after: [],
  invoke,
  once,
  refresh: () => refreshPreserving(),
  navigate,
  requireLogin,
  openModal,
  closeModal,
  toast,
  downloadFile,
  copyText
};

const seenOnce = new Set();
function once(key, fn) {
  if (seenOnce.has(key)) return;
  seenOnce.add(key);
  ctx.after.push(fn);
}

/* ---------- 渲染 ---------- */

let lastPath = null;
let lastSearch = null;
let tabTimer = 0;
let staggerTimer = 0;
const scrollMemory = new Map();
let lastDetail = null;
let vtSourceEl = null;

const isTouchPointer = () => !!(window.matchMedia && (
  window.matchMedia('(pointer: coarse)').matches
  || (window.matchMedia('(hover: none)').matches && (navigator.maxTouchPoints || 0) > 0)
));

const prefersReducedMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const isDetailRoute = (route) => route.name === 'resource' || route.name === 'post';

function tagForTransition(el) {
  if (el) el.style.viewTransitionName = 'gy-card';
}

function clearTransitionNames() {
  viewEl.querySelectorAll('[style*="view-transition-name"]').forEach((el) => {
    el.style.viewTransitionName = '';
  });
  if (vtSourceEl) {
    vtSourceEl.style.viewTransitionName = '';
    vtSourceEl = null;
  }
}

function detailCardInView() {
  return viewEl.querySelector('.layout-2 > main > .card, .layout-1 > .card');
}

/** 只重绘头部与底部导航；共享元素过渡期间由它接管，避免整页重排 */
/** 过渡开始前等图片解码，避免头像/预览在动画中途补出来 */
async function settleImages(root) {
  const images = Array.from(root.querySelectorAll('img')).filter((img) => !img.complete);
  if (!images.length) return;
  await Promise.race([
    Promise.allSettled(images.map((img) => (img.decode ? img.decode().catch(() => {}) : null))),
    new Promise((resolve) => setTimeout(resolve, 60))
  ]);
}

/** 统一处理路由变化：滚动记忆、共享元素过渡、返回焦点 */
function applyRouteChange(next) {
  const prevPath = lastPath;
  const changedPath = next.path !== prevPath;
  const queryKey = JSON.stringify(next.query || {});
  const queryChanged = queryKey !== lastSearch;
  const onlyOffsetChanged = sameExceptOffset(lastSearch, next.query);
  scrollMemory.set(prevPath, window.scrollY);

  lastPath = next.path;
  lastSearch = queryKey;
  ui.replyTarget = null;
  ui.freshCommentId = null;
  if (next.name !== 'compose' && next.name !== 'resourcePublish') {
    discardPendingImages();
    ui.images = [];
    ui.files = [];
  }
  if (next.name !== 'compose') ui.composeDraftLoaded = false;
  if (next.name !== 'resources') ui.filtersOpen = false;

  if (!changedPath) {
    // 同一路径只换了 tab / 筛选：用卡片入场代替瞬移；“加载更多”是追加，不重播入场
    render({ preserve: true, animate: queryChanged && !onlyOffsetChanged ? 'tab' : null });
    return;
  }

  const enteringDetail = isDetailRoute(next);
  const leavingDetail = !!lastDetail && !enteringDetail;
  const detailId = lastDetail ? lastDetail.id : null;
  const sourceTop = Number.isFinite(ui.vtSourceTop) ? ui.vtSourceTop : null;

  if (leavingDetail) tagForTransition(detailCardInView());

  const useVT = typeof document.startViewTransition === 'function'
    && !prefersReducedMotion() && !isTouchPointer();

  const run = () => {
    // 共享元素过渡时不要再叠加页面淡入：它会在过渡结束、data-vt 撤掉的瞬间从 0 重播，造成整页闪白
    render({ enter: useVT || isTouchPointer() ? null : 'route', keepScroll: false });

    if (enteringDetail) {
      const card = detailCardInView();
      tagForTransition(card);
      lastDetail = { path: next.path, id: next.params.id, kind: next.name };
      if (card) {
        // 让详情卡顶部落在来源卡附近的高度，避免“一打开就跳到顶部”
        const top = card.getBoundingClientRect().top;
        const desired = Math.min(Math.max(sourceTop == null ? 96 : sourceTop, 24), 120);
        const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo(0, Math.min(Math.max(0, top - desired), max));
        if (isTouchPointer() && !prefersReducedMotion()) {
          card.classList.add('is-sheet-in');
          window.setTimeout(() => card.classList.remove('is-sheet-in'), 300);
        }

      } else {
        window.scrollTo(0, 0);
      }
      if (next.query.focus === 'comments') jumpToComments({ smooth: false });
      return;
    }

    const saved = scrollMemory.get(next.path);
    window.scrollTo(0, saved != null ? saved : 0);
    if (next.name === 'search' && !next.query.q) {
      const input = viewEl.querySelector('#search-q');
      if (input) input.focus({ preventScroll: true });
    }

    if (leavingDetail && detailId) {
      const card = viewEl.querySelector(`[data-card-id="${detailId}"]`);
      tagForTransition(card);
      if (card) {
        const link = card.querySelector('a');
        if (link) link.focus({ preventScroll: true });
      }
    }
    lastDetail = null;

  };

  if (useVT) {
    window.__gyMotion = window.__gyMotion || { routeTransitions: 0 };
    window.__gyMotion.routeTransitions += 1;
    window.__gyMotion.lastStart = performance.now();
    window.__gyMotion.lastDir = enteringDetail ? 'open' : 'close';
    document.documentElement.dataset.vt = '1';
    document.documentElement.dataset.vtDir = enteringDetail ? 'open' : 'close';
    const transition = document.startViewTransition(async () => {
      run();
      if (enteringDetail) await settleImages(viewEl);
    });
    transition.finished.finally(() => {
      if (window.__gyMotion) window.__gyMotion.lastEnd = performance.now();
      delete document.documentElement.dataset.vt;
      delete document.documentElement.dataset.vtDir;
      clearTransitionNames();
    }).catch(() => {
      // 连续快速导航会让浏览器以 AbortError 跳过上一次过渡，属预期行为，不应冒到控制台
    });
  } else {
    run();
    clearTransitionNames();
  }
  ui.vtSourceTop = null;
}

function sameExceptOffset(previousKey, query) {
  const strip = ({ offset, ...rest }) => JSON.stringify(rest);
  try {
    return strip(JSON.parse(previousKey || '{}')) === strip(query || {});
  } catch {
    return false;
  }
}

/** 定位到讨论区。不用 #comments 锚点：hash 已被路由占用，锚点会被当成新页面。 */
function jumpToComments({ smooth = true, focus = false } = {}) {
  const section = viewEl.querySelector('#comments');
  if (!section) return;
  section.scrollIntoView({ block: 'start', behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' });
  if (focus) {
    const area = section.querySelector('textarea');
    if (area) area.focus({ preventScroll: true });
  }
}

let fselBound = false;

function closeAllFsel() {
  document.querySelectorAll('.fsel.is-open').forEach((wrap) => {
    wrap.classList.remove('is-open');
    const menu = wrap.querySelector('.fsel-menu');
    if (menu) menu.hidden = true;
    const btn = wrap.querySelector('.fsel-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

/** 把筛选栏里的原生 select 增强为可美术化的下拉面板 */
function enhanceFilterSelects(root) {
  if (!fselBound) {
    document.addEventListener('click', () => closeAllFsel());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeAllFsel();
    });
    fselBound = true;
  }
  root.querySelectorAll('select.select').forEach((select) => {
    if (select.dataset.fsel === '1') return;
    select.dataset.fsel = '1';
    const wrap = document.createElement('div');
    wrap.className = 'fsel';
    if (select.style.maxWidth) wrap.style.maxWidth = select.style.maxWidth;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fsel-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = 'fsel-value';
    const caret = document.createElement('span');
    caret.className = 'fsel-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▾';
    btn.append(label, caret);
    const menu = document.createElement('div');
    menu.className = 'fsel-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'listbox');
    const options = Array.from(select.options);
    const sync = () => {
      const current = options.find((option) => option.value === select.value) || options[0];
      label.textContent = current ? current.textContent : '';
      options.forEach((option, index) => {
        const item = menu.children[index];
        if (item) item.setAttribute('aria-selected', option.value === select.value ? 'true' : 'false');
      });
    };
    const close = () => {
      wrap.classList.remove('is-open');
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      closeAllFsel();
      wrap.classList.add('is-open');
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    };
    options.forEach((option) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'fsel-opt';
      item.setAttribute('role', 'option');
      const text = document.createElement('span');
      text.textContent = option.textContent;
      const tick = document.createElement('span');
      tick.className = 'fsel-check';
      tick.setAttribute('aria-hidden', 'true');
      tick.textContent = '✓';
      item.append(text, tick);
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        select.value = option.value;
        sync();
        close();
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      menu.append(item);
    });
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (menu.hidden) open(); else close();
    });
    wrap.append(btn, menu);
    select.parentNode.insertBefore(wrap, select);
    wrap.append(select);
    select.classList.add('fsel-native');
    sync();
  });
}
function render(options = {}) {
  ctx.db = store.getState();
  if (!ctx.db) {
    setHTML(viewEl, `<div class="layout-1"><div class="card">
      <h2>正在连接试用服务器…</h2>
      <p class="small secondary mt-2">如果一直停在这里，请确认后台服务已启动，然后刷新页面。</p>
    </div></div>`);
    return;
  }
  ctx.me = S.currentUser(ctx.db);
  ctx.route = routeOf();
  syncDirectMessagePolling();
  if (ctx.route.name === 'compose' && ctx.me && !ui.composeDraftLoaded) restoreComposeDraft();

  const scrollY = options.keepScroll === false ? 0 : window.scrollY;
  const page = pageRegistry[ctx.route.name] || pageRegistry.notFound;
  ctx.after = [];
  let html = '';
  try {
    html = page(ctx);
  } catch (error) {
    console.error('[page] render failed', error);
    html = `<div class="layout-1"><div class="card">
      <h2>这个页面渲染失败了</h2>
      <p class="small secondary mt-2">已捕获错误，界面其他入口仍可继续使用。错误信息：</p>
      <pre class="mt-2" style="white-space:pre-wrap;font-size:12.5px">${esc(String(error && error.message ? error.message : error))}</pre>
      <div class="row mt-3"><a class="btn btn-sm" href="#/">回到找资料</a></div>
    </div></div>`;
  }

  setHTML(viewEl, html);
  enhanceFilterSelects(viewEl);
  syncCounters();
  setHTML(headerEl, renderHeader(ctx));
  setHTML(navEl, renderMobileNav(ctx));
  if (footerEl && !footerEl.innerHTML) setHTML(footerEl, renderFooter());

  if (options.enter === 'route') {
    viewEl.dataset.enter = 'route';
    const firstCards = Array.from(viewEl.querySelectorAll('.res-card, .post-card')).slice(0, 6);
    firstCards.forEach((card, index) => {
      card.classList.add('stagger-in');
      card.style.setProperty('--stagger', String(index));
    });
    clearTimeout(staggerTimer);
    staggerTimer = window.setTimeout(() => {
      delete viewEl.dataset.enter;
      firstCards.forEach((card) => card.classList.remove('stagger-in'));
    }, 320);
  }

  if (options.animate === 'tab') {
    viewEl.dataset.enter = 'tab';
    clearTimeout(tabTimer);
    tabTimer = window.setTimeout(() => {
      delete viewEl.dataset.enter;
    }, 260);
  }

  updateDocumentMeta(ctx);
  restoreScroll(scrollY);

  const callbacks = ctx.after.slice();
  ctx.after = [];
  callbacks.forEach((fn) => {
    try {
      fn();
    } catch (error) {
      console.error('[page] after-render failed', error);
    }
  });

  const stripMarkup = renderDemoStrip(ctx);
  const existingStrip = document.getElementById('demo-strip');
  if (!stripMarkup) {
    existingStrip?.remove();
  } else {
    const strip = existingStrip || document.createElement('div');
    strip.id = 'demo-strip';
    setHTML(strip, stripMarkup);
    if (!existingStrip) headerEl.after(strip);
  }
}

function syncDirectMessagePolling() {
  const shouldPoll = isRemote && !!ctx.me && ctx.route && ctx.route.name === 'messages'
    && ctx.route.query.tab === 'direct';
  if (!shouldPoll) {
    if (directMessagePollTimer) window.clearInterval(directMessagePollTimer);
    directMessagePollTimer = 0;
    return;
  }
  if (directMessagePollTimer) return;
  directMessagePollTimer = window.setInterval(async () => {
    if (document.hidden || directMessagePollBusy) return;
    directMessagePollBusy = true;
    try {
      const response = await api.getState();
      store.setState(response.state);
    } catch (error) {
      console.warn('[direct messages] refresh failed', error);
    } finally {
      directMessagePollBusy = false;
    }
  }, 12_000);
}

function restoreScroll(y) {
  if (!y) return;
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo(0, Math.min(y, max));
}

function updateDocumentMeta(context) {
  const { db, route } = context;
  const fallback = '共页 · 找资料与课友圈';
  const titles = {
    resourcesHome: '找资料 · 共页',
    resources: '全部资料 · 找资料 · 共页',
    resourcePublish: '分享资料 · 找资料 · 共页',
    circles: '我的课友圈 · 共页',
    findCircles: '找课 / 加入课友圈 · 共页',
    compose: '发一篇学习帖子 · 共页',
    postEdit: '编辑内容 · 共页',
    login: '登录 · 共页',
    saved: '我的收藏 · 共页',
    messages: '消息 · 共页',
    wallet: '我的页签 · 共页',
    settings: '账号设置 · 共页',
    admin: '管理后台 · 共页',
    about: '关于共页 · 共页',
    terms: '用户协议 · 共页',
    privacy: '隐私政策 · 共页',
    notFound: '页面不存在 · 共页'
  };
  let title = titles[route.name] || fallback;
  let description = '共页：按课程与用途找到可预览的学习资料，也找到一起上这门课的同学。';

  if (route.name === 'resource') {
    const resource = S.resourceOf(db, route.params.id);
    if (resource) {
      title = `${resource.title} · 找资料 · 共页`;
      description = `${resource.coverage || resource.title}（${resource.school} ${resource.type}）`;
    }
  } else if (route.name === 'post') {
    const post = S.postOf(db, route.params.id);
    if (post) title = `${post.title || '帖子'} · 共页`;
  } else if (route.name === 'invite') {
    title = '邀请加入课友圈 · 共页';
  } else if (route.name === 'circle') {
    const circle = S.circleOf(db, route.params.id);
    if (circle) title = `${S.circleLabel(db, circle)} · 课友圈 · 共页`;
  } else if (route.name === 'course') {
    const course = S.courseOf(db, route.params.id);
    if (course) title = `${course.name} · 课程 · 共页`;
  } else if (route.name === 'profile') {
    const targetId = route.params.id === 'me' ? (context.me ? context.me.id : '') : route.params.id;
    const user = S.userOf(db, targetId);
    if (user) title = `${user.nickname} 的主页 · 共页`;
  } else if (route.name === 'search') {
    title = route.query.q ? `搜索：${route.query.q} · 共页` : '搜索 · 共页';
  }

  document.title = title;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', description);
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute('content', title);
}

/* ---------- 调用业务动作 ---------- */

function snapshotFields() {
  const map = new Map();
  viewEl.querySelectorAll('input, textarea, select').forEach((el) => {
    if (!el.name) return;
    const key = fieldKey(el);
    map.set(key, el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value);
  });
  return map;
}

function fieldKey(el) {
  const form = el.closest('form');
  return `${form ? form.dataset.form || form.id || 'form' : 'free'}::${el.name}`;
}

function restoreFields(map) {
  if (!map || !map.size) return;
  viewEl.querySelectorAll('input, textarea, select').forEach((el) => {
    if (!el.name) return;
    const key = fieldKey(el);
    if (!map.has(key)) return;
    const value = map.get(key);
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!value;
    else if (el.value === '') el.value = value;
  });
}

async function invoke(actionName, payload = {}, options = {}) {
  const snapshot = captureUiState();
  const action = A[actionName];

  if (!isRemote && typeof action !== 'function') {
    toast(`未实现的动作：${actionName}`, 'error');
    return { ok: false, message: '未实现的动作' };
  }

  let result;
  try {
    if (isRemote) {
      // 试用版：所有写入都交给服务端执行，浏览器只拿回结果与最新状态
      const response = await api.action(actionName, payload);
      store.setState(response.state);
      result = response.result;
      // 跨域名部署时靠这个 token 维持登录（同域名下 Cookie 也有效）
      if (result && result.ok && result.data && result.data.token) auth.set(result.data.token);
    } else {
      store.commit((db) => {
        result = action(db, payload);
        return result;
      });
    }
  } catch (error) {
    console.error('[action] failed', actionName, error);
    const message = error && error.message ? error.message : '未知错误';
    if (!options.quiet) toast(`操作失败：${message}`, 'error');
    restoreUiState(snapshot);
    return { ok: false, code: (error && error.code) || 'exception', message };
  }
  restoreUiState(snapshot);
  if (result && result.message && !options.quiet && !(options.silent && result.ok)) toast(result.message, result.ok ? 'ok' : 'error');
  if (result && result.ok && result.data && result.data.levelUp) {
    const up = result.data.levelUp;
    window.setTimeout(() => toast(`升到 LV.${up.to} ${up.name} 了`, 'ok'), 900);
  }
  return result;
}

function captureUiState() {
  const activeEl = document.activeElement;
  return {
    fields: snapshotFields(),
    active: activeEl && activeEl.name ? fieldKey(activeEl) : null
  };
}

/* 模板里已经写了“/ 上限”，这里只更新已输入字数 */
function updateCounter(el) {
  const target = viewEl.querySelector(`[data-counter="${el.dataset.countFor}"]`);
  if (!target) return;
  const max = Number(el.dataset.max || 0);
  const length = el.value.trim().length;
  target.textContent = String(length);
  target.parentElement.classList.toggle('over', max > 0 && length > max);
}

function syncCounters() {
  viewEl.querySelectorAll('[data-count-for]').forEach(updateCounter);
}

function restoreUiState(snapshot) {
  if (!snapshot) return;
  restoreFields(snapshot.fields);
  syncSourceConfirm();
  syncComposeCourse();
  syncCounters();
  if (!snapshot.active) return;
  const target = Array.from(viewEl.querySelectorAll('[name]')).find((el) => fieldKey(el) === snapshot.active);
  if (target) target.focus({ preventScroll: true });
}

function refreshPreserving() {
  const snapshot = captureUiState();
  render({ preserve: true });
  restoreUiState(snapshot);
}

function requireLogin(nextPath = null) {
  const target = nextPath || (ctx.route ? ctx.route.path : '/resources');
  toast(isRemote ? '这项操作需要先登录' : '这项操作需要登录（演示环境使用固定验证码 123456）', 'error');
  navigate(`/login?next=${encodeURIComponent(target)}`);
  return false;
}

/* ---------- 弹层与提示 ---------- */

function openModal({ title, body, footer = '', wide = false, onOpen = null, className = '' }) {
  overlayEl.innerHTML = `
    <div class="modal-backdrop" data-close-backdrop="1">
      <div class="modal ${esc(className)}" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${wide ? 'style="max-width:640px"' : ''}>
        <h2>${esc(title)}</h2>
        ${body}
        ${footer ? `<div class="modal-actions">${footer}</div>` : ''}
      </div>
    </div>`;
  const modal = overlayEl.querySelector('.modal');
  const focusable = modal.querySelector('textarea, input, select, button');
  if (focusable) focusable.focus({ preventScroll: true });
  if (onOpen) onOpen(modal);
}

function showBookmarkModal() {
  const entry = todayEntry();
  const source = entry && entry.source_url && entry.quote_type === 'classical'
    ? `<a class="gy-source-link" href="${esc(entry.source_url)}" target="_blank" rel="noopener">查看原文 · ${esc(entry.quote_title || '出处')}</a>`
    : `<span class="gy-source-note">${entry ? '共页原创' : '日期配置更新中'}</span>`;
  const title = entry && entry.event_name ? `今日页签 · ${entry.event_name}` : '今日页签';
  openModal({
    title,
    className: 'bookmark-modal',
    body: `<div class="gy-modal-body">
      ${bookmarkSheet(entry, { compact: false })}
      <div class="gy-modal-foot">${source}<span>这枚页签，留给今天帮到你的那篇分享。</span></div>
    </div>`,
    footer: `<button class="btn" type="button" data-action="close-modal">收下</button>`
  });
}

function closeModal() {
  overlayEl.innerHTML = '';
  ui.pendingConfirm = null;
}

function toast(message, kind = 'ok') {
  let wrap = overlayEl.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    overlayEl.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind === 'error' ? 'toast-error' : 'toast-ok'}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `${icon(kind === 'error' ? 'flag' : 'check', 'i-sm')}<span>${esc(message)}</span>`;
  wrap.appendChild(el);
  while (wrap.children.length > 3) wrap.firstElementChild.remove();
  setTimeout(() => el.remove(), 3600);
}

function confirmModal({ title, text, confirmLabel = '确认', danger = false, onConfirm }) {
  ui.pendingConfirm = onConfirm;
  openModal({
    title,
    body: `<p class="small secondary">${esc(text)}</p>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-action="close-modal">取消</button>
      <button class="btn ${danger ? 'btn-danger' : ''}" type="button" data-action="confirm-yes">${esc(confirmLabel)}</button>`
  });
}

function downloadFile(path, filename) {
  if (String(path).startsWith('/api/files/')) {
    fileApi.download(path, filename).catch((error) => toast(error.message || '下载失败', 'error'));
    return;
  }
  const a = document.createElement('a');
  a.href = path;
  a.download = filename || '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast('链接已复制'),
      () => toast('复制失败，请手动选择链接', 'error')
    );
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
    toast('链接已复制');
  } catch {
    toast('复制失败，请手动选择链接', 'error');
  }
  area.remove();
}

/* ---------- 具体交互 ---------- */

function openGiftModal(postId) {
  const db = ctx.db;
  if (!ctx.me) return requireLogin(`/posts/${postId}`);
  const post = S.postOf(db, postId);
  if (!post) return toast('内容不存在', 'error');
  const gate = S.giftAvailability(db, ctx.me.id, post);
  const balance = S.walletOf(db, ctx.me.id);
  const money = (n) => `${n} 枚`;

  if (!gate.ok) {
    openModal({
      title: '暂时不能赠送',
      body: `<div class="notice notice-warn">${icon('lock', 'i-sm')}<span>${esc(gate.message)}</span></div>
        <p class="small secondary mt-3">页签规则：每日 1 枚、可存 30 枚；每帖最多 2 枚、每位作者每天最多收 2 枚、每天最多送 5 枚。</p>`,
      footer: `<button class="btn btn-ghost" type="button" data-action="close-modal">知道了</button>`
    });
    return;
  }

  const maxQty = Math.min(2, balance, 2 - gate.mine);
  const qtyOptions = [1, 2].filter((n) => n <= maxQty).map((n, index) => `
    <label class="chip ${index === 0 ? 'is-active' : ''}" style="cursor:pointer">
      <input type="radio" name="qty" value="${n}" ${index === 0 ? 'checked' : ''} style="width:14px;height:14px;accent-color:var(--brand)">
      ${money(n)}
    </label>`).join('');

  openModal({
    title: '送出页签',
    body: `
      <div class="small secondary mb-3">给 <b>${esc((S.userOf(db, post.authorId) || {}).nickname || '')}</b> 的「${esc(post.title || '这条分享')}」送出页签。</div>
      <div class="chips" id="gift-qty">${qtyOptions}</div>
      <div class="modal-row mt-3"><span>当前余额</span><b>${balance} 枚</b></div>
      <div class="modal-row"><span>送出后</span><b id="gift-after">${balance - 1} 枚</b></div>
      <p class="tiny muted mt-3">正常赠送成功后不可主动撤回；帖子被永久移除时按规则退回。</p>`,
    footer: `
      <button class="btn btn-ghost" type="button" data-action="close-modal">取消</button>
      <button class="btn" type="button" data-action="send-gift" data-post="${esc(postId)}"
        data-idem="gift-${esc(postId)}-${Date.now()}">确认送出</button>`
  });
}

function openReportModal(targetType, targetId) {
  if (!ctx.me) return requireLogin();
  const isDm = targetType === 'dm';
  const reasons = isDm
    ? ['骚扰或辱骂', '广告或诈骗', '发送不当内容', '冒充他人', '其他']
    : ['版权风险', '不当内容', '广告或灌水', '隐私泄露', '疑似代写代考', '文件有问题', '其他'];
  openModal({
    title: isDm ? '举报私信' : '举报',
    body: `
      ${isDm ? '<p class="small secondary mb-3">会把对方最近发给你的 10 条私信附给管理员核查，你发出的私信不会附上。</p>' : ''}
      <form data-form="report" data-target-type="${esc(targetType)}" data-target-id="${esc(targetId)}">
        <div class="field">
          <label for="report-reason">举报原因</label>
          <select class="select" id="report-reason" name="reason">
            ${reasons.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="report-detail">补充说明<span class="label-hint">选填</span></label>
          <textarea class="textarea" id="report-detail" name="detail" rows="3" placeholder="写清你看到的问题，便于核查。"></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-action="close-modal">取消</button>
          <button class="btn" type="submit">提交举报</button>
        </div>
      </form>`
  });
}

function openAdminReportModal(reportId) {
  const db = ctx.db;
  const report = S.byId(db.reports, reportId);
  if (!report) return toast('举报不存在', 'error');
  if (report.targetType === 'dm') return openAdminDmReportModal(report);
  openModal({
    title: '处理举报',
    wide: true,
    body: `
      <form data-form="admin-report" data-report="${esc(reportId)}">
        <div class="card card-tight mb-3" style="margin-bottom:12px">
          <div class="small"><b>对象：</b>${esc(S.reportTargetLabel(db, report))}</div>
          <div class="small"><b>原因：</b>${esc(report.reason)}</div>
          <div class="small"><b>说明：</b>${esc(report.detail || '（未补充）')}</div>
        </div>
        <div class="field">
          <label for="admin-action">处理方式</label>
          <select class="select" id="admin-action" name="action">
            <option value="hide">临时隐藏（可恢复，不退款）</option>
            <option value="remove">永久移除（触发退款，不可恢复）</option>
            <option value="restore">恢复可见</option>
            <option value="dismiss">不处理（记录理由）</option>
          </select>
        </div>
        <div class="field">
          <label for="admin-reason">处理理由（必填，写入审计）</label>
          <textarea class="textarea" id="admin-reason" name="reason" rows="2" required></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-action="close-modal">取消</button>
          <button class="btn" type="submit">提交处理</button>
        </div>
      </form>`
  });
}

/* 私信举报：展示举报人收到的那几条私信，只能删除或不处理 */
function openAdminDmReportModal(report) {
  const db = ctx.db;
  openModal({
    title: '处理私信举报',
    wide: true,
    body: `
      <form data-form="admin-report" data-report="${esc(report.id)}">
        <div class="card card-tight mb-3">
          <div class="small"><b>对象：</b>${esc(S.reportTargetLabel(db, report))}</div>
          <div class="small"><b>原因：</b>${esc(report.reason)}${report.detail ? ` · ${esc(report.detail)}` : ''}</div>
          <ul class="list-plain dm-evidence mt-2">${(report.evidence || []).map((row) => `<li>
            <div class="tiny muted">${esc(formatDateTime(row.createdAt))}</div>
            <div class="small">${esc(row.body)}</div>
          </li>`).join('')}</ul>
        </div>
        <div class="field">
          <label for="admin-action">处理方式</label>
          <select class="select" id="admin-action" name="action">
            <option value="remove">删除这些私信，并提醒对方</option>
            <option value="dismiss">不处理（记录理由）</option>
          </select>
          <p class="field-help">需要封禁账号时，到“用户”页签操作。</p>
        </div>
        <div class="field">
          <label for="admin-reason">处理理由（必填，写入审计）</label>
          <textarea class="textarea textarea-sm" id="admin-reason" name="reason" rows="2" required></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-action="close-modal">取消</button>
          <button class="btn" type="submit">提交处理</button>
        </div>
      </form>`
  });
}

/* 管理员：在单个圈里禁言或移出成员，理由会通知对方 */
function openMemberModal({ circle: circleId, user: userId, act }) {
  const db = ctx.db;
  const user = S.userOf(db, userId);
  const circle = S.circleOf(db, circleId);
  if (!user || !circle) return toast('成员不存在', 'error');
  const course = S.courseOf(db, circle.courseId) || {};
  const muting = act === 'mute';
  return openModal({
    title: muting ? '在本圈禁言' : '移出课友圈',
    body: `<form data-form="admin-member" data-circle="${esc(circleId)}" data-user="${esc(userId)}" data-act="${esc(act)}">
      <p class="small secondary mb-3">${esc(user.nickname)} · ${esc(course.name || '')}课友圈。${muting
        ? '禁言期间不能在这个圈发帖和评论，其他圈不受影响。'
        : '移出后对方不能再进入这个圈参与讨论，需要管理员允许才能重新加入。'}</p>
      ${muting ? `<div class="field">
        <label for="member-days">禁言时长</label>
        <select class="select" id="member-days" name="days">
          <option value="1">1 天</option>
          <option value="7" selected>7 天</option>
          <option value="30">30 天</option>
          <option value="">长期（手动解除）</option>
        </select>
      </div>` : ''}
      <div class="field">
        <label for="member-reason">理由（必填，会通知对方并写入审计）</label>
        <textarea class="textarea textarea-sm" id="member-reason" name="reason" rows="2" required></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" data-action="close-modal">取消</button>
        <button class="btn ${muting ? '' : 'btn-danger'}" type="submit">${muting ? '禁言' : '移出'}</button>
      </div>
    </form>`
  });
}

/* 注销账号：选择怎么处理发布过的内容，输入“注销”确认 */
function openDeleteAccountModal() {
  if (!ctx.me) return requireLogin('/me/settings');
  return openModal({
    title: '注销账号',
    body: `<form data-form="delete-account">
      <p class="small secondary">注销后，邮箱、昵称、简介、私信、通知、关注、收藏和页签记录都会删除，所有设备上的登录随即失效，<b>无法恢复</b>。需要的话，先在设置里导出你的数据。</p>
      <fieldset class="delete-options mt-3">
        <legend class="small"><b>你发布过的帖子、资料和评论</b></legend>
        <label class="checkbox mt-2"><input type="radio" name="mode" value="anonymize" checked>
          <span><b>保留，显示为“已注销用户”</b>：同学还能继续看到你分享的笔记</span></label>
        <label class="checkbox mt-2"><input type="radio" name="mode" value="delete">
          <span><b>全部删除</b>：永久移除，收到的页签按规则退回给送出的人</span></label>
      </fieldset>
      <div class="field mt-3">
        <label for="delete-confirm">输入“注销”两个字确认</label>
        <input class="input" id="delete-confirm" name="confirmText" autocomplete="off">
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" data-action="close-modal">取消</button>
        <button class="btn btn-danger" type="submit">注销账号</button>
      </div>
    </form>`
  });
}

async function exportMyData() {
  if (!ctx.me) return requireLogin('/me/settings');
  const filename = '共页-我的数据.json';
  if (isRemote) {
    try {
      await fileApi.download('/api/me/export', filename);
    } catch (error) {
      toast(error.message || '导出失败', 'error');
    }
    return undefined;
  }
  const data = S.personalData(ctx.db, ctx.me.id);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  downloadFile(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return undefined;
}

function openShareModal(path, kind = 'invite') {
  const url = absoluteShare(path);
  const isInvite = kind === 'invite';
  openModal({
    title: '分享链接',
    body: `<p class="small secondary mb-3">${isInvite
      ? '复制下面的地址，发到班群或直接发给同学。打开链接的人先看到内容，登录后才会确认加入。'
      : '复制下面的地址，发到班群或直接发给同学。'}</p>
      <div class="invite-box">
        <input class="input" id="share-url" value="${esc(url)}" readonly>
        <button class="btn" type="button" data-action="copy-value" data-value="${esc(url)}">复制</button>
      </div>
      ${isInvite ? '<p class="tiny muted mt-3">邀请码只是来源标识，不是访问密码，也不代表正式修课认证。</p>' : ''}`,
    footer: `<button class="btn btn-ghost" type="button" data-action="close-modal">关闭</button>`
  });
}

/* ---------- 全局事件 ---------- */

async function handleAction(action, el) {
  const db = ctx.db;
  const dataset = el.dataset;

  switch (action) {
    case 'close-modal':
      return closeModal();
    case 'circle-guest-info':
      return openModal({
        title: '游客可以做什么',
        body: `<p class="small secondary">游客可以浏览公开讨论。登录并验证邮箱后，可以发帖、评论和收藏。</p>`,
        footer: `<a class="btn" href="${href('/login', { next: '/circles' })}">登录 / 注册</a>
          <button class="btn btn-ghost" type="button" data-action="close-modal">关闭</button>`
      });
    case 'direct-mode-info':
      return openModal({
        title: '私信说明',
        body: `<p class="small secondary">${isRemote
          ? '私信由服务端保存，只对对话双方开放；打开私信页时会自动刷新新消息。'
          : '当前是静态演示版，私信只保存在这台浏览器，不会送到其他人的设备。部署并启用服务端后，登录账号之间才能互发。'}</p>`,
        footer: `<button class="btn btn-ghost" type="button" data-action="close-modal">知道了</button>`
      });
    case 'compose-info':
      return openModal({
        title: '发布说明',
        body: `<div class="stack small secondary">
          <p>已发布内容对所有访问者可见，请勿写入个人隐私；课友圈不是班级私密群。</p>
          <p>挂圈后课程由所选课友圈决定；正文支持基础 Markdown。</p>
          <p>板块：笔记分享、学习求助、课程讨论、学习方法。</p>
        </div>`,
        footer: `<button class="btn btn-ghost" type="button" data-action="close-modal">知道了</button>`
      });
    case 'confirm-yes': {
      const fn = ui.pendingConfirm;
      closeModal();
      if (fn) fn();
      return undefined;
    }
    case 'download': {
      const result = await invoke('downloadResource', { postId: dataset.post, attachmentId: dataset.attachment });
      if (result.ok) downloadFile(result.data.path, result.data.name);
      else if (result.code === 'login') requireLogin(dataset.next || `/posts/${dataset.post}`);
      return undefined;
    }
    case 'toggle-like':
      if (!ctx.me) return requireLogin(`/posts/${dataset.post}`);
      return invoke('toggleReaction', { postId: dataset.post, kind: 'like' });
    case 'toggle-save':
      if (!ctx.me) return requireLogin(dataset.next || `/posts/${dataset.post}`);
      return invoke('toggleReaction', { postId: dataset.post, kind: 'save' });
    case 'goto-comments':
      return jumpToComments({ focus: !isTouchPointer() });
    case 'scroll-to': {
      const target = viewEl.querySelector(`#${dataset.target}`);
      if (target) target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return undefined;
    }
    case 'toggle-filters':
      ui.filtersOpen = !ui.filtersOpen;
      return ctx.refresh();
    case 'open-gift':
      return openGiftModal(dataset.post);
    case 'send-gift': {
      const modal = el.closest('.modal');
      const qty = Number((modal && modal.querySelector('input[name="qty"]:checked') || {}).value || 1);
      const result = await invoke('sendGift', {
        postId: dataset.post, qty, idemKey: dataset.idem || `ui-${dataset.post}-${Date.now()}`
      });
      if (result.ok) closeModal();
      return result;
    }
    case 'claim-daily': {
      if (!ctx.me) return requireLogin('/me/wallet');
      const result = await invoke('claimDaily', {});
      if (result && result.ok && result.data) {
        showBookmarkModal();
      }
      return result;
    }
    case 'join-circle':
      if (!ctx.me) return requireLogin(dataset.code ? `/invite/${dataset.code}` : null);
      return invoke('joinCircle', { circleId: dataset.circle, code: dataset.code || null });
    case 'leave-circle':
      return confirmModal({
        title: '退出课友圈',
        text: '退出后会立刻从「我的课友圈」聚合流中消失，你已发布的帖子与评论仍然保留。确定退出吗？',
        confirmLabel: '退出',
        danger: true,
        onConfirm: () => invoke('leaveCircle', { circleId: dataset.circle })
      });
    case 'mute-circle':
      return invoke('setCircleFlag', { circleId: dataset.circle, flag: 'muted', value: dataset.value === '1' });
    case 'shelve-circle':
      return invoke('setCircleFlag', { circleId: dataset.circle, flag: 'shelved', value: dataset.value === '1' });
    case 'accept-comment':
      return invoke('acceptComment', { postId: dataset.post, commentId: dataset.comment });
    case 'unaccept':
      return invoke('unacceptComment', { postId: dataset.post });
    case 'delete-comment':
      return confirmModal({
        title: '删除评论',
        text: '删除后这条评论不再公开展示，相关回复也会失去上下文。',
        confirmLabel: '删除',
        danger: true,
        onConfirm: () => invoke('removeComment', { commentId: dataset.comment })
      });
    case 'delete-post':
      return confirmModal({
        title: '永久删除这篇内容？',
        text: '帖子与附件将不可再公开访问；如果已有人送过页签，会按记录退回。此操作不可恢复。',
        confirmLabel: '永久删除',
        danger: true,
        onConfirm: () => invoke('removePost', { postId: dataset.post })
      });
    case 'reply-to': {
      ui.replyTarget = {
        postId: dataset.post, commentId: dataset.comment, nickname: dataset.nickname
      };
      ctx.refresh();
      const form = viewEl.querySelector('form[data-form="comment"]');
      if (form) {
        form.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const area = form.querySelector('textarea');
        if (area) area.focus({ preventScroll: true });
      }
      return undefined;
    }
    case 'clear-reply':
      ui.replyTarget = null;
      return ctx.refresh();
    case 'open-report':
      return openReportModal(dataset.targetType, dataset.targetId);
    case 'open-report-admin':
      return openAdminReportModal(dataset.report);
    case 'toggle-index':
      return invoke('setResourceIndex', { resourceId: dataset.resource, enabled: dataset.value === '1' });
    case 'follow-user':
      if (!ctx.me) return requireLogin();
      return invoke('toggleFollowUser', { targetUserId: dataset.user });
    case 'follow-course':
      if (!ctx.me) return requireLogin();
      return invoke('toggleFollowCourse', { courseId: dataset.course });
    case 'copy-link':
      return copyText(absoluteShare(el.dataset.path || ''));
    case 'copy-value':
      return copyText(dataset.value || '');
    case 'share':
      return openShareModal(el.dataset.path || '', dataset.kind || 'invite');
    case 'mark-all-read':
      if (!ctx.me) return requireLogin('/me/messages');
      return invoke('markAllNotificationsRead', {});
    case 'mark-read':
      if (!ctx.me) return requireLogin('/me/messages');
      return invoke('markNotificationRead', { notificationId: dataset.notification });
    case 'open-notification':
      if (!ctx.me) return requireLogin('/me/messages');
      await invoke('markNotificationRead', { notificationId: dataset.notification }, { silent: true });
      navigate(dataset.href);
      return undefined;
    case 'open-direct-thread': {
      if (!ctx.me) return requireLogin('/me/messages');
      const peerId = dataset.peer;
      await invoke('markDirectMessagesRead', { peerId });
      navigate(href('/me/messages', { tab: 'direct', with: peerId }));
      return undefined;
    }
    case 'mark-direct-read':
      if (!ctx.me) return requireLogin('/me/messages');
      return invoke('markDirectMessagesRead', { peerId: dataset.peer });
    case 'quick-login': {
      if (isRemote) return toast('试用版已关闭演示账号切换，请用名单内邮箱登录', 'error');
      const result = await invoke('quickLogin', { userId: dataset.user });
      if (result.ok) {
        const next = new URLSearchParams(location.hash.split('?')[1] || '').get('next');
        const user = result.data && result.data.user;
        navigate(next || (user && user.role === 'admin' ? '/admin' : '/resources'));
      }
      return result;
    }
    case 'logout':
      await invoke('logout', {});
      auth.clear();
      clearComposeDraft();
      navigate('/resources');
      return undefined;
    case 'reset-demo':
      if (isRemote) return toast('试用版不支持重置，请联系管理员清空服务端数据', 'error');
      return confirmModal({
        title: '重置演示数据',
        text: '会清空你在本机浏览器里的所有演示改动（发布的帖子、页签记录等），恢复到初始演示数据。',
        confirmLabel: '重置',
        danger: true,
        onConfirm: () => {
          store.reset();
          toast('演示数据已重置');
        }
      });
    case 'toggle-sticker-panel': {
      const form = el.closest('form');
      const panel = form && form.querySelector('.sticker-panel');
      if (!panel) return undefined;
      const willOpen = panel.hidden;
      panel.hidden = !willOpen;
      el.setAttribute('aria-expanded', String(willOpen));
      return undefined;
    }
    case 'pick-sticker': {
      const form = el.closest('form');
      if (!form) return undefined;
      const input = form.querySelector('input[name="stickerId"]');
      if (input) input.value = dataset.sticker || '';
      const preview = form.querySelector('.sticker-preview');
      const option = el.querySelector('img');
      const label = el.querySelector('span');
      if (preview && option) {
        preview.hidden = false;
        preview.innerHTML = `<img src="${esc(option.getAttribute('src') || '')}" alt="页页表情：${esc(label ? label.textContent : '')}">
          <span>${esc(label ? label.textContent : '')}</span>
          <button type="button" class="sticker-clear" data-action="clear-sticker" aria-label="移除页页表情">×</button>`;
      }
      const panel = form.querySelector('.sticker-panel');
      if (panel) panel.hidden = true;
      const toggle = form.querySelector('[data-action="toggle-sticker-panel"]');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      return undefined;
    }
    case 'clear-sticker': {
      const form = el.closest('form');
      if (!form) return undefined;
      const input = form.querySelector('input[name="stickerId"]');
      if (input) input.value = '';
      const preview = form.querySelector('.sticker-preview');
      if (preview) {
        preview.hidden = true;
        preview.innerHTML = '';
      }
      return undefined;
    }    case 'add-file': {
      const select = viewEl.querySelector('[data-file-picker]');
      if (!select) return undefined;
      const option = A.DEMO_SAMPLE_FILES[Number(select.value)];
      if (!option) return undefined;
      if (ui.files.length >= 3) return toast('最多 3 个 PDF 附件', 'error');
      if (ui.files.some((f) => f.path === option.path)) return toast('这个演示文件已经添加过了', 'error');
      ui.files.push({ ...option, demo: true });
      return ctx.refresh();
    }
    case 'remove-file':
      ui.files = ui.files.filter((_, index) => String(index) !== dataset.index);
      return ctx.refresh();
    case 'save-resource-draft': {
      const form = el.closest('form');
      if (!form) return undefined;
      const fd = new FormData(form);
      const result = await invoke('saveResourceDraft', {
        resource: {
          title: String(fd.get('resTitle') || ''),
          courseId: String(fd.get('resourceCourse') || '') || null,
          school: String(fd.get('school') || ''),
          term: String(fd.get('term') || ''),
          type: String(fd.get('type') || ''),
          coverage: String(fd.get('coverage') || ''),
          limitations: String(fd.get('limitations') || '')
        },
        postTitle: String(fd.get('postTitle') || ''),
        body: String(fd.get('body') || '')
      });
      return result;
    }
    case 'apply-course': {
      const form = el.closest('form');
      if (form) {
        const fd = new FormData(form);
        await invoke('saveResourceDraft', {
          resource: {
            title: String(fd.get('resTitle') || ''),
            courseId: String(fd.get('resourceCourse') || '') || null,
            school: String(fd.get('school') || ''),
            term: String(fd.get('term') || ''),
            type: String(fd.get('type') || ''),
            coverage: String(fd.get('coverage') || ''),
            limitations: String(fd.get('limitations') || '')
          },
          postTitle: String(fd.get('postTitle') || ''),
          body: String(fd.get('body') || '')
        });
      }
      navigate('/find-circles?apply=1');
      return undefined;
    }
    case 'remove-image':
      ui.images = ui.images.filter((image, index) => {
        if (String(index) !== dataset.index) return true;
        releaseImage(image);
        return false;
      });
      return ctx.refresh();
    case 'block-user':
      if (!ctx.me) return requireLogin();
      if (dataset.value === '1') {
        return confirmModal({
          title: '拉黑这个账号',
          text: '拉黑后双方不能再互发私信，你也不会再收到对方的回复和页签提醒，互相取消关注。对方的公开内容仍然可见。',
          confirmLabel: '拉黑',
          danger: true,
          onConfirm: () => invoke('setBlock', { userId: dataset.user, blocked: true })
        });
      }
      return invoke('setBlock', { userId: dataset.user, blocked: false });
    case 'report-dm':
      return openReportModal('dm', dataset.peer);
    case 'export-my-data':
      return exportMyData();
    case 'open-delete-account':
      return openDeleteAccountModal();
    case 'admin-member':
      return openMemberModal(dataset);
    case 'admin-member-quick':
      return invoke('setMemberRestriction', { circleId: dataset.circle, userId: dataset.user, action: dataset.act });
    case 'pin-post':
      return invoke('setCirclePin', { circleId: dataset.circle, postId: dataset.value === '1' ? dataset.post : null });
    case 'admin-approve-application':
      return confirmModal({
        title: '通过建圈申请',
        text: '通过后会开通这门课的课友圈；目录里没有的课程会一并加入目录，并通知申请人。',
        confirmLabel: '通过并开圈',
        onConfirm: () => invoke('resolveApplication', { applicationId: dataset.application, action: 'approve' })
      });
    case 'admin-reject-application':
      return openModal({
        title: '驳回建圈申请',
        body: `<form data-form="admin-reject-application" data-application="${esc(dataset.application)}">
          <div class="field">
            <label for="reject-reason">驳回理由（会通知申请人）</label>
            <textarea class="textarea textarea-sm" id="reject-reason" name="reason" rows="2" required
              placeholder="例如：目录里已有同名课程，请直接搜索加入"></textarea>
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" type="button" data-action="close-modal">取消</button>
            <button class="btn" type="submit">驳回</button>
          </div>
        </form>`
      });
    case 'toggle-preview': {
      const area = viewEl.querySelector('textarea[name="body"]');
      if (!area) return undefined;
      ui.compose = ui.compose || { board: 'notes', preview: false };
      ui.compose.preview = !ui.compose.preview;
      return ctx.refresh();
    }
    case 'set-board': {
      ui.compose = ui.compose || { board: 'notes', preview: false };
      ui.compose.board = dataset.board || 'notes';
      if (ui.composeDraft) ui.composeDraft.board = ui.compose.board;
      ctx.refresh();
      return persistComposeDraft();
    }
    case 'clear-compose-draft':
      clearComposeDraft();
      ui.compose = { board: 'notes', preview: false };
      return render({ preserve: true });
    case 'send-code': {
      const input = viewEl.querySelector('input[name="email"]');
      const email = input ? input.value : '';
      const hint = viewEl.querySelector('[data-code-hint]');
      if (isCloudAuth) {
        const sent = await cloudAuth.sendCode(email);
        if (hint) hint.textContent = sent.message;
        if (sent.ok) {
          toast(`验证码已发到 ${sent.email}`, 'ok');
          const codeInput = viewEl.querySelector('input[name="code"]');
          if (codeInput) codeInput.focus({ preventScroll: true });
        } else {
          toast(sent.message, 'error');
        }
        return sent;
      }
      const result = await invoke('requestCode', { email });
      if (result.ok && hint) hint.textContent = '验证码固定为 123456，不会真的发送邮件。';
      return result;
    }
    case 'admin-archive-circle': {
      if (!ctx.me || ctx.me.role !== 'admin') return toast('需要管理员权限', 'error');
      return confirmModal({
        title: '归档这个课友圈',
        text: '归档后圈子变为只读：不能新发帖或评论，但帖子、资料与赠签记录都保留，也不会退款。',
        confirmLabel: '归档',
        onConfirm: () => invoke('archiveCircle', { circleId: dataset.circle, reason: '学期结束' })
      });
    }
    case 'admin-suspend-user': {
      if (!ctx.me || ctx.me.role !== 'admin') return toast('需要管理员权限', 'error');
      return confirmModal({
        title: dataset.value === '1' ? '封禁账号' : '解封账号',
        text: dataset.value === '1'
          ? '封禁后该账号不能登录、发布、评论、领取或下载；已发布内容仍保留，可单独封禁。'
          : '解封后该账号可以继续登录与使用。',
        confirmLabel: dataset.value === '1' ? '封禁' : '解封',
        danger: dataset.value === '1',
        onConfirm: () => invoke('setUserStatus', {
          userId: dataset.user, status: dataset.value === '1' ? 'suspended' : 'active', reason: '管理员操作'
        })
      });
    }
    case 'admin-ban-post':
    case 'admin-unban-post': {
      if (!ctx.me || ctx.me.role !== 'admin') return toast('需要管理员权限', 'error');
      const banning = dataset.action === 'admin-ban-post';
      return confirmModal({
        title: banning ? '封禁这个帖子' : '解封这个帖子',
        text: banning
          ? '封禁后帖子从列表、搜索与详情中隐藏，关联资料同时下架；作者可申诉。'
          : '解封后帖子恢复公开，关联资料也会重新进入检索。',
        confirmLabel: banning ? '封禁' : '解封',
        danger: banning,
        onConfirm: () => invoke('setPostStatus', {
          postId: dataset.post, status: banning ? 'banned' : 'published', reason: '管理员操作（演示）'
        })
      });
    }
    case 'open-bookmark':
      return showBookmarkModal();
    case 'level-info': {
      const level = Number(dataset.level) || 1;
      const name = dataset.name || '';
      const rewards = GROWTH_RULES.rewards;
      const levelRows = GROWTH_RULES.levels.map((item) => `<li>
        <span>LV.${item.level} ${esc(item.name)}</span>
        <span>${item.threshold === 0 ? '起点' : `${item.threshold} 经验`}</span>
      </li>`).join('');
      const rewardRows = [
        { label: '合格帖子', value: `+${rewards.post.xp}`, detail: `每天最多 ${rewards.post.daily} 篇，正文至少 ${rewards.post.minChars} 个有效字` },
        { label: '有内容的评论或回复', value: `+${rewards.comment.xp}`, detail: `每天最多 ${rewards.comment.daily} 条，同一帖子最多 ${rewards.comment.perPostDaily} 条` },
        { label: '求助回复被采纳', value: `+${rewards.accepted.xp}`, detail: `每天最多 ${rewards.accepted.daily} 次，同一提问者最多 ${rewards.accepted.perAskerDaily} 次` },
        { label: '收到同学送的页签', value: `+${rewards.marker.xp}`, detail: `每天最多 ${rewards.marker.daily} 枚，同一赠送者最多 1 次` }
      ].map((item) => `<li>
        <span><b>${esc(item.label)} ${esc(item.value)}</b><small>${esc(item.detail)}</small></span>
      </li>`).join('');
      return openModal({
        title: `LV.${level} ${name}`,
        body: `<div class="level-info-body">
          <p class="small secondary">等级只体现参与程度，不代表知识水平、校方认证，也不影响下载、提问和评论等基本权利。</p>
          <div class="mt-3">
            <div class="small"><b>等级门槛</b></div>
            <ul class="level-info-list tiny muted">${levelRows}</ul>
          </div>
          <div class="mt-3">
            <div class="small"><b>经验来源</b></div>
            <ul class="level-info-list level-reward-list tiny muted">${rewardRows}</ul>
          </div>
          <p class="tiny muted mt-2">点赞、收藏、下载、领取或赠送页签不加经验；删除或违规内容可能撤回对应经验。</p>
        </div>`,
        footer: `${ctx.me ? `<a class="btn btn-sm" href="${href('/me/growth')}">我的成长</a>` : ''}
          <button class="btn btn-ghost btn-sm" type="button" data-action="close-modal">关闭</button>`
      });
    }
    case 'preview-image':
      return openModal({
        title: '图片预览',
        wide: true,
        body: `<img src="${esc(dataset.src)}" alt="帖子配图" style="width:100%;height:auto;border:1px solid var(--line);border-radius:6px">`,
        footer: '<button class="btn btn-ghost" type="button" data-action="close-modal">关闭</button>'
      });
    default:
      return undefined;
  }
}

async function handleSubmit(form) {
  const kind = form.dataset.form;
  const db = ctx.db;
  const fd = new FormData(form);
  const get = (name) => String(fd.get(name) || '').trim();

  if (kind === 'header-search') {
    const q = get('q');
    navigate(`/search?q=${encodeURIComponent(q)}`);
    return;
  }

  if (kind === 'login-request') {
    if (isCloudAuth) {
      const sent = await cloudAuth.sendCode(get('email'));
      const hint = viewEl.querySelector('[data-code-hint]');
      if (hint) hint.textContent = sent.message;
      toast(sent.message, sent.ok ? 'ok' : 'error');
      return;
    }
    const result = await invoke('requestCode', { email: get('email') });
    const hint = viewEl.querySelector('[data-code-hint]');
    if (result.ok && hint) hint.textContent = '验证码固定为 123456（不会真的发送邮件）。';
    return;
  }

  if (kind === 'login-verify') {
    const next = new URLSearchParams(location.hash.split('?')[1] || '').get('next');

    if (isCloudAuth) {
      // 第一步：把验证码交给云服务验，确认这个邮箱是本人的
      const verified = await cloudAuth.verifyCode(get('code'));
      if (!verified.ok) {
        toast(verified.message, 'error');
        return;
      }
      // 第二步：后端按邮箱找回/创建账号并签发会话（后端会再校验一次域名）
      const result = await invoke('cloudSignIn', {
        email: verified.email,
        cloudAccessToken: verified.accessToken
      });
      if (result && result.ok) {
        const user = result.data && result.data.user;
        navigate(next || (user && user.role === 'admin' ? '/admin' : '/resources'));
      }
      return;
    }

    const result = await invoke('verifyCode', { email: get('email'), code: get('code') });
    if (result.ok) {
      const user = result.data && result.data.user;
      navigate(next || (user && user.role === 'admin' ? '/admin' : '/resources'));
    }
    return;
  }

  if (kind === 'admin-circle') {
    const result = await invoke('createCircle', { courseId: get('courseId') });
    if (result.ok) navigate(`/circles/${result.data.circleId}`);
    return;
  }

  if (kind === 'comment') {
    const postId = form.dataset.post;
    const result = await invoke('addComment', {
      postId, body: get('body'), parentId: get('parentId') || null,
      stickerId: get('stickerId') || null
    });
    if (result.ok) {
      ui.replyTarget = null;
      ui.freshCommentId = result.data && result.data.comment ? result.data.comment.id : null;
      ctx.refresh();
    }
    return;
  }

  if (kind === 'direct-message') {
    if (!ctx.me) return requireLogin('/me/messages');
    const result = await invoke('sendDirectMessage', {
      recipientId: form.dataset.recipient,
      body: get('body')
    });
    if (result.ok) {
      const currentForm = viewEl.querySelector('form[data-form="direct-message"]');
      const currentBody = currentForm && currentForm.elements.namedItem('body');
      if (currentBody) currentBody.value = '';
      ctx.refresh();
    }
    return;
  }

  if (kind === 'report') {
    const result = await invoke('reportContent', {
      targetType: form.dataset.targetType,
      targetId: form.dataset.targetId,
      reason: get('reason'),
      detail: get('detail')
    });
    if (result.ok) closeModal();
    return;
  }

  if (kind === 'admin-report') {
    const result = await invoke('resolveReport', {
      reportId: form.dataset.report,
      action: get('action'),
      reason: get('reason')
    });
    if (result.ok) closeModal();
    return;
  }

  if (kind === 'profile') {
    invoke('updateProfile', { nickname: get('nickname'), bio: get('bio'), avatar: get('avatar') || null });
    return;
  }

  if (kind === 'edit-post') {
    const tags = String(fd.get('tags') || '').split(/[,，\s]+/).filter(Boolean).slice(0, 3);
    const result = await invoke('updatePost', {
      postId: form.dataset.post, title: get('title'), body: get('body'), tags
    });
    if (result.ok) navigate(`/posts/${form.dataset.post}`);
    return;
  }

  if (kind === 'settings-notify') {
    invoke('updatePrefs', {
      patch: {
        replies: fd.get('replies') === 'on',
        gifts: fd.get('gifts') === 'on'
      }
    });
    return;
  }

  if (kind === 'application') {
    const result = await invoke('submitApplication', { courseName: get('courseName'), reason: get('reason') });
    if (result.ok) {
      const current = viewEl.querySelector('form[data-form="application"]');
      if (current) current.reset();
    }
    return;
  }

  if (kind === 'delete-account') {
    const result = await invoke('deleteAccount', { mode: get('mode'), confirmText: get('confirmText') });
    if (result && result.ok) {
      closeModal();
      auth.clear();
      clearComposeDraft();
      navigate('/');
    }
    return;
  }

  if (kind === 'admin-member') {
    const result = await invoke('setMemberRestriction', {
      circleId: form.dataset.circle,
      userId: form.dataset.user,
      action: form.dataset.act,
      days: get('days') ? Number(get('days')) : null,
      reason: get('reason')
    });
    if (result && result.ok) closeModal();
    return;
  }

  if (kind === 'admin-reject-application') {
    const result = await invoke('resolveApplication', {
      applicationId: form.dataset.application, action: 'reject', reason: get('reason')
    });
    if (result.ok) closeModal();
    return;
  }

  if (kind === 'post') {
    await submitPost(form);
    return;
  }

  if (kind === 'resource') {
    await submitResource(form);
    return;
  }

  if (kind === 'resource-course') {
    await invoke('setResourceCourse', {
      resourceId: form.dataset.resource,
      courseId: get('courseId')
    });
    return;
  }

  if (kind === 'filter') {
    const params = {};
    ['q', 'school', 'courseId', 'term', 'type', 'tag', 'sort'].forEach((name) => {
      const value = get(name);
      if (value) params[name] = value;
    });
    navigate(buildFilterPath('/resources', params));
    return;
  }

  if (kind === 'search-page') {
    const q = get('q');
    const tab = get('tab') || 'posts';
    navigate(`/search?q=${encodeURIComponent(q)}&tab=${tab}${fd.get('attachmentsOnly') ? '&attachments=1' : ''}`);
    return;
  }

  if (kind === 'find-circles') {
    const params = {};
    ['q', 'school', 'courseId', 'term', 'section'].forEach((name) => {
      const value = get(name);
      if (value) params[name] = value;
    });
    const usp = new URLSearchParams(params);
    navigate(`/find-circles${usp.toString() ? `?${usp}` : ''}`);
  }
}

function buildFilterPath(base, params) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) usp.set(k, v);
  });
  const q = usp.toString();
  return q ? `${base}?${q}` : base;
}

async function submitPost(form) {
  const fd = new FormData(form);
  const board = (ui.compose && ui.compose.board) || 'notes';
  const circleId = String(fd.get('circleId') || '');
  const tags = String(fd.get('tags') || '').split(/[,，\s]+/).filter(Boolean).slice(0, 3);
  const body = String(fd.get('body') || '');
  const title = String(fd.get('title') || '');
  const courseId = String(fd.get('courseId') || '') || null;

  if (!body.trim()) {
    showFieldError(form, 'body', '正文不能为空，写几句再发布吧。');
    return;
  }
  if (pendingImageCount || filesUploading()) {
    toast('图片或文件还在处理，请稍候再发布。');
    return;
  }

  // 折叠面板里的「同时收录到找资料」：勾选后才把资料字段一起提交
  const withResource = fd.get('confirmIndex') === 'on';
  const derivedTitle = (title || body.trim().split('\n')[0] || '学习资料').slice(0, 80);
  const resource = withResource ? {
    title: derivedTitle,
    courseId: String(fd.get('resourceCourse') || '') || null,
    school: String(fd.get('school') || ''),
    term: String(fd.get('term') || ''),
    type: String(fd.get('type') || ''),
    coverage: String(fd.get('coverage') || ''),
    limitations: String(fd.get('limitations') || ''),
    confirmedIndex: true
  } : null;

  const result = await invoke('createPost', {
    board, circleId: circleId || null, courseId: circleId ? null : courseId, title, body, tags,
    images: ui.images.map((img) => (img.uploadId ? `upload:${img.uploadId}` : img.dataUrl)),
    attachments: ui.files.map(attachmentForSubmit),
    confirmedOriginal: fd.get('original') === 'on',
    stickerId: String(fd.get('stickerId') || '') || null,
    resource
  });

  if (!result.ok && result.code === 'need_confirm') {
    // 动作返回后页面已重绘，要从当前视图取勾选框
    const confirmBox = viewEl.querySelector('form[data-form="post"] input[name="original"]');
    if (confirmBox && confirmBox.offsetParent) confirmBox.focus();
  }
  if (result.ok) {
    discardPendingImages();
    clearComposeDraft();
    ui.images.forEach(releaseImage);
    ui.images = [];
    ui.files = [];
    if (ui.compose) ui.compose.preview = false;
    if (result.data.hasResource) {
      const created = (ctx.db.resources || []).find((r) => r.postId === result.data.postId);
      navigate(created ? `/resources/${created.id}` : `/posts/${result.data.postId}`);
    } else {
      navigate(`/posts/${result.data.postId}`);
    }
  }
}

function showFieldError(form, name, message) {
  const field = form.elements.namedItem(name);
  const error = form.querySelector(`[data-field-error="${name}"]`);
  if (error) {
    error.textContent = message;
    error.hidden = false;
  }
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
}

/* ---------- 发帖内容暂存：只存在这台设备，发布或清空后删除 ---------- */

function draftStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function restoreComposeDraft() {
  ui.composeDraftLoaded = true;
  ui.composeRestored = false;
  ui.composeDraft = null;
  const storage = draftStorage();
  if (!storage) return;
  try {
    const saved = JSON.parse(storage.getItem(COMPOSE_DRAFT_KEY) || 'null');
    if (!saved || saved.userId !== ctx.me.id || !(saved.title || saved.body || saved.tags)) return;
    ui.composeDraft = saved;
    ui.composeRestored = true;
    ui.compose = { board: saved.board || 'notes', preview: false };
  } catch {
    /* 暂存内容损坏时当作没有 */
  }
}

function readComposeForm(form) {
  const value = (name) => {
    const field = form.elements.namedItem(name);
    return field ? field.value : '';
  };
  return {
    userId: ctx.me ? ctx.me.id : null,
    title: value('title'),
    body: value('body'),
    tags: value('tags'),
    circleId: value('circleId'),
    courseId: value('courseId'),
    board: (ui.compose && ui.compose.board) || 'notes'
  };
}

let composeDraftTimer = 0;

function persistComposeDraft() {
  window.clearTimeout(composeDraftTimer);
  composeDraftTimer = window.setTimeout(() => {
    const storage = draftStorage();
    if (!storage) return;
    const draft = ui.composeDraft;
    try {
      if (draft && (draft.title || draft.body || draft.tags)) storage.setItem(COMPOSE_DRAFT_KEY, JSON.stringify(draft));
      else storage.removeItem(COMPOSE_DRAFT_KEY);
    } catch {
      /* 存储满或被禁用时不影响发布 */
    }
  }, 300);
}

function clearComposeDraft() {
  window.clearTimeout(composeDraftTimer);
  ui.composeDraft = null;
  ui.composeRestored = false;
  const storage = draftStorage();
  if (!storage) return;
  try {
    storage.removeItem(COMPOSE_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** 文档来源确认只在带图片、附件或收录到找资料时出现 */
function syncSourceConfirm() {
  const form = viewEl.querySelector('form[data-form="post"]');
  const box = form && form.querySelector('[data-source-confirm]');
  if (!box) return;
  const indexing = form.elements.namedItem('confirmIndex');
  box.hidden = !(ui.images.length || ui.files.length || (indexing && indexing.checked));
}

async function submitResource(form) {
  const fd = new FormData(form);
  const tags = String(fd.get('tags') || '').split(/[,，\s]+/).filter(Boolean).slice(0, 3);
  const courseId = String(fd.get('resourceCourse') || '');

  // 前端硬校验：课程必填且必须是真实课程；错误显示在字段旁并聚焦，表单内容保留
  const errorEl = form.querySelector('[data-field-error="resourceCourse"]');
  const selectEl = form.querySelector('[name="resourceCourse"]');
  const failField = (message) => {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
    if (selectEl) {
      selectEl.setAttribute('aria-invalid', 'true');
      selectEl.focus({ preventScroll: false });
    }
    toast(message, 'error');
    return { ok: false, message };
  };
  if (!courseId) return failField('请选择这份资料对应的课程。');
  if (!S.courseOf(ctx.db, courseId)) return failField('这份课程不在可选范围，请重新选择。');
  if (filesUploading()) {
    toast('文件还在上传，请稍候再发布。');
    return { ok: false };
  }
  if (errorEl) errorEl.hidden = true;
  if (selectEl) selectEl.removeAttribute('aria-invalid');

  const result = await invoke('createPost', {
    board: 'notes',
    circleId: String(fd.get('circleId') || '') || null,
    courseId: String(fd.get('courseId') || '') || null,
    title: String(fd.get('postTitle') || ''),
    body: String(fd.get('body') || ''),
    tags,
    images: [],
    attachments: ui.files.map(attachmentForSubmit),
    confirmedOriginal: fd.get('original') === 'on',
    stickerId: String(fd.get('stickerId') || '') || null,
    resource: {
      title: String(fd.get('resTitle') || ''),
      courseId,
      school: String(fd.get('school') || ''),
      term: String(fd.get('term') || ''),
      type: String(fd.get('type') || ''),
      coverage: String(fd.get('coverage') || ''),
      limitations: String(fd.get('limitations') || ''),
      confirmedIndex: fd.get('confirmIndex') === 'on'
    }
  });
  if (result.ok) {
    ui.files = [];
    const resource = (ctx.db.resources || []).find((r) => r.postId === result.data.postId);
    navigate(resource ? `/resources/${resource.id}` : `/posts/${result.data.postId}`);
  }
  return result;
}

/* ---------- 图片与文件 ---------- */

const filesUploading = () => ui.files.some((file) => file.status === 'uploading');

/** 已上传的文件只提交 ID，名称和大小以服务端记录为准；演示文件照旧提交示例路径 */
function attachmentForSubmit(file) {
  return file.uploadId
    ? { uploadId: file.uploadId }
    : { name: file.name, sizeBytes: file.sizeBytes, pages: file.pages, path: file.path, status: 'ready' };
}

function releaseImage(image) {
  if (image && image.uploadId && String(image.dataUrl).startsWith('blob:')) URL.revokeObjectURL(image.dataUrl);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片无法读取'));
    };
    img.src = url;
  });
}

/* imageOrientation: 'from-image' 是较新的写法，旧浏览器会直接报错；失败时退回 <img> 解码，
 * 现代浏览器绘制 <img> 时同样按 EXIF 方向摆正 */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* 退回下面的 <img> 解码 */
    }
  }
  return loadImageElement(file);
}

/** 缩到长边 1920 并重新编码：手机照片从几 MB 降到几百 KB，同时去掉拍摄位置等 EXIF 信息 */
async function prepareImage(file) {
  let source;
  try {
    source = await decodeImage(file);
  } catch {
    throw new Error('图片无法读取，换一张试试');
  }
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(width, height));
  // 小的 PNG（截图、板书）保持原样，避免文字被压糊；PNG 没有拍摄位置信息
  if (file.type === 'image/png' && scale === 1 && file.size <= 1.5 * 1024 * 1024) {
    if (source.close) source.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const paint = canvas.getContext('2d');
  paint.fillStyle = '#fff';
  paint.fillRect(0, 0, canvas.width, canvas.height);
  paint.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('图片压缩失败，换一张试试');
  return blob;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败，请重试'));
    reader.readAsDataURL(blob);
  });
}

function parseImages(fileList) {
  const generation = imageReadGeneration;
  Array.from(fileList).forEach((file) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast(`${file.name}：只支持 JPEG、PNG、WebP`, 'error');
      return;
    }
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      toast(`${file.name}：单张不能超过 25 MiB`, 'error');
      return;
    }
    if (ui.images.length + pendingImageCount >= MAX_POST_IMAGE_COUNT) {
      toast(`${file.name}：单帖最多 ${MAX_POST_IMAGE_COUNT} 张图片`, 'error');
      return;
    }
    pendingImageCount += 1;
    const finish = () => {
      if (generation !== imageReadGeneration) return false;
      pendingImageCount = Math.max(0, pendingImageCount - 1);
      ui.pendingImages = pendingImageCount;
      return true;
    };
    prepareImage(file).then(async (blob) => {
      if (generation !== imageReadGeneration) return null;
      if (isRemote) {
        const upload = new File([blob], file.name.replace(/\.\w+$/, blob.type === 'image/png' ? '.png' : '.jpg'), { type: blob.type });
        const response = await fileApi.upload(upload, 'image');
        return { name: file.name, sizeBytes: blob.size, dataUrl: URL.createObjectURL(blob), uploadId: response.file.id };
      }
      const used = ui.images.reduce((sum, image) => sum + (Number(image.sizeBytes) || 0), 0);
      if (used + blob.size > MAX_POST_IMAGE_BYTES) {
        throw new Error(`演示版单帖图片压缩后合计不能超过 ${formatImageBytes(MAX_POST_IMAGE_BYTES)}`);
      }
      return { name: file.name, sizeBytes: blob.size, dataUrl: await blobToDataUrl(blob) };
    }).then((image) => {
      if (!finish()) return;
      if (image) ui.images.push(image);
      ctx.refresh();
    }).catch((error) => {
      if (!finish()) return;
      toast(`${file.name}：${error && error.message ? error.message : '图片处理失败'}`, 'error');
      ctx.refresh();
    });
  });
  ui.pendingImages = pendingImageCount;
  ctx.refresh();
}

/** 真实 PDF：选中后立即上传，进度直接写进进度条，不整页重绘 */
function parsePdfs(fileList) {
  Array.from(fileList).forEach((file) => {
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      toast(`${file.name}：只支持 PDF 文件`, 'error');
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      toast(`${file.name}：单个文件不能超过 20 MiB`, 'error');
      return;
    }
    if (ui.files.length >= 3) {
      toast('最多 3 个 PDF 附件', 'error');
      return;
    }
    const entry = {
      localId: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: file.name, sizeBytes: file.size, status: 'uploading', progress: 0
    };
    ui.files.push(entry);
    fileApi.upload(file, 'pdf', (ratio) => {
      entry.progress = ratio;
      const bar = viewEl.querySelector(`[data-upload-progress="${entry.localId}"]`);
      if (bar) bar.style.width = `${Math.round(ratio * 100)}%`;
    }).then((response) => {
      if (!ui.files.includes(entry)) return;
      Object.assign(entry, {
        status: 'ready', uploadId: response.file.id, name: response.file.name,
        sizeBytes: response.file.sizeBytes, pages: response.file.pages, previewCount: response.file.previewCount
      });
      ctx.refresh();
    }).catch((error) => {
      if (!ui.files.includes(entry)) return;
      ui.files = ui.files.filter((item) => item !== entry);
      toast(`${file.name}：${error && error.message ? error.message : '上传失败'}`, 'error');
      ctx.refresh();
    });
  });
  ctx.refresh();
}

function discardPendingImages() {
  imageReadGeneration += 1;
  pendingImageCount = 0;
  ui.pendingImages = 0;
}

function formatImageBytes(bytes) {
  return `${Math.round(bytes / 1024)} KiB`;
}

/* ---------- 运行时错误提示（避免白屏，并把错误显示出来） ---------- */

function showRuntimeError(message) {
  const view = document.getElementById('view');
  if (!view) return;
  if (document.getElementById('runtime-error')) return;
  const box = document.createElement('div');
  box.id = 'runtime-error';
  box.className = 'notice notice-danger';
  box.style.margin = '16px auto';
  box.style.maxWidth = '860px';
  box.innerHTML = `<span><b>页面脚本出错：</b>${esc(String(message))}<br>
    <span class="tiny">这是静态演示版的内置错误提示。请刷新页面重试；若持续出现，请在控制台查看堆栈。</span></span>`;
  view.prepend(box);
}

window.addEventListener('error', (event) => {
  showRuntimeError(event.message || '未知错误');
});
window.addEventListener('unhandledrejection', (event) => {
  showRuntimeError((event.reason && event.reason.message) || '未处理的异步错误');
});

/* ---------- 启动 ---------- */

let quotaWarned = false;
let storeSubscribed = false;

function subscribeStore() {
  if (storeSubscribed) return;
  storeSubscribed = true;
  store.subscribe((state, meta) => {
    render({ preserve: true });
    if (meta && meta.saved && meta.saved.ok === false && meta.saved.code === 'quota' && !quotaWarned) {
      quotaWarned = true;
      toast('本机浏览器存储空间不足，最新改动可能没有保存', 'error');
    }
  });
}

/* 同一对象的同一动作进行中时忽略连点：线上每次操作都要等服务端返回 */
const actionsInFlight = new Set();

delegate(document, 'click', '[data-action]', (event, el) => {
  if (el.tagName === 'A' && el.getAttribute('href') && !el.dataset.action) return;
  event.preventDefault();
  const { dataset } = el;
  const key = [dataset.action, dataset.post, dataset.attachment, dataset.circle, dataset.comment, dataset.user, dataset.notification, dataset.index]
    .filter(Boolean).join(':');
  if (actionsInFlight.has(key)) return;
  actionsInFlight.add(key);
  Promise.resolve(handleAction(el.dataset.action, el)).catch((error) => {
    console.error('[click] handler failed', error);
    toast(`操作失败：${error && error.message ? error.message : '未知错误'}`, 'error');
  }).finally(() => actionsInFlight.delete(key));
});

/* 下拉菜单（details）：点外面、选了菜单项或按 Esc 都收起 */
const openMenus = () => document.querySelectorAll('details.account-menu[open], details.more-menu[open]');
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  openMenus().forEach((menu) => {
    const pickedItem = target && menu.contains(target) && target.closest('a, button');
    if (!menu.contains(target) || pickedItem) menu.open = false;
  });
});

/* 整卡点击：打开详情并做共享元素过渡；链接、按钮、选字保持原行为 */
delegate(document, 'click', '.card-hover', (event, card) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const interactive = event.target instanceof Element
    ? event.target.closest('a, button, input, textarea, select, label, summary')
    : null;
  const href = card.dataset.href;
  if (!href) return;

  // 只接管“指向本卡详情”的链接；其他链接（如原帖讨论、圈链接）保持默认跳转
  if (interactive) {
    const isOwnLink = interactive.tagName === 'A' && interactive.getAttribute('href') === href;
    if (!isOwnLink) return;
  }

  event.preventDefault();
  // 记录来源卡片在视口里的位置，让详情打开时标题落在相近高度，减少纵向跳变
  ui.vtSourceTop = card.getBoundingClientRect().top;
  if (!isTouchPointer()) {
    card.style.viewTransitionName = 'gy-card';
    vtSourceEl = card;
  }
  navigate(href);
});
delegate(document, 'click', '[data-close-backdrop]', (event, el) => {
  if (event.target === el) closeModal();
});

delegate(document, 'submit', 'form[data-form]', (event, form) => {
  event.preventDefault();
  if (form.dataset.busy === '1') return;
  const submit = form.querySelector('button[type="submit"]');
  form.dataset.busy = '1';
  if (submit) {
    submit.disabled = true;
    submit.classList.add('btn-pending');
  }
  Promise.resolve(handleSubmit(form)).catch((error) => {
    console.error('[submit] handler failed', error);
    toast(`提交失败：${error && error.message ? error.message : '未知错误'}`, 'error');
  }).finally(() => {
    delete form.dataset.busy;
    if (submit) {
      submit.disabled = false;
      submit.classList.remove('btn-pending');
    }
  });
});

delegate(document, 'change', '[data-autosubmit]', (event, el) => {
  const form = el.closest('form');
  if (!form) return;
  // 资料里的学校包含课程；换学校后清掉不属于新学校的旧课程，避免无结果的组合。
  if (form.dataset.form === 'filter' && el.name === 'school' && el.value) {
    const course = form.elements.namedItem('courseId');
    const selectedCourse = course && course.selectedOptions && course.selectedOptions[0];
    if (course && course.value && selectedCourse?.dataset.school !== el.value) course.value = '';
  }
  Promise.resolve(handleSubmit(form)).catch(() => {});
});

delegate(document, 'change', 'input[type="file"][data-upload="image"]', (event, el) => {
  if (el.files && el.files.length) parseImages(el.files);
  el.value = '';
});
delegate(document, 'change', 'input[type="file"][data-upload="pdf"]', (event, el) => {
  if (el.files && el.files.length) parsePdfs(el.files);
  el.value = '';
});
/* 挂圈后课程由圈决定，关联课程只在不挂圈时出现 */
function syncComposeCourse() {
  const form = viewEl.querySelector('form[data-form="post"]');
  const field = form && form.querySelector('[data-course-field]');
  const circle = form && form.elements.namedItem('circleId');
  if (field && circle) field.hidden = !!circle.value;
}
delegate(document, 'change', 'form[data-form="post"] [name="circleId"]', syncComposeCourse);

/* 发帖表单：实时预览、暂存内容、输入后清掉校验提示 */
delegate(document, 'input', 'form[data-form="post"] textarea[name="body"]', (event, el) => {
  const preview = viewEl.querySelector('[data-compose-preview]');
  if (preview) preview.innerHTML = renderMarkdown(el.value);
  const error = el.form.querySelector('[data-field-error="body"]');
  if (error) error.hidden = true;
  el.removeAttribute('aria-invalid');
});
const trackComposeDraft = (event, el) => {
  if (el.name === 'circleId') syncComposeCourse();
  if (!ctx.me) return;
  ui.composeDraft = readComposeForm(el.form);
  persistComposeDraft();
};
delegate(document, 'input', 'form[data-form="post"] [name="title"], form[data-form="post"] [name="body"], form[data-form="post"] [name="tags"]', trackComposeDraft);
delegate(document, 'change', 'form[data-form="post"] [name="circleId"], form[data-form="post"] [name="courseId"]', trackComposeDraft);
delegate(document, 'change', 'form[data-form="post"] input[name="confirmIndex"]', syncSourceConfirm);

delegate(document, 'input', '[data-count-for]', (event, el) => updateCounter(el));

delegate(document, 'change', 'input[name="qty"]', () => {
  const modal = overlayEl.querySelector('.modal');
  if (!modal) return;
  const checked = modal.querySelector('input[name="qty"]:checked');
  modal.querySelectorAll('#gift-qty .chip').forEach((chip) => {
    chip.classList.toggle('is-active', !!chip.querySelector('input:checked'));
  });
  const balanceText = modal.querySelector('.modal-row b');
  const after = modal.querySelector('#gift-after');
  if (after && balanceText) {
    const balance = parseInt(balanceText.textContent, 10) || 0;
    after.textContent = `${balance - (checked ? Number(checked.value) : 1)} 枚`;
  }
});

/* 页页表情加载失败时显示文本 fallback，避免整条评论消失；页签插画失败只隐藏装饰 */
document.addEventListener('error', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLImageElement)) return;
  if (target.dataset.bookmarkArt) {
    const art = target.closest('.gy-art');
    if (art) art.remove();
    return;
  }
  if (!target.dataset.stickerId) return;
  const span = document.createElement('span');
  span.className = 'sticker-fallback';
  span.textContent = target.dataset.stickerFallback || '【页页表情】';
  target.replaceWith(span);
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (overlayEl.querySelector('.modal')) closeModal();
    openMenus().forEach((menu) => { menu.open = false; });
  }
  // Ctrl/⌘ + Enter 发送：评论、私信和发帖都一样
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)
    && event.target instanceof HTMLTextAreaElement && event.target.form
    && ['comment', 'direct-message', 'post'].includes(event.target.form.dataset.form)) {
    event.preventDefault();
    event.target.form.requestSubmit();
  }
});

window.addEventListener('hashchange', () => {
  applyRouteChange(routeOf());
});

async function boot() {
  if (isRemote) {
    try {
      const payload = await api.getState();
      store.setState(payload.state);
      if (payload.allowlistConfigured === false) {
        toast('还没配置试用名单：请管理员编辑 server/allowlist.txt', 'error');
      }
    } catch (error) {
      console.error('[boot] 无法连接后端', error);
      overlayEl.innerHTML = `<div class="modal-backdrop"><div class="modal">
        <h2>连接不上试用服务器</h2>
        <p class="small secondary mt-2">请确认后台服务已启动（窗口不要关），然后刷新页面。</p>
        <p class="tiny muted mt-2">${esc(error && error.message ? error.message : '')}</p>
        <div class="modal-actions"><button class="btn" type="button" onclick="location.reload()">刷新</button></div>
      </div></div>`;
      return;
    }
  }
  subscribeStore();
  lastPath = routeOf().path;
  render({ enter: 'route' });
}

boot();







































