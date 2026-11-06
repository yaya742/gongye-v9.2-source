/* 云服务邮箱验证码（浙江大学内测专用）
 *
 * 只在 authMode === 'cloud' 时使用：
 *   1) sendCode(email)  → cloud.auth.signInWithOtp，平台把 6 位码发到邮箱
 *   2) verifyCode(code) → started.data.verify({ token })，拿到云端会话，证明这个邮箱是本人的
 *   3) 调用后端 cloudSignIn 换取本站会话（后端再校验一次 @zju.edu.cn）
 *
 * 云端会话只用来证明"邮箱所有权"，不参与业务数据；业务仍然走 /api/*。
 */

const ZJU_PATTERN = /@zju\.edu\.cn$/i;

let sdkPromise = null;
let client = null;
let pending = null;

function config() {
  const all = (typeof window !== 'undefined' && window.__GONGYE_CONFIG__) || {};
  return all.cloud || null;
}

export function zjuEmail(email) {
  return ZJU_PATTERN.test(String(email || '').trim());
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

/** 发码：只允许浙大邮箱，前端先挡一道（后端还会再挡一次） */
export async function sendCode(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value.includes('@')) return { ok: false, message: '请填写邮箱' };
  if (!zjuEmail(value)) return { ok: false, message: '只支持浙江大学邮箱（@zju.edu.cn）' };

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
    const verified = { email: String(email).trim().toLowerCase(), userId: done.data && done.data.user && done.data.user.id };
    pending = null;
    return { ok: true, email: verified.email, cloudUserId: verified.userId };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : '验证失败' };
  }
}

export function pendingEmail() {
  return pending ? pending.email : '';
}
