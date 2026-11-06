/* 业务逻辑测试：页签事务、资料索引、权限、成长值、退款。
 * 运行：npm test（node --test tests/）
 * 说明：这里测的是浏览器内演示数据层的业务规则；服务端实现必须复刻同一套校验。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/data/seed.js';
import { ZJU_COURSES } from '../src/data/zju-courses-2026aw.js';
import * as A from '../src/state/actions.js';
import { levelOf, shanghaiDate } from '../src/lib/format.js';
import * as S from '../src/state/selectors.js';
import { createStore } from '../src/state/store.js';
import { bookmarkOfDay } from '../src/data/quotes.js';
import { DAILY_BOOKMARKS, bookmarkEntry, bookmarkEntryFor } from '../src/data/daily-bookmarks.js';
import { STICKERS, STICKER_IDS, isValidSticker } from '../src/data/stickers.js';

// 2026-10-26 12:00 Asia/Shanghai
const NOW = Date.UTC(2026, 9, 26, 4, 0, 0);
const NEXT_DAY = NOW + 24 * 3600 * 1000;

function fresh() {
  return createSeed(NOW, { keepDemoPosts: true });
}

function login(db, email = 'student@example.com') {
  const result = A.verifyCode(db, { email, code: A.DEMO_CODE });
  assert.ok(result.ok, result.message);
  return result.data.user;
}

const ATTACHMENT = {
  name: '测试资料.pdf',
  sizeBytes: 120000,
  pages: 5,
  path: 'assets/samples/demo-calculus-notes.pdf',
  status: 'ready'
};

function resourceInput(overrides = {}) {
  return {
    title: '数列极限的三种做法整理',
    courseId: 'c_calc',
    school: '浙江大学',
    term: '2026秋',
    type: '笔记',
    coverage: '数列极限、夹逼、单调有界',
    limitations: '不含导数',
    confirmedIndex: true,
    ...overrides
  };
}

function publishResource(db, extra = {}, now = NOW) {
  return A.createPost(db, {
    board: 'notes',
    title: '我的极限整理',
    body: '整理了一份极限的资料，欢迎指出问题。',
    tags: ['极限'],
    attachments: [ATTACHMENT],
    confirmedOriginal: true,
    resource: resourceInput(extra.resource),
    ...extra
  }, now);
}

test('种子数据：只有满足条件的资料进入索引', () => {
  const db = fresh();
  const indexed = db.resources.filter((r) => S.resourceEligibility(db, r).ok);
  assert.equal(indexed.length, 6, '应有 6 份公开资料');
  const processing = db.resources.find((r) => r.postId === 'p_calc_processing');
  assert.equal(S.resourceEligibility(db, processing).ok, false, '处理中的资料不进索引');
});

test('发布资料不要求入圈，游客可检索，登录后可下载', () => {
  const db = fresh();
  const me = login(db);
  assert.equal(S.myCircles(db, me.id).length, 0, '新账号没有圈子');

  const created = publishResource(db);
  assert.ok(created.ok, created.message);
  const resource = S.resourceForPost(db, created.data.postId);
  assert.ok(resource);
  assert.equal(resource.status, 'indexed');

  const guestSearch = S.searchResources(db, { q: '极限' });
  assert.ok(guestSearch.items.some((item) => item.resource.id === resource.id), '游客能搜到');

  const attachment = S.attachmentsOf(db, created.data.postId)[0];
  A.logout(db);
  const guestDownload = A.downloadResource(db, { postId: created.data.postId, attachmentId: attachment.id });
  assert.equal(guestDownload.ok, false);
  assert.equal(guestDownload.code, 'login');

  db.session = { userId: me.id };
  const first = A.downloadResource(db, { postId: created.data.postId, attachmentId: attachment.id });
  assert.ok(first.ok, '登录后下载成功');
  assert.equal(S.isActiveMember(db, me.id, 'ci_calc_a'), false, '下载不会自动入圈');
});

test('资料发布校验：附件、确认、标题、课程', () => {
  const db = fresh();
  login(db);

  const noFile = A.createPost(db, {
    board: 'notes', body: '正文', attachments: [], resource: resourceInput()
  }, NOW);
  assert.equal(noFile.code, 'no_file');

  const noConfirm = A.createPost(db, {
    board: 'notes', body: '正文', attachments: [ATTACHMENT], confirmedOriginal: true,
    resource: resourceInput({ confirmedIndex: false })
  }, NOW);
  assert.equal(noConfirm.code, 'need_confirm');

  const noRightsConfirm = A.createPost(db, {
    board: 'notes', body: '正文', attachments: [ATTACHMENT],
    resource: resourceInput()
  }, NOW);
  assert.equal(noRightsConfirm.code, 'need_confirm', '上传附件前必须确认有权分享');

  const badTitle = publishResource(db, { resource: { ...resourceInput(), title: '短' } });
  assert.equal(badTitle.code, 'bad_res_title');

  const badCourse = publishResource(db, { resource: { ...resourceInput(), courseId: null } });
  assert.equal(badCourse.code, 'bad_course');
});

test('一帖一资料：检索结果不重复，取消索引不删原帖', () => {
  const db = fresh();
  login(db);
  const before = db.resources.length;
  const created = publishResource(db);
  assert.equal(db.resources.length, before + 1);

  const resource = S.resourceForPost(db, created.data.postId);
  const results = S.searchResources(db, { q: '数列极限' }).items
    .filter((item) => item.post.id === created.data.postId);
  assert.equal(results.length, 1, '一帖只出现一次');

  const off = A.setResourceIndex(db, { resourceId: resource.id, enabled: false });
  assert.ok(off.ok);
  assert.equal(S.resourceEligibility(db, resource).ok, false);
  assert.equal(S.postOf(db, created.data.postId).status, 'published', '原帖仍在');
  assert.equal(S.searchResources(db, { q: '数列极限' }).items.some((i) => i.resource.id === resource.id), false);
});

test('入圈幂等、归档拒收、被移出需管理员解除', () => {
  const db = fresh();
  const me = login(db);

  const first = A.joinCircle(db, { circleId: 'ci_calc_a' }, NOW);
  assert.ok(first.ok);
  const second = A.joinCircle(db, { circleId: 'ci_calc_a' }, NOW);
  assert.ok(second.ok);
  assert.equal(second.message, '你已经在这个圈里了');
  assert.equal(
    db.memberships.filter((m) => m.userId === me.id && m.circleId === 'ci_calc_a').length,
    1,
    '不会产生重复成员关系'
  );

  db.session = { userId: 'u_admin' };
  assert.ok(A.archiveCircle(db, { circleId: 'ci_phys', reason: '测试归档' }, NOW).ok);
  db.session = { userId: me.id };
  const archived = A.joinCircle(db, { circleId: 'ci_phys' }, NOW);
  assert.equal(archived.code, 'archived');

  const m = S.membership(db, me.id, 'ci_calc_a');
  m.status = 'removed';
  const rejoin = A.joinCircle(db, { circleId: 'ci_calc_a' }, NOW);
  assert.equal(rejoin.code, 'removed_member');
});

test('评论权限：普通圈帖需成员，公开资料帖允许非成员纠错，禁言与归档仍然生效', () => {
  const db = fresh();
  const me = login(db, 'outsider@example.com');

  const normal = A.addComment(db, { postId: 'p_calc_discuss', body: '我也想说两句，这里的证明可以再简化。' }, NOW);
  assert.equal(normal.code, 'not_member', '普通圈帖需要成员');

  const onResource = A.addComment(db, { postId: 'p_calc_notes', body: '第二页那个小于等于号可能写反了，请核对。' }, NOW);
  assert.ok(onResource.ok, '公开资料帖允许非成员纠错');
  assert.equal(S.isActiveMember(db, me.id, 'ci_calc_a'), false, '评论不自动入圈');

  const member = S.membership(db, 'u_qinghe', 'ci_calc_a');
  member.moderationMuted = true;
  member.writeRestricted = true;
  const mutedComment = A.addComment(db, { postId: 'p_calc_notes', body: '被禁言的人不能借资料入口绕过限制。' }, NOW);
  assert.equal(mutedComment.ok, true, '其他用户不受影响');
  db.session = { userId: 'u_qinghe' };
  const muted = A.addComment(db, { postId: 'p_calc_notes', body: '被禁言的人不能借资料入口绕过限制。' }, NOW);
  assert.equal(muted.code, 'restricted');

  db.session = { userId: 'u_admin' };
  assert.ok(A.archiveCircle(db, { circleId: 'ci_calc_a', reason: '测试归档' }, NOW).ok);
  db.session = { userId: 'u_nanzhi' };
  const archivedComment = A.addComment(db, { postId: 'p_calc_old', body: '归档圈的帖子还能评论吗？' }, NOW);
  assert.equal(archivedComment.code, 'archived');
});

test('采纳：只有作者、只在求助帖、不能自采纳、改选需先取消', () => {
  const db = fresh();
  assert.equal(S.xpOf(db, 'u_zhixia'), 122, '种子数据包含一次采纳奖励');

  db.session = { userId: 'u_linjian' };
  const undo = A.unacceptComment(db, { postId: 'p_la_question' }, NOW);
  assert.ok(undo.ok);
  assert.equal(S.postOf(db, 'p_la_question').acceptedCommentId, null);
  assert.equal(S.xpOf(db, 'u_zhixia'), 112, '取消采纳回收对应奖励');

  const accept = A.acceptComment(db, { postId: 'p_la_question', commentId: 'cm_la_answer' }, NOW);
  assert.ok(accept.ok, accept.message);
  assert.equal(S.postOf(db, 'p_la_question').acceptedCommentId, 'cm_la_answer');
  assert.equal(S.xpOf(db, 'u_zhixia'), 122);

  db.session = { userId: 'u_qinghe' };
  const foreign = A.acceptComment(db, { postId: 'p_la_question', commentId: 'cm_la_reply2' }, NOW);
  assert.equal(foreign.code, 'forbidden');

  db.session = { userId: 'u_linjian' };
  const second = A.acceptComment(db, { postId: 'p_la_question', commentId: 'cm_la_reply2' }, NOW);
  assert.equal(second.code, 'already_accepted');

  A.unacceptComment(db, { postId: 'p_la_question' }, NOW);
  // 二级回复可以按业务被采纳，但按 v4 规则不计 +10
  const replyAccept = A.acceptComment(db, { postId: 'p_la_question', commentId: 'cm_la_reply2' }, NOW);
  assert.ok(replyAccept.ok, '取消后可改选');
  assert.equal(S.xpOf(db, 'u_nanzhi'), 60, '二级回复不计采纳经验');
  A.unacceptComment(db, { postId: 'p_la_question' }, NOW);

  // 换成另一位作者的主评论，才获得 +10
  const swap = A.acceptComment(db, { postId: 'p_la_question', commentId: 'cm_la_3' }, NOW);
  assert.ok(swap.ok, '主评论可以改选');
  assert.equal(S.xpOf(db, 'u_momo'), 10, '主评论作者获得采纳奖励');

  const repeat = A.acceptComment(db, { postId: 'p_la_question', commentId: 'cm_la_3' }, NOW);
  assert.equal(repeat.ok, true, '重复采纳同一条是幂等的');
});

test('成长值：发帖每日最多计 2 次，评论需 ≥10 字', () => {
  const db = fresh();
  db.session = { userId: 'u_zhixia' };
  const before = S.xpOf(db, 'u_zhixia');

  for (let i = 0; i < 3; i += 1) {
    A.createPost(db, { board: 'method', body: `第 ${i} 篇测试帖子，记录一下今天的复盘和两个还没想清楚的问题。`, tags: [] }, NOW + i);
  }
  assert.equal(S.xpOf(db, 'u_zhixia'), before + 10, '当天只计 2 篇');

  A.addComment(db, { postId: 'p_calc_notes', body: '短' }, NOW);
  const short = S.xpOf(db, 'u_zhixia');
  A.addComment(db, { postId: 'p_calc_notes', body: '这条评论有足够的内容，可以计入成长值。' }, NOW);
  assert.equal(S.xpOf(db, 'u_zhixia'), short + 1, '短评论不计分');

  const nextDay = NOW + 24 * 3600 * 1000;
  A.createPost(db, { board: 'method', body: '第二天的帖子，重新开始计数，顺便补上昨天没想清楚的两道题。', tags: [] }, nextDay);
  assert.equal(S.xpOf(db, 'u_zhixia'), short + 1 + 5);
});

test('页签领取：每日一次、满额不可领、并发重复只入账一次', () => {
  const db = fresh();
  db.session = { userId: 'u_zhixia' };
  const state = S.claimState(db, 'u_zhixia', NOW);
  assert.equal(state.canClaim, false, '种子数据今天已领取');
  assert.equal(state.code, 'claimed');

  db.session = { userId: 'u_qinghe' };
  const start = S.walletOf(db, 'u_qinghe');
  const first = A.claimDaily(db, {}, NOW);
  assert.ok(first.ok);
  assert.equal(S.walletOf(db, 'u_qinghe'), start + 1);

  for (let i = 0; i < 20; i += 1) {
    const again = A.claimDaily(db, {}, NOW);
    assert.equal(again.ok, false, '并发重复领取不会入账');
  }
  assert.equal(S.walletOf(db, 'u_qinghe'), start + 1, '只增加 1 枚');

  const tomorrow = A.claimDaily(db, {}, NEXT_DAY);
  assert.ok(tomorrow.ok, '次日可再领');

  db.wallets.u_qinghe.balance = 30;
  const full = S.claimState(db, 'u_qinghe', NEXT_DAY + 24 * 3600 * 1000);
  assert.equal(full.canClaim, false);
  assert.equal(full.code, 'full');
  const fullClaim = A.claimDaily(db, {}, NEXT_DAY + 24 * 3600 * 1000);
  assert.equal(fullClaim.code, 'full');
  assert.equal(S.walletOf(db, 'u_qinghe'), 30, '满额不写余额也不写领取记录');
});

test('赠送：不能自赠、每帖 2 枚、每作者每日 2 枚、每日总量 5 枚、幂等', () => {
  const db = fresh();
  db.session = { userId: 'u_linjian' };
  assert.equal(S.walletOf(db, 'u_linjian'), 8);

  const self = A.sendGift(db, { postId: 'p_la_question', qty: 1, idemKey: 'k-self' }, NOW);
  assert.equal(self.code, 'self_gift');

  const first = A.sendGift(db, { postId: 'p_calc_notes', qty: 1, idemKey: 'k-1' }, NOW);
  assert.ok(first.ok, first.message);
  assert.equal(S.walletOf(db, 'u_linjian'), 7);

  const duplicate = A.sendGift(db, { postId: 'p_calc_notes', qty: 1, idemKey: 'k-1' }, NOW);
  assert.ok(duplicate.ok);
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(S.walletOf(db, 'u_linjian'), 7, '同幂等键不重复扣款');

  const conflict = A.sendGift(db, { postId: 'p_calc_discuss', qty: 2, idemKey: 'k-1' }, NOW);
  assert.equal(conflict.code, 'idem_conflict');

  const second = A.sendGift(db, { postId: 'p_calc_notes', qty: 1, idemKey: 'k-2' }, NOW);
  assert.ok(second.ok, '同一帖第 2 枚允许');
  const third = A.sendGift(db, { postId: 'p_calc_notes', qty: 1, idemKey: 'k-3' }, NOW);
  assert.equal(third.ok, false, '同一帖第 3 枚拒绝');
  assert.equal(S.giftedByMe(db, 'u_linjian', 'p_calc_notes'), 2);

  const authorLimit = A.sendGift(db, { postId: 'p_calc_problems', qty: 1, idemKey: 'k-4' }, NOW);
  assert.equal(authorLimit.ok, false, '同一位作者当天已收 2 枚');

  // 今天已送 2 枚，还能再送 3 枚填满每日上限
  assert.ok(A.sendGift(db, { postId: 'p_calc_discuss', qty: 1, idemKey: 'k-5' }, NOW).ok);
  assert.ok(A.sendGift(db, { postId: 'p_py_notes', qty: 1, idemKey: 'k-6' }, NOW).ok);
  assert.ok(A.sendGift(db, { postId: 'p_ds_notes', qty: 1, idemKey: 'k-7' }, NOW).ok);
  assert.equal(S.sentToday(db, 'u_linjian', NOW), 5);

  const dailyLimit = A.sendGift(db, { postId: 'p_prob_help', qty: 1, idemKey: 'k-8' }, NOW);
  assert.equal(dailyLimit.ok, false, '每日总量 5 枚');
  assert.equal(S.walletOf(db, 'u_linjian'), 3, '被拒绝的赠送不扣余额');
});

test('移除帖子：资料立即下架，赠签按记录退回，接收者余额不变', () => {
  const db = fresh();
  const senderBefore = S.walletOf(db, 'u_qinghe');
  const receiverBefore = S.walletOf(db, 'u_alan');

  db.session = { userId: 'u_admin' };
  const removed = A.removePost(db, { postId: 'p_py_recursion', reason: '作者撤回' }, NOW);
  assert.ok(removed.ok, removed.message);
  assert.equal(S.postOf(db, 'p_py_recursion').status, 'removed');
  assert.equal(S.walletOf(db, 'u_qinghe'), senderBefore + 1, '1 枚退回');
  assert.equal(S.walletOf(db, 'u_alan'), receiverBefore, '接收者余额不因退款增加');
  assert.equal(S.giftedQtyForPost(db, 'p_py_recursion'), 0);

  const again = A.removePost(db, { postId: 'p_py_recursion' }, NOW);
  assert.equal(again.code, 'already_removed');
  assert.equal(S.walletOf(db, 'u_qinghe'), senderBefore + 1, '重复移除不重复退款');

  // 移除含资料的帖子：索引立即失效
  const resourcePost = A.removePost(db, { postId: 'p_calc_notes', reason: '作者撤回' }, NOW);
  assert.ok(resourcePost.ok);
  assert.equal(S.resourceEligibility(db, S.resourceForPost(db, 'p_calc_notes')).ok, false);
  assert.equal(S.searchResources(db, {}).items.some((i) => i.resource.postId === 'p_calc_notes'), false);
});

test('举报处理：需要管理员、必须写理由、移除触发退款与审计', () => {
  const db = fresh();
  db.session = { userId: 'u_zhixia' };
  const denied = A.resolveReport(db, { reportId: 'rp_1', action: 'hide', reason: '测试' }, NOW);
  assert.equal(denied.code, 'forbidden');

  db.session = { userId: 'u_admin' };
  const noReason = A.resolveReport(db, { reportId: 'rp_1', action: 'hide', reason: '  ' }, NOW);
  assert.equal(noReason.code, 'no_reason');

  const hidden = A.resolveReport(db, { reportId: 'rp_1', action: 'hide', reason: '疑似整本教材扫描，先隐藏' }, NOW);
  assert.ok(hidden.ok);
  assert.equal(S.postOf(db, 'p_calc_problems').status, 'hidden');
  assert.equal(S.resourceEligibility(db, S.resourceForPost(db, 'p_calc_problems')).ok, false, '隐藏后退出索引');
  assert.ok(db.audit.some((a) => a.action.includes('hide')), '写入审计');
});

test('停用账号不能写入', () => {
  const db = fresh();
  db.session = { userId: 'u_admin' };
  A.setUserStatus(db, { userId: 'u_zhixia', status: 'suspended', reason: '测试' }, NOW);
  db.session = { userId: 'u_zhixia' };
  const blocked = A.createPost(db, { board: 'method', body: '停用后还能发帖吗？' }, NOW);
  assert.equal(blocked.ok, false);
  assert.equal(S.currentUser(db), null, '停用账号不能视为有效会话');
});

test('演示数据仓库：写入后可重新读出，可重置', () => {
  const map = new Map();
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k)
  };
  const store = createStore({ key: 'test', storage, now: () => NOW });
  const db = store.getState();
  db.session = { userId: 'u_qinghe' };
  store.commit((state) => {
    state.users[0].bio = '测试修改';
  });

  const reopened = createStore({ key: 'test', storage, now: () => NOW });
  assert.equal(reopened.getState().users[0].bio, '测试修改');
  assert.equal(reopened.getState().session.userId, 'u_qinghe');

  reopened.reset();
  assert.notEqual(reopened.getState().users[0].bio, '测试修改');
});

test('搜索：筛选项可组合，无关键词按最近更新排序', () => {
  const db = fresh();
  const all = S.searchResources(db, {});
  assert.equal(all.total, 6);
  const calc = S.searchResources(db, { courseId: 'c_calc' });
  assert.ok(calc.items.every((item) => item.resource.courseId === 'c_calc'));
  const termFiltered = S.searchResources(db, { term: '2025秋' });
  assert.equal(termFiltered.total, 1);
  const sorted = S.searchResources(db, { sort: 'recent' }).items;
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(
      new Date(sorted[i - 1].resource.updatedAt) >= new Date(sorted[i].resource.updatedAt),
      '按更新时间倒序'
    );
  }
  const keyword = S.searchResources(db, { q: '行列式' });
  assert.ok(keyword.items.length >= 1);
  assert.ok(keyword.items[0].score > 0);
});


test('页页表情：白名单校验、仅表情可发送、非法 ID 被拒绝', () => {
  const db = fresh();
  db.session = { userId: 'u_zhixia' };

  const stickerOnly = A.addComment(db, {
    postId: 'p_calc_notes', body: '', stickerId: 'yeye.thanks.v1'
  }, NOW);
  assert.ok(stickerOnly.ok, stickerOnly.message);
  assert.equal(stickerOnly.data.comment.stickerId, 'yeye.thanks.v1');
  assert.equal(stickerOnly.data.comment.body, '');

  const badSticker = A.addComment(db, {
    postId: 'p_calc_notes', body: '带一个不存在的表情', stickerId: 'yeye.unknown.v9'
  }, NOW);
  assert.equal(badSticker.code, 'bad_sticker');

  const empty = A.addComment(db, { postId: 'p_calc_notes', body: '' }, NOW);
  assert.equal(empty.code, 'empty_comment');

  const badPostSticker = A.createPost(db, {
    board: 'method', body: '帖子带非法表情', stickerId: 'yeye.unknown.v9'
  }, NOW);
  assert.equal(badPostSticker.code, 'bad_sticker');

  const goodPost = A.createPost(db, {
    board: 'method', body: '这条帖子带一个页页表情，用来验证保存。', stickerId: 'yeye.received.v1'
  }, NOW);
  assert.ok(goodPost.ok, goodPost.message);
  const created = S.postOf(db, goodPost.data.postId);
  assert.equal(created.stickerId, 'yeye.received.v1');
});

test('种子数据包含 8 个演示账号与页页表情示例', () => {
  const db = fresh();
  const demoIds = ['u_qinghe', 'u_linjian', 'u_alan', 'u_zhixia', 'u_zhouzhou', 'u_nanzhi', 'u_momo', 'u_xiaolin'];
  demoIds.forEach((id) => {
    const user = S.userOf(db, id);
    assert.ok(user, `缺少演示账号 ${id}`);
    assert.ok(String(user.avatar).includes('/'), `${id} 应使用 V3 头像路径`);
  });
  const withSticker = db.comments.filter((comment) => comment.stickerId);
  assert.ok(withSticker.length >= 4, '演示评论里应包含页页表情');
  assert.ok(withSticker.some((comment) => !comment.body), '应有一条只有表情的评论');
});

test('管理员：新建课友圈、封禁账号与帖子', () => {
  const db = fresh();
  db.session = { userId: 'u_admin' };

  // 新建课友圈：一门课只能有一个圈
  db.courses.push({ id: 'c_test_new', school: '浙江大学', name: '测试课程', code: null, category: '测试' });
  const created = A.createCircle(db, { courseId: 'c_test_new' }, NOW);
  assert.ok(created.ok, created.message);
  const circle = S.circleOf(db, created.data.circleId);
  assert.ok(circle);
  assert.equal(circle.status, 'active');
  assert.ok(circle.inviteCode.startsWith('GY-'));
  assert.equal(circle.term, undefined, '9.2 起圈不再带学期');
  assert.equal(circle.section, undefined, '9.2 起圈不再带教学班');

  const duplicate = A.createCircle(db, { courseId: 'c_test_new' }, NOW);
  assert.equal(duplicate.code, 'duplicate_circle');
  const alreadyHasCircle = A.createCircle(db, { courseId: 'c_calc' }, NOW);
  assert.equal(alreadyHasCircle.code, 'duplicate_circle');

  // 普通用户不能建圈
  db.session = { userId: 'u_zhixia' };
  const forbidden = A.createCircle(db, { courseId: 'c_la' }, NOW);
  assert.equal(forbidden.code, 'forbidden');

  // 封禁帖子：列表与资料同时下架
  db.session = { userId: 'u_admin' };
  const before = S.searchResources(db, {}, NOW).items.length;
  const banned = A.setPostStatus(db, { postId: 'p_calc_notes', status: 'banned', reason: '测试封禁' }, NOW);
  assert.ok(banned.ok, banned.message);
  assert.equal(S.postOf(db, 'p_calc_notes').status, 'banned');
  assert.equal(S.searchResources(db, {}, NOW).items.length, before - 1, '封禁后关联资料应下架');
  const detail = A.addComment(db, { postId: 'p_calc_notes', body: '封禁帖还能评论吗' }, NOW);
  assert.equal(detail.code, 'not_found');

  const restored = A.setPostStatus(db, { postId: 'p_calc_notes', status: 'published' }, NOW);
  assert.ok(restored.ok);
  assert.equal(S.searchResources(db, {}, NOW).items.length, before);

  // 封禁账号后会话失效
  db.session = { userId: 'u_admin' };
  const bannedUser = A.setUserStatus(db, { userId: 'u_zhixia', status: 'suspended', reason: '测试' }, NOW);
  assert.ok(bannedUser.ok, bannedUser.message);
  assert.equal(S.userOf(db, 'u_zhixia').status, 'suspended');
  db.session = { userId: 'u_zhixia' };
  assert.equal(S.currentUser(db), null, '被封禁账号不应保持登录态');
  const blocked = A.addComment(db, { postId: 'p_calc_notes', body: '还能说话吗' }, NOW);
  assert.equal(blocked.code, 'login');

  // 被封禁账号不能通过演示账号快捷登录绕过
  db.session = null;
  const quick = A.quickLogin(db, { userId: 'u_zhixia' });
  assert.equal(quick.code, 'suspended', '被封禁账号不应能一键登录');
  assert.equal(db.session, null, '快捷登录失败时不应留下会话');
});

test('管理员测试账号可直接登录并带管理员角色', () => {
  const db = fresh();
  const admin = db.users.find((user) => user.email === 'admin@gongye.test');
  assert.ok(admin, '应存在 admin@gongye.test');
  assert.equal(admin.role, 'admin');
  assert.equal(admin.nickname, '管理员测试');
});



test('等级：门槛、进度与最高级（G01–G03）', () => {
  const cases = [
    [49, 1, '初翻'], [50, 2, '拾页'], [149, 2, '拾页'], [150, 3, '成册'],
    [399, 3, '成册'], [400, 4, '共著'], [999, 4, '共著'], [1000, 5, '传薪']
  ];
  cases.forEach(([xp, level, name]) => {
    const info = levelOf(xp);
    assert.equal(info.level, level, `${xp} 应为 LV.${level}`);
    assert.equal(info.name, name);
  });

  const info = levelOf(185);
  assert.equal(info.level, 3);
  assert.equal(info.within, 35);
  assert.equal(info.span, 250);
  assert.equal(info.percent, 14);
  assert.equal(info.remaining, 215);

  const max = levelOf(1005);
  assert.equal(max.level, 5);
  assert.equal(max.isMax, true);
  assert.equal(max.nextAt, null);
  assert.equal(max.percent, 100);
});

test('经验：长度、本人帖、同帖日限、重复与撤销（G05–G09、G14）', () => {
  const db = fresh();
  db.session = { userId: 'u_zhixia' };
  const start = S.xpOf(db, 'u_zhixia');

  // 19 个有效字 → 0；20 个 → +5
  const shortPost = A.createPost(db, { board: 'method', body: '一二三四五六七八九十一二三四五六七八九' }, NOW);
  assert.ok(shortPost.ok);
  assert.equal(S.xpOf(db, 'u_zhixia'), start, '短帖不计分');
  const goodPost = A.createPost(db, { board: 'method', body: '一二三四五六七八九十一二三四五六七八九十' }, NOW);
  assert.ok(goodPost.ok);
  assert.equal(S.xpOf(db, 'u_zhixia'), start + 5, '20 个有效字计 +5');

  // 同一帖子同日第二条评论不再计分
  A.addComment(db, { postId: 'p_calc_notes', body: '这条评论有足够的内容，可以计入成长值。' }, NOW);
  const afterFirst = S.xpOf(db, 'u_zhixia');
  A.addComment(db, { postId: 'p_calc_notes', body: '这是同一帖子里的第二条合格评论，但不再计分。' }, NOW);
  assert.equal(S.xpOf(db, 'u_zhixia'), afterFirst, '同帖日限');

  // 本人帖评论不计分
  const own = A.addComment(db, { postId: goodPost.data.postId, body: '作者在自己帖子下面的合格评论内容。' }, NOW);
  assert.ok(own.ok);
  assert.equal(S.xpOf(db, 'u_zhixia'), afterFirst, '本人帖不计分');

  // 删除帖子撤回发帖奖励
  A.removePost(db, { postId: goodPost.data.postId }, NOW);
  assert.equal(S.xpOf(db, 'u_zhixia'), start + 1, '删帖撤回 +5');
});

test('经验：每天最多 5 条评论、重复文本不重复计分（G07–G08）', () => {
  const db = fresh();
  db.session = { userId: 'u_zhixia' };
  const posts = [];
  for (let i = 0; i < 6; i += 1) {
    const created = A.createPost(db, {
      board: 'method', body: `这是第 ${i} 篇用来测试评论日额的长帖子，正文足够二十个有效字符。`
    }, NOW);
    posts.push(created.data.postId);
  }
  db.session = { userId: 'u_nanzhi' };
  const start = S.xpOf(db, 'u_nanzhi');
  posts.forEach((postId, i) => {
    A.addComment(db, { postId, body: `第 ${i} 条评论的内容足够十个有效字符，用于测试日额。` }, NOW);
  });
  assert.equal(S.xpOf(db, 'u_nanzhi'), start + 5, '每天最多 5 条评论经验');

  const again = A.addComment(db, { postId: posts[0], body: '第 0 条评论的内容足够十个有效字符，用于测试日额。' }, NOW + 24 * 3600 * 1000);
  assert.ok(again.ok, '重复文本仍可发布');
});



test('经验：重复文本、删评论撤销与点赞不加分（G07、G14、G18）', () => {
  const db = fresh();
  const me = 'u_zhixia';
  db.session = { userId: me };

  // 同一天在两篇不同帖子发相同文本：第二条 0
  const first = A.addComment(db, { postId: 'p_calc_notes', body: '这段内容足够十个有效字符，用来测试重复判定。' }, NOW);
  assert.ok(first.ok);
  const xpAfterFirst = S.xpOf(db, me);
  const dup = A.addComment(db, { postId: 'p_calc_problems', body: '这段内容足够十个有效字符，用来测试重复判定。' }, NOW);
  assert.ok(dup.ok, '重复文本仍可发布');
  assert.equal(S.xpOf(db, me), xpAfterFirst, '重复文本不计分');

  // 删除评论撤回 +1
  A.removeComment(db, { commentId: first.data.comment.id }, NOW);
  assert.equal(S.xpOf(db, me), xpAfterFirst - 1, '删评论撤回 +1');

  // 点赞不加经验
  const before = S.xpOf(db, me);
  A.toggleReaction(db, { postId: 'p_py_recursion', kind: 'like' }, NOW);
  assert.equal(S.xpOf(db, me), before, '点赞不加经验');
});

test('经验：采纳日额（G10–G13）', () => {
  const db = fresh();
  const askers = ['u_qinghe', 'u_linjian', 'u_zhixia'];
  const postIds = askers.map((asker, i) => {
    db.session = { userId: asker };
    const created = A.createPost(db, {
      board: 'help', body: `这是第 ${i} 个求助帖，想请同学帮忙看看解题的第一步和定义域。`
    }, NOW);
    return created.data.postId;
  });

  db.session = { userId: 'u_momo' };
  const commentIds = postIds.map((postId, i) => {
    const c = A.addComment(db, {
      postId, body: `第 ${i} 种思路是先换元再代入，注意定义域与符号，最后检查一遍。`
    }, NOW);
    return c.data.comment.id;
  });
  assert.equal(S.xpOf(db, 'u_momo'), 3, '三条评论各 +1');

  askers.forEach((asker, i) => {
    db.session = { userId: asker };
    const result = A.acceptComment(db, { postId: postIds[i], commentId: commentIds[i] }, NOW);
    assert.ok(result.ok, '业务上可以采纳');
  });
  assert.equal(S.xpOf(db, 'u_momo'), 23, '同一接收者每天最多 2 次采纳奖励：3 + 10 + 10');
  const decisions = db.growthDecisions.filter((d) => d.type === 'accepted');
  assert.equal(decisions.filter((d) => d.amount > 0).length, 2);
  assert.ok(decisions.some((d) => d.reason === 'DAILY_LIMIT' && d.amount === 0));
});


test('经验：收到页签 +5、同发送者与日额限制（页签参与升级）', () => {
  const db = fresh();
  const target = 'u_qinghe';
  const senders = ['u_nanzhi', 'u_momo', 'u_alan', 'u_zhouzhou'];
  senders.forEach((id) => { db.wallets[id] = { userId: id, balance: 10, updatedAt: new Date(NOW).toISOString() }; });

  db.session = { userId: target };
  const extra1 = A.createPost(db, { board: 'method', body: '测试页签经验用的第一篇帖子，正文足够二十个有效字符。' }, NOW).data.postId;
  const extra2 = A.createPost(db, { board: 'method', body: '测试页签经验用的第二篇帖子，正文足够二十个有效字符。' }, NOW).data.postId;
  const extra3 = A.createPost(db, { board: 'method', body: '测试页签经验用的第三篇帖子，正文足够二十个有效字符。' }, NOW).data.postId;
  const base = S.xpOf(db, target);

  // 第一位同学送 1 枚 → +5
  db.session = { userId: 'u_nanzhi' };
  assert.ok(A.sendGift(db, { postId: 'p_calc_problems', qty: 1, idemKey: 'pm1' }, NOW).ok);
  assert.equal(S.xpOf(db, target), base + 5);

  // 同一发送者当天第二次 → 业务可送，但不再加分
  assert.ok(A.sendGift(db, { postId: extra1, qty: 1, idemKey: 'pm2' }, NOW).ok);
  assert.equal(S.xpOf(db, target), base + 5, '同一人每天只触发一次');

  // 另一位同学送 2 枚 → +10
  db.session = { userId: 'u_momo' };
  assert.ok(A.sendGift(db, { postId: extra2, qty: 2, idemKey: 'pm3' }, NOW).ok);
  assert.equal(S.xpOf(db, target), base + 15);

  // 第三位送 2 枚 → +10（累计 5 枚）
  db.session = { userId: 'u_alan' };
  assert.ok(A.sendGift(db, { postId: extra3, qty: 2, idemKey: 'pm4' }, NOW).ok);
  assert.equal(S.xpOf(db, target), base + 25);

  // 第 6 枚 → 0
  db.session = { userId: 'u_zhouzhou' };
  assert.ok(A.sendGift(db, { postId: 'p_calc_problems', qty: 1, idemKey: 'pm5' }, NOW).ok);
  assert.equal(S.xpOf(db, target), base + 25, '每天最多 5 枚页签经验');
});





test('每日页签附带今日一句（泰戈尔）', () => {
  const db = fresh();
  db.session = { userId: 'u_momo' };
  const result = A.claimDaily(db, {}, NOW);
  assert.ok(result.ok, result.message);
  assert.equal(result.data.date, '2026-10-26');
  assert.ok(result.data.quote);
  assert.equal(result.data.quote.text, '天空不留下鸟的痕迹，但我已飞过。');
  assert.equal(result.data.quote.author, '泰戈尔');
  assert.equal(result.data.quote.source, '《飞鸟集》');

  const again = A.claimDaily(db, {}, NOW);
  assert.equal(again.ok, false, '同一天不能重复领取');
});



test('上传与资料发布必须确认文档来源', () => {
  const db = fresh();
  db.session = { userId: 'u_zhixia' };

  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const noConfirm = A.createPost(db, {
    board: 'notes', body: '带图但没确认来源的帖子，正文足够长。', images: [image]
  }, NOW);
  assert.equal(noConfirm.code, 'need_confirm', '带图片必须确认来源');

  const textOnly = A.createPost(db, {
    board: 'method', body: '纯文字帖子不需要上传附件，可以不勾选来源。'
  }, NOW);
  assert.ok(textOnly.ok, '纯文字帖子不强制确认');

  const withResource = A.createPost(db, {
    board: 'notes', body: '正文', attachments: [ATTACHMENT],
    resource: resourceInput()
  }, NOW);
  assert.equal(withResource.code, 'need_confirm', '发布资料必须确认来源');

  const confirmed = A.createPost(db, {
    board: 'notes', body: '带图并确认来源的帖子，正文足够长。', images: [image], confirmedOriginal: true
  }, NOW);
  assert.ok(confirmed.ok, '确认后可以上传');
});


test('每日页签：创立纪念、周年与普通日期', () => {
  const memorial = bookmarkOfDay('2026-10-27');
  assert.equal(memorial.quote, '世界很大，我们共读一页。');
  assert.equal(memorial.attribution, '共页');
  assert.equal(memorial.label, '创立纪念');
  assert.equal(memorial.isAnniversary, true);

  const firstYear = bookmarkOfDay('2027-10-27');
  assert.equal(firstYear.label, '1周年');
  assert.equal(firstYear.isAnniversary, true);

  const ordinary = bookmarkOfDay('2026-10-26');
  assert.equal(ordinary.isAnniversary, false);
  assert.notEqual(ordinary.quote, '世界很大，我们共读一页。');
  assert.equal(ordinary.label, '每日一句');
  assert.ok(ordinary.quote.length > 0);
});

test('今日页签榜：按帖子今天收到的页签数排序', () => {
  // 固定在上海正午：种子里的赠签按“今天”排布，过了午夜用 Date.now() 会跨天失败
  const db = fresh();
  const rows = S.bookmarkBoard(db, { date: shanghaiDate(new Date(NOW)) });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.count), [4, 2, 1]);
  assert.ok(rows.every((row) => row.post && row.post.title));
});



test('第六版每日页签：102 天连续、句子唯一、关键日期正确', () => {
  assert.equal(DAILY_BOOKMARKS.length, 102);
  assert.equal(DAILY_BOOKMARKS[0].date, '2026-10-27');
  assert.equal(DAILY_BOOKMARKS[101].date, '2027-02-05');

  const dates = DAILY_BOOKMARKS.map((entry) => entry.date);
  const uniqueDates = new Set(dates);
  assert.equal(uniqueDates.size, 102);
  const uniqueQuotes = new Set(DAILY_BOOKMARKS.map((entry) => entry.quote));
  assert.equal(uniqueQuotes.size, 102);

  let cursor = Date.parse('2026-10-27T00:00:00Z');
  for (const date of dates) {
    assert.equal(new Date(cursor).toISOString().slice(0, 10), date);
    cursor += 86400000;
  }

  assert.equal(bookmarkEntry('2026-11-07').event_name, '立冬');
  assert.equal(bookmarkEntry('2026-12-22').event_name, '冬至');
  assert.equal(bookmarkEntry('2027-01-15').event_name, '腊八节');
  assert.equal(bookmarkEntry('2027-01-30').event_name, '北方小年');
  assert.equal(bookmarkEntry('2027-01-31').event_name, '南方小年');
  assert.equal(bookmarkEntry('2027-02-05').event_name, '除夕');
  assert.equal(bookmarkEntry('2027-02-05').lunar_label, '腊月廿九');
  assert.equal(bookmarkEntry('2026-12-13').event_type, 'remembrance');

  assert.equal(bookmarkEntry('2026-10-26'), null);
  assert.equal(bookmarkEntry('2027-02-06'), null);
});


/* ===== 9.1：课程 Tag、课程优先搜索、草稿、旧资料兼容、逐日插画 ===== */

test('9.1 搜索：线代 + 复习清单让本课程结果排在最前', () => {
  const db = fresh();
  const result = S.searchResources(db, { q: '线代 复习清单' });
  assert.equal(result.course.matched.length, 1);
  assert.equal(result.course.matched[0].name, '线性代数');
  assert.equal(result.course.residual, '复习清单');
  assert.ok(result.items.length >= 1, '应有主结果');
  assert.equal(result.items[0].resource.id, 'r_la_solutions');
  assert.equal(result.items[0].group, 'A', '课程+意图命中必须是第一组');
  assert.ok(result.items.filter((item) => item.group === 'A').every((item) => item.resource.courseId === 'c_la'));
  const otherCourseIndex = result.items.findIndex((item) => item.resource.courseId !== 'c_la');
  assert.ok(otherCourseIndex === -1 || otherCourseIndex > 0, 'B 组只排在课程结果之后');
});

test('9.1 搜索：显式课程筛选是硬条件，课程其余资料进 C 组', () => {
  const db = fresh();
  const result = S.searchResources(db, { q: '微积分 夹逼' });
  assert.equal(result.course.matched[0].id, 'c_calc');
  assert.equal(result.course.residual, '夹逼');
  assert.deepEqual(result.items.map((item) => item.resource.id), ['r_calc_notes']);
  assert.ok(result.courseOnly.some((item) => item.resource.id === 'r_calc_problems'), '无关资料只在 C 组');
  assert.ok(!result.items.some((item) => item.resource.id === 'r_calc_problems'));

  const filtered = S.searchResources(db, { q: '夹逼', courseId: 'c_calc' });
  assert.ok(filtered.items.length >= 1);
  assert.ok([...filtered.items, ...filtered.courseOnly].every((item) => item.resource.courseId === 'c_calc'));
});

test('9.1 搜索：同名校都有资料才判歧义，给候选不自动合并', () => {
  const db = fresh();
  db.courses.push({ id: 'c_la_other', school: '另一所学校', name: '线性代数', code: 'X1', category: '数学基础' });
  db.resources.push({ id: 'r_la_other', postId: 'p_la_other', courseId: 'c_la_other', status: 'indexed' });
  const result = S.searchResources(db, { q: '线代' });
  assert.equal(result.course.ambiguous, true);
  assert.ok(result.course.candidates.length >= 2);
  assert.ok(result.items.every((item) => item.score > 0), '退回文本检索，不空合并');
});

test('9.1 发布：没有课程或课程不存在都被拒绝，草稿可保存且不进搜索', () => {
  const db = fresh();
  login(db);
  const before = S.searchResources(db, {}).total;

  const noCourse = A.createPost(db, {
    board: 'notes', body: '正文', attachments: [ATTACHMENT], confirmedOriginal: true,
    resource: { ...resourceInput(), courseId: '' }
  }, NOW);
  assert.equal(noCourse.code, 'bad_course');
  assert.equal(noCourse.message, '请选择这份资料对应的课程。');

  const badCourse = A.createPost(db, {
    board: 'notes', body: '正文', attachments: [ATTACHMENT], confirmedOriginal: true,
    resource: { ...resourceInput(), courseId: 'nonexistent-course' }
  }, NOW);
  assert.equal(badCourse.code, 'bad_course');

  const draft = A.saveResourceDraft(db, {
    resource: { ...resourceInput(), courseId: '' }, postTitle: '草稿标题', body: '草稿正文'
  }, NOW);
  assert.ok(draft.ok, draft.message);
  assert.equal(S.searchResources(db, {}).total, before, '草稿不进入搜索');
  assert.equal(db.posts.filter((p) => p.title === '草稿标题').length, 0, '草稿不生成帖子');
  assert.ok(db.drafts[db.session.userId]);

  const cleared = A.clearResourceDraft(db);
  assert.ok(cleared.ok);
  assert.equal(db.drafts[db.session.userId], undefined);
});

test('9.1 旧资料：缺课程仍可搜索，作者可补选，别人不能改', () => {
  const db = fresh();
  const resource = S.resourceOf(db, 'r_calc_notes');
  resource.courseId = null;
  const post = S.postOf(db, resource.postId);
  post.courseId = null;

  assert.equal(S.resourceEligibility(db, resource).ok, true, '缺课程不影响可读');
  const result = S.searchResources(db, {});
  assert.ok(result.items.some((item) => item.resource.id === resource.id), '旧资料仍能被搜到');

  const author = db.users.find((user) => user.id === post.authorId);
  db.session = null;
  A.verifyCode(db, { email: 'stranger@example.com', code: A.DEMO_CODE });
  assert.equal(A.setResourceCourse(db, { resourceId: resource.id, courseId: 'c_la' }, NOW).code, 'forbidden');

  db.session = null;
  A.verifyCode(db, { email: author.email, code: A.DEMO_CODE });
  const ok = A.setResourceCourse(db, { resourceId: resource.id, courseId: 'c_la' }, NOW);
  assert.ok(ok.ok, ok.message);
  assert.equal(resource.courseId, 'c_la');
  assert.equal(A.setResourceCourse(db, { resourceId: resource.id, courseId: 'nope' }, NOW).code, 'bad_course');
});

test('9.1 每日页签：每天有独立插画，四个文化日期有中性替代', () => {
  for (const entry of DAILY_BOOKMARKS) {
    assert.equal(entry.illustration_path, `assets/daily/webp/${entry.date}.webp`);
    assert.ok(entry.illustration_scene, '插画场景说明不能为空');
  }
  const neutral = bookmarkEntryFor('2026-10-31', { culturalThemes: false });
  assert.equal(neutral.illustration_variant, 'neutral');
  assert.ok(neutral.illustration_path.includes('-neutral'));
  const festive = bookmarkEntryFor('2026-10-31', { culturalThemes: true });
  assert.equal(festive.illustration_variant, 'primary');
  assert.equal(bookmarkEntryFor('2026-11-01', { culturalThemes: false }).illustration_variant, 'primary');
});

test('9.1 表情：第一弹保留，第二三弹 18 个稳定 ID 追加且无重复', () => {
  assert.equal(STICKERS.length, 22);
  assert.equal(new Set(STICKER_IDS).size, 22);
  ['yeye.received.v1', 'yeye.thanks.v1', 'yeye.cry.v2', 'yeye.bless.v2', 'yeye.overload.v3', 'yeye.dismissed.v3']
    .forEach((id) => assert.ok(isValidSticker(id), `缺少表情 ${id}`));
  assert.equal(STICKERS.filter((s) => s.pack === 2).length, 10);
  assert.equal(STICKERS.filter((s) => s.pack === 3).length, 8);
  assert.ok(!isValidSticker('yeye.unknown.v9'));
});

test('9.2 课程圈：一门课一个圈，不再有教学班、教师与学期字段', () => {
  const db = fresh();
  const realCourses = db.courses.filter((course) => course.id !== 'c_general');
  assert.equal(db.circles.length, realCourses.length, '课程数与圈数一致');
  assert.equal(new Set(db.circles.map((circle) => circle.courseId)).size, db.circles.length, '没有课程有两个圈');
  assert.ok(db.circles.every((circle) => circle.term === undefined && circle.section === undefined && circle.teacher === undefined),
    '9.2 起圈不再带学期/教学班/教师');
  assert.ok(db.circles.every((circle) => circle.status === 'active'));
  assert.equal(new Set(db.circles.map((circle) => circle.inviteCode)).size, db.circles.length, '邀请码唯一');

  const catalogNames = new Set(ZJU_COURSES.map((course) => course.name));
  assert.equal(db.courses.filter((course) => catalogNames.has(course.name)).length, 2371, '2371 个课程名都有对应课程');
  const byName = (name) => db.courses.find((course) => course.name === name);
  const target = byName(ZJU_COURSES[0].name);
  assert.ok(target, '浙大课程应在目录里');
  assert.ok(db.circles.some((circle) => circle.courseId === target.id), '浙大课程也有圈');
  const shared = byName('数据结构');
  assert.ok(shared, '同名演示课程与浙大课程复用一条课程记录');
  assert.equal(db.circles.filter((circle) => circle.courseId === shared.id).length, 1, '同名课程只有一个圈');
  assert.equal(S.circleLabel(db, db.circles[0]).endsWith('课友圈'), true);
});
test('9.1 素材：106 张逐日插画与 18 个新表情文件齐全', async () => {
  const { readdirSync, existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { resolve } = await import('node:path');
  const appDir = resolve(fileURLToPath(new URL('..', import.meta.url)));

  const artDir = resolve(appDir, 'assets/daily/webp');
  const artFiles = readdirSync(artDir).filter((file) => file.endsWith('.webp'));
  assert.equal(artFiles.length, 106, '102 张逐日 + 4 张 neutral');
  for (const entry of DAILY_BOOKMARKS) {
    assert.ok(existsSync(resolve(artDir, `${entry.date}.webp`)), `缺少插画 ${entry.date}`);
  }
  for (const date of ['2026-10-31', '2026-11-26', '2026-12-24', '2026-12-25']) {
    assert.ok(existsSync(resolve(artDir, `${date}-neutral.webp`)), `缺少 neutral ${date}`);
  }

  const fresh = STICKERS.filter((sticker) => sticker.pack > 1);
  assert.equal(fresh.length, 18);
  for (const sticker of fresh) {
    assert.ok(existsSync(resolve(appDir, sticker.file)), `缺少表情文件 ${sticker.id}`);
    assert.ok(existsSync(resolve(appDir, sticker.thumb)), `缺少缩略图 ${sticker.id}`);
  }
});

test('静音只关提醒：本人仍能在圈里发帖和评论', () => {
  const db = fresh();
  A.quickLogin(db, { userId: 'u_qinghe' });
  const circleId = 'ci_calc_a';
  assert.ok(A.setCircleFlag(db, { circleId, flag: 'muted', value: true }).ok);

  const post = A.createPost(db, { board: 'help', circleId, body: '静音之后我还是想问一个问题，应该能发出去。' }, NOW);
  assert.ok(post.ok, post.message);
  const comment = A.addComment(db, { postId: post.data.postId, body: '静音的人也能继续评论。' }, NOW);
  assert.ok(comment.ok, comment.message);

  const feed = S.feedPosts(db, { meId: 'u_qinghe', mode: 'my', limit: 50 }, NOW);
  assert.ok(!feed.items.some((item) => item.circleId === circleId), '静音的圈不进聚合流');
});

test('通知设置：关闭后不再收到对应通知，系统通知不能关', () => {
  const db = fresh();
  A.quickLogin(db, { userId: 'u_qinghe' });
  assert.ok(A.updatePrefs(db, { patch: { replies: false, gifts: false, system: false, junk: 'x' } }).ok);
  assert.deepEqual(db.prefs.u_qinghe, { replies: false, gifts: false }, '只保存可关闭的两项');

  const post = A.createPost(db, { board: 'method', body: '测试通知设置是否真正生效的一篇帖子，长度足够。' }, NOW);
  assert.ok(post.ok, post.message);
  const before = db.notifications.filter((n) => n.userId === 'u_qinghe').length;

  A.quickLogin(db, { userId: 'u_linjian' });
  assert.ok(A.addComment(db, { postId: post.data.postId, body: '这条回复不应该提醒作者。' }, NOW).ok);
  assert.ok(A.claimDaily(db, {}, NOW).ok);
  assert.ok(A.sendGift(db, { postId: post.data.postId, qty: 1, idemKey: 'prefs-1' }, NOW).ok);
  assert.equal(db.notifications.filter((n) => n.userId === 'u_qinghe').length, before, '回复和页签都不再通知');

  A.quickLogin(db, { userId: 'u_qinghe' });
  assert.ok(A.updatePrefs(db, { patch: { replies: true } }).ok);
  A.quickLogin(db, { userId: 'u_linjian' });
  assert.ok(A.addComment(db, { postId: post.data.postId, body: '打开后这条回复应该提醒作者。' }, NOW).ok);
  assert.equal(db.notifications.filter((n) => n.userId === 'u_qinghe').length, before + 1, '重新打开后恢复通知');
});

test('发帖课程：不挂圈可以关联课程，课程必须存在', () => {
  const db = fresh();
  A.quickLogin(db, { userId: 'u_qinghe' });
  const good = A.createPost(db, { board: 'notes', courseId: 'c_la', body: '这是一篇不挂圈但属于线性代数的笔记分享。' }, NOW);
  assert.ok(good.ok, good.message);
  assert.equal(S.postOf(db, good.data.postId).courseId, 'c_la');

  const bad = A.createPost(db, { board: 'notes', courseId: 'c_not_exist', body: '课程不存在时应该被拒绝。' }, NOW);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'bad_course');
});

test('建圈申请：目录外课程可申请，管理员通过后建课建圈并通知申请人', () => {
  const db = fresh();
  A.quickLogin(db, { userId: 'u_qinghe' });
  const applied = A.submitApplication(db, { courseName: ' 量子烹饪学 ', reason: '这学期开课' }, NOW);
  assert.ok(applied.ok, applied.message);
  const app = db.applications[db.applications.length - 1];
  assert.equal(app.courseName, '量子烹饪学');
  assert.equal(app.courseId, null);
  assert.ok(A.submitApplication(db, { courseName: '量子烹饪学' }, NOW).ok, '重复申请幂等');
  assert.equal(db.applications.filter((row) => row.courseName === '量子烹饪学').length, 1);
  assert.equal(A.submitApplication(db, { courseName: '微积分Ⅰ' }, NOW).code, 'duplicate', '已有圈的课程不用申请');
  assert.equal(A.submitApplication(db, { courseName: 'x' }, NOW).code, 'bad_course');
  assert.equal(A.resolveApplication(db, { applicationId: app.id, action: 'approve' }, NOW).code, 'forbidden');

  A.quickLogin(db, { userId: 'u_admin' });
  const done = A.resolveApplication(db, { applicationId: app.id, action: 'approve' }, NOW);
  assert.ok(done.ok, done.message);
  assert.equal(app.state, 'approved');
  const course = db.courses.find((row) => row.name === '量子烹饪学');
  assert.ok(course, '目录里新增了课程');
  assert.equal(S.circleOfCourse(db, course.id).id, app.circleId);
  assert.ok(db.notifications.some((n) => n.userId === 'u_qinghe' && n.text.includes('量子烹饪学')));
  assert.equal(A.resolveApplication(db, { applicationId: app.id, action: 'approve' }, NOW).code, 'closed');
});

test('建圈申请：驳回必须写理由，并通知申请人', () => {
  const db = fresh();
  A.quickLogin(db, { userId: 'u_qinghe' });
  assert.ok(A.submitApplication(db, { courseName: '不存在的课' }, NOW).ok);
  const app = db.applications[db.applications.length - 1];

  A.quickLogin(db, { userId: 'u_admin' });
  assert.equal(A.resolveApplication(db, { applicationId: app.id, action: 'reject' }, NOW).code, 'no_reason');
  assert.ok(A.resolveApplication(db, { applicationId: app.id, action: 'reject', reason: '目录里已有同名课程' }, NOW).ok);
  assert.equal(app.state, 'rejected');
  assert.ok(db.notifications.some((n) => n.userId === 'u_qinghe' && n.text.includes('目录里已有同名课程')));
});

test('置顶：只有管理员能设置，帖子必须属于这个圈', () => {
  const db = fresh();
  const circle = S.circleOf(db, 'ci_calc_a');
  circle.pinnedPostId = null;
  A.quickLogin(db, { userId: 'u_qinghe' });
  assert.equal(A.setCirclePin(db, { circleId: circle.id, postId: 'p_calc_notes' }, NOW).code, 'forbidden');

  A.quickLogin(db, { userId: 'u_admin' });
  assert.equal(A.setCirclePin(db, { circleId: circle.id, postId: 'p_py_copy' }, NOW).code, 'bad_post', '别的圈的帖子不能置顶');
  assert.ok(A.setCirclePin(db, { circleId: circle.id, postId: 'p_calc_notes' }, NOW).ok);
  assert.equal(circle.pinnedPostId, 'p_calc_notes');
  assert.ok(A.setCirclePin(db, { circleId: circle.id, postId: null }, NOW).ok);
  assert.equal(circle.pinnedPostId, null);
});

/* ---------- 拉黑、私信举报、圈内管理、注销 ---------- */

function memberOf(db, circleId) {
  const row = db.memberships.find((m) => m.circleId === circleId && m.status === 'active'
    && S.userOf(db, m.userId).role !== 'admin' && m.userId !== 'u_qinghe');
  assert.ok(row, '演示数据里应有其他成员');
  return row.userId;
}

test('拉黑：双方不能互发私信，被拉黑的人不再触发提醒，取消后恢复', () => {
  const db = fresh();
  A.quickLogin(db, { userId: 'u_linjian' });
  assert.ok(A.toggleFollowUser(db, { targetUserId: 'u_qinghe' }, NOW).ok);
  A.quickLogin(db, { userId: 'u_qinghe' });
  assert.ok(A.setBlock(db, { userId: 'u_linjian', blocked: true }, NOW).ok);
  assert.equal(A.setBlock(db, { userId: 'u_qinghe', blocked: true }, NOW).code, 'bad_user', '不能拉黑自己');
  assert.ok(!db.follows.some((f) => f.followerId === 'u_linjian' && f.targetId === 'u_qinghe'), '拉黑后取消关注');
  assert.equal(A.sendDirectMessage(db, { recipientId: 'u_linjian', body: '你好' }, NOW).code, 'blocked');

  const post = A.createPost(db, { board: 'method', body: '拉黑测试用的帖子，正文写长一点满足规则。' }, NOW);
  A.quickLogin(db, { userId: 'u_linjian' });
  assert.equal(A.sendDirectMessage(db, { recipientId: 'u_qinghe', body: '在吗' }, NOW).code, 'blocked');
  const before = db.notifications.filter((n) => n.userId === 'u_qinghe').length;
  assert.ok(A.addComment(db, { postId: post.data.postId, body: '被拉黑的人留下的一条评论。' }, NOW).ok, '公开内容照常可评论');
  assert.equal(db.notifications.filter((n) => n.userId === 'u_qinghe').length, before, '不再提醒拉黑方');

  A.quickLogin(db, { userId: 'u_qinghe' });
  assert.ok(A.setBlock(db, { userId: 'u_linjian', blocked: false }, NOW).ok);
  A.quickLogin(db, { userId: 'u_linjian' });
  assert.ok(A.sendDirectMessage(db, { recipientId: 'u_qinghe', body: '取消拉黑后可以发了' }, NOW).ok);
});

test('私信举报：附上对方发来的私信，管理员可删除，被举报人收到提醒', () => {
  const db = fresh();
  A.quickLogin(db, { userId: 'u_qinghe' });
  assert.equal(A.reportContent(db, { targetType: 'dm', targetId: 'u_linjian', reason: '骚扰' }, NOW).code, 'no_evidence');
  A.quickLogin(db, { userId: 'u_linjian' });
  assert.ok(A.sendDirectMessage(db, { recipientId: 'u_qinghe', body: '第一条骚扰内容' }, NOW).ok);
  assert.ok(A.sendDirectMessage(db, { recipientId: 'u_qinghe', body: '第二条骚扰内容' }, NOW).ok);

  A.quickLogin(db, { userId: 'u_qinghe' });
  assert.ok(A.sendDirectMessage(db, { recipientId: 'u_linjian', body: '请不要再发了' }, NOW).ok);
  assert.ok(A.reportContent(db, { targetType: 'dm', targetId: 'u_linjian', reason: '骚扰', detail: '一直发' }, NOW).ok);
  const report = db.reports[db.reports.length - 1];
  assert.deepEqual(report.evidence.map((row) => row.body), ['第一条骚扰内容', '第二条骚扰内容'], '只附对方发来的私信');
  assert.match(S.reportTargetLabel(db, report), /私信（2 条）/);

  assert.equal(A.resolveReport(db, { reportId: report.id, action: 'remove', reason: '骚扰' }, NOW).code, 'forbidden');
  A.quickLogin(db, { userId: 'u_admin' });
  assert.equal(A.resolveReport(db, { reportId: report.id, action: 'hide', reason: '骚扰' }, NOW).code, 'bad_action');
  assert.ok(A.resolveReport(db, { reportId: report.id, action: 'remove', reason: '骚扰' }, NOW).ok);
  const removed = db.directMessages.filter((row) => row.senderId === 'u_linjian' && row.recipientId === 'u_qinghe');
  assert.ok(removed.every((row) => row.status === 'removed'));
  assert.ok(db.notifications.some((n) => n.userId === 'u_linjian' && n.text.includes('私信')), '被举报人收到提醒');
  assert.ok(db.directMessages.some((row) => row.body === '请不要再发了' && row.status !== 'removed'), '举报人自己的私信不受影响');
});

test('圈内管理：禁言可设天数并自动到期，移出后需管理员允许才能重新加入', () => {
  const db = fresh();
  const circleId = 'ci_calc_a';
  const userId = memberOf(db, circleId);
  A.quickLogin(db, { userId: 'u_qinghe' });
  assert.equal(A.setMemberRestriction(db, { circleId, userId, action: 'mute', reason: '刷屏' }, NOW).code, 'forbidden');

  A.quickLogin(db, { userId: 'u_admin' });
  assert.equal(A.setMemberRestriction(db, { circleId, userId, action: 'mute' }, NOW).code, 'no_reason');
  assert.equal(A.setMemberRestriction(db, { circleId, userId: 'u_admin', action: 'mute', reason: 'x' }, NOW).code, 'forbidden');
  assert.ok(A.setMemberRestriction(db, { circleId, userId, action: 'mute', days: 1, reason: '刷屏' }, NOW).ok);

  A.quickLogin(db, { userId });
  const blocked = A.createPost(db, { board: 'help', circleId, body: '禁言期间尝试发帖，应该被拦下来。' }, NOW);
  assert.equal(blocked.code, 'restricted');
  assert.match(blocked.message, /禁言到/);
  assert.ok(db.notifications.some((n) => n.userId === userId && n.text.includes('禁言 1 天')));

  S.membership(db, userId, circleId).restrictedUntil = new Date(NOW - 1000).toISOString();
  assert.ok(A.createPost(db, { board: 'help', circleId, body: '禁言到期以后可以正常发帖了，长度足够。' }, NOW).ok, '到期自动恢复');

  A.quickLogin(db, { userId: 'u_admin' });
  assert.ok(A.setMemberRestriction(db, { circleId, userId, action: 'remove', reason: '多次违规' }, NOW).ok);
  A.quickLogin(db, { userId });
  assert.equal(A.joinCircle(db, { circleId }, NOW).code, 'removed_member');
  A.quickLogin(db, { userId: 'u_admin' });
  assert.ok(A.setMemberRestriction(db, { circleId, userId, action: 'restore' }, NOW).ok);
  A.quickLogin(db, { userId });
  assert.ok(A.joinCircle(db, { circleId }, NOW).ok, '允许后可以重新加入');
  assert.ok(db.audit.some((row) => row.action === '移出课友圈'));
});

test('注销（保留内容）：资料匿名、私人数据删除、不能再操作，邮箱可以重新注册', () => {
  const db = fresh();
  A.quickLogin(db, { userId: 'u_linjian' });
  assert.ok(A.sendDirectMessage(db, { recipientId: 'u_qinghe', body: '注销前发的私信' }, NOW).ok);
  A.quickLogin(db, { userId: 'u_qinghe' });
  const posts = db.posts.filter((post) => post.authorId === 'u_qinghe' && post.status === 'published').length;
  assert.ok(posts > 0);
  assert.equal(A.deleteAccount(db, { mode: 'anonymize', confirmText: '确认' }, NOW).code, 'need_confirm');
  assert.equal(A.deleteAccount(db, { mode: 'oops', confirmText: '注销' }, NOW).code, 'bad_mode');
  assert.ok(A.deleteAccount(db, { mode: 'anonymize', confirmText: '注销' }, NOW).ok);

  const user = S.userOf(db, 'u_qinghe');
  assert.equal(user.status, 'deleted');
  assert.equal(user.email, '');
  assert.equal(user.nickname, '已注销用户');
  assert.equal(db.posts.filter((post) => post.authorId === 'u_qinghe' && post.status === 'published').length, posts, '内容保留');
  assert.ok(!db.directMessages.some((row) => row.senderId === 'u_qinghe' || row.recipientId === 'u_qinghe'), '私信删除');
  assert.ok(!db.notifications.some((row) => row.userId === 'u_qinghe'));
  assert.equal(S.currentUser(db), null, '注销后会话结束');
  db.session = { userId: 'u_qinghe' };
  assert.equal(A.createPost(db, { board: 'method', body: '注销后的账号不能再发帖了。' }, NOW).code, 'login');

  const again = A.verifyCode(db, { email: 'qinghe@example.com', code: A.DEMO_CODE });
  assert.ok(again.ok);
  assert.notEqual(again.data.user.id, 'u_qinghe', '同一邮箱注册的是新账号');
});

test('注销（删除内容）：帖子永久移除并按规则退回页签；管理员不能自助注销', () => {
  const db = fresh();
  A.quickLogin(db, { userId: 'u_qinghe' });
  const post = A.createPost(db, { board: 'method', body: '准备在注销时一起删除的帖子，长度足够。' }, NOW);
  A.quickLogin(db, { userId: 'u_linjian' });
  assert.ok(A.claimDaily(db, {}, NOW).ok);
  const before = S.walletOf(db, 'u_linjian');
  assert.ok(A.sendGift(db, { postId: post.data.postId, qty: 1, idemKey: 'del-1' }, NOW).ok);
  assert.ok(A.addComment(db, { postId: post.data.postId, body: '别人在这篇下的评论。' }, NOW).ok);

  A.quickLogin(db, { userId: 'u_qinghe' });
  assert.ok(A.deleteAccount(db, { mode: 'delete', confirmText: '注销' }, NOW).ok);
  assert.ok(db.posts.filter((row) => row.authorId === 'u_qinghe').every((row) => row.status === 'removed'));
  assert.ok(db.comments.filter((row) => row.authorId === 'u_qinghe').every((row) => row.status === 'removed'));
  assert.equal(S.walletOf(db, 'u_linjian'), before, '送出的页签已退回');

  A.quickLogin(db, { userId: 'u_admin' });
  assert.equal(A.deleteAccount(db, { mode: 'delete', confirmText: '注销' }, NOW).code, 'admin');
});

test('个人数据导出：包含资料、内容、私信和记录，不含别人的举报证据', () => {
  const db = fresh();
  A.quickLogin(db, { userId: 'u_linjian' });
  assert.ok(A.sendDirectMessage(db, { recipientId: 'u_qinghe', body: '导出里应该有这条' }, NOW).ok);
  A.quickLogin(db, { userId: 'u_qinghe' });
  assert.ok(A.reportContent(db, { targetType: 'dm', targetId: 'u_linjian', reason: '骚扰' }, NOW).ok);
  const data = S.personalData(db, 'u_qinghe', NOW);
  assert.equal(data.profile.email, 'qinghe@example.com');
  assert.ok(data.posts.length > 0);
  assert.ok(data.directMessages.some((row) => row.body === '导出里应该有这条'));
  assert.equal(data.reportsFiled.length, 1);
  assert.equal(data.reportsFiled[0].evidence, undefined, '举报证据是对方的内容，不随导出给出');
  assert.equal(S.personalData(db, 'nope'), null);
});
