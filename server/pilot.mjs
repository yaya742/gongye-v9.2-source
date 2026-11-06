/* 共页 · 内部试用后端（Pilot）
 *
 * 目标：只给名单内同事注册，验证真实登录、发帖、入圈、页签等流程。
 * 形态：单进程 Node 服务，状态存一个 JSON 文件（server/data/db.json），随时可删。
 * 复用：业务规则直接复用前端已有的 src/state/actions.js（服务端执行、服务端校验）。
 *
 * 启动：node server/index.mjs   （或用 server/启动试用.cmd 双击）
 */

import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fsp, existsSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createSeed } from '../src/data/seed.js';
import * as A from '../src/state/actions.js';
import { publicState } from './view.mjs';
import { servePublicStatic } from './production.mjs';
export { publicState } from './view.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const SESSION_COOKIE = 'gy_sid';
const SESSION_DAYS = 7;
const WRITE_ACTIONS = new Set(
  Object.keys(A).filter((key) => typeof A[key] === 'function' && !['newId', 'finishAttachmentProcessing'].includes(key))
);

/* ---------- 白名单 ---------- */

export function loadAllowlist(file, envEmails = '', envDomains = '') {
  const emails = new Set();
  const domains = new Set();

  const pushEmail = (value) => {
    const email = String(value || '').trim().toLowerCase();
    if (email && email.includes('@')) emails.add(email);
  };
  const pushDomain = (value) => {
    const domain = String(value || '').trim().toLowerCase().replace(/^@/, '');
    if (domain) domains.add(domain);
  };

  String(envEmails).split(',').forEach(pushEmail);
  String(envDomains).split(',').forEach(pushDomain);

  if (file && existsSync(file)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('@')) pushDomain(line);
      else pushEmail(line);
    }
  }

  const allowed = (email) => {
    const value = String(email || '').trim().toLowerCase();
    if (!value.includes('@')) return false;
    if (emails.has(value)) return true;
    return [...domains].some((domain) => value.endsWith(`@${domain}`));
  };

  return { emails, domains, allowed };
}

/* ---------- 数据文件 ---------- */

export class JsonStore {
  constructor(file) {
    this.file = file;
    this.data = null;
    this.saving = Promise.resolve();
  }

  async load() {
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
        if (parsed && Array.isArray(parsed.posts)) {
          this.data = parsed;
          if (!Array.isArray(this.data.sessions)) this.data.sessions = [];
          return this.data;
        }
      } catch {
        // 文件损坏时保留旧文件并从种子重建
        const broken = `${this.file}.broken-${Date.now()}`;
        try { mkdirSync(path.dirname(this.file), { recursive: true }); } catch { /* ignore */ }
        try { renameSync(this.file, broken); } catch { /* ignore */ }
      }
    }
    this.data = createSeed(Date.now());
    this.data.sessions = [];
    this.data.pilot = { createdAt: new Date().toISOString() };
    await this.save();
    return this.data;
  }

  async save() {
    const payload = JSON.stringify(this.sanitizeForDisk(this.data));
    this.saving = this.saving.then(async () => {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fsp.writeFile(tmp, payload, 'utf8');
      await fsp.rename(tmp, this.file);
    }).catch((error) => {
      console.error('[pilot] 保存数据失败', error);
    });
    return this.saving;
  }

  sanitizeForDisk(data) {
    return { ...data, session: null };
  }
}

/* ---------- 会话 ---------- */

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function parseCookies(header = '') {
  const out = {};
  String(header).split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) { try { out[key] = decodeURIComponent(value); } catch { /* invalid cookie is ignored */ } }
  });
  return out;
}

function issueSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.sessions = (db.sessions || []).filter((s) => new Date(s.expiresAt).getTime() > now);
  db.sessions.push({
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashToken(token),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_DAYS * 86400000).toISOString()
  });
  return token;
}

/* 从 Cookie 或 Authorization: Bearer 取会话令牌。
 * 优先读 Cookie：托管平台（WorkBuddy 沙箱）会给每个请求注入它自己的
 * Authorization 头，若先读 Authorization 会一直拿到平台令牌而丢掉登录态。
 * 跨域名部署（静态站与后端不同域）时仍可用 Bearer。 */
function tokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function userFromRequest(db, req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const hash = hashToken(token);
  const session = (db.sessions || []).find((s) => s.tokenHash === hash);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  return db.users.find((u) => u.id === session.userId && u.status === 'active' && u.verified === true) || null;
}

function revokeSession(db, req) {
  const token = tokenFromRequest(req);
  if (!token) return;
  const hash = hashToken(token);
  db.sessions = (db.sessions || []).filter((s) => s.tokenHash !== hash);
}

/* ---------- 对外状态（脱敏） ---------- */

// The same explicit minimal projection as production; no db spread.

/* ---------- HTTP 工具 ---------- */

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function cookieHeader(token, secure) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

const clearCookieHeader = (secure) => {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
};

/* ---------- 静态文件 ---------- */

function runtimeConfigScript(options) {
  const config = {
    mode: 'production',
    apiBase: '',
    storageKey: 'gongye-pilot',
    basePath: '/',
    authMode: options.authMode || 'demo-code',
    cloud: options.cloud || null,
    demoNotice: options.notice
  };
  return `window.__GONGYE_CONFIG__ = ${JSON.stringify(config)};\n`;
}

/* ---------- 创建服务 ---------- */

export async function createPilotServer(options = {}) {
  const dataFile = options.dataFile || path.join(HERE, 'data', 'db.json');
  const allowlistFile = options.allowlistFile || path.join(HERE, 'allowlist.txt');
  const adminEmail = String(options.adminEmail || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const cookieSecure = options.cookieSecure === undefined
    ? String(process.env.COOKIE_SECURE || '0') === '1'
    : !!options.cookieSecure;
  const allowlist = loadAllowlist(
    allowlistFile,
    options.allowedEmails || process.env.ALLOWED_EMAILS || '',
    options.allowedDomains || process.env.ALLOWED_DOMAINS || ''
  );
  /* Legacy cloud mode is disabled: a browser-supplied email is never proof of ownership.
   * requireCloudAuth only turns off this local demo's fixed-code login. */
  const requireCloudAuth = options.requireCloudAuth === undefined
    ? String(process.env.REQUIRE_CLOUD_AUTH || '') === '1'
    : !!options.requireCloudAuth;
  const cloudConfig = null;
  const adminEmails = new Set(
    [adminEmail, ...(Array.isArray(options.adminEmails) ? options.adminEmails : [])]
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const notice = options.notice || (requireCloudAuth
    ? '浙大内测：只对 @zju.edu.cn 邮箱开放；内容内测同学可见，请勿上传隐私或整本教材。'
    : '只有名单内的邮箱能注册；数据随时可能清空，请勿上传隐私或整本教材。');

  // 允许跨域的前端来源。为空或包含 '*' 时回显请求来源（仅适合内部试用）。
  const rawOrigins = options.allowedOrigins !== undefined
    ? options.allowedOrigins
    : String(process.env.ALLOWED_ORIGINS || '').split(',');
  const allowedOrigins = (Array.isArray(rawOrigins) ? rawOrigins : String(rawOrigins).split(','))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const originAllowed = (origin) => {
    if (!origin) return false;
    if (!allowedOrigins.length) return true;
    if (allowedOrigins.includes('*')) return true;
    return allowedOrigins.includes(origin);
  };

  const store = new JsonStore(dataFile);
  const db = await store.load();

  for (const email of adminEmails) {
    const admin = db.users.find((u) => String(u.email || '').toLowerCase() === email);
    if (admin) admin.role = 'admin';
  }

  const rateBuckets = new Map();
  const allowRequest = (key, limit = 120, windowMs = 60_000) => {
    const now = Date.now();
    const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    rateBuckets.set(key, bucket);
    return bucket.count <= limit;
  };

  // Serialize shared db.session even for legacy fixed-code local demos.
  let requestQueue = Promise.resolve();
  const handleRequest = async (req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    const origin = req.headers.origin;
    const ip = req.socket.remoteAddress || 'unknown';

    /* ---- 跨域头：允许静态站（不同域名）调用接口 ---- */
    if (origin && originAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (req.method === 'OPTIONS') {
      if (origin && originAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-requested-with');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      /* ---- API ---- */
      /* 部署自检用：只回报「请求里有没有带身份」，不含任何令牌内容。
       * 已改为仅管理员可见，其他人按 404 处理，不暴露这个接口存在。 */
      if (urlPath === '/api/probe') {
        const who = userFromRequest(db, req);
        if (!who || who.role !== 'admin') {
          sendJson(res, 404, { error: { code: 'not_found', message: '接口不存在' } });
          return;
        }
        const cookies = parseCookies(req.headers.cookie || '');
        const rawToken = tokenFromRequest(req);
        sendJson(res, 200, {
          hasAuthorization: Boolean(req.headers.authorization),
          hasCookieHeader: Boolean(req.headers.cookie),
          cookieNames: Object.keys(cookies),
          sawToken: Boolean(rawToken),
          sessionMatched: Boolean(rawToken && db.sessions.some((s) => s.tokenHash === hashToken(rawToken))),
          sessions: (db.sessions || []).length,
          forwardedFor: String(req.headers['x-forwarded-for'] || ''),
          host: String(req.headers.host || '')
        });
        return;
      }

      /* 管理员导出全量数据：重新部署会按上传内容覆盖沙箱目录，
       * 所以动代码之前先导一份，部署完再把文件放回 server/data/db.json 重新发一次。 */
      if (urlPath === '/api/admin/export') {
        const admin = userFromRequest(db, req);
        if (!admin || admin.role !== 'admin') {
          sendJson(res, 403, { error: { code: 'forbidden', message: '只有管理员可以导出数据' } });
          return;
        }
        const body = JSON.stringify(store.sanitizeForDisk(db), null, 2);
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': 'attachment; filename="gongye-db.json"',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(body)
        });
        res.end(body);
        return;
      }

      if (urlPath === '/api/health') {        sendJson(res, 200, {
          ok: true,
          users: db.users.length,
          posts: db.posts.length,
          allowlist: { emails: allowlist.emails.size, domains: allowlist.domains.size }
        });
        return;
      }

      if (urlPath === '/api/state') {
        const me = userFromRequest(db, req);
        sendJson(res, 200, {
          state: publicState(db, me ? me.id : null),
          allowlistConfigured: allowlist.emails.size + allowlist.domains.size > 0
        });
        return;
      }

      if (urlPath === '/api/action' && req.method === 'POST') {
        if (origin && !originAllowed(origin)) {
          sendJson(res, 403, { error: { code: 'origin', message: '来源不被允许' } });
          return;
        }
        if (!allowRequest(`write:${ip}`, 180, 60_000)) {
          sendJson(res, 429, { error: { code: 'rate_limited', message: '操作太频繁，请稍后再试' } });
          return;
        }

        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          sendJson(res, 400, { error: { code: 'bad_json', message: '请求格式错误' } });
          return;
        }

        const name = String(body.name || '');
        const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
        if (!WRITE_ACTIONS.has(name) && name !== 'cloudSignIn') {
          sendJson(res, 400, { error: { code: 'unknown_action', message: `未知操作：${name}` } });
          return;
        }

        const me = userFromRequest(db, req);
        db.session = me ? { userId: me.id } : null;

        let result;
        let setCookie = null;

        if (name === 'quickLogin') {
          sendJson(res, 403, { error: { code: 'disabled', message: '试用版已关闭演示账号切换' } });
          return;
        }

        /* 开了云端登录后，固定验证码入口彻底关闭（前端不再调用，接口也不放行） */
        if (requireCloudAuth && (name === 'requestCode' || name === 'verifyCode')) {
          sendJson(res, 403, {
            error: { code: 'cloud_auth_required', message: '登录方式已改为浙大邮箱验证码，请刷新页面重试' }
          });
          return;
        }

        if (name === 'cloudSignIn') {
          db.session = null;
          sendJson(res, 403, { error: { code: 'disabled', message: '裸邮箱不构成身份凭证；请使用生产邮箱 OTP 登录' } });
          return;
        }

        if (name === 'requestCode' || name === 'verifyCode') {
          const email = String(payload.email || '').trim().toLowerCase();
          if (!allowlist.allowed(email)) {
            sendJson(res, 403, {
              error: {
                code: 'not_allowed',
                message: allowlist.emails.size + allowlist.domains.size === 0
                  ? '管理员还没有配置试用名单（server/allowlist.txt）'
                  : '这个邮箱不在试用名单内，请联系管理员添加'
              }
            });
            return;
          }
          result = A[name](db, { ...payload, email });
          if (name === 'verifyCode' && result.ok) {
            if (adminEmails.has(email)) {
              const user = db.users.find((u) => String(u.email || '').toLowerCase() === email);
              if (user) user.role = 'admin';
            }
            const user = db.users.find((u) => String(u.email || '').toLowerCase() === email);
            if (user) {
              const token = issueSession(db, user.id);
              setCookie = cookieHeader(token, cookieSecure);
              db.session = { userId: user.id };
              result = {
                ...result,
                // 跨域名部署时浏览器不会带第三方 Cookie，前端会把 token 放进 Authorization 头
                data: { user: { id: user.id, nickname: user.nickname, role: user.role }, token }
              };
            }
          }
        } else if (name === 'logout') {
          revokeSession(db, req);
          result = A.logout(db);
          setCookie = clearCookieHeader(cookieSecure);
        } else {
          result = A[name](db, payload);
        }

        db.session = null;
        db.sessions = db.sessions.filter((s) => db.users.some((u) => u.id === s.userId && u.status === 'active'));
        await store.save();

        const effectiveMeId = name === 'logout'
          ? null
          : (me ? me.id : (result && result.ok && result.data && result.data.user ? result.data.user.id : null));
        const headers = setCookie ? { 'set-cookie': setCookie } : {};
        sendJson(res, 200, {
          result,
          state: publicState(db, effectiveMeId)
        }, headers);
        return;
      }

      /* ---- 运行时配置（覆盖静态文件，切换为 production 模式） ---- */
      if (urlPath === '/src/config.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        res.end(runtimeConfigScript({
          notice,
          authMode: requireCloudAuth ? 'disabled' : 'demo-code',
          cloud: cloudConfig
        }));
        return;
      }

      /* ---- 静态文件 ---- */
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: { code: 'method', message: '不支持的方法' } });
        return;
      }

      if (await servePublicStatic(req, res, urlPath)) return;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    } catch (error) {
      console.error('[pilot] 请求失败', urlPath, error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: { code: 'server_error', message: '服务器出错了' } });
      } else {
        res.end();
      }
    }
  };
  const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    requestQueue = requestQueue.then(() => handleRequest(req, res)).catch(() => {
      db.session = null;
      if (!res.headersSent) sendJson(res, 500, { error: { code: 'server_error', message: '请求失败' } });
      else res.end();
    });
  });

  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return {
    server,
    db,
    store,
    allowlist,
    loginMode: requireCloudAuth ? 'disabled' : 'demo-code',
    listen(port = 8787, host = '127.0.0.1') {
      if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return Promise.reject(new Error('pilot_is_local_only_use_production_for_deployment'));
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve(server.address()));
      });
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
      });
    }
  };
}

// Explicit, local-only demo entry. Never selected by the production index.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pilot = await createPilotServer();
  const address = await pilot.listen(Number(process.env.PORT || 8788), '127.0.0.1');
  console.warn(`[pilot] LOCAL DEMO ONLY: http://127.0.0.1:${address.port}; fixed code enabled for allowlisted demo accounts. Do not deploy.`);
  const close = async () => { await pilot.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
