/* 课友圈：我的圈聚合流、找课加入、圈页、邀请落地 */

import { href } from '../router.js';
import * as S from '../state/selectors.js';
import {
  postCard, resourceCard, emptyState, notice, signCard, weekIndexCard,
  pendingQuestionsCard, icon, avatar, authorLine
} from '../components/ui.js';
import { esc, timeAgo, BOARDS, TERMS } from '../lib/format.js';

function circleHref(path, query) {
  return href(path, query);
}

function latestPostAt(db, circleId) {
  return (db.posts || [])
    .filter((p) => p.circleId === circleId && p.status === 'published')
    .reduce((max, p) => Math.max(max, new Date(p.publishedAt).getTime()), 0);
}

function newActivity(db, membership, circleId) {
  const last = membership.lastSeenAt ? new Date(membership.lastSeenAt).getTime() : 0;
  return latestPostAt(db, circleId) > last;
}

/* ---------- 我的课友圈 ---------- */

export function circles(ctx) {
  const { db, me, route } = ctx;
  const mode = ['my', 'following', 'discover'].includes(route.query.mode) ? route.query.mode : 'my';
  const board = route.query.board || '';
  const sort = route.query.sort === 'hot' ? 'hot' : 'latest';
  const offset = Math.max(0, Number(route.query.offset || 0));
  const feed = S.feedPosts(db, {
    meId: me ? me.id : null, mode, board: board || null, sort, offset, limit: 10
  });

  const mine = me ? S.myCircles(db, me.id) : [];
  const activeMine = mine.filter(({ circle }) => circle.status === 'active');
  const visible = feed.items.filter((post) => post.status === 'published');

  const modeTabs = [
    { key: 'my', label: '我的课友圈' },
    { key: 'following', label: '关注' },
    { key: 'discover', label: '发现' }
  ];

  const boardChips = [{ key: '', label: '全部板块' }, ...BOARDS.map((b) => ({ key: b.key, label: b.label }))]
    .map((item) => `<a class="chip chip-sm ${board === item.key ? 'is-active' : ''}"
      href="${circleHref('/circles', { ...route.query, board: item.key, offset: '' })}">${esc(item.label)}</a>`).join('');

  let body = '';
  if (!visible.length) {
    if (mode === 'my' && !activeMine.length) {
      body = `<div class="card">${emptyState({
        img: 'empty-feed.svg',
        title: me ? '还没有加入课友圈' : '登录后查看你的课友圈',
        text: '先找到你正在上的课：按学校与课程查找，确认后加入。这一步不影响你随时回到找资料。',
        actions: `<a class="btn" href="${href('/find-circles')}">去找课程圈</a>
          <a class="btn btn-ghost" href="${href('/circles', { mode: 'discover' })}">先浏览公开讨论</a>`
      })}</div>`;
    } else if (mode === 'following') {
      body = `<div class="card">${emptyState({
        img: 'empty-feed.svg',
        title: '关注流暂时是空的',
        text: '你可以关注同学或课程，关注后的新帖会出现在这里。',
        actions: `<a class="btn btn-ghost" href="${href('/circles', { mode: 'discover' })}">去发现看看</a>`
      })}</div>`;
    } else {
      body = `<div class="card">${emptyState({
        img: 'empty-feed.svg',
        title: board ? '这个板块暂时没有内容' : '这里还没有帖子',
        text: board ? '换个板块，或者自己去发第一帖。' : '把你的问题或整理放上来，开始这门课的讨论。',
        actions: `<a class="btn" href="${href('/publish')}">发布第一帖</a>
          <a class="btn btn-ghost" href="${href('/circles')}">清除筛选</a>`
      })}</div>`;
    }
  } else {
    body = visible.map((post) => postCard(ctx, post)).join('');
  }

  const loadMore = feed.hasMore
    ? `<div class="card center"><a class="link" href="${circleHref('/circles', { ...route.query, offset: offset + 10 })}">加载更多</a></div>`
    : '';

  const myCircleList = mine.length
    ? mine.map(({ membership, circle }) => `
      <a class="circle-mini" href="${href(`/circles/${circle.id}`)}">
        <span class="grow">
          <b>${esc(S.circleShort(db, circle))}</b>
          <small>课程圈${circle.status === 'archived' ? ' · 已归档' : membership.shelved ? ' · 往期' : ''}</small>
        </span>
        ${newActivity(db, membership, circle.id) && !membership.muted ? '<span class="new-dot" title="有新动态"></span>' : ''}
      </a>`).join('')
    : '<p class="tiny muted" style="padding:0 10px">还没有加入任何圈。</p>';

  return `
  <div class="container">
    <div class="layout-3">
      <aside class="rail rail-sticky" aria-label="课友圈导航">
        <div class="rail-group">
          <div class="rail-title">我的课友圈</div>
          ${myCircleList}
          <a class="rail-link" href="${href('/find-circles')}">${icon('plus')}找课 / 加入圈子</a>
        </div>
        <div class="rail-sep"></div>
        <a class="rail-link" href="${circleHref('/circles', { mode: 'my' })}" ${mode === 'my' ? 'aria-current="page"' : ''}>${icon('home')}我的课友圈</a>
        <a class="rail-link" href="${circleHref('/circles', { mode: 'following' })}" ${mode === 'following' ? 'aria-current="page"' : ''}>${icon('user')}关注</a>
        <a class="rail-link" href="${circleHref('/circles', { mode: 'discover' })}" ${mode === 'discover' ? 'aria-current="page"' : ''}>${icon('search')}发现</a>
        <a class="rail-link" href="${href('/me/saved')}">${icon('star')}我的收藏</a>
        <a class="rail-link" href="${href('/me/messages')}">${icon('bell')}消息</a>
        <div class="rail-sep"></div>
        <div class="rail-title">学习分类</div>
        ${BOARDS.map((b) => `<a class="rail-link" href="${circleHref('/circles', { board: b.key })}">
          <img src="assets/art/${b.file}.svg" width="20" height="20" alt="">${esc(b.label)}</a>`).join('')}
      </aside>

      <main>
        ${me ? `<div class="card card-tight row" style="gap:12px">
          ${avatar(me, 'avatar')}
          <a class="grow secondary small" href="${href('/publish')}">发到我的课友圈：今天有什么想一起讨论？</a>
          <a class="icon-btn" href="${href('/publish')}" aria-label="发布">${icon('plus')}</a>
        </div>` : `<div class="card card-tight">
          <div class="notice">${icon('lock', 'i-sm')}<span>游客现在可以浏览公开讨论。登录并验证邮箱后可以发帖、评论和收藏。</span></div>
          <div class="row mt-3"><a class="btn btn-sm" href="${href('/login', { next: '/circles' })}">登录 / 注册</a></div>
        </div>`}

        <p class="gy-brand-line">世界很大，我们共读一页。</p>
        <div class="tabs" role="tablist">
          ${modeTabs.map((tab) => `<a class="tab" role="tab" aria-selected="${mode === tab.key}"
            href="${circleHref('/circles', { mode: tab.key })}">${esc(tab.label)}</a>`).join('')}
          ${mode === 'discover' ? `<span class="grow"></span>
            <a class="chip chip-sm ${sort === 'hot' ? 'is-active' : ''}" href="${circleHref('/circles', { mode, sort: sort === 'hot' ? '' : 'hot' })}">热门</a>` : ''}
        </div>

        <div class="chips mb-3">${boardChips}</div>

        ${mode === 'my' && activeMine.length ? `<div class="chips mb-3">
          ${activeMine.map(({ circle }) => `<a class="chip chip-sm" href="${href(`/circles/${circle.id}`)}">${esc(S.circleShort(db, circle))}</a>`).join('')}
        </div>` : ''}

        ${body}
        ${loadMore}
      </main>

      <aside class="rail rail-sticky">
        ${weekIndexCard(ctx)}
        ${signCard(ctx)}
        ${pendingQuestionsCard(ctx)}
        <section class="card">
          <div class="card-title">共页小约定</div>
          <p class="small secondary">分享时写清范围，讨论时说出理由。发现错误，欢迎一起修正；不组织代写、答案交易和作弊。</p>
        </section>
      </aside>
    </div>
  </div>`;
}

/* ---------- 找课 ---------- */

export function findCircles(ctx) {
  const { db, me, route } = ctx;
  const q = route.query;
  const school = q.school || '';
  const courseId = q.courseId || '';
  const qText = String(q.q || '').trim();
  const pageSize = 20;
  const page = Math.max(1, Number(q.page) || 1);

  const courses = (db.courses || []).filter((c) => c.id !== 'c_general');
  // 课程有几千门，下拉只给当前筛选或前 60 个；完整检索走上面的「课程名」
  const optionCourses = courseId
    ? courses.filter((c) => c.id === courseId)
    : qText
      ? courses.filter((c) => c.name.toLowerCase().includes(qText.toLowerCase())).slice(0, 60)
      : courses.slice(0, 60);
  let list = (db.circles || []).slice();
  if (courseId) list = list.filter((c) => c.courseId === courseId);
  if (qText) {
    const needle = qText.toLowerCase();
    list = list.filter((c) => {
      const course = S.courseOf(db, c.courseId);
      return course && String(course.name).toLowerCase().includes(needle);
    });
  }
  if (school) {
    list = list.filter((c) => (S.courseOf(db, c.courseId) || {}).school === school);
  }
  // 全校目录可查；无搜索时优先有真实资料/讨论的课程，不以空圈数量制造活跃。
  const activity = new Map();
  (db.posts || []).filter((p) => p.status === 'published').forEach((post) => {
    if (post.circleId) activity.set(post.circleId, (activity.get(post.circleId) || 0) + 1);
  });
  const courseResources = new Map();
  (db.resources || []).filter((r) => S.resourceEligibility(db, r).ok).forEach((resource) => {
    courseResources.set(resource.courseId, (courseResources.get(resource.courseId) || 0) + 1);
  });
  list.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    const aScore = (activity.get(a.id) || 0) + 2 * (courseResources.get(a.courseId) || 0);
    const bScore = (activity.get(b.id) || 0) + 2 * (courseResources.get(b.courseId) || 0);
    return bScore - aScore || S.circleShort(db, a).localeCompare(S.circleShort(db, b), 'zh');
  });

  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const visible = list.slice((current - 1) * pageSize, current * pageSize);

  const cards = visible.map((circle) => {
    const course = S.courseOf(db, circle.courseId);
    const members = S.countMembers(db, circle.id);
    const joined = me && S.isActiveMember(db, me.id, circle.id);
    const removed = me && (S.membership(db, me.id, circle.id) || {}).status === 'removed';
    const recent = (db.posts || []).filter((p) => p.circleId === circle.id && p.status === 'published')
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];

    return `<article class="card">
      <div class="row-top">
        <div class="identity-mark"><img src="assets/art/logo-mono.svg" alt=""></div>
        <div class="grow">
          <h3 style="font-size:17px">${esc(course ? course.name : '未知课程')}</h3>
          <div class="identity-meta">
            <span>${esc(course ? course.school : '')}</span><span class="dot-sep">·</span>
            <span>${members} 位成员</span>
            <span class="dot-sep">·</span>
            <span>全课程共用一个圈</span>
            ${circle.status === 'archived' ? '<span class="status-pill status-removed">已归档</span>' : ''}
          </div>
          ${recent ? `<p class="small secondary mt-2">最近：${esc(recent.title || '一条新讨论')} · ${esc(timeAgo(recent.publishedAt))}</p>`
            : '<p class="small muted mt-2">圈内还没有帖子，加入后可以从第一帖开始。</p>'}
        </div>
      </div>
      <div class="row mt-4 wrap">
        <a class="btn btn-ghost btn-sm" href="${href(`/circles/${circle.id}`)}">查看圈内公开内容</a>
        ${joined
          ? `<a class="btn btn-sm" href="${href(`/circles/${circle.id}`)}">已加入 · 进入</a>`
          : removed
            ? '<span class="tiny danger-text">你曾被移出这个圈，需管理员解除限制</span>'
            : circle.status === 'archived'
              ? '<span class="tiny muted">归档圈不接受新成员</span>'
              : `<button class="btn btn-sm" type="button" data-action="join-circle" data-circle="${esc(circle.id)}">加入这个课友圈</button>`}
        ${circle.inviteCode
          ? `<a class="act" href="${href('/invite/' + circle.inviteCode)}">${icon('share', 'i-sm')}邀请链接</a>`
          : '<span class="act muted tiny">邀请码由管理员生成，暂不可分享</span>'}
      </div>
    </article>`;
  }).join('');

  return `
  <div class="layout-2">
    <main>
      <nav class="crumbs" aria-label="面包屑"><a href="${href('/circles')}">课友圈</a><span>/</span><span>找课</span></nav>
      <div class="card mt-4">
        <h1>找到你的课程圈</h1>
        <p class="secondary small mt-2">面向全校课程，一门课一个共用圈，跨年级沉淀经验；不是教务教学班。按课程名搜索，加入后可提问、纠错和分享。</p>
        <form class="mt-4" data-form="find-circles">
          <div class="form-row">
            <div class="field">
              <label for="find-school">学校</label>
              <select class="select" id="find-school" name="school">
                <option value="">全部学校</option>
                ${['浙江大学', '通用·不限学校'].map((s) => `<option value="${esc(s)}" ${school === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="find-q">课程名 <span class="label-hint">输入关键词更快</span></label>
              <input class="input" id="find-q" name="q" value="${esc(qText)}" placeholder="例如：线性代数 / 大学物理">
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label for="find-course">课程 <span class="label-hint">共 ${courses.length} 门，可先输入课程名</span></label>
              <select class="select" id="find-course" name="courseId">
                <option value="">全部课程</option>
                ${optionCourses.map((c) => `<option value="${esc(c.id)}" ${courseId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>&nbsp;</label>
              <div class="row wrap">
                <button class="btn" type="submit">查找课友圈</button>
                <a class="link small" href="${href('/find-circles')}">清除筛选</a>
              </div>
            </div>
          </div>
        </form>
      </div>

      <div class="toolbar mt-4">
        <h2 style="font-size:16px">匹配到 ${total} 个课程圈</h2>
        <span class="grow"></span>
        <span class="tiny muted">一门课一个圈；学期写在帖子和资料里</span>
      </div>
      ${total ? cards : `<div class="card">${emptyState({
        img: 'empty-search.svg',
        title: '还没有这门课的圈',
        text: '课程目录由平台维护；如果课程存在但还没有圈，可以提交建圈申请。',
        actions: `<a class="btn btn-ghost btn-sm" href="${href('/find-circles')}">清除筛选</a>`
      })}</div>`}
      ${pageCount > 1 ? `<nav class="pager" aria-label="分页">
        ${current > 1 ? `<a class="btn btn-ghost btn-sm" href="${href('/find-circles', { ...q, page: current - 1 })}">上一页</a>` : ''}
        <span class="tiny muted">第 ${current} / ${pageCount} 页</span>
        ${current < pageCount ? `<a class="btn btn-ghost btn-sm" href="${href('/find-circles', { ...q, page: current + 1 })}">下一页</a>` : ''}
      </nav>` : ''}

      <section class="card mt-6">
        <div class="card-title">目录中已有课程但缺少圈？申请补建</div>
        <p class="small secondary mb-3">一门课一个圈。已有课程圈可直接加入，无需申请；缺圈时可申请补建。课程名称缺失或有误，可通过「社区规则与隐私说明」联系维护者。申请者不会自动获得管理权限。</p>
        <form data-form="application">
          <div class="field">
            <label for="ap-course">课程</label>
            <select class="select" id="ap-course" name="courseId" required>
              ${optionCourses.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
            </select>
            <p class="field-help">列表只展示当前筛选的前 60 门；课很多时先在上方按课程名搜索，再回来提交。</p>
          </div>
          <div class="field">
            <label for="ap-reason">说明 <span class="label-hint">选填</span></label>
            <textarea class="textarea" id="ap-reason" name="reason" rows="2" placeholder="为什么需要这个圈？是否已确认课程目录里没有它？"></textarea>
          </div>
          <button class="btn" type="submit">提交申请</button>
        </form>
      </section>
    </main>

    <aside class="rail">
      <section class="card">
        <div class="card-title">加入后会发生什么</div>
        <div class="stack small secondary">
          <p>· 圈内新帖出现在「我的课友圈」聚合流</p>
          <p>· 可以发帖、评论、纠错，收到回复消息</p>
          <p>· 成员名单不公开，也不会导出你的修课清单</p>
          <p>· 随时可以退出、静音或移到往期</p>
        </div>
      </section>
      <section class="card">
        <div class="card-title">公开范围</div>
        <p class="small secondary">首版课友圈与已发布内容都公开可浏览；成员身份用于参与和首页订阅，不是保密保障。请不要发布不该公开的内容。</p>
      </section>
      ${signCard(ctx)}
    </aside>
  </div>`;
}

/* ---------- 圈页 ---------- */

export function circle(ctx) {
  const { db, me, route } = ctx;
  const circle = S.circleOf(db, route.params.id);
  if (!circle) {
    return `<div class="layout-1">${emptyState({
      img: 'removed.svg', title: '这个课友圈不存在', text: '链接可能有误，或圈已被合并。',
      actions: `<a class="btn btn-sm" href="${href('/find-circles')}">去找课</a>`
    })}</div>`;
  }
  const course = S.courseOf(db, circle.courseId);
  const membership = me ? S.membership(db, me.id, circle.id) : null;
  const joined = !!membership && membership.status === 'active';
  const tab = ['discussion', 'week', 'resources'].includes(route.query.tab) ? route.query.tab : 'discussion';
  const board = route.query.board || '';
  const term = TERMS.includes(route.query.term) ? route.query.term : '';
  const members = S.countMembers(db, circle.id);
  const archived = circle.status === 'archived';

  const pinned = circle.pinnedPostId ? S.postOf(db, circle.pinnedPostId) : null;

  const baseQuery = { tab: tab === 'discussion' ? '' : tab, board, term };
  const tabLink = (name) => href(`/circles/${circle.id}`, { ...baseQuery, tab: name === 'discussion' ? '' : name });

  let content = '';
  if (tab === 'resources') {
    const items = S.searchResources(db, { courseId: circle.courseId, sort: 'recent', term }).items;
    content = items.length
      ? items.map((item) => resourceCard(ctx, item)).join('')
      : `<div class="card">${emptyState({
        img: 'empty-search.svg',
        title: '这个圈还没有公开收录的资料',
        text: '资料视图复用全站资料索引；作者确认公开后才会出现在这里。',
        actions: `<a class="btn btn-ghost btn-sm" href="${href('/resources', { courseId: circle.courseId })}">看同课程资料</a>`
      })}</div>`;
  } else {
    const feed = S.feedPosts(db, {
      meId: me ? me.id : null, mode: 'all', circleId: circle.id, board: board || null,
      week: tab === 'week', term, limit: 20
    });
    content = feed.items.length
      ? feed.items.map((post) => postCard(ctx, post)).join('')
      : `<div class="card">${emptyState({
        img: 'empty-feed.svg',
        title: tab === 'week' ? '本周还没有新内容' : '这里还没有帖子',
        text: tab === 'week'
          ? '本周视图只看本周发布或有正文／附件更新的帖子；旧帖的新评论不会混进来。'
          : joined ? '把你的问题或整理放上来，开始这门课的讨论。' : '加入后可以发第一帖。',
        actions: joined && !archived ? `<a class="btn btn-sm" href="${href('/publish', { circle: circle.id })}">发布帖子</a>` : ''
      })}</div>`;
  }

  ctx.once(`circle:${circle.id}`, () => {
    if (joined) ctx.invoke('markCircleSeen', { circleId: circle.id });
  });

  return `
  <div class="container">
    <div class="layout-3">
      <aside class="rail rail-sticky" aria-label="圈子导航">
        <div class="rail-group">
          <div class="rail-title">我的课友圈</div>
          ${me ? S.myCircles(db, me.id).slice(0, 6).map(({ circle: c }) => `
            <a class="circle-mini" href="${href(`/circles/${c.id}`)}" ${c.id === circle.id ? 'aria-current="page"' : ''}>
              <span class="grow"><b>${esc(S.circleShort(db, c))}</b><small>课程圈</small></span>
            </a>`).join('') : ''}
          <a class="rail-link" href="${href('/find-circles')}">${icon('plus')}找课 / 加入圈子</a>
        </div>
        <div class="rail-sep"></div>
        <a class="rail-link" href="${href('/circles')}">${icon('home')}回到我的课友圈</a>
        <a class="rail-link" href="${href(`/courses/${circle.courseId}`)}">${icon('course')}课程页</a>
        <a class="rail-link" href="${href('/me/messages')}">${icon('bell')}消息</a>
      </aside>

      <main>
        <section class="circle-banner">
          <div class="identity">
            <div class="identity-mark"><img src="assets/art/logo-mono.svg" alt=""></div>
            <div class="grow">
              <h1>${esc(course ? course.name : '未知课程')}</h1>
              <div class="identity-meta">
                <span>${esc(course ? course.school : '')}</span><span class="dot-sep">·</span>
                <span>全课程共用一个圈</span><span class="dot-sep">·</span>
                <span>${members} 位成员</span>
                ${archived ? '<span class="status-pill status-removed">已归档 · 只读</span>' : ''}
                ${joined ? '<span class="status-pill status-ready">已加入</span>' : ''}
                ${membership && membership.muted ? '<span class="status-pill status-processing">已静音</span>' : ''}
                ${membership && membership.shelved ? '<span class="status-pill status-processing">已移到往期</span>' : ''}
              </div>
              <p class="tiny muted mt-2">公开可浏览 · 加入不代表正式修课认证 · 不收集学号与完整课表</p>
            </div>
          </div>
          <div class="chips">
            ${archived
              ? '<span class="chip is-active">已归档</span>'
              : joined
                ? `<button class="chip" type="button" data-action="mute-circle" data-circle="${esc(circle.id)}" data-value="${membership.muted ? '0' : '1'}">
                     ${membership.muted ? '取消静音' : '静音'}
                   </button>
                   <button class="chip" type="button" data-action="shelve-circle" data-circle="${esc(circle.id)}" data-value="${membership.shelved ? '0' : '1'}">
                     ${membership.shelved ? '移回常用' : '移到往期'}
                   </button>
                   <button class="chip" type="button" data-action="leave-circle" data-circle="${esc(circle.id)}">退出圈子</button>`
                : `<button class="btn btn-sm" type="button" data-action="join-circle" data-circle="${esc(circle.id)}">加入这个课友圈</button>`}
            ${circle.inviteCode ? `<button class="chip" type="button" data-action="share" data-path="/invite/${esc(circle.inviteCode)}">${icon('share', 'i-sm')}邀请课友</button>` : ''}
          </div>
        </section>

        ${archived ? `<div class="mb-4">${notice('这门课的圈已归档，保留讨论和资料供回看。不能新发帖或评论，仍可收藏、下载与赠签；归档不删除内容，也不触发退款。', 'warn', 'lock')}</div>` : ''}

        ${pinned && pinned.status === 'published' ? `<div class="card">
          <div class="row wrap" style="gap:8px"><span class="chip chip-sm is-active">置顶</span>
            <span class="tiny muted">同学整理 · 圈管理员确认 · 非学校通知</span></div>
          <h3 class="mt-2"><a href="${href(`/posts/${pinned.id}`)}">${esc(pinned.title || '本周学习索引')}</a></h3>
          <p class="small secondary mt-2">${esc(pinned.body.split('\n')[0])}</p>
          <a class="link small" href="${href(`/posts/${pinned.id}`)}">打开完整内容 →</a>
        </div>` : ''}

        <div class="chips mb-3" aria-label="按学期筛选">
          <a class="chip chip-sm ${!term ? 'is-active' : ''}" href="${href(`/circles/${circle.id}`, { ...baseQuery, term: '' })}">全部学期</a>
          ${TERMS.slice(0, 7).map((value) => `<a class="chip chip-sm ${term === value ? 'is-active' : ''}" href="${href(`/circles/${circle.id}`, { ...baseQuery, term: value })}">${esc(value)}</a>`).join('')}
          ${term && !TERMS.slice(0, 7).includes(term) ? `<span class="chip chip-sm is-active">${esc(term)}</span>` : ''}
        </div>
        <p class="tiny muted mb-3">不同学期、教材和教师的安排可能不同，请结合资料适用范围使用。资料页收录本课程的公开资料，不要求作者先入圈。</p>
        <div class="tabs" role="tablist">
          <a class="tab" role="tab" aria-selected="${tab === 'discussion'}" href="${tabLink('discussion')}">讨论</a>
          <a class="tab" role="tab" aria-selected="${tab === 'week'}" href="${tabLink('week')}">本周</a>
          <a class="tab" role="tab" aria-selected="${tab === 'resources'}" href="${tabLink('resources')}">资料</a>
          <span class="grow"></span>
          ${joined && !archived ? `<a class="btn btn-sm" href="${href('/publish', { circle: circle.id })}">发帖子</a>` : ''}
        </div>

        ${tab !== 'resources' ? `<div class="chips mb-3">
          <a class="chip chip-sm ${!board ? 'is-active' : ''}" href="${href(`/circles/${circle.id}`, { tab })}">全部板块</a>
          ${BOARDS.map((b) => `<a class="chip chip-sm ${board === b.key ? 'is-active' : ''}"
            href="${href(`/circles/${circle.id}`, { tab, board: b.key })}">${esc(b.label)}</a>`).join('')}
        </div>` : ''}

        ${content}
      </main>

      <aside class="rail rail-sticky">
        <section class="card">
          <div class="card-title">关于这个圈</div>
          <div class="stack small secondary">
            <p>课程：${esc(course ? course.name : '')}${course && course.code ? `（${esc(course.code)}）` : ''}</p>
            <p>范围：这门课的所有同学共用一个圈，不分教学班与教师</p>
            <p>成员：${members} 人（名单不公开）</p>
          </div>
          ${joined && !archived ? `<a class="link small" href="${href('/publish', { circle: circle.id })}">发布到这个圈 →</a>` : ''}
        </section>
        ${weekIndexCard(ctx)}
        ${signCard(ctx)}
      </aside>
    </div>
  </div>`;
}

/* ---------- 邀请落地页 ---------- */

export function invite(ctx) {
  const { db, me, route } = ctx;
  const code = String(route.params.code || '').toUpperCase();
  const circle = (db.circles || []).find((c) => String(c.inviteCode).toUpperCase() === code);

  if (!circle) {
    return `<div class="layout-1">${emptyState({
      img: 'network-error.svg',
      title: '这个邀请链接已失效',
      text: '邀请码只是来源标识，管理员可以让它失效。你仍然可以按课程名自己搜索。',
      actions: `<a class="btn btn-sm" href="${href('/find-circles')}">去找课圈</a>`
    })}</div>`;
  }

  const course = S.courseOf(db, circle.courseId);
  const members = S.countMembers(db, circle.id);
  const joined = me && S.isActiveMember(db, me.id, circle.id);
  const archived = circle.status === 'archived';
  const previews = (db.posts || [])
    .filter((p) => p.circleId === circle.id && p.status === 'published')
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 3);

  ctx.once(`invite:${code}`, () => {
    ctx.invoke('recordEvent', { type: 'invite_landing_view', meta: { code, circleId: circle.id } });
  });

  return `
  <div class="layout-2">
    <main>
      <div class="card">
        <div class="identity">
          <div class="identity-mark"><img src="assets/art/logo-mono.svg" alt=""></div>
          <div class="grow">
            <h1>一起上${esc(course ? course.name : '这门课')}的同学，来这里聊聊</h1>
            <div class="identity-meta">
              <span>${esc(course ? course.school : '')}</span><span class="dot-sep">·</span>
              <span>全课程共用一个圈</span><span class="dot-sep">·</span>
              <span>${members} 位成员</span>
            </div>
          </div>
        </div>
        <p class="small secondary mt-4">课堂里没跟上的一步、整理好的笔记、作业中的尝试，都可以继续讨论。这是公开的学习空间，不是本班私密群。</p>

        <div class="row wrap mt-4">
          ${archived
            ? notice('这个圈已归档，只能阅读历史内容。', 'warn', 'lock')
            : joined
              ? `<a class="btn" href="${href(`/circles/${circle.id}`)}">已加入 · 进入课友圈</a>`
              : me
                ? `<button class="btn" type="button" data-action="join-circle" data-circle="${esc(circle.id)}" data-code="${esc(code)}">确认加入这个课友圈</button>`
                : `<a class="btn" href="${href('/login', { next: `/invite/${code}` })}">登录后确认加入</a>`}
          <a class="btn btn-ghost" href="${href(`/circles/${circle.id}`)}">先看看公开内容</a>
        </div>
        <p class="tiny muted mt-3">登录后不会自动加入，需要你再确认一次。无需学号、完整课表或通讯录。</p>
      </div>

      <section class="card">
        <div class="card-title">圈内最近的公开讨论</div>
        ${previews.length
          ? previews.map((post) => `<div class="mb-3">
              <a class="small" href="${href(`/posts/${post.id}`)}">${esc(post.title || post.body.slice(0, 30))}</a>
              <div class="tiny muted">${esc((S.userOf(db, post.authorId) || {}).nickname || '')} · ${esc(timeAgo(post.publishedAt))} · ${S.commentCount(db, post.id)} 条讨论</div>
            </div>`).join('')
          : '<p class="small muted">圈内还没有公开帖子。</p>'}
      </section>

      <section class="card">
        <div class="card-title">加入前请核对</div>
        <div class="stack small secondary">
          <p>· 这是「${esc(course ? course.name : '这门课')}」的课程圈，全课程共用一个</p>
          <p>· 9.2 起不再按教学班或教师分圈；学期写在帖子和资料里</p>
          <p>· 圈内内容公开可见，请不要发布隐私信息</p>
        </div>
      </section>
    </main>

    <aside class="rail">
      <section class="card">
        <div class="card-title">关于「共页」</div>
        <p class="small secondary">共页有两个并列入口：找资料与课友圈。资料按课程与用途检索、可预览可下载；课友圈一门课一个，加入圈子不是使用资料的前提。</p>
        <a class="link small" href="${href('/')}">去看看找资料 →</a>
      </section>
      ${signCard(ctx)}
    </aside>
  </div>`;
}

