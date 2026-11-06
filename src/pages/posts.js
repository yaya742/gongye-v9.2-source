/* 帖子详情、发布、编辑 */

import { href } from '../router.js';
import * as S from '../state/selectors.js';
import {
  postCard, postActions, emptyState, notice, icon, avatar, authorLine,
  attachmentRow, commentList, commentForm, publishSwitch, pdfPicker
} from '../components/ui.js';
import { renderMarkdown } from '../lib/markdown.js';
import { stickerMarkup } from '../data/stickers.js';
import { esc, timeAgo, BOARDS, boardOf, mediaUrl, RESOURCE_TYPES, TERMS, SCHOOLS } from '../lib/format.js';

/* ---------- 详情 ---------- */

export function post(ctx) {
  const { db, me, route } = ctx;
  const post = S.postOf(db, route.params.id);
  if (!post) {
    return `<div class="layout-1">${emptyState({
      img: 'removed.svg',
      title: '这篇内容不存在或已移除',
      text: '可能作者删除了帖子，或链接有误。',
      actions: `<a class="btn btn-sm" href="${href('/circles')}">回到课友圈</a>`
    })}</div>`;
  }

  if (post.status !== 'published') {
    const reason = post.status === 'banned'
      ? '这篇内容已被管理员封禁，暂时不可见。作者可以联系管理员申诉。'
      : post.status === 'hidden'
        ? '这篇内容正在核查，暂时不可见。系统会记录处理原因，作者可申诉。'
        : post.status === 'removed'
          ? '这篇内容已被永久移除，附件停止提供。若之前有人送过页签，退款会显示在收支记录中。'
          : '这篇内容仍是草稿，只有作者可见。';
    return `<div class="layout-1"><div class="card">
      ${notice(reason, post.status === 'removed' ? 'danger' : 'warn', 'lock')}
      <div class="row mt-4 wrap">
        <a class="btn btn-ghost btn-sm" href="${href('/circles')}">回到课友圈</a>
        <a class="btn btn-ghost btn-sm" href="${href('/resources')}">去找资料</a>
      </div>
    </div></div>`;
  }

  const author = S.userOf(db, post.authorId);
  const circle = post.circleId ? S.circleOf(db, post.circleId) : null;
  const course = post.courseId ? S.courseOf(db, post.courseId) : null;
  const board = boardOf(post.board);
  const attachments = S.attachmentsOf(db, post.id);
  const resource = S.resourceForPost(db, post.id);
  const indexed = S.resourceEligibility(db, resource).ok;
  const tree = S.commentTree(db, post.id);
  const likes = S.reactionCount(db, post.id, 'like');
  const saves = S.reactionCount(db, post.id, 'save');
  const gifts = S.giftedQtyForPost(db, post.id);
  const liked = !!me && !!S.reactionOf(db, me.id, post.id, 'like');
  const saved = !!me && !!S.reactionOf(db, me.id, post.id, 'save');
  const isAuthor = !!me && me.id === post.authorId;
  const isAdmin = !!me && me.role === 'admin';
  const pinnedHere = !!circle && circle.pinnedPostId === post.id;
  const following = me && author && S.isFollowing(db, me.id, 'user', author.id);
  const joinedCircle = me && circle ? S.isActiveMember(db, me.id, circle.id) : false;

  const images = (post.images || []).map((src, index) => `
    <button type="button" class="photos-button" data-action="preview-image" data-src="${esc(mediaUrl(src))}"
      aria-label="放大查看第 ${index + 1} 张图片" style="border:0;background:none;padding:0">
      <img src="${esc(mediaUrl(src))}" alt="帖子配图 ${index + 1}" loading="lazy">
    </button>`).join('');

  const related = (db.posts || [])
    .filter((p) => p.id !== post.id && p.status === 'published' && p.courseId && p.courseId === post.courseId)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 3);

  return `
  <div class="container">
    <div class="layout-2">
      <main>
        <nav class="crumbs" aria-label="面包屑">
          <a href="${href('/circles')}">课友圈</a><span>/</span>
          ${circle ? `<a href="${href(`/circles/${circle.id}`)}">${esc(S.circleShort(db, circle))}</a><span>/</span>` : ''}
          <span>${esc(board.label)}</span>
        </nav>

        <article class="card mt-4 post-detail">
          ${authorLine(ctx, author, timeAgo(post.publishedAt), {
            showLevel: true,
            extra: `<span class="tag">${esc(board.label)}</span>`,
            right: postMenu({ post, circle, isAuthor, isAdmin, pinnedHere, authorMembership: circle && author ? S.membership(db, author.id, circle.id) : null, author })
          })}

          ${post.title ? `<h1 class="mt-3" style="font-size:22px">${esc(post.title)}</h1>` : ''}
          ${post.editedAt ? `<p class="tiny muted mt-2">编辑于 ${esc(timeAgo(post.editedAt))}</p>` : ''}

          <div class="post-body mt-3">${renderMarkdown(post.body)}</div>
          ${post.stickerId ? `<div class="sticker-wrap">${stickerMarkup(post.stickerId)}</div>` : ''}

          ${images ? `<div class="photos">${images}</div>` : ''}
          ${attachments.map((att) => attachmentRow(ctx, att)).join('')}

          <div class="post-tags">
            ${[
              course ? `<a class="tag-item" href="${href(`/courses/${course.id}`)}">${esc(course.name)}</a>` : '',
              ...(post.tags || []).map((t) => `<a class="tag-item" href="${href('/search', { q: t, tab: 'posts' })}">${esc(t)}</a>`),
              indexed ? `<a class="chip chip-sm" href="${href(`/resources/${resource.id}`)}">${icon('file', 'i-sm')}这份内容已收录到找资料</a>` : ''
            ].join('')}
          </div>

          ${postActions({
            post, liked, likes, saved, saves, gifts,
            comments: tree.total,
            commentControl: (inner) => `<button class="act" type="button" data-action="goto-comments">${inner}</button>`
          })}
        </article>

        <section class="card" id="comments">
          <div class="card-title">讨论 · ${tree.total}</div>
          ${tree.total ? '' : '<p class="small secondary mb-2">还没有人回复。写下你的理解，或者指出自己卡住的那一步。</p>'}
          ${commentList(ctx, post, tree)}
          ${commentForm(ctx, post)}
        </section>
      </main>

      <aside class="rail">
        ${author ? `<section class="card">
          <div class="row" style="gap:12px">
            ${avatar(author, 'avatar-lg')}
            <div class="grow">
              <div class="author-name"><a href="${href(`/u/${author.id}`)}">${esc(author.nickname)}</a></div>
              <div class="tiny muted">${esc(S.levelInfo(db, author.id).name)} · 发过 ${S.postsByAuthor(db, author.id).length} 篇</div>
            </div>
          </div>
          <p class="small secondary mt-3">${esc(author.bio || '还没有写简介。')}</p>
          ${isAuthor
            ? `<a class="btn btn-ghost btn-sm btn-block mt-3" href="${href('/me/settings')}">编辑我的资料</a>`
            : `<button class="btn btn-sm btn-block mt-3" type="button" data-action="follow-user" data-user="${esc(author.id)}">
                 ${following ? '已关注' : '关注作者'}
               </button>`}
        </section>` : ''}

        ${circle ? `<section class="card">
          <div class="card-title">来源课友圈</div>
          <a class="small" href="${href(`/circles/${circle.id}`)}">${esc(S.circleLabel(db, circle))}</a>
          <div class="tiny muted mt-2">${S.countMembers(db, circle.id)} 位成员 · ${circle.status === 'archived' ? '已归档' : '进行中'}</div>
          ${joinedCircle
            ? `<a class="btn btn-ghost btn-sm btn-block mt-3" href="${href(`/circles/${circle.id}`)}">进入课友圈</a>`
            : `<a class="btn btn-sm btn-block mt-3" href="${href(`/circles/${circle.id}`)}">看看这个圈</a>`}
        </section>` : ''}

        ${related.length ? `<section class="card">
          <div class="card-title">同课程的其他讨论</div>
          ${related.map((item) => `<div class="mb-3">
            <a class="small" href="${href(`/posts/${item.id}`)}">${esc(item.title || item.body.slice(0, 28))}</a>
            <div class="tiny muted">${esc(timeAgo(item.publishedAt))} · ${S.commentCount(db, item.id)} 条讨论</div>
          </div>`).join('')}
        </section>` : ''}
      </aside>
    </div>
  </div>`;
}

/** 帖子右上角：作者的编辑删除、管理员的置顶收进“更多”，其他人直接看到举报 */
function postMenu({ post, circle, isAuthor, isAdmin, pinnedHere, authorMembership, author }) {
  const canModerateAuthor = isAdmin && !isAuthor && circle && author && author.role !== 'admin'
    && authorMembership && authorMembership.status === 'active';
  const items = [
    isAuthor ? `<a href="${href(`/posts/${post.id}/edit`)}">编辑</a>` : '',
    isAdmin && circle && circle.status === 'active'
      ? `<button type="button" data-action="pin-post" data-circle="${esc(circle.id)}" data-post="${esc(post.id)}" data-value="${pinnedHere ? '0' : '1'}">${pinnedHere ? '取消置顶' : '置顶到课友圈'}</button>`
      : '',
    canModerateAuthor
      ? (S.isWriteRestricted(authorMembership)
        ? `<button type="button" data-action="admin-member-quick" data-act="unmute" data-circle="${esc(circle.id)}" data-user="${esc(author.id)}">解除作者在本圈的禁言</button>`
        : `<button type="button" data-action="admin-member" data-act="mute" data-circle="${esc(circle.id)}" data-user="${esc(author.id)}">在本圈禁言作者</button>`)
      : '',
    isAuthor ? `<button class="is-danger" type="button" data-action="delete-post" data-post="${esc(post.id)}">删除</button>` : ''
  ].filter(Boolean);
  const report = isAuthor ? '' : `<button class="act" type="button" data-action="open-report" data-target-type="post" data-target-id="${esc(post.id)}" aria-label="举报这篇帖子">${icon('flag', 'i-sm')}<span class="act-label">举报</span></button>`;
  const menu = items.length ? `<details class="more-menu">
      <summary class="icon-btn" aria-label="更多帖子操作">${icon('more')}</summary>
      <div class="more-menu-panel">${items.join('')}</div>
    </details>` : '';
  return `<div class="row post-menu">${report}${menu}</div>`;
}

/* ---------- 发布 ---------- */

export function compose(ctx) {
  const { db, me, route, ui } = ctx;
  if (!me) {
    return `<div class="layout-1"><div class="card">
      <h1>发一篇学习帖子</h1>
      ${notice('发布需要先登录并验证邮箱。问题、笔记、心得都可以从这里开始；登录后会回到这里，不会自动提交。', 'warn', 'lock')}
      <a class="btn mt-4" href="${href('/login', { next: '/publish' })}">登录 / 注册</a>
    </div></div>`;
  }

  ui.compose = ui.compose || { board: 'notes', preview: false };
  const draft = ui.composeDraft || null;
  const board = boardOf(ui.compose.board).key;
  const myCircles = S.myCircles(db, me.id).filter(({ circle }) => circle.status === 'active');
  const presetCircle = route.query.circle || (draft && draft.circleId) || '';
  const files = ui.files || [];
  const images = ui.images || [];
  const imageLimitLabel = ctx.config && ctx.config.mode === 'production'
    ? '照片会自动压缩' : '压缩后合计 ≤ 800 KiB';
  const courseList = (db.courses || []).filter((c) => c.id !== 'c_general');
  const previewOn = !!ui.compose.preview;
  const draftCourse = (draft && draft.courseId) || '';
  // 带图片或附件时才需要确认来源；收录到找资料时由 main.js 同步显示
  const needsSource = images.length > 0 || files.length > 0;

  return `
  <div class="layout-1 publish-layout">
    ${publishSwitch('post', route.query.circle ? { circle: route.query.circle } : null)}
    <div class="card">
      <div class="row compose-heading">
        <h1 class="grow">发布帖子</h1>
        <button class="icon-btn" type="button" data-action="compose-info" aria-label="查看发布说明" title="发布说明">${icon('question')}</button>
      </div>
      ${ui.composeRestored ? `<div class="draft-note">
        <span class="grow">已恢复上次没发出去的内容</span>
        <button class="text-button" type="button" data-action="clear-compose-draft">清空</button>
      </div>` : ''}

      <form data-form="post" class="mt-4" novalidate>
        <div class="form-row">
          <div class="field">
            <label for="compose-circle">发布到</label>
            <select class="select" id="compose-circle" name="circleId">
              <option value="">不挂圈（公开学习内容）</option>
              ${myCircles.map(({ circle }) => `<option value="${esc(circle.id)}" ${presetCircle === circle.id ? 'selected' : ''}>${esc(S.circleLabel(db, circle))}</option>`).join('')}
            </select>
            ${!myCircles.length ? `<p class="field-help">还没有加入课友圈，可以先发公开内容，或<a class="link" href="${href('/find-circles')}">去找课程圈</a>。</p>` : ''}
          </div>
          <div class="field" data-course-field ${presetCircle ? 'hidden' : ''}>
            <label for="compose-course">关联课程 <span class="label-hint">选填，课程页能看到</span></label>
            <select class="select" id="compose-course" name="courseId">
              <option value="">不关联课程</option>
              ${courseList.map((c) => `<option value="${esc(c.id)}" ${draftCourse === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="field"><label for="compose-term">适用学期</label>
            <select class="select" id="compose-term" name="postTerm"><option value="">不限学期</option>${TERMS.map((term) => `<option value="${esc(term)}">${esc(term)}</option>`).join('')}</select>
          </div>
          <div class="field"><label for="compose-chapter">章节 <span class="label-hint">选填</span></label>
            <input class="input" id="compose-chapter" name="chapter" maxlength="120" placeholder="例如：第三章 · 多元函数微分">
          </div>
        </div>

        <div class="field">
          <div class="label">板块</div>
          <div class="chips board-chips">
            ${BOARDS.map((item) => `<button class="chip chip-sm ${board === item.key ? 'is-active' : ''}" type="button"
              data-action="set-board" data-board="${esc(item.key)}" aria-pressed="${board === item.key}">
              ${esc(item.label)}
            </button>`).join('')}
          </div>
        </div>

        <div class="field">
          <label for="compose-title">标题 <span class="label-hint">选填 · 最多 60 字</span></label>
          <input class="input" id="compose-title" name="title" maxlength="60" value="${esc((draft && draft.title) || '')}" placeholder="给这篇帖子起个名字">
        </div>

        <div class="field">
          <div class="compose-body-head">
            <label class="label" for="compose-body">正文 <span class="label-hint">必填</span></label>
            <button class="chip chip-sm" type="button" data-action="toggle-preview" aria-pressed="${previewOn}">
              ${icon('note', 'i-sm')}${previewOn ? '关闭预览' : '预览'}
            </button>
          </div>
          <div class="compose-editor ${previewOn ? 'is-preview' : ''}">
            <textarea class="textarea" id="compose-body" name="body" rows="8" required
              data-count-for="compose-body" data-max="20000"
              placeholder="分享你想说的，也可以贴出尝试过的过程。">${esc((draft && draft.body) || '')}</textarea>
            ${previewOn ? `<div class="compose-preview">
              <div class="section-title">预览</div>
              <div class="post-body" data-compose-preview>${renderMarkdown(viewBodyValue(ctx))}</div>
            </div>` : ''}
          </div>
          <p class="field-error" data-field-error="body" hidden></p>
          <div class="compose-body-foot">
            <span class="tiny muted">支持 **粗体**、列表、引用和代码块</span>
            <div class="counter"><span data-counter="compose-body">0</span> / 20000</div>
          </div>
        </div>

        <div class="field">
          <div class="compose-tools">
            <label class="btn btn-ghost btn-sm upload-button">
              ${icon('image', 'i-sm')}添加图片
              <input class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload="image">
            </label>
            <span class="tiny muted">最多 9 张 · ${imageLimitLabel}</span>
            ${ui.pendingImages ? `<span class="tiny muted">正在处理 ${ui.pendingImages} 张…</span>` : ''}
          </div>
          ${images.length ? `<div class="compose-images">
            ${images.map((img, index) => `<div class="compose-image">
              <img src="${esc(img.dataUrl)}" alt="${esc(img.name)}">
              <button type="button" data-action="remove-image" data-index="${index}" aria-label="移除图片 ${esc(img.name)}">×</button>
            </div>`).join('')}
          </div>` : ''}
        </div>

        <div class="field">
          <label for="compose-tags">知识标签 <span class="label-hint">选填，最多 3 个</span></label>
          <input class="input" id="compose-tags" name="tags" value="${esc((draft && draft.tags) || '')}" placeholder="例如：递归，调试">
        </div>

        <details class="compose-more" ${files.length ? 'open' : ''}>
          <summary>添加 PDF 附件${files.length ? `（${files.length}）` : ''}</summary>
          <div class="mt-3">${pdfPicker(ctx, files)}</div>
        </details>

        <details class="compose-more">
          <summary>同时收录到找资料</summary>
          <div class="mt-3">
            <p class="tiny muted mb-3">确认后才会进入检索，需要至少 1 个 PDF；取消收录不会删除原帖。</p>
            <div class="form-row">
              <div class="field">
                <label for="res-course2">资料所属课程</label>
                <select class="select" id="res-course2" name="resourceCourse">
                  ${courseList.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="res-type2">资料类型</label>
                <select class="select" id="res-type2" name="type">
                  ${RESOURCE_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="field">
                <label for="res-school2">学校</label>
                <select class="select" id="res-school2" name="school">
                  ${SCHOOLS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="res-term2">适用学期</label>
                <select class="select" id="res-term2" name="term">
                  ${TERMS.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field">
              <label for="res-coverage2">适用范围</label>
              <textarea class="textarea textarea-sm" id="res-coverage2" name="coverage" rows="2" placeholder="覆盖哪些章节、适合什么用途"></textarea>
            </div>
            <div class="field">
              <label for="res-limitations2">尚未覆盖</label>
              <input class="input" id="res-limitations2" name="limitations" placeholder="例如：不含导数与中值定理">
            </div>
            <label class="checkbox">
              <input type="checkbox" name="confirmIndex">
              <span>公开资料信息与前两页预览，并收录到找资料。</span>
            </label>
          </div>
        </details>

        <label class="checkbox mt-3" data-source-confirm ${needsSource ? '' : 'hidden'}>
          <input type="checkbox" name="original">
          <span><b>文档来源</b>：这份内容来源合法（非整本商业教材扫描件、不含他人隐私），我有权分享。</span>
        </label>

        <div class="row mt-4 wrap form-submit">
          <span class="tiny muted grow">没发出去的内容会暂存在这台设备</span>
          <button class="btn" type="submit">${icon('plus', 'i-sm')}发布帖子</button>
        </div>
      </form>
    </div>
  </div>`;
}

function viewBodyValue() {
  const area = typeof document !== 'undefined' ? document.getElementById('compose-body') : null;
  return area ? area.value : '';
}

/* ---------- 编辑 ---------- */

export function postEdit(ctx) {
  const { db, me, route } = ctx;
  const post = S.postOf(db, route.params.id);
  if (!post) {
    return `<div class="layout-1">${emptyState({
      img: 'removed.svg', title: '帖子不存在', text: '链接可能有误。',
      actions: `<a class="btn btn-sm" href="${href('/circles')}">回到课友圈</a>`
    })}</div>`;
  }
  if (!me || me.id !== post.authorId) {
    return `<div class="layout-1"><div class="card">
      ${notice('只有作者可以编辑这篇内容。', 'warn', 'lock')}
      <a class="btn btn-ghost btn-sm mt-4" href="${href(`/posts/${post.id}`)}">返回帖子</a>
    </div></div>`;
  }
  const circle = post.circleId ? S.circleOf(db, post.circleId) : null;
  const archived = circle && circle.status === 'archived';

  return `
  <div class="layout-1">
    <nav class="crumbs" aria-label="面包屑">
      <a href="${href(`/posts/${post.id}`)}">返回帖子</a><span>/</span><span>编辑</span>
    </nav>
    <div class="card mt-4">
      <h1>编辑内容</h1>
      <p class="small secondary mt-2">编辑时间会对读者可见。附件版本更新请重新发布或联系管理员，首版不覆盖同一对象。</p>
      ${archived ? notice('这个圈已归档，内容不能编辑；你仍然可以删除自己的帖子。', 'warn', 'lock') : ''}

      <form data-form="edit-post" data-post="${esc(post.id)}" class="mt-4">
        <div class="field">
          <label for="edit-title">标题 <span class="label-hint">选填，最多 60 字</span></label>
          <input class="input" id="edit-title" name="title" maxlength="60" value="${esc(post.title || '')}" ${archived ? 'disabled' : ''}>
        </div>
        <div class="field">
          <label for="edit-body">正文</label>
          <textarea class="textarea" id="edit-body" name="body" rows="10" ${archived ? 'disabled' : ''}>${esc(post.body)}</textarea>
        </div>
        <div class="field">
          <label for="edit-tags">知识标签 <span class="label-hint">最多 3 个</span></label>
          <input class="input" id="edit-tags" name="tags" value="${esc((post.tags || []).join('，'))}" ${archived ? 'disabled' : ''}>
        </div>
        <div class="row wrap">
          <a class="btn btn-ghost" href="${href(`/posts/${post.id}`)}">取消</a>
          <button class="btn" type="submit" ${archived ? 'disabled' : ''}>保存修改</button>
        </div>
      </form>
    </div>
  </div>`;
}

/* 供 main.js 复用：帖子卡（供其他模块引用） */
export { postCard };





