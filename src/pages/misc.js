/* 课程页、全站搜索、管理后台、404 */

import { href } from '../router.js';
import * as S from '../state/selectors.js';
import {
  postCard, resourceCard, emptyState, notice, icon, avatar, statRow, statusPill
} from '../components/ui.js';
import { esc, timeAgo, formatDateTime, truncate, stripMarkdown } from '../lib/format.js';

/* ---------- 课程页 ---------- */

export function course(ctx) {
  const { db, me, route } = ctx;
  const course = S.courseOf(db, route.params.id);
  if (!course) {
    return `<div class="layout-1">${emptyState({
      img: 'empty-search.svg', title: '课程不存在', text: '课程目录由平台人工维护，可能已被合并。',
      actions: `<a class="btn btn-sm" href="${href('/resources')}">回到找资料</a>`
    })}</div>`;
  }
  const circles = S.courseCircles(db, course.id);
  const active = circles.filter((c) => c.status === 'active');
  const archived = circles.filter((c) => c.status === 'archived');
  const collected = S.collectedPosts(db, course.id);
  const resources = S.searchResources(db, { courseId: course.id, sort: 'recent' }).items;
  const following = me ? S.isFollowing(db, me.id, 'course', course.id) : false;
  const posts = (db.posts || [])
    .filter((p) => p.courseId === course.id && p.status === 'published')
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const tab = route.query.tab === 'posts' ? 'posts' : 'resources';
  const circle = active[0] || null;
  const joined = !!(me && circle && S.isActiveMember(db, me.id, circle.id));
  const members = circle ? S.countMembers(db, circle.id) : 0;

  const tabContent = tab === 'posts'
    ? (posts.length
      ? `<section class="card"><ul class="discuss-list">
          ${posts.slice(0, 12).map((post) => {
            const author = S.userOf(db, post.authorId);
            const comments = S.commentCount(db, post.id);
            return `<li>
              <a class="discuss-title" href="${href(`/posts/${post.id}`)}">${esc(post.title || strip(post.body))}</a>
              <span class="discuss-meta">${esc(author ? author.nickname : '同学')} · ${esc(timeAgo(post.publishedAt))}${comments ? ` · 评论 ${comments}` : ''}</span>
            </li>`;
          }).join('')}
        </ul></section>`
      : `<div class="card">${emptyState({
        img: 'empty-feed.svg', title: '还没有讨论',
        text: '这门课的第一个问题，也许正是别人想问的。',
        actions: `<a class="btn btn-sm" href="${href('/publish', circle ? { circle: circle.id } : null)}">发第一帖</a>`
      })}</div>`)
    : (resources.length
      ? `${resources.slice(0, 6).map((item) => resourceCard(ctx, item)).join('')}
        ${resources.length > 6 ? `<a class="link small" href="${href('/resources', { courseId: course.id })}">查看全部 ${resources.length} 份 →</a>` : ''}`
      : `<div class="card">${emptyState({
        img: 'empty-search.svg', title: '这门课还没有公开资料',
        text: '分享第一份整理，同课程的同学就能搜到。',
        actions: `<a class="btn btn-sm" href="${href('/publish/resource', { course: course.id })}">分享本课程资料</a>`
      })}</div>`);

  return `
  <div class="layout-2">
    <main>
      <nav class="crumbs" aria-label="面包屑"><a href="${href('/resources')}">找资料</a><span>/</span><span>${esc(course.name)}</span></nav>
      <section class="card mt-4 course-head">
        <div class="identity">
          <div class="identity-mark"><img src="assets/art/logo-mono.svg" alt=""></div>
          <div class="grow">
            <h1>${esc(course.name)}</h1>
            <div class="identity-meta">
              <span>${esc(course.school)}</span>
              ${course.code ? `<span class="dot-sep">·</span><span>${esc(course.code)}</span>` : ''}
              <span class="dot-sep">·</span><span>${esc(course.category || '课程')}</span>
            </div>
          </div>
        </div>
        ${statRow([
          { value: resources.length, label: '份资料' },
          { value: posts.length, label: '篇讨论' },
          { value: members, label: '位圈内成员' }
        ])}
        <div class="row wrap mt-4">
          ${circle
            ? joined
              ? `<a class="btn btn-sm" href="${href(`/circles/${circle.id}`)}">进入课友圈</a>`
              : `<button class="btn btn-sm" type="button" data-action="join-circle" data-circle="${esc(circle.id)}">加入课友圈</button>`
            : `<a class="btn btn-sm" href="${href('/find-circles', { courseId: course.id, apply: '1' })}">申请建圈</a>`}
          <a class="btn btn-ghost btn-sm" href="${href('/publish/resource', { course: course.id })}">分享本课程资料</a>
          ${me ? `<button class="btn btn-ghost btn-sm" type="button" data-action="follow-course" data-course="${esc(course.id)}">
            ${following ? '已关注课程' : '关注课程'}</button>` : ''}
        </div>
      </section>

      <div class="tabs" role="tablist">
        <a class="tab" role="tab" aria-selected="${tab === 'resources'}" href="${href(`/courses/${course.id}`)}">资料 ${resources.length}</a>
        <a class="tab" role="tab" aria-selected="${tab === 'posts'}" href="${href(`/courses/${course.id}`, { tab: 'posts' })}">讨论 ${posts.length}</a>
      </div>
      ${tabContent}
    </main>

    <aside class="rail">
      ${circle ? `<section class="card">
        <div class="card-title">这门课的课友圈</div>
        <p class="small secondary">全课程共用一个圈，${members} 位成员。${joined ? '' : '加入后可以发帖和提问。'}</p>
        <a class="link small" href="${href(`/circles/${circle.id}`)}">看看圈内讨论 →</a>
      </section>` : ''}
      ${collected.length ? `<section class="card">
        <div class="card-title">作者精选</div>
        ${collected.map(({ post, collection }) => `<div class="mb-3">
          <a class="small" href="${href(`/posts/${post.id}`)}">${esc(post.title || strip(post.body))}</a>
          <div class="tiny muted">${esc(timeAgo(collection.createdAt))}收录</div>
        </div>`).join('')}
      </section>` : ''}
      ${archived.length ? `<section class="card">
        <div class="card-title">已归档的圈</div>
        ${archived.map((item) => `<div class="mb-3">
          <a class="small" href="${href(`/circles/${item.id}`)}">课程圈 · 只读</a>
          <div class="tiny muted">${S.countMembers(db, item.id)} 位成员</div>
        </div>`).join('')}
      </section>` : ''}
    </aside>
  </div>`;
}

function strip(text) {
  return truncate(String(text || '').replace(/\s+/g, ' '), 30);
}

/* ---------- 搜索 ---------- */

export function search(ctx) {
  const { db, me, route } = ctx;
  const q = route.query.q || '';
  const tab = ['posts', 'courses', 'users'].includes(route.query.tab) ? route.query.tab : 'posts';
  const attachmentsOnly = route.query.attachments === '1';
  const result = S.searchEverywhere(db, { q, tab, attachmentsOnly });

  const tabs = [
    { key: 'posts', label: '帖子' },
    { key: 'courses', label: '课程' },
    { key: 'users', label: '用户' }
  ].map((item) => `<a class="tab" role="tab" aria-selected="${tab === item.key}"
    href="${href('/search', { q, tab: item.key === 'posts' ? '' : item.key, attachments: attachmentsOnly ? '1' : '' })}">${esc(item.label)}</a>`).join('');

  let body = '';
  if (tab === 'courses') {
    body = result.items.length
      ? result.items.map((course) => `<div class="card card-tight">
          <div class="row wrap" style="gap:8px">
            <a class="small" href="${href(`/courses/${course.id}`)}"><b>${esc(course.name)}</b></a>
            <span class="tiny muted">${esc(course.school)}${course.code ? ` · ${esc(course.code)}` : ''}</span>
            <span class="grow"></span>
            <a class="chip chip-sm" href="${href('/resources', { courseId: course.id })}">资料</a>
            <a class="chip chip-sm" href="${href('/find-circles', { courseId: course.id })}">找圈</a>
          </div>
        </div>`).join('')
      : `<div class="card">${emptyState({ img: 'empty-search.svg', title: '没有匹配的课程', text: '试试只输入课程名的一部分。' })}</div>`;
  } else if (tab === 'users') {
    body = result.items.length
      ? result.items.map((user) => `<div class="card card-tight">
          <div class="author">
            ${avatar(user)}
            <div class="grow">
              <div class="author-name"><a href="${href(`/u/${user.id}`)}">${esc(user.nickname)}</a></div>
              <div class="tiny muted">${esc(user.bio || '还没有简介')} · 发过 ${S.postsByAuthor(db, user.id).length} 篇</div>
            </div>
            ${me && me.id !== user.id
              ? `<button class="chip chip-sm" type="button" data-action="follow-user" data-user="${esc(user.id)}">
                  ${S.isFollowing(db, me.id, 'user', user.id) ? '已关注' : '关注'}</button>` : ''}
          </div>
        </div>`).join('')
      : `<div class="card">${emptyState({ img: 'empty-search.svg', title: '没有匹配的用户', text: '可以换一个昵称再试。' })}</div>`;
  } else {
    body = result.items.length
      ? result.items.map((post) => postCard(ctx, post)).join('')
      : `<div class="card">${emptyState({
        img: 'empty-search.svg',
        title: '没有找到相关讨论',
        text: '换个关键词，或者只搜课程名试试；也可以直接去找资料。',
        actions: `<a class="btn btn-ghost btn-sm" href="${href('/resources', { q })}">在找资料中搜索</a>`
      })}</div>`;
  }

  // 没输入关键词时不把全站帖子铺出来，给几门有内容的课程作入口
  if (!q.trim() && tab === 'posts' && !attachmentsOnly) {
    const postCounts = new Map();
    (db.posts || []).forEach((post) => {
      if (post.status === 'published' && post.courseId && post.courseId !== 'c_general') {
        postCounts.set(post.courseId, (postCounts.get(post.courseId) || 0) + 1);
      }
    });
    const activeCourses = [...postCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([courseId]) => S.courseOf(db, courseId))
      .filter(Boolean);
    body = `<div class="card">
      ${activeCourses.length ? `<div class="section-title">按课程看看</div>
        <div class="chips">${activeCourses.map((item) => `<a class="chip chip-sm" href="${href(`/courses/${item.id}`)}">${esc(item.name)}</a>`).join('')}</div>` : ''}
      <p class="small secondary ${activeCourses.length ? 'mt-3' : ''}">也可以去<a class="link" href="${href('/circles', { mode: 'discover' })}">课友圈发现页</a>看最新讨论。</p>
    </div>`;
  }

  return `
  <div class="layout-1">
    <div class="card">
      <h1>搜索</h1>
      <form class="search-bar" data-form="search-page" role="search">
        <div class="input-wrap">
          ${icon('search', 'i-sm')}
          <label class="visually-hidden" for="search-q">搜索关键词</label>
          <input id="search-q" name="q" type="search" value="${esc(q)}" placeholder="搜索帖子、课程或用户">
        </div>
        <input type="hidden" name="tab" value="${esc(tab)}">
        ${attachmentsOnly ? '<input type="hidden" name="attachmentsOnly" value="1">' : ''}
        <button class="btn" type="submit">搜索</button>
      </form>
      <div class="tabs mt-3">
        ${tabs}
        <span class="grow"></span>
        <a class="chip chip-sm ${attachmentsOnly ? 'is-active' : ''}"
          href="${href('/search', { q, tab: tab === 'posts' ? '' : tab, attachments: attachmentsOnly ? '' : '1' })}">仅看含附件</a>
      </div>
      <p class="tiny muted">可搜索标题、正文、课程名、标签和昵称；暂不搜索 PDF 里的内容。</p>
    </div>
    ${body}
  </div>`;
}

/* ---------- 管理后台 ---------- */

export function admin(ctx) {
  const { db, me, route } = ctx;
  if (!me || me.role !== 'admin') {
    return `<div class="layout-1"><div class="card">
      <h1>管理后台</h1>
      ${notice('这里需要管理员权限。普通用户看不到举报处理、封禁账号/帖子与审计记录。', 'warn', 'lock')}
      ${ctx.config && ctx.config.mode === 'production'
        ? '<p class="small secondary mt-3">请使用已在服务端配置为管理员的邮箱登录。普通试用账号不一定具备管理员权限。</p>'
        : '<p class="small secondary mt-3">演示环境可以用「站点维护」账号登录后查看；真实环境由后端校验角色，隐藏按钮不等于权限。</p>'}
      <a class="btn mt-4" href="${href('/login', { next: '/admin' })}">${ctx.config && ctx.config.mode === 'production' ? '登录管理员账号' : '使用演示管理员账号登录'}</a>
    </div></div>`;
  }

  const tab = ['reports', 'circles', 'content', 'users', 'audit', 'stats'].includes(route.query.tab) ? route.query.tab : 'reports';
  const reports = (db.reports || []).slice().sort((a, b) => {
    if (a.status === 'open' && b.status !== 'open') return -1;
    if (b.status === 'open' && a.status !== 'open') return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const openCount = reports.filter((r) => r.status === 'open').length;
  const applications = (db.applications || []).slice().sort((a, b) => {
    if (a.state === 'pending' && b.state !== 'pending') return -1;
    if (b.state === 'pending' && a.state !== 'pending') return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const pendingApplications = applications.filter((app) => app.state === 'pending').length;
  const isProduction = !!(ctx.config && ctx.config.mode === 'production');
  const users = (db.users || []).slice();
  const circles = (db.circles || []).slice();
  const events = S.eventSummary(db);

  const tabsHtml = [
    { key: 'reports', label: `举报 ${openCount}` },
    { key: 'circles', label: `圈子${pendingApplications ? ` · ${pendingApplications} 个申请` : ''}` },
    { key: 'content', label: '内容' },
    { key: 'users', label: '用户' },
    { key: 'audit', label: '操作记录' },
    { key: 'stats', label: '来源统计' }
  ].map((item) => `<a class="tab" role="tab" aria-selected="${tab === item.key}"
    href="${href('/admin', { tab: item.key === 'reports' ? '' : item.key })}">${esc(item.label)}</a>`).join('');

  let body = '';
  if (tab === 'reports') {
    body = `<div class="card card-flush">
      <table class="table admin-table admin-reports">
        <thead><tr><th>对象</th><th>原因</th><th>状态</th><th>处理</th></tr></thead>
        <tbody>${reports.map((report) => `<tr>
          <td>
            <div class="small">${esc(S.reportTargetLabel(db, report))}</div>
            <div class="tiny muted">${{ post: '帖子', comment: '评论', dm: '私信' }[report.targetType] || '内容'} · ${esc((S.userOf(db, report.reporterId) || {}).nickname || '')} 举报 · ${esc(timeAgo(report.createdAt))}</div>
          </td>
          <td class="small">${esc(report.reason)}<div class="tiny muted">${esc(report.detail || '')}</div></td>
          <td>${report.status === 'open' ? '<span class="status-pill status-processing">待处理</span>'
            : `<span class="status-pill">${esc(REPORT_STATUS[report.status] || report.status)}</span>
               <div class="tiny muted">${esc(report.resolution || '')}</div>
               <div class="tiny muted">${esc((S.userOf(db, report.handledBy) || {}).nickname || '')}</div>`}</td>
          <td>${report.status === 'open'
            ? `<button class="btn btn-sm" type="button" data-action="open-report-admin" data-report="${esc(report.id)}">处理</button>`
            : '<span class="tiny muted">已归档</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="card">
      <div class="card-title">处理原则</div>
      <div class="stack small secondary">
        <p>· 临时隐藏可恢复，不触发退款；永久移除会关闭文件访问并写入退款任务</p>
        <p>· 每次处理必须记录理由，操作写入审计，普通管理员不能改写历史</p>
        <p>· 不因用户勾选确认就宣称平台已解决版权问题；学习内容允许质疑与纠错</p>
      </div>
    </div>`;
  } else if (tab === 'circles') {
    const stateLabel = { approved: '已通过', rejected: '已驳回', pending: '待处理', withdrawn: '已撤回' };
    body = `${route.query.circle ? memberAdmin(db, route.query.circle) : ''}<div class="card">
      <div class="card-title">建圈申请</div>
      ${applications.length ? `<ul class="list-plain admin-applications">${applications.map((app) => {
        const name = app.courseName || (S.courseOf(db, app.courseId) || {}).name || '';
        return `<li class="row wrap">
          <div class="grow">
            <div class="small"><b>${esc(name)}</b>${app.courseId ? '' : ' <span class="status-pill">目录外课程</span>'}</div>
            <div class="tiny muted">${esc((S.userOf(db, app.applicantId) || {}).nickname || '')} · ${esc(timeAgo(app.createdAt))}${app.reason ? ` · ${esc(app.reason)}` : ''}${app.resolution ? ` · 理由：${esc(app.resolution)}` : ''}</div>
          </div>
          ${app.state === 'pending'
            ? `<div class="row">
                <button class="btn btn-sm" type="button" data-action="admin-approve-application" data-application="${esc(app.id)}">通过并开圈</button>
                <button class="btn btn-ghost btn-sm" type="button" data-action="admin-reject-application" data-application="${esc(app.id)}">驳回</button>
              </div>`
            : `<span class="status-pill ${app.state === 'approved' ? 'status-ready' : ''}">${esc(stateLabel[app.state] || app.state)}</span>`}
        </li>`;
      }).join('')}</ul>` : '<p class="small secondary">暂无申请。</p>'}
    </div>
    <div class="card">
      <div class="card-title">新建课友圈</div>
      <p class="small secondary">管理员可为还没有圈的课程直接开一个圈，一门课只有一个圈。</p>
      <form class="stack mt-3" data-form="admin-circle">
        <div class="field">
          <label for="admin-course">课程</label>
          <select class="select" id="admin-course" name="courseId" required>
            ${(db.courses || []).map((course) => `<option value="${esc(course.id)}">${esc(course.name)}${course.code ? ` · ${esc(course.code)}` : ''}</option>`).join('')}
          </select>
          <p class="field-help">已有圈的课程会在提交时被拒绝，直接去圈里即可。</p>
        </div>
        <div class="row wrap">
          <span class="tiny muted grow">创建后立即可发帖与邀请；圈子不会自动添加成员。</span>
          <button class="btn" type="submit">${icon('plus', 'i-sm')}创建课友圈</button>
        </div>
      </form>
    </div>
    <div class="card card-flush">
      <table class="table admin-table">
        <thead><tr><th>课友圈</th><th class="col-secondary">课程</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${circles.slice(0, 80).map((circle) => `<tr>
          <td class="small">${esc(S.circleLabel(db, circle))}<div class="tiny muted">${S.countMembers(db, circle.id)} 位成员</div></td>
          <td class="small col-secondary">${esc((S.courseOf(db, circle.courseId) || {}).name || '')}</td>
          <td>${circle.status === 'active' ? '<span class="status-pill status-ready">进行中</span>' : '<span class="status-pill">已归档</span>'}</td>
          <td><div class="row wrap">
            <a class="btn btn-ghost btn-sm" href="${href('/admin', { tab: 'circles', circle: circle.id })}">成员</a>
            ${circle.status === 'active'
              ? `<button class="btn btn-ghost btn-sm" type="button" data-action="admin-archive-circle" data-circle="${esc(circle.id)}">归档为只读</button>`
              : '<a class="tiny link" href="' + href(`/circles/${circle.id}`) + '">查看</a>'}
          </div></td>
        </tr>`).join('')}</tbody>
      </table>
      ${circles.length > 80 ? `<p class="tiny muted" style="padding:10px 14px">共 ${circles.length} 个圈，这里只显示最近创建的 80 个；用找课页按课程名筛选。</p>` : ''}
    </div>
`;
  } else if (tab === 'content') {
    const allPosts = (db.posts || []).slice().sort((a, b) =>
      new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0));
    const bannedCount = allPosts.filter((post) => post.status === 'banned').length;
    body = `<div class="card card-flush">
      <table class="table admin-table">
        <thead><tr><th>帖子</th><th>作者</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${allPosts.slice(0, 40).map((post) => {
          const author = S.userOf(db, post.authorId) || {};
          const circle = post.circleId ? S.circleOf(db, post.circleId) : null;
          return `<tr>
            <td class="small">
              <div>${esc(post.title || truncate(stripMarkdown(post.body), 36))}</div>
              <div class="tiny muted">${esc(circle ? S.circleLabel(db, circle) : '不挂圈')} · ${esc(timeAgo(post.publishedAt || post.createdAt))}</div>
            </td>
            <td class="small">${esc(author.nickname || '')}</td>
            <td>${post.status === 'banned'
              ? `<span class="status-pill status-removed">已封禁</span>${post.moderateReason ? `<div class="tiny muted">${esc(post.moderateReason)}</div>` : ''}`
              : '<span class="status-pill status-ready">公开</span>'}</td>
            <td>${post.status === 'banned'
              ? `<button class="btn btn-ghost btn-sm" type="button" data-action="admin-unban-post" data-post="${esc(post.id)}">解封</button>`
              : `<button class="btn btn-danger btn-sm" type="button" data-action="admin-ban-post" data-post="${esc(post.id)}">封禁</button>`}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
    <p class="tiny muted mt-3">当前共 ${allPosts.length} 条帖子，其中 ${bannedCount} 条已封禁。封禁后列表、搜索、详情与关联资料同时下架；解封即恢复。</p>`;
  } else if (tab === 'users') {
    body = `<div class="card card-flush">
      <table class="table admin-table">
        <thead><tr><th>昵称</th><th>邮箱</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${users.map((user) => `<tr>
          <td class="small"><a class="link" href="${href(`/u/${user.id}`)}">${esc(user.nickname)}</a>
            <div class="tiny muted">${user.role === 'admin' ? '管理员' : '普通用户'} · 成长值 ${S.xpOf(db, user.id)}</div></td>
          <td class="small">${esc(maskEmail(user.email))}</td>
          <td>${user.status === 'active' ? '<span class="status-pill status-ready">正常</span>' : '<span class="status-pill status-removed">已封禁</span>'}</td>
          <td>${user.role === 'admin'
            ? '<span class="tiny muted">受保护</span>'
            : user.status === 'active'
              ? `<button class="btn btn-danger btn-sm" type="button" data-action="admin-suspend-user" data-user="${esc(user.id)}" data-value="1">封禁</button>`
              : `<button class="btn btn-ghost btn-sm" type="button" data-action="admin-suspend-user" data-user="${esc(user.id)}" data-value="0">解封</button>`}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <p class="tiny muted mt-3">列表只显示脱敏邮箱；公共 API 不返回邮箱、风控标记与存储对象键。</p>`;
  } else if (tab === 'audit') {
    const audit = (db.audit || []).slice().reverse();
    body = `<div class="card card-flush">
      <table class="table admin-table">
        <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>理由</th></tr></thead>
        <tbody>${audit.map((row) => `<tr>
          <td class="small">${esc(formatDateTime(row.at))}</td>
          <td class="small">${esc((S.userOf(db, row.actorId) || {}).nickname || row.actorId)}</td>
          <td class="small">${esc(row.action)}<div class="tiny muted">${esc(row.target)}</div></td>
          <td class="small">${esc(row.reason)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <p class="tiny muted mt-3">审计记录只能追加，普通管理员不能改写；页面不提供静默改余额的入口。</p>`;
  } else {
    body = `<div class="card">
      <div class="card-title">资料来源事件${isProduction ? '' : '（本地演示，不上报）'}</div>
      ${statRow([
        { value: events.landing, label: '资料落地页浏览' },
        { value: events.search, label: '搜索' },
        { value: events.preview, label: '预览查看' },
        { value: events.downloadAuthorized, label: '下载授权' },
        { value: events.downloadCompleted, label: '传输完成' },
        { value: events.toCircle, label: '资料后查看圈' }
      ])}
      <p class="tiny muted mt-3">下载授权与实际传输完成分开计数：事件只证明传输成功，不代表用户已阅读。真实环境由服务端事件表统计，不采集搜索正文到公共面板。</p>
    </div>
    <div class="card">
      <div class="card-title">应分别观察的两端指标</div>
      <div class="stack small secondary">
        <p><b>资料引流</b>：分享链接独立落地、搜索有结果率、搜索到预览／下载转化。不能用户页面曝光、假下载替代。</p>
        <p><b>双核心连接</b>：使用资料后主动查看圈、确认入圈、首次圈内互动的比例。不用“被自动加入的成员数”替代。</p>
        <p><b>圈子留存</b>：入圈 cohort 的 D1／D7 回访、他人回复率、贡献者次周回访。不用每日领签率替代。</p>
      </div>
    </div>`;
  }

  return `
  <div class="layout-2">
    <main>
      <nav class="crumbs" aria-label="面包屑"><a href="${href(`/u/${me.id}`)}">我的主页</a><span>/</span><span>管理后台</span></nav>
      <div class="page-head"><h1>内容与账号管理</h1><p>管理员视角 · 每次处理都会写入审计记录</p></div>
      <div class="tabs" role="tablist">${tabsHtml}</div>
      ${body}
    </main>
    <aside class="rail">
      <section class="card">
        <div class="card-title">平台概况</div>
        <div class="stack small">
          <p>用户：${users.length} · 待处理举报：${openCount}</p>
          <p>公开帖子：${(db.posts || []).filter((p) => p.status === 'published').length}</p>
          <p>收录资料：${(db.resources || []).filter((r) => S.resourceEligibility(db, r).ok).length}</p>
          <p>课友圈：${circles.filter((c) => c.status === 'active').length} 个进行中</p>
          <p>病毒扫描：${isProduction
            ? (db.system && db.system.scan ? `已开启 · ${esc(db.system.scan)}` : '<b class="danger-text">未开启</b>（见 PILOT.md）')
            : '演示版不扫描'}</p>
        </div>
      </section>
      <section class="card">
        <div class="card-title">${ctx.config && ctx.config.mode === 'production' ? '内测说明' : '演示提醒'}</div>
        <p class="small secondary">${ctx.config && ctx.config.mode === 'production'
          ? '这是内部试用版：举报处理、封禁、归档会写入服务端并记入审计；已发布内容任何访问者都可浏览，数据可能清空。'
          : '这是静态演示版：所有处理只改本机浏览器数据，没有真实退款、扫描或存储。生产实现必须由服务端事务与后台任务完成。'}</p>
        ${isProduction ? '' : '<button class="btn btn-danger btn-sm mt-3" type="button" data-action="reset-demo">重置演示数据</button>'}
      </section>
    </aside>
  </div>`;
}

const REPORT_STATUS = { dismissed: '不处理', hidden: '已隐藏', removed: '已移除' };

/** 单个圈的成员管理：禁言（可设天数）、解除、移出、允许重新加入 */
function memberAdmin(db, circleId) {
  const circle = S.circleOf(db, circleId);
  if (!circle) return '';
  const course = S.courseOf(db, circle.courseId) || {};
  const rows = (db.memberships || [])
    .filter((row) => row.circleId === circle.id && row.userId && (row.status === 'active' || row.status === 'removed'))
    .map((row) => ({ row, user: S.userOf(db, row.userId) }))
    .filter(({ user }) => user && user.status !== 'deleted');
  const statusOf = (row) => {
    if (row.status === 'removed') return '<span class="status-pill status-removed">已移出</span>';
    if (S.isWriteRestricted(row)) {
      return `<span class="status-pill status-processing">${row.restrictedUntil ? `禁言至 ${esc(String(row.restrictedUntil).slice(0, 10))}` : '长期禁言'}</span>`;
    }
    return '<span class="status-pill status-ready">正常</span>';
  };
  const button = (act, label, quick = false, danger = false) => `<button class="btn ${danger ? 'btn-danger' : 'btn-ghost'} btn-sm" type="button"
    data-action="${quick ? 'admin-member-quick' : 'admin-member'}" data-act="${act}" data-circle="${esc(circle.id)}" data-user="{uid}">${label}</button>`;
  return `<div class="card" id="member-admin">
    <div class="row">
      <div class="card-title grow">成员管理 · ${esc(course.name || '')}</div>
      <a class="tiny link" href="${href('/admin', { tab: 'circles' })}">收起</a>
    </div>
    ${rows.length ? `<ul class="list-plain admin-members">${rows.map(({ row, user }) => {
      const actions = user.role === 'admin'
        ? '<span class="tiny muted">管理员</span>'
        : row.status === 'removed'
          ? button('restore', '允许重新加入', true)
          : `${S.isWriteRestricted(row) ? button('unmute', '解除禁言', true) : button('mute', '禁言')}${button('remove', '移出', false, true)}`;
      return `<li class="row wrap">
        <div class="grow"><a class="small" href="${href(`/u/${user.id}`)}">${esc(user.nickname)}</a> ${statusOf(row)}</div>
        <div class="row">${actions.replace(/\{uid\}/g, esc(user.id))}</div>
      </li>`;
    }).join('')}</ul>` : '<p class="small secondary">这个圈还没有成员。</p>'}
  </div>`;
}

function maskEmail(email) {
  const value = String(email || '');
  const [name, domain] = value.split('@');
  if (!domain) return value;
  const head = name.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}

/* ---------- 404 ---------- */

export function notFound(ctx) {
  return `<div class="layout-1">${emptyState({
    img: 'empty-search.svg',
    title: '这个页面不存在',
    text: '链接可能有误，或内容已被移动。共页的两个入口始终可用：找资料与课友圈。',
    actions: `<a class="btn btn-sm" href="${href('/')}">去找资料</a>
      <a class="btn btn-ghost btn-sm" href="${href('/circles')}">去课友圈</a>`
  })}</div>`;
}

export function about(ctx) {
  const production = ctx.config && ctx.config.mode === 'production';
  const contact = String((ctx.config && ctx.config.supportEmail) || '');
  const contactReady = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(contact);
  return `<div class="layout-1">
    <section class="card"><h1>共页 · 社区规则与隐私说明</h1>
      <p class="small secondary mt-3">面向浙大全校课程的学生学习互助社区。共页不是浙江大学官方教学或考试平台，邮箱验证仅确认邮箱所有权，不证明当前修课、学生身份或学校背书。</p>
      <p class="small secondary mt-2">${production ? '当前为服务端共享版本；邮件、文件扫描和存储是否就绪以实际配置为准，未配置时不会伪装发送邮件或放行文件。' : '当前为独立静态演示，账号、资料和数字为示例，请勿输入真实隐私信息。'}</p>
      <div class="row mt-4 wrap"><a class="btn btn-sm" href="${href('/resources')}">找资料</a><a class="btn btn-ghost btn-sm" href="${href('/find-circles')}">查找全校课程圈</a></div>
    </section>
    <section class="card"><h2>如何贡献与使用资料</h2><div class="stack small secondary mt-3">
      <p>一门课一个圈，跨学期积累。标明学期、章节、教材、适用范围与未覆盖内容；不同教师和学期的考核要求可能不同。资料仅供参考，欢迎在原帖提出具体纠错。</p>
      <p>仅上传原创、得到授权或按公开许可可再分享的材料，并注明作者、来源及许可依据。勾选确认不代表平台已核实版权；公开可见不等于允许复制传播。</p>
      <p>禁止上传未经允许的教材扫描件、教师课件、个人信息、未公开试卷、进行中考试答案及代写代考内容。不得将社区用于作弊；对历史试题也须确认分享权利及学校规定。</p>
      <p>附件通过技术检查后才可发布。扫描不保证绝对安全或内容准确；请勿在不可信文档中输入账号密码。前两页预览可公开浏览，完整下载须验证邮箱；公开帖子可能被搜索引擎收录。</p>
    </div></section>
    <section class="card"><h2>隐私与账号</h2><div class="stack small secondary mt-3">
      <p>为登录保存邮箱、验证状态与会话；资料、帖子、评论、昵称和简介按公开内容处理。邮箱及个人入圈、收藏、关注清单不向其他普通用户公开；管理员因审核和运维可访问必要数据。</p>
      <p>验证码通过配置的邮件服务发送，会涉及邮件服务商处理；短期保存限流所需的邮箱和网络标识。会话以 HttpOnly Cookie 保存。请勿在公开内容中填写学号、完整课表、手机号或他人隐私。</p>
      <p>可退出/静音课程圈、取消资料索引或删除自己的帖子。取消索引不会撤回已公开原帖或他人已下载的副本；删除和下架会立即关闭本站附件入口，备份可能在运维保留周期内存在。</p>
      <p>邮箱更改、数据副本、账号注销或隐私投诉请联系维护者核实处理；当前不提供自动注销，也不承诺能够撤回外部转载。</p>
    </div></section>
    <section class="card"><h2>举报、版权投诉与申诉</h2><div class="stack small secondary mt-3">
      <p>登录后可通过帖子/评论上的举报入口提交位置、问题及证据。权利人请提供原作品、权属或授权证据、涉事链接与可回复方式，维护者核实后可隐藏、永久移除或恢复，并记录处理理由。</p>
      <p>${contactReady ? `无需登录的投诉、申诉与隐私联系：<a class="link" href="mailto:${esc(contact)}">${esc(contact)}</a>。` : '运营方尚未配置无需登录的投诉邮箱。正式公开前必须补齐可用联系方式；现阶段可通过部署方已有渠道反馈。'}</p>
      <p>课程目录缺失或名称错误也可向维护者反馈。课程圈申请不会赋予申请者管理权，学生之间可平等贡献和纠错。</p>
    </div></section>
  </div>`;
}






