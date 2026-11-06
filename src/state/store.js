/* 演示数据仓库：把状态放进浏览器存储，并通知订阅者重绘。
 *
 * 这不是生产后端。demo-static 模式没有服务器，所有写入只发生在本机浏览器，
 * 因此不能代表真实权限、真实文件访问控制或真实页签账务。
 * 生产替换方式见 README「接入真实后端」。
 */

import { createSeed } from '../data/seed.js';
import { DEMO_STORAGE_FALLBACK } from '../lib/format.js';

export const STORE_VERSION = 8;

function safeStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__gongye_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export function createStore(options = {}) {
  const key = options.key || DEMO_STORAGE_FALLBACK;
  const storage = options.storage === undefined ? safeStorage() : options.storage;
  const now = options.now || (() => Date.now());
  const listeners = new Set();
  let memoryOnly = !storage;

  let state = null;
  if (storage) {
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === STORE_VERSION && Array.isArray(parsed.posts)) {
          state = parsed;
        }
      }
    } catch {
      state = null;
    }
  }
  if (!state) state = createSeed(now());
  state.version = STORE_VERSION;

  function persist() {
    if (!storage) {
      memoryOnly = true;
      return { ok: false, code: 'no_storage' };
    }
    try {
      storage.setItem(key, JSON.stringify(state));
      return { ok: true };
    } catch {
      memoryOnly = true;
      return { ok: false, code: 'quota' };
    }
  }

  function notify(meta) {
    listeners.forEach((fn) => {
      try {
        fn(state, meta);
      } catch (error) {
        // 订阅者异常不应破坏其他渲染
        // eslint-disable-next-line no-console
        console.error('[store] listener failed', error);
      }
    });
  }

  return {
    key,
    getState() {
      return state;
    },
    isMemoryOnly() {
      return memoryOnly;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** 修改状态并持久化；fn 直接修改传入的 state 对象 */
    commit(fn, meta = {}) {
      const result = fn(state);
      const saved = persist();
      notify({ saved, ...meta });
      return result;
    },
    reset() {
      state = createSeed(now());
      persist();
      notify({ reset: true });
      return state;
    },
    exportJSON() {
      return JSON.stringify(state, null, 2);
    }
  };
}

/* 试用版（生产模式）使用：状态由后端返回，所有写入都走后端动作。
 * 接口与本地 store 保持一致（getState / subscribe / setState），
 * 但不提供 commit —— 前端不允许直接改数据。 */
export function createRemoteStore() {
  let state = null;
  const listeners = new Set();
  return {
    key: 'remote',
    remote: true,
    getState() {
      return state;
    },
    setState(next) {
      state = next;
      listeners.forEach((fn) => {
        try {
          fn(state, { remote: true });
        } catch (error) {
          console.error('[remote store] listener failed', error);
        }
      });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    commit() {
      throw new Error('试用版不允许在浏览器本地写入数据');
    },
    isMemoryOnly() {
      return false;
    },
    reset() {
      throw new Error('试用版不支持重置，请管理员清空服务端数据');
    }
  };
}





