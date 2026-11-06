import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { createProductionServer } from '../server/production.mjs';
import { createPilotServer } from '../server/pilot.mjs';
import { ProductionStore, createProductionSeed } from '../server/database.mjs';
import { publicState } from '../server/view.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const files = {
  async handle() { return false; },
  async prepareAttachments(_user, inputs) { assert.deepEqual(inputs, []); return []; },
  async finalizePost() {},
  async downloadResource() { return { ok: false, code: 'not_found', message: '未找到文件' }; }
};
async function fixture(run, options = {}) {
  const dir = await fs.mkdtemp(path.join(TEST_ROOT, '.tmp-production-'));
  const sent = [];
  let stamp = Date.now();
  let service;
  let base;
  async function start(extra = {}) {
    service = await createProductionServer({ dataFile: path.join(dir, 'state.sqlite'), files,
      sendMail: async (mail) => sent.push(mail), now: () => stamp, adminEmails: ['admin@zju.edu.cn'],
      ...options, ...extra });
    const address = await service.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${address.port}`;
  }
  await start();
  async function request(route, init = {}) {
    const response = await fetch(`${base}${route}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
    const body = await response.json().catch(() => null);
    return { response, body };
  }
  const action = (name, payload = {}, cookie = '', extraHeaders = {}) => request('/api/action', {
    method: 'POST', headers: { origin: base, 'x-requested-with': 'gongye', cookie, ...extraHeaders },
    body: JSON.stringify({ name, payload })
  });
  async function login(email) {
    const sentReply = await action('requestCode', { email });
    assert.equal(sentReply.response.status, 200);
    const code = sent.findLast((mail) => mail.email === email).code;
    const reply = await action('verifyCode', { email, code });
    assert.equal(reply.response.status, 200, JSON.stringify(reply.body));
    return { ...reply, cookie: reply.response.headers.get('set-cookie').split(';')[0], id: reply.body.state.session.userId };
  }
  try {
    await run({ action, request, login, sent, dir, get service() { return service; },
      advance: (ms) => { stamp += ms; }, get base() { return base; },
      restart: async (extra) => { await service.close(); await start(extra); } });
  } finally { await service.close(); await fs.rm(dir, { recursive: true, force: true }); }
}

test('production only permits exact configured school domains and disables cloud/quick login', async () => {
  await fixture(async ({ action, sent }) => {
    for (const email of ['x@example.com', 'x@evilzju.edu.cn', 'x@zju.edu.cn.evil.test', 'x@sub.zju.edu.cn', 'x@@zju.edu.cn']) {
      const reply = await action('requestCode', { email });
      assert.ok([400, 403].includes(reply.response.status));
    }
    for (const name of ['cloudSignIn', 'quickLogin', 'finishAttachmentProcessing', 'newId', 'recordEvent']) {
      const reply = await action(name, { email: 'admin@zju.edu.cn', userId: 'u_admin' });
      assert.equal(reply.response.status, 403);
    }
    assert.equal(sent.length, 0);
    const allowed = await action('requestCode', { email: 'a@st.zju.edu.cn' });
    assert.equal(allowed.response.status, 200);
  });
});

test('missing SMTP configuration fails closed without fixed codes', async () => {
  await fixture(async ({ action, service, request }) => {
    assert.equal(service.authReady, false);
    for (const name of ['requestCode', 'verifyCode']) {
      const reply = await action(name, { email: 'admin@zju.edu.cn', code: '123456' });
      assert.equal(reply.response.status, 503);
      assert.equal(reply.body.error.code, 'auth_unavailable');
    }
    const health = await request('/api/health');
    assert.equal(health.body.authReady, false);
  }, { sendMail: null, env: {} });
});

test('server OTP is six-digit, consumed once, cooled down, limited to five failures, and expires', async () => {
  await fixture(async ({ action, sent, advance, request }) => {
    const email = 'alice@zju.edu.cn';
    const first = await action('requestCode', { email });
    assert.equal(first.response.status, 200);
    assert.match(sent[0].code, /^\d{6}$/);
    assert.equal(JSON.stringify(first.body).includes(sent[0].code), false);
    assert.equal((await action('requestCode', { email })).response.status, 429);
    const good = await action('verifyCode', { email, code: sent[0].code });
    assert.equal(good.body.result.ok, true);
    assert.equal(good.body.result.data.token, undefined);
    assert.match(good.response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(good.response.headers.get('set-cookie'), /SameSite=Lax/);
    assert.equal((await action('verifyCode', { email, code: sent[0].code })).response.status, 400);
    const bearer = await request('/api/state', { headers: { authorization: `Bearer ${good.response.headers.get('set-cookie').split('=')[1].split(';')[0]}` } });
    assert.equal(bearer.body.state.session, null);
    advance(61_000);
    await action('requestCode', { email });
    const current = sent.at(-1).code;
    const wrong = current === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) assert.equal((await action('verifyCode', { email, code: wrong })).response.status, 400);
    assert.equal((await action('verifyCode', { email, code: current })).response.status, 400);
    advance(61_000);
    await action('requestCode', { email });
    const expired = sent.at(-1).code;
    advance(601_000);
    assert.equal((await action('verifyCode', { email, code: expired })).response.status, 400);
  });
});

test('per-email/IP OTP throttles cannot be bypassed with many requests', async () => {
  await fixture(async ({ action, advance }) => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await action('requestCode', { email: 'quota@zju.edu.cn' })).response.status, 200);
      advance(61_000);
    }
    assert.equal((await action('requestCode', { email: 'quota@zju.edu.cn' })).response.status, 429);
    let blocked = 0;
    for (let i = 0; i < 21; i++) if ((await action('requestCode', { email: `many${i}@zju.edu.cn` })).response.status === 429) blocked++;
    assert.ok(blocked > 0);
  });
});

test('ban immediately invalidates sessions; logout revokes; admin comes only from configuration', async () => {
  await fixture(async ({ action, login, request, service }) => {
    const alice = await login('alice@zju.edu.cn');
    const admin = await login('admin@zju.edu.cn');
    assert.equal(alice.body.result.data.user.role, 'user');
    assert.equal(admin.body.result.data.user.role, 'admin');
    assert.equal((await action('setUserStatus', { userId: admin.id, status: 'suspended' }, alice.cookie)).response.status, 403);
    assert.equal((await action('setUserStatus', { userId: alice.id, status: 'suspended' }, admin.cookie)).body.result.ok, true);
    assert.equal((await request('/api/state', { headers: { cookie: alice.cookie } })).body.state.session, null);
    assert.equal((await action('createPost', { board: 'method', body: 'forbidden' }, alice.cookie)).response.status, 401);
    assert.equal(service.db.sessions.some((s) => s.userId === alice.id), false);
    await action('logout', {}, admin.cookie);
    assert.equal((await request('/api/state', { headers: { cookie: admin.cookie } })).body.state.session, null);
    assert.equal((await action('setUserStatus', { userId: alice.id, status: 'active' }, admin.cookie)).response.status, 401);
  });
});

test('HTTPS config sets secure cookie; non-loopback HTTP fails before opening storage', async () => {
  await assert.rejects(createProductionServer({ publicOrigin: 'http://school.example.com', files }), /requires_https/);
  await fixture(async ({ action, sent }) => {
    await action('requestCode', { email: 'secure@zju.edu.cn' }, '', { origin: 'https://school.example.com' });
    const reply = await action('verifyCode', { email: 'secure@zju.edu.cn', code: sent.at(-1).code }, '', { origin: 'https://school.example.com' });
    assert.match(reply.response.headers.get('set-cookie'), /; Secure/);
    assert.match(reply.response.headers.get('strict-transport-security'), /max-age/);
  }, { publicOrigin: 'https://school.example.com' });
});

test('restart preserves shared state and sessions but invalidates unconsumed OTPs', async () => {
  await fixture(async (ctx) => {
    const alice = await ctx.login('alice@zju.edu.cn');
    const created = await ctx.action('createPost', { board: 'method', courseId: ctx.service.db.courses.find((c) => c.id !== 'c_general').id, term: '通用·不限学期', body: '一份学生自己整理的学习心得，测试持久保存。' }, alice.cookie);
    assert.equal(created.body.result.ok, true);
    await ctx.action('requestCode', { email: 'waiting@zju.edu.cn' });
    const oldCode = ctx.sent.at(-1).code;
    const revision = ctx.service.store.revision;
    await ctx.restart();
    const state = await ctx.request('/api/state', { headers: { cookie: alice.cookie } });
    assert.equal(state.body.state.session.userId, alice.id);
    assert.ok(state.body.state.posts.some((p) => p.id === created.body.result.data.postId));
    assert.ok(ctx.service.store.revision >= revision);
    assert.equal((await ctx.action('verifyCode', { email: 'waiting@zju.edu.cn', code: oldCode })).response.status, 400);
    assert.equal(ctx.service.db.users.some((u) => /^u_(qinghe|admin)$/.test(u.id)), false);
    assert.equal(ctx.service.db.session, null);
  });
});

test('cross-origin or unmarked writes rejected, static sensitive paths unavailable', async () => {
  await fixture(async ({ action, request, base }) => {
    assert.equal((await action('requestCode', { email: 'a@zju.edu.cn' }, '', { origin: 'https://evil.test' })).response.status, 403);
    assert.equal((await action('requestCode', { email: 'a@zju.edu.cn' }, '', { 'x-requested-with': '' })).response.status, 403);
    assert.equal((await action('requestCode', { email: 'a@zju.edu.cn' }, '', { 'sec-fetch-site': 'cross-site' })).response.status, 403);
    const originless = await request('/api/action', { method: 'POST', headers: { 'x-requested-with': 'gongye' }, body: JSON.stringify({ name: 'requestCode', payload: { email: 'a@zju.edu.cn' } }) });
    assert.equal(originless.response.status, 403);
    for (const route of ['/server/production.mjs', '/server/data/production.sqlite', '/server/data/db.json', '/tests/pilot.test.mjs', '/README.md', '/package.json', '/.env', '/assets/vendor/wb-cloud-sdk.global.js', '/assets/../server/index.mjs', '/src/%2e%2e/server/index.mjs', '/src/..%5cserver/index.mjs']) {
      const reply = await request(route);
      assert.equal(reply.response.status, 404, route);
    }
    const config = await fetch(`${base}/src/config.js`).then((r) => r.text());
    assert.match(config, /email-otp/);
    assert.match(config, /emailDomains/);
    assert.doesNotMatch(config, /123456|publishableKey|SMTP_PASS/);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/src/main.js`)).status, 200);
  });
});

test('two people and concurrent async actions cannot leak db.session, collection lists or wallets', async () => {
  await fixture(async ({ login, action, request, service }) => {
    const alice = await login('alice@zju.edu.cn');
    const bob = await login('bob@zju.edu.cn');
    const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => action('createPost', {
      board: 'method', courseId: service.db.courses.find((c) => c.id !== 'c_general').id, term: '通用·不限学期', body: `第${i}条独立学习内容，贡献者只由服务器会话决定。`
    }, i % 2 ? alice.cookie : bob.cookie)));
    for (let i = 0; i < replies.length; i++) {
      assert.equal(replies[i].body.result.ok, true);
      const post = service.db.posts.find((p) => p.id === replies[i].body.result.data.postId);
      assert.equal(post.authorId, i % 2 ? alice.id : bob.id);
      assert.equal(replies[i].body.state.session.userId, i % 2 ? alice.id : bob.id);
    }
    const circleId = service.db.circles[0].id;
    await action('joinCircle', { circleId }, bob.cookie);
    await action('claimDaily', {}, bob.cookie);
    await action('toggleReaction', { postId: service.db.posts[0].id, kind: 'save' }, bob.cookie);
    const state = (await request('/api/state', { headers: { cookie: alice.cookie } })).body.state;
    assert.equal(state.memberships.some((m) => m.userId === bob.id), false);
    assert.equal(state.reactions.some((m) => m.userId === bob.id), false);
    assert.equal(state.wallets[bob.id], undefined);
    assert.equal(state.sessions, undefined);
    assert.equal(state.uploads, undefined);
    assert.equal(state.users.find((u) => u.id === bob.id).email, '');
    assert.equal(state.memberCounts[circleId], 1);
    assert.equal(service.db.session, null);
  });
});

test('publicState uses nested field allowlists even for admins and processing files', () => {
  const db = createProductionSeed();
  db.users.push(...['alice', 'bob', 'admin', 'banned'].map((id) => ({ id, email: `${id}@zju.edu.cn`, nickname: id, role: id === 'admin' ? 'admin' : 'user', verified: true, status: id === 'banned' ? 'suspended' : 'active', secret: 'never' })));
  db.posts.push({ id: 'public', authorId: 'bob', status: 'published', body: '公开内容', privateField: 'never' }, { id: 'hidden', authorId: 'bob', status: 'banned', body: '待审核' }, { id: 'bannedAuthor', authorId: 'banned', status: 'published' });
  db.attachments.push({ id: 'ready', uploadId: 'upload_1', postId: 'public', status: 'ready', path: '/physical/secret.pdf', scanPath: '/scan/private', pages: 2 }, { id: 'processing', uploadId: 'upload_2', postId: 'public', status: 'processing', path: '/private/work' });
  db.resources.push({ id: 'resource', postId: 'public', status: 'unindexed', indexEnabled: false, title: '资料', source: 'self', rights: 'owner', previews: ['/private/scan.png'] });
  db.sessions.push({ tokenHash: 'NEVER' });
  db.prefs.bob = { replies: false, secret: 'never' };
  db.memberships.push({ userId: 'bob', circleId: db.circles[0].id, status: 'active', moderationMuted: true });
  db.reports.push({ id: 'r', reason: '审核内容', privatePath: 'never' });
  db.growthDecisions.push({ userId: 'bob', id: 'gd', reason: 'reason', meta: { norm: 'private text' } });
  db.xp.push({ userId: 'bob', delta: 5, sourceId: 'hidden' });
  const alice = publicState(db, 'alice');
  assert.deepEqual(alice.posts.map((p) => p.id), ['public']);
  assert.deepEqual(alice.attachments.map((a) => a.id), ['ready']);
  assert.equal(alice.resources[0].status, 'unindexed');
  assert.equal(alice.attachments[0].path, '/api/files/upload_1/download');
  assert.deepEqual(alice.resources[0].previews, ['/api/files/upload_1/preview/1', '/api/files/upload_1/preview/2']);
  assert.deepEqual(alice.memberships, []);
  assert.deepEqual(alice.growthDecisions, []);
  assert.deepEqual(alice.xp, []);
  assert.equal(alice.userStats.bob.xp, 5);
  const bob = publicState(db, 'bob');
  assert.equal(bob.attachments.find((a) => a.id === 'processing').path, null);
  assert.equal(bob.memberships[0].moderationMuted, true);
  assert.equal(bob.growthDecisions[0].meta, undefined);
  const admin = publicState(db, 'admin');
  assert.ok(admin.posts.some((p) => p.id === 'hidden'));
  assert.equal(admin.users.find((u) => u.id === 'bob').email, '');
  assert.deepEqual(admin.memberships, []);
  assert.equal(admin.reports.length, 1);
  const encoded = JSON.stringify(admin);
  assert.doesNotMatch(encoded, /physical|private\/|scanPath|tokenHash|NEVER|never|privateField/);
});

test('store rejects corrupted existing data and rolls back failed actions without resetting', async () => {
  const dir = await fs.mkdtemp(path.join(TEST_ROOT, '.tmp-production-db-'));
  let store;
  try {
    const bad = path.join(dir, 'broken.sqlite');
    await fs.writeFile(bad, 'corrupted existing data');
    assert.throws(() => new ProductionStore(bad));
    assert.equal(await fs.readFile(bad, 'utf8'), 'corrupted existing data');
    store = new ProductionStore(path.join(dir, 'valid.sqlite'));
    const revision = store.revision;
    await assert.rejects(store.run(async (db) => {
      db.posts.push({ id: 'rolled_back' });
      await store.save(); // Must not deadlock, nor commit until the entire action succeeds.
      throw new Error('test rollback');
    }), /rollback/);
    assert.equal(store.data.posts.length, 0);
    assert.equal(store.revision, revision);
    await store.save((db) => db.posts.push({ id: 'committed' }));
    assert.equal(store.revision, revision + 1);
    assert.equal(store.data.posts[0].id, 'committed');
  } finally { await store?.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('legacy pilot cannot expose storage, invoke scans, impersonate cloud emails or reuse banned sessions', async () => {
  const dir = await fs.mkdtemp(path.join(TEST_ROOT, '.tmp-production-pilot-'));
  let pilot;
  try {
    pilot = await createPilotServer({ dataFile: path.join(dir, 'db.json'), allowlistFile: path.join(dir, 'missing.txt'),
      allowedDomains: 'corp.test', adminEmail: 'boss@corp.test', cookieSecure: false });
    const address = await pilot.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${address.port}`;
    async function post(name, payload, cookie = '') {
      const response = await fetch(`${base}/api/action`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name, payload }) });
      return { response, body: await response.json() };
    }
    const admin = await post('verifyCode', { email: 'boss@corp.test', code: '123456' });
    const cookie = admin.response.headers.get('set-cookie').split(';')[0];
    assert.equal((await post('finishAttachmentProcessing', { attachmentId: 'any' }, cookie)).response.status, 400);
    // 未登录调用禁用动作：认证层返回 401、动作白名单返回 403，两者都算拒绝
    const cloudAttempt = (await post('cloudSignIn', { email: 'boss@corp.test' })).response.status;
    assert.ok([401, 403].includes(cloudAttempt), `禁用动作应被拒绝，实际 ${cloudAttempt}`);
    for (const route of ['/server/data/db.json', '/server/index.mjs', '/tests/pilot.test.mjs', '/package.json']) assert.equal((await fetch(`${base}${route}`)).status, 404);
    const meId = admin.body.state.session.userId;
    await post('setUserStatus', { userId: meId, status: 'suspended' }, cookie);
    assert.equal((await fetch(`${base}/api/admin/export`, { headers: { cookie } })).status, 403);
    assert.equal(pilot.db.sessions.some((s) => s.userId === meId), false);
    const state = await fetch(`${base}/api/state`, { headers: { cookie } }).then((r) => r.json());
    assert.equal(state.state.session, null);
    assert.equal(state.state.sessions, undefined);
    assert.equal(state.state.memberships.length, 0);
    await pilot.close();
    pilot = await createPilotServer({ dataFile: path.join(dir, 'db.json'), requireCloudAuth: true, allowedDomains: 'corp.test' });
    const next = await pilot.listen(0, '127.0.0.1');
    const denied = await fetch(`http://127.0.0.1:${next.port}/api/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'cloudSignIn', payload: { email: 'someone@corp.test' } }) });
    assert.ok([401, 403].includes(denied.status), `cloudSignIn 应被拒绝，实际 ${denied.status}`);
  } finally { await pilot?.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
