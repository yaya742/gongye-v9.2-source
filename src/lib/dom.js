/* 视图层通用工具：查询、事件委托、内容替换 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** 用 HTML 字符串替换容器内容 */
export function setHTML(root, html) {
  if (root) root.innerHTML = html;
}

/** 把 HTML 字符串转成单个元素（包一层 div 便于取首个子节点） */
export function el(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = String(html).trim();
  return wrap.firstElementChild;
}

/** 事件委托：只在 root 上绑定一次 */
export function delegate(root, type, selector, handler) {
  if (!root) return () => {};
  const listener = (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

export function attr(node, name, fallback = '') {
  if (!node) return fallback;
  const value = node.getAttribute(name);
  return value == null ? fallback : value;
}

export function num(node, name, fallback = 0) {
  const value = Number(attr(node, name, ''));
  return Number.isFinite(value) ? value : fallback;
}

export function bool(node, name) {
  return attr(node, name) === 'true' || attr(node, name) === '1';
}

/** 把对象转成 data-* 属性串（值会被转义） */
export function dataAttrs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => {
      const name = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const value = v === true ? '1' : String(v);
      return `data-${name}="${escapeAttr(value)}"`;
    })
    .join(' ');
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function debounce(fn, wait = 250) {
  let timer = 0;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function scrollToTop() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/** 从 URL 查询串构造对象 */
export function parseQuery(search = '') {
  const out = {};
  const raw = String(search || '').replace(/^\?/, '');
  if (!raw) return out;
  for (const part of raw.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}

export function buildQuery(params, base = '') {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    usp.set(k, String(v));
  });
  const q = usp.toString();
  return q ? `${base}?${q}` : base;
}
