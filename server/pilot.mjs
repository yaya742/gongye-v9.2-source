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
import { promises as fsp, existsSync, lstatSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createSeed } from '../src/data/seed.js';
import { removeKnownDemoPosts, DEMO_POST_CLEANUP_VERSION } from '../src/data/demo-post-cleanup.js';
import * as A from '../src/state/actions.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const APP_ROOT_REAL = await fsp.realpath(APP_ROOT).catch(() => APP_ROOT);

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
const DEMO_ATTACHMENT_PATHS = new Set(A.DEMO_SAMPLE_FILES.map((file) => file.path));
const PREFERRED_CIRCLE_IDS = Object.freeze({
  c_calc: 'ci_calc_a',
  c_la: 'ci_la_a',
  c_py: 'ci_py_b',
  c_ds: 'ci_ds_a',
  c_prob: 'ci_prob',
  c_phys: 'ci_phys'
});
// Only expose actions intended to be called by the browser. Internal helpers
// such as finishAttachmentProcessing must never become public just because
// they were exported from actions.js.
const WRITE_ACTIONS = new Set([
  'requestCode', 'verifyCode', 'quickLogin', 'logout',
  'updateProfile', 'updatePrefs', 'createPost', 'updatePost',
  'saveResourceDraft', 'clearResourceDraft', 'setResourceCourse',
  'removePost', 'toggleReaction', 'toggleFollowUser', 'toggleFollowCourse',
  'addComment', 'removeComment', 'acceptComment', 'unacceptComment',
  'joinCircle', 'leaveCircle', 'setCircleFlag', 'markCircleSeen',
  'submitApplication', 'setResourceIndex', 'downloadResource',
  'claimDaily', 'sendGift', 'markNotificationRead', 'markAllNotificationsRead',
  'sendDirectMessage', 'markDirectMessagesRead',
  'reportContent', 'resolveReport', 'archiveCircle', 'setUserStatus',
  'createCircle', 'setPostStatus', 'recordEvent'
]);
const PUBLIC_ACTIONS = new Set(['requestCode', 'verifyCode', 'cloudSignIn', 'recordEvent']);

function canonicalCircleIds(circles) {
  const groups = new Map();
  for (const circle of circles || []) {
    if (!circle || typeof circle.courseId !== 'string' || !circle.courseId) continue;
    if (!groups.has(circle.courseId)) groups.set(circle.courseId, []);
    groups.get(circle.courseId).push(circle);
  }
  const canonicalIds = new Map();
  for (const [courseId, group] of groups) {
    const preferredId = PREFERRED_CIRCLE_IDS[courseId] || null;
    const sorted = [...group].sort((a, b) => {
      const activeOrder = Number(b.status === 'active') - Number(a.status === 'active');
      if (activeOrder) return activeOrder;
      const preferredOrder = Number(b.id === preferredId) - Number(a.id === preferredId);
      if (preferredOrder) return preferredOrder;
      const aCreated = a.createdAt ? Date.parse(a.createdAt) : NaN;
      const bCreated = b.createdAt ? Date.parse(b.createdAt) : NaN;
      if (!Number.isNaN(aCreated) || !Number.isNaN(bCreated)) {
        if (Number.isNaN(aCreated)) return 1;
        if (Number.isNaN(bCreated)) return -1;
        if (aCreated !== bCreated) return aCreated - bCreated;
      }
      const left = String(a.id || '');
      const right = String(b.id || '');
      return left < right ? -1 : left > right ? 1 : 0;
    });
    if (sorted[0] && sorted[0].id) canonicalIds.set(courseId, sorted[0].id);
  }
  return canonicalIds;
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function requestOrigin(req) {
  // Production proxies must overwrite these headers with the external request
  // values. Direct/local requests fall back to the socket and Host header.
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = ['http', 'https'].includes(forwardedProto)
    ? `${forwardedProto}:`
    : (req.socket.encrypted ? 'https:' : 'http:');
  const host = forwardedHost || String(req.headers.host || '').trim();
  return host ? normalizeOrigin(`${protocol}//${host}`) : null;
}

function isSupportedDemoAttachmentPath(value) {
  return typeof value === 'string' && DEMO_ATTACHMENT_PATHS.has(value);
}

function validatePilotCreatePostAttachments(payload) {
  const attachments = payload.attachments || [];
  if (!Array.isArray(attachments)) return '附件数据格式无效';
  // Keep the established action response for this existing validation.
  if (attachments.length > 3) return '';
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return '附件数据格式无效';
    if (!isSupportedDemoAttachmentPath(attachment.path)) {
      return '当前试用版只支持内置演示 PDF，暂不支持上传自选文件';
    }
    if (attachment.status === 'processing') return '当前试用版不支持真实文件处理';
  }
  return '';
}

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
      let parsed = null;
      try {
        parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch {
        // 文件损坏时保留旧文件并从种子重建
        const broken = `${this.file}.broken-${Date.now()}`;
        try { mkdirSync(path.dirname(this.file), { recursive: true }); } catch { /* ignore */ }
        try { renameSync(this.file, broken); } catch { /* ignore */ }
      }
      if (parsed && Array.isArray(parsed.posts)) {
        this.data = parsed;
        if (!Array.isArray(this.data.sessions)) this.data.sessions = [];
        if (!this.data.demoPostCleanup
          || this.data.demoPostCleanup.version !== DEMO_POST_CLEANUP_VERSION) {
          await this.migrateDemoPostFixtures();
        }
        return this.data;
      }
    }
    this.data = createSeed(Date.now());
    this.data.sessions = [];
    this.data.pilot = { createdAt: new Date().toISOString() };
    await this.save();
    return this.data;
  }

  async migrateDemoPostFixtures() {
    const sourceStat = lstatSync(this.file);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.nlink !== 1) {
      throw new Error('[pilot] 样例帖子迁移拒绝处理非普通文件或硬链接数据文件；原数据未改动');
    }

    const originalBytes = await fsp.readFile(this.file);
    const candidate = JSON.parse(originalBytes.toString('utf8'));
    if (!Array.isArray(candidate.sessions)) candidate.sessions = [];
    const now = Date.now();
    const summary = removeKnownDemoPosts(candidate, {
      now,
      reason: '已确认的源码演示样例清理'
    });
    const backupPath = `${this.file}.pre-demo-post-cleanup-v${DEMO_POST_CLEANUP_VERSION}-${now}-${process.pid}.bak`;

    // 用排他创建和私有权限保留逐字节一致的回滚副本。
    const backupHandle = await fsp.open(backupPath, 'wx', 0o600);
    try {
      await backupHandle.writeFile(originalBytes);
      await backupHandle.sync();
    } finally {
      await backupHandle.close();
    }
    const [currentBytes, backupBytes] = await Promise.all([
      fsp.readFile(this.file),
      fsp.readFile(backupPath)
    ]);
    if (!currentBytes.equals(originalBytes) || !backupBytes.equals(originalBytes)) {
      await fsp.unlink(backupPath).catch(() => {});
      throw new Error('[pilot] 样例帖子迁移备份校验失败；原数据未改动');
    }

    const preWriteBytes = await fsp.readFile(this.file);
    if (!preWriteBytes.equals(originalBytes)) {
      await fsp.unlink(backupPath).catch(() => {});
      throw new Error('[pilot] 数据文件在迁移期间发生变化；原数据未改动');
    }

    this.data = candidate;
    await this.save();
    let persisted;
    try {
      persisted = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      throw new Error(`[pilot] 样例帖子迁移写入校验失败；备份保存在 ${backupPath}`);
    }
    if (!persisted.demoPostCleanup
      || persisted.demoPostCleanup.version !== DEMO_POST_CLEANUP_VERSION) {
      throw new Error(`[pilot] 样例帖子迁移未能持久化；备份保存在 ${backupPath}`);
    }
    console.log(`[pilot] 源码演示帖子迁移完成：移除 ${summary.removedPostIds.length} 条，保留 ${summary.skippedPostIds.length} 条不匹配或无法安全处理的记录`);
    console.log(`[pilot] 迁移前数据备份：${backupPath}`);
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
    if (key) out[key] = decodeURIComponent(value);
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
  return db.users.find((u) => u.id === session.userId) || null;
}

async function verifyCloudAccessToken(cloudConfig, accessToken) {
  const token = String(accessToken || '').trim();
  const endpointText = String((cloudConfig || {}).endpoint || '').trim().replace(/\/+$/, '');
  const publishableKey = String((cloudConfig || {}).publishableKey || '').trim();
  if (!token || token.length > 16_384 || /\s/.test(token)) return { ok: false, code: 'invalid' };
  if (!endpointText || !publishableKey.startsWith('wbpk_')) return { ok: false, code: 'unavailable' };

  let endpoint;
  try {
    endpoint = new URL(endpointText);
  } catch {
    return { ok: false, code: 'unavailable' };
  }
  const localHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(endpoint.hostname);
  if ((endpoint.protocol !== 'https:' && !(localHost && endpoint.protocol === 'http:'))
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    return { ok: false, code: 'unavailable' };
  }

  try {
    const verifyUrl = `${endpointText}/.cloud/auth/v1/user/me`;
    const response = await fetch(verifyUrl, {
      method: 'GET',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${token}`,
        'x-wb-webapp-access-key': publishableKey,
        accept: 'application/json'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (response.status === 401 || response.status === 403) return { ok: false, code: 'invalid' };
    if (!response.ok) return { ok: false, code: 'unavailable' };

    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 65_536) return { ok: false, code: 'invalid' };
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return { ok: false, code: 'invalid' };
    }
    const identity = body && typeof body === 'object'
      ? (body.data && body.data.user) || body.data || body.user || body
      : null;
    if (!identity || typeof identity !== 'object'
      || identity.is_anonymous === true || identity.scope === 'anonymous') {
      return { ok: false, code: 'invalid' };
    }
    const email = String(identity.email || (identity.user_metadata || {}).email || '').trim().toLowerCase();
    const userId = String(identity.id || identity.sub || identity.uid || '').trim();
    if (!email || !userId) return { ok: false, code: 'invalid' };
    return { ok: true, email, userId };
  } catch {
    // Never log or return the bearer token, provider response body, or config key.
    return { ok: false, code: 'unavailable' };
  }
}

function revokeSession(db, req) {
  const token = tokenFromRequest(req);
  if (!token) return;
  const hash = hashToken(token);
  db.sessions = (db.sessions || []).filter((s) => s.tokenHash !== hash);
}

/* ---------- 对外状态（脱敏） ---------- */

const pickFields = (row, fields) => Object.fromEntries(
  fields.filter((field) => Object.prototype.hasOwnProperty.call(row || {}, field))
    .map((field) => [field, row[field]])
);

function sanitizePublicEvent(payload, db) {
  const type = String((payload || {}).type || '');
  const meta = (payload || {}).meta && typeof payload.meta === 'object' ? payload.meta : {};
  if (type === 'resource_landing_view') {
    const resourceId = String(meta.resourceId || '').slice(0, 120);
    if (!(db.resources || []).some((resource) => resource.id === resourceId)) return null;
    return { type, meta: { resourceId } };
  }
  if (type === 'invite_landing_view') {
    const circleId = String(meta.circleId || '').slice(0, 120);
    const code = String(meta.code || '').slice(0, 120);
    const validInvite = (db.circles || []).some((circle) => circle.id === circleId && circle.inviteCode === code)
      || (db.circleInviteAliases || []).some((alias) => alias.circleId === circleId && alias.code === code);
    if (!validInvite) return null;
    return { type, meta: { circleId, code } };
  }
  return null;
}

export function publicState(db, meId) {
  const me = meId ? db.users.find((u) => u.id === meId) : null;
  const isAdmin = me && me.role === 'admin';
  const circles = db.circles || [];
  const canonicalIds = canonicalCircleIds(circles);
  const wallets = {};
  if (meId && db.wallets && db.wallets[meId]) wallets[meId] = db.wallets[meId];

  const posts = (db.posts || []).filter((post) => isAdmin || post.status === 'published');
  const postIds = new Set(posts.map((post) => post.id));
  const comments = (db.comments || []).filter((comment) => postIds.has(comment.postId)
    && (isAdmin || !comment.status || comment.status === 'visible'));
  const attachments = (db.attachments || []).filter((attachment) => postIds.has(attachment.postId))
    .map((attachment) => ({
      ...pickFields(attachment, [
        'id', 'postId', 'kind', 'name', 'sizeBytes', 'pages', 'version', 'status', 'changeNote', 'demo'
      ]),
      // File paths can contain private storage keys. The client only needs a
      // truthy marker for ready-file eligibility; downloads resolve by ID on the server.
      path: isSupportedDemoAttachmentPath(attachment.path) ? 'available' : null
    }));
  const resources = (db.resources || []).filter((resource) => postIds.has(resource.postId)
    && (resource.indexEnabled !== false || (posts.find((post) => post.id === resource.postId) || {}).authorId === meId));
  const activeOtherMemberships = (db.memberships || [])
    .filter((row) => row.userId === meId || row.status === 'active')
    .map((row) => row.userId === meId
      ? pickFields(row, ['userId', 'circleId', 'status', 'muted', 'shelved', 'joinedAt', 'lastSeenAt', 'writeRestricted'])
      : { circleId: row.circleId, status: 'active' });
  const reactions = (db.reactions || []).filter((row) => postIds.has(row.postId)).map((row) => ({
    postId: row.postId,
    kind: row.kind,
    createdAt: row.createdAt,
    ...(row.userId === meId ? { userId: row.userId } : {})
  }));
  const follows = (db.follows || []).map((row) => ({
    targetType: row.targetType,
    targetId: row.targetId,
    createdAt: row.createdAt,
    ...(row.followerId === meId ? { followerId: row.followerId } : {})
  }));
  const visibleGifts = (db.gifts || []).filter((gift) => gift.senderId === meId
    || (gift.status === 'active' && postIds.has(gift.postId)));
  const anonymousGifters = new Map();
  const gifts = visibleGifts.map((gift) => {
    if (gift.senderId === meId) return { ...gift };
    const key = `${gift.postId}:${gift.senderId}`;
    if (!anonymousGifters.has(key)) anonymousGifters.set(key, `anon_gifter_${anonymousGifters.size + 1}`);
    return {
      postId: gift.postId,
      receiverId: gift.receiverId,
      qty: gift.qty,
      status: gift.status,
      day: gift.day,
      senderId: anonymousGifters.get(key)
    };
  });
  const xpTotals = new Map();
  for (const row of db.xp || []) {
    if (row.userId === meId) continue;
    xpTotals.set(row.userId, (xpTotals.get(row.userId) || 0) + (Number(row.delta) || 0));
  }
  const xp = [
    ...[...xpTotals].map(([userId, delta]) => ({ userId, delta })),
    ...(db.xp || []).filter((row) => row.userId === meId)
  ];

  return {
    // Explicit projection: new/private database fields stay private by default.
    session: meId ? { userId: meId } : null,
    users: (db.users || []).map((user) => ({
      ...pickFields(user, ['id', 'nickname', 'avatar', 'bio', 'role', 'status', 'joinedAt']),
      email: user.id === meId ? user.email : '',
      verified: user.id === meId && user.verified === true
    })),
    courses: (db.courses || []).map((course) => pickFields(course, ['id', 'school', 'name', 'code', 'category'])),
    circles: (db.circles || []).map((circle) => pickFields(circle, [
      'id', 'courseId', 'status', 'createdBy', 'inviteCode', 'createdAt', 'pinnedPostId'
    ])),
    circleInviteAliases: (db.circleInviteAliases || [])
      .filter((alias) => {
        if (!alias || typeof alias.code !== 'string' || !alias.code || typeof alias.circleId !== 'string') return false;
        const target = circles.find((circle) => circle.id === alias.circleId);
        return Boolean(target && canonicalIds.get(target.courseId) === target.id);
      })
      .map((alias) => pickFields(alias, ['code', 'circleId'])),
    memberships: activeOtherMemberships,
    posts: posts.map((post) => pickFields(post, [
      'id', 'authorId', 'board', 'circleId', 'courseId', 'title', 'body', 'stickerId', 'images',
      'attachmentIds', 'tags', 'status', 'publishedAt', 'editedAt', 'acceptedCommentId',
      'contentUpdatedAt', 'createdAt', 'daily', 'minChars', ...(isAdmin ? ['moderateReason'] : [])
    ])),
    attachments,
    resources: resources.map((resource) => pickFields(resource, [
      'id', 'postId', 'title', 'courseId', 'school', 'term', 'type', 'coverage', 'limitations',
      'indexEnabled', 'status', 'updatedAt', 'previews'
    ])),
    comments: comments.map((comment) => pickFields(comment, [
      'id', 'postId', 'authorId', 'parentId', 'replyToUserId', 'body', 'stickerId', 'status', 'createdAt', 'editedAt'
    ])),
    reactions,
    follows,
    courseCollections: (db.courseCollections || []).filter((row) => postIds.has(row.postId))
      .map((row) => pickFields(row, ['postId', 'courseId', 'authorId', 'createdAt', 'note'])),
    wallets,
    ledger: (db.ledger || []).filter((row) => row.userId === meId),
    claims: (db.claims || []).filter((row) => row.userId === meId),
    gifts,
    xp,
    growthDecisions: (db.growthDecisions || []).filter((row) => row.userId === meId),
    notifications: (db.notifications || []).filter((row) => row.userId === meId),
    directMessages: meId
      ? (db.directMessages || [])
        .filter((row) => row.senderId === meId || row.recipientId === meId)
        .map((row) => pickFields(row, ['id', 'senderId', 'recipientId', 'body', 'createdAt', 'readAt']))
      : [],
    reports: isAdmin ? db.reports || [] : [],
    audit: isAdmin ? db.audit || [] : [],
    applications: isAdmin ? db.applications || [] : [],
    events: isAdmin ? db.events || [] : [],
    inviteVisits: isAdmin ? db.inviteVisits || [] : [],
    prefs: meId ? { [meId]: (db.prefs && db.prefs[meId]) || {} } : {},
    drafts: meId && db.drafts && db.drafts[meId] ? { [meId]: db.drafts[meId] } : {}
  };
}

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

function isPrivateStaticPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return true;
  }
  const segments = path.posix.normalize(decoded).split('/').filter(Boolean);
  return segments.some((segment) => segment.toLowerCase() === 'server' || segment.startsWith('.'));
}

async function resolveStatic(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (isPrivateStaticPath(decoded)) return null;
  const target = path.resolve(APP_ROOT, `.${path.posix.normalize(decoded)}`);
  if (target !== APP_ROOT && !target.startsWith(APP_ROOT + path.sep)) return null;
  try {
    const realTarget = await fsp.realpath(target);
    if (realTarget !== APP_ROOT_REAL && !realTarget.startsWith(APP_ROOT_REAL + path.sep)) return null;
    const stat = await fsp.stat(realTarget);
    if (stat.isFile()) return realTarget;
    if (stat.isDirectory()) {
      const index = path.join(realTarget, 'index.html');
      const realIndex = await fsp.realpath(index).catch(() => null);
      if (!realIndex || (realIndex !== APP_ROOT_REAL && !realIndex.startsWith(APP_ROOT_REAL + path.sep))) return null;
      const indexStat = await fsp.stat(realIndex).catch(() => null);
      if (indexStat && indexStat.isFile()) return realIndex;
    }
  } catch {
    return null;
  }
  return null;
}

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
  /* 云端登录（WorkBuddy 云服务邮箱验证码）
   * requireCloudAuth=true 时，固定验证码 123456 的入口关闭，只能走 cloudSignIn；
   * 前端已在云服务验过邮箱，这里只负责：白名单域名校验 + 账号落到本地 users 表 + 签发会话。 */
  const requireCloudAuth = options.requireCloudAuth === undefined
    ? String(process.env.REQUIRE_CLOUD_AUTH || '') === '1'
    : !!options.requireCloudAuth;
  const cloudConfig = options.cloud && options.cloud.endpoint ? options.cloud : null;
  const adminEmails = new Set(
    [adminEmail, ...(Array.isArray(options.adminEmails) ? options.adminEmails : [])]
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const notice = options.notice || (requireCloudAuth
    ? '内测：仅白名单邮箱可注册；已发布内容公开可浏览；请勿上传隐私或整本教材。'
    : '仅名单内邮箱可注册；已发布内容公开可浏览；数据可能清空，请勿上传隐私或整本教材。');

  // Cross-origin access requires an explicit exact-origin allowlist. With no
  // list, browser requests are limited to the request's same origin.
  const rawOrigins = options.allowedOrigins !== undefined
    ? options.allowedOrigins
    : String(process.env.ALLOWED_ORIGINS || '').split(',');
  const configuredOriginValues = (Array.isArray(rawOrigins) ? rawOrigins : String(rawOrigins).split(','))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const allowedOrigins = new Set(configuredOriginValues.map(normalizeOrigin).filter(Boolean));
  const hasWildcardOrigin = configuredOriginValues.includes('*');
  const originAllowed = (origin, req) => {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) return false;
    const sameOrigin = normalizedOrigin === requestOrigin(req);
    return sameOrigin || allowedOrigins.has(normalizedOrigin);
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

  const server = http.createServer(async (req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    const origin = req.headers.origin;
    const ip = req.socket.remoteAddress || 'unknown';

    /* ---- 跨域头：允许静态站（不同域名）调用接口 ---- */
    if (origin && originAllowed(origin, req)) {
      res.setHeader('Access-Control-Allow-Origin', normalizeOrigin(origin));
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (req.method === 'OPTIONS') {
      if (origin && originAllowed(origin, req)) {
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
        if (origin && !originAllowed(origin, req)) {
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

        if (name === 'createPost') {
          const attachmentError = validatePilotCreatePostAttachments(payload);
          if (attachmentError) {
            sendJson(res, 400, { error: { code: 'bad_attachment', message: attachmentError } });
            return;
          }
        }

        let cloudIdentity = null;
        if (name === 'cloudSignIn') {
          if (!requireCloudAuth) {
            sendJson(res, 403, { error: { code: 'disabled', message: '当前部署没有启用云端登录' } });
            return;
          }
          cloudIdentity = await verifyCloudAccessToken(cloudConfig, payload.cloudAccessToken);
          if (!cloudIdentity.ok) {
            const unavailable = cloudIdentity.code === 'unavailable';
            sendJson(res, unavailable ? 502 : 401, {
              error: {
                code: unavailable ? 'cloud_auth_unavailable' : 'cloud_auth_invalid',
                message: unavailable ? '云端邮箱验证暂不可用，请稍后重试' : '云端邮箱验证已失效，请重新获取验证码'
              }
            });
            return;
          }
          const requestedEmail = String(payload.email || '').trim().toLowerCase();
          if (!requestedEmail || requestedEmail !== cloudIdentity.email) {
            sendJson(res, 401, {
              error: { code: 'cloud_identity_mismatch', message: '云端验证身份与登录邮箱不一致，请重新登录' }
            });
            return;
          }
          if (!allowlist.allowed(cloudIdentity.email)) {
            sendJson(res, 403, {
              error: {
                code: 'not_allowed',
                message: '只允许白名单邮箱注册，请联系管理员'
              }
            });
            return;
          }
        }

        const me = userFromRequest(db, req);
        if (!me && !PUBLIC_ACTIONS.has(name)) {
          sendJson(res, 401, { error: { code: 'login', message: '请先登录' } });
          return;
        }
        if (name === 'sendDirectMessage' && me
          && !allowRequest(`direct-message:${me.id}`, 30, 60_000)) {
          sendJson(res, 429, { error: { code: 'rate_limited', message: '私信发送太频繁，请稍后再试' } });
          return;
        }
        db.session = me ? { userId: me.id } : null;

        let result;
        let setCookie = null;
        let actionPayload = payload;

        if (name === 'quickLogin') {
          db.session = null;
          sendJson(res, 403, { error: { code: 'disabled', message: '试用版已关闭演示账号切换' } });
          return;
        }

        /* 开了云端登录后，固定验证码入口彻底关闭（前端不再调用，接口也不放行） */
        if (requireCloudAuth && (name === 'requestCode' || name === 'verifyCode')) {
          db.session = null;
          sendJson(res, 403, {
            error: { code: 'cloud_auth_required', message: '登录方式已改为邮箱验证码，请刷新页面重试' }
          });
          return;
        }

        if (name === 'cloudSignIn') {
          const email = cloudIdentity.email;
          // The provider's user/me endpoint verified this email server-side.
          result = A.verifyCode(db, { email, code: A.DEMO_CODE });
          if (result.ok) {
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
                message: `已登录：${user.nickname}`,
                data: { user: { id: user.id, nickname: user.nickname, role: user.role }, token }
              };
            }
          }
          db.session = null;
          await store.save();
          sendJson(res, 200, {
            result,
            state: publicState(db, result && result.ok && result.data && result.data.user ? result.data.user.id : null)
          }, setCookie ? { 'set-cookie': setCookie } : {});
          return;
        }

        if (name === 'recordEvent') {
          actionPayload = sanitizePublicEvent(payload, db);
          if (!actionPayload) {
            db.session = null;
            sendJson(res, 400, { error: { code: 'bad_event', message: '无效的浏览事件' } });
            return;
          }
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
          result = A[name](db, actionPayload);
        }

        if (name === 'downloadResource' && result && result.ok
          && !isSupportedDemoAttachmentPath(result.data && result.data.path)) {
          result = { ok: false, code: 'not_ready', message: '当前试用版不支持下载此文件' };
        }

        db.session = null;
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
          authMode: requireCloudAuth ? 'cloud' : 'demo-code',
          cloud: cloudConfig
        }));
        return;
      }

      /* ---- 静态文件 ---- */
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: { code: 'method', message: '不支持的方法' } });
        return;
      }

      if (isPrivateStaticPath(urlPath)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end('404 Not Found');
        return;
      }

      let file = await resolveStatic(urlPath);
      if (!file && !path.extname(urlPath)) file = path.join(APP_ROOT, 'index.html');
      if (!file) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(file).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const data = await fsp.readFile(file);
      /* HTML/JS/CSS 一律 no-store：之前只给 no-cache 又没带 ETag，
       * 开着旧标签页或经过代理的访客会一直跑旧模块（登录页还是固定码那版）。
       * 只有图片/字体这类不会改的静态资源才允许缓存。 */
      const cacheable = /\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf)$/i.test(ext);
      /* 注意：writeHead 里不能出现值为 undefined 的头，否则 Node 直接抛
       * ERR_HTTP_INVALID_HEADER_VALUE → 图片全变 500。所以按需拼装。 */
      const headers = {
        'content-type': type,
        'cache-control': cacheable ? 'public, max-age=3600' : 'no-store, no-cache, must-revalidate',
        'x-content-type-options': 'nosniff'
      };
      if (!cacheable) {
        headers.pragma = 'no-cache';
        headers.expires = '0';
      }
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      console.error('[pilot] 请求失败', urlPath, error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: { code: 'server_error', message: '服务器出错了' } });
      } else {
        res.end();
      }
    }
  });

  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return {
    server,
    db,
    store,
    allowlist,
    corsPolicy: { allowedOrigins: [...allowedOrigins], wildcardIgnored: hasWildcardOrigin },
    loginMode: requireCloudAuth ? 'cloud' : 'demo-code',
    listen(port = 8787, host = '127.0.0.1') {
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve(server.address()));
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
