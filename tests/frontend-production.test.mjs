/* Production contracts: Node render + mocked requests/events, NOT browser/E2E tests.
 * Run only this file: node --test tests/frontend-production.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

globalThis.window = { __GONGYE_CONFIG__: { mode: 'production', apiBase: 'https://untrusted.invalid' }, matchMedia: () => ({ matches: false }) };
globalThis.document = { getElementById: () => null };
globalThis.location = { hash: '#/', pathname: '/', origin: 'http://localhost' };
let storageTouches = 0;
globalThis.localStorage = {
  getItem() { storageTouches++; throw new Error('Production must not read tokens'); },
  setItem() { storageTouches++; throw new Error('Production must not persist tokens'); },
  removeItem() { storageTouches++; throw new Error('Production must not touch tokens'); }
};
const { createSeed } = await import('../src/data/seed.js');
const S = await import('../src/state/selectors.js');
const { login, profile } = await import('../src/pages/account.js');
const { resourcePublish, resourceDetail } = await import('../src/pages/resources.js');
const { compose } = await import('../src/pages/posts.js');
const { pdfUploadField, attachmentRow } = await import('../src/components/ui.js');
const { api, auth } = await import('../src/api/client.js');
const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function ctxFor(name = 'login', loggedIn = false, patch = {}) {
  const db = createSeed(Date.UTC(2026, 10, 2), { keepDemoPosts: true });
  if (loggedIn) db.session = { userId: 'u_qinghe' };
  return {
    db, me: loggedIn ? S.userOf(db, 'u_qinghe') : null,
    config: { mode: 'production', authMode: 'email-otp', authReady: true, emailDomains: ['zju.edu.cn', 'st.zju.edu.cn'], filePolicy: { maxBytes: 20971520 } },
    route: { name, path: '/test', params: {}, query: {} },
    ui: { files: [], images: [], compose: null }, once() {}, invoke() {}, ...patch
  };
}

// Extract named event helpers to test their real implementation without pretending to run a browser.
function mainFunction(name, dependencies = {}) {
  const start = mainSource.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `Missing main helper: ${name}`);
  const tail = mainSource.slice(start);
  const next = tail.search(/\n(?:async )?function [A-Za-z]/);
  const source = next < 0 ? tail : tail.slice(0, next);
  return vm.runInNewContext(`${source}\n${name}`, dependencies);
}

class FormFields {
  constructor(form) { this.values = form.values || {}; }
  get(name) { return this.values[name] ?? null; }
}
function form(values = {}) {
  return { values, dataset: { form: 'post' }, querySelector(selector) {
    const name = /name="([^"]+)"/.exec(selector)?.[1];
    if (!name) return null;
    return { value: values[name] || '', checked: values[name] === 'on' };
  } };
}

test('production login is non-official, domain-configured, real OTP, opt-in only', () => {
  const ctx = ctxFor();
  const html = login(ctx);
  assert.match(html, /非浙江大学官方网站/);
  assert.match(html, /@zju\.edu\.cn/);
  assert.match(html, /@st\.zju\.edu\.cn/);
  assert.doesNotMatch(html, /123456|quick-login|cloudSignIn|正式账号|云SDK/);
  assert.doesNotMatch(html, /name="agree"[^>]*checked/);
  ctx.config.emailDomains = ['custom.zju.edu.cn'];
  const custom = login(ctx);
  assert.match(custom, /@custom\.zju\.edu\.cn/);
  assert.doesNotMatch(custom, /@st\.zju\.edu\.cn/);
});

test('authReady=false explicitly disables code and verification; cooldown survives render', () => {
  const ctx = ctxFor();
  ctx.config.authReady = false;
  let html = login(ctx);
  assert.match(html, /SMTP/);
  assert.match(html, /data-action="send-code"[^>]*disabled/);
  assert.match(html, /type="submit"[^>]*disabled/);
  ctx.config.authReady = true;
  ctx.ui.codeRetryAt = Date.now() + 60000;
  html = login(ctx);
  assert.match(html, /data-action="send-code"[^>]*disabled/);
  assert.match(html, /秒后重发/);
});

test('production resource and post forms expose real PDF input and explicit source/rights', () => {
  for (const render of [resourcePublish, compose]) {
    const ctx = ctxFor('compose', true);
    const html = render(ctx);
    assert.match(html, /type="file" accept="application\/pdf" multiple data-upload="pdf"/);
    assert.match(html, /name="source"/);
    assert.match(html, /name="rights"/);
    for (const right of ['原创', '已授权', '公开许可']) assert.ok(html.includes(`value="${right}"`));
    assert.doesNotMatch(html, /data-file-picker|assets\/samples\//);
    assert.doesNotMatch(html, /name="original"[^>]*checked/);
    ctx.ui.uploading = true;
    assert.match(render(ctx), /type="submit"[^>]*disabled/);
  }
  const html = compose(ctxFor('compose', true));
  assert.match(html, /name="courseId"/);
  assert.match(html, /name="postTerm"/);
  assert.match(html, /name="chapter"/);
  assert.match(html, /data-upload="image"/);
});

test('upload unavailability and ready receipts are shown truthfully; demo stays separate', () => {
  const ctx = ctxFor('resourcePublish', true);
  ctx.config.filePolicy.uploadReady = false;
  let html = pdfUploadField(ctx);
  assert.match(html, /扫描服务尚未配置/);
  assert.match(html, /data-upload="pdf"[^>]*disabled/);
  ctx.ui.files = [{ uploadId: 'upload_1', name: '真实笔记.pdf', sizeBytes: 1024, pages: 4, status: 'ready' }];
  html = pdfUploadField(ctx);
  assert.match(html, /真实笔记.pdf/);
  assert.match(html, /4 页/);
  assert.match(html, /1\.0 KiB/);
  assert.doesNotMatch(html, /演示文件/);
  assert.match(attachmentRow(ctx, { ...ctx.ui.files[0], id: 'att_1', postId: 'p_unknown' }), /data-action="download"/);
  ctx.config.mode = 'demo-static';
  assert.match(pdfUploadField(ctx, { samples: [{ label: '示例 PDF' }] }), /data-file-picker/);
});

test('production preview accepts controlled server paths only and never falls back to sample art', () => {
  const ctx = ctxFor('resource', true);
  const resource = ctx.db.resources.find((r) => S.resourceEligibility(ctx.db, r).ok);
  assert.ok(resource);
  ctx.route.params.id = resource.id;
  resource.previews = ['assets/art/note-sample-1.svg', 'https://evil.invalid/image.png', 'data:image/png;base64,AA'];
  let html = resourceDetail(ctx);
  assert.match(html, /预览仍在处理中或暂不可用/);
  assert.doesNotMatch(html, /note-sample-1|evil\.invalid|data:image/);
  resource.previews = ['/api/files/upload_1/preview/1'];
  html = resourceDetail(ctx);
  assert.match(html, /src="\/api\/files\/upload_1\/preview\/1"/);
});

test('production public profiles do not expose other students course memberships', () => {
  const ctx = ctxFor('profile', true);
  ctx.route.params.id = 'u_zhixia';
  assert.doesNotMatch(profile(ctx), /加入的课友圈|我的课友圈（仅自己可见）|我的收藏/);
  ctx.route.params.id = 'me';
  assert.match(profile(ctx), /我的课友圈（仅自己可见）/);
});

test('production API ignores cross-origin apiBase, never touches token storage, sends same-origin JSON', async () => {
  const calls = [];
  globalThis.fetch = async (path, options) => { calls.push({ path, options }); return { ok: true, json: async () => ({ state: {}, result: { ok: true } }) }; };
  auth.set('should-not-persist');
  auth.clear();
  assert.equal(auth.get(), '');
  await api.getState();
  await api.action('verifyCode', { email: 'student@st.zju.edu.cn', code: 'secret', agree: true });
  assert.equal(storageTouches, 0);
  assert.equal(calls[0].path, '/api/state');
  assert.equal(calls[1].path, '/api/action');
  for (const { options } of calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers['x-requested-with'], 'gongye');
    assert.equal(options.headers['content-type'], 'application/json');
    assert.equal(options.headers.authorization, undefined);
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: 'verifyCode', payload: { email: 'student@st.zju.edu.cn', code: 'secret', agree: true } });
});

test('uploadFile posts the raw File with encoded name and rejects unavailable/non-ready receipts', async () => {
  const file = new File(['%PDF-1.7'], '笔记 空格.pdf', { type: 'application/pdf' });
  let request;
  globalThis.fetch = async (path, options) => {
    request = { path, options };
    return { ok: true, json: async () => ({ attachment: { uploadId: 'up_1', name: file.name, sizeBytes: file.size, pages: 1, status: 'ready' } }) };
  };
  assert.equal((await api.uploadFile(file)).attachment.uploadId, 'up_1');
  assert.equal(request.path, '/api/files');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.body, file);
  assert.equal(request.options.headers['content-type'], 'application/pdf');
  assert.equal(request.options.headers['X-File-Name'], encodeURIComponent(file.name));
  assert.equal(request.options.headers['x-requested-with'], 'gongye');
  assert.equal(request.options.credentials, 'same-origin');
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: '扫描不可用', code: 'scanner_unavailable', message: '请配置扫描服务' }) });
  await assert.rejects(api.uploadFile(file), (error) => error.status === 503 && error.code === 'scanner_unavailable' && error.message === '请配置扫描服务');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ attachment: { uploadId: 'up_2', status: 'processing' } }) });
  await assert.rejects(api.uploadFile(file), /尚未通过服务器检查/);
});
test('publication serialization sends only uploadId in production and retains demo shape only in demo', () => {
  const ui = { files: [{ uploadId: 'up_1', name: 'note.pdf', path: 'forged', status: 'ready', sizeBytes: 5, pages: 1 }] };
  let serialize = mainFunction('publicationAttachments', { ui, isRemote: true });
  assert.equal(JSON.stringify(serialize()), '[{"uploadId":"up_1"}]');
  serialize = mainFunction('publicationAttachments', { ui, isRemote: false });
  assert.equal(serialize()[0].path, 'forged');
});

test('PDF event rejects unchecked source, oversized files and more than three before upload', async () => {
  const ui = { files: [], uploading: false, publishing: false };
  const messages = [];
  let requests = 0;
  const upload = mainFunction('uploadPdfFiles', {
    isRemote: true, ui, ctx: { me: { id: 'me' } }, config: {}, refreshPreserving() {}, requireLogin() {},
    api: { uploadFile() { requests++; } }, toast(message) { messages.push(message); }
  });
  await upload([{ name: 'a.pdf', size: 10, type: 'application/pdf' }], form());
  assert.match(messages.pop(), /主动勾选/);
  await upload([{ name: 'a.pdf', size: 20971521, type: 'application/pdf' }], form({ original: 'on' }));
  assert.match(messages.pop(), /20 MiB/);
  await upload(Array.from({ length: 4 }, () => ({ name: 'a.pdf', size: 10, type: 'application/pdf' })), form({ original: 'on' }));
  assert.match(messages.pop(), /最多 3/);
  assert.equal(requests, 0);
});

test('failed real upload never enters attachments and leaves draft and busy state intact', async () => {
  const ui = { files: [], uploading: false, publishing: false };
  const draft = form({ original: 'on', body: '网络失败仍保留的草稿' });
  const config = {};
  const upload = mainFunction('uploadPdfFiles', {
    isRemote: true, ui, ctx: { me: { id: 'me' } }, config, refreshPreserving() {}, requireLogin() {}, toast() {},
    api: { async uploadFile() { const error = new Error('扫描暂不可用'); error.status = 503; throw error; } }
  });
  await upload([{ name: '笔记.pdf', size: 10, type: 'application/pdf' }], draft);
  assert.equal(ui.files.length, 0);
  assert.equal(ui.uploading, false);
  assert.match(ui.uploadError, /未添加此附件/);
  assert.equal(config.filePolicy.uploadReady, false);
  assert.equal(draft.values.body, '网络失败仍保留的草稿');
});

test('OTP submit checks explicit agreement, calls backend verifyCode, never cloudSignIn', async () => {
  const calls = [];
  const ui = {};
  const submit = mainFunction('handleSubmit', {
    FormData: FormFields, ctx: { db: {} }, ui, authAvailable: () => true,
    location: { hash: '#/login' }, URLSearchParams, refreshPreserving() {}, navigate() {}, toast() {},
    async invoke(name, payload) { calls.push({ name, payload }); return { ok: false, message: '后端验证失败' }; }
  });
  const loginForm = form({ email: 'me@st.zju.edu.cn', code: '654321' });
  loginForm.dataset.form = 'login-verify';
  await submit(loginForm);
  assert.equal(calls.length, 0);
  loginForm.values.agree = 'on';
  await submit(loginForm);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'verifyCode');
  assert.equal(calls[0].payload.agree, true);
  assert.equal(calls[0].payload.email, 'me@st.zju.edu.cn');
  assert.equal(loginForm.values.code, '654321');
  assert.equal(ui.verifying, false);
  assert.doesNotMatch(mainSource, /cloudSignIn|cloudAuth\./);
});

test('code request uses real backend and enforces a 60-second client cooldown', async () => {
  const ui = { codeRetryAt: 0, codeSending: false };
  let requests = 0;
  const send = mainFunction('requestLoginCode', {
    ui, isRemote: true, authAvailable: () => true, syncCodeCooldown() {},
    viewEl: { querySelector: () => null }, toast() {},
    async invoke(name, payload) { requests++; assert.equal(name, 'requestCode'); assert.equal(payload.email, 'me@zju.edu.cn'); return { ok: true }; }
  });
  const before = Date.now();
  await send('me@zju.edu.cn');
  assert.ok(ui.codeRetryAt >= before + 60000);
  assert.match(ui.codeHint, /真实验证码已发送/);
  await send('me@zju.edu.cn');
  assert.equal(requests, 1);
  assert.equal(ui.codeSending, false);
});

test('successful upload is busy until ready and appends only the server receipt', async () => {
  const ui = { files: [], uploading: false };
  let finish;
  const upload = mainFunction('uploadPdfFiles', {
    isRemote: true, ui, ctx: { me: { id: 'me' } }, config: {}, refreshPreserving() {}, requireLogin() {}, toast() {},
    api: { uploadFile: () => new Promise((resolve) => { finish = resolve; }) }
  });
  const file = { name: 'notes.pdf', size: 10, type: 'application/pdf' };
  const pending = upload([file], form({ original: 'on' }));
  assert.equal(ui.uploading, true);
  assert.equal(ui.files.length, 0);
  finish({ attachment: { uploadId: 'up_ready', name: 'notes.pdf', pages: 2, sizeBytes: 10, status: 'ready', path: 'not-client-controlled' } });
  await pending;
  assert.equal(ui.uploading, false);
  assert.equal(ui.files[0].uploadId, 'up_ready');
  assert.equal(ui.files[0].path, undefined);
  assert.notEqual(ui.files[0], file);
});

test('failed publication keeps uploaded files and editor draft; success clears both', async () => {
  const file = { uploadId: 'up_1', status: 'ready' };
  const ui = { files: [file], images: [], editorDrafts: new Map() };
  let ok = false;
  const publish = mainFunction('publishContent', {
    ui, isRemote: true, snapshotFields: () => new Map([['post::body', '草稿正文']]), refreshPreserving() {},
    async invoke() { return { ok }; }
  });
  await publish({}, 'compose');
  assert.equal(ui.files[0], file);
  assert.equal(ui.editorDrafts.get('compose').get('post::body'), '草稿正文');
  assert.equal(ui.publishing, false);
  ok = true;
  await publish({}, 'compose');
  assert.equal(ui.files.length, 0);
  assert.equal(ui.editorDrafts.has('compose'), false);
});

test('source rights and busy state block publication before network calls', () => {
  const ui = { files: [{ uploadId: 'up_1', status: 'ready' }] };
  const validate = mainFunction('validatePublication', { ui, isRemote: true });
  const input = form({ original: 'on', source: '本人课程笔记', rights: '原创' });
  assert.equal(validate(input), '');
  ui.uploading = true;
  assert.match(validate(input), /尚未完成/);
  ui.uploading = false;
  input.values.source = '短';
  assert.match(validate(input), /至少 4 字/);
  input.values.source = '本人课程笔记';
  input.values.rights = '随便转载';
  assert.match(validate(input), /请选择原创/);
});

test('submitPost includes selected term, chapter and real upload references', async () => {
  let payload;
  const ui = { compose: { board: 'help' }, files: [{ uploadId: 'up_1' }], images: [] };
  const submit = mainFunction('submitPost', {
    FormData: FormFields, ui, isRemote: true, ctx: { db: {} },
    pendingImageCount: 0, filesUploading: () => false,
    S: { courseOf: (_, id) => ({ id }) }, validatePublication: () => '', toast() {},
    publicationAttachments: () => [{ uploadId: 'up_1' }],
    async publishContent(value) { payload = value; return { ok: false }; }
  });
  await submit(form({ courseId: 'course_1', title: '问题', body: '问题正文', postTerm: '2026秋', chapter: '第三章', original: 'on' }));
  assert.equal(payload.courseId, 'course_1');
  assert.equal(payload.term, '2026秋');
  assert.equal(payload.chapter, '第三章');
  assert.equal(JSON.stringify(payload.attachments), '[{"uploadId":"up_1"}]');
  assert.equal(payload.images.length, 0);
});
