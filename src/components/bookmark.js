/* 每日页签：第九版「一日一画」102 天配置 + 浅色纸面卡片。
 * 只负责展示；领取、余额、赠送仍走现有业务规则。
 * 插画按日期取 illustration_path，不按 motif 轮换；4 个公历文化日期受
 * window.__GONGYE_CONFIG__.culturalThemes 控制，关闭时整张卡切中性版本。
 */

import { esc, shanghaiDate } from '../lib/format.js';
import { href } from '../router.js';
import * as S from '../state/selectors.js';
import { bookmarkEntryFor } from '../data/daily-bookmarks.js';

const FALLBACK = {
  date: null,
  weekday: '',
  lunar_label: '',
  theme_title: '每日一页',
  quote_lines: ['世界很大，', '我们共读一页。'],
  quote_attribution: '— 共页',
  quote_title: null,
  footer_label: '日期配置更新中',
  motif: null,
  illustration_path: null,
  event_type: 'brand'
};

function culturalThemesEnabled() {
  const config = (typeof window !== 'undefined' && window.__GONGYE_CONFIG__) || {};
  return config.culturalThemes !== false;
}

function dayLabel(entry) {
  return entry && entry.date ? entry.date.replace(/-/g, '.') : '';
}

/** 纸面页签：full 用于弹层，compact 用于右栏 */
export function bookmarkSheet(entry = FALLBACK, { compact = false } = {}) {
  const data = entry || FALLBACK;
  const lines = Array.isArray(data.quote_lines) && data.quote_lines.length
    ? data.quote_lines
    : [data.quote || ''];
  const art = data.illustration_path
    || (data.motif ? `assets/motifs/${data.motif}.webp` : '');
  const remembrance = data.event_type === 'remembrance' ? ' is-remembrance' : '';
  const cls = `gy-bookmark ${compact ? 'is-compact' : 'is-full'}${remembrance}`;
  const title = data.quote_title ? `<cite class="gy-title">《${esc(data.quote_title)}》</cite>` : '';
  const date = data.date ? `<time class="gy-date" datetime="${esc(data.date)}">${esc(dayLabel(data))}</time>` : '';
  const lunar = [data.lunar_label, data.weekday].filter(Boolean).join(' · ');
  return `
  <article class="${cls}">
    <span class="gy-ribbon" aria-hidden="true"></span>
    ${date}
    ${lunar ? `<p class="gy-lunar">${esc(lunar)}</p>` : ''}
    <p class="gy-theme">${esc(data.theme_title || '每日一页')}</p>
    <blockquote class="gy-quote">${lines.map((line) => `<span>${esc(line)}</span>`).join('')}</blockquote>
    <div class="gy-author"><span>${esc(data.quote_attribution || '— 共页')}</span>${title}</div>
    ${art ? `<div class="gy-art" aria-hidden="true"><img src="${esc(art)}" alt="" loading="lazy" decoding="async" data-bookmark-art></div>` : ''}
    <footer class="gy-foot"><span class="gy-wordmark">共页</span><small>${esc(data.footer_label || '每日一页')}</small></footer>
  </article>`;
}

export function todayEntry() {
  return bookmarkEntryFor(shanghaiDate(new Date()), { culturalThemes: culturalThemesEnabled() });
}

/** 首页右栏：纸面页签 + 可赠余额 + 领取/查看 */
export function signCard(ctx) {
  const { db, me } = ctx;
  const entry = todayEntry();
  const sheet = bookmarkSheet(entry, { compact: true });

  if (!me) {
    return `<section class="card sign-card bookmark-card">
      ${sheet}
      <div class="bookmark-balance"><b>—</b><span>枚可赠页签</span></div>
      <a class="btn btn-sm" href="${href('/login', { next: '/me/wallet' })}">登录后查看</a>
      <small class="tiny muted">每日 1 枚 · 可存 30 枚 · 无连续签到要求</small>
    </section>`;
  }

  const state = S.claimState(db, me.id);
  let button = '';
  if (state.canClaim) {
    button = `<button class="btn btn-sm" type="button" data-action="claim-daily">领取今日页签</button>`;
  } else if (state.code === 'claimed') {
    button = `<button class="btn btn-ghost btn-sm" type="button" data-action="open-bookmark">查看今日页签</button>`;
  } else if (state.code === 'full') {
    button = `<button class="btn btn-ghost btn-sm" type="button" disabled>已存满，送出后再领</button>`;
  } else if (state.code === 'unverified') {
    button = `<a class="btn btn-ghost btn-sm" href="${href('/me/settings')}">验证邮箱后可领取</a>`;
  }

  return `<section class="card sign-card bookmark-card">
    ${sheet}
    <div class="bookmark-balance"><b>${state.balance}</b><span>枚可赠页签</span></div>
    ${button}
    <small class="tiny muted">每日 1 枚 · 可存 30 枚 · 无连续签到要求</small>
    <a class="tiny link" href="${href('/me/wallet')}">收支记录 →</a>
  </section>`;
}
