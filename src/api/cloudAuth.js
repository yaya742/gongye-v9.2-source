/* 云服务邮箱验证码（校园邮箱内测）
 *
 * 只在 authMode === 'cloud' 时使用：
 *   1) sendCode(email)  → cloud.auth.signInWithOtp，平台把 6 位码发到邮箱
 *   2) verifyCode(code) → started.data.verify({ token })，拿到云端会话，证明这个邮箱是本人的
 *   3) 调用后端 cloudSignIn 换取本站会话（后端再校验一次白名单）
 *
 * 云端会话只用来证明"邮箱所有权"，不参与业务数据；业务仍然走 /api/*。
 */

let sdkPromise = null;
let client = null;
let pending = null;

function config() {
  const all = (typeof window !== 'undefined' && window.__GONGYE_CONFIG__) || {};
  return all.cloud || null;
}

/* 允许的邮箱域名：在 window.__GONGYE_CONFIG__.cloud.emailDomains 里配置数组；
 * 不配置（或空数组）表示不限制域名，仍以邮箱验证码证明邮箱归属。 */
function allowedDomains() {
  const conf = config();
  const list = conf && Array.isArray(conf.emailDomains) ? conf.emailDomains : [];
  return list.map((item) => String(item || '').trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}

export function allowedEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return false;
  const domains = allowedDomains();
  if (!domains.length) return true;
  return domains.some((domain) => value.endsWith(`@${domain}`));
}

function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.WorkBuddyCloud) {
      resolve(window.WorkBuddyCloud);
      return;
    }
    const script = document.createElement('script');
    script.src = '/assets/vendor/wb-cloud-sdk.global.js';
    script.async = true;
    script.onload = () => {
      if (window.WorkBuddyCloud) resolve(window.WorkBuddyCloud);
      else reject(new Error('云服务脚本加载了，但没有初始化'));
    };
    script.onerror = () => reject(new Error('云服务脚本加载失败，请检查网络后刷新'));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

async function getClient() {
  if (client) return client;
  const conf = config();
  if (!conf || !conf.endpoint || !conf.publishableKey) throw new Error('站点没有配置云服务');
  const sdk = await loadSdk();
  client = sdk.createWorkBuddyCloud({ endpoint: conf.endpoint, publishableKey: conf.publishableKey });
  return client;
}

/** 发码：只允许配置的邮箱域名，前端先挡一道（后端还会再挡一次） */
export async function sendCode(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value.includes('@')) return { ok: false, message: '请填写邮箱' };
  if (!allowedEmail(value)) {
    const domains = allowedDomains();
    return { ok: false, message: domains.length ? `只支持 ${domains.map((d) => '@' + d).join('、')} 邮箱` : '请填写有效邮箱' };
  }

  try {
    const cloud = await getClient();
    const started = await cloud.auth.signInWithOtp({ email: value });
    if (started.error) {
      return { ok: false, message: started.error.message || '验证码发送失败' };
    }
    if (!started.data || typeof started.data.verify !== 'function') {
      return { ok: false, message: '验证码通道返回异常，请刷新重试' };
    }
    pending = { email: value, verify: started.data.verify };
    return { ok: true, email: value, message: `验证码已发到 ${value}，10 分钟内有效` };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : '验证码发送失败' };
  }
}

/** 验码：成功后返回云端确认过的邮箱，交给后端换会话 */
export async function verifyCode(code) {
  if (!pending) return { ok: false, message: '请先发送验证码' };
  const token = String(code || '').trim();
  if (!/^\d{4,8}$/.test(token)) return { ok: false, message: '请输入收到的验证码' };

  try {
    const done = await pending.verify({ token });
    if (done.error) {
      return { ok: false, message: done.error.message || '验证码不正确或已过期' };
    }
    const email = (done.data && done.data.user && done.data.user.email) || pending.email;
    const accessToken = String((done.data && done.data.accessToken) || '').trim();
    if (!accessToken) {
      pending = null;
      return { ok: false, message: '云端验证没有返回有效会话，请重新获取验证码' };
    }
    const verified = {
      email: String(email).trim().toLowerCase(),
      userId: done.data && done.data.user && done.data.user.id,
      // Only used once to prove identity to the site backend; never stored by the site client.
      accessToken
    };
    pending = null;
    return {
      ok: true,
      email: verified.email,
      cloudUserId: verified.userId,
      accessToken: verified.accessToken
    };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : '验证失败' };
  }
}

export function pendingEmail() {
  return pending ? pending.email : '';
}
