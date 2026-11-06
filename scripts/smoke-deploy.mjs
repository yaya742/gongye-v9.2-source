#!/usr/bin/env node
/* 部署后自检：只读探测目标站点的公开行为，不登录、不上传、不改数据。
 * 用法：
 *   node scripts/smoke-deploy.mjs https://study.example.org
 *   SMOKE_BASE=http://127.0.0.1:8787 node scripts/smoke-deploy.mjs
 * 退出码 0 = 全部通过；1 = 有硬性失败；2 = 通过但有需要人工确认的警告。
 */
const base = (process.argv[2] || process.env.SMOKE_BASE || '').trim().replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('用法：node scripts/smoke-deploy.mjs https://你的域名');
  process.exit(1);
}

let failures = 0;
let warnings = 0;
const pass = (name, detail = '') => console.log(`PASS  ${name}${detail ? ' · ' + detail : ''}`);
const fail = (name, detail = '') => { failures += 1; console.log(`FAIL  ${name}${detail ? ' · ' + detail : ''}`); };
const warn = (name, detail = '') => { warnings += 1; console.log(`WARN  ${name}${detail ? ' · ' + detail : ''}`); };

async function get(path) {
  try {
    const response = await fetch(base + path, { redirect: 'manual' });
    return { response, text: await response.text() };
  } catch (error) {
    return { error };
  }
}

const home = await get('/');
if (home.error) fail('首页可访问', home.error.message);
else if (home.response.status !== 200) fail('首页可访问', `HTTP ${home.response.status}`);
else if (!home.text.includes('共页')) fail('首页内容', '未见站点标题');
else pass('首页可访问', `HTTP 200，${home.text.length} 字符`);

const health = await get('/api/health');
if (health.error) fail('/api/health', health.error.message);
else {
  let body = null;
  try { body = JSON.parse(health.text); } catch { /* 下面统一报错 */ }
  if (!body?.ok) fail('/api/health', `HTTP ${health.response.status}`);
  else {
    pass('/api/health', `mode=${body.mode} authMode=${body.authMode}`);
    if (body.mode !== 'production') warn('运行模式', `当前 mode=${body.mode}，不是生产模式`);
    if (body.authReady !== true) warn('邮箱验证码', 'authReady=false：SMTP 未配置或不可用，真实用户无法登录');
  }
}

const state = await get('/api/state');
if (state.error) fail('/api/state', state.error.message);
else {
  let body = null;
  try { body = JSON.parse(state.text); } catch { /* 下面统一报错 */ }
  if (state.response.status !== 200 || !body?.state) fail('/api/state', `HTTP ${state.response.status}`);
  else {
    const raw = state.text;
    const leaks = [
      /[A-Za-z]:\\\\?\\?(?:SQTP|Users|app)/, /\/opt\/gongye/, /server\/data/, /SMTP_PASS/, /123456/
    ].filter((pattern) => pattern.test(raw));
    if (leaks.length) fail('/api/state 不含内部路径或密钥', `${leaks.length} 处可疑内容`);
    else pass('/api/state', `${body.state.courses?.length ?? 0} 门课程、${body.state.circles?.length ?? 0} 个圈`);
    if (body.state.session) warn('匿名会话', '未登录访问却返回了 session');
    const courses = body.state.courses?.length ?? 0;
    if (courses < 100) warn('课程目录', `只有 ${courses} 条，确认导入的是全校目录`);
  }
}

for (const path of ['/server/index.mjs', '/package.json', '/tests/logic.test.mjs',
  '/migration/manifest.example.json', '/assets/vendor/wb-cloud-sdk.global.js', '/.env', '/.git/config']) {
  const probe = await get(path);
  if (probe.error) fail(`敏感路径 ${path}`, probe.error.message);
  else if (probe.response.status === 200) fail(`敏感路径 ${path}`, '竟然是 200，服务端静态暴露有问题');
  else pass(`敏感路径 ${path}`, `HTTP ${probe.response.status}`);
}

for (const path of ['/src/main.js', '/assets/css/app.css', '/index.html']) {
  const probe = await get(path);
  if (probe.error) fail(`静态资源 ${path}`, probe.error.message);
  else if (probe.response.status !== 200) fail(`静态资源 ${path}`, `HTTP ${probe.response.status}`);
  else pass(`静态资源 ${path}`, `HTTP 200`);
}

const csrf = await fetch(base + '/api/action', { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'requestCode', payload: { email: 'smoke@example.com' } }) }).catch(() => null);
if (!csrf) fail('跨站 POST 拒绝', '请求失败');
else if (csrf.status === 403) pass('跨站 POST 拒绝', 'HTTP 403');
else if (csrf.status === 401 || csrf.status === 400) warn('跨站 POST 拒绝', `HTTP ${csrf.status}，建议确认同源校验仍生效`);
else fail('跨站 POST 拒绝', `HTTP ${csrf.status}，未按预期拒绝`);

const secureCookieNote = base.startsWith('https://') ? '（部署到公网必须是 https）' : '（本机 http 仅用于验收）';
if (!base.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(base)) {
  fail('HTTPS', `公网必须 https${secureCookieNote}`);
} else pass('协议', base.split(':')[0]);

const unknown = await get('/api/definitely-not-an-endpoint');
if (unknown.response?.status === 404) pass('未知接口', 'HTTP 404');
else warn('未知接口', `HTTP ${unknown.response?.status ?? 'n/a'}`);

console.log(`\n合计：失败 ${failures} 项，警告 ${warnings} 项`);
if (failures) process.exit(1);
process.exit(warnings ? 2 : 0);
