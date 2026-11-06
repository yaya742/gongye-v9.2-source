/* 生产后端图片上传：上传 → 发帖绑定 → 公开读取 → 下架失效。
 * 病毒扫描为注入替身（不是真实 clamd 证明）。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { createProductionServer } from '../server/production.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test('image upload: owner-bound, public with published post, invalid after moderation', async () => {
  const dir = await fs.mkdtemp(path.join(root, '.tmp-http-images-'));
  const sent = [];
  const service = await createProductionServer({ dataFile: path.join(dir, 'state.sqlite'),
    sendMail: async (mail) => sent.push(mail), scanPdf: async () => true, adminEmails: ['admin@zju.edu.cn'] });
  const address = await service.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  const action = async (name, payload, cookie = '') => {
    const response = await fetch(`${base}/api/action`, { method: 'POST',
      headers: { origin: base, 'x-requested-with': 'gongye', 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name, payload }) });
    return { response, body: await response.json() };
  };
  const login = async (email) => {
    assert.equal((await action('requestCode', { email })).body.result.ok, true);
    const reply = await action('verifyCode', { email, code: sent.findLast((v) => v.email === email).code, agree: true });
    assert.equal(reply.body.result.ok, true);
    return reply.response.headers.get('set-cookie').split(';')[0];
  };
  const uploadImage = async (cookie, bytes, type = 'image/png', name = '笔记配图.png') => {
    const response = await fetch(`${base}/api/files`, { method: 'POST', body: bytes,
      headers: { origin: base, 'x-requested-with': 'gongye', cookie,
        'content-type': type, 'x-file-name': encodeURIComponent(name) } });
    return { response, body: await response.json() };
  };
  try {
    const alice = await login('contributor@zju.edu.cn');
    const bob = await login('other@zju.edu.cn');
    const admin = await login('admin@zju.edu.cn');
    const course = service.db.courses.find((v) => v.id !== 'c_general');

    const upload = await uploadImage(alice, PNG);
    assert.equal(upload.response.status, 201, JSON.stringify(upload.body));
    const id = upload.body.attachment.uploadId;
    assert.equal(upload.body.attachment.kind, 'image');
    // 未绑定帖子：游客读不到，本人可读
    assert.equal((await fetch(`${base}/api/files/${id}/image`)).status, 404);
    assert.equal((await fetch(`${base}/api/files/${id}/image`, { headers: { cookie: alice } })).status, 404);

    // 声明与内容不符要拒绝
    const fake = await uploadImage(alice, Buffer.from('not an image'), 'image/png', '假图.png');
    assert.equal(fake.response.status, 415);

    // 别人的图片不能绑定
    const stolen = await action('createPost', { board: 'notes', courseId: course.id,
      body: '借用他人图片的正文', confirmedOriginal: true, images: [id] }, bob);
    assert.equal(stolen.response.status, 400, JSON.stringify(stolen.body));

    const created = await action('createPost', { board: 'notes', courseId: course.id,
      body: '带一张图片的学习记录，正文足够长以通过校验。', confirmedOriginal: true, images: [id] }, alice);
    assert.equal(created.body.result?.ok, true, JSON.stringify(created.body));
    const postId = created.body.result.data.postId;
    assert.equal(service.db.uploads.find((v) => v.id === id).postId, postId);

    const view = await fetch(`${base}/api/files/${id}/image`);
    assert.equal(view.status, 200);
    assert.equal(view.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await view.arrayBuffer()), PNG);

    // 游客 /api/state 能拿到图片地址
    const guest = await (await fetch(`${base}/api/state`)).json();
    assert.deepEqual(guest.state.posts.find((p) => p.id === postId).images, [`/api/files/${id}/image`]);

    // 下架后立即失效
    await action('setPostStatus', { postId, status: 'hidden', reason: '验收下架' }, admin);
    assert.equal((await fetch(`${base}/api/files/${id}/image`)).status, 404);
    assert.equal((await fetch(`${base}/api/files/${id}/image`, { headers: { cookie: alice } })).status, 404);
  } finally { await service.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
