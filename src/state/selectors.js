/* 只读查询层：页面从数据库对象派生视图，不在这里修改数据 */

import { shanghaiDate, weekStart, stripMarkdown, levelOf } from '../lib/format.js';
import { COURSE_ALIASES } from '../data/course-aliases.js';

export const byId = (list, id) => (list || []).find((item) => item.id === id) || null;

export function userOf(db, id) {
  return byId(db.users, id);
}

export function courseOf(db, id) {
  return byId(db.courses, id);
}

export function circleOf(db, id) {
  return byId(db.circles, id);
}

export function postOf(db, id) {
  return byId(db.posts, id);
}

export function resourceOf(db, id) {
  return byId(db.resources, id);
}

export function resourceForPost(db, postId) {
  return (db.resources || []).find((r) => r.postId === postId) || null;
}

export function currentUser(db) {
  if (!db.session || !db.session.userId) return null;
  const user = userOf(db, db.session.userId);
  return user && user.status === 'active' ? user : null;
}

export function schoolOf(db, courseId) {
  const course = courseOf(db, courseId);
  return course ? course.school : '通用·不限学校';
}

export function circleLabel(db, circle) {
  if (!circle) return '';
  const course = courseOf(db, circle.courseId);
  return course ? `${course.name} · 课友圈` : '未知课程 · 课友圈';
}

export function circleShort(db, circle) {
  if (!circle) return '';
  const course = courseOf(db, circle.courseId);
  return course ? course.name : '未知课程';
}

/** 9.2：一门课程只有一个共用圈 */
export function circleOfCourse(db, courseId) {
  return (db.circles || []).find((circle) => circle.courseId === courseId) || null;
}

export function termLabel(term) {
  return term === '通用·不限学期' ? '不限学期' : term;
}

/* ---------- 帖子 ---------- */

export function attachmentsOf(db, postId) {
  return (db.attachments || []).filter((a) => a.postId === postId);
}

export function readyAttachments(db, postId) {
  return attachmentsOf(db, postId).filter((a) => a.status === 'ready' && a.path);
}

export function commentsOf(db, postId) {
  return (db.comments || []).filter((c) => c.postId === postId && c.status === 'visible');
}

export function commentTree(db, postId) {
  const all = commentsOf(db, postId).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const roots = all.filter((c) => !c.parentId);
  const replies = new Map();
  all.filter((c) => c.parentId).forEach((c) => {
    if (!replies.has(c.parentId)) replies.set(c.parentId, []);
    replies.get(c.parentId).push(c);
  });
  return { roots, replies, total: all.length };
}

export function commentCount(db, postId) {
  return commentsOf(db, postId).length;
}

export function isVisiblePost(post) {
  return !!post && post.status === 'published';
}

export function reactionOf(db, userId, postId, kind) {
  return (db.reactions || []).find(
    (r) => r.userId === userId && r.postId === postId && r.kind === kind
  ) || null;
}

export function reactionCount(db, postId, kind) {
  return (db.reactions || []).filter((r) => r.postId === postId && r.kind === kind).length;
}

export function giftedQtyForPost(db, postId) {
  return (db.gifts || [])
    .filter((g) => g.postId === postId && g.status === 'active')
    .reduce((sum, g) => sum + g.qty, 0);
}

export function giftedByMe(db, userId, postId) {
  return (db.gifts || [])
    .filter((g) => g.postId === postId && g.senderId === userId && g.status === 'active')
    .reduce((sum, g) => sum + g.qty, 0);
}

export function receivedGiftTotal(db, userId) {
  return (db.gifts || [])
    .filter((g) => g.receiverId === userId && g.status === 'active')
    .reduce((sum, g) => sum + g.qty, 0);
}

/* ---------- 圈子与权限 ---------- */

export function membership(db, userId, circleId) {
  return (db.memberships || []).find((m) => m.userId === userId && m.circleId === circleId) || null;
}

export function isActiveMember(db, userId, circleId) {
  const m = membership(db, userId, circleId);
  return !!m && m.status === 'active';
}

export function myCircles(db, userId) {
  return (db.memberships || [])
    .filter((m) => m.userId === userId && m.status === 'active')
    .map((m) => ({ membership: m, circle: circleOf(db, m.circleId) }))
    .filter((item) => item.circle);
}

export function courseCircles(db, courseId, status = null) {
  return (db.circles || []).filter(
    (c) => c.courseId === courseId && (!status || c.status === status)
  );
}

/** 某用户能否在圈内写入（发帖/评论） */
export function circleWriteBlock(db, userId, circleId) {
  const circle = circleOf(db, circleId);
  if (!circle) return { ok: false, code: 'circle_missing', message: '课友圈不存在' };
  if (circle.status === 'archived') {
    return { ok: false, code: 'archived', message: '这个圈已归档，只能阅读，不能新发帖或评论' };
  }
  const user = userOf(db, userId);
  if (!user || user.status !== 'active') {
    return { ok: false, code: 'suspended', message: '账号已停用，不能写入内容' };
  }
  const m = membership(db, userId, circleId);
  if (!m || m.status !== 'active') {
    return { ok: false, code: 'not_member', message: '发布到这个圈需要先确认加入' };
  }
  if (m.muted) return { ok: false, code: 'muted', message: '你在这个圈被禁言，不能写入内容' };
  if (m.writeRestricted) return { ok: false, code: 'restricted', message: '你在这个圈的写入权限被临时限制' };
  return { ok: true };
}

/** 资料原帖的讨论：非成员登录后也可纠错，但禁言与归档仍然生效 */
export function resourceCommentBlock(db, userId, post) {
  const user = userOf(db, userId);
  if (!user || user.status !== 'active') {
    return { ok: false, code: 'suspended', message: '账号已停用，不能评论' };
  }
  if (!user.verified) return { ok: false, code: 'unverified', message: '验证邮箱后才能评论' };
  if (!post.circleId) return { ok: true };
  const circle = circleOf(db, post.circleId);
  if (circle && circle.status === 'archived') {
    return { ok: false, code: 'archived', message: '来源圈已归档，只能阅读历史讨论' };
  }
  const m = membership(db, userId, post.circleId);
  if (m && m.muted) return { ok: false, code: 'muted', message: '你在这个圈被禁言，不能借资料入口评论' };
  if (m && m.writeRestricted) {
    return { ok: false, code: 'restricted', message: '你在这个圈的写入权限被临时限制' };
  }
  return { ok: true };
}

/* ---------- 资料索引与检索 ---------- */

export function resourceFiles(db, resource) {
  const post = resource ? postOf(db, resource.postId) : null;
  if (!post) return [];
  return attachmentsOf(db, post.id).filter((a) => a.status === 'ready' && a.path);
}

/** 进入找资料索引的必要条件（读时再校验一次，避免异步投影延迟泄露）
 * 9.1：历史资料缺 course_id 仍可访问和检索，课程必填只约束新发布；
 * 列表/搜索里用「课程待补充」标出，避免把旧资料藏起来。
 */
export function resourceEligibility(db, resource) {
  if (!resource) return { ok: false, code: 'missing' };
  const post = postOf(db, resource.postId);
  if (!post || post.status !== 'published') return { ok: false, code: 'post_hidden' };
  if (resource.indexEnabled !== true) return { ok: false, code: 'index_off' };
  if (resource.status !== 'indexed') return { ok: false, code: 'not_indexed' };
  if (!resource.title || !resource.type) return { ok: false, code: 'metadata' };
  if (!resourceFiles(db, resource).length) return { ok: false, code: 'no_file' };
  return { ok: true };
}

const SORTS = ['relevance', 'recent', 'saved'];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s，,。.;；:：!?！？、/\\|()（）[\]【】"'“”‘’]+/g, ' ')
    .trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

/** 剩余意图在字段里的覆盖比例：整串命中为 1，否则按不同字符命中比例 */
function coverageRatio(needle, haystack) {
  if (!needle || !haystack) return 0;
  if (haystack.includes(needle)) return 1;
  const chars = Array.from(new Set(needle.split('')));
  if (!chars.length) return 0;
  const hit = chars.filter((ch) => haystack.includes(ch)).length;
  return hit / chars.length;
}

/** 把查询里的课程名/别名解析到课程；解析不出唯一课时返回候选，不自动合并 */
export function resolveCourseQuery(db, query, explicitCourseId = '') {
  const courses = (db.courses || []).filter((course) => course.id !== 'c_general');
  const compact = compactText(query);
  let matched = [];
  let phrase = '';
  let ambiguous = false;
  let candidates = [];

  const push = (course, score, by) => {
    if (course && !matched.some((row) => row.course.id === course.id)) {
      matched.push({ course, score, by });
    }
  };
  const aliasCourses = (alias) => {
    const row = COURSE_ALIASES.find((item) => compactText(item.alias) === compactText(alias));
    if (!row) return [];
    const canonical = compactText(row.canonical);
    const loose = courses.filter((course) => compactText(course.name).includes(canonical));
    const exact = loose.filter((course) => compactText(course.name) === canonical);
    let list = exact.length ? exact : loose;
    // 同名/近名课程很多（例如课程目录里多门「线性代数」）：优先已有资料的课程，避免别名一搜就歧义
    if (list.length > 1) {
      const withContent = list.filter((course) => (db.resources || []).some((resource) => resource.courseId === course.id));
      if (withContent.length === 1) list = withContent;
    }
    return list;
  };

  if (compact && !explicitCourseId) {
    for (const course of courses) {
      const name = compactText(course.name);
      const code = compactText(course.code);
      if ((name && compact === name) || (code && compact === code)) {
        push(course, 120, 'exact');
        phrase = name;
      }
    }
    if (!matched.length) {
      const hit = COURSE_ALIASES.find((row) => compactText(row.alias) === compact);
      if (hit) {
        const list = aliasCourses(hit.alias);
        list.forEach((course) => push(course, 110, 'alias'));
        phrase = compact;
        if (list.length > 1) ambiguous = true;
        candidates = list;
      }
    }
    if (!matched.length) {
      let bestLen = 0;
      let bestList = [];
      for (const course of courses) {
        const name = compactText(course.name);
        if (name.length < 2 || name.length < bestLen || !compact.includes(name)) continue;
        if (name.length > bestLen) {
          bestLen = name.length;
          bestList = [{ course, name }];
        } else {
          bestList.push({ course, name });
        }
      }
      if (bestList.length > 1) {
        const withContent = bestList.filter(({ course }) => (db.resources || []).some((resource) => resource.courseId === course.id));
        if (withContent.length === 1) bestList = withContent;
      }
      if (bestList.length) {
        bestList.forEach(({ course }) => push(course, 120, 'exact'));
        phrase = bestList[0].name;
        if (bestList.length > 1) ambiguous = true;
      }
    }
    if (!matched.length) {
      let best = null;
      for (const row of COURSE_ALIASES) {
        const alias = compactText(row.alias);
        if (alias.length < 2 || !compact.includes(alias)) continue;
        if (!best || alias.length > best.alias.length) best = { row, alias };
      }
      if (best) {
        const list = aliasCourses(best.row.alias);
        list.forEach((course) => push(course, 110, 'alias'));
        phrase = best.alias;
        if (list.length > 1) ambiguous = true;
        candidates = list;
      }
    }
    if (!matched.length) {
      for (const course of courses) {
        const name = compactText(course.name);
        if (compact.length >= 3 && name.startsWith(compact)) push(course, 70, 'partial');
      }
    }
    if (matched.length > 1) ambiguous = true;
  }

  if (explicitCourseId) {
    const course = courses.find((item) => item.id === explicitCourseId);
    if (course) {
      matched = [{ course, score: 120, by: 'filter' }];
      const names = [compactText(course.name), ...COURSE_ALIASES
        .filter((row) => compactText(course.name).includes(compactText(row.canonical)))
        .map((row) => compactText(row.alias))]
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
      phrase = names.find((name) => compact.includes(name)) || '';
      candidates = [];
      ambiguous = false;
    }
  }

  const residual = phrase ? compact.replace(phrase, '') : compact;
  return {
    matched,
    phrase,
    residual,
    ambiguous,
    candidates,
    compact
  };
}

export function searchResources(db, filters = {}, now = Date.now()) {
  const {
    q = '', school = '', courseId = '', term = '', type = '', tag = '', sort = 'relevance'
  } = filters;
  const rawQuery = String(q || '').trim();
  const keyword = rawQuery.toLowerCase();
  const detection = resolveCourseQuery(db, rawQuery, courseId);
  // 别名歧义：不自动合并，退回普通文本检索并给出课程候选
  const matched = detection.ambiguous ? [] : detection.matched;
  const residual = detection.ambiguous ? detection.compact : detection.residual;

  let list = (db.resources || [])
    .filter((resource) => resourceEligibility(db, resource).ok)
    .map((resource) => {
      const post = postOf(db, resource.postId);
      const course = courseOf(db, resource.courseId);
      const author = userOf(db, post.authorId);
      const files = resourceFiles(db, resource);
      return { resource, post, course, author, files };
    });

  if (school) list = list.filter((x) => (x.resource.school || x.course?.school) === school);
  if (courseId) list = list.filter((x) => x.resource.courseId === courseId);
  if (term) list = list.filter((x) => x.resource.term === term);
  if (type) list = list.filter((x) => x.resource.type === type);
  if (tag) list = list.filter((x) => (x.post.tags || []).includes(tag));

  const mode = SORTS.includes(sort) ? sort : 'relevance';
  const courseIds = new Set(matched.map((row) => row.course.id));
  const courseScoreOf = (item) => {
    const hit = matched.find((row) => row.course.id === item.resource.courseId);
    return hit ? hit.score : 0;
  };
  const needle = residual || detection.compact;

  const scored = list.map((item) => {
    const intent = needle ? intentScore(item, needle) : 0;
    const hasCourse = courseIds.has(item.resource.courseId);
    const needsIntent = !!residual;
    let group = null;
    if (!detection.compact) group = 'A';
    else if (matched.length) {
      if (hasCourse) group = !needsIntent || intent > 0 ? 'A' : 'C';
      else group = intent > 0 ? 'B' : null;
    } else {
      group = intent > 0 ? 'B' : null;
    }
    const score = intent + (group === 'A' ? courseScoreOf(item) : 0);
    return { ...item, score, group };
  }).filter((item) => item.group);

  const byScore = (a, b) => b.score - a.score
    || new Date(b.resource.updatedAt) - new Date(a.resource.updatedAt)
    || String(a.resource.id).localeCompare(String(b.resource.id));
  const byRecent = (a, b) => new Date(b.resource.updatedAt) - new Date(a.resource.updatedAt)
    || String(a.resource.id).localeCompare(String(b.resource.id));

  const main = scored.filter((item) => item.group !== 'C');
  const courseOnly = scored.filter((item) => item.group === 'C');
  main.sort(byScore);
  courseOnly.sort(byRecent);

  if (mode === 'recent') main.sort(byRecent);
  else if (mode === 'saved') {
    main.sort((a, b) => reactionCount(db, b.post.id, 'save') - reactionCount(db, a.post.id, 'save')
      || byRecent(a, b));
  }

  return {
    items: main,
    total: main.length,
    totalAll: main.length + courseOnly.length,
    courseOnly,
    mode,
    keyword,
    course: {
      matched: matched.map((row) => ({
        id: row.course.id,
        name: row.course.name,
        school: row.course.school,
        score: row.score,
        by: row.by
      })),
      candidates: (detection.ambiguous ? detection.candidates : []).map((course) => ({
        id: course.id, name: course.name, school: course.school
      })),
      ambiguous: detection.ambiguous,
      phrase: detection.phrase,
      residual: detection.residual
    }
  };
}

/**
 * 按当前筛选条件为每个字段计算可选值。
 * 计算某个字段时会暂时移除它自身的条件，避免已选值把同字段选项锁死；
 * 其余条件共同收窄候选资料，形成学校、课程、学期、类型与标签之间的包含关系。
 */
export function resourceFilterOptions(db, filters = {}) {
  const rowsFor = (field) => {
    const result = searchResources(db, { ...filters, [field]: '', sort: 'recent' });
    const rows = [...result.items, ...(result.courseOnly || [])];
    const seen = new Set();
    return rows.filter(({ resource }) => {
      if (seen.has(resource.id)) return false;
      seen.add(resource.id);
      return true;
    });
  };
  const valuesFor = (field, project) => Array.from(new Set(
    rowsFor(field).flatMap((row) => project(row) || []).filter(Boolean)
  ));
  const courseRows = rowsFor('courseId');
  const courseSchools = {};
  courseRows.forEach(({ resource, course }) => {
    if (resource.courseId && !courseSchools[resource.courseId]) {
      courseSchools[resource.courseId] = resource.school || course?.school || '';
    }
  });

  return {
    schools: valuesFor('school', ({ resource, course }) => [resource.school || course?.school]),
    courseIds: Array.from(new Set(courseRows.map(({ resource }) => resource.courseId)))
      .filter((id) => id && id !== 'c_general'),
    courseSchools,
    terms: valuesFor('term', ({ resource }) => [resource.term]),
    types: valuesFor('type', ({ resource }) => [resource.type]),
    tags: valuesFor('tag', ({ post }) => post.tags || [])
  };
}

/** 剩余意图评分（9.1 规则）：标题短语 60 + 标题覆盖 40 + 章节/类型 20 + 摘要 10 */
function intentScore(item, needle) {
  const compactNeedle = compactText(needle);
  if (!compactNeedle) return 0;
  const title = compactText(item.resource.title);
  const coverage = compactText(item.resource.coverage);
  const limitations = compactText(item.resource.limitations);
  const metaText = compactText(`${item.resource.type || ''} ${(item.post.tags || []).join(' ')} ${coverage}`);
  const bodyText = compactText(`${stripMarkdown(item.post.body || '')} ${limitations}`);

  let score = 0;
  const titleCov = coverageRatio(compactNeedle, title);
  if (titleCov >= 1) score += 60;
  if (titleCov >= 0.6) score += Math.round(titleCov * 40);
  const metaCov = coverageRatio(compactNeedle, metaText);
  if (metaCov >= 0.6) score += Math.round(metaCov * 20);
  const bodyCov = coverageRatio(compactNeedle, bodyText);
  if (bodyCov >= 0.6) score += Math.round(bodyCov * 10);
  return score;
}

export function resourceTerms(db) {
  return Array.from(new Set((db.resources || [])
    .filter((resource) => resourceEligibility(db, resource).ok)
    .map((resource) => resource.term))).filter(Boolean);
}

export function resourceTags(db) {
  const set = new Set();
  (db.resources || []).filter((resource) => resourceEligibility(db, resource).ok).forEach((r) => {
    const post = postOf(db, r.postId);
    (post && post.tags ? post.tags : []).forEach((t) => set.add(t));
  });
  return Array.from(set);
}

/** 找到课程下可显示的当期圈（用于资料页的自然转化） */
export function suggestedCircles(db, resource) {
  if (!resource) return [];
  return (db.circles || [])
    .filter((c) => c.courseId === resource.courseId && c.status === 'active')
    .map((circle) => ({ circle, members: countMembers(db, circle.id) }));
}

export function countMembers(db, circleId) {
  return (db.memberships || []).filter((m) => m.circleId === circleId && m.status === 'active').length;
}

/* ---------- 信息流 ---------- */

export function feedPosts(db, options = {}, now = Date.now()) {
  const { meId = null, mode = 'all', circleId = null, board = null, week = false, sort = 'latest', limit = 20, offset = 0 } = options;
  let posts = (db.posts || []).filter((p) => p.status === 'published');

  if (circleId) posts = posts.filter((p) => p.circleId === circleId);
  if (board) posts = posts.filter((p) => p.board === board);
  if (week) {
    const start = weekStart(now);
    posts = posts.filter((p) => new Date(p.contentUpdatedAt || p.publishedAt).getTime() >= start);
  }

  if (mode === 'my') {
    const active = (db.memberships || []).filter(
      (m) => m.userId === meId && m.status === 'active' && !m.muted && !m.shelved
    );
    const allowed = new Set(active.map((m) => m.circleId));
    posts = posts.filter((p) => p.circleId && allowed.has(p.circleId));
  } else if (mode === 'following') {
    const follows = (db.follows || []).filter((f) => f.followerId === meId);
    const authors = new Set(follows.filter((f) => f.targetType === 'user').map((f) => f.targetId));
    const courses = new Set(follows.filter((f) => f.targetType === 'course').map((f) => f.targetId));
    posts = posts.filter((p) => authors.has(p.authorId) || (p.courseId && courses.has(p.courseId)));
  } else if (mode === 'discover') {
    posts = posts.filter((p) => p.circleId || p.board === 'method' || p.board === 'help');
  }

  const scored = posts.map((post) => ({ post, hot: hotScore(db, post, now) }));
  if (sort === 'hot') {
    scored.sort((a, b) => b.hot - a.hot || new Date(b.post.publishedAt) - new Date(a.post.publishedAt));
  } else {
    scored.sort((a, b) => new Date(b.post.publishedAt) - new Date(a.post.publishedAt) || String(b.post.id).localeCompare(String(a.post.id)));
  }
  const items = scored.slice(offset, offset + limit).map((x) => x.post);
  return { items, total: scored.length, hasMore: offset + items.length < scored.length };
}

export function hotScore(db, post, now = Date.now()) {
  const likes = reactionCount(db, post.id, 'like');
  const saves = reactionCount(db, post.id, 'save');
  const commenters = new Set(commentsOf(db, post.id).map((c) => c.authorId)).size;
  const gifters = new Set(
    (db.gifts || []).filter((g) => g.postId === post.id && g.status === 'active').map((g) => g.senderId)
  ).size;
  const hours = Math.max(0, (now - new Date(post.publishedAt).getTime()) / 3600000);
  return (2 * likes + 3 * commenters + 4 * saves + 4 * gifters) / Math.pow(hours + 2, 0.7);
}

export function savedPosts(db, userId) {
  return (db.reactions || [])
    .filter((r) => r.userId === userId && r.kind === 'save')
    .map((r) => ({ reaction: r, post: postOf(db, r.postId) }))
    .sort((a, b) => new Date(b.reaction.createdAt) - new Date(a.reaction.createdAt));
}

export function postsByAuthor(db, userId) {
  return (db.posts || [])
    .filter((p) => p.authorId === userId && p.status === 'published')
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

export function followerCount(db, userId) {
  return (db.follows || []).filter((f) => f.targetType === 'user' && f.targetId === userId).length;
}

export function followingCount(db, userId) {
  return (db.follows || []).filter((f) => f.followerId === userId).length;
}

export function isFollowing(db, followerId, targetType, targetId) {
  return (db.follows || []).some(
    (f) => f.followerId === followerId && f.targetType === targetType && f.targetId === targetId
  );
}

/* ---------- 成长 ---------- */

export function xpOf(db, userId) {
  return (db.xp || []).filter((x) => x.userId === userId).reduce((sum, x) => sum + x.delta, 0);
}

export function levelInfo(db, userId) {
  const xp = xpOf(db, userId);
  return { xp, ...levelOf(xp) };
}

/* ---------- 页签 ---------- */

export const BALANCE_CAP = 30;
export const DAILY_SEND_LIMIT = 5;
export const PER_POST_LIMIT = 2;
export const PER_AUTHOR_DAY_LIMIT = 2;

export function walletOf(db, userId) {
  const w = (db.wallets || {})[userId];
  return w ? w.balance : 0;
}

export function hasClaimedToday(db, userId, now = Date.now()) {
  const today = shanghaiDate(new Date(now));
  return (db.claims || []).some((c) => c.userId === userId && c.date === today);
}

export function claimState(db, userId, now = Date.now()) {
  const user = userOf(db, userId);
  const balance = walletOf(db, userId);
  const claimed = hasClaimedToday(db, userId, now);
  if (!user) return { canClaim: false, code: 'no_user', balance, claimed };
  if (user.status !== 'active') return { canClaim: false, code: 'suspended', balance, claimed };
  if (!user.verified) return { canClaim: false, code: 'unverified', balance, claimed };
  if (claimed) return { canClaim: false, code: 'claimed', balance, claimed: true };
  if (balance >= BALANCE_CAP) return { canClaim: false, code: 'full', balance, claimed };
  return { canClaim: true, code: 'ready', balance, claimed };
}

export function sentToday(db, userId, now = Date.now()) {
  const today = shanghaiDate(new Date(now));
  return (db.gifts || [])
    .filter((g) => g.senderId === userId && g.day === today && g.status !== 'failed')
    .reduce((sum, g) => sum + g.qty, 0);
}

export function sentToAuthorToday(db, userId, authorId, now = Date.now()) {
  const today = shanghaiDate(new Date(now));
  return (db.gifts || [])
    .filter((g) => g.senderId === userId && g.receiverId === authorId && g.day === today && g.status !== 'failed')
    .reduce((sum, g) => sum + g.qty, 0);
}

/** 赠送前的前端校验提示（服务端仍要重复校验） */
export function giftAvailability(db, userId, post, now = Date.now()) {
  const user = userOf(db, userId);
  if (!user) return { ok: false, message: '请先登录' };
  if (!user.verified) return { ok: false, message: '验证邮箱后才能赠送页签' };
  if (!post || post.status !== 'published') return { ok: false, message: '这篇内容当前不可赠签' };
  if (post.authorId === userId) return { ok: false, message: '不能给自己的帖子送页签' };
  const balance = walletOf(db, userId);
  if (balance <= 0) return { ok: false, message: '可送余额不足' };
  const mine = giftedByMe(db, userId, post.id);
  if (mine >= PER_POST_LIMIT) return { ok: false, message: `这篇你已累计送出 ${mine} 枚，已达每帖上限` };
  if (sentToAuthorToday(db, userId, post.authorId, now) >= PER_AUTHOR_DAY_LIMIT) {
    return { ok: false, message: '今天送给这位作者的页签已达上限（2 枚）' };
  }
  if (sentToday(db, userId, now) >= DAILY_SEND_LIMIT) {
    return { ok: false, message: '今天的赠送总数已达上限（5 枚）' };
  }
  return { ok: true, balance, mine };
}

/* ---------- 消息 ---------- */

export function notificationsFor(db, userId) {
  return (db.notifications || [])
    .filter((n) => n.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function unreadCount(db, userId) {
  return notificationsFor(db, userId).filter((n) => !n.readAt).length;
}

/* ---------- 课程收录 ---------- */

export function collectedPosts(db, courseId) {
  return (db.courseCollections || [])
    .filter((c) => c.courseId === courseId)
    .map((c) => ({ collection: c, post: postOf(db, c.postId) }))
    .filter((x) => x.post && x.post.status === 'published');
}

/* ---------- 管理 ---------- */

export function openReports(db) {
  return (db.reports || []).filter((r) => r.status === 'open');
}

export function reportTargetLabel(db, report) {
  if (report.targetType === 'post') {
    const post = postOf(db, report.targetId);
    return post ? (post.title || stripMarkdown(post.body).slice(0, 24)) : '已删除的帖子';
  }
  const comment = byId(db.comments, report.targetId);
  return comment ? stripMarkdown(comment.body).slice(0, 24) : '已删除的评论';
}

/* ---------- 统计（演示，仅本地事件） ---------- */

export function eventSummary(db) {
  const events = db.events || [];
  const count = (type) => events.filter((e) => e.type === type).length;
  return {
    landing: count('resource_landing_view'),
    search: count('resource_search'),
    preview: count('resource_preview_view'),
    downloadAuthorized: count('resource_download_authorized'),
    downloadCompleted: count('resource_file_transfer_completed'),
    toCircle: count('resource_to_circle_view'),
    join: count('circle_join')
  };
}

export function searchEverywhere(db, { q = '', tab = 'posts', attachmentsOnly = false } = {}, now = Date.now()) {
  const keyword = String(q || '').trim().toLowerCase();
  const words = keyword ? keyword.split(/\s+/).filter(Boolean) : [];
  const match = (text) => {
    const value = String(text || '').toLowerCase();
    return words.every((w) => value.includes(w));
  };

  if (tab === 'courses') {
    const items = (db.courses || []).filter(
      (c) => !words.length || match(c.name) || match(c.code || '') || match(c.school)
    );
    return { tab, items };
  }
  if (tab === 'users') {
    const items = (db.users || []).filter(
      (u) => u.status === 'active' && (!words.length || match(u.nickname) || match(u.bio || ''))
    );
    return { tab, items };
  }

  let posts = (db.posts || []).filter((p) => p.status === 'published');
  if (words.length) {
    posts = posts.filter((p) => {
      const course = courseOf(db, p.courseId);
      const circle = p.circleId ? circleOf(db, p.circleId) : null;
      const author = userOf(db, p.authorId);
      return (
        match(p.title || '') ||
        match(stripMarkdown(p.body)) ||
        match(course ? course.name : '') ||
        match((p.tags || []).join(' ')) ||
        match(author ? author.nickname : '') ||
        match(circle ? courseOf(db, circle.courseId)?.name || '' : '')
      );
    });
  }
  if (attachmentsOnly) posts = posts.filter((p) => attachmentsOf(db, p.id).length > 0);
  posts = posts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return { tab: 'posts', items: posts };
}

/** 本人经验流水（含来源可访问性），只用于我的成长页 */
export function xpLedger(db, userId) {
  return (db.xp || [])
    .filter((row) => row.userId === userId)
    .slice()
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .map((row) => {
      let title = '';
      let link = '';
      if (row.sourceType === 'post') {
        const post = postOf(db, row.sourceId);
        title = post ? (post.title || truncate(post.body, 30)) : '来源已删除或暂不可见';
        link = post && post.status === 'published' ? `#/posts/${post.id}` : '';
      } else if (row.sourceType === 'comment' || row.sourceType === 'accepted') {
        const comment = byId(db.comments, row.sourceId);
        const post = comment ? postOf(db, comment.postId) : null;
        title = post ? `在「${post.title || truncate(post.body, 24)}」下的评论` : '来源已删除或暂不可见';
        link = post && post.status === 'published' ? `#/posts/${post.id}` : '';
      } else if (row.sourceType === 'marker') {
        const post = postOf(db, (row.meta || {}).postId);
        title = post ? `收到页签 · 「${post.title || truncate(post.body, 24)}」` : '收到页签（来源已删除）';
        link = post && post.status === 'published' ? `#/posts/${post.id}` : '';
      } else if (row.sourceType === 'seed') {
        title = '演示历史经验';
      } else {
        title = '经验记录';
      }
      return { ...row, title, link, removed: row.kind === 'revoke' };
    });
}

/** 今日已计分的正向奖励次数（按上海自然日） */
export function growthToday(db, userId, now = Date.now()) {
  const day = shanghaiDate(new Date(now));
  const rows = (db.growthDecisions || []).filter((d) => d.userId === userId
    && d.amount > 0 && d.grantedDay === day);
  return {
    day,
    post: rows.filter((d) => d.type === 'post').length,
    comment: rows.filter((d) => d.type === 'comment').length,
    accepted: rows.filter((d) => d.type === 'accepted').length,
    marker: rows.filter((d) => d.type === 'marker')
      .reduce((sum, d) => sum + ((d.meta || {}).qty || 1), 0)
  };
}


/** 今日页签榜：按今天收到的页签数给帖子排序（同数按标题） */
export function bookmarkBoard(db, { date = shanghaiDate(new Date()), limit = 5 } = {}) {
  const counts = new Map();
  for (const gift of db.gifts || []) {
    if (gift.status !== 'active' || gift.day !== date || !gift.postId) continue;
    counts.set(gift.postId, (counts.get(gift.postId) || 0) + (gift.qty || 1));
  }
  return [...counts.entries()]
    .map(([postId, count]) => ({ post: postOf(db, postId), count }))
    .filter((row) => row.post)
    .sort((a, b) => b.count - a.count || String(a.post.title || '').localeCompare(String(b.post.title || ''), 'zh'))
    .slice(0, Math.max(1, limit));
}

