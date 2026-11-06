import crypto from 'node:crypto';

export const COOKIE_NAME = 'gy_sid';
const TTL = 10 * 60_000;
const SESSION_MS = 7 * 86400_000;
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const error = (status, code, message) => Object.assign(new Error(message), { status, code });
export const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

export function configuredDomains(value = process.env.ZJU_EMAIL_DOMAINS || 'zju.edu.cn,st.zju.edu.cn') {
  const input = value instanceof Set ? [...value] : Array.isArray(value) ? value : String(value).split(',');
  const domains = [...new Set(input.map((x) => String(x).trim().toLowerCase()))];
  if (!domains.length || domains.some((x) => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(x))) {
    throw new Error('invalid_ZJU_EMAIL_DOMAINS');
  }
  return domains;
}

export async function createAuthentication(options = {}) {
  const domains = configuredDomains(options.allowedDomains);
  const domainSet = new Set(domains);
  const adminEmails = new Set((Array.isArray(options.adminEmails) ? options.adminEmails :
    String(process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '').split(',')).map(normalizeEmail).filter(Boolean));
  const now = options.now || Date.now;
  const secret = crypto.randomBytes(32); // OTPs and HMAC key are memory-only: restart invalidates every code.
  const codes = new Map();
  const buckets = new Map();
  let sendMail = typeof options.sendMail === 'function' ? options.sendMail : null;
  let configurationIssue = '';
  if (!sendMail) {
    const env = options.env || process.env;
    const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];
    if (keys.some((key) => !String(env[key] || '').trim())) configurationIssue = 'SMTP 配置不完整';
    else if (!/^\d+$/.test(env.SMTP_PORT) || Number(env.SMTP_PORT) < 1 || Number(env.SMTP_PORT) > 65535 || !['true', 'false', '1', '0'].includes(env.SMTP_SECURE)) configurationIssue = 'SMTP 端口或加密配置无效';
    else {
      try {
        const imported = await import('nodemailer');
        const secure = ['true', '1'].includes(env.SMTP_SECURE);
        const transport = (imported.default || imported).createTransport({
          host: env.SMTP_HOST, port: Number(env.SMTP_PORT), secure, requireTLS: !secure,
          auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
          connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
          tls: { rejectUnauthorized: true }
        });
        sendMail = async ({ email, code }) => transport.sendMail({
          from: env.MAIL_FROM, to: email, subject: '共页 · 邮箱登录验证码',
          text: `你的共页验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略此邮件。`
        });
      } catch { configurationIssue = '邮件模块不可用，请安装并配置 nodemailer'; }
    }
  }

  function validateEmail(input) {
    const email = normalizeEmail(input);
    if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(email)) throw error(400, 'bad_email', '邮箱格式不正确');
    if (!domainSet.has(email.split('@')[1])) throw error(403, 'not_allowed', `仅支持配置的邮箱域名：${domains.join('、')}`);
    return email;
  }
  function allow(key, limit, windowMs) {
    const stamp = now();
    if (buckets.size > 10000) for (const [k, b] of buckets) if (b.until <= stamp) buckets.delete(k);
    if (!buckets.has(key) && buckets.size >= 20000) return false;
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= stamp) { bucket = { count: 0, until: stamp + windowMs }; buckets.set(key, bucket); }
    return ++bucket.count <= limit;
  }
  function checkLimits(kind, email, ip) {
    const ipOk = allow(`${kind}:ip:${ip}`, kind === 'send' ? 20 : 50, 10 * 60_000);
    const emailOk = allow(`${kind}:mail:${email}`, kind === 'send' ? 5 : 30, 60 * 60_000);
    if (!ipOk || !emailOk) throw error(429, 'rate_limited', '尝试过于频繁，请稍后再试');
  }
  const codeHash = (email, code) => crypto.createHmac('sha256', secret).update(`${email}\0${code}`).digest();
  function ready() { if (!sendMail) throw error(503, 'auth_unavailable', '邮箱登录尚未配置，请联系站点管理员'); }
  function activeUser(db, email) {
    const user = db.users.find((u) => u.email === email);
    if (user && user.status !== 'active') throw error(403, 'suspended', '账号已停用');
    return user;
  }
  async function requestCode(db, input, ip) {
    ready();
    const email = validateEmail(input.email);
    activeUser(db, email);
    checkLimits('send', email, ip);
    const stamp = now();
    const previous = codes.get(email);
    if (previous && stamp - previous.sentAt < 60_000) throw error(429, 'cooldown', '请等待 60 秒后再获取验证码');
    for (const [key, row] of codes) if (row.expiresAt <= stamp && stamp - row.sentAt >= 60_000) codes.delete(key);
    if (codes.size >= 10000 && !codes.has(email)) throw error(429, 'rate_limited', '服务繁忙，请稍后再试');
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const row = { hash: codeHash(email, code), attempts: 0, sentAt: stamp, expiresAt: stamp + TTL, consumed: false };
    codes.set(email, row);
    try { await sendMail({ email, code }); }
    catch { row.consumed = true; throw error(503, 'mail_unavailable', '验证码发送失败，请稍后重试'); }
    return { ok: true, message: '验证码已发送，10 分钟内有效', data: { email, expiresIn: 600, retryAfter: 60 } };
  }
  function verifyCode(db, input, ip) {
    ready();
    const email = validateEmail(input.email);
    checkLimits('verify', email, ip);
    const row = codes.get(email);
    if (!row || row.consumed || row.expiresAt <= now() || row.attempts >= 5) throw error(400, 'bad_code', '验证码无效或已过期，请重新获取');
    const candidate = codeHash(email, String(input.code || '').trim());
    row.attempts += 1;
    if (!/^\d{6}$/.test(String(input.code || '').trim()) || !crypto.timingSafeEqual(candidate, row.hash)) {
      if (row.attempts >= 5) row.consumed = true;
      throw error(400, 'bad_code', '验证码无效或已过期，请重新获取');
    }
    row.consumed = true;
    let user = activeUser(db, email);
    if (!user) {
      user = { id: `u_${crypto.randomUUID()}`, email,
        nickname: (email.split('@')[0].replace(/[^a-z0-9_]/g, '') || '同学').slice(0, 12),
        avatar: 'art/avatar-01.svg', bio: '', status: 'active', verified: true,
        joinedAt: new Date(now()).toISOString(), role: 'user' };
      db.users.push(user);
    }
    user.verified = true;
    user.role = adminEmails.has(email) ? 'admin' : 'user';
    return user;
  }
  function token(req) {
    const raw = String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(`${COOKIE_NAME}=`));
    if (!raw) return null;
    const value = raw.slice(COOKIE_NAME.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  function userFromRequest(db, req) {
    const value = token(req);
    if (!value) return null;
    const session = db.sessions.find((s) => s.tokenHash === digest(value) && s.expiresAt > now());
    const user = session && db.users.find((u) => u.id === session.userId);
    return user && user.status === 'active' && user.verified === true ? user : null;
  }
  function revoke(db, req) {
    const value = token(req);
    if (value) db.sessions = db.sessions.filter((s) => s.tokenHash !== digest(value));
  }
  function issue(db, user, req) {
    revoke(db, req); // Rotate an existing browser session on login.
    const value = crypto.randomBytes(32).toString('base64url');
    db.sessions = db.sessions.filter((s) => s.expiresAt > now());
    const own = db.sessions.filter((s) => s.userId === user.id);
    if (own.length >= 10) {
      const remove = new Set(own.slice(0, own.length - 9).map((s) => s.id));
      db.sessions = db.sessions.filter((s) => !remove.has(s.id));
    }
    db.sessions.push({ id: crypto.randomUUID(), userId: user.id, tokenHash: digest(value), createdAt: now(), expiresAt: now() + SESSION_MS });
    return value;
  }
  return { domains, adminEmails, authReady: !!sendMail, configurationIssue, requestCode, verifyCode,
    userFromRequest, issue, revoke, allow };
}

export function sessionCookie(value, secure) {
  return `${COOKIE_NAME}=${value || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? SESSION_MS / 1000 : 0}${secure ? '; Secure' : ''}`;
}
