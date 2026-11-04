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
    assert.equal(guest.response.status, 401);
    assert.equal(guest.body.error.code, 'login');

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
    // 未登录请求在到达动作前就被拦下；不签发会话即满足“不能切换演示账号”
    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'login');
    assert.equal(response.headers.get('set-cookie'), null);
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
  }, { allowedOrigins: ['https://gongye.example.com'] });
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
  }, { allowedOrigins: ['https://gongye.example.com'] });
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

/* ---------- 文件上传 ---------- */

const PDF = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 280]>>endobj
4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 280]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');

async function signIn({ request, cookieFrom }, email = 'alice@team.test') {
  const login = await request('/api/action', {
    method: 'POST',
    body: JSON.stringify({ name: 'verifyCode', payload: { email, code: DEMO_CODE } })
  });
  return cookieFrom(login.response);
}

async function upload(base, cookie, kind, bytes, name = '笔记.pdf') {
  const response = await fetch(`${base}/api/files?kind=${kind}`, {
    method: 'POST',
    headers: {
      ...(cookie ? { cookie } : {}),
      'x-requested-with': 'gongye',
      'x-file-name': encodeURIComponent(name),
      'content-type': kind === 'pdf' ? 'application/pdf' : 'image/png'
    },
    body: bytes
  });
  return { response, body: await response.json() };
}

const action = (request, cookie, name, payload) => request('/api/action', {
  method: 'POST',
  headers: cookie ? { cookie } : {},
  body: JSON.stringify({ name, payload })
});

const RESOURCE = {
  title: '真实上传的极限笔记', courseId: 'c_calc', school: '示例大学', term: '2026秋', type: '笔记',
  coverage: '数列极限与夹逼', limitations: '', confirmedIndex: true
};

test('上传：未登录被拒绝，内容不对被拒绝，超限被拒绝', async () => {
  await withServer(async (env) => {
    const { base } = env;
    assert.equal((await upload(base, '', 'pdf', PDF)).response.status, 401);
    const cookie = await signIn(env);

    const fake = await upload(base, cookie, 'pdf', Buffer.from('<html><script>alert(1)</script></html>'), '伪装.pdf');
    assert.equal(fake.response.status, 415);
    assert.equal(fake.body.error.code, 'not_pdf');

    const scripted = await upload(base, cookie, 'pdf', Buffer.from('%PDF-1.4\n<</S/JavaScript/JS(app.alert(1))>>\n%%EOF'));
    assert.equal(scripted.body.error.code, 'active_pdf');

    const svg = await upload(base, cookie, 'image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.svg');
    assert.equal(svg.body.error.code, 'not_image');

    const big = await upload(base, cookie, 'pdf', Buffer.concat([PDF, Buffer.alloc(4096)]));
    assert.equal(big.response.status, 413);

    const noHeader = await fetch(`${base}/api/files?kind=pdf`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/pdf' }, body: PDF
    });
    assert.equal(noHeader.status, 403, '没有自定义请求头的跨站表单提交被拦下');
  }, { limits: { pdfBytes: 2048 } });
});

test('上传 PDF：发布后进入资料，登录才能下载，状态不暴露存储信息', async () => {
  await withServer(async (env) => {
    const { base, request, pilot } = env;
    const cookie = await signIn(env);
    const uploaded = await upload(base, cookie, 'pdf', PDF, '../../极限 笔记.pdf');
    assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.body));
    assert.equal(uploaded.body.file.pages, 2);
    assert.ok(!uploaded.body.file.name.includes('/'), '文件名里的路径被清掉');

    const created = await action(request, cookie, 'createPost', {
      board: 'notes', title: '真实资料', body: '这是一份真实上传的资料，用来验证闭环。',
      attachments: [{ uploadId: uploaded.body.file.id, name: '客户端伪造.exe', sizeBytes: 1, pages: 999 }],
      confirmedOriginal: true, resource: RESOURCE
    });
    assert.equal(created.body.result.ok, true, created.body.result.message);
    const postId = created.body.result.data.postId;

    const state = (await request('/api/state')).body.state;
    const attachment = state.attachments.find((row) => row.postId === postId);
    assert.equal(attachment.path, 'available', '不返回存储路径');
    assert.equal(attachment.name, uploaded.body.file.name, '名称以服务端为准');
    assert.equal(attachment.sizeBytes, PDF.length);
    assert.equal(attachment.demo, false);
    assert.equal(state.uploads, undefined, '上传记录不进公开状态');
    assert.ok(state.resources.some((row) => row.postId === postId), '资料进入索引');

    const link = `/api/files/${uploaded.body.file.id}`;
    assert.equal((await fetch(`${base}${link}`)).status, 401, '游客不能下载');

    const granted = await action(request, cookie, 'downloadResource', { postId, attachmentId: attachment.id });
    assert.equal(granted.body.result.data.path, link);
    const file = await fetch(`${base}${link}`, { headers: { cookie } });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'application/pdf');
    assert.match(file.headers.get('content-disposition'), /^attachment/);
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(Buffer.from(await file.arrayBuffer()).equals(PDF), '下载内容与上传一致');

    const removed = await action(request, cookie, 'removePost', { postId });
    assert.equal(removed.body.result.ok, true);
    assert.equal((await fetch(`${base}${link}`, { headers: { cookie } })).status, 404, '删帖后链接立即失效');
    assert.equal(pilot.db.uploads.length, 0, '文件记录一起清掉');
  });
});

test('PDF 预览：资料公开后游客可看前两页，发布前只有作者能看', async (t) => {
  const { spawnSync } = await import('node:child_process');
  if (spawnSync('pdftoppm', ['-v']).error) {
    t.skip('本机没有 pdftoppm');
    return;
  }
  await withServer(async (env) => {
    const { base, request } = env;
    const cookie = await signIn(env);
    const uploaded = await upload(base, cookie, 'pdf', PDF);
    assert.equal(uploaded.body.file.previewCount, 2);
    const preview = `/api/files/${uploaded.body.file.id}/preview/1`;
    assert.equal((await fetch(`${base}${preview}`)).status, 404, '未发布时游客看不到');
    assert.equal((await fetch(`${base}${preview}`, { headers: { cookie } })).status, 200, '作者可以看');

    const created = await action(request, cookie, 'createPost', {
      board: 'notes', body: '带预览的资料，用来验证前两页公开规则。',
      attachments: [{ uploadId: uploaded.body.file.id }], confirmedOriginal: true, resource: RESOURCE
    });
    assert.equal(created.body.result.ok, true, created.body.result.message);
    const resource = created.body.state.resources.find((row) => row.postId === created.body.result.data.postId);
    assert.equal(resource.previews.length, 2);
    const guest = await fetch(`${base}${preview}`);
    assert.equal(guest.status, 200, '公开后游客能看预览');
    assert.equal(guest.headers.get('content-type'), 'image/jpeg');
  });
});

test('图片：发布后公开，只能用自己未使用的文件，客户端地址不被接受', async () => {
  await withServer(async (env) => {
    const { base, request } = env;
    const alice = await signIn(env);
    const bob = await signIn(env, 'anyone@corp.test');
    const image = await upload(base, alice, 'image', PNG, 'a.png');
    assert.equal(image.response.status, 201, JSON.stringify(image.body));
    const link = `/api/files/${image.body.file.id}`;
    assert.equal((await fetch(`${base}${link}`)).status, 404, '发布前游客看不到');

    const stolen = await action(request, bob, 'createPost', {
      board: 'notes', body: '尝试用别人上传的图片发帖。', images: [`upload:${image.body.file.id}`], confirmedOriginal: true
    });
    assert.equal(stolen.response.status, 400);

    const external = await action(request, alice, 'createPost', {
      board: 'notes', body: '尝试塞一个外部图片地址。', images: ['https://evil.test/track.png'], confirmedOriginal: true
    });
    assert.equal(external.response.status, 400);

    const created = await action(request, alice, 'createPost', {
      board: 'notes', body: '带一张真实图片的帖子。', images: [`upload:${image.body.file.id}`], confirmedOriginal: true
    });
    assert.equal(created.body.result.ok, true, created.body.result.message);
    const post = created.body.state.posts.find((row) => row.id === created.body.result.data.postId);
    assert.deepEqual(post.images, [link]);
    const guest = await fetch(`${base}${link}`);
    assert.equal(guest.status, 200);
    assert.equal(guest.headers.get('content-type'), 'image/png');

    const reused = await action(request, alice, 'createPost', {
      board: 'notes', body: '同一个文件不能重复挂到第二篇帖子。', images: [`upload:${image.body.file.id}`], confirmedOriginal: true
    });
    assert.equal(reused.response.status, 400);
  });
});

test('压缩、全量备份与每账号限流', async () => {
  await withServer(async (env) => {
    const { base, request } = env;
    const gz = await fetch(`${base}/api/state`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    assert.ok((await gz.json()).state, '压缩后仍是合法 JSON');

    const admin = await signIn(env, 'boss@corp.test');
    const uploaded = await upload(base, admin, 'pdf', PDF);
    const tar = Buffer.from(await (await fetch(`${base}/api/admin/export?full=1`, { headers: { cookie: admin } })).arrayBuffer());
    assert.equal(tar.toString('utf8', 0, 7), 'db.json');
    assert.ok(tar.includes(`files/${uploaded.body.file.id}.pdf`), '备份里有上传文件');
    assert.ok(tar.includes(PDF), '备份里的文件内容完整');
    assert.equal(tar.length % 512, 0, 'tar 按块对齐');
    assert.equal((await fetch(`${base}/api/admin/export?full=1`)).status, 403, '非管理员不能导出');

    const alice = await signIn(env);
    assert.equal((await action(request, alice, 'markAllNotificationsRead', {})).response.status, 200);
  });
});

/* ---------- 病毒扫描、注销、导出、可见范围 ---------- */

/** 模拟 clamd：按 INSTREAM 协议收完数据，含 EICAR 测试串就报毒 */
async function fakeClamd() {
  const net = await import('node:net');
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const header = 'zINSTREAM\0';
      if (buffer.length < header.length) return;
      let offset = header.length;
      const parts = [];
      while (offset + 4 <= buffer.length) {
        const size = buffer.readUInt32BE(offset);
        if (size === 0) {
          const data = Buffer.concat(parts);
          socket.end(data.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
            ? 'stream: Win.Test.EICAR_HDB-1 FOUND\0' : 'stream: OK\0');
          return;
        }
        if (offset + 4 + size > buffer.length) return;
        parts.push(buffer.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('病毒扫描：干净文件放行，带毒文件拒绝，扫描服务不可用时拒绝上传', async () => {
  const { createScanner } = await import('../server/scanner.mjs');
  const clamd = await fakeClamd();
  try {
    await withServer(async (env) => {
      const cookie = await signIn(env);
      const clean = await upload(env.base, cookie, 'pdf', PDF);
      assert.equal(clean.response.status, 201, JSON.stringify(clean.body));
      const eicar = Buffer.from('%PDF-1.4\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n%%EOF');
      const infected = await upload(env.base, cookie, 'pdf', eicar);
      assert.equal(infected.response.status, 422);
      assert.equal(infected.body.error.code, 'infected');
      assert.equal(env.pilot.db.uploads.length, 1, '带毒文件没有入库');
      const health = await (await fetch(`${env.base}/api/health`)).json();
      assert.equal(health.scan, 'on');
    }, { scanner: createScanner({ host: '127.0.0.1', port: clamd.port }) });
  } finally {
    await clamd.close();
  }

  await withServer(async (env) => {
    const cookie = await signIn(env);
    const down = await upload(env.base, cookie, 'pdf', PDF);
    assert.equal(down.response.status, 503, '扫描服务连不上时不放行');
    assert.equal(down.body.error.code, 'scan_unavailable');
  }, { scanner: createScanner({ host: '127.0.0.1', port: 9, timeoutMs: 2000 }) });
});

test('注销：所有会话失效、未发布的文件删除，同一邮箱可重新注册为新账号', async () => {
  await withServer(async (env) => {
    const { base, request, cookieFrom, pilot } = env;
    const cookie = await signIn(env);
    const second = await signIn(env);
    const meId = (await request('/api/state', { headers: { cookie } })).body.state.session.userId;
    const draftFile = await upload(base, cookie, 'image', PNG);
    assert.equal(draftFile.response.status, 201);

    const deleted = await action(request, cookie, 'deleteAccount', { mode: 'anonymize', confirmText: '注销' });
    assert.equal(deleted.body.result.ok, true, deleted.body.result.message);
    assert.equal(deleted.body.state.session, null);
    assert.match(deleted.response.headers.get('set-cookie') || '', /gy_sid=;/, '清掉 Cookie');
    for (const sid of [cookie, second]) {
      assert.equal((await request('/api/state', { headers: { cookie: sid } })).body.state.session, null, '其他设备的会话也失效');
    }
    assert.equal(pilot.db.uploads.filter((row) => row.ownerId === meId).length, 0, '未发布的文件被删除');
    const record = pilot.db.users.find((row) => row.id === meId);
    assert.equal(record.email, '');
    assert.equal(record.status, 'deleted');

    const again = await request('/api/action', {
      method: 'POST', body: JSON.stringify({ name: 'verifyCode', payload: { email: 'alice@team.test', code: DEMO_CODE } })
    });
    assert.notEqual(again.body.state.session.userId, meId, '重新注册得到新账号');
    assert.ok(cookieFrom(again.response));
  });
});

test('导出我的数据：只给本人；拉黑记录只返回本人；成员名单只给管理员', async () => {
  await withServer(async (env) => {
    const { request } = env;
    assert.equal((await fetch(`${env.base}/api/me/export`)).status, 401);
    const alice = await signIn(env);
    const exported = await fetch(`${env.base}/api/me/export`, { headers: { cookie: alice } });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition'), /attachment/);
    const data = await exported.json();
    assert.equal(data.profile.email, 'alice@team.test');
    assert.ok(Array.isArray(data.uploads));

    const bob = await signIn(env, 'anyone@corp.test');
    const aliceId = (await request('/api/state', { headers: { cookie: alice } })).body.state.session.userId;
    const blocked = await action(request, bob, 'setBlock', { userId: aliceId, blocked: true });
    assert.equal(blocked.body.result.ok, true, blocked.body.result.message);
    assert.equal(blocked.body.state.blocks.length, 1, '本人能看到自己的拉黑');
    assert.equal((await request('/api/state', { headers: { cookie: alice } })).body.state.blocks.length, 0, '被拉黑的人看不到');
    const dm = await action(request, alice, 'sendDirectMessage', { recipientId: blocked.body.state.session.userId, body: '你好' });
    assert.equal(dm.body.result.code, 'blocked');

    const guestView = (await request('/api/state')).body.state.memberships;
    assert.ok(guestView.every((row) => row.userId === undefined), '游客看不到成员是谁');
    const admin = await signIn(env, 'boss@corp.test');
    const adminState = (await request('/api/state', { headers: { cookie: admin } })).body.state;
    assert.ok(adminState.memberships.some((row) => row.userId), '管理员能看到成员');
    assert.deepEqual(adminState.system, { scan: null }, '管理员能看到扫描是否开启');
  });
});
