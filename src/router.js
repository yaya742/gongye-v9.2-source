/* 前端路由：用 hash 承载路径，静态托管无需服务端重写也能直达深层页面。
 *
 * 分享链接形式：#/resources/r_calc_notes
 * 如果托管平台已配置「未知路径回退 index.html」，/resources/r_calc_notes 这类
 * 干净链接也能打开：首次加载时按 pathname 解析，随后统一成 hash 形式。
 */

import { parseQuery } from './lib/dom.js';

export function normalizePath(path) {
  let p = String(path || '').trim();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

export function href(path, query = null) {
  const p = normalizePath(path);
  if (!query) return `#${p}`;
  const usp = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === false) return;
    usp.set(k, String(v));
  });
  const q = usp.toString();
  return q ? `#${p}?${q}` : `#${p}`;
}

export function parseLocation() {
  const rawHash = String(location.hash || '').replace(/^#/, '');
  let raw = rawHash;
  if (!raw) {
    const path = location.pathname || '/';
    if (path === '/' || /\/index\.html$/.test(path)) {
      raw = '/';
    } else {
      raw = path.replace(/\.html$/, '');
    }
  }
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = normalizePath(pathPart);
  const segments = path.split('/').filter(Boolean);
  const query = parseQuery(queryPart);
  return { path, segments, query, search: queryPart };
}

/** 把路径解析成页面名与参数 */
export function routeOf(loc = parseLocation()) {
  const seg = loc.segments;
  const query = loc.query;
  const base = { path: loc.path, query, segments: seg, name: 'notFound', params: {} };

  if (seg.length === 0) return { ...base, name: 'resourcesHome' };
  const [a, b, c] = seg;

  if (a === 'resources') {
    if (!b) return { ...base, name: 'resources' };
    return { ...base, name: 'resource', params: { id: b } };
  }
  if (a === 'publish') {
    if (b === 'resource') return { ...base, name: 'resourcePublish' };
    return { ...base, name: 'compose' };
  }
  if (a === 'circles') {
    if (!b) return { ...base, name: 'circles' };
    return { ...base, name: 'circle', params: { id: b } };
  }
  if (a === 'find-circles') return { ...base, name: 'findCircles' };
  if (a === 'invite' && b) return { ...base, name: 'invite', params: { code: b } };
  if (a === 'posts' && b) {
    if (c === 'edit') return { ...base, name: 'postEdit', params: { id: b } };
    return { ...base, name: 'post', params: { id: b } };
  }
  if (a === 'courses' && b) return { ...base, name: 'course', params: { id: b } };
  if (a === 'search') return { ...base, name: 'search' };
  if (a === 'u' && b) return { ...base, name: 'profile', params: { id: b } };
  if (a === 'me') {
    if (b === 'saved') return { ...base, name: 'saved' };
    if (b === 'messages') return { ...base, name: 'messages' };
    if (b === 'wallet') return { ...base, name: 'wallet' };
    if (b === 'growth') return { ...base, name: 'growth' };
    if (b === 'settings') return { ...base, name: 'settings' };
    return { ...base, name: 'profile', params: { id: 'me' } };
  }
  if (a === 'login') return { ...base, name: 'login' };
  if (a === 'admin') return { ...base, name: 'admin' };
  if (a === 'about') return { ...base, name: 'about' };
  return base;
}

export function navigate(path, options = {}) {
  const target = String(path).startsWith('#') ? String(path) : href(path);
  const { replace = false } = options;
  if (replace) {
    history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = target;
  }
}

/** 当前分享链接（绝对地址） */
export function absoluteShare(path) {
  const base = `${location.origin}${location.pathname}`;
  return `${base}${path.startsWith('#') ? path : href(path)}`;
}

