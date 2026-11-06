/* 找资料：首页、搜索结果、资料详情、资料发布 */

import { href } from '../router.js';
import * as S from '../state/selectors.js';
import { DEMO_SAMPLE_FILES } from '../state/actions.js';
import {
  resourceCard, emptyState, notice, signCard, bookmarkBoardCard, icon, avatar, authorLine,
  attachmentRow, commentList, commentForm, statusPill, pdfUploadField, sourceRightsFields
} from '../components/ui.js';
import { renderMarkdown } from '../lib/markdown.js';
import { esc, truncate, formatBytes, timeAgo, boardOf, RESOURCE_TYPES, SCHOOLS, TERMS } from '../lib/format.js';

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
  const courses = (db.courses || []).filter((c) => c.id !== 'c_general').slice(0, 5);

  /* 最新讨论：不带附件的帖子（求助 / 讨论 / 学习方法）不会进"资料"列表，
   * 以前只能在搜索结果或作者主页看到，别人根本刷不到 —— 首页补一块。 */
  const resourcePostIds = new Set((db.resources || []).map((r) => r.postId));
  const latestDiscuss = S.feedPosts(db, { limit: 40 })
    .items.filter((post) => !resourcePostIds.has(post.id))
    .slice(0, 5);

  const typeChips = ['', ...RESOURCE_TYPES].map((type) => {
    const label = type || '全部类型';
    return `<a class="chip ${filters.type === type ? 'is-active' : ''}"
      href="${href('/resources', { q: filters.q, type, sort: filters.sort })}">${esc(label)}</a>`;
  }).join('');

  const list = shown.length
    ? shown.map((item) => resourceCard(ctx, item)).join('')
    : emptyState({
      img: 'empty-search.svg',
      mascot: true,
      title: '这里还没有匹配的资料',
      text: '可以换个关键词，或者清除筛选看看最近上新的整理。',
      actions: `<a class="btn btn-ghost btn-sm" href="${href('/resources')}">清除筛选</a>
        
        <a class="btn btn-sm" href="${href('/find-circles')}">去课友圈问问</a>`
    });

  return `
  <div class="container">
    <div class="layout-3">
      <aside class="rail rail-sticky" aria-label="资料筛选">
        
        <div class="rail-group">
        
          <div class="rail-title">资料类型</div>
        
          ${['', ...RESOURCE_TYPES].map((type) => `
        
            <a class="rail-link" href="${href('/resources', { q: filters.q, type })}"
        
              ${filters.type === type ? 'aria-current="page"' : ''}>${esc(type || '全部资料')}</a>`).join('')}
        
        </div>
        
        <div class="rail-sep"></div>
        
        <div class="rail-group">
        
          <div class="rail-title">按课程</div>
        
          ${courses.map((course) => `
        
            <a class="rail-link" href="${href('/resources', { courseId: course.id })}">
        
              ${esc(course.name)}<small>${esc(course.school)}</small>
        
            </a>`).join('')}
        
        </div>
        
        <div class="rail-sep"></div>
        
        <a class="rail-link" href="${href('/resources')}">${icon('refresh')}重置筛选</a>
      </aside>

      <main>
        
        <section class="card res-search">
        
          <h1>找资料</h1>
        
          <p>按课程找到笔记、题解与复习整理。先看适用范围与预览；下载需要登录，不要求加入课友圈。</p>
        
          <form class="search-bar" data-form="filter" role="search">
        
            <div class="input-wrap">
        
              ${icon('search', 'i-sm')}
        
              <label class="visually-hidden" for="res-q">搜索资料</label>
        
              <input id="res-q" name="q" type="search" value="${esc(filters.q)}"
        
                
        placeholder="搜本页资料：课程、章节或标题">
        
            </div>
        
            ${filters.type ? `<input type="hidden" name="type" value="${esc(filters.type)}">` : ''}
        
            ${filters.sort ? `<input type="hidden" name="sort" value="${esc(filters.sort)}">` : ''}
        
            <button class="btn" type="submit">搜索</button>
        
          </form>
        
          <div class="chips mt-3">
        
            ${courses.map((course) => `<a class="chip chip-sm" href="${href('/resources', { courseId: course.id })}">${esc(course.name)}</a>`).join('')}
        
          </div>
        
          <p class="tiny muted mt-3">按课程与用途挑一份，先看适用范围和前两页预览。</p>
        
        </section>

        
        <div class="mobile-bookmark">${signCard(ctx)}</div>

        ${latestDiscuss.length ? `<section class="card mt-4" aria-label="最新讨论">

          <div class="toolbar">

            <div class="section-title">最新讨论</div>

            <span class="grow"></span>

            <a class="tiny link" href="${href('/search')}">看全部讨论 →</a>

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

          <p class="tiny muted mt-2">求助、踩坑、学习心得都在这儿；刚发的排最前。</p>

        </section>` : ''}

        <div class="toolbar">
        
          <div class="chips">${typeChips}</div>
        
          <span class="grow"></span>
        
          <a class="tiny link" href="${href('/resources', { q: filters.q })}">全部结果 →</a>
        
        </div>

        
        ${list}

        
        ${shown.length ? `<div class="card center">
        
          <a class="link" href="${href('/resources', { q: filters.q })}">查看全部 ${result.total} 份资料</a>
        
        </div>` : ''}
      </main>

      <aside class="rail rail-sticky">
        
        <section class="card brand-card">
        
          <img src="assets/mascot/duo.png" alt="共共和页页" width="140" height="140">
        
          <p class="small">把资料整理清楚，也把同班的人找到。</p>
        
          <a class="link small" href="${href('/find-circles')}">找课程圈</a>
        
        </section>
        
        ${signCard(ctx)}
        ${bookmarkBoardCard(ctx)}
      </aside>
    </div>
  </div>`;
}

/* ---------- 搜索结果 ---------- */

export function resourceSearch(ctx) {
  const { db, route } = ctx;
  const filters = filterValues(route);
  const result = S.searchResources(db, filters);
  const courses = (db.courses || []).filter((c) => c.id !== 'c_general');
  const filterCourses = filters.courseId
    ? courses.filter((c) => c.id === filters.courseId)
    : courses.slice(0, 80);
  const tags = S.resourceTags(db);
  const terms = Array.from(new Set([...TERMS.slice(0, 3), ...S.resourceTerms(db)]));

  const sortChips = SORTS.map((sort) => {
    if (sort.key === 'relevance' && !filters.q) return '';
    return `<a class="chip ${result.mode === sort.key ? 'is-active' : ''}"
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
    : emptyState({
      img: 'empty-search.svg',
      mascot: true,
      title: '没有找到相关讨论或资料',
      text: '换个关键词，或者只按课程名与学期筛选；也可以清除筛选看看全部。',
      actions: `<a class="btn btn-ghost btn-sm" href="${href('/resources', { q: filters.q })}">清除筛选</a>
        
        <a class="btn btn-sm" href="${href('/find-circles')}">去课友圈问问</a>`
    });

  return `
  <div class="container">
    <div class="layout-3">
      <aside class="rail rail-sticky" aria-label="筛选条件">
        
        <form data-form="filter" class="card card-tight">
        
          <div class="card-title">筛选资料</div>
        
          <input type="hidden" name="q" value="${esc(filters.q)}">
        
          <input type="hidden" name="sort" value="${esc(filters.sort)}">
        
          <div class="filter-group">
        
            <label class="label" for="f-school">学校</label>
        
            <select class="select" id="f-school" name="school" data-autosubmit>
        
              <option value="">全部学校</option>
        
              ${SCHOOLS.map((s) => `<option value="${esc(s)}" ${filters.school === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
        
            </select>
        
          </div>
        
          <div class="filter-group">
        
            <label class="label" for="f-course">课程</label>
        
            <select class="select" id="f-course" name="courseId" data-autosubmit>
        
              <option value="">全部课程</option>
        
              ${filterCourses.map((c) => `<option value="${esc(c.id)}" ${filters.courseId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        
            </select>
            <p class="field-help">课程较多：用上方搜索框直接搜课程名或别名。</p>
        
          </div>
        
          <div class="filter-group">
        
            <label class="label" for="f-term">适用学期</label>
        
            <select class="select" id="f-term" name="term" data-autosubmit>
        
              <option value="">全部学期</option>
        
              ${terms.map((t) => `<option value="${esc(t)}" ${filters.term === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        
            </select>
        
          </div>
        
          <div class="filter-group">
        
            <label class="label" for="f-type">资料类型</label>
        
            <select class="select" id="f-type" name="type" data-autosubmit>
        
              <option value="">全部类型</option>
        
              ${RESOURCE_TYPES.map((t) => `<option value="${esc(t)}" ${filters.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        
            </select>
        
          </div>
        
          ${tags.length ? `<div class="filter-group">
        
            <label class="label" for="f-tag">知识标签</label>
        
            <select class="select" id="f-tag" name="tag" data-autosubmit>
        
              <option value="">全部标签</option>
        
              ${tags.map((t) => `<option value="${esc(t)}" ${filters.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        
            </select>
        
          </div>` : ''}
        
          <a class="link small" href="${href('/resources')}">清除全部筛选</a>
        
        </form>
      </aside>

      <main>
        
        <section class="card res-search">
        
          <h1 class="mb-2">${filters.q ? `搜索：${esc(filters.q)}` : '全部资料'}</h1>
        
          <form class="search-bar" data-form="filter" role="search">
        
            <div class="input-wrap">
        
              ${icon('search', 'i-sm')}
        
              <label class="visually-hidden" for="res-q2">搜索资料</label>
        
              <input id="res-q2" name="q" type="search" value="${esc(filters.q)}" placeholder="搜本页资料：课程、章节或标题">
        
            </div>
        
            <button class="btn" type="submit">搜索</button>
        
          </form>
        
          <div class="toolbar mt-3">
        
            <div class="chips">${sortChips}</div>
        
            <span class="grow"></span>
        
            <span class="tiny muted">共 ${result.total} 条结果</span>
        
          </div>
        
          <p class="tiny muted">仅展示已公开收录、有可用 PDF 的资料；同一份资料只出现一次。</p>
        
        </section>
        ${recognition}
        ${results}
        ${courseOnlyHtml}
      </main>

      <aside class="rail rail-sticky">
        
        <section class="card">
        
          <div class="card-title">找不到合适的？</div>
        
          <p class="small secondary">试试去掉学期限制，或者换成章节名。也可以去对应课程的课友圈直接问。</p>
        
          <a class="link small" href="${href('/find-circles')}">看看课程圈 →</a>
        
        </section>
        
        ${signCard(ctx)}
      </aside>
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
    ctx.invoke('recordEvent', { type: 'resource_landing_view', meta: { resourceId: resource.id } });
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
  const previews = ctx.config?.mode === 'production'
    ? (resource.previews || []).filter((path) => /^\/api\/files\/[A-Za-z0-9_-]+\/preview\/[1-9]\d*$/.test(path))
    : resource.previews || [];
  const otherCircles = S.suggestedCircles(db, resource).filter((x) => !circle || x.circle.id !== circle.id);
  const joined = me && circle ? S.isActiveMember(db, me.id, circle.id) : false;

  const fileRows = files.map((file) => `
    <div class="file-row">
      <img src="assets/art/file-pdf.svg" alt="PDF">
      <div class="grow">
        
        <div class="file-name">${esc(file.name)}</div>
        
        <div class="tiny muted">PDF · ${file.pages ? `${file.pages} 页 · ` : ''}${formatBytes(file.sizeBytes)} · v${file.version} ${statusPill(file)}</div>
      </div>
      <div class="file-actions">
        
        <button class="btn btn-sm" type="button" data-action="download"
        
          data-post="${esc(post.id)}" data-attachment="${esc(file.id)}">
        
          ${icon('download', 'i-sm')}${me ? '下载' : '登录后下载'}
        
        </button>
      </div>
    </div>`).join('');

  const previewHtml = previews.length
    ? `<div class="preview-frame">
        
        ${previews.map((src, index) => `<figure class="preview-page">
        
          <img src="${esc(src)}" alt="资料预览第 ${index + 1} 页">
        
          <figcaption>第 ${index + 1} 页</figcaption>
        
        </figure>`).join('')}
      </div>
      <p class="preview-note">作者在发布时确认公开的前两页预览。游客也能看到这部分内容。</p>`
    : `<div class="notice notice-warn">${icon('image', 'i-sm')}
        
        <span>${ctx.config?.mode === 'production'
          ? '预览仍在处理中或暂不可用。这里只展示服务器提供的受控 PNG 预览，不会用示例图片替代真实资料。'
          : '静态演示版没有 PDF 渲染服务，这份资料的首页预览无法生成。真实实现中由服务端生成前两页预览。'}</span>
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

        
        <article class="card mt-4">
        
          <div class="row wrap" style="gap:8px">
        
            ${course
              ? `<a class="res-course-tag" href="${href(`/courses/${course.id}`)}">${esc(course.name)}</a>`
              : '<span class="res-course-tag is-missing">课程待补充</span>'}
            
            <span class="res-type">${esc(resource.type)}</span>
        
            <span class="tiny muted">适用学期：${esc(S.termLabel(resource.term))}</span>
        
          </div>
        
          <h1 class="mt-2">${esc(resource.title)}</h1>
        
          ${!resource.courseId && me && author && me.id === author.id ? `
            <div class="notice notice-warn mt-3"><span>这份资料还没有课程 Tag，读者会看到「课程待补充」。补选主课程后才会按课程参与搜索排序。</span></div>
            <form data-form="resource-course" data-resource="${esc(resource.id)}" class="row wrap mt-2">
              <select class="select" name="courseId" required style="max-width:320px">
                <option value="">请选择主课程</option>
                ${(db.courses || []).filter((c) => c.id !== 'c_general').map((c) => `<option value="${esc(c.id)}">${esc(c.name)}（${esc(c.school)}）</option>`).join('')}
              </select>
              <button class="btn btn-sm" type="submit">补上主课程</button>
            </form>` : ''}
        
          <div class="res-meta">
        
            <span>${esc(resource.school)}</span><span class="dot-sep">·</span>
        
            <span><a class="link" href="${href(`/courses/${resource.courseId}`)}">${esc(course ? course.name : '未知课程')}</a></span>
        
            <span class="dot-sep">·</span>
        
            <span>${esc(S.termLabel(resource.term))}</span>
        
            <span class="dot-sep">·</span>
        
            <span>更新于 ${esc(timeAgo(resource.updatedAt))}</span>
        
          </div>

        
          ${author ? authorLine(ctx, author, `分享于 ${timeAgo(post.publishedAt)}`, {
        
            showLevel: true,
        
            right: `<a class="chip chip-sm" href="${href(`/u/${author.id}`)}">作者主页</a>`
        
          }) : ''}

        
          <div class="stack-12 mt-4">
        
            <div>
        
              <div class="section-title">适用范围</div>
        
              <p class="small">${esc(resource.coverage || '作者未填写作范围')}</p>
        
            </div>
        
            <div>
        
              <div class="section-title">尚未覆盖</div>
        
              <p class="small secondary">${esc(resource.limitations || '作者未说明未覆盖内容')}</p>
        
            </div>
        
          </div>

        
          <div class="section-title mt-4">真实文件</div>
        
          ${fileRows}
        
          <p class="tiny muted mt-3">下载只要求登录且邮箱已验证，不检查是否入圈、等级或页签。文件通过扫描后才提供下载。</p>

        
          <div class="section-title mt-6">前两页预览</div>
        
          ${previewHtml}
        
        </article>

        
        <section class="card" id="comments">
        
          <div class="card-title">资料讨论 · ${tree.total}</div>
        
          <p class="small secondary mb-3">非成员登录后也可以在这里指出问题；这不是加入课友圈。归档圈只读，禁言仍然生效。</p>
        
          ${commentList(ctx, post, tree)}
        
          ${commentForm(ctx, post)}
        
        </section>
      </main>

      <aside class="rail">
        
        ${circle ? `<section class="card">
        
          <div class="card-title">也在上这门课？</div>
        
          <p class="small">原帖来自：<a class="link" href="${href(`/circles/${circle.id}`)}">${esc(S.circleLabel(db, circle))}</a></p>
        
          <p class="tiny muted mt-2">这门课只有一个课程圈，加入就能和同课程的同学讨论；不加入也能继续使用资料。</p>
        
          ${circle.status === 'archived'
        
            ? `<div class="notice notice-warn mt-3">${icon('lock', 'i-sm')}<span>这个圈已归档，只能阅读历史内容。</span></div>`
        
            : joined
        
              ? `<a class="btn btn-ghost btn-sm btn-block mt-3" href="${href(`/circles/${circle.id}`)}">已加入 · 进入课友圈</a>`
        
              : `<button class="btn btn-sm btn-block mt-3" type="button" data-action="join-circle" data-circle="${esc(circle.id)}">看看这个课友圈</button>`}
        
          <small class="tiny muted" style="display:block;margin-top:8px">不加入也可以继续使用资料。</small>
        
        </section>` : `<section class="card">
        
          <div class="card-title">作者独立分享</div>
        
          <p class="small secondary">这份资料没有挂在任何课友圈上，但仍可以在原帖里公开讨论。</p>
        
          <a class="link small" href="${href(`/posts/${post.id}`)}">查看原帖 →</a>
        
        </section>`}

        
        ${otherCircles.length ? `<section class="card">
        
          <div class="card-title">同课程的其他圈</div>
        
          ${otherCircles.map(({ circle: item, members }) => `
        
            <div class="mb-3">
        
              <a class="small" href="${href(`/circles/${item.id}`)}">${esc(S.circleLabel(db, item))}</a>
        
              <div class="tiny muted">${members} 位成员 · ${item.status === 'archived' ? '已归档' : '进行中'}</div>
        
            </div>`).join('')}
        
        </section>` : ''}

        
        <section class="card">
        
          <div class="card-title">资源来源</div>
        
          <div class="stack">
        
            <a class="link small" href="${href(`/posts/${post.id}`)}">原帖讨论 · ${S.commentCount(db, post.id)} 条</a>
        
            <a class="link small" href="${href(`/courses/${resource.courseId}`)}">${esc(course ? course.name : '')} 课程页</a>
        
            <a class="link small" href="${href('/resources', { courseId: resource.courseId })}">同课程其他资料</a>
        
          </div>
        
        </section>

        
        ${signCard(ctx)}
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
  const production = ctx.config?.mode === 'production';
  const courseList = (db.courses || [])
    .filter((c) => c.id !== 'c_general')
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  // 示例附件只由 pdfUploadField 在本地演示模式展示。

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

  const uploadHtml = pdfUploadField(ctx, { required: true, samples: DEMO_SAMPLE_FILES });

  return `
  <div class="layout-1">
    <nav class="crumbs" aria-label="面包屑"><a href="${href('/resources')}">找资料</a><span>/</span><span>分享资料</span></nav>
    <div class="card mt-4">
      <h1>分享资料</h1>
      <p class="secondary small mt-2">不必先加入课友圈。资料会关联一篇可讨论的分享帖；同一份内容只维护一套附件与版本。</p>

      <form data-form="resource" class="mt-4" novalidate>
        
        <div class="field">
        
          <label for="res-title">资料标题 <span class="label-hint">必填，写清主题</span></label>
        
          <input class="input" id="res-title" name="resTitle" maxlength="80" required value="${esc(initial.title)}"
        
            placeholder="例如：数列极限与函数连续 · 期中复习笔记">
        
        </div>

        
        <div class="form-row">
        
          <div class="field">
        
            <label for="res-course">主课程 <span class="required-mark">*</span> <span class="label-hint">每份资料必须选一个课程</span></label>
        
            <select class="select" id="res-course" name="resourceCourse" required aria-describedby="res-course-error">
        
              <option value="">请选择课程（必填）</option>
        
              ${courseList.map((c) => `<option value="${esc(c.id)}" ${initialCourseId === c.id ? 'selected' : ''}>${esc(c.name)}（${esc(c.school)}）</option>`).join('')}
        
            </select>
          <p class="field-error" id="res-course-error" data-field-error="resourceCourse" hidden>请选择这份资料对应的课程。</p>
          ${prefillCourseId ? `<p class="field-help">已从课程页预填「${esc(initialCourseName)}」，发布前仍可修改。</p>` : draftResource.courseId ? `<p class="field-help">已从草稿带出「${esc(initialCourseName)}」。</p>` : ''}
        
          </div>
        
          <div class="field">
        
            <label for="res-type">资料类型</label>
        
            <select class="select" id="res-type" name="type" required>
        
              ${RESOURCE_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
        
            </select>
        
          </div>
        
        </div>

        
        <div class="form-row">
        
          <div class="field">
        
            <label for="res-school">学校</label>
        
            <select class="select" id="res-school" name="school" required>
        
              ${(production ? ['浙江大学'] : SCHOOLS).map((s) => `<option value="${esc(s)}" ${(initial.school || SCHOOLS[0]) === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
        
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
        
          <textarea class="textarea" id="res-coverage" name="coverage" rows="3" required
        
            placeholder="告诉同学这份整理覆盖哪些章节、适合什么用途。">${esc(initial.coverage)}</textarea>
        
        </div>

        
        <div class="field">
        
          <label for="res-limitations">尚未覆盖的内容 <span class="label-hint">建议填写，避免误解</span></label>
        
          <textarea class="textarea" id="res-limitations" name="limitations" rows="2"
        
            placeholder="例如：不含导数与中值定理；后半部分还是草稿。">${esc(initial.limitations)}</textarea>
        
        </div>

        
        ${sourceRightsFields({ source: draftResource.source, rights: draftResource.rights })}
        <label class="checkbox mb-3">
          <input type="checkbox" name="original" required>
          <span><b>文档来源</b>：我确认资料来源合法且有权分享，不含他人隐私或整本商业教材扫描件。请先勾选，再上传 PDF。</span>
        </label>
        ${uploadHtml}

        
        <hr>
        
        <div class="field">
        
          <label for="post-title">分享帖标题 <span class="label-hint">选填，最多 60 字</span></label>
        
          <input class="input" id="post-title" name="postTitle" maxlength="60" value="${esc(initial.postTitle)}" placeholder="给这篇整理起个名字">
        
        </div>
        
        <div class="field">
        
          <label for="post-body">作者说明 <span class="label-hint">必填，支持基础 Markdown</span></label>
        
          <textarea class="textarea" id="post-body" name="body" rows="6" required
        
            data-count-for="res-body" data-max="20000"
        
            placeholder="为什么整理这份资料？哪些地方还想请同学帮忙看？">${esc(initial.body)}</textarea>
        
          <div class="counter"><span data-counter="res-body">0</span> / 20000</div>
        
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

        
        <label class="checkbox">
        
          <input type="checkbox" name="confirmIndex" required>
        
          <span>我确认公开这份资料的元信息与前两页预览，并收录到找资料索引；我有权分享这份内容。</span>
        
        </label>
        
        <p class="field-help">发布前请再次核对上方来源与授权说明。</p>

        
        <div class="row mt-6 wrap">
        
          <a class="link small" href="${href('/publish')}">只想发讨论帖？进入普通发布 →</a>
        
          <span class="grow"></span>
        
          <button class="btn btn-ghost" type="button" data-action="save-resource-draft">保存草稿</button>
          <button class="btn btn-ghost" type="button" data-action="apply-course">申请补充课程</button>
          <button class="btn" type="submit" ${ui.uploading || ui.publishing ? 'disabled' : ''}>${icon('upload', 'i-sm')}${ui.uploading ? '附件检查中…' : ui.publishing ? '发布中…' : '发布资料'}</button>
        
        </div>
        ${draft ? `<p class="field-help">已读取 ${esc(timeAgo(draft.updatedAt))} 保存的草稿；正式发布前可以继续修改。</p>` : ''}
      </form>
    </div>
  </div>`;
}









