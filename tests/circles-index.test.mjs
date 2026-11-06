/* 首屏瘦身：/api/state 不再下发空圈；全量圈索引单独提供并支持 ETag 304。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { createProductionServer } from '../server/production.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

test('first paint omits empty circles; circle index is complete and cacheable', async () => {
  const dir = await fs.mkdtemp(path.join(root, '.tmp-circles-index-'));
  const service = await createProductionServer({
    dataFile: path.join(dir, 'state.sqlite'),
    sendMail: async () => {},
    scanPdf: async () => true,
    adminEmails: ['admin@zju.edu.cn']
  });
  const { port } = await service.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  try {
    const state = await (await fetch(`${base}/api/state`)).json();
    // 全新生产库没有帖子，首屏不应带任何空圈
    assert.equal(state.state.circles.length, 0);
    assert.ok(state.state.courses.length > 2000, '课程目录仍全量下发');
    // 课程字段瘦身：不再下发 code/category
    assert.equal(state.state.courses[0].code, undefined);
    assert.equal(state.state.courses[0].category, undefined);
    assert.ok(state.state.courses[0].name);

    const first = await fetch(`${base}/api/circles/index`);
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.version, 1);
    const expected = state.state.courses.filter((c) => c.id !== 'c_general').length;
    assert.equal(body.items.length, expected, '索引覆盖全部课程圈');
    assert.ok(Array.isArray(body.items[0]) && body.items[0].length === 3);
    assert.equal(first.headers.get('content-type'), 'application/json; charset=utf-8');

    const etag = first.headers.get('etag');
    assert.ok(etag);
    const cached = await fetch(`${base}/api/circles/index`, { headers: { 'if-none-match': etag } });
    assert.equal(cached.status, 304);
    assert.equal((await cached.text()), '');
  } finally {
    await service.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
