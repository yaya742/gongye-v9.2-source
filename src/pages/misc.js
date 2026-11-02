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
  const recentPosts = (db.posts || [])
    .filter((p) => p.courseId === course.id && p.status === 'published')
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 4);

  const circleCard = (circle, showStatus) => {
    const joined = me && S.isActiveMember(db, me.id, circle.id);
    return `<div class="row-top mb-3" style="gap:12px">
      <div class="identity-mark" style="width:36px;height:36px;border-radius:8px"><img src="assets/art/logo-mono.svg" alt="" width="20" height="20"></div>
      <div class="grow">
        <a class="small" href="${href(`/circles/${circle.id}`)}">课程圈 · 全课程共用</a>
        <div class="tiny muted">${S.countMembers(db, circle.id)} 位成员
          ${showStatus === 'archived' ? ' · 已归档只读' : ''}</div>
      </div>
      ${showStatus === 'archived'
        ? '<span class="status-pill">只读</span>'
        : joined
          ? '<span class="status-pill status-ready">已加入</span>'
          : `<button class="chip chip-sm" type="button" data-action="join-circle" data-circle="${esc(circle.id)}">加入</button>`}
    </div>`;
  };

  return `
  <div class="layout-2">
    <main>
      <nav class="crumbs" aria-label="面包屑"><a href="${href('/resources')}">找资料</a><span>/</span><span>课程</span></nav>
      <section class="card mt-4">
        <div class="identity">
          <div class="identity-mark"><img src="assets/art/logo-mono.svg" alt=""></div>
          <div class="grow">
            <h1>${esc(course.name)}</h1>
            <div class="identity-meta">
              <span>${esc(course.school)}</span>
              ${course.code ? `<span class="dot-sep">·</span><span>${esc(course.code)}</span>` : ''}
              <span class="dot-sep">·</span><span>${esc(course.category || '课程')}</span>
            </div>
            <p class="tiny muted mt-2">课程是跨学期的稳定实体；9.2 起一门课只有一个课程圈，学期写在帖子和资料里。</p>
          </div>
        </div>
        <div class="row wrap mt-4">
          ${me ? `<button class="btn btn-ghost btn-sm" type="button" data-action="follow-course" data-course="${esc(course.id)}">
            ${following ? '已关注课程' : '关注课程'}</button>` : ''}
          <a class="btn btn-ghost btn-sm" href="${href('/resources', { courseId: course.id })}">查看本课程资料 ${resources.length}</a>
          <a class="btn btn-ghost btn-sm" href="${href('/find-circles', { courseId: course.id })}">找课程圈</a>
          <a class="btn btn-sm" href="${href('/publish/resource', { course: course.id })}">分享本课程资料</a>
        </div>
      </section>

      <section class="card">
        <div class="card-title">这个课程的课友圈</div>
        <p class="tiny muted mb-2">9.2 起一门课只有一个共用圈，不再区分教学班与教师。</p>
        ${active.length ? active.map((c) => circleCard(c, 'active')).join('')
          : '<p class="small secondary">这门课还没有课友圈。可以提交建圈申请。</p>'}
        <p class="tiny muted mt-2">加入后就能和同课程的同学一起讨论；学期写在帖子和资料里。</p>
      </section>

      <section class="card">
        <div class="card-title">作者收录的精选内容</div>
        ${collected.length
          ? collected.map(({ post, collection }) => `<div class="mb-3">
              <a class="small" href="${href(`/posts/${post.id}`)}">${esc(post.title || strip(post.body))}</a>
              <div class="tiny muted">由作者确认收录 · ${esc(timeAgo(collection.createdAt))} · 复用原帖，不复制附件</div>
            </div>`).join('')
          : '<p class="small secondary">还没有作者确认收录的内容。普通历史检索不等于精选收录。</p>'}
      </section>

      <div class="mb-4">
        <h2 class="mb-3" style="font-size:16px">本课程资料</h2>
        ${resources.length ? resources.slice(0, 3).map((item) => resourceCard(ctx, item)).join('')
          : `<div class="card">${emptyState({ img: 'empty-search.svg', title: '暂无公开收录的资料', text: '同课程的资料在作者确认公开索引后会出现在这里。' })}</div>`}
        ${resources.length > 3 ? `<a class="link small" href="${href('/resources', { courseId: course.id })}">查看全部 ${resources.length} 份 →</a>` : ''}
      </div>

      <section class="card">
        <div class="card-title">最近讨论</div>
        ${recentPosts.length ? recentPosts.map((post) => `<div class="mb-3">
          <a class="small" href="${href(`/posts/${post.id}`)}">${esc(post.title || strip(post.body))}</a>
          <div class="tiny muted">${esc(timeAgo(post.publishedAt))} · ${S.commentCount(db, post.id)} 条讨论</div>
        </div>`).join('') : '<p class="small secondary">还没有讨论。</p>'}
      </section>
    </main>

    <aside class="rail">
      <section class="card">
        <div class="card-title">历史学期</div>
        ${archived.length
          ? archived.map((c) => circleCard(c, 'archived')).join('')
          : '<p class="small muted">暂无归档的圈。</p>'}
        <p class="tiny muted">归档只读，不删除内容、不回收成长、不退款。</p>
      </section>
      <section class="card">
        <div class="card-title">课程数据</div>
        ${statRow([
          { value: active.length, label: '当期圈' },
          { value: resources.length, label: '公开资料' },
          { value: recentPosts.length, label: '近期讨论' }
        ])}
      </section>
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
        <select class="select" name="tab" style="max-width:120px">
          <option value="posts" ${tab === 'posts' ? 'selected' : ''}>帖子</option>
          <option value="courses" ${tab === 'courses' ? 'selected' : ''}>课程</option>
          <option value="users" ${tab === 'users' ? 'selected' : ''}>用户</option>
        </select>
        <button class="btn" type="submit">搜索</button>
      </form>
      <div class="tabs mt-3">
        ${tabs}
        <span class="grow"></span>
        <a class="chip chip-sm ${attachmentsOnly ? 'is-active' : ''}"
          href="${href('/search', { q, tab: tab === 'posts' ? '' : tab, attachments: attachmentsOnly ? '' : '1' })}">仅看含附件</a>
      </div>
      <p class="tiny muted">搜索标题、正文纯文本、课程名、标签、昵称与圈子信息；不搜索 PDF 内文，界面也不暗示已搜索文件正文。</p>
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
  const users = (db.users || []).slice();
  const circles = (db.circles || []).slice();
  const events = S.eventSummary(db);

  const tabsHtml = [
    { key: 'reports', label: `举报 ${openCount}` },
    { key: 'circles', label: '圈子' },
    { key: 'content', label: '内容' },
    { key: 'users', label: '用户' },
    { key: 'audit', label: '操作记录' },
    { key: 'stats', label: '来源统计' }
  ].map((item) => `<a class="tab" role="tab" aria-selected="${tab === item.key}"
    href="${href('/admin', { tab: item.key === 'reports' ? '' : item.key })}">${esc(item.label)}</a>`).join('');

  let body = '';
  if (tab === 'reports') {
    body = `<div class="card card-flush">
      <table class="table admin-table">
        <thead><tr><th>对象</th><th>原因</th><th>状态</th><th>处理</th></tr></thead>
        <tbody>${reports.map((report) => `<tr>
          <td>
            <div class="small">${esc(S.reportTargetLabel(db, report))}</div>
            <div class="tiny muted">${report.targetType === 'post' ? '帖子' : '评论'} · ${esc((S.userOf(db, report.reporterId) || {}).nickname || '')} 举报 · ${esc(timeAgo(report.createdAt))}</div>
          </td>
          <td class="small">${esc(report.reason)}<div class="tiny muted">${esc(report.detail || '')}</div></td>
          <td>${report.status === 'open' ? '<span class="status-pill status-processing">待处理</span>'
            : `<span class="status-pill">${esc(report.status)}</span>
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
    body = `<div class="card">
      <div class="card-title">新建课友圈</div>
      <p class="small secondary">管理员可为还没有圈的课程开一个圈。9.2 起一门课只有一个圈，不再分教学班、教师或学期。</p>
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
        <thead><tr><th>课友圈</th><th>课程</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${circles.slice(0, 80).map((circle) => `<tr>
          <td class="small">${esc(S.circleLabel(db, circle))}<div class="tiny muted">${S.countMembers(db, circle.id)} 位成员</div></td>
          <td class="small">${esc((S.courseOf(db, circle.courseId) || {}).name || '')}</td>
          <td>${circle.status === 'active' ? '<span class="status-pill status-ready">进行中</span>' : '<span class="status-pill">已归档</span>'}</td>
          <td>${circle.status === 'active'
            ? `<button class="btn btn-ghost btn-sm" type="button" data-action="admin-archive-circle" data-circle="${esc(circle.id)}">归档为只读</button>`
            : '<a class="tiny link" href="' + href(`/circles/${circle.id}`) + '">查看</a>'}</td>
        </tr>`).join('')}</tbody>
      </table>
      ${circles.length > 80 ? `<p class="tiny muted" style="padding:10px 14px">共 ${circles.length} 个圈，这里只显示最近创建的 80 个；用找课页按课程名筛选。</p>` : ''}
    </div>
    <div class="card">
      <div class="card-title">建圈申请</div>
      ${(db.applications || []).length
        ? `<ul class="list-plain">${db.applications.map((app) => `<li>
            <div class="small">${esc((S.courseOf(db, app.courseId) || {}).name || '')}${app.reason ? ` · ${esc(app.reason)}` : ''}</div>
            <div class="tiny muted">申请人 ${esc((S.userOf(db, app.applicantId) || {}).nickname || '')} · 状态 ${esc(app.state)}</div>
          </li>`).join('')}</ul>`
        : '<p class="small secondary">暂无申请。创建者默认没有内容管理权；审核通过只生成一个圈。</p>'}
    </div>`;
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
      <div class="card-title">资料来源事件（本地演示，不上报）</div>
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
        </div>
      </section>
      <section class="card">
        <div class="card-title">${ctx.config && ctx.config.mode === 'production' ? '内测说明' : '演示提醒'}</div>
        <p class="small secondary">${ctx.config && ctx.config.mode === 'production'
          ? '这是内部试用版：举报处理、封禁、归档会写入服务端并记入审计；已发布内容任何访问者都可浏览，数据可能清空。'
          : '这是静态演示版：所有处理只改本机浏览器数据，没有真实退款、扫描或存储。生产实现必须由服务端事务与后台任务完成。'}</p>
        <button class="btn btn-danger btn-sm mt-3" type="button" data-action="reset-demo">重置演示数据</button>
      </section>
    </aside>
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
  return `<div class="layout-1"><div class="card">
    <h1>关于共页</h1>
    <p class="small secondary mt-3">共页是面向大学生的学习社区：找资料负责引流，课友圈负责留存，两者并列，共享课程、作者、帖子与附件。</p>
    <p class="small secondary mt-2">${ctx.config && ctx.config.mode === 'production'
      ? '当前是内部试用版：账号和数据保存在试用服务端；已发布帖子、资料及圈内公开内容任何访问者都可浏览，登录资格不提供内容保密。附件仍是示例 PDF，尚未接入真实上传与扫描。'
      : '当前是静态演示版：没有真实账号、服务端或文件上传与扫描。所有内容与数字均为示例；操作只保存在当前浏览器，不会同步给其他访问者。样例中的公开内容仍可被任何访客浏览。'}</p>
    <div class="row mt-4 wrap">
      <a class="btn btn-sm" href="${href('/')}">找资料</a>
      <a class="btn btn-ghost btn-sm" href="${href('/circles')}">课友圈</a>
    </div>
  </div></div>`;
}






