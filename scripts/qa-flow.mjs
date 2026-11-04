#!/usr/bin/env node
/* 交互验收脚本（开发用）：在真实 Chrome 里点一遍核心流程。
 *
 * 前提：Chrome 已用 --remote-debugging-port=9222 启动（见 DEPLOY_HANDOFF.md 的验收一节）。
 * 用法：node scripts/qa-flow.mjs [--base http://127.0.0.1:4173]
 *
 * 覆盖：游客下载被拦截 → 演示账号登录 → 领取页签 → 送页签 → 加入课友圈 → 发帖 → 手机导航。
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = argOf('base', 'http://127.0.0.1:4173');
const PORT = Number(argOf('port', '9222'));
const SHOTS = path.resolve(ROOT, argOf('shots', 'docs/screenshots'));

const { WebSocket } = globalThis;
if (!WebSocket) {
  console.error('需要 Node 22+（内置 WebSocket）');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

async function targetUrl() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = await response.json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到 Chrome 页面目标');
  return page.webSocketDebuggerUrl;
}

function createClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let seq = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', (e) => reject(e.error || new Error('WS 连接失败')));
  });
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, { resolve, reject });
    socket.send(JSON.stringify({ id: seq, method, params }));
  });
  return { ready, send, close: () => socket.close() };
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });
  const client = createClient(await targetUrl());
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  const evaluate = async (expression) => {
    const result = await client.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  };

  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const go = async (hash, wait = 650) => {
    await client.send('Page.navigate', { url: `${BASE}/${hash}` });
    await sleep(wait);
  };

  const click = (selector) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'missing';
    el.click();
    return 'clicked';
  })()`);

  const text = () => evaluate("document.getElementById('view').innerText");
  const hash = () => evaluate('location.hash');
  const toastText = () => evaluate("(document.querySelector('.toast') || {}).innerText || ''");

  // 干净状态
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
  });
  await go('#/');
  await evaluate("localStorage.clear(); sessionStorage.clear(); 'ok'");
  await client.send('Page.reload', { ignoreCache: true });
  await sleep(900);

  /* 1. 游客点击下载 → 被要求登录 */
  await go('#/resources/r_calc_notes');
  const downloadClick = await click('[data-action="download"]');
  await sleep(400);
  check('游客下载被拦截并跳转登录', downloadClick === 'clicked' && (await hash()).startsWith('#/login'),
    `hash=${await hash()}`);

  /* 2. 演示账号一键登录 */
  await go('#/login');
  const loginClick = await click('[data-action="quick-login"][data-user="u_qinghe"]');
  await sleep(600);
  const loggedIn = await evaluate("!!document.querySelector('.header-avatar')");
  check('演示账号登录成功', loginClick === 'clicked' && loggedIn, `hash=${await hash()}`);

  /* 3. 领取今日页签 */
  await go('#/me/wallet');
  const before = await evaluate("parseInt(document.querySelector('.sign-balance strong').innerText, 10)");
  const claimClick = await click('[data-action="claim-daily"]');
  await sleep(500);
  const after = await evaluate("parseInt(document.querySelector('.sign-balance strong').innerText, 10)");
  const toast1 = await toastText();
  check('领取页签余额 +1', claimClick === 'clicked' && after === before + 1, `${before} → ${after}；提示：${toast1}`);
  const secondClaim = await click('[data-action="claim-daily"]');
  await sleep(400);
  check('同一天不能重复领取', secondClaim === 'missing', '按钮已消失或禁用');

  /* 4. 送页签弹层 */
  await go('#/posts/p_py_recursion');
  const giftOpen = await click('[data-action="open-gift"]');
  await sleep(400);
  const modalOpen = await evaluate("!!document.querySelector('.modal')");
  check('送页签弹层可打开', giftOpen === 'clicked' && modalOpen);
  const giftSend = await click('[data-action="send-gift"]');
  await sleep(600);
  const modalClosed = await evaluate("!document.querySelector('.modal')");
  const toast2 = await toastText();
  check('送出 1 枚页签', giftSend === 'clicked' && modalClosed, toast2);
  await go('#/me/wallet');
  const afterGift = await evaluate("parseInt(document.querySelector('.sign-balance strong').innerText, 10)");
  check('赠送后余额 -1', afterGift === after - 1, `${after} → ${afterGift}`);

  /* 5. 加入课友圈 */
  await go('#/find-circles');
  const joinClick = await click('[data-action="join-circle"]');
  await sleep(600);
  const joinedText = await text();
  check('加入课友圈后状态更新', joinClick === 'clicked' && joinedText.includes('已加入'), await toastText());

  /* 6. 发布帖子 */
  await go('#/publish');
  await evaluate(`(() => {
    const body = document.querySelector('textarea[name="body"]');
    body.value = '这是验收脚本发布的一条演示帖子，用来检查发布流程与详情页渲染。';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    const agree = document.querySelector('input[name="original"]');
    if (agree) agree.checked = true;
    return 'filled';
  })()`);
  const publishClick = await click('form[data-form="post"] button[type="submit"]');
  await sleep(800);
  const afterPublishHash = await hash();
  const postText = await text();
  check('发布帖子成功并进入详情', publishClick === 'clicked' && afterPublishHash.startsWith('#/posts/p_')
    && postText.includes('验收脚本发布'), `hash=${afterPublishHash}`);

  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(SHOTS, 'flow-published-post-1440.png'), Buffer.from(shot.data, 'base64'));

  /* 6b. 发布资料（找资料闭环：发布 → 详情 → 可被检索） */
  await go('#/publish/resource');
  await evaluate(`(() => {
    const set = (name, value) => {
      const el = document.querySelector('[name="' + name + '"]');
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('resTitle', '验收脚本资料：极限计算复盘');
    set('resourceCourse', 'c_calc');
    set('coverage', '数列极限与夹逼，适合期中复习，覆盖率较高的章节。');
    set('limitations', '不含导数与中值定理');
    set('body', '这是验收脚本发布的资料说明，用来检查资料发布闭环。');
    set('tags', '验收,极限');
    const pick = document.querySelector('[data-file-picker]');
    if (pick) pick.value = '0';
    return 'filled';
  })()`);
  await click('[data-action="add-file"]');
  await sleep(500);
  await evaluate(`(() => {
    const a = document.querySelector('input[name="confirmIndex"]');
    const b = document.querySelector('input[name="original"]');
    if (a) a.checked = true;
    if (b) b.checked = true;
    return 'checked';
  })()`);
  await click('form[data-form="resource"] button[type="submit"]');
  await sleep(900);
  const resHash = await hash();
  const resText = await text();
  check('发布资料后进入资料详情', resHash.startsWith('#/resources/r_') && resText.includes('适用范围'),
    `hash=${resHash}`);

  await go(`#/resources?q=${encodeURIComponent('极限计算复盘')}`, 800);
  const searchText = await text();
  check('新资料立刻可被检索到', searchText.includes('极限计算复盘'), '搜索关键词：极限计算复盘');

  /* 7. 手机底部导航 */
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true
  });
  await go('#/circles', 800);
  const mobileNav = await evaluate(`(() => {
    const nav = document.getElementById('mobile-nav');
    const shown = getComputedStyle(nav).display !== 'none';
    return { shown, items: Array.from(nav.querySelectorAll('a')).map((a) => a.innerText.trim()) };
  })()`);
  check('手机底部导航显示 5 项', mobileNav.shown && mobileNav.items.length === 5, mobileNav.items.join(' / '));
  const overflow = await evaluate('document.documentElement.scrollWidth - window.innerWidth');
  check('手机端无横向溢出', overflow <= 1, `overflow=${overflow}px`);
  const mobileShot = await client.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(SHOTS, 'flow-mobile-circles-390.png'), Buffer.from(mobileShot.data, 'base64'));

  /* 8. 管理员处理举报 */
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
  });
  await go('#/me/settings');
  await click('[data-action="logout"]');
  await sleep(500);
  await go('#/login');
  await evaluate("document.querySelector('[data-action=\"quick-login\"][data-user=\"u_admin\"]').click(); 'ok'");
  await sleep(700);
  await go('#/admin');
  const reportLinkCount = await evaluate("document.querySelectorAll('[data-action=\"open-report-admin\"]').length");
  const openReport = await click('[data-action="open-report-admin"]');
  await sleep(400);
  const reportModal = await evaluate("!!document.querySelector('form[data-form=\"admin-report\"]')");
  check('管理员可打开举报处理弹层', reportLinkCount > 0 && openReport === 'clicked' && reportModal,
    `待处理 ${reportLinkCount} 条`);
  await evaluate(`(() => {
    document.querySelector('textarea[name="reason"]').value = '验收脚本：先隐藏，等作者说明。';
    document.querySelector('select[name="action"]').value = 'hide';
    return 'filled';
  })()`);
  await click('form[data-form="admin-report"] button[type="submit"]');
  await sleep(700);
  const adminText = await text();
  check('举报处理写入审计与状态', adminText.includes('已处理') || adminText.includes('处理'),
    await toastText());
  const adminShot = await client.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(SHOTS, 'flow-admin-1440.png'), Buffer.from(adminShot.data, 'base64'));

  client.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


