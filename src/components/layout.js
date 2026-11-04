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
  const directUnread = me ? (db.directMessages || [])
    .filter((message) => message.recipientId === me.id && !message.readAt).length : 0;
  const totalUnread = unread + directUnread;
  const q = route.query.q || '';
  const pageHasScopedSearch = ['resourcesHome', 'resources', 'search'].includes(route.name);

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
    ${pageHasScopedSearch ? '' : `<form class="header-search" data-form="header-search" role="search">
      ${icon('search', 'i-sm')}
      <label class="visually-hidden" for="header-q">全站搜索</label>
      <input id="header-q" name="q" type="search" value="${esc(q)}"
        placeholder="搜全站：资料、课程或讨论" autocomplete="off">
    </form>`}
    <div class="header-actions">
      ${pageHasScopedSearch ? '' : `<a class="icon-btn header-search-link" href="${href('/search')}" aria-label="搜索">${icon('search')}</a>`}
      <a class="btn btn-sm btn-publish" href="${href('/publish')}">${icon('plus', 'i-sm')}发布</a>
      <a class="icon-btn header-bell" href="${href('/me/messages')}" aria-label="消息${totalUnread ? `，${totalUnread} 条未读` : ''}">
        ${icon('bell')}
        ${totalUnread ? `<span class="badge">${totalUnread > 9 ? '9+' : totalUnread}</span>` : ''}
      </a>
      ${me
        ? `<details class="account-menu">
            <summary class="account-menu-trigger" aria-label="打开我的菜单">
              ${avatar(me, 'header-avatar')}<span class="account-menu-label">我的</span>
            </summary>
            <nav class="account-menu-panel" aria-label="个人功能">
              <a href="${href(`/u/${me.id}`)}">我的主页</a>
              <a href="${href('/me/saved')}">我的收藏</a>
              <a href="${href('/me/wallet')}">我的页签</a>
              <a href="${href('/me/growth')}">我的成长</a>
              <a class="account-menu-settings" href="${href('/me/settings')}">账号设置</a>
            </nav>
          </details>`
        : `<a class="btn btn-ghost btn-sm" href="${href('/login')}">登录</a>`}
    </div>
  </div>`;
}

export function renderFooter() {
  return `<div class="footer-inner">
    <span>共页 · 同学之间的学习社区</span>
    <nav aria-label="站点信息">
      <a href="${href('/about')}">关于共页</a>
      <a href="${href('/terms')}">用户协议</a>
      <a href="${href('/privacy')}">隐私政策</a>
    </nav>
  </div>`;
}

export function renderDemoStrip(ctx) {
  const isPilot = ctx.config && ctx.config.mode === 'production';
  if (!isPilot) return '';
  const customNotice = ctx.config && ctx.config.demoNotice;
  const defaultDemoNotice = '静态演示版：内容与账号均为演示数据，数据保存在本机浏览器，不会上传服务器。';
  const hasCustomNotice = customNotice && customNotice !== defaultDemoNotice;
  if (ctx.route && ctx.route.name === 'login' && !ctx.me && !hasCustomNotice) return '';
  const text = customNotice
    || (isPilot
      ? '登录资格不代表内容私密；任何访问者都可浏览已发布内容。请勿上传隐私或整本教材。'
      : '内容与账号均为本机演示数据；操作保存在当前浏览器，不会同步给其他人。');
  const label = isPilot ? '内部试用' : '演示模式';
  return `<div class="demo-strip"><b>${label}</b><span>${esc(text)}</span></div>`;
}

export function renderMobileNav(ctx) {
  const { db, me, route } = ctx;
  const unread = me ? S.unreadCount(db, me.id) + (db.directMessages || [])
    .filter((message) => message.recipientId === me.id && !message.readAt).length : 0;
  const items = [
    { label: '找资料', icon: 'home', to: '/', match: ['resourcesHome', 'resources', 'resource'] },
    { label: '课友圈', icon: 'circle', to: '/circles', match: ['circles', 'circle', 'findCircles', 'invite'] },
    { label: '发布', icon: 'plus', to: '/publish', match: ['compose', 'postEdit', 'resourcePublish'], publish: true },
    { label: '消息', icon: 'bell', to: '/me/messages', match: ['messages'], badge: unread },
    { label: '我的', icon: 'user', to: me ? `/u/${me.id}` : '/login', match: ['profile', 'saved', 'wallet', 'growth', 'settings', 'login'] }
  ];
  return items.map((item) => {
    const current = item.match.includes(route.name) ? 'aria-current="page"' : '';
    const badge = item.badge ? `<span class="badge">${item.badge > 9 ? '9+' : item.badge}</span>` : '';
    return `<a href="${href(item.to)}" ${item.publish ? 'class="nav-publish"' : ''} ${current}>
      ${icon(item.icon)}${badge}<span>${esc(item.label)}</span>
    </a>`;
  }).join('');
}


