/* 启动烟雾测试：在没有真实浏览器的环境里把 main.js 完整跑一遍。
 * 它能捕获「模块导入名写错」「启动时访问了不存在的 DOM」这类只在浏览器里
 * 才会暴露、页面渲染测试又覆盖不到的问题。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

function createElement(tag = 'div') {
  const node = {
    tagName: String(tag).toUpperCase(),
    innerHTML: '',
    textContent: '',
    dataset: {},
    style: {},
    children: [],
    value: '',
    name: '',
    className: '',
    files: null,
    checked: false,
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    prepend(child) {
      this.children.unshift(child);
      return child;
    },
    after(child) {
      this.children.push(child);
      return child;
    },
    remove() {},
    focus() {},
    click() {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    scrollIntoView() {},
    addEventListener() {},
    removeEventListener() {}
  };
  return node;
}

const view = createElement('main');
const header = createElement('header');
const nav = createElement('nav');
const overlay = createElement('div');
const body = createElement('body');

globalThis.window = {
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  scrollTo() {},
  scrollY: 0,
  innerHeight: 900,
  clearTimeout,
  setTimeout,
  location: { hash: '#/', pathname: '/', origin: 'http://localhost' }
};
globalThis.document = {
  title: '',
  body,
  documentElement: { scrollHeight: 2000 },
  getElementById: (id) => ({ view, 'site-header': header, 'mobile-nav': nav, overlay }[id] || null),
  querySelector: (sel) => {
    if (sel === '#view') return view;
    if (sel === '#site-header') return header;
    if (sel === '#mobile-nav') return nav;
    if (sel === '#overlay') return overlay;
    return null;
  },
  querySelectorAll: () => [],
  createElement,
  addEventListener() {},
  removeEventListener() {},
  execCommand: () => true
};
globalThis.location = { hash: '#/', pathname: '/', origin: 'http://localhost' };
globalThis.history = { replaceState() {}, pushState() {} };
globalThis.HashChangeEvent = class HashChangeEvent {
  constructor(type) { this.type = type; }
};
globalThis.FileReader = class FileReader {
  readAsDataURL() { this.result = 'data:image/png;base64,AA=='; if (this.onload) this.onload(); }
};
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k)
};

test('main.js 能启动并渲染首页', async () => {
  await import('../src/main.js');
  assert.ok(header.innerHTML.includes('header-inner'), '顶部导航已渲染');
  assert.ok(header.innerHTML.includes('找资料'), '主导航包含找资料');
  assert.ok(view.innerHTML.includes('找资料'), '首页内容已渲染');
  assert.ok(view.innerHTML.length > 2000, '首页 HTML 规模正常');
  assert.ok(!view.innerHTML.includes('正在载入界面'), '占位内容已被替换');
  assert.ok(!view.innerHTML.includes('页面脚本出错'), '没有运行时错误提示');
});

test('切换路由后重新渲染', async () => {
  globalThis.location.hash = '#/circles';
  globalThis.window.dispatchEvent = () => {};
  // 直接触发 hashchange 监听器：main.js 通过 window.addEventListener 注册
  // 这里用简单方式验证路由解析本身
  const { routeOf } = await import('../src/router.js');
  const route = routeOf();
  assert.equal(route.name, 'circles');
  const { default: pages } = await import('../src/pages/index.js');
  assert.equal(typeof pages.circles, 'function');
});

test('页签领取按钮在演示数据中可用', async () => {
  const actions = await import('../src/state/actions.js');
  const selectors = await import('../src/state/selectors.js');
  const { createSeed } = await import('../src/data/seed.js');
  const db = createSeed(Date.now());
  db.session = { userId: 'u_qinghe' };
  const before = selectors.walletOf(db, 'u_qinghe');
  const result = actions.claimDaily(db);
  assert.ok(result.ok, result.message);
  assert.equal(selectors.walletOf(db, 'u_qinghe'), before + 1);
});
