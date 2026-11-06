/* 业务动作：所有写入都经过这里，模拟服务端应当执行的校验。
 * 返回 { ok, code, message, data }，失败不发消息、不改数据。
 * 生产环境需要把这些校验原样实现在可信后端（见 README）。
 */

import { shanghaiDate, countChars, BOARDS, levelOf, TERMS, RESOURCE_TYPES, SCHOOLS } from '../lib/format.js';
import { GROWTH_RULES, effectiveTextLength, normalizeForDedupe } from '../data/growth.js';
import { quoteOfDay, bookmarkOfDay } from '../data/quotes.js';
import { isValidSticker } from '../data/stickers.js';
import * as S from './selectors.js';

export const DEMO_CODE = '123456';

export const DEMO_SAMPLE_FILES = [
  {
    label: '演示示例 · 复习笔记（18 页）',
    name: '演示示例_复习笔记.pdf', sizeBytes: 2516582, pages: 18,
    path: 'assets/samples/demo-calculus-notes.pdf'
  },
  {
    label: '演示示例 · 题解（11 页）',
    name: '演示示例_题解.pdf', sizeBytes: 1500000, pages: 11,
    path: 'assets/samples/demo-linear-algebra.pdf'
  },
  {
    label: '演示示例 · 编程笔记（9 页）',
    name: '演示示例_编程笔记.pdf', sizeBytes: 900000, pages: 9,
    path: 'assets/samples/demo-python-notes.pdf'
  }
];

let counter = 0;
export function newId(prefix = 'x') {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

const ok = (message = '', data = {}) => ({ ok: true, message, data });
const fail = (code, message) => ({ ok: false, code, message });

function me(db) {
  return S.currentUser(db);
}

function logEvent(db, type, meta = {}) {
  if (!Array.isArray(db.events)) db.events = [];
  db.events.push({ type, at: new Date().toISOString(), meta });
  if (db.events.length > 400) db.events.splice(0, db.events.length - 400);
}

/* 设置页里可以关闭的通知；采纳、退款和系统通知始终发送 */
const NOTIFY_PREF_BY_TYPE = { reply: 'replies', gift: 'gifts' };

function notifyUser(db, payload) {
  if (!db.notifications) db.notifications = [];
  if (!payload.userId || payload.userId === payload.actorId) return null;
  const prefKey = NOTIFY_PREF_BY_TYPE[payload.type];
  const prefs = db.prefs && db.prefs[payload.userId];
  if (prefKey && prefs && prefs[prefKey] === false) return null;
  // 被拉黑的人做的事（回复、送页签）不再提醒拉黑方
  if (payload.actorId && S.blockedBy(db, payload.userId, payload.actorId)) return null;
  const entry = {
    id: newId('n'), readAt: null, createdAt: new Date().toISOString(),
    commentId: null, postId: null, ...payload
  };
  db.notifications.push(entry);
  return entry;
}

function audit(db, actorId, action, target, reason) {
  if (!db.audit) db.audit = [];
  db.audit.push({ id: newId('au'), actorId, action, target, reason, at: new Date().toISOString() });
}

/* ---------- 等级与经验（growth-v4.2）：决策 + 流水 + 日额 ---------- */

const XP_DAY_MS = 24 * 3600 * 1000;

function decisionsOf(db) {
  if (!Array.isArray(db.growthDecisions)) db.growthDecisions = [];
  return db.growthDecisions;
}

function pushXpEvent(db, { userId, type, sourceId, delta, kind, decisionId, reason, now }) {
  if (!Array.isArray(db.xp)) db.xp = [];
  db.xp.push({
    id: newId('xp'), userId, sourceType: type, sourceId, delta, kind,
    decisionId: decisionId || null, reason, at: new Date(now).toISOString()
  });
}

function findDecision(db, type, sourceId, userId) {
  return decisionsOf(db).find((d) => d.type === type && d.sourceId === sourceId && d.userId === userId) || null;
}

function recordDecision(db, { userId, type, sourceId, amount, reason, now, meta = {} }) {
  const existing = findDecision(db, type, sourceId, userId);
  if (existing) return existing;
  const decision = {
    id: newId('gd'), userId, type, sourceId, amount,
    reason, status: amount > 0 ? 'granted' : 'zero',
    grantedDay: shanghaiDate(new Date(now)),
    at: new Date(now).toISOString(),
    rulesVersion: GROWTH_RULES.version,
    meta
  };
  decisionsOf(db).push(decision);
  if (amount > 0) {
    pushXpEvent(db, { userId, type, sourceId, delta: amount, kind: 'grant', decisionId: decision.id, reason, now });
  }
  return decision;
}

function revokeDecision(db, decision, reason, now) {
  if (!decision || decision.status !== 'granted') return 0;
  decision.status = 'revoked';
  decision.revokedAt = new Date(now).toISOString();
  decision.revokeReason = reason;
  pushXpEvent(db, {
    userId: decision.userId, type: decision.type, sourceId: decision.sourceId,
    delta: -decision.amount, kind: 'revoke', decisionId: decision.id, reason, now
  });
  return decision.amount;
}

function restoreDecision(db, decision, now) {
  if (!decision || decision.status !== 'revoked') return 0;
  decision.status = 'granted';
  decision.restoredAt = new Date(now).toISOString();
  pushXpEvent(db, {
    userId: decision.userId, type: decision.type, sourceId: decision.sourceId,
    delta: decision.amount, kind: 'restore', decisionId: decision.id, reason: decision.reason, now
  });
  return decision.amount;
}

function grantsToday(db, { userId, type, day, metaKey, metaValue }) {
  return decisionsOf(db).filter((d) => d.userId === userId && d.type === type
    && d.amount > 0 && d.grantedDay === day
    && (!metaKey || (d.meta || {})[metaKey] === metaValue)).length;
}

function recentDuplicate(db, userId, type, norm, now) {
  if (!norm) return false;
  const since = now - GROWTH_RULES.dedupeWindowDays * XP_DAY_MS;
  return decisionsOf(db).some((d) => d.userId === userId && d.type === type
    && (d.meta || {}).norm === norm && new Date(d.at).getTime() >= since);
}

function zero(db, { userId, type, sourceId, reason, now, meta }) {
  return recordDecision(db, { userId, type, sourceId, amount: 0, reason, now, meta: meta || {} });
}

function evaluatePostXp(db, post, user, now) {
  if (findDecision(db, 'post', post.id, user.id)) return null;
  const norm = normalizeForDedupe(post.body);
  if (effectiveTextLength(post.body) < GROWTH_RULES.rewards.post.minChars) {
    return zero(db, { userId: user.id, type: 'post', sourceId: post.id, reason: 'TEXT_TOO_SHORT', now, meta: { norm } });
  }
  if (recentDuplicate(db, user.id, 'post', norm, now)) {
    return zero(db, { userId: user.id, type: 'post', sourceId: post.id, reason: 'DUPLICATE_TEXT', now, meta: { norm } });
  }
  const day = shanghaiDate(new Date(now));
  if (grantsToday(db, { userId: user.id, type: 'post', day }) >= GROWTH_RULES.rewards.post.daily) {
    return zero(db, { userId: user.id, type: 'post', sourceId: post.id, reason: 'DAILY_LIMIT', now, meta: { norm } });
  }
  return recordDecision(db, {
    userId: user.id, type: 'post', sourceId: post.id,
    amount: GROWTH_RULES.rewards.post.xp, reason: '发布帖子', now, meta: { norm }
  });
}

function evaluateCommentXp(db, post, comment, user, now) {
  if (findDecision(db, 'comment', comment.id, user.id)) return null;
  const norm = normalizeForDedupe(comment.body);
  if (effectiveTextLength(comment.body) < GROWTH_RULES.rewards.comment.minChars) {
    return zero(db, { userId: user.id, type: 'comment', sourceId: comment.id, reason: 'TEXT_TOO_SHORT', now, meta: { postId: post.id, norm } });
  }
  if (post.authorId === user.id) {
    return zero(db, { userId: user.id, type: 'comment', sourceId: comment.id, reason: 'OWN_POST_COMMENT', now, meta: { postId: post.id, norm } });
  }
  if (recentDuplicate(db, user.id, 'comment', norm, now)) {
    return zero(db, { userId: user.id, type: 'comment', sourceId: comment.id, reason: 'DUPLICATE_TEXT', now, meta: { postId: post.id, norm } });
  }
  const day = shanghaiDate(new Date(now));
  if (grantsToday(db, { userId: user.id, type: 'comment', day, metaKey: 'postId', metaValue: post.id }) >= GROWTH_RULES.rewards.comment.perPostDaily) {
    return zero(db, { userId: user.id, type: 'comment', sourceId: comment.id, reason: 'THREAD_DAILY_LIMIT', now, meta: { postId: post.id, norm } });
  }
  if (grantsToday(db, { userId: user.id, type: 'comment', day }) >= GROWTH_RULES.rewards.comment.daily) {
    return zero(db, { userId: user.id, type: 'comment', sourceId: comment.id, reason: 'DAILY_LIMIT', now, meta: { postId: post.id, norm } });
  }
  return recordDecision(db, {
    userId: user.id, type: 'comment', sourceId: comment.id,
    amount: GROWTH_RULES.rewards.comment.xp, reason: '有内容的评论', now, meta: { postId: post.id, norm }
  });
}

function evaluateAcceptedXp(db, post, comment, now) {
  const userId = comment.authorId;
  const existing = decisionsOf(db).find((d) => d.type === 'accepted'
    && (d.meta || {}).postId === post.id && d.userId === userId);
  if (existing) {
    if (existing.status === 'revoked') restoreDecision(db, existing, now);
    return existing;
  }
  if (comment.parentId || post.board !== 'help' || userId === post.authorId) {
    return zero(db, { userId, type: 'accepted', sourceId: comment.id, reason: 'NOT_ELIGIBLE', now, meta: { postId: post.id } });
  }
  if (effectiveTextLength(comment.body) < GROWTH_RULES.rewards.accepted.minChars) {
    return zero(db, { userId, type: 'accepted', sourceId: comment.id, reason: 'TEXT_TOO_SHORT', now, meta: { postId: post.id } });
  }
  const day = shanghaiDate(new Date(now));
  if (grantsToday(db, { userId, type: 'accepted', day }) >= GROWTH_RULES.rewards.accepted.daily) {
    return zero(db, { userId, type: 'accepted', sourceId: comment.id, reason: 'DAILY_LIMIT', now, meta: { postId: post.id } });
  }
  if (grantsToday(db, { userId, type: 'accepted', day, metaKey: 'askerId', metaValue: post.authorId }) >= GROWTH_RULES.rewards.accepted.perAskerDaily) {
    return zero(db, { userId, type: 'accepted', sourceId: comment.id, reason: 'ASKER_DAILY_LIMIT', now, meta: { postId: post.id } });
  }
  return recordDecision(db, {
    userId, type: 'accepted', sourceId: comment.id,
    amount: GROWTH_RULES.rewards.accepted.xp, reason: '回答被采纳', now,
    meta: { postId: post.id, askerId: post.authorId }
  });
}

function evaluateMarkerXp(db, gift, now) {
  const receiver = S.userOf(db, gift.receiverId);
  if (!receiver || receiver.status !== 'active') return null;
  if (findDecision(db, 'marker', gift.id, receiver.id)) return null;

  const day = shanghaiDate(new Date(now));
  const todays = decisionsOf(db).filter((d) => d.userId === receiver.id
    && d.type === 'marker' && d.amount > 0 && d.grantedDay === day);
  if (todays.some((d) => (d.meta || {}).senderId === gift.senderId)) {
    return zero(db, { userId: receiver.id, type: 'marker', sourceId: gift.id, reason: 'SENDER_DAILY_LIMIT', now, meta: { postId: gift.postId, senderId: gift.senderId, qty: gift.qty } });
  }
  const used = todays.reduce((sum, d) => sum + ((d.meta || {}).qty || 1), 0);
  const remaining = GROWTH_RULES.rewards.marker.daily - used;
  if (remaining <= 0) {
    return zero(db, { userId: receiver.id, type: 'marker', sourceId: gift.id, reason: 'DAILY_LIMIT', now, meta: { postId: gift.postId, senderId: gift.senderId, qty: gift.qty } });
  }
  const qty = Math.min(gift.qty, remaining);
  return recordDecision(db, {
    userId: receiver.id, type: 'marker', sourceId: gift.id,
    amount: qty * GROWTH_RULES.rewards.marker.xp, reason: '收到页签', now,
    meta: { giftId: gift.id, postId: gift.postId, senderId: gift.senderId, qty }
  });
}

function growthOf(db, userId) {
  const info = S.levelInfo(db, userId);
  return {
    xp: info.xp, level: info.level, name: info.name,
    nextAt: info.nextAt, nextName: info.nextName,
    within: info.within, span: info.span, remaining: info.remaining,
    percent: info.percent, isMax: info.isMax, version: GROWTH_RULES.version
  };
}

function levelUpOf(before, after) {
  return after.level > before.level
    ? { from: before.level, to: after.level, name: after.name }
    : null;
}
/* ---------- 账号 ---------- */

export function requestCode(db, { email }) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return fail('bad_email', '邮箱格式不正确');
  const existing = db.users.find((u) => String(u.email || '').toLowerCase() === value);
  if (existing && existing.status !== 'active') return fail('suspended', '该账号已停用');
  return ok('验证码已发送（演示环境固定为 123456，不发真实邮件）', { email: value, demoCode: DEMO_CODE });
}

export function verifyCode(db, { email, code }) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return fail('bad_email', '请填写邮箱');
  if (String(code || '').trim() !== DEMO_CODE) return fail('bad_code', '验证码不正确（演示环境固定为 123456）');

  let user = db.users.find((u) => String(u.email || '').toLowerCase() === value);
  if (user && user.status !== 'active') return fail('suspended', '该账号已停用，不能登录');

  if (!user) {
    const local = value.split('@')[0].replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '') || '同学';
    user = {
      id: newId('u'),
      email: value,
      nickname: local.slice(0, 12),
      avatar: 'art/avatar-01.svg',
      bio: '',
      role: 'user',
      status: 'active',
      verified: true,
      joinedAt: new Date().toISOString()
    };
    db.users.push(user);
  }
  user.verified = true;
  db.session = { userId: user.id, startedAt: new Date().toISOString() };
  return ok(`已登录：${user.nickname}`, { user });
}

export function quickLogin(db, { userId }) {
  const user = S.userOf(db, userId);
  if (!user) return fail('not_found', '演示账号不存在');
  if (user.status !== 'active') return fail('suspended', '该账号已停用，不能登录');
  db.session = { userId: user.id, startedAt: new Date().toISOString() };
  return ok(`已切换为演示账号：${user.nickname}`, { user });
}

export function logout(db) {
  db.session = null;
  return ok('已退出登录');
}

export function updateProfile(db, { nickname, bio, avatar }) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const name = String(nickname || '').trim();
  if (name.length < 2 || name.length > 16) return fail('bad_nickname', '昵称需要 2–16 个字符');
  if (countChars(bio) > 120) return fail('bad_bio', '简介最多 120 字');
  user.nickname = name;
  user.bio = String(bio || '').trim();
  if (avatar) user.avatar = avatar;
  return ok('资料已更新');
}

export function updatePrefs(db, { patch = {} }) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  db.prefs = db.prefs || {};
  const next = { ...(db.prefs[user.id] || {}) };
  Object.values(NOTIFY_PREF_BY_TYPE).forEach((key) => {
    if (typeof patch[key] === 'boolean') next[key] = patch[key];
  });
  db.prefs[user.id] = next;
  return ok('通知设置已保存');
}

/* ---------- 帖子 ---------- */

function validatePostInput(db, user, input, now = Date.now()) {
  const board = BOARDS.some((b) => b.key === input.board) ? input.board : null;
  if (!board) return fail('bad_board', '请选择一个板块');

  const body = String(input.body || '').trim();
  if (!body) return fail('empty_body', '正文不能为空');
  if (body.length > 20000) return fail('body_too_long', '正文最多 20000 字符');

  const title = String(input.title || '').trim();
  if (title.length > 60) return fail('title_too_long', '标题最多 60 字符');

  const tags = Array.from(new Set((input.tags || []).map((t) => String(t).trim()).filter(Boolean)));
  if (tags.length > 3) return fail('too_many_tags', '每帖最多 3 个标签');

  let circleId = input.circleId || null;
  let courseId = input.courseId || null;

  if (circleId) {
    const circle = S.circleOf(db, circleId);
    if (!circle) return fail('circle_missing', '课友圈不存在');
    const block = S.circleWriteBlock(db, user.id, circleId, now);
    if (!block.ok) return fail(block.code, block.message);
    // 圈内课程由圈派生，忽略客户端传入的 courseId，避免挂错课程
    courseId = circle.courseId;
  } else if (courseId && !S.courseOf(db, courseId)) {
    return fail('bad_course', '这门课程不在目录里，请重新选择');
  }

  if (db.production && (!courseId || courseId === 'c_general' || !S.courseOf(db, courseId))) {
    return fail('bad_course', '请选择帖子对应的具体课程；课程圈内会自动关联课程');
  }
  const term = String(input.term || (input.resource && input.resource.term) || '通用·不限学期').trim();
  const chapter = String(input.chapter || '').trim();
  if (term.length > 30 || chapter.length > 120) return fail('bad_context', '学期最多 30 字，章节最多 120 字');
  if (db.production && !TERMS.includes(term)) return fail('bad_term', '请选择有效的适用学期');

  const images = (input.images || []).slice(0, 9);
  const attachmentInputs = (input.attachments || []).slice(0, 3);
  if ((input.attachments || []).length > 3) return fail('too_many_files', '最多 3 个 PDF 附件');

  return { ok: true, data: { board, body, title, tags, circleId, courseId, term, chapter, images, attachmentInputs } };
}

/**
 * 发布帖子；如果 input.resource 存在，同时创建资料索引（一个帖子最多一份资料）。
 */
export function createPost(db, input = {}, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  if (!user.verified) return fail('unverified', '验证邮箱后才能发布');

  const checked = validatePostInput(db, user, input, now);
  if (!checked.ok) return checked;

  const { board, body, title, tags, circleId, courseId, term, chapter, images, attachmentInputs } = checked.data;
  const resourceInput = input.resource || null;

  if (resourceInput) {
    const resourceCheck = validateResourceInput(db, resourceInput, attachmentInputs);
    if (!resourceCheck.ok) return resourceCheck;
  }

  const needsSourceConfirm = attachmentInputs.length > 0 || !!resourceInput || images.length > 0;
  if (needsSourceConfirm && input.confirmedOriginal !== true) {
    return fail('need_confirm', '上传前需要确认文档来源与分享权利：请勾选下方的来源确认');
  }

  const stickerId = input.stickerId ? String(input.stickerId) : null;
  if (stickerId && !isValidSticker(stickerId)) return fail('bad_sticker', '这个页页表情不可用');

  const postId = newId('p');
  const post = {
    id: postId,
    authorId: user.id,
    board,
    circleId,
    courseId,
    term,
    chapter,
    title: title || null,
    body,
    stickerId: stickerId || null,
    images: images.slice(),
    tags,
    status: 'published',
    publishedAt: new Date(now).toISOString(),
    editedAt: null,
    acceptedCommentId: null,
    contentUpdatedAt: new Date(now).toISOString(),
    confirmedOriginal: !!input.confirmedOriginal
  };
  db.posts.unshift(post);

  attachmentInputs.forEach((att) => {
    const id = newId('at');
    db.attachments.push({
      id,
      postId,
      kind: 'pdf',
      name: String(att.name || '未命名.pdf').slice(0, 120),
      sizeBytes: Number(att.sizeBytes) || 0,
      pages: att.pages || null,
      version: 1,
      status: att.status === 'processing' ? 'processing' : 'ready',
      path: att.path || null,
      demoPath: att.demo === false ? null : (att.path || 'assets/samples/demo-calculus-notes.pdf'),
      changeNote: '',
      demo: att.demo !== false
    });
  });

  if (resourceInput) {
    const ready = S.readyAttachments(db, postId).length > 0;
    const resource = {
      id: newId('r'),
      postId,
      title: String(resourceInput.title || '').trim(),
      courseId: circleId ? courseId : (resourceInput.courseId || courseId),
      school: resourceInput.school,
      term: resourceInput.term,
      type: resourceInput.type,
      coverage: String(resourceInput.coverage || '').trim(),
      limitations: String(resourceInput.limitations || '').trim(),
      source: String(resourceInput.source || '').trim().slice(0, 500),
      rights: String(resourceInput.rights || '').trim(),
      indexEnabled: true,
      status: ready ? 'indexed' : 'processing',
      updatedAt: new Date(now).toISOString()
    };
    db.resources.unshift(resource);
  }

  const xpBefore = levelOf(S.xpOf(db, user.id));
  evaluatePostXp(db, post, user, now);
  const xpAfter = levelOf(S.xpOf(db, user.id));
  logEvent(db, 'post_publish', { postId, board, circleId });

  return ok('已发布', {
    postId, hasResource: !!resourceInput,
    growth: growthOf(db, user.id), levelUp: levelUpOf(xpBefore, xpAfter)
  });
}

function validateResourceInput(db, resourceInput, attachmentInputs) {
  const title = String(resourceInput.title || '').trim();
  if (title.length < 4) return fail('bad_res_title', '资料标题至少 4 个字符');
  if (title.length > 80) return fail('bad_res_title', '资料标题最多 80 个字符');
  const courseId = resourceInput.courseId;
  if (!courseId || !S.courseOf(db, courseId)) {
    return fail('bad_course', '请选择这份资料对应的课程。');
  }
  // 服务端再核验一次：课程必须真实存在且不是“通用”占位，避免前端绕过
  if (courseId === 'c_general') return fail('bad_course', '请选择具体课程，不能用通用课程代替');
  if (!resourceInput.school) return fail('bad_school', '请选择学校（可用「通用·不限学校」）');
  if (!resourceInput.term) return fail('bad_term', '请选择适用学期（可用「通用·不限学期」）');
  if (!resourceInput.type) return fail('bad_type', '请选择资料类型');
  if (db.production) {
    if (resourceInput.school !== '浙江大学') return fail('bad_school', '本平台只收录浙江大学课程资料');
    if (!TERMS.includes(resourceInput.term)) return fail('bad_term', '请选择有效的适用学期');
    if (!RESOURCE_TYPES.includes(resourceInput.type)) return fail('bad_type', '请选择有效的资料类型');
    if (!['原创', '已授权', '公开许可'].includes(resourceInput.rights)) {
      return fail('bad_rights', '请选择原创、已授权或公开许可，并确认拥有分享权利');
    }
    const source = String(resourceInput.source || '').trim();
    if (source.length < 4 || source.length > 500) return fail('bad_source', '请用 4–500 字说明作者、出处或授权依据');
    if (String(resourceInput.coverage || '').length > 2000 || String(resourceInput.limitations || '').length > 2000) {
      return fail('bad_scope', '适用范围和未覆盖内容各最多 2000 字');
    }
  }
  if (countChars(resourceInput.coverage) < 4) {
    return fail('bad_coverage', '请写清适用范围（至少 4 个字符）');
  }
  if (!attachmentInputs.length) return fail('no_file', '资料至少需要 1 个 PDF 附件');
  if (resourceInput.confirmedIndex !== true) {
    return fail('need_confirm', '需要确认公开资料元信息与前两页预览');
  }
  return ok();
}

export function updatePost(db, { postId, title, body, tags, term, chapter }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const post = S.postOf(db, postId);
  if (!post) return fail('not_found', '帖子不存在');
  if (post.authorId !== user.id) return fail('forbidden', '只能编辑自己的帖子');
  if (post.status === 'removed') return fail('removed', '帖子已删除，不能编辑');
  if (post.circleId) {
    const block = S.circleWriteBlock(db, user.id, post.circleId);
    if (!block.ok) return fail(block.code, block.message);
  }
  const nextBody = String(body == null ? post.body : body).trim();
  if (!nextBody) return fail('empty_body', '正文不能为空');
  if (nextBody.length > 20000) return fail('body_too_long', '正文最多 20000 字符');
  const nextTitle = String(title == null ? post.title || '' : title).trim();
  if (nextTitle.length > 60) return fail('title_too_long', '标题最多 60 字符');
  const nextTags = tags ? Array.from(new Set(tags.map((t) => String(t).trim()).filter(Boolean))).slice(0, 3) : post.tags;

  if (term !== undefined && (String(term).length > 30 || (db.production && !TERMS.includes(term)))) {
    return fail('bad_term', '请选择有效的适用学期');
  }
  if (chapter !== undefined && String(chapter).length > 120) return fail('bad_context', '章节最多 120 字');
  if (term !== undefined) post.term = String(term).trim();
  if (chapter !== undefined) post.chapter = String(chapter).trim();
  post.body = nextBody;
  post.title = nextTitle || null;
  post.tags = nextTags;
  post.editedAt = new Date(now).toISOString();
  post.contentUpdatedAt = post.editedAt;

  if (post.acceptedCommentId) {
    const accepted = S.byId(db.comments, post.acceptedCommentId);
    if (!accepted || accepted.status !== 'visible') post.acceptedCommentId = null;
  }
  return ok('已保存修改');
}

/* ---------- 资料草稿与课程补选（9.1） ---------- */

/**
 * 保存资料草稿：允许暂不选课程，但草稿只存在 db.drafts 里，
 * 不会生成 post/resource，因此不会进入信息流、课程页或搜索。
 */
export function saveResourceDraft(db, input = {}, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  if (!user.verified) return fail('unverified', '验证邮箱后才能保存草稿');
  if (!db.drafts || typeof db.drafts !== 'object') db.drafts = {};
  const resource = input.resource || {};
  const draft = {
    resource: {
      title: String(resource.title || '').slice(0, 80),
      courseId: resource.courseId ? String(resource.courseId) : null,
      school: resource.school || '',
      term: resource.term || '',
      type: resource.type || '',
      coverage: String(resource.coverage || ''),
      limitations: String(resource.limitations || '')
    },
    postTitle: String(input.postTitle || '').slice(0, 60),
    body: String(input.body || ''),
    updatedAt: new Date(now).toISOString()
  };
  db.drafts[user.id] = draft;
  return ok(
    draft.resource.courseId ? '草稿已保存' : '草稿已保存；选好课程后才能正式发布',
    { draft }
  );
}

export function clearResourceDraft(db) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  if (db.drafts && db.drafts[user.id]) delete db.drafts[user.id];
  return ok('草稿已清除');
}

/** 历史资料缺课程：作者补选主课程（不改变文件、评论与领取记录） */
export function setResourceCourse(db, { resourceId, courseId } = {}, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const resource = S.resourceOf(db, resourceId);
  if (!resource) return fail('not_found', '资料不存在');
  const post = S.postOf(db, resource.postId);
  if (!post) return fail('not_found', '原帖不存在');
  if (post.authorId !== user.id) return fail('forbidden', '只有作者可以补选课程');
  if (!courseId || courseId === 'c_general' || !S.courseOf(db, courseId)) {
    return fail('bad_course', '请选择这份资料对应的课程。');
  }
  resource.courseId = courseId;
  resource.updatedAt = new Date(now).toISOString();
  // 只在原帖没有课程时补上，避免把圈内帖子改挂到别的课程
  if (!post.courseId) post.courseId = courseId;
  post.contentUpdatedAt = new Date(now).toISOString();
  return ok('已补上主课程', { resourceId, courseId });
}

/** 作者删除 / 管理员永久移除：资料立即退出索引，已赠页签按记录退回 */
export function removePost(db, { postId, reason = '' }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const post = S.postOf(db, postId);
  if (!post) return fail('not_found', '帖子不存在');
  const isAdmin = user.role === 'admin';
  if (post.authorId !== user.id && !isAdmin) return fail('forbidden', '只能删除自己的内容');

  if (post.status === 'removed') return fail('already_removed', '这篇内容已经是移除状态');
  post.status = 'removed';
  post.removedAt = new Date(now).toISOString();
  post.removedBy = user.id;
  post.removedReason = reason || null;

  const resource = S.resourceForPost(db, postId);
  if (resource) {
    resource.status = 'blocked';
    resource.indexEnabled = false;
  }
  db.attachments.forEach((a) => {
    if (a.postId === postId) a.status = 'removed';
  });

  revokeDecision(db, findDecision(db, 'post', postId, post.authorId), '帖子被永久移除', now);
  const acceptedDecision = decisionsOf(db).find((d) => d.type === 'accepted'
    && (d.meta || {}).postId === postId && d.status === 'granted');
  revokeDecision(db, acceptedDecision, '帖子被永久移除，采纳奖励冲正', now);

  const refunds = refundGiftsForPost(db, post, now);
  if (isAdmin) audit(db, user.id, '永久移除内容', `帖子 ${postId}`, reason || '未填写原因');
  logEvent(db, 'post_removed', { postId });

  return ok(
    refunds.count
      ? `已移除，${refunds.count} 笔赠签进入退款（已入账）`
      : '已移除',
    { refunds }
  );
}

function refundGiftsForPost(db, post, now) {
  const active = (db.gifts || []).filter((g) => g.postId === post.id && g.status === 'active');
  active.forEach((gift) => {
    gift.status = 'refunded';
    revokeDecision(db, findDecision(db, 'marker', gift.id, gift.receiverId), '帖子移除，页签已退回', now);
    const id = addLedger(db, gift.senderId, 'gift_refund', gift.qty, now, gift.id, '帖子移除退回');
    gift.refundLedgerId = id;
    notifyUser(db, {
      userId: gift.senderId, actorId: null, type: 'refund', postId: post.id,
      text: `你送出的 ${gift.qty} 枚页签已按规则退回（原帖已永久移除）。`, createdAt: new Date(now).toISOString()
    });
  });
  return { count: active.length, qty: active.reduce((sum, g) => sum + g.qty, 0) };
}

/* ---------- 互动 ---------- */

export function toggleReaction(db, { postId, kind }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  if (!user.verified) return fail('unverified', '验证邮箱后才能互动');
  if (!['like', 'save'].includes(kind)) return fail('bad_kind', '未知的互动类型');
  const post = S.postOf(db, postId);
  if (!S.isVisiblePost(post)) return fail('not_found', '这篇内容当前不可见');
  if (kind === 'like' && post.authorId === user.id) return fail('self_like', '不能给自己的内容点赞');

  const existing = S.reactionOf(db, user.id, postId, kind);
  if (existing) {
    db.reactions = db.reactions.filter((r) => r !== existing);
    return ok(kind === 'like' ? '已取消赞' : '已取消收藏', { active: false });
  }
  db.reactions.push({
    userId: user.id, postId, kind, createdAt: new Date(now).toISOString()
  });
  return ok(kind === 'like' ? '已点赞' : '已收藏', { active: true });
}

export function toggleFollowUser(db, { targetUserId }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  if (targetUserId === user.id) return fail('self_follow', '不能关注自己');
  return toggleFollow(db, user.id, 'user', targetUserId, now);
}

export function toggleFollowCourse(db, { courseId }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  return toggleFollow(db, user.id, 'course', courseId, now);
}

function toggleFollow(db, followerId, targetType, targetId, now) {
  const existing = (db.follows || []).find(
    (f) => f.followerId === followerId && f.targetType === targetType && f.targetId === targetId
  );
  if (existing) {
    db.follows = db.follows.filter((f) => f !== existing);
    return ok(targetType === 'user' ? '已取消关注' : '已取消关注课程', { active: false });
  }
  db.follows.push({ followerId, targetType, targetId, createdAt: new Date(now).toISOString() });
  return ok(targetType === 'user' ? '已关注' : '已关注课程', { active: true });
}

/* ---------- 评论 ---------- */

export function addComment(db, input = {}, now = Date.now()) {
  const { postId, body, parentId: inputParentId = null, stickerId: inputSticker = null } = input;
  let parentId = inputParentId;
  let replyToUserId = input.replyToUserId || null;
  const user = me(db);
  if (!user) return fail('login', '请先登录后参与讨论');
  const post = S.postOf(db, postId);
  if (!S.isVisiblePost(post)) return fail('not_found', '这篇内容当前不可见');

  const text = String(body || '').trim();
  const stickerId = input && input.stickerId ? String(input.stickerId) : null;
  if (stickerId && !isValidSticker(stickerId)) return fail('bad_sticker', '这个页页表情不可用');
  if (!text && !stickerId) return fail('empty_comment', '评论不能为空（可以只发一个页页表情）');
  if (text.length > 2000) return fail('comment_too_long', '评论最多 2000 字符');

  if (post.circleId) {
    const isMember = S.isActiveMember(db, user.id, post.circleId);
    const hasPublicResource = S.resourceEligibility(db, S.resourceForPost(db, postId)).ok;
    if (isMember) {
      const block = S.circleWriteBlock(db, user.id, post.circleId, now);
      if (!block.ok) return fail(block.code, block.message);
    } else if (!hasPublicResource) {
      return fail('not_member', '加入这个课友圈后才能评论普通帖子；公开资料帖可以纠错');
    } else {
      const block = S.resourceCommentBlock(db, user.id, post, now);
      if (!block.ok) return fail(block.code, block.message);
    }
  } else if (!user.verified) {
    return fail('unverified', '验证邮箱后才能评论');
  }

  let parent = null;
  if (parentId) {
    parent = S.byId(db.comments, parentId);
    if (!parent || parent.postId !== postId || parent.status !== 'visible') {
      return fail('bad_parent', '要回复的评论已不可见');
    }
    if (parent.parentId) {
      // 只做两层：回复二级评论时，挂到它的主评论下并记录被回复用户
      replyToUserId = parent.authorId;
      parentId = parent.parentId;
      parent = S.byId(db.comments, parentId);
    } else if (!replyToUserId) {
      replyToUserId = parent.authorId;
    }
  }

  const comment = {
    id: newId('cm'),
    postId,
    authorId: user.id,
    parentId,
    replyToUserId: replyToUserId || null,
    body: text,
    stickerId: stickerId || null,
    status: 'visible',
    createdAt: new Date(now).toISOString(),
    editedAt: null
  };
  db.comments.push(comment);
  post.contentUpdatedAt = new Date(now).toISOString();

  const xpBefore = levelOf(S.xpOf(db, user.id));
  evaluateCommentXp(db, post, comment, user, now);
  const xpAfter = levelOf(S.xpOf(db, user.id));

  notifyUser(db, {
    userId: post.authorId, actorId: user.id, type: 'reply', postId, commentId: comment.id,
    text: `${parent ? '回复了帖子里的讨论' : '评论了你的帖子'}：${text.slice(0, 40)}`,
    createdAt: comment.createdAt
  });
  if (replyToUserId && replyToUserId !== post.authorId) {
    notifyUser(db, {
      userId: replyToUserId, actorId: user.id, type: 'reply', postId, commentId: comment.id,
      text: `回复了你的评论：${text.slice(0, 40)}`, createdAt: comment.createdAt
    });
  }
  logEvent(db, 'comment_create', { postId });
  return ok('评论已发布', {
    comment, growth: growthOf(db, user.id), levelUp: levelUpOf(xpBefore, xpAfter)
  });
}

export function removeComment(db, { commentId, reason = '' }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const comment = S.byId(db.comments, commentId);
  if (!comment) return fail('not_found', '评论不存在');
  if (comment.authorId !== user.id && user.role !== 'admin') {
    return fail('forbidden', '只能删除自己的评论');
  }
  comment.status = 'removed';
  comment.removedAt = new Date(now).toISOString();
  revokeDecision(db, findDecision(db, 'comment', commentId, comment.authorId), '评论被删除', now);
  const acceptedOnComment = decisionsOf(db).find((d) => d.type === 'accepted'
    && d.sourceId === commentId && d.status === 'granted');
  revokeDecision(db, acceptedOnComment, '评论被删除，采纳奖励冲正', now);
  const parentPost = S.postOf(db, comment.postId);
  if (parentPost && parentPost.acceptedCommentId === commentId) {
    parentPost.acceptedCommentId = null;
    parentPost.contentUpdatedAt = new Date(now).toISOString();
  }
  if (user.role === 'admin') audit(db, user.id, '移除评论', `评论 ${commentId}`, reason || '未填写原因');
  return ok('评论已删除');
}

export function acceptComment(db, { postId, commentId }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const post = S.postOf(db, postId);
  if (!post) return fail('not_found', '帖子不存在');
  if (post.authorId !== user.id) return fail('forbidden', '只有作者可以采纳回答');
  if (post.board !== 'help') return fail('not_help', '只有学习求助帖可以采纳回答');
  const comment = S.byId(db.comments, commentId);
  if (!comment || comment.postId !== postId || comment.status !== 'visible') {
    return fail('not_found', '要采纳的评论已不可见');
  }
  if (comment.authorId === user.id) return fail('self_accept', '不能采纳自己的评论');
  if (post.acceptedCommentId && post.acceptedCommentId !== commentId) {
    return fail('already_accepted', '已采纳过一条回答，请先取消原采纳');
  }
  if (post.acceptedCommentId === commentId) return ok('这条回答已采纳');

  post.acceptedCommentId = commentId;
  post.contentUpdatedAt = new Date(now).toISOString();
  const xpBefore = levelOf(S.xpOf(db, comment.authorId));
  evaluateAcceptedXp(db, post, comment, now);
  const xpAfter = levelOf(S.xpOf(db, comment.authorId));
  notifyUser(db, {
    userId: comment.authorId, actorId: user.id, type: 'accepted', postId, commentId,
    text: '你的回答被作者采纳了。', createdAt: new Date(now).toISOString()
  });
  return ok('已采纳', {
    growth: growthOf(db, user.id), levelUp: levelUpOf(xpBefore, xpAfter)
  });
}

export function unacceptComment(db, { postId }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const post = S.postOf(db, postId);
  if (!post || post.authorId !== user.id) return fail('forbidden', '只有作者可以取消采纳');
  if (!post.acceptedCommentId) return fail('nothing', '当前没有采纳记录');
  const comment = S.byId(db.comments, post.acceptedCommentId);
  if (comment) {
    const decision = decisionsOf(db).find((d) => d.type === 'accepted'
      && (d.meta || {}).postId === post.id && d.userId === comment.authorId);
    if (decision) {
      revokeDecision(db, decision, '作者取消采纳', now);
    } else {
      // 旧数据只有流水，没有决策：直接冲正原流水
      const row = (db.xp || []).find((x) => x.userId === comment.authorId
        && x.sourceType === 'accepted' && x.sourceId === comment.id && !x.revoked);
      if (row) {
        row.revoked = true;
        pushXpEvent(db, {
          userId: row.userId, type: 'accepted', sourceId: row.sourceId,
          delta: -row.delta, kind: 'revoke', reason: '作者取消采纳', now
        });
      }
    }
  }
  post.acceptedCommentId = null;
  post.contentUpdatedAt = new Date(now).toISOString();
  return ok('已取消采纳，可以改选其他回答');
}

/* ---------- 课友圈 ---------- */

export function joinCircle(db, { circleId, code = null }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录后再加入课友圈');
  if (!user.verified) return fail('unverified', '验证邮箱后才能加入课友圈');
  const circle = S.circleOf(db, circleId);
  if (!circle) return fail('not_found', '课友圈不存在');
  if (circle.status === 'archived') return fail('archived', '这个圈已归档，不能新加入；历史内容仍可公开阅读');

  const existing = S.membership(db, user.id, circleId);
  if (existing && existing.status === 'active') return ok('你已经在这个圈里了', { already: true });
  if (existing && existing.status === 'removed') {
    return fail('removed_member', '你曾被移出这个圈，需要管理员解除限制后才能重新加入');
  }
  if (existing) {
    existing.status = 'active';
    existing.joinedAt = new Date(now).toISOString();
    existing.lastSeenAt = new Date(now).toISOString();
  } else {
    db.memberships.push({
      userId: user.id, circleId, status: 'active', muted: false, shelved: false,
      joinedAt: new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString(),
      writeRestricted: false
    });
  }
  if (code) {
    const invite = (db.inviteVisits || []).find((v) => v.code === code);
    if (invite) invite.joined = true;
  }
  logEvent(db, 'circle_join', { circleId });
  return ok('已加入课友圈', { joined: true });
}

export function leaveCircle(db, { circleId }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const m = S.membership(db, user.id, circleId);
  if (!m || m.status !== 'active') return fail('not_member', '你还没有加入这个圈');
  m.status = 'left';
  m.leftAt = new Date(now).toISOString();
  return ok('已退出，你会立刻从「我的课友圈」聚合流中消失；已发布内容仍保留');
}

export function setCircleFlag(db, { circleId, flag, value }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  if (!['muted', 'shelved'].includes(flag)) return fail('bad_flag', '未知设置');
  const m = S.membership(db, user.id, circleId);
  if (!m || m.status !== 'active') return fail('not_member', '需要先加入这个圈');
  m[flag] = !!value;
  if (flag === 'muted' && value) {
    return ok('已静音：不再出现新动态提示，你仍可主动打开');
  }
  if (flag === 'shelved' && value) {
    return ok('已移到往期：不再进入聚合流，仍可随时回访');
  }
  m.updatedAt = new Date(now).toISOString();
  return ok(flag === 'muted' ? '已取消静音' : '已移回常用圈');
}

export function markCircleSeen(db, { circleId }, now = Date.now()) {
  const user = me(db);
  if (!user) return ok('', { skipped: true });
  const m = S.membership(db, user.id, circleId);
  if (!m) return ok('', { skipped: true });
  const latest = (db.posts || [])
    .filter((p) => p.circleId === circleId && p.status === 'published')
    .reduce((max, p) => Math.max(max, new Date(p.publishedAt).getTime()), 0);
  const stamp = Math.min(now, latest || now);
  const prev = m.lastSeenAt ? new Date(m.lastSeenAt).getTime() : 0;
  if (stamp > prev) m.lastSeenAt = new Date(stamp).toISOString();
  return ok('', { lastSeenAt: m.lastSeenAt });
}

const normalizeCourseName = (name) => String(name || '').replace(/\s+/g, '').toLowerCase();

function findCourseByName(db, name) {
  const target = normalizeCourseName(name);
  return (db.courses || []).find((course) => normalizeCourseName(course.name) === target) || null;
}

/** 申请建圈：可以选目录里的课程，也可以写目录里还没有的课程名 */
export function submitApplication(db, { courseId, courseName = '', reason = '' }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const name = String(courseName || '').trim();
  let course = courseId ? S.courseOf(db, courseId) : null;
  if (courseId && !course) return fail('bad_course', '请选择已有课程');
  if (!course) {
    if (name.length < 2 || name.length > 40) return fail('bad_course', '课程名称需要 2–40 个字符');
    course = findCourseByName(db, name);
  }
  if (course && S.circleOfCourse(db, course.id)) return fail('duplicate', '这门课已经有课友圈了，直接加入即可');
  const finalName = course ? course.name : name;

  db.applications = db.applications || [];
  const existing = db.applications.find((a) => a.applicantId === user.id && a.state === 'pending'
    && normalizeCourseName(a.courseName || (S.courseOf(db, a.courseId) || {}).name) === normalizeCourseName(finalName));
  if (existing) return ok('这份申请已经在等待审核', { application: existing });
  const application = {
    id: newId('ap'), applicantId: user.id, courseId: course ? course.id : null, courseName: finalName,
    reason: String(reason || '').slice(0, 200),
    state: 'pending', createdAt: new Date(now).toISOString(), reviewerId: null
  };
  db.applications.push(application);
  return ok('建圈申请已提交，等待管理员审核');
}

export function reviewApplication(db, { applicationId, approved, reason = '' }, now = Date.now()) {
  const admin = me(db);
  if (!admin || admin.role !== 'admin') return fail('forbidden', '只有管理员可以审核建圈申请');
  const application = S.byId(db.applications, applicationId);
  if (!application || application.state !== 'pending') return fail('not_found', '待审核申请不存在');
  if (!String(reason).trim()) return fail('need_reason', '请填写审核理由');
  let circle = S.circleOfCourse(db, application.courseId);
  if (approved === true && !circle) {
    const created = createCircle(db, { courseId: application.courseId }, now);
    if (!created.ok) return created;
    circle = created.data.circle;
  }
  application.state = approved === true ? 'approved' : 'rejected';
  application.reviewerId = admin.id;
  application.reviewedAt = new Date(now).toISOString();
  application.reviewReason = String(reason).trim().slice(0, 500);
  audit(db, admin.id, approved === true ? '批准建圈申请' : '拒绝建圈申请', application.id, application.reviewReason);
  notifyUser(db, { userId: application.applicantId, actorId: null, type: 'system',
    text: `你的建圈申请已${approved === true ? '通过' : '拒绝'}：${application.reviewReason}`,
    createdAt: new Date(now).toISOString() });
  return ok('已完成审核', { circleId: circle ? circle.id : null });
}

/** 通知静音由用户自己决定；发言限制仅可由管理员修改，退出重入也不清除。 */
export function setCircleRestriction(db, { circleId, userId, restricted, reason = '' }, now = Date.now()) {
  const admin = me(db);
  if (!admin || admin.role !== 'admin') return fail('forbidden', '只有管理员可以修改发言限制');
  const member = S.membership(db, userId, circleId);
  if (!member) return fail('not_found', '该成员记录不存在');
  if (!String(reason).trim()) return fail('need_reason', '请填写处理理由');
  member.moderationMuted = restricted === true;
  member.writeRestricted = restricted === true;
  member.restrictionReason = String(reason).trim().slice(0, 500);
  member.restrictedAt = new Date(now).toISOString();
  audit(db, admin.id, restricted === true ? '限制圈内发言' : '解除圈内限制', `${circleId}/${userId}`, member.restrictionReason);
  notifyUser(db, { userId, actorId: null, type: 'system',
    text: `课程圈发言限制已${restricted === true ? '开启' : '解除'}：${member.restrictionReason}`,
    createdAt: new Date(now).toISOString() });
  return ok(restricted === true ? '已限制圈内发言' : '已解除发言限制');
}

/** 管理员处理建圈申请：通过时按需新增课程并建圈，驳回时必须写理由 */
export function resolveApplication(db, { applicationId, action, reason = '' }, now = Date.now()) {
  const user = me(db);
  if (!user || user.role !== 'admin') return fail('forbidden', '只有管理员可以处理建圈申请');
  const application = S.byId(db.applications, applicationId);
  if (!application) return fail('not_found', '申请不存在');
  if (application.state !== 'pending') return fail('closed', '这份申请已经处理过');
  const courseName = application.courseName || (S.courseOf(db, application.courseId) || {}).name || '';
  const stamp = new Date(now).toISOString();

  if (action === 'reject') {
    const note = String(reason || '').trim();
    if (!note) return fail('no_reason', '驳回时需要写明理由');
    Object.assign(application, { state: 'rejected', reviewerId: user.id, reviewedAt: stamp, resolution: note });
    audit(db, user.id, '驳回建圈申请', `申请 ${application.id}`, note);
    notifyUser(db, {
      userId: application.applicantId, actorId: null, type: 'system', createdAt: stamp,
      text: `「${courseName}」的建圈申请未通过：${note}`
    });
    return ok('已驳回申请');
  }
  if (action !== 'approve') return fail('bad_action', '未知的处理方式');

  let course = S.courseOf(db, application.courseId) || findCourseByName(db, courseName);
  if (!course) {
    const sample = (db.courses || []).find((item) => item.id !== 'c_general');
    course = {
      id: newId('c'), school: sample ? sample.school : SCHOOLS[0],
      name: courseName, code: '', category: '同学申请'
    };
    db.courses.push(course);
  }
  let circle = S.circleOfCourse(db, course.id);
  if (!circle) {
    const created = createCircle(db, { courseId: course.id }, now);
    if (!created.ok) return created;
    circle = created.data.circle;
  }
  Object.assign(application, {
    state: 'approved', courseId: course.id, circleId: circle.id, reviewerId: user.id, reviewedAt: stamp
  });
  audit(db, user.id, '通过建圈申请', `申请 ${application.id}`, course.name);
  notifyUser(db, {
    userId: application.applicantId, actorId: null, type: 'system', createdAt: stamp,
    text: `「${course.name}」的课友圈已开通，可以去加入了。`
  });
  return ok('已通过申请并开通课友圈', { circleId: circle.id });
}

/* ---------- 资料 ---------- */

export function setResourceIndex(db, { resourceId, enabled }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const resource = S.resourceOf(db, resourceId);
  if (!resource) return fail('not_found', '资料不存在');
  const post = S.postOf(db, resource.postId);
  if (!post || post.authorId !== user.id) return fail('forbidden', '只有作者可以调整公开索引');

  if (enabled) {
    resource.indexEnabled = true;
    resource.status = S.readyAttachments(db, post.id).length ? 'indexed' : 'processing';
    if (resource.status === 'indexed') {
      notifyUser(db, {
        userId: user.id, actorId: null, type: 'system', postId: post.id,
        text: '资料已重新收录到找资料索引。', createdAt: new Date(now).toISOString()
      });
      return ok('已重新收录到找资料');
    }
    return ok('已开启收录，文件处理完成后自动进入索引');
  }
  resource.indexEnabled = false;
  resource.status = 'unindexed';
  resource.updatedAt = new Date(now).toISOString();
  return ok('已取消公开索引；原帖与讨论仍在，附件照常可从原帖访问');
}

export function finishAttachmentProcessing(db, { attachmentId }, now = Date.now()) {
  const att = S.byId(db.attachments, attachmentId);
  if (!att) return fail('not_found', '附件不存在');
  if (att.status !== 'processing') return ok('', { skipped: true });
  att.status = 'ready';
  att.path = att.demoPath || 'assets/samples/demo-calculus-notes.pdf';
  att.pages = att.pages || 12;
  const post = S.postOf(db, att.postId);
  if (post) post.contentUpdatedAt = new Date(now).toISOString();
  const resource = S.resourceForPost(db, att.postId);
  if (resource && resource.indexEnabled && post && post.status === 'published' && S.readyAttachments(db, post.id).length) {
    resource.status = 'indexed';
    resource.updatedAt = new Date(now).toISOString();
    notifyUser(db, {
      userId: post.authorId, actorId: null, type: 'system', postId: post.id,
      text: '附件处理完成（演示），资料已进入找资料索引。', createdAt: new Date(now).toISOString()
    });
  }
  return ok('附件处理完成（演示）');
}

export function downloadResource(db, { postId, attachmentId }, now = Date.now()) {
  const user = me(db);
  const post = S.postOf(db, postId);
  if (!S.isVisiblePost(post)) return fail('not_found', '附件已不可用');
  const att = S.byId(db.attachments, attachmentId);
  if (!att || att.postId !== postId) return fail('not_found', '附件不存在');
  if (att.status !== 'ready' || !att.path) {
    return fail('not_ready', '文件还在处理中或已失效，暂时不能下载');
  }
  if (!user) return fail('login', '登录后即可下载；下载不要求加入课友圈');
  if (!user.verified) return fail('unverified', '验证邮箱后才能下载完整文件');
  if (user.status !== 'active') return fail('suspended', '账号停用期间不能下载');

  const resource = S.resourceForPost(db, postId);
  logEvent(db, 'resource_download_authorized', { resourceId: resource ? resource.id : null, postId });
  return ok(att.demo === false ? '已开始下载' : '已开始下载（演示示例文件）', { path: att.path, name: att.name });
}

/* ---------- 页签 ---------- */

function addLedger(db, userId, type, delta, now, sourceId, note) {
  if (!db.wallets) db.wallets = {};
  const prev = db.wallets[userId] ? db.wallets[userId].balance : 0;
  const balanceAfter = prev + delta;
  db.wallets[userId] = { userId, balance: balanceAfter, updatedAt: new Date(now).toISOString() };
  const entry = {
    id: newId('lg'), userId, delta, type, sourceId, balanceAfter,
    at: new Date(now).toISOString(), note
  };
  if (!db.ledger) db.ledger = [];
  db.ledger.push(entry);
  return entry.id;
}

export function claimDaily(db, payload = {}, now = Date.now()) {
  const stamp = Number.isFinite(now) ? now : Date.now();
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const state = S.claimState(db, user.id, stamp);
  if (state.code === 'unverified') return fail('unverified', '验证邮箱后才能领取页签');
  if (state.code === 'suspended') return fail('suspended', '账号停用期间不能领取');
  if (state.code === 'claimed') return fail('claimed', '今天已经领过了，明日零点后可再领');
  if (state.code === 'full') return fail('full', '页签已存满 30 枚，送出后再领');

  const today = shanghaiDate(new Date(stamp));
  const ledgerId = addLedger(db, user.id, 'claim', 1, stamp, null, '每日领取');
  db.claims = db.claims || [];
  db.claims.push({ userId: user.id, date: today, ledgerId, at: new Date(stamp).toISOString() });
  return ok(`已领取今日页签，当前 ${S.walletOf(db, user.id)} 枚可送`, {
    balance: S.walletOf(db, user.id),
    date: today,
    quote: quoteOfDay(today),
    bookmark: bookmarkOfDay(today)
  });
}

export function sendGift(db, { postId, qty = 1, idemKey = null }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  if (!user.verified) return fail('unverified', '验证邮箱后才能赠送');
  const amount = Number(qty);
  if (![1, 2].includes(amount)) return fail('bad_qty', '一次只能送 1 或 2 枚');
  const post = S.postOf(db, postId);
  if (!S.isVisiblePost(post)) return fail('not_found', '这篇内容当前不可赠签');
  if (post.authorId === user.id) return fail('self_gift', '不能给自己的帖子送页签');

  const key = idemKey || newId('idem');
  db.gifts = db.gifts || [];
  const same = db.gifts.find((g) => g.senderId === user.id && g.idemKey === key);
  if (same) {
    if (same.postId === postId && same.qty === amount) {
      return ok('这笔赠送已处理过，未重复扣款', { gift: same, duplicate: true });
    }
    return fail('idem_conflict', '同一幂等键的参数不一致，已拒绝');
  }

  const availability = S.giftAvailability(db, user.id, post, now);
  if (!availability.ok) {
    const codeMap = {
      '可送余额不足': 'insufficient', '不能给自己的帖子送页签': 'self_gift'
    };
    return fail(codeMap[availability.message] || 'limit', availability.message);
  }
  if (availability.balance < amount) return fail('insufficient', '可送余额不足');

  const gift = {
    id: newId('g'),
    senderId: user.id,
    receiverId: post.authorId,
    postId,
    qty: amount,
    day: shanghaiDate(new Date(now)),
    status: 'active',
    idemKey: key,
    createdAt: new Date(now).toISOString()
  };
  db.gifts.push(gift);
  addLedger(db, user.id, 'gift_out', -amount, now, postId, '赠送页签');
  evaluateMarkerXp(db, gift, now);
  notifyUser(db, {
    userId: post.authorId, actorId: user.id, type: 'gift', postId,
    text: `给你的「${post.title || '分享'}」送了 ${amount} 枚页签。`, createdAt: gift.createdAt
  });
  logEvent(db, 'gift_sent', { postId, qty: amount });
  const balance = S.walletOf(db, user.id);
  return ok(`已送出 ${amount} 枚，当前 ${balance} 枚可送`, { gift, balance });
}

/* ---------- 通知 ---------- */

export function markNotificationRead(db, { notificationId }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const n = S.byId(db.notifications, notificationId);
  if (!n || n.userId !== user.id) return fail('forbidden', '不能修改别人的消息');
  if (!n.readAt) n.readAt = new Date(now).toISOString();
  return ok('已读', {});
}

export function markAllNotificationsRead(db, payload = {}, now = Date.now()) {
  const stamp = Number.isFinite(now) ? now : Date.now();
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  (db.notifications || []).forEach((n) => {
    if (n.userId === user.id && !n.readAt) n.readAt = new Date(stamp).toISOString();
  });
  return ok('全部标为已读');
}

/* ---------- 私信 ---------- */

export function sendDirectMessage(db, { recipientId, body }, now = Date.now()) {
  const sender = me(db);
  if (!sender) return fail('login', '请先登录');
  if (sender.status !== 'active') return fail('suspended', '账号已停用，不能发送私信');
  if (!sender.verified) return fail('unverified', '验证邮箱后才能发送私信');

  const recipient = S.userOf(db, String(recipientId || ''));
  if (!recipient || recipient.status !== 'active') return fail('bad_recipient', '这个账号当前不可接收私信');
  if (recipient.id === sender.id) return fail('self_message', '不能给自己发送私信');
  if (S.blockedBy(db, sender.id, recipient.id)) return fail('blocked', '你已拉黑对方，取消拉黑后才能发私信');
  if (S.blockedBy(db, recipient.id, sender.id)) return fail('blocked', '对方暂时不接收你的私信');

  const text = String(body || '').trim();
  if (!text) return fail('empty_message', '私信内容不能为空');
  if (text.length > 2000) return fail('message_too_long', '私信最多 2000 字符');

  if (!Array.isArray(db.directMessages)) db.directMessages = [];
  const message = {
    id: newId('dm'), senderId: sender.id, recipientId: recipient.id,
    body: text, createdAt: new Date(now).toISOString(), readAt: null
  };
  db.directMessages.push(message);
  return ok('私信已发送', { messageId: message.id });
}

export function markDirectMessagesRead(db, { peerId }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const peer = S.userOf(db, String(peerId || ''));
  if (!peer || peer.id === user.id) return fail('bad_recipient', '对话对象无效');

  const stamp = new Date(Number.isFinite(now) ? now : Date.now()).toISOString();
  let changed = 0;
  (db.directMessages || []).forEach((message) => {
    if (message.senderId === peer.id && message.recipientId === user.id && !message.readAt) {
      message.readAt = stamp;
      changed += 1;
    }
  });
  return ok(changed ? '已标为已读' : '', { changed });
}

/* ---------- 举报与审核 ---------- */

export function reportContent(db, { targetType, targetId, reason, detail = '' }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录后再举报');
  if (!['post', 'comment', 'dm'].includes(targetType)) return fail('bad_target', '未知的举报对象');
  if (!reason) return fail('no_reason', '请选择举报原因');

  // 私信举报：只附上对方发给举报人的最近 10 条，管理员看不到举报人没收到的内容
  let evidence;
  if (targetType === 'dm') {
    const peer = S.userOf(db, String(targetId || ''));
    if (!peer || peer.id === user.id) return fail('not_found', '举报对象不存在');
    evidence = (db.directMessages || [])
      .filter((row) => row.senderId === peer.id && row.recipientId === user.id && row.status !== 'removed')
      .slice(-10)
      .map((row) => ({ id: row.id, body: row.body, createdAt: row.createdAt }));
    if (!evidence.length) return fail('no_evidence', '对方还没有给你发过私信，没有可举报的内容');
  } else {
    const target = targetType === 'post' ? S.postOf(db, targetId) : S.byId(db.comments, targetId);
    if (!target) return fail('not_found', '举报对象不存在');
  }

  db.reports = db.reports || [];
  const duplicated = db.reports.some(
    (r) => r.reporterId === user.id && r.targetType === targetType && r.targetId === targetId && r.status === 'open'
  );
  if (duplicated) return ok('你已经举报过，平台会处理这一条', {});
  db.reports.push({
    id: newId('rp'), reporterId: user.id, targetType, targetId, reason: String(reason).slice(0, 40),
    detail: String(detail || '').slice(0, 500), status: 'open', resolution: null,
    handledBy: null, createdAt: new Date(now).toISOString(),
    ...(evidence ? { evidence } : {})
  });
  return ok('已提交举报，平台会核查');
}

export function resolveReport(db, { reportId, action, reason = '' }, now = Date.now()) {
  const user = me(db);
  if (!user || user.role !== 'admin') return fail('forbidden', '只有管理员可以处理举报');
  const report = S.byId(db.reports, reportId);
  if (!report) return fail('not_found', '举报不存在');
  if (report.status !== 'open') return fail('closed', '这条举报已经处理过');
  if (!String(reason || '').trim()) return fail('no_reason', '必须记录处理理由');
  if (report.targetType === 'dm') return resolveDmReport(db, user, report, action, reason, now);

  const target = report.targetType === 'post'
    ? S.postOf(db, report.targetId)
    : S.byId(db.comments, report.targetId);
  if (!target) return fail('not_found', '举报对象已不存在');

  if (action === 'dismiss') {
    report.status = 'dismissed';
    report.resolution = reason;
  } else if (action === 'hide') {
    target.status = 'hidden';
    report.status = 'hidden';
    report.resolution = reason;
    if (report.targetType === 'post') {
      const resource = S.resourceForPost(db, report.targetId);
      if (resource) resource.status = 'blocked';
      db.attachments.forEach((a) => {
        if (a.postId === report.targetId) a.downloadBlocked = true;
      });
    }
  } else if (action === 'remove') {
    report.status = 'removed';
    report.resolution = reason;
    if (report.targetType === 'post') {
      const result = removePost(db, { postId: report.targetId, reason }, now);
      if (!result.ok && result.code !== 'already_removed') return result;
    } else {
      target.status = 'removed';
    }
  } else if (action === 'restore') {
    target.status = report.targetType === 'post' ? 'published' : 'visible';
    report.status = 'dismissed';
    report.resolution = reason;
    if (report.targetType === 'post') {
      const resource = S.resourceForPost(db, report.targetId);
      if (resource && resource.indexEnabled) resource.status = 'indexed';
      db.attachments.forEach((a) => {
        if (a.postId === report.targetId) a.downloadBlocked = false;
      });
    }
  } else {
    return fail('bad_action', '未知的处理方式');
  }

  report.handledBy = user.id;
  report.handledAt = new Date(now).toISOString();
  audit(db, user.id, `举报处理：${action}`, `${report.targetType} ${report.targetId}`, reason);

  const authorId = report.targetType === 'post' ? target.authorId : target.authorId;
  notifyUser(db, {
    userId: authorId, actorId: null, type: 'system',
    postId: report.targetType === 'post' ? report.targetId : target.postId,
    text: action === 'dismiss'
      ? '有人举报你的内容，平台核查后未作处理。'
      : `你的内容被处理（${reason}），如有异议可在站内申诉。`,
    createdAt: new Date(now).toISOString()
  });
  return ok('已处理并记录审计');
}

/* 私信举报只有两种处理：删除这些私信，或者不处理。被举报人只在删除时收到提醒 */
function resolveDmReport(db, user, report, action, reason, now) {
  const stamp = new Date(now).toISOString();
  if (action === 'remove') {
    const ids = new Set((report.evidence || []).map((row) => row.id));
    (db.directMessages || []).forEach((row) => {
      if (ids.has(row.id)) Object.assign(row, { status: 'removed', removedAt: stamp });
    });
    report.status = 'removed';
    notifyUser(db, {
      userId: report.targetId, actorId: null, type: 'system', createdAt: stamp,
      text: `你发送的部分私信因违反社区规范已被删除（${reason}）。`
    });
  } else if (action === 'dismiss') {
    report.status = 'dismissed';
  } else {
    return fail('bad_action', '私信举报只能删除这些私信或不处理');
  }
  Object.assign(report, { resolution: reason, handledBy: user.id, handledAt: stamp });
  audit(db, user.id, `私信举报处理：${action}`, `用户 ${report.targetId}`, reason);
  return ok('已处理并记录审计');
}

export function archiveCircle(db, { circleId, reason = '' }, now = Date.now()) {
  const user = me(db);
  if (!user || user.role !== 'admin') return fail('forbidden', '只有管理员可以归档课友圈');
  const circle = S.circleOf(db, circleId);
  if (!circle) return fail('not_found', '圈不存在');
  circle.status = 'archived';
  circle.archivedAt = new Date(now).toISOString();
  audit(db, user.id, '归档课友圈', `圈 ${circleId}`, reason || '学期结束');
  return ok('已归档为只读：帖子、讨论与资料仍保留，不触发退款');
}

export function setUserStatus(db, { userId, status, reason = '' }, now = Date.now()) {
  const user = me(db);
  if (!user || user.role !== 'admin') return fail('forbidden', '只有管理员可以封禁账号');
  const target = S.userOf(db, userId);
  if (!target) return fail('not_found', '用户不存在');
  if (target.role === 'admin' && target.id !== user.id) return fail('forbidden', '不能封禁其他管理员');
  if (db.production && target.id === user.id && status !== 'active') return fail('forbidden', '不能封禁当前管理员自身，请由另一位维护者处理');
  target.status = status === 'active' ? 'active' : 'suspended';
  if (target.status !== 'active' && Array.isArray(db.sessions)) {
    db.sessions = db.sessions.filter((session) => session.userId !== target.id);
  }
  target.bannedAt = status === 'active' ? null : new Date(now).toISOString();
  target.banReason = status === 'active' ? null : (reason || '管理员操作');
  audit(db, user.id, status === 'active' ? '解封账号' : '封禁账号', `用户 ${userId}`, reason || '未填写原因');
  return ok(status === 'active' ? '已解封账号' : '已封禁账号');
}

export function recordEvent(db, input = {}) {
  logEvent(db, input.type || 'unknown', input.meta || {});
  return ok('', {});
}




/* ---------- 管理员：新建课友圈 / 封禁帖子 ---------- */

export function createCircle(db, input = {}, now = Date.now()) {
  const user = me(db);
  if (!user || user.role !== 'admin') return fail('forbidden', '只有管理员可以新建课友圈');

  const courseId = String(input.courseId || '');
  const course = S.courseOf(db, courseId);
  if (!course) return fail('bad_course', '请选择课程');
  if (S.circleOfCourse(db, courseId)) return fail('duplicate_circle', '这门课已经有课友圈了，一门课只保留一个圈');

  let inviteCode = '';
  do {
    inviteCode = `GY-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  } while ((db.circles || []).some((circle) => circle.inviteCode === inviteCode));

  const circle = {
    id: newId('ci'),
    courseId,
    status: 'active',
    createdBy: user.id,
    inviteCode,
    createdAt: new Date(now).toISOString(),
    pinnedPostId: null
  };
  db.circles.push(circle);
  audit(db, user.id, '新建课友圈', `圈 ${circle.id}`, course.name);
  return ok('课友圈已创建', { circleId: circle.id, circle });
}

/** 管理员设置或取消圈内置顶；postId 为空表示取消 */
export function setCirclePin(db, { circleId, postId = null }, now = Date.now()) {
  const user = me(db);
  if (!user || user.role !== 'admin') return fail('forbidden', '只有管理员可以设置置顶');
  const circle = S.circleOf(db, circleId);
  if (!circle) return fail('not_found', '圈不存在');
  if (postId) {
    const post = S.postOf(db, postId);
    if (!S.isVisiblePost(post) || post.circleId !== circle.id) {
      return fail('bad_post', '只能置顶这个圈里公开的帖子');
    }
  }
  circle.pinnedPostId = postId || null;
  audit(db, user.id, postId ? '设置圈内置顶' : '取消圈内置顶', `圈 ${circle.id}`, postId || '取消置顶');
  return ok(postId ? '已置顶到课友圈' : '已取消置顶', { pinnedAt: new Date(now).toISOString() });
}

export function setPostStatus(db, { postId, status = 'banned', reason = '' }, now = Date.now()) {
  const user = me(db);
  if (!user || user.role !== 'admin') return fail('forbidden', '只有管理员可以封禁帖子');
  const post = S.postOf(db, postId);
  if (!post) return fail('not_found', '帖子不存在');

  const next = status === 'published' ? 'published' : 'banned';
  if (post.status === next) return fail('no_change', next === 'banned' ? '这个帖子已经是封禁状态' : '这个帖子已经是公开状态');

  post.status = next;
  post.moderatedAt = new Date(now).toISOString();
  post.moderatedBy = user.id;
  post.moderateReason = reason || (next === 'banned' ? '管理员封禁' : '管理员解封');

  audit(db, user.id, next === 'banned' ? '封禁帖子' : '解封帖子',
    `帖子 ${post.id}`, post.moderateReason);
  return ok(next === 'banned' ? '已封禁该帖子，关联资料同时下架' : '已解封该帖子');
}

/* ---------- 拉黑 ---------- */

export function setBlock(db, { userId, blocked = true }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  const target = S.userOf(db, String(userId || ''));
  if (!target || target.id === user.id) return fail('bad_user', '不能拉黑这个账号');
  if (!Array.isArray(db.blocks)) db.blocks = [];
  const existing = db.blocks.find((row) => row.blockerId === user.id && row.blockedId === target.id);
  if (!blocked) {
    if (!existing) return ok('没有拉黑这个账号', { blocked: false });
    db.blocks = db.blocks.filter((row) => row !== existing);
    return ok('已取消拉黑', { blocked: false });
  }
  if (existing) return ok('已经拉黑了', { blocked: true });
  db.blocks.push({ blockerId: user.id, blockedId: target.id, createdAt: new Date(now).toISOString() });
  // 拉黑后双方互相取消关注
  db.follows = (db.follows || []).filter((row) => !(row.targetType === 'user'
    && ((row.followerId === user.id && row.targetId === target.id) || (row.followerId === target.id && row.targetId === user.id))));
  return ok('已拉黑：双方不能再互发私信，你也不会再收到对方的回复和页签提醒', { blocked: true });
}

/* ---------- 圈内成员管理 ---------- */

const MEMBER_ACTIONS = ['mute', 'unmute', 'remove', 'restore'];

/** 管理员在单个圈里禁言（可设天数）、解除禁言、移出成员或允许重新加入 */
export function setMemberRestriction(db, { circleId, userId, action, days = null, reason = '' }, now = Date.now()) {
  const user = me(db);
  if (!user || user.role !== 'admin') return fail('forbidden', '只有管理员可以管理圈内成员');
  if (!MEMBER_ACTIONS.includes(action)) return fail('bad_action', '未知的处理方式');
  const circle = S.circleOf(db, circleId);
  if (!circle) return fail('not_found', '圈不存在');
  const target = S.userOf(db, String(userId || ''));
  if (!target) return fail('not_found', '用户不存在');
  if (target.role === 'admin') return fail('forbidden', '不能限制管理员');
  const note = String(reason || '').trim();
  if ((action === 'mute' || action === 'remove') && !note) return fail('no_reason', '需要写明理由，会通知对方');
  const m = S.membership(db, target.id, circle.id);
  const courseName = (S.courseOf(db, circle.courseId) || {}).name || '课程';
  const stamp = new Date(now).toISOString();
  let text = '';
  let message = '';

  if (action === 'mute') {
    if (!m || m.status !== 'active') return fail('not_member', '对方不是这个圈的成员');
    const span = Number(days);
    m.writeRestricted = true;
    m.restrictedUntil = span > 0 ? new Date(now + span * 24 * 3600 * 1000).toISOString() : null;
    text = `你在「${courseName}」课友圈被禁言${span > 0 ? ` ${span} 天` : ''}：${note}`;
    message = '已在本圈禁言';
  } else if (action === 'unmute') {
    if (!m || !m.writeRestricted) return fail('not_restricted', '对方没有被禁言');
    m.writeRestricted = false;
    m.restrictedUntil = null;
    text = `你在「${courseName}」课友圈的禁言已解除。`;
    message = '已解除禁言';
  } else if (action === 'remove') {
    if (!m || m.status !== 'active') return fail('not_member', '对方不是这个圈的成员');
    Object.assign(m, { status: 'removed', removedAt: stamp, writeRestricted: false, restrictedUntil: null });
    text = `你被移出「${courseName}」课友圈：${note}`;
    message = '已移出本圈';
  } else {
    if (!m || m.status !== 'removed') return fail('not_removed', '对方没有被移出');
    m.status = 'left';
    text = `你可以重新加入「${courseName}」课友圈了。`;
    message = '已允许重新加入';
  }
  audit(db, user.id, { mute: '圈内禁言', unmute: '解除圈内禁言', remove: '移出课友圈', restore: '允许重新加入' }[action],
    `圈 ${circle.id} · 用户 ${target.id}`, note || '—');
  notifyUser(db, { userId: target.id, actorId: null, type: 'system', createdAt: stamp, text });
  return ok(message);
}

/* ---------- 注销账号 ---------- */

/**
 * 注销：删除个人资料与私人数据。发布过的内容按用户选择处理：
 * anonymize = 保留但显示为“已注销用户”；delete = 永久移除帖子（沿用删帖规则：附件下架、赠签退回）和评论。
 */
export function deleteAccount(db, { mode, confirmText = '' }, now = Date.now()) {
  const user = me(db);
  if (!user) return fail('login', '请先登录');
  if (user.role === 'admin') return fail('admin', '管理员账号不能在这里注销，请先移交管理权限');
  if (!['anonymize', 'delete'].includes(mode)) return fail('bad_mode', '请选择怎么处理你发布过的内容');
  if (String(confirmText).trim() !== '注销') return fail('need_confirm', '请输入“注销”两个字确认');
  const stamp = new Date(now).toISOString();
  const id = user.id;

  if (mode === 'delete') {
    (db.posts || []).filter((post) => post.authorId === id && post.status !== 'removed')
      .forEach((post) => removePost(db, { postId: post.id, reason: '作者注销账号' }, now));
    (db.comments || []).forEach((comment) => {
      if (comment.authorId === id && comment.status !== 'removed') Object.assign(comment, { status: 'removed', removedAt: stamp });
    });
  }

  db.directMessages = (db.directMessages || []).filter((row) => row.senderId !== id && row.recipientId !== id);
  db.notifications = (db.notifications || []).filter((row) => row.userId !== id);
  db.follows = (db.follows || []).filter((row) => row.followerId !== id && !(row.targetType === 'user' && row.targetId === id));
  db.blocks = (db.blocks || []).filter((row) => row.blockerId !== id && row.blockedId !== id);
  db.reactions = (db.reactions || []).filter((row) => row.userId !== id);
  db.ledger = (db.ledger || []).filter((row) => row.userId !== id);
  db.claims = (db.claims || []).filter((row) => row.userId !== id);
  if (db.wallets) delete db.wallets[id];
  if (db.drafts) delete db.drafts[id];
  if (db.prefs) delete db.prefs[id];
  (db.memberships || []).forEach((row) => {
    if (row.userId === id && row.status === 'active') row.status = 'left';
  });
  (db.applications || []).forEach((row) => {
    if (row.applicantId === id && row.state === 'pending') row.state = 'withdrawn';
  });

  Object.assign(user, {
    email: '', nickname: '已注销用户', avatar: 'art/avatar-01.svg', bio: '',
    status: 'deleted', verified: false, deletedAt: stamp
  });
  db.session = null;
  return ok('账号已注销', { mode });
}

