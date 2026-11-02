/* 演示数据仓库：把状态放进浏览器存储，并通知订阅者重绘。
 *
 * 这不是生产后端。demo-static 模式没有服务器，所有写入只发生在本机浏览器，
 * 因此不能代表真实权限、真实文件访问控制或真实页签账务。
 * 生产替换方式见 README「接入真实后端」。
 */

import { createSeed } from '../data/seed.js';
import { removeKnownDemoPosts } from '../data/demo-post-cleanup.js';
import { DEMO_STORAGE_FALLBACK } from '../lib/format.js';

export const STORE_VERSION = 11;

const MIGRATABLE_STORE_VERSIONS = new Set([STORE_VERSION - 2, STORE_VERSION - 1, STORE_VERSION]);
const PREFERRED_CIRCLE_IDS = Object.freeze({
  c_calc: 'ci_calc_a',
  c_la: 'ci_la_a',
  c_py: 'ci_py_b',
  c_ds: 'ci_ds_a',
  c_prob: 'ci_prob',
  c_phys: 'ci_phys'
});
const LEGACY_CIRCLE_TARGETS = Object.freeze({
  ci_calc_b: 'ci_calc_a',
  ci_calc_old: 'ci_calc_a'
});
const SEED_VERSION = 8;

function timestampValue(value) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function compareText(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCircleCandidates(a, b, preferredId) {
  const aActive = a.status === 'active' ? 1 : 0;
  const bActive = b.status === 'active' ? 1 : 0;
  if (aActive !== bActive) return bActive - aActive;

  const aPreferred = a.id === preferredId ? 1 : 0;
  const bPreferred = b.id === preferredId ? 1 : 0;
  if (aPreferred !== bPreferred) return bPreferred - aPreferred;

  const aCreated = timestampValue(a.createdAt);
  const bCreated = timestampValue(b.createdAt);
  if (aCreated !== bCreated) {
    if (aCreated === null) return 1;
    if (bCreated === null) return -1;
    return aCreated - bCreated;
  }
  return compareText(a.id, b.id);
}

function remapCircleReferences(value, circleIdMap) {
  if (Array.isArray(value)) {
    value.forEach((item) => remapCircleReferences(item, circleIdMap));
    return;
  }
  if (!value || typeof value !== 'object') return;

  Object.entries(value).forEach(([key, child]) => {
    if (key === 'circleId' && typeof child === 'string' && circleIdMap.has(child)) {
      value[key] = circleIdMap.get(child);
    } else {
      remapCircleReferences(child, circleIdMap);
    }
  });
}

function membershipStatusPriority(status) {
  if (status === 'removed') return 3;
  if (status === 'active') return 2;
  if (status === 'left') return 1;
  return 0;
}

function mergeMemberships(existing, incoming) {
  const existingPriority = membershipStatusPriority(existing.status);
  const incomingPriority = membershipStatusPriority(incoming.status);
  const existingUpdated = timestampValue(existing.updatedAt) ?? -1;
  const incomingUpdated = timestampValue(incoming.updatedAt) ?? -1;
  const primary = incomingPriority > existingPriority
    || (incomingPriority === existingPriority && incomingUpdated > existingUpdated)
    ? incoming
    : existing;
  const secondary = primary === existing ? incoming : existing;
  const merged = { ...secondary, ...primary };

  merged.status = primary.status || secondary.status;
  ['muted', 'shelved', 'writeRestricted'].forEach((flag) => {
    merged[flag] = !!(existing[flag] || incoming[flag]);
  });

  const joined = [timestampValue(existing.joinedAt), timestampValue(incoming.joinedAt)]
    .filter((value) => value !== null);
  if (joined.length) merged.joinedAt = new Date(Math.min(...joined)).toISOString();

  const lastSeen = [timestampValue(existing.lastSeenAt), timestampValue(incoming.lastSeenAt)]
    .filter((value) => value !== null);
  if (lastSeen.length) merged.lastSeenAt = new Date(Math.max(...lastSeen)).toISOString();

  ['leftAt', 'updatedAt', 'removedAt'].forEach((field) => {
    const values = [timestampValue(existing[field]), timestampValue(incoming[field])]
      .filter((value) => value !== null);
    if (values.length) merged[field] = new Date(Math.max(...values)).toISOString();
  });
  return merged;
}

function dedupeMemberships(memberships) {
  const order = [];
  const byKey = new Map();
  (memberships || []).forEach((membership) => {
    if (!membership || !membership.userId || !membership.circleId) {
      order.push(membership);
      return;
    }
    const key = JSON.stringify([membership.userId, membership.circleId]);
    if (!byKey.has(key)) {
      byKey.set(key, membership);
      order.push(key);
    } else {
      byKey.set(key, mergeMemberships(byKey.get(key), membership));
    }
  });
  return order.map((item) => (typeof item === 'string' ? byKey.get(item) : item));
}

function uniqueInviteAliases(candidates, circles) {
  const validCircleIds = new Set((circles || []).map((circle) => circle && circle.id).filter(Boolean));
  const primaryCodes = new Set((circles || [])
    .map((circle) => String(circle && circle.inviteCode || '').trim().toUpperCase())
    .filter(Boolean));
  const ordered = (candidates || [])
    .map((candidate) => ({
      code: String(candidate && candidate.code || '').trim().toUpperCase(),
      circleId: String(candidate && candidate.circleId || ''),
      priority: Number(candidate && candidate.priority) || 0
    }))
    .filter((candidate) => candidate.code && validCircleIds.has(candidate.circleId)
      && !primaryCodes.has(candidate.code))
    .sort((a, b) => a.priority - b.priority
      || compareText(a.code, b.code)
      || compareText(a.circleId, b.circleId));

  const seen = new Set();
  return ordered.filter((candidate) => {
    if (seen.has(candidate.code)) return false;
    seen.add(candidate.code);
    return true;
  }).map(({ code, circleId }) => ({ code, circleId }));
}

/**
 * Collapse pre-9.2 split circles in an existing local demo store without
 * replacing the user's posts, reactions, profile or other saved state.
 * Canonical selection is deterministic: an active circle wins; otherwise a
 * known 9.2 ID wins; then the oldest createdAt and lexical ID break ties.
 * The surviving circle keeps its invite code. Prior duplicate codes are stored
 * in the top-level circleInviteAliases table and resolve to that circle.
 */
export function migrateDemoState(state) {
  if (!state || typeof state !== 'object') return state;

  const originalCircles = Array.isArray(state.circles) ? state.circles : [];
  const previousAliases = Array.isArray(state.circleInviteAliases) ? state.circleInviteAliases : [];
  const groups = new Map();
  originalCircles.forEach((circle, index) => {
    const key = circle && circle.courseId ? `course:${circle.courseId}` : `circle:${circle && circle.id || index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(circle);
  });

  const canonicalCircles = [];
  const circleIdMap = new Map();
  const inviteAliasCandidates = previousAliases.map((alias) => ({
    code: alias && alias.code,
    circleId: alias && alias.circleId,
    priority: 0
  }));
  groups.forEach((group) => {
    const courseId = group.find((circle) => circle && circle.courseId)?.courseId;
    const preferredId = PREFERRED_CIRCLE_IDS[courseId] || null;
    const candidates = group.filter(Boolean).slice().sort((a, b) => compareCircleCandidates(a, b, preferredId));
    if (!candidates.length) return;

    const canonical = candidates[0];
    const hasActive = group.some((circle) => circle && circle.status === 'active');
    const hasArchived = group.some((circle) => circle && circle.status === 'archived');
    if (hasActive) {
      canonical.status = 'active';
    } else if (hasArchived) {
      canonical.status = 'archived';
      const archivedAt = group
        .map((circle) => timestampValue(circle && circle.archivedAt))
        .filter((value) => value !== null);
      if (archivedAt.length) canonical.archivedAt = new Date(Math.max(...archivedAt)).toISOString();
    }

    if (!canonical.inviteCode) {
      const codeSource = candidates.find((circle) => circle.inviteCode);
      if (codeSource) canonical.inviteCode = codeSource.inviteCode;
    }
    candidates.forEach((circle) => {
      const codes = [circle.inviteCode, ...(Array.isArray(circle.legacyInviteCodes) ? circle.legacyInviteCodes : [])];
      codes.filter(Boolean).forEach((code) => inviteAliasCandidates.push({
        code,
        circleId: canonical.id,
        priority: 1
      }));
      delete circle.legacyInviteCodes;
    });
    if (!canonical.pinnedPostId) {
      const pinnedSource = candidates.find((circle) => circle.pinnedPostId);
      if (pinnedSource) canonical.pinnedPostId = pinnedSource.pinnedPostId;
    }

    canonicalCircles.push(canonical);
    group.forEach((circle) => {
      if (circle && circle.id) circleIdMap.set(circle.id, canonical.id);
    });
  });

  // Older demo snapshots may have references to these circles even if their
  // circle records were already removed by an earlier partial migration.
  const canonicalCalc = canonicalCircles.find((circle) => circle && circle.courseId === 'c_calc');
  if (canonicalCalc) {
    Object.entries(LEGACY_CIRCLE_TARGETS).forEach(([legacyId]) => {
      if (!circleIdMap.has(legacyId)) circleIdMap.set(legacyId, canonicalCalc.id);
    });
  }

  inviteAliasCandidates.forEach((alias) => {
    if (alias && alias.circleId) alias.circleId = circleIdMap.get(alias.circleId) || alias.circleId;
  });

  remapCircleReferences(state, circleIdMap);
  state.circles = canonicalCircles;
  state.circleInviteAliases = uniqueInviteAliases(inviteAliasCandidates, canonicalCircles);
  state.memberships = dedupeMemberships(state.memberships);
  if (!Array.isArray(state.directMessages)) state.directMessages = [];

  // Remove only the fixed source fixtures whose ID, title and body marker still match.
  removeKnownDemoPosts(state, { reason: '本地数据升级时移除已确认的源码演示帖子' });

  state.seedVersion = Math.max(Number(state.seedVersion) || 0, SEED_VERSION);
  state.version = STORE_VERSION;
  return state;
}

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
        if (parsed && MIGRATABLE_STORE_VERSIONS.has(parsed.version) && Array.isArray(parsed.posts)) {
          state = migrateDemoState(parsed);
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





