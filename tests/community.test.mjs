import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/data/seed.js';
import * as A from '../src/state/actions.js';
import * as S from '../src/state/selectors.js';
import { TERMS } from '../src/lib/format.js';
import { about } from '../src/pages/misc.js';
const NOW = Date.UTC(2026, 9, 26, 4);
function fresh() { return createSeed(NOW, { keepDemoPosts: true }); }
function admin(db) { db.session = { userId: 'u_admin' }; }
function student(db) { db.session = { userId: 'u_qinghe' }; }
function payload() {
  return {
    board: 'notes', courseId: 'c_calc', title: '原创极限笔记',
    body: '这是我自己整理的极限学习笔记，可用于复习参考。',
    attachments: [{ name: 'notes.pdf', sizeBytes: 1000, pages: 3, status: 'ready', path: 'local-test' }],
    confirmedOriginal: true,
    resource: { title: '原创极限笔记', courseId: 'c_calc', school: '浙江大学',
      term: '2026秋', type: '笔记', coverage: '数列极限与夹逼定理', limitations: '不含导数',
      confirmedIndex: true, source: '本人原创整理，含个人推导', rights: '原创' }
  };
}

test('通知静音不限制发言；管理员禁言不可通过个人设置或退出重入绕过', () => {
  const db = fresh(); student(db);
  assert.ok(A.setCircleFlag(db, { circleId: 'ci_calc_a', flag: 'muted', value: true }).ok);
  assert.ok(S.circleWriteBlock(db, 'u_qinghe', 'ci_calc_a').ok);
  assert.ok(A.updatePost(db, { postId: 'p_calc_notes', body: '通知静音后仍可正常编辑自己的学习笔记。' }).ok);
  assert.equal(A.setCircleRestriction(db, { circleId: 'ci_calc_a', userId: 'u_qinghe', restricted: false, reason: '自解禁' }).code, 'forbidden');
  admin(db);
  assert.ok(A.setCircleRestriction(db, { circleId: 'ci_calc_a', userId: 'u_qinghe', restricted: true, reason: '违规测试' }, NOW).ok);
  student(db);
  const original = S.postOf(db, 'p_calc_notes').body;
  assert.ok(A.setCircleFlag(db, { circleId: 'ci_calc_a', flag: 'muted', value: false }).ok);
  assert.equal(A.updatePost(db, { postId: 'p_calc_notes', body: '绕过限制编辑新内容不应成功。' }).ok, false);
  assert.equal(S.postOf(db, 'p_calc_notes').body, original);
  assert.ok(A.leaveCircle(db, { circleId: 'ci_calc_a' }).ok);
  assert.ok(A.joinCircle(db, { circleId: 'ci_calc_a' }).ok);
  assert.equal(S.circleWriteBlock(db, 'u_qinghe', 'ci_calc_a').ok, false);
  assert.equal(A.addComment(db, { postId: 'p_calc_notes', body: '借公开资料纠错入口也不能绕过管理员限制。' }).ok, false);
  admin(db);
  assert.ok(A.setCircleRestriction(db, { circleId: 'ci_calc_a', userId: 'u_qinghe', restricted: false, reason: '解除测试' }).ok);
  student(db); assert.ok(S.circleWriteBlock(db, 'u_qinghe', 'ci_calc_a').ok);
});

test('生产资料必须有可信课程、有效学期与来源权利声明', () => {
  const db = fresh(); db.production = true; student(db);
  const missing = payload(); delete missing.resource.rights;
  assert.equal(A.createPost(db, missing, NOW).code, 'bad_rights');
  const short = payload(); short.resource.source = '有';
  assert.equal(A.createPost(db, short, NOW).code, 'bad_source');
  const term = payload(); term.resource.term = '任意学期';
  assert.equal(A.createPost(db, term, NOW).code, 'bad_term');
  const invalid = payload(); invalid.resource.courseId = 'c_general';
  assert.equal(A.createPost(db, invalid, NOW).code, 'bad_course');
  const created = A.createPost(db, { ...payload(), chapter: '第一章 数列极限' }, NOW);
  assert.ok(created.ok, created.message);
  const resource = S.resourceForPost(db, created.data.postId);
  assert.equal(resource.source, '本人原创整理，含个人推导');
  assert.equal(resource.rights, '原创');
  assert.equal(S.postOf(db, created.data.postId).term, '2026秋');
  assert.equal(S.postOf(db, created.data.postId).chapter, '第一章 数列极限');
  assert.equal(S.feedPosts(db, { term: '2026秋' }).items.some((p) => p.id === created.data.postId), true);
  assert.equal(S.feedPosts(db, { term: '2025秋' }).items.some((p) => p.id === created.data.postId), false);
  assert.ok(TERMS.includes('历史学期·详见说明'));
});

test('最小化DTO通过聚合计数维持人数、收藏、关注与等级，不需暴露清单', () => {
  const db = { circles: [{ id: 'ci', memberCount: 90 }], memberships: [], reactions: [], gifts: [], follows: [], xp: [],
    memberCounts: { ci: 100 }, postCounts: { p: { like: 12, save: 30, comments: 7, commenters: 4, giftQty: 9, gifters: 5 } },
    userStats: { u: { xp: 150, followers: 11, following: 8, receivedGiftQty: 9 } } };
  assert.equal(S.countMembers(db, 'ci'), 100);
  assert.equal(S.reactionCount(db, 'p', 'like'), 12);
  assert.equal(S.reactionCount(db, 'p', 'save'), 30);
  assert.equal(S.commentCount(db, 'p'), 7);
  assert.equal(S.giftedQtyForPost(db, 'p'), 9);
  assert.equal(S.xpOf(db, 'u'), 150);
  assert.equal(S.followerCount(db, 'u'), 11);
  assert.equal(S.followingCount(db, 'u'), 8);
  assert.equal(S.receivedGiftTotal(db, 'u'), 9);
});

test('管理员审核申请幂等，新圈不赋予申请人管理权', () => {
  const db = fresh();
  db.courses.push({ id: 'c_new', name: '新增课程', school: '浙江大学' }); student(db);
  assert.ok(A.submitApplication(db, { courseId: 'c_new', reason: '已有目录缺圈' }, NOW).ok);
  const application = db.applications.find((a) => a.courseId === 'c_new');
  assert.equal(A.reviewApplication(db, { applicationId: application.id, approved: true, reason: '审核通过' }).code, 'forbidden');
  admin(db);
  assert.ok(A.reviewApplication(db, { applicationId: application.id, approved: true, reason: '确有课程，补建' }, NOW).ok);
  assert.equal(application.state, 'approved');
  assert.equal(db.circles.filter((c) => c.courseId === 'c_new').length, 1);
  assert.equal(S.userOf(db, 'u_qinghe').role, 'user');
  assert.equal(A.reviewApplication(db, { applicationId: application.id, approved: true, reason: '重复' }).ok, false);
});

test('停用账号立即吊销所有会话，恢复也不复活旧会话', () => {
  const db = fresh(); db.production = true; admin(db);
  db.sessions = [{ userId: 'u_qinghe', id: 'one' }, { userId: 'u_qinghe', id: 'two' }, { userId: 'u_admin', id: 'admin' }];
  assert.ok(A.setUserStatus(db, { userId: 'u_qinghe', status: 'suspended', reason: 'test' }).ok);
  assert.deepEqual(db.sessions.map((s) => s.id), ['admin']);
  assert.ok(A.setUserStatus(db, { userId: 'u_qinghe', status: 'active' }).ok);
  assert.deepEqual(db.sessions.map((s) => s.id), ['admin']);
});

test('治理页面说明非官方、版权与未配置投诉渠道，不杜撰联系方式', () => {
  const html = about({ config: { mode: 'production' } });
  assert.ok(html.includes('不是浙江大学官方'));
  assert.ok(html.includes('进行中考试答案'));
  assert.ok(html.includes('尚未配置'));
  assert.ok(about({ config: { mode: 'production', supportEmail: 'support@example.com' } }).includes('mailto:support@example.com'));
});
