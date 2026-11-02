/* 页面渲染烟雾测试：在没有浏览器的环境里跑一遍所有页面的模板函数。
 * 目的：捕获模板中的运行时错误（未定义变量、空数据越界），不验证样式与布局。
 * 运行：node --test tests/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

/* ---- 最小浏览器环境 ---- */
globalThis.window = {
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  location: { hash: '#/', pathname: '/' }
};
globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} })
};
globalThis.location = { hash: '#/', pathname: '/', origin: 'http://localhost' };
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k)
};

const { createSeed } = await import('../src/data/seed.js');
const actions = await import('../src/state/actions.js');
const selectors = await import('../src/state/selectors.js');
const pages = (await import('../src/pages/index.js')).default;

const NOW = Date.UTC(2026, 9, 26, 4, 0, 0);

function makeCtx(db, routeName, params = {}, query = {}) {
  return {
    config: { demoNotice: '测试提示' },
    db,
    me: selectors.currentUser(db),
    route: { name: routeName, path: '/test', params, query, segments: [] },
    ui: { replyTarget: null, compose: null, images: [], files: [] },
    after: [],
    once(key, fn) { fn(); },
    invoke() { return { ok: true, message: '', data: {} }; },
    refresh() {},
    navigate() {},
    requireLogin() { return false; },
    openModal() {},
    closeModal() {},
    toast() {},
    downloadFile() {},
    copyText() {}
  };
}

function render(name, db, params, query) {
  const fn = pages[name];
  assert.equal(typeof fn, 'function', `缺少页面实现：${name}`);
  const ctx = makeCtx(db, name, params, query);
  const html = fn(ctx);
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 120, `${name} 渲染结果过短`);
  assert.ok(!html.includes('[object Object]'), `${name} 输出中出现 [object Object]`);
  assert.ok(!/undefined<\/|>undefined</.test(html), `${name} 输出中出现裸 undefined`);
  return html;
}

const ROUTES = [
  ['resourcesHome', {}, {}],
  ['resources', {}, { q: '极限' }],
  ['resources', {}, { courseId: 'c_calc', term: '2026秋', type: '笔记', tag: '数列极限', sort: 'saved' }],
  ['resource', { id: 'r_calc_notes' }, {}],
  ['resource', { id: 'r_la_solutions' }, {}],
  ['resource', { id: 'r_missing' }, {}],
  ['resourcePublish', {}, {}],
  ['circles', {}, {}],
  ['circles', {}, { mode: 'discover' }],
  ['circles', {}, { mode: 'following' }],
  ['circles', {}, { mode: 'my', board: 'help' }],
  ['circle', { id: 'ci_calc_a' }, {}],
  ['circle', { id: 'ci_calc_a' }, { tab: 'week' }],
  ['circle', { id: 'ci_calc_a' }, { tab: 'resources' }],
  ['circle', { id: 'ci_phys' }, {}],
  ['circle', { id: 'nope' }, {}],
  ['findCircles', {}, {}],
  ['findCircles', {}, { courseId: 'c_calc' }],
  ['invite', { code: 'GY-CALC-A26' }, {}],
  ['invite', { code: 'BAD-CODE' }, {}],
  ['post', { id: 'p_calc_notes' }, {}],
  ['post', { id: 'p_la_question' }, {}],
  ['post', { id: 'p_py_recursion' }, {}],
  ['post', { id: 'p_calc_old' }, {}],
  ['compose', {}, {}],
  ['compose', {}, { circle: 'ci_calc_a' }],
  ['postEdit', { id: 'p_calc_notes' }, {}],
  ['login', {}, {}],
  ['login', {}, { next: '/me/wallet' }],
  ['profile', { id: 'u_qinghe' }, {}],
  ['profile', { id: 'me' }, {}],
  ['saved', {}, {}],
  ['messages', {}, {}],
  ['messages', {}, { tab: 'reply' }],
  ['wallet', {}, {}],
  ['settings', {}, {}],
  ['course', { id: 'c_calc' }, {}],
  ['course', { id: 'missing' }, {}],
  ['search', {}, { q: '递归' }],
  ['search', {}, { q: '' , tab: 'courses' }],
  ['search', {}, { q: '清', tab: 'users', attachments: '1' }],
  ['admin', {}, {}],
  ['about', {}, {}],
  ['notFound', {}, {}]
];

test('游客视角：所有页面都能渲染', () => {
  const db = createSeed(NOW);
  for (const [name, params, query] of ROUTES) {
    render(name, db, params, query);
  }
});

test('登录视角：所有页面都能渲染（含我的圈、页签、管理后台）', () => {
  const db = createSeed(NOW);
  db.session = { userId: 'u_qinghe' };
  for (const [name, params, query] of ROUTES) {
    render(name, db, params, query);
  }
});

test('管理员视角：后台各页签都能渲染', () => {
  const db = createSeed(NOW);
  db.session = { userId: 'u_admin' };
  ['reports', 'circles', 'users', 'audit', 'stats'].forEach((tab) => {
    render('admin', db, {}, { tab });
  });
});

test('状态页面：处理中、未收录、已移除、归档、禁言都能渲染', () => {
  const db = createSeed(NOW);
  db.session = { userId: 'u_qinghe' };

  // 取消公开索引后，资料详情显示说明而不是下载
  const off = actions.setResourceIndex(db, { resourceId: 'r_calc_problems', enabled: false }, NOW);
  assert.ok(off.ok);
  const offHtml = render('resource', db, { id: 'r_calc_problems' });
  assert.ok(offHtml.includes('取消'), '应提示索引已取消');

  // 处理中的附件
  const processingHtml = render('post', db, { id: 'p_calc_processing' });
  assert.ok(processingHtml.includes('处理中'));

  // 已移除的帖子（作者本人删除）
  const removed = actions.removePost(db, { postId: 'p_calc_problems', reason: '测试' }, NOW);
  assert.ok(removed.ok, removed.message);
  const removedHtml = render('post', db, { id: 'p_calc_problems' });
  assert.ok(removedHtml.includes('永久移除'));

  // 禁言成员查看圈页
  const m = selectors.membership(db, 'u_qinghe', 'ci_calc_a');
  m.muted = true;
  const circleHtml = render('circle', db, { id: 'ci_calc_a' });
  assert.ok(circleHtml.includes('已静音'));

  // 新建用户（无圈、无资料）的所有页面
  const newbie = createSeed(NOW);
  const login = actions.verifyCode(newbie, { email: 'fresh@example.com', code: actions.DEMO_CODE });
  assert.ok(login.ok);
  ['circles', 'compose', 'wallet', 'saved', 'messages'].forEach((name) => render(name, newbie));
});

test('9.1 渲染：资料卡课程 Tag、发布课程必填、找课搜索与分页', () => {
  const db = createSeed(NOW);
  actions.verifyCode(db, { email: 'student@example.com', code: actions.DEMO_CODE });

  const list = render('resources', db, {}, {});
  assert.match(list, /class="res-course-tag"/);
  assert.match(list, /res-type-tag/);
  assert.match(list, /res-meta-line/);

  const publish = render('resourcePublish', db, {}, { course: 'c_calc' });
  assert.ok(publish.includes('<option value="">请选择课程（必填）</option>'));
  assert.match(publish, /data-field-error="resourceCourse"/);
  assert.match(publish, /已从课程页预填「微积分Ⅰ」/);
  assert.match(publish, /data-action="save-resource-draft"/);
  assert.match(publish, /data-action="apply-course"/);

  const find = render('findCircles', db, {}, { q: '微积分' });
  assert.match(find, /匹配到 \d+ 个课程圈/);
  assert.match(find, /id="find-q"/);
  const findAll = render('findCircles', db, {}, {});
  assert.match(findAll, /第 1 \/ \d+ 页/);
  assert.match(findAll, /page=2/);

  const circlePage = render('circle', db, { id: 'ci_calc_a' }, {});
  assert.ok(!circlePage.includes('教学班待补充'), '9.2 起圈页不再出现待补充教学班');
  assert.ok(!circlePage.includes('教师未填写'), '9.2 起圈页不再出现未填写教师');
});
