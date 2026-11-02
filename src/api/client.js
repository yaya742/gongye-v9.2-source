/* 后端 API 客户端（内部试用模式）
 * 只在 config.mode === 'production' 时使用；demo-static 模式不请求网络。
 */

const config = (typeof window !== 'undefined' && window.__GONGYE_CONFIG__) || {};
const BASE = String(config.apiBase || '').replace(/\/$/, '');
const TOKEN_KEY = 'gongye-pilot-token';

/* 跨域名部署时，浏览器默认不带第三方的 SameSite Cookie。
 * 登录接口会同时返回一个 token，这里存下来并以 Authorization 头发送；
 * 同域名部署时 token 也可用，只是 Cookie 已经够了。 */
export const auth = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  },
  set(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* 隐私模式下写入失败时保持未登录即可 */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }
};

async function request(pathname, options = {}) {
  const token = auth.get();
  const response = await fetch(`${BASE}${pathname}`, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'gongye',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error((data && data.error && data.error.message) || `请求失败（${response.status}）`);
    error.code = data && data.error ? data.error.code : 'http_error';
    error.status = response.status;
    throw error;
  }
  return data;
}

export const api = {
  getState() {
    return request('/api/state');
  },
  action(name, payload = {}) {
    return request('/api/action', {
      method: 'POST',
      body: JSON.stringify({ name, payload })
    });
  },
  health() {
    return request('/api/health');
  }
};
