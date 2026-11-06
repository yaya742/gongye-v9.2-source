import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, readdir, rm, writeFile, symlink, unlink } from 'node:fs/promises';
import { createFileService } from '../server/files.mjs';
import { validatePdfBytes } from '../server/file-processing.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+1sAAAAASUVORK5CYII=', 'base64');

function pdfBytes(catalogExtra = '') {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${catalogExtra} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream'
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(HERE, '.files-test-'));
  const rootDir = path.join(directory, 'private');
  const owner = { id: 'owner', status: 'active', verified: true, email: 'owner@st.zju.edu.cn' };
  const other = { id: 'other', status: 'active', verified: true, email: 'other@zju.edu.cn' };
  const unverified = { id: 'unverified', status: 'active', verified: false, email: 'new@zju.edu.cn' };
  const banned = { id: 'banned', status: 'suspended', verified: true, email: 'banned@zju.edu.cn' };
  const outsider = { id: 'outsider', status: 'active', verified: true, email: 'fake@evil.zju.edu.cn' };
  const db = { users: [owner, other, unverified, banned, outsider], uploads: [], posts: [],
    attachments: [], resources: [], circles: [] };
  const snapshots = [];
  const service = createFileService({ rootDir, db,
    save: async () => { snapshots.push(JSON.parse(JSON.stringify(db.uploads))); },
    scanPdf: async () => ({ clean: true }),
    renderPreview: async () => ({ totalPages: 1, pages: [{ page: 1, png: PNG }] }), ...options });
  let queue = Promise.resolve();
  const server = http.createServer((req, res) => {
    const task = async () => {
      try {
        const user = db.users.find((entry) => entry.id === req.headers['x-test-user']);
        const handled = await service.handle(req, res, { pathname: new URL(req.url, 'http://localhost').pathname, user });
        if (!handled) { res.writeHead(404); res.end(); }
      } catch { res.writeHead(500); res.end(); }
    };
    queue = queue.then(task, task);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await queue;
    await rm(directory, { recursive: true, force: true });
  });
  function request(url = '/api/files', { user = owner.id, method = 'POST', body = pdfBytes(),
    name = '学习笔记.pdf', headers = {} } = {}) {
    const requestHeaders = { ...(user ? { 'x-test-user': user } : {}), ...headers };
    if (method === 'POST') {
      requestHeaders['Content-Type'] ||= 'application/pdf';
      requestHeaders['X-File-Name'] ||= encodeURIComponent(name);
    }
    return fetch(origin + url, { method, headers: requestHeaders,
      ...(method === 'POST' ? { body, ...(body?.[Symbol.asyncIterator] ? { duplex: 'half' } : {}) } : {}) });
  }
  async function ready() {
    const response = await request();
    assert.equal(response.status, 201);
    return (await response.json()).attachment;
  }
  function bind(uploadId, { resource = true, circle = null } = {}) {
    const inputs = service.prepareAttachments(owner, [{ uploadId }]);
    const post = { id: `post-${db.posts.length}`, authorId: owner.id, status: 'published', circleId: circle };
    db.posts.push(post);
    const attachment = { id: `attachment-${db.attachments.length}`, postId: post.id,
      kind: 'pdf', name: inputs[0].name, sizeBytes: inputs[0].sizeBytes, pages: inputs[0].pages,
      path: inputs[0].path, status: inputs[0].status, demo: true, demoPath: 'assets/samples/never.pdf' };
    db.attachments.push(attachment);
    if (resource) db.resources.push({ id: `resource-${db.resources.length}`, postId: post.id,
      status: 'indexed', indexEnabled: true });
    service.finalizePost(post, inputs);
    return { post, attachment, resource: db.resources.find((entry) => entry.postId === post.id), inputs };
  }
  return { db, rootDir, directory, service, owner, other, unverified, banned, outsider,
    snapshots, request, ready, bind };
}

test('uploads persist exact real bytes and return only opaque API routes', async (t) => {
  const f = await fixture(t);
  const response = await f.request();
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.deepEqual(Object.keys(result.attachment).sort(), ['name', 'pages', 'sizeBytes', 'status', 'uploadId']);
  const upload = f.db.uploads[0];
  assert.equal(upload.status, 'ready');
  assert.equal(upload.scan, 'clean');
  assert.equal(upload.name, '学习笔记.pdf');
  assert.equal(upload.pages, 1);
  assert.match(upload.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(await readFile(path.join(f.rootDir, upload.objectKey)), pdfBytes());
  assert.equal(result.previews[0], `/api/files/${upload.id}/preview/1`);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(f.rootDir));
  assert.ok(!serialized.includes('objectKey'));
  assert.ok(!serialized.includes('demoPath'));
  assert.deepEqual(f.snapshots.map((rows) => rows[0].status), ['receiving', 'scanning', 'rendering', 'ready']);
});

test('rejects unauthenticated, unverified, suspended and non-allowlisted emails', async (t) => {
  const f = await fixture(t);
  for (const [user, status, code] of [[null, 401, 'login'], ['unverified', 403, 'unverified'],
    ['banned', 403, 'suspended'], ['outsider', 403, 'email_not_allowed']]) {
    const response = await f.request('/api/files', { user });
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
  }
  assert.equal(f.db.uploads.length, 0);
});

test('accepts only PDF names without paths and rejects non-PDF/malformed bytes', async (t) => {
  const f = await fixture(t);
  for (const name of ['../file.pdf', 'C:\\file.pdf', '/etc/file.pdf', 'evil.exe', 'file.pdf.exe', 'CON.pdf']) {
    const response = await f.request('/api/files', { name });
    assert.equal(response.status, 400, name);
    assert.equal((await response.json()).code, 'invalid_file_name');
  }
  let response = await f.request('/api/files', { body: Buffer.from('not a PDF') });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'invalid_pdf');
  response = await f.request('/api/files', { headers: { 'Content-Type': 'text/html' } });
  assert.equal(response.status, 415);
  const malformed = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
  response = await f.request('/api/files', { body: malformed });
  assert.equal(response.status, 422);
  assert.ok(f.db.uploads.every((upload) => upload.status === 'failed'));
});

test('checks content-length and streamed length against the hard limit', async (t) => {
  const f = await fixture(t, { maxBytes: 64 });
  let response = await f.request();
  assert.equal(response.status, 413);
  response = await f.request('/api/files', { body: (async function* () {
    yield Buffer.alloc(40); yield Buffer.alloc(40);
  })() });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, 'file_too_large');
  assert.ok(f.db.uploads.every((upload) => upload.status === 'failed'));
});

test('rejects encrypted and dangerous PDF actions before scanning', async (t) => {
  let scans = 0;
  const f = await fixture(t, { scanPdf: async () => { scans += 1; return true; } });
  for (const [token, code] of [['/Encrypt 9 0 R', 'encrypted_pdf'], ['/JavaScript', 'unsafe_pdf'],
    ['/J#53', 'unsafe_pdf'], ['/OpenAction', 'unsafe_pdf']]) {
    const bytes = pdfBytes(token);
    const response = await f.request('/api/files', { body: bytes });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, code);
  }
  assert.equal(scans, 0);
});

test('scanner must explicitly return clean, failures never reach ready and remove private files', async (t) => {
  for (const scanPdf of [async () => false, async () => ({ ok: true }), async () => undefined,
    async () => { throw new Error('sensitive stderr D:/private/secret'); }]) {
    const f = await fixture(t, { scanPdf });
    const response = await f.request();
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.code, 'scan_failed');
    assert.ok(!JSON.stringify(result).includes('private'));
    assert.equal(f.db.uploads[0].status, 'failed');
    assert.ok(!f.snapshots.some((rows) => rows[0].status === 'ready'));
    assert.deepEqual(await readdir(f.rootDir), []);
  }
});

test('default scanner without CLAMAV_HOST fails closed', async (t) => {
  const old = process.env.CLAMAV_HOST;
  delete process.env.CLAMAV_HOST;
  t.after(() => { if (old === undefined) delete process.env.CLAMAV_HOST; else process.env.CLAMAV_HOST = old; });
  const f = await fixture(t, { scanPdf: undefined });
  const response = await f.request();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'scan_unavailable');
  assert.equal(f.db.uploads[0].status, 'failed');
  assert.deepEqual(await readdir(f.rootDir), []);
});

test('invalid renderer output is not ready and parser errors leak no paths', async (t) => {
  for (const renderPreview of [async () => ({ totalPages: 1, pages: [] }),
    async () => ({ totalPages: 999999, pages: [{ page: 1, png: PNG }] }),
    async () => { throw new Error('D:/private/native/secret'); }]) {
    const f = await fixture(t, { renderPreview });
    const response = await f.request();
    assert.ok([422, 503].includes(response.status));
    const result = await response.json();
    assert.ok(!JSON.stringify(result).includes('D:/'));
    assert.equal(f.db.uploads[0].status, 'failed');
    assert.deepEqual(await readdir(f.rootDir), []);
  }
});

test('prepareAttachments rejects ownership forgery, duplicates, metadata and over-limit lists', async (t) => {
  const f = await fixture(t);
  const attachment = await f.ready();
  const id = attachment.uploadId;
  assert.throws(() => f.service.prepareAttachments(f.other, [{ uploadId: id }]), { code: 'invalid_attachment' });
  for (const inputs of [[{ uploadId: id }, { uploadId: id }], [{ uploadId: id, path: '../../secret' }],
    [{ uploadId: id, pages: 999 }], [{ uploadId: id, status: 'ready' }], [{ uploadId: id, name: 'fake.pdf' }],
    [{ path: '/server/private.pdf' }], [{ uploadId: '../../private' }]]) {
    assert.throws(() => f.service.prepareAttachments(f.owner, inputs), { code: 'invalid_attachment' });
  }
  assert.throws(() => f.service.prepareAttachments(f.owner, Array(4).fill({ uploadId: id })),
    { code: 'too_many_attachments' });
  f.db.uploads[0].status = 'scanning';
  assert.throws(() => f.service.prepareAttachments(f.owner, [{ uploadId: id }]), { code: 'invalid_attachment' });
});

test('finalizePost replaces demo attributes, binds exactly once and keeps trusted previews', async (t) => {
  const f = await fixture(t);
  const attachment = await f.ready();
  const bound = f.bind(attachment.uploadId);
  assert.equal(bound.attachment.demo, false);
  assert.equal(bound.attachment.uploadId, attachment.uploadId);
  assert.equal(bound.attachment.pages, 1);
  assert.equal(bound.attachment.name, '学习笔记.pdf');
  assert.equal(bound.attachment.path, `/api/files/${attachment.uploadId}/download`);
  assert.ok(!Object.hasOwn(bound.attachment, 'demoPath'));
  assert.deepEqual(bound.resource.previews, [`/api/files/${attachment.uploadId}/preview/1`]);
  assert.equal(f.db.uploads[0].postId, bound.post.id);
  assert.throws(() => f.service.prepareAttachments(f.owner, [{ uploadId: attachment.uploadId }]), { code: 'upload_consumed' });
  assert.throws(() => f.service.finalizePost(bound.post, bound.inputs), { code: 'invalid_attachment' });
  assert.throws(() => f.service.finalizePost(bound.post, [{ uploadId: attachment.uploadId }]), { code: 'invalid_attachment' });
});

test('stale prepared batches cannot consume a file twice', async (t) => {
  const f = await fixture(t);
  const attachment = await f.ready();
  const stale = f.service.prepareAttachments(f.owner, [{ uploadId: attachment.uploadId }]);
  f.bind(attachment.uploadId);
  const post = { id: 'second', authorId: f.owner.id, status: 'published' };
  f.db.posts.push(post);
  f.db.attachments.push({ id: 'second-attachment', postId: post.id, ...stale[0] });
  assert.throws(() => f.service.finalizePost(post, stale), { code: 'upload_consumed' });
});

test('unpublished preview is owner-only and no unpublished download is allowed', async (t) => {
  const f = await fixture(t);
  const attachment = await f.ready();
  const base = `/api/files/${attachment.uploadId}`;
  let response = await f.request(`${base}/preview/1`, { method: 'GET' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
  response = await f.request(`${base}/preview/1`, { method: 'GET', user: 'other' });
  assert.equal(response.status, 404);
  response = await f.request(`${base}/preview/1`, { method: 'GET', user: null });
  // Anonymous requests get the same 404 as a missing upload id: no oracle that
  // would reveal whether an unpublished upload exists.
  assert.equal(response.status, 404);
  response = await f.request(`${base}/download`, { method: 'GET' });
  assert.equal(response.status, 404);
});

test('published preview is public, download requires a verified active exact-domain account', async (t) => {
  const f = await fixture(t);
  const upload = await f.ready();
  const bound = f.bind(upload.uploadId);
  const base = `/api/files/${upload.uploadId}`;
  let response = await f.request(`${base}/preview/1`, { method: 'GET', user: null });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  for (const [user, status] of [[null, 401], ['unverified', 403], ['banned', 403], ['outsider', 403], ['other', 200]]) {
    response = await f.request(`${base}/download`, { method: 'GET', user });
    assert.equal(response.status, status);
  }
  response = await f.request(`${base}/download`, { method: 'GET' });
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdfBytes());
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'), /^attachment;/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const result = f.service.downloadResource(f.other, { postId: bound.post.id, attachmentId: bound.attachment.id });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { path: `${base}/download`, name: '学习笔记.pdf' });
  assert.ok(!JSON.stringify(result).includes(f.rootDir));
  assert.equal(f.service.downloadResource(null, { postId: bound.post.id, attachmentId: bound.attachment.id }).code, 'login');
});

test('old links immediately fail on post moderation, author suspension or resource blocking', async (t) => {
  const f = await fixture(t);
  const upload = await f.ready();
  const { post, attachment, resource } = f.bind(upload.uploadId);
  for (const [object, key, value] of [[post, 'status', 'hidden'], [post, 'status', 'removed'],
    [post, 'status', 'blocked'], [f.owner, 'status', 'suspended'], [attachment, 'status', 'removed'],
    [resource, 'status', 'blocked']]) {
    const previous = object[key];
    object[key] = value;
    let response = await f.request(`/api/files/${upload.uploadId}/preview/1`, { method: 'GET', user: null });
    assert.equal(response.status, 404, `${key}=${value}`);
    response = await f.request(`/api/files/${upload.uploadId}/download`, { method: 'GET', user: 'other' });
    assert.equal(response.status, 404);
    assert.equal(f.service.downloadResource(f.other, { postId: post.id, attachmentId: attachment.id }).ok, false);
    object[key] = previous;
  }
});

test('unindexed resource, archived public circle and non-resource attachments remain readable', async (t) => {
  const f = await fixture(t);
  f.db.circles.push({ id: 'circle', status: 'archived' });
  const first = await f.ready();
  const bound = f.bind(first.uploadId, { circle: 'circle' });
  bound.resource.status = 'unindexed';
  bound.resource.indexEnabled = false;
  let response = await f.request(`/api/files/${first.uploadId}/download`, { method: 'GET', user: 'other' });
  assert.equal(response.status, 200);
  response = await f.request(`/api/files/${first.uploadId}/preview/1`, { method: 'GET', user: null });
  assert.equal(response.status, 200);
  const second = await f.ready();
  f.bind(second.uploadId, { resource: false });
  response = await f.request(`/api/files/${second.uploadId}/download`, { method: 'GET', user: 'other' });
  assert.equal(response.status, 200);
});

test('tampered object keys, byte contents, traversal and non-existing previews are denied', async (t) => {
  const f = await fixture(t);
  const upload = await f.ready();
  f.bind(upload.uploadId);
  const record = f.db.uploads[0];
  const original = record.objectKey;
  record.objectKey = '../outside.pdf';
  let response = await f.request(`/api/files/${upload.uploadId}/download`, { method: 'GET' });
  assert.equal(response.status, 404);
  record.objectKey = original;
  await writeFile(path.join(f.rootDir, original), Buffer.from('modified'));
  response = await f.request(`/api/files/${upload.uploadId}/download`, { method: 'GET' });
  assert.equal(response.status, 404);
  for (const suffix of ['preview/2', 'preview/3', 'preview/1.png', '../../outside.pdf']) {
    response = await f.request(`/api/files/${upload.uploadId}/${suffix}`, { method: 'GET' });
    assert.equal(response.status, 404);
  }
});

test('symlinked file cannot escape the private root', async (t) => {
  const f = await fixture(t);
  const upload = await f.ready();
  f.bind(upload.uploadId);
  const record = f.db.uploads[0];
  const outside = path.join(f.directory, 'outside.pdf');
  await writeFile(outside, pdfBytes());
  await unlink(path.join(f.rootDir, record.objectKey));
  try { await symlink(outside, path.join(f.rootDir, record.objectKey), 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Platform forbids test symlinks'); return; }
    throw error;
  }
  const response = await f.request(`/api/files/${upload.uploadId}/download`, { method: 'GET' });
  assert.equal(response.status, 404);
});

test('default storage configuration is required and domains fail closed', async () => {
  assert.throws(() => createFileService({ db: {}, save() {} }), TypeError);
  assert.throws(() => createFileService({ rootDir: '.', db: {}, save() {}, maxBytes: 21 * 1024 * 1024 }), TypeError);
  assert.doesNotThrow(() => validatePdfBytes(pdfBytes()));
  assert.throws(() => validatePdfBytes(Buffer.from('not pdf')), { code: 'invalid_pdf' });
});
