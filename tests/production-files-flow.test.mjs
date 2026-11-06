/* Cross-module acceptance: real production HTTP/auth/store/files/PDF render;
 * mail and malware verdict are injected doubles, not external SMTP/clamd proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { createProductionServer } from '../server/production.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
test('email OTP -> private PDF -> contribution -> preview/download -> moderation invalidation', async () => {
  const dir = await fs.mkdtemp(path.join(root, '.tmp-http-files-'));
  const sent = [];
  const service = await createProductionServer({ dataFile: path.join(dir, 'state.sqlite'),
    sendMail: async (mail) => sent.push(mail), scanPdf: async () => true,
    adminEmails: ['admin@zju.edu.cn'] });
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
  try {
    const alice = await login('contributor@zju.edu.cn');
    const admin = await login('admin@zju.edu.cn');
    // Generate a valid PDF rather than relying on historical demo files' fake xref.
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>'];
    let pdf = '%PDF-1.7\n';
    const offsets = [];
    objects.forEach((value, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${value}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 4\n0000000000 65535 f \n${offsets.map((v) => `${String(v).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = Buffer.from(pdf);
    const upload = await fetch(`${base}/api/files`, { method: 'POST', body: bytes,
      headers: { origin: base, 'x-requested-with': 'gongye', cookie: alice,
        'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('本人笔记.pdf') } });
    const uploaded = await upload.json();
    assert.equal(upload.status, 201, JSON.stringify(uploaded));
    const id = uploaded.attachment.uploadId;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal((await fetch(`${base}/api/files/${id}/download`, { headers: { cookie: alice } })).status, 404);
    assert.equal((await fetch(`${base}/api/files/${id}/preview/1`)).status, 404);
    assert.equal((await fetch(`${base}/api/files/${id}/preview/1`, { headers: { cookie: alice } })).status, 200);
    const course = service.db.courses.find((v) => v.id !== 'c_general');
    const bad = await action('createPost', { board: 'notes', courseId: course.id, body: '伪造客户端附件不能发布',
      attachments: [{ path: '/etc/passwd', status: 'ready', pages: 1 }], resource: {} }, alice);
    assert.equal(bad.body.result?.ok ?? false, false);
    const created = await action('createPost', { board: 'notes', courseId: course.id,
      title: '本人整理的课程复习笔记', body: '本人整理，适用于复习与查漏；不是考场答案。',
      term: '2026秋冬', chapter: '第一章', confirmedOriginal: true, attachments: [{ uploadId: id }],
      resource: { title: '本人整理的课程复习笔记', courseId: course.id, type: '笔记', school: '浙江大学',
        term: '2026秋冬', chapter: '第一章', coverage: '覆盖第一章基础概念与例题，部分章节待补充。',
        source: '本人原创课程笔记，测试示例不向外部发布。', rights: '原创', confirmedIndex: true } }, alice);
    assert.equal(created.body.result.ok, true, JSON.stringify(created.body.result));
    const postId = created.body.result.data.postId;
    const resource = service.db.resources.find((v) => v.postId === postId);
    assert.ok(resource);
    assert.equal(service.db.attachments.find((v) => v.postId === postId).uploadId, id);
    const preview = await fetch(`${base}/api/files/${id}/preview/1`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${base}/api/files/${id}/download`)).status, 401);
    const download = await fetch(`${base}/api/files/${id}/download`, { headers: { cookie: alice } });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    const guestState = await (await fetch(`${base}/api/state`)).json();
    assert.equal(JSON.stringify(guestState).includes(dir.replaceAll('\\', '\\\\')), false);
    assert.equal(guestState.state.resources.find((v) => v.id === resource.id).source, '本人原创课程笔记，测试示例不向外部发布。');
    const hidden = await action('setPostStatus', { postId, status: 'hidden', reason: '验收下架即时失效' }, admin);
    assert.equal(hidden.body.result.ok, true, JSON.stringify(hidden.body));
    assert.equal((await fetch(`${base}/api/files/${id}/preview/1`)).status, 404);
    assert.equal((await fetch(`${base}/api/files/${id}/download`, { headers: { cookie: alice } })).status, 404);
  } finally { await service.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
