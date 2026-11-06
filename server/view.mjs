/* Explicit API projection: never spread the database, user records, or file records. */
const list = (db, key) => Array.isArray(db[key]) ? db[key] : [];
const fields = (row, keys) => Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, structuredClone(row[key])]));
const ownMap = (value, id, keys) => id && value?.[id] ? { [id]: fields(value[id], keys) } : {};
const PUBLIC_USER = ['id', 'nickname', 'avatar', 'bio', 'role', 'status', 'verified', 'joinedAt'];
const RESOURCE = ['id', 'postId', 'title', 'courseId', 'school', 'term', 'type', 'coverage', 'limitations', 'source', 'rights', 'indexEnabled', 'status', 'updatedAt'];

export function publicState(db, meId) {
  const me = list(db, 'users').find((u) => u.id === meId && u.status === 'active' && u.verified === true);
  const id = me?.id || null;
  const admin = me?.role === 'admin';
  const banned = new Set(list(db, 'users').filter((u) => u.status !== 'active').map((u) => u.id));
  const posts = list(db, 'posts').filter((p) => admin || (p.status === 'published' && !banned.has(p.authorId)));
  const postIds = new Set(posts.map((p) => p.id));
  const postMap = new Map(posts.map((p) => [p.id, p]));
  const publicPost = (p) => p?.status === 'published' && !banned.has(p.authorId);
  const blockedPosts = new Set(list(db, 'resources').filter((r) => ['blocked', 'failed', 'removed'].includes(r.status)).map((r) => r.postId));
  const attachments = list(db, 'attachments').filter((a) => {
    const p = postMap.get(a.postId);
    return p && ((a.status === 'ready' && !a.downloadBlocked && !blockedPosts.has(p.id) && publicPost(p)) || admin || p.authorId === id);
  }).map((a) => {
    const result = fields(a, ['id', 'postId', 'uploadId', 'kind', 'name', 'sizeBytes', 'pages', 'version', 'status', 'changeNote', 'downloadBlocked']);
    // URLs are reconstructed from opaque upload IDs, never physical path/scan output.
    result.path = a.status === 'ready' && !a.downloadBlocked && !blockedPosts.has(a.postId) && publicPost(postMap.get(a.postId)) && a.uploadId
      ? `/api/files/${encodeURIComponent(a.uploadId)}/download` : null;
    return result;
  });
  const readyPosts = new Set(attachments.filter((a) => a.status === 'ready' && a.path).map((a) => a.postId));
  const resources = list(db, 'resources').filter((r) => postIds.has(r.postId) &&
    (admin || (publicPost(postMap.get(r.postId)) && ['indexed', 'unindexed'].includes(r.status) && readyPosts.has(r.postId))))
    .map((r) => {
      const row = fields(r, RESOURCE);
      const file = attachments.find((a) => a.postId === r.postId && a.path);
      row.previews = file?.uploadId ? [1, 2].slice(0, Math.min(2, Number(file.pages) || 1))
        .map((page) => `/api/files/${encodeURIComponent(file.uploadId)}/preview/${page}`) : [];
      return row;
    });
  const postCounts = {};
  for (const p of posts) {
    const reactions = list(db, 'reactions').filter((r) => r.postId === p.id && !banned.has(r.userId));
    const gifts = list(db, 'gifts').filter((g) => g.postId === p.id && g.status === 'active');
    postCounts[p.id] = {
      like: reactions.filter((r) => r.kind === 'like').length,
      save: reactions.filter((r) => r.kind === 'save').length,
      comments: list(db, 'comments').filter((c) => c.postId === p.id && c.status === 'visible' && !banned.has(c.authorId)).length,
      commenters: new Set(list(db, 'comments').filter((c) => c.postId === p.id && c.status === 'visible' && !banned.has(c.authorId)).map((c) => c.authorId)).size,
      giftQty: gifts.reduce((sum, g) => sum + (Number(g.qty) || 0), 0),
      gifters: new Set(gifts.map((g) => g.senderId)).size
    };
  }
  const memberCounts = {};
  for (const m of list(db, 'memberships')) if (m.status === 'active' && !banned.has(m.userId)) memberCounts[m.circleId] = (memberCounts[m.circleId] || 0) + 1;
  const userStats = {};
  for (const user of list(db, 'users')) userStats[user.id] = {
    xp: list(db, 'xp').filter((x) => x.userId === user.id).reduce((sum, x) => sum + (Number(x.delta) || 0), 0),
    followers: list(db, 'follows').filter((f) => f.targetType === 'user' && f.targetId === user.id && !banned.has(f.followerId)).length,
    following: list(db, 'follows').filter((f) => f.followerId === user.id).length,
    receivedGiftQty: list(db, 'gifts').filter((g) => g.receiverId === user.id && g.status === 'active').reduce((sum, g) => sum + (Number(g.qty) || 0), 0)
  };
  const own = (key, keys) => list(db, key).filter((row) => id && row.userId === id).map((row) => fields(row, keys));
  // 首屏只下发「我的圈 + 有公开帖子的圈」；其余圈走 /api/circles/index 按需缓存
  const myCircleIds = new Set(list(db, 'memberships')
    .filter((m) => m.userId === id && m.status === 'active').map((m) => m.circleId));
  const activeCircleIds = new Set(posts.filter((p) => p.circleId).map((p) => p.circleId));
  const state = {
    version: db.version, revision: db.revision || 0, production: !!db.production, demo: false,
    session: id ? { userId: id } : null,
    users: list(db, 'users').map((u) => ({ ...fields(u, PUBLIC_USER), email: u.id === id ? u.email : '' })),
    // 首屏只下发「我的圈 + 有公开帖子的圈」；其余圈走 /api/circles/index 按需缓存
    // const myCircleIds = new Set(list(db, 'memberships')
    // .filter((m) => m.userId === id && m.status === 'active').map((m) => m.circleId));
    // const activeCircleIds = new Set(posts.filter((p) => p.circleId).map((p) => p.circleId));
    courses: list(db, 'courses').map((c) => fields(c, ['id', 'school', 'name'])),
    circles: list(db, 'circles')
    .filter((c) => admin || myCircleIds.has(c.id) || activeCircleIds.has(c.id))
    .map((c) => ({ ...fields(c, ['id', 'courseId', 'status', 'createdAt', 'pinnedPostId', 'archivedAt']), memberCount: memberCounts[c.id] || 0 })),
    memberships: own('memberships', ['userId', 'circleId', 'status', 'muted', 'moderationMuted', 'shelved', 'joinedAt', 'lastSeenAt', 'writeRestricted']),
    posts: posts.map((p) => ({ ...fields(p, ['id', 'authorId', 'board', 'circleId', 'courseId', 'title', 'body', 'stickerId', 'tags', 'status', 'publishedAt', 'editedAt', 'acceptedCommentId', 'contentUpdatedAt', 'confirmedOriginal', 'term', 'chapter']),
      images: (Array.isArray(p.images) ? p.images : []).filter((src) => /^\/api\/files\/[0-9a-f-]{36}\/image$/.test(String(src))),
      ...(admin ? fields(p, ['moderatedAt', 'moderatedBy', 'moderateReason', 'removedAt', 'removeReason']) : {}) })),
    comments: list(db, 'comments').filter((c) => postIds.has(c.postId) && (admin || c.status === 'visible' && !banned.has(c.authorId)))
      .map((c) => fields(c, ['id', 'postId', 'authorId', 'parentId', 'replyToUserId', 'body', 'stickerId', 'status', 'createdAt', 'editedAt'])),
    attachments, resources, postCounts, memberCounts, userStats,
    counts: { posts: postCounts, members: memberCounts, users: userStats },
    reactions: own('reactions', ['id', 'userId', 'postId', 'kind', 'createdAt']).filter((r) => postIds.has(r.postId)),
    follows: list(db, 'follows').filter((f) => id && f.followerId === id).map((f) => fields(f, ['id', 'followerId', 'targetType', 'targetId', 'createdAt'])),
    courseCollections: list(db, 'courseCollections').filter((r) => postIds.has(r.postId)).map((r) => fields(r, ['postId', 'courseId', 'authorId', 'createdAt', 'note'])),
    wallets: ownMap(db.wallets, id, ['balance']),
    ledger: own('ledger', ['id', 'userId', 'type', 'amount', 'delta', 'balanceAfter', 'giftId', 'postId', 'day', 'date', 'createdAt', 'at', 'reason']),
    claims: own('claims', ['id', 'userId', 'date', 'amount', 'ledgerId', 'createdAt', 'at']),
    gifts: list(db, 'gifts').filter((g) => id && (g.senderId === id || g.receiverId === id)).map((g) => fields(g, ['id', 'postId', 'senderId', 'receiverId', 'qty', 'status', 'day', 'createdAt', 'refundedAt'])),
    xp: own('xp', ['id', 'userId', 'sourceType', 'sourceId', 'delta', 'kind', 'decisionId', 'reason', 'at']),
    growthDecisions: own('growthDecisions', ['id', 'userId', 'type', 'sourceId', 'amount', 'reason', 'status', 'grantedDay', 'at', 'rulesVersion', 'revokedAt', 'revokeReason', 'restoredAt']),
    notifications: own('notifications', ['id', 'userId', 'actorId', 'type', 'postId', 'commentId', 'text', 'readAt', 'createdAt']),
    prefs: ownMap(db.prefs, id, ['replies', 'gifts', 'system']),
    drafts: id && db.drafts?.[id] ? { [id]: { ...fields(db.drafts[id], ['postTitle', 'body', 'updatedAt']), resource: fields(db.drafts[id].resource || {}, RESOURCE) } } : {},
    reports: admin ? list(db, 'reports').map((r) => fields(r, ['id', 'reporterId', 'targetType', 'targetId', 'reason', 'detail', 'status', 'resolution', 'handledBy', 'createdAt', 'handledAt'])) : [],
    audit: admin ? list(db, 'audit').map((a) => fields(a, ['id', 'actorId', 'action', 'target', 'reason', 'at'])) : [],
    applications: admin ? list(db, 'applications').map((a) => fields(a, ['id', 'userId', 'courseId', 'reason', 'status', 'createdAt', 'handledAt', 'handledBy', 'resolution'])) : [],
    events: []
  };
  return state;
}
