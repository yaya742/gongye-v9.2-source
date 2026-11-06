/* Small-deployment, single-instance service. TLS is terminated by a trusted same-origin proxy. */
import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as A from '../src/state/actions.js';
import { ProductionStore } from './database.mjs';
import { createAuthentication, sessionCookie } from './auth.mjs';
import { publicState } from './view.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const ADMIN_ACTIONS = new Set(['resolveReport', 'archiveCircle', 'setUserStatus', 'createCircle', 'setPostStatus', 'setCircleRestriction', 'reviewApplication']);
const ACTIONS = new Set(['requestCode', 'verifyCode', 'logout', 'updateProfile', 'updatePrefs',
  'createPost', 'updatePost', 'saveResourceDraft', 'clearResourceDraft', 'setResourceCourse',
  'removePost', 'toggleReaction', 'toggleFollowUser', 'toggleFollowCourse', 'addComment',
  'removeComment', 'acceptComment', 'unacceptComment', 'joinCircle', 'leaveCircle', 'setCircleFlag',
  'markCircleSeen', 'submitApplication', 'setResourceIndex', 'downloadResource', 'claimDaily',
  'sendGift', 'markNotificationRead', 'markAllNotificationsRead', 'reportContent', ...ADMIN_ACTIONS]);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const issue = (status, code, message) => Object.assign(new Error(message), { status, code });
const loopback = (host) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
function validateOrigin(input) {
  if (!input) return null;
  let url;
  try { url = new URL(input); } catch { throw new Error('invalid_PUBLIC_ORIGIN'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    !['https:', 'http:'].includes(url.protocol) || url.protocol === 'http:' && !loopback(url.hostname)) {
    throw new Error('PUBLIC_ORIGIN_requires_https_except_loopback');
  }
  return url.origin;
}
function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}
async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) throw issue(415, 'content_type', '请使用 JSON 请求');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw issue(413, 'body_too_large', '请求内容过大');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw issue(400, 'bad_json', '请求格式错误'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw issue(400, 'bad_json', '请求格式错误');
  return body;
}
function securityHeaders(res, secure) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

export async function servePublicStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some((part) => part.startsWith('.'))) return false;
  if (decoded === '/') decoded = '/index.html';
  const extension = path.extname(decoded).toLowerCase();
  const allowed = ['/index.html', '/404.html'].includes(decoded) ||
    decoded.startsWith('/src/') && ['.js', '.css'].includes(extension) ||
    decoded.startsWith('/assets/') && !!MIME[extension];
  if (!allowed || decoded.startsWith('/assets/vendor/') || decoded.startsWith('/assets/samples/') || decoded.endsWith('.map')) return false;
  const target = path.resolve(APP_ROOT, `.${decoded}`);
  if (!target.startsWith(APP_ROOT + path.sep)) return false;
  let canonical;
  try {
    canonical = await fs.realpath(target);
    const root = await fs.realpath(APP_ROOT);
    if (!canonical.startsWith(root + path.sep) || !(await fs.stat(canonical)).isFile()) return false;
    // A src/assets symlink must not escape its public subtree into server/data.
    const subroot = decoded.startsWith('/src/') ? await fs.realpath(path.join(APP_ROOT, 'src')) :
      decoded.startsWith('/assets/') ? await fs.realpath(path.join(APP_ROOT, 'assets')) : null;
    if (subroot && !canonical.startsWith(subroot + path.sep)) return false;
    if (subroot && subroot !== path.join(root, decoded.startsWith('/src/') ? 'src' : 'assets')) return false;
  } catch { return false; }
  const data = await fs.readFile(canonical);
  res.writeHead(200, { 'content-type': MIME[extension] || 'application/octet-stream',
    'cache-control': ['.js', '.html', '.css'].includes(extension) ? 'no-store' : 'public, max-age=3600' });
  res.end(req.method === 'HEAD' ? undefined : data);
  return true;
}

export async function createProductionServer(options = {}) {
  const publicOrigin = validateOrigin(options.publicOrigin || process.env.PUBLIC_ORIGIN);
  let expectedOrigin = publicOrigin;
  const secure = publicOrigin?.startsWith('https:') || false;
  const auth = await createAuthentication(options);
  const dataFile = options.dataFile || process.env.DATA_FILE || path.join(HERE, 'data', 'production.sqlite');
  const store = new ProductionStore(dataFile);
  const db = store.data;
  let files;
  try {
    await store.save(() => {
      for (const user of db.users) user.role = auth.adminEmails.has(String(user.email).toLowerCase()) ? 'admin' : 'user';
    });
    if (options.files) files = options.files;
    else {
      const { createFileService } = await import('./files.mjs');
      files = await createFileService({ rootDir: options.uploadDir || path.join(path.dirname(store.file), 'uploads'),
        db, save: (mutator) => store.save(mutator), scanPdf: options.scanPdf, renderPreview: options.renderPreview,
        maxBytes: options.maxBytes || 20 * 1024 * 1024, allowedDomains: auth.domains });
    }
  } catch (error) { await store.close(); throw error; }
  const filePolicy = { allowedTypes: ['application/pdf'], maxBytes: options.maxBytes || 20 * 1024 * 1024,
    maxFiles: 3, images: false, requiresScan: true, requiresPreview: true };
  const supportEmail = /^[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}$/i.test(options.supportEmail || process.env.SUPPORT_EMAIL || '')
    ? String(options.supportEmail || process.env.SUPPORT_EMAIL).trim() : '';
  const runtimeConfig = () => `window.__GONGYE_CONFIG__ = ${JSON.stringify({ mode: 'production', production: true,
    apiBase: '', basePath: '/', storageKey: 'gongye-production', authMode: 'email-otp',
    authReady: auth.authReady, emailDomains: auth.domains, cloud: null, filePolicy, supportEmail,
    demoNotice: `学生自发贡献的课程学习资料与课友圈；请确认资料来源和分享权利。配置邮箱域名：${auth.domains.join('、')}（实际可用域名请向学校核实）。` })};\n`;

  async function performAction(req, body, ip) {
    const name = typeof body.name === 'string' ? body.name : '';
    if (!ACTIONS.has(name)) throw issue(403, 'disabled', '此操作不对外开放');
    let payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
    let user = auth.userFromRequest(db, req);
    let cookie = null;
    let result;
    if (name === 'requestCode') result = await auth.requestCode(db, payload, ip);
    else if (name === 'verifyCode') {
      user = auth.verifyCode(db, payload, ip);
      cookie = sessionCookie(auth.issue(db, user, req), secure);
      result = { ok: true, message: `已登录：${user.nickname}`, data: { user: { id: user.id, nickname: user.nickname, role: user.role } } };
      await store.save();
    } else if (name === 'logout') {
      auth.revoke(db, req);
      cookie = sessionCookie(null, secure);
      user = null;
      result = { ok: true, message: '已退出登录', data: {} };
      await store.save();
    } else {
      if (!user || user.status !== 'active') throw issue(401, 'login', '请先登录');
      if (user.verified !== true) throw issue(403, 'unverified', '请先验证邮箱');
      if (ADMIN_ACTIONS.has(name) && (user.role !== 'admin' || !auth.adminEmails.has(user.email))) throw issue(403, 'forbidden', '只有配置的管理员可以执行此操作');
      db.session = { userId: user.id };
      try {
        if (name === 'updateProfile' && payload.avatar &&
          !/^(?:art\/avatar-0[1-6]\.svg|avatars\/(?:cat\.jpg|mountains\.jpg|coffee\.jpg|(?:doodle|moon|sprout|orange|wave)\.svg))$/.test(payload.avatar)) {
          throw issue(400, 'bad_avatar', '请选择内置头像');
        }
        if (name === 'updatePrefs') {
          payload = { patch: Object.fromEntries(['replies', 'gifts', 'system'].filter((key) => typeof payload.patch?.[key] === 'boolean').map((key) => [key, payload.patch[key]])) };
        }
        // Hidden/banned authors cannot be targeted by guessing IDs, either.
        if (!ADMIN_ACTIONS.has(name) && payload.postId) {
          const post = db.posts.find((p) => p.id === payload.postId);
          const author = post && db.users.find((u) => u.id === post.authorId);
          if (post && (author?.status !== 'active' || post.status !== 'published') && post.authorId !== user.id) throw issue(404, 'not_found', '内容不可用');
        }
        if (name === 'createPost') {
          if (payload.images?.length) throw issue(400, 'images_disabled', '暂不支持图片上传');
          const inputs = Array.isArray(payload.attachments) ? payload.attachments : [];
          if (inputs.length > 3) throw issue(400, 'too_many_files', '最多 3 个 PDF 附件');
          const prepared = await files.prepareAttachments(user, inputs.map((input) => ({ uploadId: input?.uploadId })));
          result = A.createPost(db, { ...payload, images: [], attachments: prepared });
          if (result.ok) {
            const post = db.posts.find((p) => p.id === result.data.postId);
            await files.finalizePost(post, prepared);
          }
        } else if (name === 'downloadResource') result = await files.downloadResource(user, payload);
        else {
          if (typeof A[name] !== 'function') throw issue(503, 'action_unavailable', '此操作暂不可用');
          result = A[name](db, payload);
        }
        if (name === 'setUserStatus' && result.ok) db.sessions = db.sessions.filter((s) => db.users.some((u) => u.id === s.userId && u.status === 'active'));
        await store.save();
      } finally { db.session = null; }
    }
    const state = publicState(db, user?.id);
    return { body: { result: safeResult(result, state, name), state }, cookie };
  }

  function safeResult(result, state, name) {
    const value = { ok: !!result?.ok, message: String(result?.message || '') };
    if (result?.code) value.code = String(result.code);
    const data = result?.data || {};
    value.data = {};
    for (const key of ['postId', 'resourceId', 'courseId', 'circleId', 'hasResource', 'balance', 'date', 'duplicate', 'skipped', 'email', 'expiresIn', 'retryAfter']) {
      if (['string', 'number', 'boolean'].includes(typeof data[key])) value.data[key] = data[key];
    }
    for (const key of ['growth', 'levelUp', 'quote', 'bookmark']) if (data[key]) value.data[key] = data[key];
    if (data.user) value.data.user = state.users.find((u) => u.id === state.session?.userId);
    if (data.comment) value.data.comment = state.comments.find((c) => c.id === data.comment.id);
    if (data.gift) value.data.gift = state.gifts.find((g) => g.id === data.gift.id);
    if (data.circle) value.data.circle = state.circles.find((c) => c.id === data.circle.id);
    if (data.draft) value.data.draft = state.drafts[state.session?.userId];
    if (name === 'downloadResource' && result.ok) {
      // File module returns an HTTP URL, never accept a physical path from a stub/provider.
      if (!/^\/api\/files\/[A-Za-z0-9_-]+\/download$/.test(data.path || '')) throw issue(500, 'file_path', '文件服务返回了无效地址');
      value.data.path = data.path;
      value.data.name = String(data.name || '资料.pdf');
    }
    return value;
  }

  const server = http.createServer(async (req, res) => {
    securityHeaders(res, secure);
    let pathname;
    try {
      pathname = new URL(req.url || '/', 'http://local.invalid').pathname;
      if (pathname.startsWith('/api/')) {
        res.setHeader('cache-control', 'no-store');
        if (!['GET', 'HEAD'].includes(req.method)) {
          const origin = req.headers.origin;
          const site = req.headers['sec-fetch-site'];
          if (req.headers['x-requested-with'] !== 'gongye' ||
            (origin ? origin !== expectedOrigin : site !== 'same-origin') ||
            (site && !['same-origin', 'none'].includes(site))) throw issue(403, 'csrf', '请求来源校验失败');
        }
        const ip = req.socket.remoteAddress || 'unknown'; // Never trust client-provided forwarding headers.
        if (!auth.allow(`api:${ip}`, 300, 60_000)) throw issue(429, 'rate_limited', '操作太频繁');
        if (pathname === '/api/health' && req.method === 'GET') {
          json(res, 200, { ok: true, mode: 'production', authMode: 'email-otp', authReady: auth.authReady });
          return;
        }
        if (pathname === '/api/state' && req.method === 'GET') {
          const value = await store.run(() => publicState(db, auth.userFromRequest(db, req)?.id));
          json(res, 200, { state: value }); return;
        }
        if (pathname === '/api/action' && req.method === 'POST') {
          const body = await readJson(req);
          const reply = await store.run(() => performAction(req, body, ip));
          reply.body.state.revision = store.revision;
          json(res, 200, reply.body, reply.cookie ? { 'set-cookie': reply.cookie } : {}); return;
        }
        if (pathname === '/api/files' || pathname.startsWith('/api/files/')) {
          const handled = await store.run(async () => {
            const user = auth.userFromRequest(db, req);
            return files.handle(req, res, { pathname, user });
          });
          if (handled) return;
        }
        throw issue(404, 'not_found', '接口不存在');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw issue(405, 'method', '不支持的方法');
      if (pathname === '/src/config.js') {
        const script = runtimeConfig();
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : script); return;
      }
      if (!await servePublicStatic(req, res, pathname)) throw issue(404, 'not_found', '页面不存在');
    } catch (error) {
      // Deliberately do not print payloads, OTPs, SMTP errors, file paths or credentials.
      if (!res.headersSent) json(res, error.status || 500, { error: {
        code: error.status ? error.code || 'request_failed' : 'server_error',
        message: error.status ? error.message : '服务器暂时无法处理请求' } });
      else res.end();
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });
  return {
    server, db, store, files, authMode: 'email-otp', authReady: auth.authReady,
    emailDomains: auth.domains, configurationIssue: auth.configurationIssue,
    listen(port = 8787, host = '127.0.0.1') {
      if (!loopback(host) && (!publicOrigin || !secure)) return Promise.reject(new Error('https_PUBLIC_ORIGIN_required_for_non_loopback_listener'));
      return new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once('error', onError);
        server.listen(port, host, () => {
          server.removeListener('error', onError);
          const address = server.address();
          expectedOrigin = publicOrigin || `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
          resolve(address);
        });
      });
    },
    async close() {
      if (server.listening) await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeIdleConnections?.();
      });
      await store.close();
    }
  };
}
