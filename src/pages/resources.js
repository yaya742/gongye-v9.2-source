/* 找资料：首页、搜索结果、资料详情、资料发布 */

import { href } from '../router.js';
import * as S from '../state/selectors.js';
import {
  resourceCard, emptyState, notice, icon, authorLine,
  commentList, commentForm, statusPill, publishSwitch, pdfPicker
} from '../components/ui.js';
import { esc, truncate, formatBytes, timeAgo, boardOf, mediaUrl, RESOURCE_TYPES, SCHOOLS, TERMS } from '../lib/format.js';

const SORTS = [
  { key: 'relevance', label: '相关性' },
  { key: 'recent', label: '最近更新' },
  { key: 'saved', label: '最多收藏' }
];

function withQuery(route, patch) {
  return href(route.path === '/' ? '/resources' : route.path, { ...route.query, ...patch });
}

function filterValues(route) {
  const q = route.query;
  return {
    q: q.q || '',
    school: q.school || '',
    courseId: q.courseId || '',
    term: q.term || '',
    type: q.type || '',
    tag: q.tag || '',
    sort: q.sort || (q.q ? 'relevance' : 'recent')
  };
}

/* ---------- 首页 ---------- */

export function resources(ctx) {
  const { db, route } = ctx;
  const filters = filterValues(route);
  const result = S.searchResources(db, filters);
  const shown = result.items.slice(0, 6);
  const coursesById = new Map((db.courses || []).map((course) => [course.id, course]));
  const courseCounts = new Map();
  S.searchResources(db, { sort: 'recent' }).items.forEach(({ resource }) => {
    if (resource.courseId && resource.courseId !== 'c_general') {
      courseCounts.set(resource.courseId, (courseCounts.get(resource.courseId) || 0) + 1);
    }
  });
  const courses = Array.from(courseCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([courseId]) => coursesById.get(courseId))
    .filter(Boolean);

  /* 最新讨论：不带附件的帖子（求助 / 讨论 / 学习方法）不会进"资料"列表，
   * 以前只能在搜索结果或作者主页看到，别人根本刷不到 —— 首页补一块。 */
  const resourcePostIds = new Set((db.resources || []).map((r) => r.postId));
  const latestDiscuss = S.feedPosts(db, { limit: 40 })
    .items.filter((post) => !resourcePostIds.has(post.id))
    .slice(0, 5);
  const discussions = latestDiscuss.length ? `<section class="card" aria-label="最新讨论">
    <div class="toolbar">
      <div class="section-title">最新讨论</div>
      <span class="grow"></span>
      <a class="tiny link" href="${href('/circles', { mode: 'discover' })}">看全部讨论 →</a>
    </div>
    <ul class="discuss-list">
      ${latestDiscuss.map((post) => {
        const author = S.userOf(db, post.authorId);
        const label = boardOf(post.board).label;
        return `<li>
          <span class="tag">${esc(label)}</span>
          <a class="discuss-title" href="${href(`/posts/${post.id}`)}">${esc(post.title || truncate(post.body || '', 24))}</a>
          <span class="discuss-meta">${esc(author ? author.nickname : '同学')} · ${timeAgo(post.publishedAt)}${S.commentCount(db, post.id) ? ` · 评论 ${S.commentCount(db, post.id)}` : ''}</span>
        </li>`;
      }).join('')}
    </ul>
  </section>` : '';
  const hasFilters = Object.entries(filters).some(([key, value]) => key !== 'sort' && !!value);

  const list = shown.length
    ? shown.map((item) => resourceCard(ctx, item)).join('')
    : `<div class="card">${emptyState({
      img: 'empty-search.svg',
      title: hasFilters ? '没有找到匹配的资料' : '还没有可展示的资料',
      text: hasFilters
        ? '调整关键词或筛选条件，或者发布一份资料。'
        : '发布一份整理好的课程资料，让同学更容易找到。',
      actions: `<div class="row wrap center-row">${hasFilters ? `<a class="btn btn-ghost btn-sm" href="${href('/resources')}">清除筛选</a>` : ''}
        <a class="btn btn-sm" href="${href('/publish/resource')}">分享资料</a>
        <a class="btn btn-ghost btn-sm" href="${href('/circles', { mode: 'discover' })}">去课友圈看看</a></div>`
    })}</div>`;

  // 没有资料时空态已经给了分享入口，侧栏不再重复
  const railHtml = `${discussions}${shown.length ? `<section class="card">
    <div class="card-title">手上有整理好的笔记？</div>
    <p class="small secondary">分享一份，同课程的同学就能搜到。</p>
    <a class="btn btn-sm btn-block mt-3" href="${href('/publish/resource')}">分享资料</a>
  </section>` : ''}`;

  return `
  <div class="container">
    <div class="home-layout resource-home ${railHtml ? '' : 'is-single'}">
      <section class="card res-search home-hero">
        <h1>找资料</h1>
        <p>按课程搜索笔记、题解和复习资料；下载需要登录。</p>
        <form class="search-bar" data-form="filter" role="search">
          <div class="input-wrap">
            ${icon('search', 'i-sm')}
            <label class="visually-hidden" for="res-q">搜索资料</label>
            <input id="res-q" name="q" type="search" value="${esc(filters.q)}"
              placeholder="搜课程、章节或标题">
          </div>
          ${filters.type ? `<input type="hidden" name="type" value="${esc(filters.type)}">` : ''}
          ${filters.sort ? `<input type="hidden" name="sort" value="${esc(filters.sort)}">` : ''}
          <button class="btn" type="submit">搜索</button>
        </form>
        ${courses.length ? `<div class="home-course-links">
          <span class="tiny muted">有资料的课程</span>
          <div class="chips chips-scroll">${courses.map((course) => `<a class="chip chip-sm" href="${href('/resources', { courseId: course.id })}">${esc(course.name)}</a>`).join('')}</div>
          <a class="tiny link" href="${href('/resources')}">全部资料 →</a>
        </div>` : ''}
      </section>

      <main class="home-main">
        ${shown.length ? `<div class="toolbar">
          <div class="section-title">最近资料</div>
          ${result.total > shown.length ? `<span class="grow"></span><a class="tiny link" href="${href('/resources', { q: filters.q })}">查看全部 ${result.total} 份 →</a>` : ''}
        </div>` : ''}
        ${list}
      </main>

      ${railHtml ? `<aside class="rail home-rail" aria-label="讨论与分享">${railHtml}</aside>` : ''}
    </div>
  </div>
  `;
}

/* ---------- 搜索结果 ---------- */

export function resourceSearch(ctx) {
  const { db, route, ui } = ctx;
  const filters = filterValues(route);
  const result = S.searchResources(db, filters);
  const courses = (db.courses || []).filter((c) => c.id !== 'c_general');
  const filterOptions = S.resourceFilterOptions(db, filters);
  const courseIds = new Set(filterOptions.courseIds);
  if (filters.courseId) courseIds.add(filters.courseId);
  const filterCourses = courses.filter((course) => courseIds.has(course.id));
  const includeSelected = (values, selected) => selected && !values.includes(selected)
    ? [selected, ...values]
    : values;
  const schoolOptions = includeSelected(filterOptions.schools, filters.school);
  const terms = includeSelected(filterOptions.terms, filters.term);
  const types = includeSelected(filterOptions.types, filters.type);
  const tags = includeSelected(filterOptions.tags, filters.tag);
  const advancedFilterCount = [filters.term, filters.type, filters.tag].filter(Boolean).length;
  const hasActiveFilters = ['q', 'school', 'courseId', 'term', 'type', 'tag'].some((key) => !!filters[key]);

  // 已选条件：手机上筛选面板默认收起，靠这一行看到并逐个取消
  const activeFilters = [
    filters.courseId ? { key: 'courseId', label: (S.courseOf(db, filters.courseId) || {}).name || '已选课程' } : null,
    filters.school ? { key: 'school', label: filters.school } : null,
    filters.term ? { key: 'term', label: S.termLabel(filters.term) } : null,
    filters.type ? { key: 'type', label: filters.type } : null,
    filters.tag ? { key: 'tag', label: `#${filters.tag}` } : null
  ].filter(Boolean);
  const filtersOpen = !!(ui && ui.filtersOpen);

  const sortChips = SORTS.map((sort) => {
    if (sort.key === 'relevance' && !filters.q) return '';
    return `<a class="chip chip-sm ${result.mode === sort.key ? 'is-active' : ''}"
      href="${withQuery(route, { sort: sort.key })}">${esc(sort.label)}</a>`;
  }).join('');

  // 9.1：课程优先搜索的可见反馈——识别到的课程、歧义候选、只命中课程的其余资料
  const courseInfo = result.course || { matched: [], candidates: [] };
  const firstCourse = courseInfo.matched && courseInfo.matched[0];
  let recognition = '';
  if (filters.q && firstCourse) {
    recognition = `<div class="search-course-note">${icon('course', 'i-sm')}
      <span>已按课程「${esc(firstCourse.name)}」优先匹配${courseInfo.residual ? `，剩余关键词「${esc(courseInfo.residual)}」` : ''}。${courseInfo.matched.length > 1 ? '同名课程仍按各自课程分别展示。' : ''}</span>
    </div>`;
  } else if (filters.q && courseInfo.ambiguous && courseInfo.candidates.length) {
    recognition = `<div class="search-course-note is-warn">${icon('flag', 'i-sm')}
      <span>「${esc(filters.q)}」可能对应多门课程，没有自动合并。请先选一门：</span>
      <span class="chips">${courseInfo.candidates.map((c) => `<a class="chip chip-sm" href="${href('/resources', { q: filters.q, courseId: c.id })}">${esc(c.name)} · ${esc(c.school)}</a>`).join('')}</span>
    </div>`;
  }

  const courseOnlyHtml = result.courseOnly && result.courseOnly.length
    ? `<section class="mt-6">
        <h2 style="font-size:16px">该课程其他资料</h2>
        <p class="tiny muted">课程命中，但与「${esc(courseInfo.residual || filters.q)}」无关，不混入上面的主结果。</p>
        ${result.courseOnly.map((item) => resourceCard(ctx, item)).join('')}
      </section>` : '';

  const results = result.items.length
    ? result.items.map((item) => resourceCard(ctx, item)).join('')
    : `<div class="card">${emptyState({
      img: 'empty-search.svg',
      title: hasActiveFilters ? '没有找到相关资料' : '还没有可展示的资料',
      text: hasActiveFilters
        ? '换个关键词或调整筛选条件，再试一次。'
        : '可以发布一份资料，或去课友圈提问。',
      actions: `<div class="row wrap center-row">${hasActiveFilters
        ? `<a class="btn btn-ghost btn-sm" href="${href('/resources')}">清除筛选</a>`
        : `<a class="btn btn-sm" href="${href('/publish/resource')}">分享资料</a>`}
        <a class="btn btn-ghost btn-sm" href="${href('/find-circles')}">去课友圈问问</a></div>`
    })}</div>`;

  const selectField = (id, name, label, allLabel, options, selected) => `
    <div class="filter-group">
      <label class="label" for="${id}">${label}</label>
      <select class="select" id="${id}" name="${name}" data-autosubmit>
        <option value="">${allLabel}</option>
        ${options.map((value) => `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}
      </select>
    </div>`;

  return `
  <div class="container">
    <div class="res-layout">
      <section class="card res-search res-head">
        <h1>${filters.q ? `搜索：${esc(filters.q)}` : '全部资料'}</h1>
        <form class="search-bar" data-form="filter" role="search">
          <div class="input-wrap">
            ${icon('search', 'i-sm')}
            <label class="visually-hidden" for="res-q2">搜索资料</label>
            <input id="res-q2" name="q" type="search" value="${esc(filters.q)}" placeholder="搜课程、章节或标题">
          </div>
          ${['school', 'courseId', 'term', 'type', 'tag'].map((key) => (filters[key]
            ? `<input type="hidden" name="${key}" value="${esc(filters[key])}">` : '')).join('')}
          <button class="btn" type="submit">搜索</button>
        </form>
        <div class="res-toolbar">
          <div class="chips">${sortChips}</div>
          <span class="grow"></span>
          <span class="tiny muted">共 ${result.total} 条结果</span>
          <button class="chip chip-sm res-filter-toggle ${filtersOpen ? 'is-active' : ''}" type="button"
            data-action="toggle-filters" aria-expanded="${filtersOpen}" aria-controls="res-filters">
            筛选${activeFilters.length ? ` · ${activeFilters.length}` : ''}
          </button>
        </div>
        ${activeFilters.length ? `<div class="active-filters">
          ${activeFilters.map((item) => `<a class="chip chip-sm is-active" href="${withQuery(route, { [item.key]: '' })}"
            aria-label="取消筛选：${esc(item.label)}">${esc(item.label)}<span aria-hidden="true">×</span></a>`).join('')}
          <a class="tiny link" href="${href('/resources', { q: filters.q })}">全部清除</a>
        </div>` : ''}
      </section>

      <aside class="rail rail-sticky resource-filter-rail ${filtersOpen ? 'is-open' : ''}" id="res-filters" aria-label="筛选条件">
        <form data-form="filter" class="card card-tight">
          <div class="card-title">筛选资料</div>
          <input type="hidden" name="q" value="${esc(filters.q)}">
          <input type="hidden" name="sort" value="${esc(filters.sort)}">
          ${schoolOptions.length > 1
            ? selectField('f-school', 'school', '学校', '全部学校', schoolOptions, filters.school)
            : filters.school ? `<input type="hidden" name="school" value="${esc(filters.school)}">` : ''}
          <div class="filter-group">
            <label class="label" for="f-course">课程</label>
            <select class="select" id="f-course" name="courseId" data-autosubmit>
              <option value="">全部课程</option>
              ${filterCourses.map((c) => `<option value="${esc(c.id)}" data-school="${esc(filterOptions.courseSchools[c.id] || c.school)}" ${filters.courseId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
            ${filterCourses.length > 80 ? '<p class="field-help">课程较多：用上方搜索框直接搜课程名或别名。</p>' : ''}
          </div>
          <details class="filter-advanced" ${advancedFilterCount ? 'open' : ''}>
            <summary>更多筛选${advancedFilterCount ? `（${advancedFilterCount} 项）` : ''}</summary>
            ${selectField('f-term', 'term', '适用学期', '全部学期', terms, filters.term)}
            ${selectField('f-type', 'type', '资料类型', '全部类型', types, filters.type)}
            ${tags.length ? selectField('f-tag', 'tag', '知识标签', '全部标签', tags, filters.tag) : ''}
          </details>
        </form>
      </aside>

      <main class="res-results">
        ${recognition}
        ${results}
        ${courseOnlyHtml}
        ${result.items.length ? `<p class="res-tail">没找到合适的？<a class="link" href="${href('/find-circles')}">去课程圈问问 →</a></p>` : ''}
      </main>
    </div>
  </div>`;
}

/* ---------- 资料详情 ---------- */

export function resourceDetail(ctx) {
  const { db, me, route } = ctx;
  const resource = S.resourceOf(db, route.params.id);
  if (!resource) {
    return `<div class="layout-1">${emptyState({
      img: 'removed.svg',
      title: '这份资料不存在或已被移除',
      text: '可能作者删除了原帖，或链接有误。',
      actions: `<a class="btn btn-sm" href="${href('/resources')}">回到找资料</a>`
    })}</div>`;
  }

  const post = S.postOf(db, resource.postId);
  const eligible = S.resourceEligibility(db, resource);
  const course = S.courseOf(db, resource.courseId);
  const author = post ? S.userOf(db, post.authorId) : null;
  const circle = post && post.circleId ? S.circleOf(db, post.circleId) : null;
  const files = S.resourceFiles(db, resource);

  ctx.once(`resource:${resource.id}`, () => {
    ctx.invoke('recordEvent', { type: 'resource_landing_view', meta: { resourceId: resource.id } }, { quiet: true });
  });

  if (!eligible.ok) {
    const reason = eligible.code === 'index_off'
      ? '作者已取消这份资料的公开索引，原帖与讨论仍按帖子自身的公开规则保留。'
      : eligible.code === 'post_hidden'
        ? '原帖当前不可见（可能已删除或被临时隐藏），资料已停止提供预览与下载。'
        : eligible.code === 'no_file'
          ? '可用附件已撤回，资料已退出检索。'
          : '资料元信息不完整，暂时没有进入公开索引。';
    return `<div class="layout-1">
      <div class="card">
        <h1>${esc(resource.title)}</h1>
        ${notice(reason, 'warn', 'lock')}
        <div class="row mt-4 wrap">
          ${post && post.status === 'published'
            ? `<a class="btn btn-sm" href="${href(`/posts/${post.id}`)}">查看原帖</a>` : ''}
          <a class="btn btn-ghost btn-sm" href="${href('/resources')}">回到找资料</a>
        </div>
      </div>
    </div>`;
  }

  const tree = S.commentTree(db, post.id);
  const previews = resource.previews || [];
  const joined = me && circle ? S.isActiveMember(db, me.id, circle.id) : false;
  const saves = S.reactionCount(db, post.id, 'save');
  const saved = !!me && !!S.reactionOf(db, me.id, post.id, 'save');
  const nextPath = `/resources/${resource.id}`;
  const downloadLabel = me ? '下载' : '登录后下载';

  const downloadButton = (file, label, cls = 'btn') => `
    <button class="${cls}" type="button" data-action="download" data-next="${esc(nextPath)}"
      data-post="${esc(post.id)}" data-attachment="${esc(file.id)}">
      ${icon('download', 'i-sm')}${esc(label)}
    </button>`;

  const fileRows = files.map((file) => `
    <div class="file-row">
      <img src="assets/art/file-pdf.svg" alt="PDF">
      <div class="grow">
        <div class="file-name">${esc(file.name)}</div>
        <div class="tiny muted">PDF · ${file.pages ? `${file.pages} 页 · ` : ''}${formatBytes(file.sizeBytes)} · v${file.version} ${statusPill(file)}</div>
      </div>
      ${files.length > 1 ? `<div class="file-actions">${downloadButton(file, downloadLabel, 'btn btn-ghost btn-sm')}</div>` : ''}
    </div>`).join('');

  const previewHtml = previews.length
    ? `<div class="preview-frame">
        ${previews.map((src, index) => `<figure class="preview-page">
          <button class="preview-open" type="button" data-action="preview-image" data-src="${esc(mediaUrl(src))}"
            aria-label="放大查看第 ${index + 1} 页">
            <img src="${esc(mediaUrl(src))}" alt="资料预览第 ${index + 1} 页">
          </button>
          <figcaption>第 ${index + 1} 页</figcaption>
        </figure>`).join('')}
      </div>
      <p class="preview-note">前两页由作者确认公开，点击可放大。</p>`
    : `<div class="notice notice-warn">${icon('image', 'i-sm')}
        <span>这份资料暂时没有预览图，下载后可查看完整内容。</span>
      </div>`;

  return `
  <div class="container">
    <div class="layout-2">
      <main>
        <nav class="crumbs" aria-label="面包屑">
          <a href="${href('/resources')}">找资料</a><span>/</span>
          ${course
            ? `<a href="${href('/resources', { courseId: resource.courseId })}">${esc(course.name)}</a>`
            : '<span class="muted">课程待补充</span>'}
          <span>/</span><span>${esc(resource.type)}</span>
        </nav>

        <article class="card mt-4 res-detail">
          <div class="res-tag-row">
            ${course
              ? `<a class="res-course-tag" href="${href(`/courses/${course.id}`)}">${esc(course.name)}</a>`
              : '<span class="res-course-tag is-missing">课程待补充</span>'}
            <span class="res-type-tag">${esc(resource.type)}</span>
          </div>
          <h1>${esc(resource.title)}</h1>

          ${!resource.courseId && me && author && me.id === author.id ? `
            <div class="notice notice-warn mt-3"><span>这份资料还没有课程 Tag，读者会看到「课程待补充」。补选主课程后才会按课程参与搜索排序。</span></div>
            <form data-form="resource-course" data-resource="${esc(resource.id)}" class="row wrap mt-2">
              <select class="select" name="courseId" required style="max-width:320px">
                <option value="">请选择主课程</option>
                ${(db.courses || []).filter((c) => c.id !== 'c_general').map((c) => `<option value="${esc(c.id)}">${esc(c.name)}（${esc(c.school)}）</option>`).join('')}
              </select>
              <button class="btn btn-sm" type="submit">补上主课程</button>
            </form>` : ''}

          ${author ? authorLine(ctx, author, `更新于 ${timeAgo(resource.updatedAt)}`, {
            showLevel: true,
            meta: `<span>${esc(S.termLabel(resource.term))}</span><span class="dot-sep">·</span><span>${esc(resource.school)}</span>`
          }) : ''}

          <div class="res-actionbar">
            ${files.length === 1
              ? downloadButton(files[0], me ? '下载 PDF' : '登录后下载')
              : `<button class="btn" type="button" data-action="scroll-to" data-target="res-files">${icon('download', 'i-sm')}选择文件下载</button>`}
            <button class="btn btn-ghost" type="button" data-action="toggle-save" data-post="${esc(post.id)}"
              data-next="${esc(nextPath)}" aria-pressed="${saved}">
              ${icon('star', 'i-sm')}${saved ? '已收藏' : '收藏'}${saves ? ` ${saves}` : ''}
            </button>
            <button class="btn btn-ghost" type="button" data-action="share" data-kind="content" data-path="${esc(nextPath)}">
              ${icon('share', 'i-sm')}分享
            </button>
            <span class="grow"></span>
            <button class="act" type="button" data-action="goto-comments">${icon('comment')}<span>讨论</span>${tree.total ? `<span class="act-count">${tree.total}</span>` : ''}</button>
          </div>

          <div class="res-scope">
            <div>
              <div class="section-title">适用范围</div>
              <p class="small">${esc(resource.coverage || '作者未填写作范围')}</p>
            </div>
            <div>
              <div class="section-title">尚未覆盖</div>
              <p class="small secondary">${esc(resource.limitations || '作者未说明未覆盖内容')}</p>
            </div>
          </div>

          <div class="section-title mt-4" id="res-files">文件</div>
          ${fileRows}
          <p class="tiny muted mt-2">登录后即可下载，不需要加入课友圈，也不消耗页签。</p>

          <div class="section-title mt-6">前两页预览</div>
          ${previewHtml}
        </article>

        <section class="card" id="comments">
          <div class="card-title">资料讨论 · ${tree.total}</div>
          <p class="small secondary mb-3">发现错误或想补充，登录后就能在这里说，不需要加入课友圈。</p>
          ${commentList(ctx, post, tree)}
          ${commentForm(ctx, post)}
        </section>
      </main>

      <aside class="rail">
        ${circle ? `<section class="card">
          <div class="card-title">也在上这门课？</div>
          <p class="small secondary">加入「${esc(S.circleShort(db, circle))}」课程圈，和同课程的同学一起讨论。不加入也能继续使用资料。</p>
          ${circle.status === 'archived'
            ? `<div class="notice notice-warn mt-3">${icon('lock', 'i-sm')}<span>这个圈已归档，只能阅读历史内容。</span></div>`
            : joined
              ? `<a class="btn btn-ghost btn-sm btn-block mt-3" href="${href(`/circles/${circle.id}`)}">已加入 · 进入课友圈</a>`
              : `<a class="btn btn-sm btn-block mt-3" href="${href(`/circles/${circle.id}`)}">看看这个课友圈</a>`}
        </section>` : `<section class="card">
          <div class="card-title">作者独立分享</div>
          <p class="small secondary">这份资料没有挂在课友圈上，但仍可以在下方公开讨论。</p>
        </section>`}

        <section class="card">
          <div class="card-title">相关入口</div>
          <div class="rail-links">
            <a class="link small" href="${href(`/posts/${post.id}`)}">原帖讨论 · ${S.commentCount(db, post.id)} 条</a>
            ${course ? `<a class="link small" href="${href(`/courses/${resource.courseId}`)}">${esc(course.name)} 课程页</a>
            <a class="link small" href="${href('/resources', { courseId: resource.courseId })}">同课程其他资料</a>` : ''}
          </div>
        </section>
      </aside>
    </div>
  </div>`;
}

/* ---------- 资料发布 ---------- */

export function resourcePublish(ctx) {
  const { db, me, ui } = ctx;
  if (!me) {
    return `<div class="layout-1">
      <div class="card">
        <h1>分享资料</h1>
        ${notice('发布资料需要先登录并验证邮箱。登录后会回到这里，不会自动提交或扣签。', 'warn', 'lock')}
        <a class="btn mt-4" href="${href('/login', { next: '/publish/resource' })}">登录 / 注册</a>
      </div>
    </div>`;
  }

  const myCircles = S.myCircles(db, me.id).filter(({ circle }) => circle.status === 'active');
  const files = ui.files || [];
  const courseList = (db.courses || [])
    .filter((c) => c.id !== 'c_general')
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  // 从课程页上传时预填课程；有草稿时先把草稿读回来（草稿允许没有课程）
  const draft = (db.drafts && db.drafts[me.id]) || null;
  const draftResource = (draft && draft.resource) || {};
  const params = ctx.route.query || {};
  const prefillCourseId = params.courseId || params.course || '';
  const initialCourseId = prefillCourseId || draftResource.courseId || '';
  const initial = {
    title: draftResource.title || '',
    school: draftResource.school || '',
    term: draftResource.term || TERMS[0],
    type: draftResource.type || RESOURCE_TYPES[0],
    coverage: draftResource.coverage || '',
    limitations: draftResource.limitations || '',
    postTitle: (draft && draft.postTitle) || '',
    body: (draft && draft.body) || ''
  };
  const initialCourseName = (S.courseOf(db, initialCourseId) || {}).name || '';

  return `
  <div class="layout-1 publish-layout">
    ${publishSwitch('resource')}
    <div class="card">
      <h1>分享资料</h1>
      <p class="secondary small mt-2">不必先加入课友圈。资料会关联一篇可讨论的分享帖。</p>
      ${draft ? `<p class="field-help">已读取 ${esc(timeAgo(draft.updatedAt))} 保存的草稿，可以继续修改。</p>` : ''}

      <form data-form="resource" class="mt-4" novalidate>
        <fieldset class="form-section">
          <legend>资料信息</legend>
          <div class="field">
            <label for="res-title">资料标题 <span class="label-hint">必填，写清主题</span></label>
            <input class="input" id="res-title" name="resTitle" maxlength="80" required value="${esc(initial.title)}"
              placeholder="例如：数列极限与函数连续 · 期中复习笔记">
          </div>

          <div class="form-row">
            <div class="field">
              <label for="res-course">主课程 <span class="required-mark">*</span></label>
              <select class="select" id="res-course" name="resourceCourse" required aria-describedby="res-course-error">
                <option value="">请选择课程（必填）</option>
                ${courseList.map((c) => `<option value="${esc(c.id)}" ${initialCourseId === c.id ? 'selected' : ''}>${esc(c.name)}（${esc(c.school)}）</option>`).join('')}
              </select>
              <p class="field-error" id="res-course-error" data-field-error="resourceCourse" hidden>请选择这份资料对应的课程。</p>
              ${prefillCourseId ? `<p class="field-help">已从课程页预填「${esc(initialCourseName)}」，发布前仍可修改。</p>` : draftResource.courseId ? `<p class="field-help">已从草稿带出「${esc(initialCourseName)}」。</p>` : ''}
              <p class="field-help">没有你的课程？<button class="text-button" type="button" data-action="apply-course">申请补充课程</button></p>
            </div>
            <div class="field">
              <label for="res-type">资料类型</label>
              <select class="select" id="res-type" name="type" required>
                ${RESOURCE_TYPES.map((t) => `<option value="${esc(t)}" ${initial.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="field">
              <label for="res-school">学校</label>
              <select class="select" id="res-school" name="school" required>
                ${SCHOOLS.map((s) => `<option value="${esc(s)}" ${(initial.school || SCHOOLS[0]) === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="res-term">适用学期</label>
              <select class="select" id="res-term" name="term" required>
                ${TERMS.map((t) => `<option value="${esc(t)}" ${initial.term === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="field">
            <label for="res-coverage">适用范围 <span class="label-hint">必填，覆盖哪些内容</span></label>
            <textarea class="textarea textarea-sm" id="res-coverage" name="coverage" rows="3" required
              placeholder="告诉同学这份整理覆盖哪些章节、适合什么用途。">${esc(initial.coverage)}</textarea>
          </div>

          <div class="field">
            <label for="res-limitations">尚未覆盖的内容 <span class="label-hint">建议填写，避免误解</span></label>
            <textarea class="textarea textarea-sm" id="res-limitations" name="limitations" rows="2"
              placeholder="例如：不含导数与中值定理；后半部分还是草稿。">${esc(initial.limitations)}</textarea>
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>PDF 文件 <span class="label-hint">1–3 个</span></legend>
          ${pdfPicker(ctx, files, { emptyHint: '还没有添加附件，至少需要 1 个 PDF。' })}
        </fieldset>

        <fieldset class="form-section">
          <legend>作者说明</legend>
          <div class="field">
            <label for="post-body">说明 <span class="label-hint">必填，支持基础 Markdown</span></label>
            <textarea class="textarea" id="post-body" name="body" rows="5" required
              data-count-for="res-body" data-max="20000"
              placeholder="为什么整理这份资料？哪些地方还想请同学帮忙看？">${esc(initial.body)}</textarea>
            <div class="counter"><span data-counter="res-body">0</span> / 20000</div>
          </div>
          <div class="field">
            <label for="post-title">分享帖标题 <span class="label-hint">选填，最多 60 字</span></label>
            <input class="input" id="post-title" name="postTitle" maxlength="60" value="${esc(initial.postTitle)}" placeholder="不填时用资料标题">
          </div>
          <div class="form-row">
            <div class="field">
              <label for="res-circle">同时分享到课友圈 <span class="label-hint">可选</span></label>
              <select class="select" id="res-circle" name="circleId">
                <option value="">不分享到圈子（独立资料）</option>
                ${myCircles.map(({ circle }) => `<option value="${esc(circle.id)}">${esc(S.circleLabel(db, circle))}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="res-tags">知识标签 <span class="label-hint">最多 3 个，用逗号分隔</span></label>
              <input class="input" id="res-tags" name="tags" placeholder="例如：数列极限，连续性">
            </div>
          </div>
        </fieldset>

        <div class="confirm-group">
          <label class="checkbox">
            <input type="checkbox" name="confirmIndex" required>
            <span>公开这份资料的信息与前两页预览，并收录到找资料。</span>
          </label>
          <label class="checkbox mt-2">
            <input type="checkbox" name="original" required>
            <span>这不是整本商业教材的扫描件，不含他人隐私，我有权分享。</span>
          </label>
        </div>

        <div class="row mt-4 wrap form-submit">
          <span class="grow"></span>
          <button class="btn btn-ghost" type="button" data-action="save-resource-draft">保存草稿</button>
          <button class="btn" type="submit">${icon('upload', 'i-sm')}发布资料</button>
        </div>
      </form>
    </div>
  </div>`;
}
