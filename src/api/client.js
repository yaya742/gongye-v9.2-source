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

/* 文件上传与下载：上传用 XHR 以拿到进度；下载用 fetch，跨域部署时同样能带上令牌 */
function authHeaders() {
  const token = auth.get();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function readError(response) {
  const data = await response.json().catch(() => null);
  return new Error((data && data.error && data.error.message) || `请求失败（${response.status}）`);
}

export const files = {
  upload(file, kind, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/api/files?kind=${kind}`);
      xhr.withCredentials = true;
      xhr.timeout = 10 * 60 * 1000;
      xhr.setRequestHeader('x-requested-with', 'gongye');
      xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name || ''));
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
      Object.entries(authHeaders()).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      if (onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress(event.loaded / event.total);
        };
      }
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
        // 两套后端响应格式：试用后端 { file }，生产后端 { attachment, previews }；这里统一成 file
        const payload = data && (data.file || data.attachment);
        if (xhr.status >= 200 && xhr.status < 300 && payload) {
          resolve({
            raw: data,
            file: {
              id: payload.uploadId || payload.id,
              name: payload.name,
              sizeBytes: payload.sizeBytes,
              pages: payload.pages || null,
              previewCount: payload.previewCount || (Array.isArray(data.previews) ? data.previews.length : 0),
              status: payload.status || 'ready'
            }
          });
        } else reject(new Error((data && data.error && data.error.message) || `上传失败（${xhr.status}）`));
      };
      xhr.onerror = () => reject(new Error('网络中断，上传没有完成'));
      xhr.ontimeout = () => reject(new Error('上传超时，请检查网络后重试'));
      xhr.send(file);
    });
  },
  async download(path, filename) {
    const response = await fetch(`${BASE}${path}`, { credentials: 'include', headers: authHeaders() });
    if (!response.ok) throw await readError(response);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
};

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
