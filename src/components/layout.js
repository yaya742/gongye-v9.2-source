/* 全站外壳：顶部导航、移动端底部导航、演示提示条 */

import { esc } from '../lib/format.js';
import { icon, avatar } from '../lib/icons.js';
import { href } from '../router.js';
import * as S from '../state/selectors.js';

const NAV = [
  { name: 'resources', label: '找资料', icon: 'home', match: ['resourcesHome', 'resources', 'resource', 'resourcePublish'] },
  { name: 'circles', label: '课友圈', icon: 'circle', match: ['circles', 'circle', 'findCircles', 'invite'] }
];

function currentFor(route, names) {
  return names.includes(route.name) ? 'page' : null;
}

export function renderHeader(ctx) {
  const { db, me, route } = ctx;
  const unread = me ? S.unreadCount(db, me.id) : 0;
  const q = route.query.q || '';

  const nav = NAV.map((item) => {
    const current = currentFor(route, item.match);
    return `<a href="${href(item.name === 'circles' ? '/circles' : '/')}"
      ${current ? 'aria-current="page"' : ''}>${esc(item.label)}</a>`;
  }).join('');

  return `
  <div class="header-inner">
    <a class="brand" href="${href('/')}" aria-label="共页，返回找资料首页">
      <img src="assets/brand/logo.png" alt="共页" width="75" height="30">
    </a>
    <nav class="main-nav" aria-label="主导航">${nav}</nav>
    <form class="header-search" data-form="header-search" role="search">
      ${icon('search', 'i-sm')}
      <label class="visually-hidden" for="header-q">全站搜索</label>
      <input id="header-q" name="q" type="search" value="${esc(q)}"
        placeholder="搜全站：资料、课程或讨论" autocomplete="off">
    </form>
    <div class="header-actions">
      <a class="btn btn-sm btn-publish" href="${href('/publish')}">${icon('plus', 'i-sm')}发布</a>
      <a class="icon-btn" href="${href('/me/messages')}" aria-label="消息${unread ? `，${unread} 条未读` : ''}">
        ${icon('bell')}
        ${unread ? `<span class="badge">${unread > 9 ? '9+' : unread}</span>` : ''}
      </a>
      ${me
        ? `<a class="icon-btn avatar-btn" href="${href(`/u/${me.id}`)}" aria-label="我的主页">
             ${avatar(me, 'header-avatar')}
           </a>`
        : `<a class="btn btn-ghost btn-sm" href="${href('/login')}">登录</a>`}
    </div>
  </div>`;
}

export function renderDemoStrip(ctx) {
  const text = (ctx.config && ctx.config.demoNotice)
    || '静态演示版：内容与账号均为演示数据，保存在本机浏览器。';
  const label = ctx.config && ctx.config.mode === 'production' ? '浙大学习互助 · 非官方' : '演示模式';
  return `<div class="demo-strip"><b>${label}</b><span>${esc(text)}</span><a href="${href('/about')}">社区规则与隐私说明</a></div>`;
}

export function renderMobileNav(ctx) {
  const { db, me, route } = ctx;
  const unread = me ? S.unreadCount(db, me.id) : 0;
  const items = [
    { label: '找资料', icon: 'home', to: '/', match: ['resourcesHome', 'resources', 'resource', 'resourcePublish'] },
    { label: '课友圈', icon: 'circle', to: '/circles', match: ['circles', 'circle', 'findCircles', 'invite'] },
    { label: '发布', icon: 'plus', to: '/publish', match: ['compose', 'postEdit'] },
    { label: '消息', icon: 'bell', to: '/me/messages', match: ['messages'], badge: unread },
    { label: '我的', icon: 'user', to: me ? `/u/${me.id}` : '/login', match: ['profile', 'saved', 'wallet', 'settings', 'login'] }
  ];
  return items.map((item) => {
    const current = item.match.includes(route.name) ? 'aria-current="page"' : '';
    const badge = item.badge ? `<span class="badge">${item.badge > 9 ? '9+' : item.badge}</span>` : '';
    return `<a href="${href(item.to)}" ${current}>
      ${icon(item.icon)}${badge}<span>${esc(item.label)}</span>
    </a>`;
  }).join('');
}


