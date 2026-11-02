#!/usr/bin/env node
/* 内部试用版浏览器验收：真实注册 → 发帖 → 刷新保持登录 → 退出。
 *
 * 前提：
 *   1) 试用后端已启动（node server/index.mjs，端口默认 8787）
 *   2) 该后端白名单里包含 TEST_EMAIL 指定的邮箱
 *   3) Chrome 已用 --remote-debugging-port=9222 启动
 *
 * 用法：node scripts/qa-pilot.mjs [--base http://127.0.0.1:8787] [--email pilot@team.test]
 */

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = argOf('base', 'http://127.0.0.1:8787');
const PORT = Number(argOf('port', '9222'));
const EMAIL = argOf('email', 'pilot@team.test');
const CODE = '123456';

const { WebSocket } = globalThis;
if (!WebSocket) {
  console.error('需要 Node 22+');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function createClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let seq = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', (e) => reject(e.error || new Error('WS 失败')));
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
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到 Chrome 页面目标');
  const client = createClient(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
  });

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

  const go = async (hash, wait = 700) => {
    await client.send('Page.navigate', { url: `${BASE}/${hash}` });
    await sleep(wait);
  };

  const click = (selector) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'missing';
    el.click();
    return 'clicked';
  })()`);

  await go('#/login', 900);
  // 强制整页重载，避免复用上一次会话里缓存的 config.js
  await client.send('Page.reload', { ignoreCache: true });
  await sleep(1100);

  const mode = await evaluate("(window.__GONGYE_CONFIG__ || {}).mode");
  check('后端把站点切换为试用模式', mode === 'production', `mode=${mode}`);

  const pageText = await evaluate("document.getElementById('view').innerText");
  check('登录页提示内部试用与固定验证码', pageText.includes('内部试用') && pageText.includes('123456'));
  check('试用版不显示演示账号切换', !pageText.includes('使用演示账号'));

  const filled = await evaluate(`(() => {
    const email = document.querySelector('input[name="email"]');
    const code = document.querySelector('input[name="code"]');
    if (!email || !code) return 'missing';
    email.value = ${JSON.stringify(EMAIL)};
    code.value = ${JSON.stringify(CODE)};
    return 'filled';
  })()`);
  await click('form[data-form="login-verify"] button[type="submit"]');
  await sleep(1000);

  const afterLogin = await evaluate(`({
    hash: location.hash,
    hasAvatar: !!document.querySelector('.header-avatar'),
    text: document.getElementById('view').innerText.slice(0, 200)
  })`);
  check('名单内邮箱注册并登录成功', filled === 'filled' && afterLogin.hasAvatar, `hash=${afterLogin.hash}`);

  await go('#/publish');
  await evaluate(`(() => {
    const body = document.querySelector('textarea[name="body"]');
    body.value = '验收脚本：这是通过真实后端写入的一条帖子，用于确认试用版可用。';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    const agree = document.querySelector('input[name="original"]');
    if (agree) agree.checked = true;
    return 'ok';
  })()`);
  await click('form[data-form="post"] button[type="submit"]');
  await sleep(1200);
  const postHash = await evaluate('location.hash');
  const postText = await evaluate("document.getElementById('view').innerText");
  check('通过后端发帖并进入详情', postHash.startsWith('#/posts/p_') && postText.includes('验收脚本'), postHash);

  // 刷新页面：会话来自 Cookie，数据来自服务端 JSON 文件
  await client.send('Page.reload', { ignoreCache: true });
  await sleep(1200);
  const afterReload = await evaluate(`({
    hasAvatar: !!document.querySelector('.header-avatar'),
    text: document.getElementById('view').innerText
  })`);
  check('刷新后仍保持登录', afterReload.hasAvatar);
  check('刷新后帖子仍在（服务端已保存）', afterReload.text.includes('验收脚本'));

  await go('#/me/settings');
  await click('[data-action="logout"]');
  await sleep(900);
  const afterLogout = await evaluate(`({
    hasAvatar: !!document.querySelector('.header-avatar'),
    text: document.body.innerText
  })`);
  check('退出登录后回到游客状态', !afterLogout.hasAvatar && afterLogout.text.includes('登录'));

  client.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
