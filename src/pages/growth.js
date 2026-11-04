/* 我的成长：等级、进度、五级路线、经验来源与私有流水 */

import { href } from '../router.js';
import * as S from '../state/selectors.js';
import { GROWTH_RULES } from '../data/growth.js';
import { notice, icon } from '../components/ui.js';
import { esc, timeAgo, formatDateTime } from '../lib/format.js';

const RULES = GROWTH_RULES.rewards;

function progressBlock(info) {
  if (info.isMax) {
    return `<div class="growth-progress">
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
        <span style="width:100%"></span>
      </div>
      <p class="tiny muted mt-2">已达当前最高等级，经验继续累计：${info.xp}</p>
    </div>`;
  }
  return `<div class="growth-progress">
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${info.percent}">
      <span style="width:${info.percent}%"></span>
    </div>
    <p class="tiny muted mt-2">本级 ${info.within}/${info.span} · ${info.percent}% · 还差 ${info.remaining} 到 LV.${info.level + 1} ${esc(info.nextName)}</p>
  </div>`;
}

export function growth(ctx) {
  const { db, me } = ctx;
  if (!me) {
    return `<div class="layout-1"><div class="card">
      <h1>我的成长</h1>
      ${notice('登录后查看自己的等级、经验与私有记录。', 'warn', 'lock')}
      <a class="btn mt-4" href="${href('/login', { next: '/me/growth' })}">登录</a>
    </div></div>`;
  }

  const info = S.levelInfo(db, me.id);
  const today = S.growthToday(db, me.id);
  const ledger = S.xpLedger(db, me.id);
  const nextDayText = today.post >= RULES.post.daily;

  const route = GROWTH_RULES.levels.map((level) => {
    const reached = info.xp >= level.threshold;
    const current = level.level === info.level;
    return `<li class="level-step ${reached ? 'is-reached' : ''} ${current ? 'is-current' : ''}">
      <img src="assets/badges/level-${level.level}-icon.svg" alt="" width="40" height="40" loading="lazy">
      <div>
        <div class="small"><b>LV.${level.level} ${esc(level.name)}</b>${current ? ' · 当前' : ''}</div>
        <div class="tiny muted">${level.threshold === 0 ? '起点' : `累计 ${level.threshold} 经验`}</div>
      </div>
    </li>`;
  }).join('');

  const rows = ledger.length
    ? ledger.slice(0, 50).map((row) => {
      const sign = row.delta > 0 ? `+${row.delta}` : String(row.delta);
      const label = row.kind === 'revoke' ? '撤回' : row.kind === 'restore' ? '恢复' : '获得';
      return `<li class="growth-row">
        <span class="growth-delta ${row.delta > 0 ? 'is-plus' : 'is-minus'}">${sign}</span>
        <div class="grow">
          <div class="small">${row.link ? `<a class="link" href="${esc(row.link)}">${esc(row.title)}</a>` : esc(row.title)}</div>
          <div class="tiny muted">${esc(label)} · ${esc(row.reason || '')} · ${esc(relativeTime(row.at))}</div>
        </div>
      </li>`;
    }).join('')
    : '<li class="tiny muted">还没有经验记录。发一篇合格帖子或一条有内容的评论就会开始累计。</li>';

  return `
  <div class="layout-2">
    <main>
      <nav class="crumbs" aria-label="面包屑"><a href="${href(`/u/${me.id}`)}">我的主页</a><span>/</span><span>我的成长</span></nav>

      <section class="card growth-hero">
        <div class="row wrap" style="align-items:flex-end;gap:16px">
          <div class="grow">
            <div class="tiny muted">我的等级</div>
            <h1 class="growth-level" style="font-size:26px;margin:4px 0">LV.${info.level} ${esc(info.name)}</h1>
            <p class="small secondary" style="margin:0">累计 ${info.xp} 经验 · 等级只表示参与积累，不代表知识认证。</p>
          </div>
          <img class="growth-mascot" src="assets/mascot/yeye-growth.png" alt="" width="96" height="96" loading="lazy">
        </div>
        ${progressBlock(info)}
      </section>

      <section class="card">
        <div class="card-title">五级路线</div>
        <ul class="level-route">${route}</ul>
      </section>

      <section class="card">
        <div class="card-title">经验来源</div>
        <div class="stack small">
          <p>· 合格帖子 +${RULES.post.xp}，每天最多 ${RULES.post.daily} 篇（正文至少 ${RULES.post.minChars} 个有效字）</p>
          <p>· 合格评论或回复 +${RULES.comment.xp}，每天最多 ${RULES.comment.daily} 条，同一帖子每天最多 ${RULES.comment.perPostDaily} 条</p>
          <p>· 被求助帖作者采纳 +${RULES.accepted.xp}，每天最多 ${RULES.accepted.daily} 次</p>
          <p>· 收到同学送的页签 +${RULES.marker.xp}，每天最多 ${RULES.marker.daily} 枚（同一人每天最多 1 次）</p>
        </div>
        <div class="growth-today mt-3">
          <span class="chip chip-sm">今日帖子 ${today.post}/${RULES.post.daily}</span>
          <span class="chip chip-sm">今日评论 ${today.comment}/${RULES.comment.daily}</span>
          <span class="chip chip-sm">今日采纳 ${today.accepted}/${RULES.accepted.daily}</span>
          <span class="chip chip-sm">今日页签 ${today.marker}/${RULES.marker.daily}</span>
        </div>
        <p class="tiny muted mt-3">${nextDayText
          ? '今天计分名额用完了，照常发帖和讨论，只是不再加经验。'
          : '领取页签、赠送页签、点赞、收藏、下载和纯表情都不加经验；只有收到同学送的页签才 +5。'}</p>
      </section>

      <section class="card">
        <div class="card-title">私有经验记录</div>
        <ul class="growth-ledger">${rows}</ul>
        <p class="tiny muted mt-2">只有你自己能看到精确经验与记录；他人只能看到详情里的公开等级。</p>
      </section>
    </main>

    <aside class="rail">
      <section class="card">
        <div class="card-title">规则速览</div>
        <div class="stack small secondary">
          <p>· 经验是长期累计值，达到门槛自动升级，不需要领取。</p>
          <p>· 删除或违规内容会撤回对应经验，等级随有效经验重算。</p>
          <p>· 等级不限制下载、提问和评论，也不带来管理权限。</p>
        </div>
        <a class="btn btn-ghost btn-sm mt-3" href="${href('/me/settings')}">账号设置</a>
      </section>
    </aside>
  </div>`;
}

function relativeTime(iso) {
  try {
    return timeAgo(iso);
  } catch {
    return formatDateTime(iso);
  }
}

