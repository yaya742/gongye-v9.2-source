/* 内部试用后端测试：白名单注册、会话 Cookie、动作权限、状态脱敏。
 * 运行：node tests/pilot.test.mjs
 * 不依赖外部服务：在进程内启动服务，用临时数据文件。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createPilotServer } from '../server/pilot.mjs';

const DEMO_CODE = '123456';

async function withServer(run, serverOptions = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gongye-pilot-'));
  const allowlistFile = path.join(dir, 'allowlist.txt');
  await fs.writeFile(allowlistFile, ['# 测试名单', 'alice@team.test', '@corp.test'].join('\n'), 'utf8');

  const pilot = await createPilotServer({
    dataFile: path.join(dir, 'db.json'),
    allowlistFile,
    adminEmail: 'boss@corp.test',
    cookieSecure: false,
    ...serverOptions
  });
  const address = await pilot.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;

  const request = async (pathname, options = {}) => {
    const response = await fetch(`${base}${pathname}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  };

  const cookieFrom = (response) => {
    const raw = response.headers.get('set-cookie') || '';
    const match = raw.match(/gy_sid=[^;]+/);
    return match ? match[0] : '';
  };

  try {
    await run({ base, request, cookieFrom, pilot });
  } finally {
    await pilot.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('未登录时能拿到状态，但没有会话', async () => {
  await withServer(async ({ request }) => {
    const { response, body } = await request('/api/state');
    assert.equal(response.status, 200);
    assert.equal(body.state.session, null);
    assert.equal(body.state.sessions, undefined, '不返回会话表');
    assert.ok(Array.isArray(body.state.posts));
  });
});

test('名单内邮箱可以注册，名单外被拒绝', async () => {
  await withServer(async ({ request, cookieFrom }) => {
    const denied = await request('/api/action', {
      method: 'POST',
      body: JSON.stringify({ name: 'verifyCode', payload: { email: 'stranger@other.test', code: DEMO_CODE } })
    });
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.error.code, 'not_allowed');

    const allowed = await request('/api/action', {
      method: 'POST',
      body: JSON.stringify({ name: 'verifyCode', payload: { email: 'alice@team.test', code: DEMO_CODE } })
    });
    assert.equal(allowed.response.status, 200);
    assert.equal(allowed.body.result.ok, true);
    const cookie = cookieFrom(allowed.response);
    assert.match(cookie, /^gy_sid=/);
    assert.ok(allowed.body.state.session.userId, '注册后返回会话');

    const me = await request('/api/state', { headers: { cookie } });
    assert.equal(me.body.state.session.userId, allowed.body.state.session.userId);
    assert.equal(me.body.state.users.find((u) => u.id === me.body.state.session.userId).email, 'alice@team.test');
  });
});

test('域名白名单与管理员邮箱生效', async () => {
  await withServer(async ({ request }) => {
    const member = await request('/api/action', {
      method: 'POST',
      body: JSON.stringify({ name: 'verifyCode', payload: { email: 'anyone@corp.test', code: DEMO_CODE } })
    });
    assert.equal(member.body.result.ok, true);

    const boss = await request('/api/action', {
      method: 'POST',
      body: JSON.stringify({ name: 'verifyCode', payload: { email: 'boss@corp.test', code: DEMO_CODE } })
    });
    assert.equal(boss.body.result.ok, true);
    assert.equal(boss.body.result.data.user.role, 'admin', 'ADMIN_EMAIL 自动成为管理员');
  });
});

test('写操作必须登录；登录后发帖成功', async () => {
  await withServer(async ({ request, cookieFrom }) => {
    const guest = await request('/api/action', {
      method: 'POST',
      body: JSON.stringify({ name: 'createPost', payload: { board: 'method', body: '游客发的帖子' } })
    });
    assert.equal(guest.body.result.ok, false);
    assert.equal(guest.body.result.code, 'login');

    const login = await request('/api/action', {
      method: 'POST',
      body: JSON.stringify({ name: 'verifyCode', payload: { email: 'alice@team.test', code: DEMO_CODE } })
    });
    const cookie = cookieFrom(login.response);

    const created = await request('/api/action', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({
        name: 'createPost',
        payload: { board: 'method', body: '这是内部试用的一条测试帖子，用来验证服务端写入。' }
      })
    });
    assert.equal(created.body.result.ok, true, created.body.result.message);
    const postId = created.body.result.data.postId;
    assert.ok(created.body.state.posts.some((post) => post.id === postId), '状态里能看到新帖子');

    const refreshed = await request('/api/state', { headers: { cookie } });
    assert.ok(refreshed.body.state.posts.some((post) => post.id === postId), '刷新后帖子仍在（已落盘）');
  });
});

test('状态脱敏：其他人的邮箱不返回，会话表不返回', async () => {
  await withServer(async ({ request, cookieFrom }) => {
    const login = await request('/api/action', {
      method: 'POST',
      body: JSON.stringify({ name: 'verifyCode', payload: { email: 'alice@team.test', code: DEMO_CODE } })
    });
    const cookie = cookieFrom(login.response);
    const meId = login.body.state.session.userId;

    const { body } = await request('/api/state', { headers: { cookie } });
    assert.equal(body.state.sessions, undefined);
    body.state.users.forEach((user) => {
      if (user.id === meId) assert.equal(user.email, 'alice@team.test');
      else assert.equal(user.email, '', '其他用户邮箱被清空');
    });
  });
});

test('演示账号切换在试用版被拒绝', async () => {
  await withServer(async ({ request }) => {
    const { response, body } = await request('/api/action', {
      method: 'POST',
      body: JSON.stringify({ name: 'quickLogin', payload: { userId: 'u_qinghe' } })
    });
    assert.equal(response.status, 403);
    assert.equal(body.error.code, 'disabled');
  });
});

test('退出登录后会话失效', async () => {
  await withServer(async ({ request, cookieFrom }) => {
    const login = await request('/api/action', {
      method: 'POST',
      body: JSON.stringify({ name: 'verifyCode', payload: { email: 'alice@team.test', code: DEMO_CODE } })
    });
    const cookie = cookieFrom(login.response);

    const logout = await request('/api/action', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ name: 'logout', payload: {} })
    });
    assert.equal(logout.body.state.session, null);

    const after = await request('/api/state', { headers: { cookie } });
    assert.equal(after.body.state.session, null, '旧 Cookie 不再有效');
  });
});

test('页签领取在服务端生效且当天只能领一次', async () => {
  await withServer(async ({ request, cookieFrom }) => {
    const login = await request('/api/action', {
      method: 'POST',
      body: JSON.stringify({ name: 'verifyCode', payload: { email: 'alice@team.test', code: DEMO_CODE } })
    });
    const cookie = cookieFrom(login.response);

    const first = await request('/api/action', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ name: 'claimDaily', payload: {} })
    });
    assert.equal(first.body.result.ok, true, first.body.result.message);

    const second = await request('/api/action', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ name: 'claimDaily', payload: {} })
    });
    assert.equal(second.body.result.ok, false);
    assert.equal(second.body.result.code, 'claimed');
  });
});

test('跨域预检返回允许头', async () => {
  await withServer(async ({ request }) => {
    const { response } = await request('/api/action', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://gongye.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type'
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://gongye.example.com');
    assert.match(response.headers.get('access-control-allow-headers') || '', /authorization/i);
    assert.match(response.headers.get('access-control-allow-methods') || '', /POST/i);
  });
});

test('跨域名登录：用 Bearer token 代替第三方 Cookie', async () => {
  await withServer(async ({ request }) => {
    const origin = 'https://gongye.example.com';
    const login = await request('/api/action', {
      method: 'POST',
      headers: { origin },
      body: JSON.stringify({ name: 'verifyCode', payload: { email: 'alice@team.test', code: DEMO_CODE } })
    });
    const token = login.body.result.data.token;
    assert.ok(token, '登录接口返回 token');

    const created = await request('/api/action', {
      method: 'POST',
      headers: { origin, authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'createPost',
        payload: { board: 'method', body: '跨域名部署时用 token 发的一条帖子，验证鉴权可用。' }
      })
    });
    assert.equal(created.body.result.ok, true, created.body.result.message);

    const state = await request('/api/state', {
      headers: { origin, authorization: `Bearer ${token}` }
    });
    assert.ok(state.body.state.session.userId, 'token 能让 /api/state 认出身份');
  });
});

test('来源不在允许列表时被拒绝', async () => {
  await withServer(async ({ request }) => {
    const bad = await request('/api/action', {
      method: 'POST',
      headers: { origin: 'https://evil.test' },
      body: JSON.stringify({ name: 'requestCode', payload: { email: 'alice@team.test' } })
    });
    assert.equal(bad.response.status, 403);
    assert.equal(bad.body.error.code, 'origin');

    const good = await request('/api/action', {
      method: 'POST',
      headers: { origin: 'https://gongye.example.com' },
      body: JSON.stringify({ name: 'requestCode', payload: { email: 'alice@team.test' } })
    });
    assert.equal(good.response.status, 200);
  }, { allowedOrigins: ['https://gongye.example.com'] });
});
