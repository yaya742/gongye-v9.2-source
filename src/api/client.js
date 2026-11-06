/* 生产请求只走同源 HttpOnly Cookie；旧 token 仅供显式 pilot 模式兼容。 */
const config = (typeof window !== 'undefined' && window.__GONGYE_CONFIG__) || {};
const legacyPilot = config.mode === 'pilot';
const BASE = legacyPilot ? String(config.apiBase || '').replace(/\/$/, '') : '';
const TOKEN_KEY = 'gongye-pilot-token';

export const auth = {
  get() {
    if (!legacyPilot) return '';
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  },
  set(token) {
    if (!legacyPilot) return;
    try { if (token) localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
  },
  clear() {
    if (!legacyPilot) return;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }
};

async function request(pathname, options = {}) {
  const token = auth.get();
  const response = await fetch(`${BASE}${pathname}`, {
    credentials: legacyPilot ? 'include' : 'same-origin',
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
    const detail = data && data.error;
    const error = new Error((detail && detail.message) || (data && data.message) || (typeof detail === 'string' ? detail : '') || `请求失败（${response.status}）`);
    error.code = (detail && detail.code) || (data && data.code) || 'http_error';
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
  async uploadFile(file) {
    const data = await request('/api/files', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'X-File-Name': encodeURIComponent(file.name) },
      body: file
    });
    const attachment = data && data.attachment;
    if (!attachment || !attachment.uploadId || attachment.status !== 'ready') {
      const error = new Error('文件尚未通过服务器检查，未添加附件，请稍后重试。');
      error.code = 'upload_not_ready';
      throw error;
    }
    return { attachment };
  },
  health() {
    return request('/api/health');
  }
};
