/* 已确认的源码演示帖子。迁移必须同时匹配固定 ID、标题和正文标记，
 * 避免误移除后来复用同一 ID 的真实内容。 */

import { removePost } from '../state/actions.js';

export const DEMO_POST_CLEANUP_VERSION = 1;

export const DEMO_POST_FIXTURES = Object.freeze([
  { id: 'p_calc_processing', title: '极限这章的错题（整理中）', bodyMarker: '还在整理，文件正在处理，暂时不能下载；完成后会更新到这一帖。' },
  { id: 'p_calc_discuss', title: '本周学习索引：连续性与导数定义', bodyMarker: '这一周讨论集中在连续性和导数定义。' },
  { id: 'p_py_recursion', title: '列表复制踩坑记录', bodyMarker: 'a=b、a[:] 和嵌套列表分开记了。' },
  { id: 'p_calc_notes', title: '极限这章，补了几处容易算错的地方', bodyMarker: '上次那版第 3 页漏写了条件，已经补上。' },
  { id: 'p_derivative_draft', title: '个人草稿：导数公式手写版', bodyMarker: '暂时不放到找资料里，等补完再公开' },
  { id: 'p_la_question', title: '这里为什么能交换两列？', bodyMarker: '我知道交换两列可以算行列式' },
  { id: 'p_py_copy', title: '列表切片以后，里面的小列表还是共用的', bodyMarker: '今天试了一下，外层确实复制了，内层还是同一个对象。' },
  { id: 'p_method_review', title: '复习的时候才发现符号一直记反', bodyMarker: '一个是转置，一个是逆，我笔记里居然连着写反了两处。' },
  { id: 'p_calc_failed', title: '报错截图（处理失败，待重传）', bodyMarker: '扫描的 PDF 被判定为异常文件，正在重新导出一份。' },
  { id: 'p_prob_help', title: null, bodyMarker: '导数定义那题我卡在最后一步了，为什么总比参考结果多一个负号？' },
  { id: 'p_phys_circuit', title: '这道电路题为什么要先做星三角变换？', bodyMarker: '直接列节点电压方程应该也能做，但会算出三个未知数。' },
  { id: 'p_la_solutions', title: '线代前三章，我自己用的复习清单', bodyMarker: '标了我反复卡住的几道题，不是老师划的重点。' },
  { id: 'p_calc_problems', title: '连续性这一页重写了', bodyMarker: '昨天回去看，发现原来那页只写结论没写条件。' },
  { id: 'p_py_notes', title: 'for和while总写乱，整理了一页对照', bodyMarker: '凌晨改了两处缩进。' },
  { id: 'p_ds_notes', title: '树与图遍历的手写笔记（含复杂度表）', bodyMarker: '前序中序后序画了同一棵树的三种结果' },
  { id: 'p_calc_old', title: '2025 秋期末前的极限整理', bodyMarker: '去年期末前整理的版本，题型偏计算。' }
]);

export function matchesDemoPostFixture(post, fixture) {
  return !!post
    && post.id === fixture.id
    && post.title === fixture.title
    && String(post.body || '').includes(fixture.bodyMarker);
}

/**
 * 对已确认的固定演示帖子调用应用现有永久移除动作。
 * ID、标题、正文标记必须全部匹配；其他帖子会保留。
 */
export function removeKnownDemoPosts(db, { now = Date.now(), reason = '移除已确认的源码演示样例' } = {}) {
  const previous = db.demoPostCleanup;
  if (previous && previous.version === DEMO_POST_CLEANUP_VERSION) {
    return {
      alreadyApplied: true,
      removedPostIds: previous.removedPostIds || [],
      skippedPostIds: previous.skippedPostIds || []
    };
  }

  const removedPostIds = [];
  const skippedPostIds = [];
  const admin = (db.users || []).find((user) => user && user.role === 'admin' && user.status === 'active');
  const originalSession = db.session;

  try {
    DEMO_POST_FIXTURES.forEach((fixture) => {
      const matches = (db.posts || []).filter((post) => post && post.id === fixture.id);
      if (!matches.length) return;
      if (matches.length !== 1 || !matchesDemoPostFixture(matches[0], fixture)) {
        skippedPostIds.push(fixture.id);
        return;
      }

      const post = matches[0];
      if (post.status === 'removed') return;
      if (!Array.isArray(db.attachments)) {
        skippedPostIds.push(fixture.id);
        return;
      }
      const author = (db.users || []).find((user) => user && user.id === post.authorId && user.status === 'active');
      const actor = admin || author;
      if (!actor) {
        skippedPostIds.push(fixture.id);
        return;
      }

      db.session = { userId: actor.id };
      const result = removePost(db, { postId: fixture.id, reason }, now);
      if (result && result.ok) removedPostIds.push(fixture.id);
      else skippedPostIds.push(fixture.id);
    });
  } finally {
    db.session = originalSession;
  }

  db.demoPostCleanup = {
    version: DEMO_POST_CLEANUP_VERSION,
    appliedAt: new Date(now).toISOString(),
    removedPostIds,
    skippedPostIds
  };
  return { alreadyApplied: false, removedPostIds, skippedPostIds };
}
