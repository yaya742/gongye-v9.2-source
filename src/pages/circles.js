/* 课友圈：我的圈聚合流、找课加入、圈页、邀请落地 */

import { href } from '../router.js';
import * as S from '../state/selectors.js';
import {
  postCard, resourceCard, emptyState, notice, signCard, weekIndexCard,
  pendingQuestionsCard, icon, avatar, authorLine
} from '../components/ui.js';
import { esc, timeAgo, BOARDS } from '../lib/format.js';

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
  // 游客没有“我的圈”，默认进发现，别让主导航落到空页面
  const mode = ['my', 'following', 'discover'].includes(route.query.mode) ? route.query.mode : (me ? 'my' : 'discover');
  const board = route.query.board || '';
  const sort = route.query.sort === 'hot' ? 'hot' : 'latest';
  const offset = Math.max(0, Number(route.query.offset || 0));
  // 加载更多是在已有列表后追加：offset 只记录多展开了多少条，刷新和返回都能回到同样的长度
  const feed = S.feedPosts(db, {
    meId: me ? me.id : null, mode, board: board || null, sort, limit: 10 + offset
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
      href="${circleHref('/circles', { ...route.query, mode, board: item.key, offset: '' })}">${esc(item.label)}</a>`).join('');

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
    ? `<div class="load-more"><a class="btn btn-ghost btn-sm" href="${circleHref('/circles', { ...route.query, mode, offset: offset + 10 })}">加载更多</a></div>`
    : '';
  const claimable = me && S.claimState(db, me.id).canClaim;

  const myCircleList = mine.length
    ? mine.map(({ membership, circle }) => `
      <a class="circle-mini" href="${href(`/circles/${circle.id}`)}">
        <span class="grow">
          <b>${esc(S.circleShort(db, circle))}</b>
          <small>课程圈${circle.status === 'archived' ? ' · 已归档' : membership.shelved ? ' · 往期' : ''}</small>
        </span>
        ${newActivity(db, membership, circle.id) && !membership.muted ? '<span class="new-dot" title="有新动态"></span>' : ''}
      </a>`).join('')
    : `<p class="tiny muted" style="padding:0 10px">${me ? '还没有加入任何圈。' : '登录后，这里会列出你加入的圈。'}</p>`;

  return `
  <div class="container">
    <div class="layout-3">
      <aside class="rail rail-sticky circle-feed-rail" aria-label="我的课友圈">
        <div class="rail-group">
          <div class="rail-title">我的课友圈</div>
          ${myCircleList}
          <a class="rail-link rail-link-find-circles" href="${href('/find-circles')}">${icon('plus')}找课 / 加入圈子</a>
        </div>
      </aside>

      <main>
        ${claimable ? `<button class="claim-strip mobile-bookmark" type="button" data-action="claim-daily">
          ${icon('bookmark', 'i-sm')}<span class="grow">今日页签可领取</span><b>领取</b>
        </button>` : ''}

        ${me ? `<div class="card card-tight row composer-entry">
          ${avatar(me, 'avatar')}
          <a class="grow secondary small" href="${href('/publish')}">今天有什么想一起讨论？</a>
          <a class="icon-btn" href="${href('/publish')}" aria-label="发布">${icon('plus')}</a>
        </div>` : ''}

        <div class="tabs" role="tablist">
          ${modeTabs.map((tab) => `<a class="tab" role="tab" aria-selected="${mode === tab.key}"
            href="${circleHref('/circles', { mode: tab.key })}">${esc(tab.label)}</a>`).join('')}
          ${mode === 'discover' ? `<span class="grow"></span>
            <a class="chip chip-sm ${sort === 'hot' ? 'is-active' : ''}" href="${circleHref('/circles', { mode, sort: sort === 'hot' ? '' : 'hot' })}">热门</a>` : ''}
        </div>

        <div class="chips chips-scroll mb-3">${boardChips}
          ${!me && mode !== 'my' ? `<button class="chip chip-sm circle-guest-help" type="button"
            data-action="circle-guest-info" aria-label="游客可以做什么" title="游客可以做什么">${icon('question', 'i-sm')}</button>` : ''}
        </div>

        ${me ? `<div class="chips chips-scroll circle-quick mb-3">
          ${activeMine.map(({ circle }) => `<a class="chip chip-sm" href="${href(`/circles/${circle.id}`)}">${esc(S.circleShort(db, circle))}</a>`).join('')}
          <a class="chip chip-sm" href="${href('/find-circles')}">${icon('plus', 'i-sm')}找课</a>
        </div>` : ''}

        ${body}
        ${loadMore}
      </main>

      <aside class="rail rail-sticky">
        ${weekIndexCard(ctx)}
        ${pendingQuestionsCard(ctx)}
        ${signCard(ctx)}
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
  const activityOnly = !courseId && !qText;

  const courses = (db.courses || []).filter((c) => c.id !== 'c_general');
  const selectedCourse = courseId ? courses.find((c) => c.id === courseId) : null;
  const schools = Array.from(new Set(courses.map((c) => c.school).filter(Boolean)));
  // 只有还没有圈的课程才能申请；课程有几千门，下拉只给当前筛选或前 60 个
  const courseHasCircle = new Set((db.circles || []).map((c) => c.courseId));
  const applicableCourses = courses.filter((c) => !courseHasCircle.has(c.id));
  const optionCourses = (courseId
    ? applicableCourses.filter((c) => c.id === courseId)
    : qText
      ? applicableCourses.filter((c) => c.name.toLowerCase().includes(qText.toLowerCase()))
      : applicableCourses).slice(0, 60);
  const circleStats = new Map();
  const statsFor = (id) => {
    if (!circleStats.has(id)) circleStats.set(id, { members: 0, recent: null });
    return circleStats.get(id);
  };
  (db.memberships || []).forEach((membership) => {
    if (membership.status === 'active') statsFor(membership.circleId).members += 1;
  });
  (db.posts || []).forEach((post) => {
    if (post.status !== 'published' || !post.circleId) return;
    const stats = statsFor(post.circleId);
    if (!stats.recent || new Date(post.publishedAt) > new Date(stats.recent.publishedAt)) stats.recent = post;
  });

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
  if (activityOnly) {
    list = list.filter((circle) => {
      const stats = circleStats.get(circle.id);
      return !!stats && (stats.members > 0 || !!stats.recent);
    });
  }
  list.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    const statsA = circleStats.get(a.id) || { members: 0, recent: null };
    const statsB = circleStats.get(b.id) || { members: 0, recent: null };
    if (statsA.members !== statsB.members) return statsB.members - statsA.members;
    const recentA = statsA.recent ? new Date(statsA.recent.publishedAt).getTime() : 0;
    const recentB = statsB.recent ? new Date(statsB.recent.publishedAt).getTime() : 0;
    if (recentA !== recentB) return recentB - recentA;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const visible = list.slice((current - 1) * pageSize, current * pageSize);

  const cards = visible.map((circle) => {
    const course = S.courseOf(db, circle.courseId);
    const stats = circleStats.get(circle.id) || { members: 0, recent: null };
    const members = stats.members;
    const joined = me && S.isActiveMember(db, me.id, circle.id);
    const removed = me && (S.membership(db, me.id, circle.id) || {}).status === 'removed';
    const recent = stats.recent;
    const circleLink = href(`/circles/${circle.id}`);

    return `<article class="card find-card card-hover" data-card-kind="circle" data-card-id="${esc(circle.id)}" data-href="${circleLink}" tabindex="-1">
      <div class="row-top">
        <div class="identity-mark"><img src="assets/art/logo-mono.svg" alt=""></div>
        <div class="grow">
          <h3><a href="${circleLink}">${esc(course ? course.name : '未知课程')}</a></h3>
          <div class="identity-meta">
            <span>${members} 位成员</span>
            ${schools.length > 1 && course ? `<span class="dot-sep">·</span><span>${esc(course.school)}</span>` : ''}
            ${circle.status === 'archived' ? '<span class="status-pill status-removed">已归档</span>' : ''}
          </div>
        </div>
      </div>
      <p class="find-card-recent">${recent
        ? `最近：${esc(recent.title || '一条新讨论')} · ${esc(timeAgo(recent.publishedAt))}`
        : members ? '已有成员，可以开始讨论。' : '圈内还没有帖子，加入后可以发第一帖。'}</p>
      <div class="find-card-foot">
        <a class="text-link" href="${circleLink}">看看圈内讨论 →</a>
        ${joined
          ? '<span class="status-pill status-ready">已加入</span>'
          : removed
            ? '<span class="tiny danger-text">你曾被移出这个圈，需管理员解除限制</span>'
            : circle.status === 'archived'
              ? '<span class="tiny muted">归档圈不接受新成员</span>'
              : `<button class="btn btn-sm" type="button" data-action="join-circle" data-circle="${esc(circle.id)}">加入课友圈</button>`}
      </div>
    </article>`;
  }).join('');

  return `
  <div class="layout-1 find-layout">
    <section class="card find-hero">
      <h1>找到你的课程圈</h1>
      <p class="secondary small mt-1">一门课一个圈，全课程的同学共用。搜课程名就能找到。</p>
      <form class="search-bar ${schools.length > 1 ? 'has-school' : ''}" data-form="find-circles" role="search">
        <div class="input-wrap">
          ${icon('search', 'i-sm')}
          <label class="visually-hidden" for="find-q">课程名</label>
          <input id="find-q" name="q" type="search" value="${esc(qText)}" placeholder="例如：线性代数 / 大学物理">
        </div>
        ${schools.length > 1 ? `<div class="find-school">
          <label class="visually-hidden" for="find-school">学校</label>
          <select class="select" id="find-school" name="school">
            <option value="">全部学校</option>
            ${schools.map((s) => `<option value="${esc(s)}" ${school === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>
        </div>` : school ? `<input type="hidden" name="school" value="${esc(school)}">` : ''}
        ${courseId ? `<input type="hidden" name="courseId" value="${esc(courseId)}">` : ''}
        <button class="btn" type="submit">查找</button>
      </form>
      ${selectedCourse ? `<div class="active-filters">
        <a class="chip chip-sm is-active" href="${href('/find-circles', { q: qText, school })}" aria-label="取消课程筛选：${esc(selectedCourse.name)}">${esc(selectedCourse.name)}<span aria-hidden="true">×</span></a>
      </div>` : ''}
    </section>

    <div class="toolbar">
      <h2 style="font-size:16px">${activityOnly ? `有成员或讨论的课友圈（${total}）` : `匹配到 ${total} 个课程圈`}</h2>
      <span class="grow"></span>
      ${activityOnly
        ? '<span class="tiny muted">搜索课程名可查看还没人的圈</span>'
        : `<a class="tiny link" href="${href('/find-circles')}">清除筛选</a>`}
    </div>
    ${total ? `<div class="find-grid">${cards}</div>` : `<div class="card">${emptyState({
      img: 'empty-search.svg',
      title: activityOnly ? '暂时没有活跃的课友圈' : '还没有这门课的圈',
      text: activityOnly
        ? '搜索课程名可以查看尚未活跃的圈。'
        : '课程目录由平台维护；如果课程存在但还没有圈，可以在下方申请建圈。',
      actions: `<a class="btn btn-ghost btn-sm" href="${href('/find-circles')}">清除筛选</a>`
    })}</div>`}
    ${pageCount > 1 ? `<nav class="pager" aria-label="分页">
      ${current > 1 ? `<a class="btn btn-ghost btn-sm" href="${href('/find-circles', { ...q, page: current - 1 })}">上一页</a>` : ''}
      <span class="tiny muted">第 ${current} / ${pageCount} 页</span>
      ${current < pageCount ? `<a class="btn btn-ghost btn-sm" href="${href('/find-circles', { ...q, page: current + 1 })}">下一页</a>` : ''}
    </nav>` : ''}

    <div class="find-help">
      <details class="card circle-help" ${q.apply ? 'open' : ''}>
        <summary>没有找到课程？申请建圈</summary>
        <div class="mt-3">
          <form data-form="application">
            <div class="field">
              <label for="ap-course">课程名称</label>
              <input class="input" id="ap-course" name="courseName" required minlength="2" maxlength="40"
                list="ap-course-list" value="${esc(selectedCourse ? selectedCourse.name : qText)}" placeholder="例如：数字电路">
              <datalist id="ap-course-list">
                ${optionCourses.map((c) => `<option value="${esc(c.name)}"></option>`).join('')}
              </datalist>
              <p class="field-help">目录里还没有的课程也可以申请，管理员核实后会开通课程圈并通知你。</p>
            </div>
            <div class="field">
              <label for="ap-reason">说明 <span class="label-hint">选填</span></label>
              <textarea class="textarea textarea-sm" id="ap-reason" name="reason" rows="2" maxlength="200" placeholder="例如：这学期开课，同学们想有个地方讨论"></textarea>
            </div>
            <button class="btn" type="submit">提交申请</button>
          </form>
        </div>
      </details>

      <details class="card circle-help">
        <summary>加入规则与公开范围</summary>
        <div class="stack small secondary mt-3">
          <p>· 圈内新帖出现在「我的课友圈」聚合流，可以发帖、评论和收到回复消息</p>
          <p>· 随时可以退出、静音或移到往期</p>
          <p>· 成员名单不公开，也不会导出你的修课清单</p>
          <p>· 已发布内容对访问者公开，请勿发布隐私</p>
        </div>
      </details>
    </div>
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
  const members = S.countMembers(db, circle.id);
  const archived = circle.status === 'archived';

  const pinned = circle.pinnedPostId ? S.postOf(db, circle.pinnedPostId) : null;

  const baseQuery = { tab: tab === 'discussion' ? '' : tab, board };
  const tabLink = (name) => href(`/circles/${circle.id}`, { ...baseQuery, tab: name === 'discussion' ? '' : name });

  let content = '';
  if (tab === 'resources') {
    const items = S.searchResources(db, { courseId: circle.courseId, sort: 'recent' })
      .items.filter((item) => item.post.circleId === circle.id);
    content = items.length
      ? items.map((item) => resourceCard(ctx, item)).join('')
      : `<div class="card">${emptyState({
        img: 'empty-search.svg',
        title: '这个圈还没有公开收录的资料',
        text: '作者公开收录后会出现在这里。',
        actions: `<a class="btn btn-ghost btn-sm" href="${href('/resources', { courseId: circle.courseId })}">看同课程资料</a>`
      })}</div>`;
  } else {
    const feed = S.feedPosts(db, {
      meId: me ? me.id : null, mode: 'all', circleId: circle.id, board: board || null,
      week: tab === 'week', limit: 20
    });
    // 置顶帖已经在上方单独展示，全部讨论里不再重复一遍
    const pinnedShown = pinned && pinned.status === 'published' && tab === 'discussion' && !board;
    const items = feed.items.filter((post) => !(pinnedShown && post.id === pinned.id));
    content = items.length
      ? items.map((post) => postCard(ctx, post)).join('')
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
      <aside class="rail rail-sticky circle-feed-rail" aria-label="圈子导航">
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
      </aside>

      <main>
        <nav class="crumbs circle-crumbs" aria-label="面包屑">
          <a href="${href('/circles')}">课友圈</a><span>/</span><span>${esc(course ? course.name : '课程圈')}</span>
        </nav>
        <section class="circle-banner">
          <div class="identity">
            <div class="identity-mark"><img src="assets/art/logo-mono.svg" alt=""></div>
            <div class="grow">
              <h1>${esc(course ? course.name : '未知课程')}</h1>
              <div class="identity-meta">
                <span>${esc(course ? course.school : '')}</span><span class="dot-sep">·</span>
                <span>${members} 位成员</span><span class="dot-sep">·</span>
                <a class="link" href="${href(`/courses/${circle.courseId}`)}">课程页</a>
                ${archived ? '<span class="status-pill status-removed">已归档 · 只读</span>' : ''}
                ${joined ? '<span class="status-pill status-ready">已加入</span>' : ''}
                ${membership && membership.muted ? '<span class="status-pill status-processing">已静音</span>' : ''}
                ${membership && membership.shelved ? '<span class="status-pill status-processing">已移到往期</span>' : ''}
              </div>
            </div>
            <div class="circle-banner-actions">
              ${!archived && !joined ? `<button class="btn btn-sm" type="button" data-action="join-circle" data-circle="${esc(circle.id)}">加入这个课友圈</button>` : ''}
              <button class="btn btn-ghost btn-sm" type="button" data-action="share" data-path="/invite/${esc(circle.inviteCode)}">${icon('share', 'i-sm')}邀请课友</button>
              ${joined && !archived ? `<details class="more-menu">
                <summary class="icon-btn" aria-label="更多圈子操作">${icon('more')}</summary>
                <div class="more-menu-panel">
                  <button type="button" data-action="mute-circle" data-circle="${esc(circle.id)}" data-value="${membership.muted ? '0' : '1'}">${membership.muted ? '取消静音' : '静音'}</button>
                  <button type="button" data-action="shelve-circle" data-circle="${esc(circle.id)}" data-value="${membership.shelved ? '0' : '1'}">${membership.shelved ? '移回常用' : '移到往期'}</button>
                  <button class="is-danger" type="button" data-action="leave-circle" data-circle="${esc(circle.id)}">退出圈子</button>
                </div>
              </details>` : ''}
            </div>
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

        <div class="tabs" role="tablist">
          <a class="tab" role="tab" aria-selected="${tab === 'discussion'}" href="${tabLink('discussion')}">讨论</a>
          <a class="tab" role="tab" aria-selected="${tab === 'week'}" href="${tabLink('week')}">本周</a>
          <a class="tab" role="tab" aria-selected="${tab === 'resources'}" href="${tabLink('resources')}">资料</a>
          <span class="grow"></span>
          ${joined && !archived ? `<a class="btn btn-sm" href="${href('/publish', { circle: circle.id })}">发帖子</a>` : ''}
        </div>

        ${tab !== 'resources' ? `<div class="chips chips-scroll mb-3">
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
            <p>圈内内容公开可浏览；加入不代表正式修课认证，也不收集学号与完整课表。</p>
          </div>
        </section>
        ${signCard(ctx)}
      </aside>
    </div>
  </div>`;
}

/* ---------- 邀请落地页 ---------- */

export function invite(ctx) {
  const { db, me, route } = ctx;
  const code = String(route.params.code || '').toUpperCase();
  const primaryMatch = (db.circles || []).find((c) => String(c.inviteCode || '').toUpperCase() === code);
  const alias = (db.circleInviteAliases || []).find((item) => String(item.code || '').toUpperCase() === code);
  const circle = primaryMatch || (alias && (db.circles || []).find((item) => item.id === alias.circleId)) || null;

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
    ctx.invoke('recordEvent', { type: 'invite_landing_view', meta: { code, circleId: circle.id } }, { quiet: true });
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
        <p class="small secondary mt-4">课堂里没跟上的一步、整理好的笔记、作业中的尝试，都可以继续讨论。任何访问者都可浏览圈内已公开内容；这是公开的学习空间，不是本班或校内私密群。</p>

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
          <p>· 不分教学班和老师，学期写在帖子和资料里</p>
          <p>· 任何访问者都可浏览圈内已公开内容；请不要发布隐私信息</p>
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

