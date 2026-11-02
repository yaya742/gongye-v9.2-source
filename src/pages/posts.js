/* 帖子详情、发布、编辑 */

import { href } from '../router.js';
import * as S from '../state/selectors.js';
import { DEMO_SAMPLE_FILES } from '../state/actions.js';
import {
  postCard, emptyState, notice, signCard, icon, avatar, authorLine,
  attachmentRow, commentList, commentForm, stickerPickerMarkup
} from '../components/ui.js';
import { renderMarkdown } from '../lib/markdown.js';
import { stickerMarkup } from '../data/stickers.js';
import { esc, timeAgo, BOARDS, boardOf, RESOURCE_TYPES, TERMS, SCHOOLS } from '../lib/format.js';

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
  const following = me && author && S.isFollowing(db, me.id, 'user', author.id);
  const joinedCircle = me && circle ? S.isActiveMember(db, me.id, circle.id) : false;

  const images = (post.images || []).map((src, index) => `
    <button type="button" class="photos-button" data-action="preview-image" data-src="${esc(src)}"
      aria-label="放大查看第 ${index + 1} 张图片" style="border:0;background:none;padding:0">
      <img src="${esc(src)}" alt="帖子配图 ${index + 1}" loading="lazy">
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

        <article class="card mt-4">
          ${authorLine(ctx, author, timeAgo(post.publishedAt), {
            showLevel: true,
            extra: `<span class="tag">${esc(board.label)}</span>`,
            right: isAuthor
              ? `<div class="row"><a class="chip chip-sm" href="${href(`/posts/${post.id}/edit`)}">编辑</a>
                   <button class="act" type="button" data-action="delete-post" data-post="${esc(post.id)}">删除</button></div>`
              : `<button class="act" type="button" data-action="open-report" data-target-type="post" data-target-id="${esc(post.id)}">${icon('flag', 'i-sm')}举报</button>`
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
              circle ? `<a class="tag-item" href="${href(`/circles/${circle.id}`)}">课程圈</a>` : '',
              ...(post.tags || []).map((t) => `<a class="tag-item" href="${href('/search', { q: t, tab: 'posts' })}">${esc(t)}</a>`),
              indexed ? `<a class="chip chip-sm" href="${href(`/resources/${resource.id}`)}">${icon('file', 'i-sm')}这份内容已收录到找资料</a>` : ''
            ].join('')}
          </div>

          <div class="post-actions">
            <button class="act" type="button" data-action="toggle-like" data-post="${esc(post.id)}" aria-pressed="${liked}">
              ${icon('heart')}${liked ? '已赞' : '赞'}${likes ? ` ${likes}` : ''}
            </button>
            <a class="act" href="#comments">${icon('comment')}评论${tree.total ? ` ${tree.total}` : ''}</a>
            <button class="act" type="button" data-action="toggle-save" data-post="${esc(post.id)}" aria-pressed="${saved}">
              ${icon('star')}${saved ? '已收藏' : '收藏'}${saves ? ` ${saves}` : ''}
            </button>
            <button class="act act-gift" type="button" data-action="open-gift" data-post="${esc(post.id)}">
              ${icon('bookmark')}送页签${gifts ? ` · ${gifts}` : ''}
            </button>
          </div>
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
            : `<button class="btn btn-sm btn-block mt-3" type="button" data-action="join-circle" data-circle="${esc(circle.id)}">看看这个圈</button>`}
        </section>` : `<section class="card">
          <div class="card-title">公开帖子</div>
          <p class="small secondary">这篇帖子没有挂在课友圈上，任何人都可以阅读和讨论。</p>
        </section>`}

        ${related.length ? `<section class="card">
          <div class="card-title">同课程的其他讨论</div>
          ${related.map((item) => `<div class="mb-3">
            <a class="small" href="${href(`/posts/${item.id}`)}">${esc(item.title || item.body.slice(0, 28))}</a>
            <div class="tiny muted">${esc(timeAgo(item.publishedAt))} · ${S.commentCount(db, item.id)} 条讨论</div>
          </div>`).join('')}
        </section>` : ''}

        ${signCard(ctx)}
      </aside>
    </div>
  </div>`;
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
  const board = boardOf(ui.compose.board).key;
  const myCircles = S.myCircles(db, me.id).filter(({ circle }) => circle.status === 'active');
  const presetCircle = route.query.circle || '';
  const files = ui.files || [];
  const images = ui.images || [];
  const imageTotalLimitLabel = ctx.config && ctx.config.mode === 'production' ? '512 KiB' : '800 KiB';
  const courseList = (db.courses || []).filter((c) => c.id !== 'c_general');
  const sampleOptions = DEMO_SAMPLE_FILES
    .map((file, index) => `<option value="${index}">${esc(file.label)}</option>`).join('');

  const previewHtml = ui.compose.preview
    ? `<div class="card card-tight mt-3">
        <div class="section-title">预览</div>
        <div class="post-body">${renderMarkdown(String((viewBodyValue(ctx) || '')))}</div>
        <p class="tiny muted mt-2">预览基于最后一次输入；发布后会以相同渲染方式显示。</p>
      </div>`
    : '';

  return `
  <div class="layout-1">
    <nav class="crumbs" aria-label="面包屑"><a href="${href('/circles')}">课友圈</a><span>/</span><span>发布</span></nav>
    <div class="card mt-4">
      <div class="row compose-heading">
        <h1 class="grow">发布帖子</h1>
        <button class="icon-btn" type="button" data-action="compose-info" aria-label="查看发布说明" title="发布说明">${icon('question')}</button>
      </div>

      <form data-form="post" class="mt-4" novalidate>
        <div class="field">
          <label for="compose-circle">发布到</label>
          <select class="select" id="compose-circle" name="circleId">
            <option value="">不挂圈（公开学习内容）</option>
            ${myCircles.map(({ circle }) => `<option value="${esc(circle.id)}" ${presetCircle === circle.id ? 'selected' : ''}>${esc(S.circleLabel(db, circle))}</option>`).join('')}
          </select>
          ${!myCircles.length ? `<p class="field-help">你还没有加入任何课友圈。可以先发不挂圈的公开内容，或<a class="link" href="${href('/find-circles')}">去找课程圈</a>。</p>` : ''}
        </div>

        <div class="field">
          <label>板块</label>
          <div class="chips">
            ${BOARDS.map((item) => `<button class="chip chip-sm ${board === item.key ? 'is-active' : ''}" type="button"
              data-action="set-board" data-board="${esc(item.key)}" aria-pressed="${board === item.key}">
              ${esc(item.label)}
            </button>`).join('')}
          </div>
        </div>

        <div class="field">
          <label for="compose-title">标题 <span class="label-hint">选填 · 最多 60 字</span></label>
          <input class="input" id="compose-title" name="title" maxlength="60" placeholder="给这篇帖子起个名字">
        </div>

        <div class="field">
          <label for="compose-body">正文 <span class="label-hint">必填 · 最多 20,000 字</span></label>
          <textarea class="textarea" id="compose-body" name="body" rows="8" required
            data-count-for="compose-body" data-max="20000"
            placeholder="分享你想说的，也可以贴出尝试过的过程。"></textarea>
          <div class="counter"><span data-counter="compose-body">0</span> / 20000</div>
        </div>

        <div class="row wrap mb-3">
          <button class="btn btn-quiet btn-sm" type="button" data-action="toggle-preview">
            ${icon('note', 'i-sm')}${ui.compose.preview ? '关闭预览' : '预览正文'}
          </button>
        </div>

        <div class="field">
          <label>图片 <span class="label-hint">最多 9 张</span></label>
          <div class="row wrap">
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload="image">
            <span class="tiny muted">单张 ≤ 10 MiB · 本帖合计 ≤ ${imageTotalLimitLabel}</span>
          </div>
          ${images.length ? `<div class="photos">
            ${images.map((img, index) => `<span style="position:relative;display:inline-block">
              <img src="${esc(img.dataUrl)}" alt="${esc(img.name)}" style="height:120px;width:auto;border:1px solid var(--line);border-radius:4px">
              <button class="chip chip-sm" type="button" data-action="remove-image" data-index="${index}"
                style="position:absolute;top:4px;right:4px">移除</button>
            </span>`).join('')}
          </div>` : ''}
        </div>

        <div class="field">
          <label>PDF 示例附件 <span class="label-hint">最多 3 个</span></label>
          <div class="row wrap">
            <select class="select" data-file-picker style="max-width:320px">${sampleOptions}</select>
            <button class="btn btn-ghost btn-sm" type="button" data-action="add-file">添加 PDF</button>
          </div>
          ${files.length
            ? files.map((file, index) => `<div class="attachment">
                <img src="assets/art/file-pdf.svg" alt="PDF" width="34" height="40">
                <div class="grow">
                  <div class="file-name">${esc(file.name)}</div>
                  <div class="file-meta">PDF · ${file.pages} 页 · 演示文件</div>
                </div>
                <button class="btn btn-quiet btn-sm" type="button" data-action="remove-file" data-index="${index}">移除</button>
              </div>`).join('')
            : ''}
        </div>

        <div class="field">
          <label for="compose-tags">知识标签 <span class="label-hint">最多 3 个</span></label>
          <input class="input" id="compose-tags" name="tags" placeholder="例如：递归，调试">
        </div>

        <details class="card card-tight" style="margin-bottom:16px">
          <summary class="small" style="cursor:pointer">同时收录到找资料（可选，需填资料字段）</summary>
          <div class="mt-3">
            <p class="tiny muted mb-3">只有作者主动确认、附件通过检查后才会进入检索；取消收录不会删除原帖，也不会退回页签。</p>
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
              <textarea class="textarea" id="res-coverage2" name="coverage" rows="2" placeholder="覆盖哪些章节、适合什么用途"></textarea>
            </div>
            <div class="field">
              <label for="res-limitations2">尚未覆盖</label>
              <input class="input" id="res-limitations2" name="limitations" placeholder="例如：不含导数与中值定理">
            </div>
            <label class="checkbox">
              <input type="checkbox" name="confirmIndex">
              <span>我确认公开资料元信息与前两页预览，并收录到找资料索引。</span>
            </label>
          </div>
        </details>

        <label class="checkbox">
          <input type="checkbox" name="original" required>
          <span><b>文档来源</b>：我确认这份内容来源合法（非整本商业教材扫描件、不含他人隐私），且我有权分享。未勾选无法发布或上传。</span>
        </label>

        <div class="row mt-6 wrap">
          <a class="link small" href="${href('/publish/resource')}">想独立分享资料？进入资料发布 →</a>
          <span class="grow"></span>
          <button class="btn" type="submit">${icon('plus', 'i-sm')}发布帖子</button>
        </div>
      </form>
    </div>
  </div>`;
}

function viewBodyValue(ctx) {
  const area = document.getElementById('compose-body');
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





