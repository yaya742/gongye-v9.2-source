/* 可复用的界面片段：帖子卡、资料卡、附件行、评论、空态、侧栏小组件 */

import { esc, timeAgo, formatBytes, boardOf, truncate, stripMarkdown, TERMS, RESOURCE_TYPES, shanghaiDate, mediaUrl } from '../lib/format.js';
import { DEMO_SAMPLE_FILES } from '../state/actions.js';
import { icon, avatar, fileIcon } from '../lib/icons.js';
import { href } from '../router.js';
import { renderMarkdown } from '../lib/markdown.js';
import * as S from '../state/selectors.js';
import { stickerMarkup, STICKERS, STICKER_PACKS } from '../data/stickers.js';

export { icon, avatar } from '../lib/icons.js';

export function authorLine(ctx, user, when, options = {}) {
  if (!user) return '';
  const { db } = ctx;
  const level = S.levelInfo(db, user.id);
  const extra = options.extra || '';
  const levelChip = options.showLevel
    ? `<button type="button" class="level-inline" data-action="level-info"
         data-level="${level.level}" data-name="${esc(level.name)}"
         aria-label="等级 LV.${level.level} ${esc(level.name)}，查看说明">
         <img class="level-chip" src="assets/${esc(level.chip)}" alt=""
           width="72" height="24" loading="lazy">
       </button>`
    : '';
  return `
  <div class="author">
    <a href="${href(`/u/${user.id}`)}" aria-label="查看 ${esc(user.nickname)} 的主页">${avatar(user)}</a>
    <div class="grow">
      <div class="author-name">
        <a href="${href(`/u/${user.id}`)}">${esc(user.nickname)}</a>
        ${levelChip}
        ${extra}
      </div>
      <div class="author-meta">
        <span>${esc(when || '')}</span>
        ${options.meta ? `<span class="dot-sep">·</span>${options.meta}` : ''}
      </div>
    </div>
    ${options.right || ''}
  </div>`;
}

export function statusPill(att) {
  if (!att) return '';
  if (att.status === 'ready') return '<span class="status-pill status-ready">可下载</span>';
  if (att.status === 'processing') return '<span class="status-pill status-processing">处理中</span>';
  if (att.status === 'failed') return '<span class="status-pill status-failed">处理失败</span>';
  if (att.status === 'removed') return '<span class="status-pill status-removed">已失效</span>';
  return `<span class="status-pill">${esc(att.status)}</span>`;
}

export function attachmentRow(ctx, att, opts = {}) {
  const { db, me } = ctx;
  const post = S.postOf(db, att.postId);
  const resource = S.resourceForPost(db, att.postId);
  const production = ctx.config?.mode === 'production';
  const canDownload = att.status === 'ready' && (production ? !!att.uploadId : !!att.path);
  const blocked = att.downloadBlocked;
  const metaBits = [
    'PDF',
    att.pages ? `${att.pages} 页` : null,
    att.sizeBytes ? formatBytes(att.sizeBytes) : null,
    opts.compact ? null : `v${att.version}`
  ].filter(Boolean);

  let actionHtml = '';
  if (blocked) {
    actionHtml = '<span class="tiny danger-text">审核中，暂不可下载</span>';
  } else if (canDownload) {
    actionHtml = `
      ${resource && S.resourceEligibility(db, resource).ok
        ? `<a class="btn btn-ghost btn-sm" href="${href(`/resources/${resource.id}`)}">预览</a>` : ''}
      <button class="btn btn-sm" type="button" data-action="download"
        data-post="${esc(att.postId)}" data-attachment="${esc(att.id)}">下载</button>`;
  } else if (att.status === 'processing') {
    actionHtml = '<span class="tiny muted">扫描完成后可下载</span>';
  } else if (att.status === 'failed') {
    actionHtml = '<span class="tiny danger-text">文件未通过检查，作者可重新上传</span>';
  }

  return `
  <div class="attachment">
    ${fileIcon(att.status === 'ready' || att.status === 'processing' ? 'pdf' : 'unavailable')}
    <div class="grow">
      <div class="file-name">${esc(att.name)}</div>
      <div class="file-meta">${metaBits.join(' · ')}${att.changeNote && !opts.compact ? ` · ${esc(att.changeNote)}` : ''} ${statusPill(att)}</div>
    </div>
    <div class="file-actions">${actionHtml}</div>
  </div>`;
}

/* 资料页和帖子页共享同一条真实上传链；生产模式绝不显示样例选择器。 */
export function pdfUploadField(ctx, { required = false, samples = [] } = {}) {
  const production = ctx.config?.mode === 'production';
  const ui = ctx.ui || {};
  const files = ui.files || [];
  const maxBytes = Math.min(20971520, Number(ctx.config?.filePolicy?.maxBytes) || 20971520);
  const unavailable = production && ctx.config?.filePolicy?.uploadReady === false;
  const busy = !!ui.uploading || !!ui.publishing;
  return `<div class="field pdf-upload">
    <label for="pdf-upload">PDF 附件 <span class="label-hint">${required ? '1–3 个' : '最多 3 个'} · 单个 ≤ ${formatBytes(maxBytes)}</span></label>
    ${production ? `<input id="pdf-upload" type="file" accept="application/pdf" multiple data-upload="pdf" ${busy || unavailable || files.length >= 3 ? 'disabled' : ''} aria-describedby="pdf-upload-help">
      <p id="pdf-upload-help" class="field-help">${unavailable
        ? '上传服务暂不可用：文件扫描服务尚未配置或未就绪。不能上传或假装成功，请联系维护者。'
        : '先勾选文档来源确认，再选择已有 PDF。文件由服务器检查，只有检查通过的上传才能发布。'}</p>`
      : `<div class="row wrap"><select class="select" data-file-picker style="max-width:340px">${samples.map((file, index) => `<option value="${index}">${esc(file.label)}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" type="button" data-action="add-file">添加 PDF</button></div>
        <p class="field-help">独立本地演示只使用包内示例 PDF，不会真的上传文件。</p>`}
    <p class="field-help upload-status" role="status" aria-live="polite">${ui.uploading ? `正在上传并检查 ${esc(ui.uploadName || 'PDF')}，暂不能发布…` : ''}</p>
    ${ui.uploadError ? `<p class="field-error" role="alert">${esc(ui.uploadError)}</p>` : ''}
    ${files.length ? files.map((file, index) => `<div class="attachment">
      <img src="assets/art/file-pdf.svg" alt="PDF" width="34" height="40">
      <div class="grow"><div class="file-name">${esc(file.name)}</div>
        <div class="file-meta">PDF · ${file.pages ? `${esc(file.pages)} 页` : '页数待确认'} · ${formatBytes(file.sizeBytes)} · ${production ? '已通过服务器检查' : '演示文件'}</div></div>
      <button class="btn btn-quiet btn-sm" type="button" data-action="remove-file" data-index="${index}" ${busy ? 'disabled' : ''}>移除</button>
    </div>`).join('') : `<p class="field-help">${required ? '至少需要 1 个已通过检查的 PDF。' : '提问与讨论可以只发文字。'}</p>`}
  </div>`;
}

export function sourceRightsFields({ prefix = 'resource', source = '', rights = '' } = {}) {
  return `<div class="field">
    <label for="${prefix}-source">资料来源 <span class="label-hint">说明作者、出处或授权依据，至少 4 字</span></label>
    <textarea class="textarea" id="${prefix}-source" name="source" rows="2" minlength="4" maxlength="1000" placeholder="例如：本人整理的课程笔记；或原作者、公开链接与许可说明">${esc(source)}</textarea>
  </div>
  <div class="field">
    <label for="${prefix}-rights">分享授权</label>
    <select class="select" id="${prefix}-rights" name="rights">
      <option value="">请选择授权类型</option>
      ${['原创', '已授权', '公开许可'].map((value) => `<option value="${value}" ${rights === value ? 'selected' : ''}>${value}</option>`).join('')}
    </select>
    <p class="field-help">仅拥有文件不等于拥有传播权。教师课件、教材节选等也须说明授权，不上传整本商业教材。</p>
  </div>`;

/** 帖子操作条：列表卡与详情页共用，手机上四项等宽排成一行 */
export function postActions({ post, liked, likes, saved, saves, gifts, comments, commentControl }) {
  const count = (value) => (value ? `<span class="act-count">${value}</span>` : '');
  return `
    <div class="post-actions">
      <button class="act" type="button" data-action="toggle-like" data-post="${esc(post.id)}"
        aria-pressed="${liked}" aria-label="${liked ? '取消赞' : '点赞'}">
        ${icon('heart')}<span>${liked ? '已赞' : '赞'}</span>${count(likes)}
      </button>
      ${commentControl(`${icon('comment')}<span>评论</span>${count(comments)}`)}
      <button class="act" type="button" data-action="toggle-save" data-post="${esc(post.id)}"
        aria-pressed="${saved}" aria-label="${saved ? '取消收藏' : '收藏'}">
        ${icon('star')}<span>${saved ? '已收藏' : '收藏'}</span>${count(saves)}
      </button>
      <button class="act act-gift" type="button" data-action="open-gift" data-post="${esc(post.id)}"
        aria-label="送页签">
        ${icon('bookmark')}<span>送页签</span>${count(gifts)}
      </button>
    </div>`;
}

/** PDF 附件：试用后端上传真实文件；静态演示版没有服务端，只能选示例文件 */
export function pdfPicker(ctx, files, { emptyHint = '' } = {}) {
  const real = !!(ctx.config && ctx.config.mode === 'production');
  const rows = files.map((file, index) => `
    <div class="attachment">
      <img src="assets/art/file-pdf.svg" alt="PDF" width="34" height="40">
      <div class="grow">
        <div class="file-name">${esc(file.name)}</div>
        <div class="file-meta">${file.status === 'uploading'
          ? `<span class="upload-progress" aria-hidden="true"><span data-upload-progress="${esc(file.localId)}" style="width:${Math.round((file.progress || 0) * 100)}%"></span></span>上传中…`
          : `PDF · ${file.pages ? `${file.pages} 页 · ` : ''}${formatBytes(file.sizeBytes)}${file.demo ? ' · 演示文件' : file.previewCount ? ' · 已生成预览' : ''}`}</div>
      </div>
      <button class="btn btn-quiet btn-sm" type="button" data-action="remove-file" data-index="${index}">移除</button>
    </div>`).join('');
  const picker = real
    ? `<label class="btn btn-ghost btn-sm upload-button">${icon('upload', 'i-sm')}选择 PDF
        <input class="visually-hidden" type="file" accept="application/pdf,.pdf" multiple data-upload="pdf">
      </label>
      <span class="tiny muted">最多 3 个 · 单个不超过 20 MiB</span>`
    : `<div class="grow file-picker-field">
        <select class="select" data-file-picker aria-label="选择示例 PDF">
          ${DEMO_SAMPLE_FILES.map((file, index) => `<option value="${index}">${esc(file.label)}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" data-action="add-file">添加附件</button>`;
  return `<div class="row wrap">${picker}</div>
    ${rows || (emptyHint ? `<p class="field-help">${esc(emptyHint)}</p>` : '')}
    <p class="field-help">${real
      ? '上传后会检查是否为有效 PDF，并自动生成前两页预览。请不要上传整本教材或他人隐私。'
      : '演示版不能上传真实文件，这里用明确标注的示例 PDF 走通流程。'}</p>`;
}

/** 发布页顶部的类型切换：发帖子 / 分享资料共用一个入口 */
export function publishSwitch(current, query = null) {
  const items = [
    { key: 'post', label: '发帖子', hint: '笔记、心得、提问', to: '/publish' },
    { key: 'resource', label: '分享资料', hint: '附 PDF，进入找资料', to: '/publish/resource' }
  ];
  return `<nav class="publish-switch" aria-label="发布类型">
    ${items.map((item) => `<a class="publish-option ${current === item.key ? 'is-active' : ''}"
      href="${href(item.to, query)}" ${current === item.key ? 'aria-current="page"' : ''}>
      <b>${esc(item.label)}</b><span>${esc(item.hint)}</span>
    </a>`).join('')}
  </nav>`;
}

export function postCard(ctx, post, options = {}) {
  const { db, me } = ctx;
  if (!post) return '';
  const author = S.userOf(db, post.authorId);
  const circle = post.circleId ? S.circleOf(db, post.circleId) : null;
  const course = post.courseId ? S.courseOf(db, post.courseId) : null;
  const board = boardOf(post.board);
  const attachments = S.attachmentsOf(db, post.id);
  const resource = S.resourceForPost(db, post.id);
  const indexed = S.resourceEligibility(db, resource).ok;
  const likes = S.reactionCount(db, post.id, 'like');
  const saves = S.reactionCount(db, post.id, 'save');
  const commentCountValue = S.commentCount(db, post.id);
  const gifts = S.giftedQtyForPost(db, post.id);
  const liked = !!me && !!S.reactionOf(db, me.id, post.id, 'like');
  const saved = !!me && !!S.reactionOf(db, me.id, post.id, 'save');
  const isAuthor = !!me && me.id === post.authorId;
  const clamp = options.clamp !== false;

  const title = post.title
    ? `<h3 class="post-title"><a href="${href(`/posts/${post.id}`)}">${esc(post.title)}</a></h3>`
    : '';

  const images = (post.images || []).length
    ? `<div class="photos">${(post.images || []).slice(0, 3).map((src, index) => `
        <a href="${href(`/posts/${post.id}`)}" aria-label="查看第 ${index + 1} 张图片">
          <img src="${esc(mediaUrl(src))}" alt="帖子配图 ${index + 1}" loading="lazy">
        </a>`).join('')}
        ${(post.images || []).length > 3 ? `<span class="tag">+${(post.images || []).length - 3}</span>` : ''}
      </div>`
    : '';

  const attachmentHtml = attachments.length
    ? attachments.map((att) => attachmentRow(ctx, att, { compact: true })).join('')
    : '';

  const tagBits = [];
  if (indexed) tagBits.push(`<a class="chip chip-sm" href="${href(`/resources/${resource.id}`)}">${icon('file', 'i-sm')}收录于找资料</a>`);
  if (post.tags && post.tags.length) {
    tagBits.push(...post.tags.map((t) => `<span class="tag-item">${esc(t)}</span>`));
  }
  // 圈标记已经显示课程名；不挂圈的帖子才单独标课程
  if (course && !circle) tagBits.push(`<span class="tag-item">${esc(course.name)}</span>`);
  if (post.term) tagBits.push(`<span class="tag-item">${esc(post.term)}</span>`);
  if (post.chapter) tagBits.push(`<span class="tag-item">${esc(post.chapter)}</span>`);
  if (circle) tagBits.push('<span class="tag-item">课程圈</span>');

  return `
  <article class="card post-card card-hover" id="post-${esc(post.id)}" data-card-kind="post" data-card-id="${esc(post.id)}" data-href="${href(`/posts/${post.id}`)}" tabindex="-1">
    ${authorLine(ctx, author, `${timeAgo(post.publishedAt)}${post.editedAt ? ' · 已编辑' : ''}`, {
      extra: `<span class="tag">${esc(board.label)}</span>`,
      right: circle
        ? `<a class="chip chip-sm" href="${href(`/circles/${circle.id}`)}">${esc(S.circleShort(db, circle))}</a>`
        : ''
    })}
    ${title}
    <div class="post-body ${clamp ? 'is-clamped' : ''}">${renderMarkdown(post.body)}</div>
    ${post.stickerId ? `<div class="sticker-wrap">${stickerMarkup(post.stickerId)}</div>` : ''}
    ${images}
    ${attachmentHtml}
    ${tagBits.length ? `<div class="post-tags">${tagBits.join('')}</div>` : ''}
    ${postActions({
      post, liked, likes, saved, saves, gifts,
      comments: commentCountValue,
      commentControl: (inner) => `<a class="act" href="${href(`/posts/${post.id}`, { focus: 'comments' })}">${inner}</a>`
    })}
  </article>`;
}

export function resourceCard(ctx, item) {
  const { db } = ctx;
  const { resource, post, course, author, files } = item;
  const saves = S.reactionCount(db, post.id, 'save');
  const file = files[0] || null;
  const comments = S.commentCount(db, post.id);

  const courseTag = course
    ? `<a class="res-course-tag" href="${href(`/courses/${course.id}`)}" title="进入课程页">${esc(course.name)}</a>`
    : `<span class="res-course-tag is-missing" title="作者还没补选课程">课程待补充</span>`;

  const metaBits = [
    author ? esc(author.nickname) : '',
    esc(timeAgo(resource.updatedAt)),
    esc(S.termLabel(resource.term)),
    file && file.pages ? `${file.pages} 页 PDF` : 'PDF',
    saves ? `${saves} 人收藏` : ''
  ].filter(Boolean);

  return `
  <article class="card res-card card-hover" data-card-kind="resource" data-card-id="${esc(resource.id)}" data-href="${href(`/resources/${resource.id}`)}" tabindex="-1">
    <div class="res-tag-row">
      ${courseTag}
      <span class="res-type-tag">${esc(resource.type)}</span>
    </div>
    <h3 class="res-title"><a href="${href(`/resources/${resource.id}`)}">${esc(resource.title)}</a></h3>
    ${resource.coverage ? `<p class="res-summary">${esc(truncate(resource.coverage, 90))}</p>` : ''}
    <div class="res-foot">
      <span class="res-meta-line">${metaBits.join(' · ')}</span>
      <div class="res-actions">
        <a class="text-link res-thread-link" href="${href(`/posts/${post.id}`)}">原帖讨论${comments ? ` ${comments}` : ''}</a>
        <a class="res-open" href="${href(`/resources/${resource.id}`)}">查看预览</a>
      </div>
    </div>
  </article>`;
}
export function commentList(ctx, post, tree, options = {}) {
  const { db, me } = ctx;
  const isAuthor = !!me && me.id === post.authorId;
  const accepted = post.acceptedCommentId ? S.byId(db.comments, post.acceptedCommentId) : null;

  const renderCommentBody = (comment) => `
    ${comment.stickerId ? `<div class="sticker-wrap">${stickerMarkup(comment.stickerId)}</div>` : ''}
    ${comment.body ? `<div class="comment-body">${renderMarkdown(comment.body)}</div>` : ''}
    <div class="comment-actions">
      ${comment.replyToUserId
        ? `<span class="tiny muted">回复 <a href="${href(`/u/${comment.replyToUserId}`)}">${esc((S.userOf(db, comment.replyToUserId) || {}).nickname || '')}</a></span>`
        : ''}
      <button class="act" type="button" data-action="reply-to" data-comment="${esc(comment.id)}" data-post="${esc(comment.postId)}"
        data-nickname="${esc((S.userOf(db, comment.authorId) || {}).nickname || '')}">
        ${icon('reply', 'i-sm')}回复
      </button>
      ${isAuthor && post.board === 'help' && post.acceptedCommentId !== comment.id
        ? `<button class="act" type="button" data-action="accept-comment" data-post="${esc(post.id)}" data-comment="${esc(comment.id)}">
             ${icon('check', 'i-sm')}采纳
           </button>` : ''}
      ${me && me.id === comment.authorId
        ? `<button class="act" type="button" data-action="delete-comment" data-comment="${esc(comment.id)}">${icon('close', 'i-sm')}删除</button>`
        : ''}
      <button class="act" type="button" data-action="open-report" data-target-type="comment" data-target-id="${esc(comment.id)}">
        ${icon('flag', 'i-sm')}举报
      </button>
    </div>`;

  const acceptedBlock = accepted
    ? `<div class="accepted-comment">
        <div class="row wrap" style="gap:8px">
          <span class="accepted-badge">${icon('check', 'i-sm')}已采纳的回答</span>
          ${isAuthor ? `<button class="act" type="button" data-action="unaccept" data-post="${esc(post.id)}">取消采纳</button>` : ''}
        </div>
        ${authorLine(ctx, S.userOf(db, accepted.authorId), timeAgo(accepted.createdAt))}
        ${renderCommentBody(accepted)}
      </div>`
    : '';

  const roots = tree.roots.filter((c) => !accepted || c.id !== accepted.id);
  const items = roots.map((comment) => {
    const replies = tree.replies.get(comment.id) || [];
    return `
    <div class="comment ${ctx.ui && ctx.ui.freshCommentId === comment.id ? 'is-fresh' : ''}">
      ${authorLine(ctx, S.userOf(db, comment.authorId), timeAgo(comment.createdAt), { showLevel: true })}
      ${renderCommentBody(comment)}
      ${replies.length ? `<div class="comment-replies">${replies.map((reply) => `
        <div class="comment-reply">
          ${authorLine(ctx, S.userOf(db, reply.authorId), timeAgo(reply.createdAt), { showLevel: true })}
          ${renderCommentBody(reply)}
        </div>`).join('')}</div>` : ''}
    </div>`;
  }).join('');

  return `${acceptedBlock}${items ? `<div class="comment-list">${items}</div>` : ''}`;
}

export function commentForm(ctx, post, options = {}) {
  const { db, me } = ctx;
  const ui = ctx.ui || {};
  const reply = ui.replyTarget && ui.replyTarget.postId === post.id ? ui.replyTarget : null;

  let disabledReason = '';
  if (!me) disabledReason = '登录后即可参与讨论';
  else if (post.circleId) {
    const isMember = S.isActiveMember(db, me.id, post.circleId);
    const hasResource = S.resourceEligibility(db, S.resourceForPost(db, post.id)).ok;
    if (isMember) {
      const block = S.circleWriteBlock(db, me.id, post.circleId);
      if (!block.ok) disabledReason = block.message;
    } else if (!hasResource) {
      disabledReason = '加入这个课友圈后才能评论普通帖子';
    } else {
      const block = S.resourceCommentBlock(db, me.id, post);
      if (!block.ok) disabledReason = block.message;
    }
  }

  if (disabledReason) {
    return `<div class="comment-form">
      <div class="notice notice-warn">${icon('lock', 'i-sm')}<span>${esc(disabledReason)}</span></div>
      ${!me ? `<div class="mt-3"><a class="btn btn-sm" href="${href('/login', { next: `/posts/${post.id}` })}">登录 / 注册</a></div>` : ''}
    </div>`;
  }

  return `
  <form class="comment-form" data-form="comment" data-post="${esc(post.id)}">
    ${reply ? `<div class="chips mb-2">
      <span class="chip chip-sm is-active">回复 ${esc(reply.nickname)}
        <button class="act" type="button" data-action="clear-reply" aria-label="取消回复" style="min-height:20px;padding:0 2px">×</button>
      </span>
    </div>` : ''}
    <input type="hidden" name="parentId" value="${esc(reply ? reply.commentId : '')}">
    <input type="hidden" name="stickerId" value="">
    <label class="visually-hidden" for="comment-body">评论内容</label>
    <textarea class="textarea" id="comment-body" name="body" rows="3"
      placeholder="${reply ? `回复 ${esc(reply.nickname)}…` : '说说你的理解，指出问题时写清依据…（也可以只送一个页页表情）'}"></textarea>
    <div class="row mt-3 wrap">
      <button class="btn btn-quiet btn-sm" type="button" data-action="toggle-sticker-panel" aria-expanded="false">
        ${icon('image', 'i-sm')}页页表情
      </button>
      <span class="sticker-preview" hidden></span>
      <span class="grow"></span>
      <button class="btn" type="submit">${icon('comment', 'i-sm')}发表评论</button>
    </div>
    ${stickerPickerMarkup()}
  </form>`;
}

export function emptyState({ img = 'empty-feed.svg', title, text, actions = '', mascot = false, book = false }) {
  return `
  <div class="empty">
    ${mascot ? '<img class="mascot-duo" src="assets/mascot/duo.png" alt="">' : ''}
    ${book ? '<img class="empty-book" src="assets/art/v5-book.webp" alt="" width="140" height="93">' : `<img src="assets/art/${esc(img)}" alt="">`}
    <h3>${esc(title)}</h3>
    ${text ? `<p class="small secondary">${esc(text)}</p>` : ''}
    ${actions}
  </div>`;
}

export function notice(text, kind = 'info', iconName = 'check') {
  const cls = kind === 'warn' ? 'notice notice-warn' : kind === 'danger' ? 'notice notice-danger' : 'notice';
  return `<div class="${cls}">${icon(iconName, 'i-sm')}<span>${text}</span></div>`;
}

export { signCard } from './bookmark.js';

export function weekIndexCard(ctx) {
  const { db, me } = ctx;
  const circles = me ? S.myCircles(db, me.id).map((x) => x.circle) : (db.circles || []).filter((c) => c.status === 'active');
  let pinned = null;
  let owner = null;
  for (const circle of circles) {
    if (circle.pinnedPostId) {
      const post = S.postOf(db, circle.pinnedPostId);
      if (post && post.status === 'published') {
        pinned = post;
        owner = circle;
        break;
      }
    }
  }
  if (!pinned) {
    const candidate = (db.posts || []).find((p) => p.board === 'course' && p.status === 'published');
    pinned = candidate || null;
  }
  if (!pinned) {
    return `<section class="card"><div class="card-title">本周一起学</div><p class="small muted">还没有本周索引。</p></section>`;
  }
  return `<section class="card">
    <div class="card-title">本周一起学</div>
    <p><a class="link" href="${href(`/posts/${pinned.id}`)}">${esc(truncate(pinned.title || stripMarkdown(pinned.body), 34))}</a></p>
    <small class="tiny muted">${owner ? `${esc(S.circleShort(db, owner))} · ` : ''}同学整理，非学校通知</small>
    <hr>
    <p class="small secondary">把这一周没跟上的一步写下来，比一个人卡着更好受。</p>
  </section>`;
}

export function pendingQuestionsCard(ctx) {
  const { db } = ctx;
  const helps = (db.posts || [])
    .filter((p) => p.board === 'help' && p.status === 'published')
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 3);
  if (!helps.length) return '';
  return `<section class="card">
    <div class="card-title">等一个解答</div>
    ${helps.map((post) => {
      const course = S.courseOf(db, post.courseId);
      const count = S.commentCount(db, post.id);
      return `<div class="mb-3">
        <a class="small" href="${href(`/posts/${post.id}`)}">${esc(truncate(post.title || stripMarkdown(post.body), 30))}</a>
        <div class="tiny muted">${esc(course ? course.name : '未关联课程')} · ${count ? `${count} 条回复` : '暂无回复'}</div>
      </div>`;
    }).join('')}
  </section>`;
}





export function statRow(items) {
  return `<div class="stat-row">${items.map((x) => `<span class="stat"><b>${esc(String(x.value))}</b>${esc(x.label)}</span>`).join('')}</div>`;
}





/* 页页表情选择器（桌面小浮层 / 手机轻面板，样式由 CSS 控制） */
export function stickerPickerMarkup() {
  return `
  <div class="sticker-panel" hidden role="group" aria-label="页页表情">
    ${STICKER_PACKS.map((pack) => {
      const items = STICKERS.filter((sticker) => sticker.pack === pack.key);
      if (!items.length) return '';
      return `<div class="sticker-group">
        <div class="sticker-group-title">${esc(pack.label)}</div>
        <div class="sticker-grid">
          ${items.map((sticker) => `
            <button class="sticker-option" type="button" data-action="pick-sticker" data-sticker="${esc(sticker.id)}"
              aria-label="选择页页表情：${esc(sticker.label)}">
              ${stickerMarkup(sticker.id, 'sticker-thumb', { thumb: true })}
              <span>${esc(sticker.label)}</span>
            </button>`).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}








/** 右栏：今日页签榜（按今天帖子收到的页签数） */
export function bookmarkBoardCard(ctx) {
  const { db, me } = ctx;
  const rows = S.bookmarkBoard(db, { limit: 5 });
  const dateLabel = shanghaiDate(new Date()).replace(/-/g, '.');
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return `<section class="card board-card">
    <div class="row" style="align-items:baseline">
      <div class="card-title grow">今日页签榜</div>
      <span class="tiny muted">${esc(dateLabel)}</span>
    </div>
    <p class="tiny muted">今天收到页签最多的帖子</p>
    ${rows.length ? `<ol class="board-list">
      ${rows.map((row, index) => {
        const author = S.userOf(db, row.post.authorId);
        return `<li class="board-row${me && me.id === row.post.authorId ? ' is-me' : ''}">
          <span class="board-rank">${index + 1}</span>
          <div class="board-main grow">
            <a class="board-title" href="${href(`/posts/${row.post.id}`)}">${esc(row.post.title || '未命名帖子')}</a>
            <div class="board-meta tiny muted">${esc(author ? author.nickname : '')}</div>
          </div>
          <span class="board-count">${row.count} 枚</span>
        </li>`;
      }).join('')}
    </ol>` : '<p class="small muted mt-3">今天还没有帖子收到页签。</p>'}
    <div class="board-foot tiny muted">${total} 枚页签在今天被送出 · 按帖子统计</div>
  </section>`;
}



