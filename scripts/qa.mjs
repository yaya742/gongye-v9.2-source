#!/usr/bin/env node
/* 浏览器验收脚本（开发用，不属于部署产物）
 *
 * 前提：本机有 Chrome，并且已经用调试端口启动：
 *   chrome --headless=new --no-sandbox --remote-debugging-port=9222 \
 *          --user-data-dir=%TEMP%\gy-qa about:blank
 *
 * 用法：node scripts/qa.mjs [--base http://127.0.0.1:4173] [--shots docs/shots]
 *
 * 它会逐个打开核心页面，检查：控制台异常、页面内错误提示、横向溢出、
 * 关键文案是否存在，并保存截图（桌面 1440 与手机 390）。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = argOf('base', 'http://127.0.0.1:4173');
const SHOTS = path.resolve(ROOT, argOf('shots', 'docs/shots'));
const DEBUG_PORT = Number(argOf('port', '9222'));

const CASES = [
  { name: 'home', hash: '#/', must: ['找资料', '全部资料'] },
  { name: 'resources', hash: '#/resources?q=数列极限', must: ['搜索', '查看预览'] },
  { name: 'resource-detail', hash: '#/resources/r_calc_notes', must: ['适用范围', '前两页预览', '资料讨论'] },
  { name: 'circles', hash: '#/circles', must: ['我的课友圈', '可赠页签'] },
  { name: 'circle', hash: '#/circles/ci_calc_a', must: ['本周学习索引', '讨论'] },
  { name: 'circle-physics', hash: '#/circles/ci_phys', must: ['课程圈', '加入这个课友圈'] },
  { name: 'post', hash: '#/posts/p_calc_notes', must: ['评论', '送页签'] },
  { name: 'find-circles', hash: '#/find-circles', must: ['找到你正在上的课', '提交申请'] },
  { name: 'invite', hash: '#/invite/GY-CALC-A26', must: ['登录后确认加入'] },
  { name: 'login', hash: '#/login', must: ['登录共页', '发送验证码'] },
  { name: 'search', hash: '#/search?q=递归', must: ['仅看含附件'] },
  { name: 'course', hash: '#/courses/c_calc', must: ['微积分Ⅰ', '当前学期的课友圈'] },
  { name: 'wallet-guest', hash: '#/me/wallet', must: ['我的页签'] },
  { name: 'admin-guest', hash: '#/admin', must: ['需要管理员权限'] },
  { name: 'notfound', hash: '#/no-such-page', must: ['这个页面不存在'] }
];

const LOGGED_IN_CASES = [
  { name: 'me-wallet', hash: '#/me/wallet', must: ['领取今日页签', '收支记录'] },
  { name: 'me-messages', hash: '#/me/messages', must: ['未读'] },
  { name: 'me-saved', hash: '#/me/saved', must: ['我的收藏'] },
  { name: 'me-settings', hash: '#/me/settings', must: ['通知', '退出登录'] },
  { name: 'profile', hash: '#/u/u_qinghe', must: ['橘子还没熟', '经验'] },
  { name: 'compose', hash: '#/publish', must: ['发一篇学习帖子', '同时收录到找资料'] },
  { name: 'compose-resource', hash: '#/publish/resource', must: ['分享资料', '适用范围'] },
  { name: 'circle-joined', hash: '#/circles/ci_calc_a', must: ['已加入', '静音'] },
  { name: 'post-own', hash: '#/posts/p_calc_notes', must: ['编辑', '讨论'] }
];

const { WebSocket } = globalThis;
if (!WebSocket) {
  console.error('需要 Node 22+（内置 WebSocket）');
  process.exit(1);
}

async function targetUrl() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const list = await response.json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到可用的 Chrome 页面目标');
  return page.webSocketDebuggerUrl;
}

function createClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const events = [];
  let seq = 0;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', (event) => reject(event.error || new Error('WebSocket 连接失败')));
  });

  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
    } else if (data.method) {
      events.push(data);
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, { resolve, reject });
    socket.send(JSON.stringify({ id: seq, method, params }));
  });

  return { ready, send, events, close: () => socket.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });
  const client = createClient(await targetUrl());
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');

  const problems = [];
  let shotCount = 0;

  const evaluate = async (expression) => {
    const result = await client.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || '页面求值失败');
    }
    return result.result.value;
  };

  async function visit(testCase, viewport) {
    client.events.length = 0;
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 768
    });
    await client.send('Page.navigate', { url: `${BASE}/${testCase.hash}` });
    await sleep(700);

    const report = await evaluate(`(() => {
      const view = document.getElementById('view');
      const runtimeError = document.getElementById('runtime-error');
      const text = view ? view.innerText : '';
      return {
        title: document.title,
        text,
        html: view ? view.innerHTML.length : 0,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        error: runtimeError ? runtimeError.innerText : null,
        boot: text.includes('正在载入界面')
      };
    })()`);

    const exceptions = client.events
      .filter((e) => e.method === 'Runtime.exceptionThrown')
      .map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
    const logErrors = client.events
      .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
      .map((e) => e.params.entry.text);

    const missing = testCase.must.filter((word) => !report.text.includes(word));
    if (missing.length && viewport.width >= 1024) {
      problems.push(`${testCase.name}: 缺少文案 ${missing.join('、')}`);
    }
    if (report.error) problems.push(`${testCase.name}: 页面错误提示 → ${report.error.split('\n')[0]}`);
    if (report.boot) problems.push(`${testCase.name}: 仍显示启动占位`);
    if (exceptions.length) problems.push(`${testCase.name}: 控制台异常 → ${exceptions[0].split('\n')[0]}`);
    if (logErrors.length) problems.push(`${testCase.name}: 资源/日志错误 → ${logErrors[0].split('\n')[0]}`);
    if (report.scrollWidth > report.innerWidth + 1) {
      problems.push(`${testCase.name}: 横向溢出 ${report.scrollWidth} > ${report.innerWidth}`);
    }

    const file = path.join(SHOTS, `${testCase.name}-${viewport.width}.png`);
    const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(file, Buffer.from(shot.data, 'base64'));
    shotCount += 1;
    return report;
  }

  const desktop = { width: 1440, height: 1100 };
  const mobile = { width: 390, height: 844 };

  // 每次验收都从干净状态开始：整页加载 + 清空本地演示数据
  await client.send('Emulation.setDeviceMetricsOverride', { ...desktop, deviceScaleFactor: 1, mobile: false });
  await client.send('Page.navigate', { url: `${BASE}/?qa=${Date.now()}` });
  await sleep(800);
  await evaluate("localStorage.clear(); sessionStorage.clear(); 'cleared'");
  await client.send('Page.reload', { ignoreCache: true });
  await sleep(900);

  console.log('— 游客视角 —');
  for (const testCase of CASES) {
    const report = await visit(testCase, desktop);
    console.log(`  ${testCase.name.padEnd(16)} html=${String(report.html).padStart(6)} ${report.title}`);
    if (['home', 'resource-detail', 'circles'].includes(testCase.name)) {
      await visit(testCase, mobile);
    }
  }

  console.log('— 登录视角（清禾）—');
  // 用同一个存储键写入会话，然后整页重载（等价于用户登录后继续浏览）
  await evaluate(`(async () => {
    const { createStore } = await import('/src/state/store.js');
    const store = createStore({ key: 'gongye-demo-v1' });
    store.commit((db) => { db.session = { userId: 'u_qinghe', startedAt: new Date().toISOString() }; });
    return 'ok';
  })()`);
  await client.send('Page.reload', { ignoreCache: true });
  await sleep(900);
  for (const testCase of LOGGED_IN_CASES) {
    const report = await visit(testCase, desktop);
    console.log(`  ${testCase.name.padEnd(16)} html=${String(report.html).padStart(6)} ${report.title}`);
    if (['me-wallet', 'compose'].includes(testCase.name)) {
      await visit(testCase, mobile);
    }
  }

  // 手机端主导航与响应式
  await visit({ name: 'mobile-circles', hash: '#/circles', must: ['课友圈'] }, mobile);

  client.close();

  console.log(`\n截图 ${shotCount} 张 → ${path.relative(ROOT, SHOTS)}`);
  if (problems.length) {
    console.error(`\n发现 ${problems.length} 个问题：`);
    problems.forEach((p) => console.error(` - ${p}`));
    process.exitCode = 1;
  } else {
    console.log('浏览器验收通过：无控制台异常、无页面错误、无横向溢出。');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});




