#!/usr/bin/env node
/*
 * One-time migration for an administrator-exported pilot JSON snapshot.
 * Dry-run is the default. The script never calls the pilot API and refuses
 * the repository's live data directory and allowlist path.
 */

import {
  closeSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DATA_DIR = path.resolve(SERVER_DIR, 'data');
const SERVER_ALLOWLIST = path.resolve(SERVER_DIR, 'allowlist.txt');
const PREFERRED_CIRCLE_IDS = Object.freeze({
  c_calc: 'ci_calc_a',
  c_la: 'ci_la_a',
  c_py: 'ci_py_b',
  c_ds: 'ci_ds_a',
  c_prob: 'ci_prob',
  c_phys: 'ci_phys'
});
const KNOWN_CIRCLE_FIELDS = new Set([
  'id', 'courseId', 'status', 'createdBy', 'inviteCode', 'createdAt', 'pinnedPostId',
  'archivedAt', 'legacyInviteCodes'
]);
const MERGED_MEMBERSHIP_FIELDS = new Set([
  'userId', 'circleId', 'status', 'muted', 'shelved', 'writeRestricted',
  'joinedAt', 'lastSeenAt', 'leftAt', 'updatedAt', 'removedAt'
]);
const MEMBERSHIP_DATE_FIELDS = new Set(['joinedAt', 'lastSeenAt', 'leftAt', 'updatedAt', 'removedAt']);
const PRIVATE_SAMPLE_POST_ID = 'p_derivative_draft';
const PRIVATE_SAMPLE_TITLE = '个人草稿：导数公式手写版';
const PRIVATE_SAMPLE_BODY_MARKER = '暂时不放到找资料里，等补完再公开';

const USAGE = `用法：
  node server/migrate-pilot-data.mjs --file /path/to/gongye-db.json
  node server/migrate-pilot-data.mjs --file /path/to/gongye-db.json --apply

默认只分析，不写文件。--apply 仅写入 --file 指定的管理员导出副本，并在同目录先生成时间戳备份。
不要把 server/data/、名为 db.json 的文件、allowlist.txt、符号链接或正在被服务使用的文件作为输入。`;

function parseArgs(argv) {
  const options = { apply: false, help: false, file: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--file') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--file 后需要 JSON 文件路径');
      options.file = value;
      index += 1;
    } else if (arg.startsWith('--file=')) {
      options.file = arg.slice('--file='.length);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!options.help && !options.file) throw new Error('必须指定 --file 管理员导出副本路径');
  if (options.help && options.apply) throw new Error('--help 不能与 --apply 同时使用');
  return options;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function timestampValue(value) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

function compareText(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCircleCandidates(a, b, preferredId) {
  const activeOrder = Number(b.status === 'active') - Number(a.status === 'active');
  if (activeOrder) return activeOrder;
  const preferredOrder = Number(b.id === preferredId) - Number(a.id === preferredId);
  if (preferredOrder) return preferredOrder;
  const aCreated = timestampValue(a.createdAt);
  const bCreated = timestampValue(b.createdAt);
  if (aCreated !== bCreated) {
    if (aCreated === null) return 1;
    if (bCreated === null) return -1;
    return aCreated - bCreated;
  }
  return compareText(a.id, b.id);
}

function groupsByCourse(circles) {
  const groups = new Map();
  for (const circle of circles) {
    if (!groups.has(circle.courseId)) groups.set(circle.courseId, []);
    groups.get(circle.courseId).push(circle);
  }
  return groups;
}

function remapCircleReferences(value, circleIdMap) {
  if (Array.isArray(value)) {
    value.forEach((item) => remapCircleReferences(item, circleIdMap));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'circleId' && typeof child === 'string' && circleIdMap.has(child)) {
      value[key] = circleIdMap.get(child);
    } else {
      remapCircleReferences(child, circleIdMap);
    }
  }
}

function scanCircleReferences(value, visit) {
  if (Array.isArray(value)) {
    value.forEach((item) => scanCircleReferences(item, visit));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'circleId' && typeof child === 'string') visit(child);
    else scanCircleReferences(child, visit);
  }
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

function mergeAffectedMemberships(rows, circleIdMap) {
  const affectedKeys = new Set();
  const rowsByKey = new Map();
  rows.forEach((row) => {
    if (!row || !row.userId || !row.circleId) return;
    const mappedCircleId = circleIdMap.get(row.circleId) || row.circleId;
    const key = JSON.stringify([row.userId, mappedCircleId]);
    if (!rowsByKey.has(key)) rowsByKey.set(key, []);
    rowsByKey.get(key).push({ row, originalCircleId: row.circleId });
    if (mappedCircleId !== row.circleId) affectedKeys.add(key);
  });

  const emitted = new Set();
  const result = [];
  for (const source of rows) {
    if (!source || !source.userId || !source.circleId) {
      const unchanged = cloneJson(source);
      remapCircleReferences(unchanged, circleIdMap);
      result.push(unchanged);
      continue;
    }
    const mappedCircleId = circleIdMap.get(source.circleId) || source.circleId;
    const key = JSON.stringify([source.userId, mappedCircleId]);
    if (!affectedKeys.has(key)) {
      const unchanged = cloneJson(source);
      remapCircleReferences(unchanged, circleIdMap);
      result.push(unchanged);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    const group = rowsByKey.get(key).map(({ row }) => {
      const mapped = cloneJson(row);
      remapCircleReferences(mapped, circleIdMap);
      return mapped;
    });
    result.push(group.slice(1).reduce((current, incoming) => mergeMemberships(current, incoming), group[0]));
  }
  return result;
}

function validateMembershipMerges(rows, circleIdMap, blockers) {
  const groups = new Map();
  for (const row of rows) {
    if (!row || !row.userId || !row.circleId) continue;
    const mappedCircleId = circleIdMap.get(row.circleId) || row.circleId;
    if (mappedCircleId === row.circleId) continue;
    const key = JSON.stringify([row.userId, mappedCircleId]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const key of groups.keys()) {
    const mergeRows = rows.filter((row) => row
      && JSON.stringify([row.userId, circleIdMap.get(row.circleId) || row.circleId]) === key);
    if (mergeRows.length < 2) continue;
    const fields = new Set(mergeRows.flatMap((row) => Object.keys(row)));
    for (const field of fields) {
      const values = mergeRows.filter((row) => Object.hasOwn(row, field)).map((row) => JSON.stringify(row[field]));
      const distinct = new Set(values);
      if (distinct.size < 2 || MERGED_MEMBERSHIP_FIELDS.has(field)) continue;
      blockers.push(`成员关系合并时字段 ${field} 存在冲突，禁止自动写入`);
    }
    for (const field of ['muted', 'shelved', 'writeRestricted']) {
      if (mergeRows.some((row) => Object.hasOwn(row, field) && typeof row[field] !== 'boolean')) {
        blockers.push(`成员关系字段 ${field} 不是布尔值，禁止自动写入`);
      }
    }
    for (const field of MEMBERSHIP_DATE_FIELDS) {
      const values = mergeRows.filter((row) => Object.hasOwn(row, field)).map((row) => row[field]);
      if (values.some((value) => timestampValue(value) === null)) {
        blockers.push(`成员关系时间字段 ${field} 格式异常，禁止自动写入`);
      }
    }
  }
}

function inviteCodeOwners(state) {
  const circleById = new Map((state.circles || []).map((circle) => [circle.id, circle]));
  const owners = new Map();
  const unresolvedAliases = [];
  const add = (rawCode, courseId, source) => {
    const code = normalizeCode(rawCode);
    if (!code) return;
    if (!owners.has(code)) owners.set(code, new Set());
    owners.get(code).add(courseId || `unknown:${source}`);
  };
  for (const circle of state.circles || []) {
    add(circle.inviteCode, circle.courseId, circle.id);
    for (const code of Array.isArray(circle.legacyInviteCodes) ? circle.legacyInviteCodes : []) {
      add(code, circle.courseId, circle.id);
    }
  }
  for (const alias of state.circleInviteAliases || []) {
    if (!alias || typeof alias !== 'object') {
      unresolvedAliases.push('');
      continue;
    }
    const circle = circleById.get(alias.circleId);
    if (!circle) unresolvedAliases.push(String(alias.code || ''));
    else add(alias.code, circle.courseId, alias.circleId);
  }
  return { owners, unresolvedAliases };
}

function isKnownPrivateSample(post) {
  return post
    && post.id === PRIVATE_SAMPLE_POST_ID
    && post.title === PRIVATE_SAMPLE_TITLE
    && String(post.body || '').includes(PRIVATE_SAMPLE_BODY_MARKER);
}

function buildCircleMerge(input, duplicateGroups, blockers) {
  const circleIdMap = new Map();
  const canonicalByCourse = new Map();
  const mergedCircles = [];

  for (const [courseId, group] of duplicateGroups) {
    const canonical = [...group].sort((a, b) => compareCircleCandidates(
      a, b, PREFERRED_CIRCLE_IDS[courseId] || null
    ))[0];
    const canonicalCopy = cloneJson(canonical);
    const candidates = [...group].sort((a, b) => compareCircleCandidates(
      a, b, PREFERRED_CIRCLE_IDS[courseId] || null
    ));
    const hasActive = group.some((circle) => circle.status === 'active');
    const hasArchived = group.some((circle) => circle.status === 'archived');
    if (hasActive) canonicalCopy.status = 'active';
    else if (hasArchived) canonicalCopy.status = 'archived';
    if (!canonicalCopy.inviteCode) {
      const source = candidates.find((circle) => circle.inviteCode);
      if (source) canonicalCopy.inviteCode = source.inviteCode;
    }
    if (!canonicalCopy.createdBy) {
      const source = candidates.find((circle) => circle.createdBy);
      if (source) canonicalCopy.createdBy = source.createdBy;
    }
    if (!canonicalCopy.pinnedPostId) {
      const source = candidates.find((circle) => circle.pinnedPostId);
      if (source) canonicalCopy.pinnedPostId = source.pinnedPostId;
    }
    if (hasArchived) {
      const archivedTimes = group.map((circle) => timestampValue(circle.archivedAt)).filter((value) => value !== null);
      if (archivedTimes.length) canonicalCopy.archivedAt = new Date(Math.max(...archivedTimes)).toISOString();
    }
    delete canonicalCopy.legacyInviteCodes;
    canonicalByCourse.set(courseId, canonicalCopy);
    for (const circle of group) circleIdMap.set(circle.id, canonical.id);
  }

  for (const circle of input.circles) {
    const group = duplicateGroups.find(([, rows]) => rows.some((row) => row.id === circle.id));
    if (!group) {
      mergedCircles.push(cloneJson(circle));
      continue;
    }
    const [courseId] = group;
    const canonical = canonicalByCourse.get(courseId);
    if (circle.id === canonical.id) mergedCircles.push(canonical);
  }

  let aliases;
  if (!duplicateGroups.length) {
    aliases = cloneJson(input.circleInviteAliases || []);
  } else {
    const primaryCodes = new Set(mergedCircles.map((circle) => normalizeCode(circle.inviteCode)).filter(Boolean));
    const candidates = [];
    for (const alias of input.circleInviteAliases || []) {
      if (!alias || typeof alias !== 'object') continue;
      const mappedCircleId = circleIdMap.get(alias.circleId) || alias.circleId;
      candidates.push({ code: alias.code, circleId: mappedCircleId });
    }
    for (const [, group] of duplicateGroups) {
      const canonicalId = circleIdMap.get(group[0].id);
      for (const circle of group) {
        const codes = [circle.inviteCode, ...(Array.isArray(circle.legacyInviteCodes) ? circle.legacyInviteCodes : [])];
        codes.forEach((code) => candidates.push({ code, circleId: canonicalId }));
      }
    }
    const validIds = new Set(mergedCircles.map((circle) => circle.id));
    const seenCodes = new Set();
    aliases = [];
    for (const candidate of candidates) {
      const code = normalizeCode(candidate.code);
      if (!code || !validIds.has(candidate.circleId) || primaryCodes.has(code) || seenCodes.has(code)) continue;
      seenCodes.add(code);
      aliases.push({ code: candidate.code, circleId: candidate.circleId });
    }
  }

  const transformed = cloneJson(input);
  remapCircleReferences(transformed, circleIdMap);
  transformed.circles = mergedCircles;
  transformed.memberships = mergeAffectedMemberships(input.memberships, circleIdMap);
  if (Object.hasOwn(input, 'circleInviteAliases') || aliases.length) transformed.circleInviteAliases = aliases;
  else delete transformed.circleInviteAliases;

  const sample = transformed.posts.find((post) => post && post.id === PRIVATE_SAMPLE_POST_ID);
  const originalSample = input.posts.find((post) => post && post.id === PRIVATE_SAMPLE_POST_ID);
  const hideSample = Boolean(originalSample && originalSample.status === 'published' && isKnownPrivateSample(originalSample));
  if (sample && hideSample) sample.status = 'draft';

  const dangling = new Set();
  const validCircleIds = new Set(mergedCircles.map((circle) => circle.id));
  scanCircleReferences(transformed, (circleId) => {
    if (!validCircleIds.has(circleId)) dangling.add(circleId);
  });
  if (dangling.size) blockers.push(`迁移后有 ${dangling.size} 个指向不存在圈的 circleId，禁止写入`);

  return { transformed, circleIdMap, hideSample };
}

function preservedArrayCheck(before, after, circleIdMap, sampleCanChange = false) {
  const expected = cloneJson(before);
  remapCircleReferences(expected, circleIdMap);
  if (sampleCanChange) {
    const post = expected.find((row) => row && row.id === PRIVATE_SAMPLE_POST_ID);
    if (post) post.status = 'draft';
  }
  return JSON.stringify(expected) === JSON.stringify(after);
}

function makePlan(input) {
  const blockers = [];
  const warnings = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('JSON 根节点必须是对象');
  }
  for (const field of ['circles', 'posts', 'attachments', 'comments', 'memberships']) {
    if (!Array.isArray(input[field])) blockers.push(`字段 ${field} 必须是数组，无法核对数据保留情况`);
  }
  if (input.circleInviteAliases !== undefined && !Array.isArray(input.circleInviteAliases)) {
    blockers.push('circleInviteAliases 不是数组，无法保证旧邀请码映射');
  }
  if (blockers.length) return { blockers, warnings, transformed: null, report: null };

  if (input.circles.some((circle) => !circle || typeof circle !== 'object'
    || typeof circle.id !== 'string' || !circle.id
    || typeof circle.courseId !== 'string' || !circle.courseId)) {
    blockers.push('圈记录缺少有效字符串 id/courseId；无法安全识别同课重复圈');
  }
  const circleIds = input.circles.map((circle) => circle && circle.id);
  if (new Set(circleIds).size !== circleIds.length) blockers.push('圈 ID 重复，无法进行唯一重映射');
  if (blockers.length) return { blockers, warnings, transformed: null, report: null };

  const duplicateGroups = [...groupsByCourse(input.circles).entries()].filter(([, group]) => group.length > 1);
  const duplicateCircleIds = new Set(duplicateGroups.flatMap(([, group]) => group.map((circle) => circle.id)));
  for (const [courseId, group] of duplicateGroups) {
    const unknown = [...new Set(group.flatMap((circle) => Object.keys(circle)
      .filter((key) => !KNOWN_CIRCLE_FIELDS.has(key))))];
    if (unknown.length) blockers.push(`课程 ${courseId} 的重复圈含未识别字段：${unknown.join(', ')}；为保留数据禁止自动合并`);
    const pinnedIds = [...new Set(group.map((circle) => circle.pinnedPostId).filter(Boolean))];
    if (pinnedIds.length > 1) blockers.push(`课程 ${courseId} 的重复圈置顶不同帖子，需人工选择`);
    const creators = [...new Set(group.map((circle) => circle.createdBy).filter(Boolean))];
    if (creators.length > 1) blockers.push(`课程 ${courseId} 的重复圈创建者不同，需人工确认归属`);
  }

  for (const alias of input.circleInviteAliases || []) {
    const keys = alias && typeof alias === 'object' ? Object.keys(alias) : [];
    if (!alias || typeof alias.code !== 'string' || !alias.code.trim()
      || typeof alias.circleId !== 'string' || !alias.circleId
      || keys.some((key) => !['code', 'circleId'].includes(key))) {
      blockers.push('存在格式异常或含额外字段的旧邀请码别名，禁止自动改写');
      break;
    }
  }

  const codesBefore = inviteCodeOwners(input);
  if (codesBefore.unresolvedAliases.length) {
    blockers.push(`存在指向不存在圈的旧邀请码别名（${codesBefore.unresolvedAliases.length} 条）`);
  }
  for (const [code, owners] of codesBefore.owners) {
    if (owners.size > 1) blockers.push(`邀请码 ${code} 对应多个课程，无法无损确定归属`);
  }
  const unsupportedLegacyCodes = input.circles.filter((circle) => !duplicateCircleIds.has(circle.id)
    && Array.isArray(circle.legacyInviteCodes) && circle.legacyInviteCodes.length);
  if (unsupportedLegacyCodes.length) blockers.push('非重复圈仍有 legacyInviteCodes；为限制迁移范围禁止写入');

  const { transformed, circleIdMap, hideSample } = buildCircleMerge(input, duplicateGroups, blockers);
  validateMembershipMerges(input.memberships, circleIdMap, blockers);
  const originalMembershipKeys = new Set(input.memberships
    .filter((row) => row && row.userId && row.circleId)
    .map((row) => JSON.stringify([row.userId, circleIdMap.get(row.circleId) || row.circleId])));
  const resultingMembershipKeys = new Set(transformed.memberships
    .filter((row) => row && row.userId && row.circleId)
    .map((row) => JSON.stringify([row.userId, row.circleId])));
  const missingMemberships = [...originalMembershipKeys].filter((key) => !resultingMembershipKeys.has(key));
  if (missingMemberships.length) blockers.push(`合并后缺少 ${missingMemberships.length} 个逻辑成员关系`);

  for (const field of ['posts', 'attachments', 'comments']) {
    if (input[field].length !== transformed[field].length
      || !preservedArrayCheck(input[field], transformed[field], circleIdMap, field === 'posts' && hideSample)) {
      blockers.push(`${field} 记录除目标圈引用或固定草稿状态外出现变化，禁止写入`);
    }
  }
  for (const field of ['users', 'resources']) {
    if (input[field] !== undefined && (!Array.isArray(input[field])
      || !preservedArrayCheck(input[field], transformed[field], circleIdMap))) {
      blockers.push(`${field} 数据无法通过保留核对，禁止写入`);
    }
  }

  const codesAfter = inviteCodeOwners(transformed);
  for (const [code, owners] of codesBefore.owners) {
    if (owners.size !== 1) continue;
    const expectedCourse = [...owners][0];
    const resultingOwners = codesAfter.owners.get(code);
    if (!resultingOwners || resultingOwners.size !== 1 || !resultingOwners.has(expectedCourse)) {
      blockers.push(`邀请码 ${code} 迁移后不能唯一指向原课程`);
    }
  }

  if (!duplicateGroups.length && !hideSample) warnings.push('未发现可自动处理的同课重复圈或文案匹配的固定样例帖');
  const sampleBefore = input.posts.find((post) => post && post.id === PRIVATE_SAMPLE_POST_ID) || null;
  if (sampleBefore && sampleBefore.status === 'published' && !isKnownPrivateSample(sampleBefore)) {
    warnings.push('固定帖子 ID 存在，但标题或正文标记不同；保留原状态');
  }
  if (sampleBefore && sampleBefore.status !== 'published') {
    warnings.push('固定帖子 ID 已不是 published 状态；保持现状');
  }

  const canonicalByCourse = new Map(transformed.circles.map((circle) => [circle.courseId, circle]));
  const circleMerges = duplicateGroups.map(([courseId, group]) => {
    const canonical = canonicalByCourse.get(courseId);
    const codes = group.flatMap((circle) => [circle.inviteCode,
      ...(Array.isArray(circle.legacyInviteCodes) ? circle.legacyInviteCodes : [])])
      .map(normalizeCode).filter(Boolean);
    const resultingAliases = (transformed.circleInviteAliases || [])
      .filter((alias) => alias.circleId === (canonical && canonical.id))
      .map((alias) => normalizeCode(alias.code));
    return {
      courseId,
      canonicalCircleId: canonical ? canonical.id : null,
      resultingPrimaryCode: canonical ? normalizeCode(canonical.inviteCode) : '',
      mergedCircleIds: group.map((circle) => circle.id).filter((id) => id !== (canonical && canonical.id)),
      preservedInviteCodes: [...new Set(codes)],
      resultingAliasCodes: [...new Set(resultingAliases)]
    };
  });
  const report = {
    mode: 'dry-run',
    duplicateCourseGroups: circleMerges,
    fixedSamplePost: {
      id: PRIVATE_SAMPLE_POST_ID,
      found: Boolean(sampleBefore),
      titleMatchesKnownSample: Boolean(sampleBefore && sampleBefore.title === PRIVATE_SAMPLE_TITLE),
      bodyMatchesKnownSample: Boolean(sampleBefore && String(sampleBefore.body || '').includes(PRIVATE_SAMPLE_BODY_MARKER)),
      statusBefore: sampleBefore ? sampleBefore.status || null : null,
      statusAfter: transformed.posts.find((post) => post && post.id === PRIVATE_SAMPLE_POST_ID)?.status || null,
      changed: Boolean(sampleBefore && sampleBefore.status !== transformed.posts
        .find((post) => post && post.id === PRIVATE_SAMPLE_POST_ID)?.status)
    },
    counts: {
      circlesBefore: input.circles.length,
      circlesAfter: transformed.circles.length,
      membershipsBefore: input.memberships.length,
      membershipsAfter: transformed.memberships.length,
      membershipRowsMerged: Math.max(0, input.memberships.length - transformed.memberships.length),
      postsBefore: input.posts.length,
      postsAfter: transformed.posts.length,
      attachmentsBefore: input.attachments.length,
      attachmentsAfter: transformed.attachments.length,
      commentsBefore: input.comments.length,
      commentsAfter: transformed.comments.length
    },
    warnings,
    blockers,
    applyAllowed: blockers.length === 0,
    writesInDryRun: false
  };
  return { blockers, warnings, transformed, report };
}

function assertSafeInputPath(filePath) {
  const resolved = path.resolve(filePath);
  const liveDataDir = path.resolve(SERVER_DATA_DIR);
  const allowlistPath = path.resolve(SERVER_ALLOWLIST);
  const inDirectory = (candidate, directory) => candidate === directory || candidate.startsWith(`${directory}${path.sep}`);
  const inputName = path.basename(resolved).toLowerCase();
  if (inputName === 'allowlist.txt' || inputName === 'db.json' || resolved === allowlistPath) {
    throw new Error('拒绝把 db.json 或 allowlist.txt 作为输入；请使用重命名后的独立导出副本');
  }
  if (inDirectory(resolved, liveDataDir)) throw new Error('拒绝读取 server/data/；请使用独立管理员导出副本');
  const lstat = lstatSync(resolved);
  if (lstat.isSymbolicLink()) throw new Error('拒绝符号链接输入；请使用普通导出副本');
  const real = realpathSync(resolved);
  const realName = path.basename(real).toLowerCase();
  if (inDirectory(real, liveDataDir) || realName === 'allowlist.txt' || realName === 'db.json') {
    throw new Error('输入指向受保护的数据或名单路径，已拒绝');
  }
  const fileStat = statSync(real);
  if (!fileStat.isFile()) throw new Error('--file 必须指向普通 JSON 文件');
  if (fileStat.nlink > 1) throw new Error('拒绝存在多个硬链接的输入文件；请先复制为独立导出副本');
  return real;
}

function writeAtomicallyWithBackup(filePath, originalBytes, nextValue) {
  const directory = path.dirname(filePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup-${timestamp}`;
  const tempPath = path.join(directory, `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  const originalStat = statSync(filePath);
  let tempFd = null;
  try {
    if (!readFileSync(filePath).equals(originalBytes)) throw new Error('输入文件在备份前发生变化；没有写入');
    copyFileSync(filePath, backupPath, constants.COPYFILE_EXCL);
    if (!readFileSync(backupPath).equals(originalBytes)) throw new Error('备份与分析输入不一致；没有替换原文件');
    chmodSync(backupPath, originalStat.mode & 0o600);
    const backupFd = openSync(backupPath, 'r');
    try { fsyncSync(backupFd); } finally { closeSync(backupFd); }
    const directoryFd = openSync(directory, 'r');
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }

    tempFd = openSync(tempPath, 'wx', originalStat.mode & 0o777);
    const serialized = `${JSON.stringify(nextValue, null, 2)}\n`;
    writeFileSync(tempFd, serialized, 'utf8');
    fsyncSync(tempFd);
    closeSync(tempFd);
    tempFd = null;
    if (!readFileSync(filePath).equals(originalBytes)) throw new Error('输入文件在迁移写入前发生变化；备份已保留，未替换原文件');
    renameSync(tempPath, filePath);
    const finalDirectoryFd = openSync(directory, 'r');
    try { fsyncSync(finalDirectoryFd); } catch { /* rename is atomic; a synced backup remains available. */ }
    finally { closeSync(finalDirectoryFd); }
    return { backupPath, bytesBefore: originalBytes.length, bytesAfter: Buffer.byteLength(serialized, 'utf8') };
  } catch (error) {
    if (tempFd !== null) {
      try { closeSync(tempFd); } catch { /* ignore cleanup errors */ }
    }
    try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch { /* preserve the original error */ }
    throw error;
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const filePath = assertSafeInputPath(options.file);
  const originalBytes = readFileSync(filePath);
  let input;
  try {
    input = JSON.parse(originalBytes.toString('utf8'));
  } catch {
    throw new Error('输入不是有效 JSON；没有写入任何文件');
  }
  const plan = makePlan(input);
  if (!plan.report) {
    process.stdout.write(`${JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', applyAllowed: false, blockers: plan.blockers, writesInDryRun: false }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  plan.report.mode = options.apply ? 'apply' : 'dry-run';
  plan.report.writesInDryRun = false;
  if (!options.apply) {
    process.stdout.write(`${JSON.stringify(plan.report, null, 2)}\n`);
    return;
  }
  if (!plan.report.applyAllowed) {
    process.stdout.write(`${JSON.stringify(plan.report, null, 2)}\n`);
    process.stderr.write('检查发现无法自动无损合并的情况；未写入任何文件。\n');
    process.exitCode = 2;
    return;
  }
  if (JSON.stringify(input) === JSON.stringify(plan.transformed)) {
    plan.report.noChanges = true;
    process.stdout.write(`${JSON.stringify(plan.report, null, 2)}\n`);
    return;
  }
  const latestBytes = readFileSync(filePath);
  if (!latestBytes.equals(originalBytes)) throw new Error('输入文件在分析期间发生变化；没有写入任何文件');
  const writeResult = writeAtomicallyWithBackup(filePath, originalBytes, plan.transformed);
  plan.report.backupPath = writeResult.backupPath;
  plan.report.bytesBefore = writeResult.bytesBefore;
  plan.report.bytesAfter = writeResult.bytesAfter;
  process.stdout.write(`${JSON.stringify(plan.report, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : '迁移失败'}\n${USAGE}\n`);
  process.exitCode = 1;
}
