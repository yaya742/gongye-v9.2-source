/* 演示数据种子（demo-static 模式）
 *
 * 所有内容都是明确标注的演示数据，不是真实用户、真实课程或真实文件。
 * 结构参照 02-DeepSeek执行指导书.md C 节的数据模型，但这是浏览器内的
 * 演示数据仓库，不代表生产数据库。生产环境必须用真实 API 替换（见 README）。
 */

import { applyArtV3 } from './demo-v3.js';
import { removeKnownDemoPosts } from './demo-post-cleanup.js';
import { ZJU_COURSES, ZJU_TERM, ZJU_SCHOOL } from './zju-courses-2026aw.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/**
 * @param {number} now 基准时间
 * @param {{ keepDemoPosts?: boolean }} [options] 测试用：保留演示帖子，让规则测试有内容可测。
 *   默认仍按固定清单移除，新访客看到的是空站。
 */
export function createSeed(now = Date.now(), options = {}) {
  const iso = (ms) => new Date(ms).toISOString();
  const at = (hoursAgo) => iso(now - hoursAgo * HOUR);
  const atDay = (daysAgo) => iso(now - daysAgo * DAY);

  const users = [
    {
      id: 'u_qinghe', email: 'qinghe@example.com', nickname: '清禾', avatar: 'avatar-01.svg',
      bio: '慢慢整理，也慢慢学。', role: 'user', status: 'active', verified: true, joinedAt: atDay(120)
    },
    {
      id: 'u_linjian', email: 'linjian@example.com', nickname: '林间', avatar: 'avatar-02.svg',
      bio: '线代和概率来回横跳，正在补基础。', role: 'user', status: 'active', verified: true, joinedAt: atDay(98)
    },
    {
      id: 'u_alan', email: 'alan@example.com', nickname: '阿岚', avatar: 'avatar-03.svg',
      bio: '写代码，也写笔记。', role: 'user', status: 'active', verified: true, joinedAt: atDay(76)
    },
    {
      id: 'u_zhixia', email: 'zhixia@example.com', nickname: '知夏', avatar: 'avatar-05.svg',
      bio: '喜欢把公式讲成一句话。', role: 'user', status: 'active', verified: true, joinedAt: atDay(64)
    },
    {
      id: 'u_zhouzhou', email: 'zhouzhou@example.com', nickname: '舟舟', avatar: 'avatar-06.svg',
      bio: '复习季才会出现的同学。', role: 'user', status: 'active', verified: true, joinedAt: atDay(210)
    },
    {
      id: 'u_nanzhi', email: 'nanzhi@example.com', nickname: '南枝', avatar: 'avatar-04.svg',
      bio: '在旧教学班的资料里翻东西。', role: 'user', status: 'active', verified: true, joinedAt: atDay(300)
    },
    {
      id: 'u_admin', email: 'admin@gongye.test', nickname: '管理员测试', avatar: 'art/avatar-01.svg',
      bio: '处理举报与建圈申请。仅演示角色。', role: 'admin', status: 'active', verified: true, joinedAt: atDay(320)
    }
  ];

  const courses = [
    { id: 'c_calc', school: '浙江大学', name: '微积分Ⅰ', code: 'MATH1001', category: '数学基础' },
    { id: 'c_la', school: '浙江大学', name: '线性代数', code: 'MATH1002', category: '数学基础' },
    { id: 'c_py', school: '浙江大学', name: 'Python 程序设计', code: 'CS1003', category: '计算机' },
    { id: 'c_ds', school: '浙江大学', name: '数据结构', code: 'CS2001', category: '计算机' },
    { id: 'c_prob', school: '浙江大学', name: '概率论与数理统计', code: 'MATH2001', category: '数学基础' },
    { id: 'c_phys', school: '浙江大学', name: '大学物理Ⅱ', code: 'PHYS1002', category: '物理' },
    { id: 'c_general', school: '通用·不限学校', name: '通用学习', code: null, category: '学习方法' }
  ];

  /* 9.2：一门课程只有一个共用课友圈，不再区分教学班、教师与学期。
   * 圈只挂课程；学期属于帖子/资料自己的属性。 */
  const circles = [
    {
      id: 'ci_calc_a', courseId: 'c_calc', status: 'active', createdBy: 'u_qinghe',
      inviteCode: 'GY-CALC', createdAt: atDay(40), pinnedPostId: 'p_calc_discuss'
    },
    {
      id: 'ci_la_a', courseId: 'c_la', status: 'active', createdBy: 'u_linjian',
      inviteCode: 'GY-LA', createdAt: atDay(35), pinnedPostId: null
    },
    {
      id: 'ci_py_b', courseId: 'c_py', status: 'active', createdBy: 'u_alan',
      inviteCode: 'GY-PY', createdAt: atDay(30), pinnedPostId: null
    },
    {
      id: 'ci_ds_a', courseId: 'c_ds', status: 'active', createdBy: 'u_zhouzhou',
      inviteCode: 'GY-DS', createdAt: atDay(22), pinnedPostId: null
    },
    {
      id: 'ci_prob', courseId: 'c_prob', status: 'active', createdBy: 'u_qinghe',
      inviteCode: 'GY-PROB', createdAt: atDay(26), pinnedPostId: null
    },
    {
      id: 'ci_phys', courseId: 'c_phys', status: 'active', createdBy: 'u_linjian',
      inviteCode: 'GY-PHYS', createdAt: atDay(24), pinnedPostId: null
    }
  ];

  /* 浙大 2026-2027 秋冬开课课程：清单只有课程名，一门课一个圈。
   * 与演示课程同名的（数据结构、概率论与数理统计）复用课程和已有的圈。 */
  const zjuCourses = [];
  for (const [index, entry] of ZJU_COURSES.entries()) {
    const existing = courses.find((course) => course.name === entry.name);
    const courseId = existing ? existing.id : entry.id;
    if (!existing) {
      zjuCourses.push({ id: entry.id, school: ZJU_SCHOOL, name: entry.name, code: null, category: '本科课程' });
    }
    if (circles.some((circle) => circle.courseId === courseId)) continue;
    const key = String(entry.id).replace(/^zj_/, '');
    circles.push({
      id: `zjc_${key}`,
      courseId,
      status: 'active',
      createdBy: 'u_admin',
      inviteCode: `ZJ-${key.toUpperCase()}`,
      createdAt: iso(now - (index + 1) * 1000),
      pinnedPostId: null
    });
  }
  courses.push(...zjuCourses);

  const memberships = [];
  const mem = (userId, circleId, extra = {}) => {
    memberships.push({
      userId, circleId, status: 'active', muted: false, shelved: false,
      joinedAt: atDay(30), lastSeenAt: at(6), writeRestricted: false, ...extra
    });
  };
  mem('u_qinghe', 'ci_calc_a', { joinedAt: atDay(40), lastSeenAt: at(2) });
  mem('u_qinghe', 'ci_py_b', { joinedAt: atDay(28), lastSeenAt: at(20) });
  mem('u_zhixia', 'ci_calc_a', { joinedAt: atDay(39), lastSeenAt: at(1) });
  mem('u_zhixia', 'ci_calc_b', { joinedAt: atDay(20), lastSeenAt: at(30) });
  mem('u_alan', 'ci_py_b', { joinedAt: atDay(30), lastSeenAt: at(1) });
  mem('u_alan', 'ci_calc_a', { joinedAt: atDay(26), lastSeenAt: at(12) });
  mem('u_linjian', 'ci_la_a', { joinedAt: atDay(34), lastSeenAt: at(3) });
  mem('u_nanzhi', 'ci_la_a', { joinedAt: atDay(18), lastSeenAt: at(40) });
  mem('u_zhouzhou', 'ci_ds_a', { joinedAt: atDay(21), lastSeenAt: at(5) });
  mem('u_nanzhi', 'ci_calc_old', { joinedAt: atDay(350), lastSeenAt: atDay(60) });
  mem('u_zhouzhou', 'ci_calc_old', { joinedAt: atDay(340), lastSeenAt: atDay(90) });

  const attachments = [];
  const posts = [];

  const addAttachment = (postId, data) => {
    const att = {
      id: `at_${attachments.length + 1}`,
      postId,
      kind: 'pdf',
      name: data.name,
      sizeBytes: data.sizeBytes,
      pages: data.pages,
      version: data.version || 1,
      status: data.status || 'ready',
      path: data.path || null,
      changeNote: data.changeNote || '',
      demo: true
    };
    attachments.push(att);
    return att.id;
  };

  const post = (data) => {
    posts.push({
      status: 'published',
      title: null,
      images: [],
      attachmentIds: [],
      tags: [],
      editedAt: null,
      acceptedCommentId: null,
      contentUpdatedAt: data.publishedAt,
      ...data
    });
    return data.id;
  };

  /* 1. 微积分期中笔记（含真实演示 PDF 与预览） */
  const p1 = at(3);
  post({
    id: 'p_calc_notes', authorId: 'u_qinghe', board: 'notes',
    circleId: 'ci_calc_a', courseId: 'c_calc',
    title: '微积分期中笔记，先把前两章放上来',
    body: '整理到连续性了。夹逼那几道题加了我自己的理解，例题的上下界都写在旁边。\n\n'
      + '这版补了函数连续的三条件，分界点一定左右极限分别写。**导数和中值定理还没整理**，欢迎一起捉错。\n\n'
      + '> 如果发现符号写反，直接在资料讨论里指出，我会更新到下一版。',
    images: ['assets/art/note-sample-1.svg', 'assets/art/note-sample-2.svg'],
    attachmentIds: [addAttachment('p_calc_notes', {
      name: '微积分期中整理_数列极限与连续.pdf', sizeBytes: 2516582, pages: 18, version: 2,
      path: 'assets/samples/demo-calculus-notes.pdf', changeNote: '补上连续三条件与两道夹逼例题'
    })],
    tags: ['数列极限', '连续性'],
    publishedAt: p1
  });

  /* 2. 数列极限典型题（题解） */
  post({
    id: 'p_calc_problems', authorId: 'u_qinghe', board: 'notes',
    circleId: 'ci_calc_a', courseId: 'c_calc',
    title: '数列极限典型题的几种思路',
    body: '按单调有界、夹逼与递推关系分成三类。不是整门课的完整题库，只收了我做错过、后来又弄明白的题。',
    attachmentIds: [addAttachment('p_calc_problems', {
      name: '数列极限典型题_思路分类.pdf', sizeBytes: 1200000, pages: 12, version: 1,
      path: 'assets/samples/demo-calculus-notes.pdf'
    })],
    tags: ['数列极限', '题解'],
    publishedAt: at(26)
  });

  /* 3. 线性代数求助（有采纳答案） */
  post({
    id: 'p_la_question', authorId: 'u_linjian', board: 'help',
    circleId: 'ci_la_a', courseId: 'c_la',
    title: null,
    body: '线代这一步交换两列以后，为什么答案还要变号？我是不是把行列式和矩阵的规则混了……\n\n'
      + '我试着按定义展开，但写到置换的奇偶性就卡住了。',
    tags: ['行列式'],
    acceptedCommentId: 'cm_la_answer',
    publishedAt: at(5)
  });

  /* 4. Python 递归心得（学习方法） */
  post({
    id: 'p_py_recursion', authorId: 'u_alan', board: 'method',
    circleId: 'ci_py_b', courseId: 'c_py',
    title: '终于弄明白递归里的 return 回哪儿了',
    body: '每次调用都有自己的那一份变量，不能脑补成大家共用一个 n。\n\n'
      + '```python\n'
      + 'def f(n):\n'
      + '    if n == 1:\n'
      + '        return 1\n'
      + '    return n * f(n - 1)\n'
      + '```\n\n'
      + '把调用栈画成一张纸，从最里面那层往回写返回值，一下就清楚了。',
    tags: ['递归', '调试'],
    publishedAt: at(2)
  });

  /* 5. Python 语法速查（资料） */
  post({
    id: 'p_py_notes', authorId: 'u_alan', board: 'notes',
    circleId: 'ci_py_b', courseId: 'c_py',
    title: 'Python 前四章语法速查（含容易踩的坑）',
    body: '按章节列了变量、类型转换、条件与循环、函数四块。每块后面写了我在作业里踩过的坑，比如可变默认参数。',
    attachmentIds: [addAttachment('p_py_notes', {
      name: 'Python前四章语法速查.pdf', sizeBytes: 900000, pages: 9, version: 1,
      path: 'assets/samples/demo-python-notes.pdf'
    })],
    tags: ['语法', '函数'],
    publishedAt: at(30)
  });

  /* 6. 课程讨论（被置顶的「本周学习索引」） */
  post({
    id: 'p_calc_discuss', authorId: 'u_zhixia', board: 'course',
    circleId: 'ci_calc_a', courseId: 'c_calc',
    title: '本周学习索引：连续性与导数定义',
    body: '这一周讨论集中在连续性与导数定义。下面是同学整理的三条链接，欢迎补充：\n\n'
      + '1. 连续的三个条件与分段函数分界点\n'
      + '2. 导数定义的两种写法与可导必连续\n'
      + '3. 夹逼准则在数列题里的三种用法\n\n'
      + '只是同学手动整理，不是学校通知。',
    tags: ['本周索引'],
    publishedAt: at(1)
  });

  /* 7. 线代题解资料 */
  post({
    id: 'p_la_solutions', authorId: 'u_linjian', board: 'notes',
    circleId: 'ci_la_a', courseId: 'c_la',
    title: '行列式换列变号 · 三道典型题整理',
    body: '把「行列式变号」和「矩阵初等变换」的差别单独列了一节，附三道例题的完整推导。',
    attachmentIds: [addAttachment('p_la_solutions', {
      name: '行列式与矩阵典型题.pdf', sizeBytes: 1500000, pages: 11, version: 1,
      path: 'assets/samples/demo-linear-algebra.pdf'
    })],
    tags: ['行列式', '初等变换'],
    publishedAt: at(20)
  });

  /* 8. 归档学期的旧资料 */
  post({
    id: 'p_calc_old', authorId: 'u_nanzhi', board: 'notes',
    circleId: 'ci_calc_old', courseId: 'c_calc',
    title: '2025 秋期末复习：极限与连续',
    body: '去年期末前整理的版本，题型偏计算。学期不同，教学进度可能对不上，请先核对。',
    attachmentIds: [addAttachment('p_calc_old', {
      name: '2025秋_极限与连续复习.pdf', sizeBytes: 1800000, pages: 14, version: 1,
      path: 'assets/samples/demo-calculus-notes.pdf'
    })],
    tags: ['期末复习'],
    publishedAt: atDay(300)
  });

  /* 9. 学习方法（不挂圈，课程为通用学习） */
  post({
    id: 'p_method_review', authorId: 'u_zhouzhou', board: 'method',
    circleId: null, courseId: 'c_general',
    title: '我用「先写问题再查资料」复盘的四周',
    body: '以前查资料是先收藏再说，结果收藏夹里全是没看过的 PDF。这四周改成先写清问题再查，效果差别很大：\n\n'
      + '- 写问题的过程会暴露自己到底哪一步不懂\n'
      + '- 查到的资料只留能回答那一句的\n'
      + '- 一周后回看问题清单，能看出薄弱章节\n\n'
      + '不保证对每个人都有效，只是我自己的复盘。',
    tags: ['复盘', '学习方法'],
    publishedAt: at(8)
  });

  /* 10. 概率论求助（无圈） */
  post({
    id: 'p_prob_help', authorId: 'u_nanzhi', board: 'help',
    circleId: null, courseId: 'c_prob',
    title: null,
    body: '条件概率这题为什么不是 1/2？我先把样本空间写成四个等可能结果，但老师说要看条件之后的新样本空间。',
    tags: ['条件概率'],
    publishedAt: at(12)
  });

  /* 11. 数据结构笔记（无圈资料） */
  post({
    id: 'p_ds_notes', authorId: 'u_zhouzhou', board: 'notes',
    circleId: null, courseId: 'c_ds',
    title: '树与图遍历的手写笔记（含复杂度表）',
    body: '前序中序后序画了同一棵树的三种结果，图那部分整理了 BFS/DFS 的队列与栈差别，最后附一张复杂度对照表。',
    attachmentIds: [addAttachment('p_ds_notes', {
      name: '树与图遍历笔记.pdf', sizeBytes: 2100000, pages: 16, version: 1,
      path: 'assets/samples/demo-python-notes.pdf'
    })],
    tags: ['树', '图', '复杂度'],
    publishedAt: at(40)
  });

  /* 12. 处理中：扫描未完成，不进入资料索引 */
  post({
    id: 'p_calc_processing', authorId: 'u_qinghe', board: 'notes',
    circleId: 'ci_calc_a', courseId: 'c_calc',
    title: '极限计算 20 题（整理中）',
    body: '还在整理，文件正在处理，暂时不能下载；完成后会更新到这一帖。',
    attachmentIds: [addAttachment('p_calc_processing', {
      name: '极限计算20题.pdf', sizeBytes: 3200000, pages: null, version: 1,
      status: 'processing', path: null
    })],
    tags: ['极限'],
    publishedAt: at(0.5)
  });

  /* 13. 作者未开启公开索引 */
  post({
    id: 'p_derivative_draft', authorId: 'u_zhixia', board: 'notes',
    circleId: 'ci_calc_a', courseId: 'c_calc',
    title: '个人草稿：导数公式手写版',
    body: '自己用的手写版，暂时不放到找资料里，等补完再公开。',
    attachmentIds: [addAttachment('p_derivative_draft', {
      name: '导数公式手写版.pdf', sizeBytes: 800000, pages: 6, version: 1,
      path: 'assets/samples/demo-calculus-notes.pdf'
    })],
    tags: ['导数'],
    publishedAt: at(4)
  });

  /* 14. 扫描失败的附件 */
  post({
    id: 'p_calc_failed', authorId: 'u_linjian', board: 'notes',
    circleId: null, courseId: 'c_calc',
    title: '极限习题扫描件（处理失败，待替换）',
    body: '扫描的 PDF 被判定为异常文件，正在重新导出一份。现在这份不能下载。',
    attachmentIds: [addAttachment('p_calc_failed', {
      name: '极限习题扫描.pdf', sizeBytes: 5400000, pages: null, version: 1,
      status: 'failed', path: null
    })],
    tags: ['极限'],
    publishedAt: at(9)
  });

  /* 15. 物理讨论（无附件，含代码块） */
  post({
    id: 'p_phys_circuit', authorId: 'u_zhixia', board: 'course',
    circleId: null, courseId: 'c_phys',
    title: '这道电路题为什么要先做星三角变换？',
    body: '直接列节点电压方程应该也能做，但会算出三个未知数。老师课上先做了一次星三角变换化简，我想知道判断依据是什么。',
    tags: ['电路'],
    publishedAt: at(18)
  });

  /* 资料索引：只是原帖的结构化描述，不复制附件或评论 */
  const resources = [
    {
      id: 'r_calc_notes', postId: 'p_calc_notes', title: '数列极限与函数连续 · 期中复习笔记',
      courseId: 'c_calc', school: '浙江大学', term: '2026秋', type: '复习整理',
      coverage: '数列极限、函数极限与连续性；含夹逼与单调有界的推导过程',
      limitations: '不含导数、中值定理；第 12 页之后为草稿，请结合本学期进度使用',
      indexEnabled: true, status: 'indexed', updatedAt: at(3),
      previews: ['assets/previews/calc-notes-p1.svg', 'assets/previews/calc-notes-p2.svg']
    },
    {
      id: 'r_calc_problems', postId: 'p_calc_problems', title: '数列极限典型题 · 思路分类与错题',
      courseId: 'c_calc', school: '浙江大学', term: '2026秋', type: '题解',
      coverage: '单调有界、夹逼、递推关系三类题型的做法对照',
      limitations: '只有 12 道题，不是完整题库；不含答案以外的解法讨论',
      indexEnabled: true, status: 'indexed', updatedAt: at(26),
      previews: ['assets/previews/calc-notes-p2.svg']
    },
    {
      id: 'r_la_solutions', postId: 'p_la_solutions', title: '行列式与矩阵典型题（含换列变号说明）',
      courseId: 'c_la', school: '浙江大学', term: '2026秋', type: '题解',
      coverage: '行列式定义与性质、初等变换、三道典型题的完整推导',
      limitations: '未覆盖特征值与二次型',
      indexEnabled: true, status: 'indexed', updatedAt: at(20),
      previews: ['assets/previews/la-solutions-p1.svg']
    },
    {
      id: 'r_py_notes', postId: 'p_py_notes', title: 'Python 前四章语法速查 + 踩坑记录',
      courseId: 'c_py', school: '浙江大学', term: '2026秋', type: '笔记',
      coverage: '变量与类型、条件与循环、函数与作用域、常见报错',
      limitations: '不含面向对象与文件操作；示例按本学期教学班进度整理',
      indexEnabled: true, status: 'indexed', updatedAt: at(30),
      previews: ['assets/previews/calc-notes-p1.svg']
    },
    {
      id: 'r_ds_notes', postId: 'p_ds_notes', title: '树与图遍历手写笔记（含复杂度对照表）',
      courseId: 'c_ds', school: '浙江大学', term: '2026秋', type: '笔记',
      coverage: '二叉树三种遍历、BFS/DFS、邻接表与矩阵的复杂度',
      limitations: '不含平衡树与最短路径算法的证明',
      indexEnabled: true, status: 'indexed', updatedAt: at(40),
      previews: ['assets/previews/calc-notes-p2.svg']
    },
    {
      id: 'r_calc_old', postId: 'p_calc_old', title: '2025 秋期末复习：极限与连续',
      courseId: 'c_calc', school: '浙江大学', term: '2025秋', type: '复习整理',
      coverage: '2025 秋期末范围内的极限计算与连续性判断',
      limitations: '学期不同，章节顺序与今年不一致；仅作参考',
      indexEnabled: true, status: 'indexed', updatedAt: atDay(300),
      previews: ['assets/previews/calc-notes-p1.svg']
    }
  ];

  /* 评论（两层结构：主评论 + 回复） */
  const comments = [];
  const cm = (data) => {
    comments.push({
      parentId: null, replyToUserId: null, status: 'visible', editedAt: null, ...data
    });
    return data.id;
  };

  cm({
    id: 'cm_la_answer', postId: 'p_la_question', authorId: 'u_zhixia', createdAt: at(4),
    body: '行列式的定义是带符号的求和，交换两列等于对列指标做一次对换，置换奇偶性翻转，所以整体变号。\n\n'
      + '矩阵交换两列只是初等列变换，矩阵本身没有“变号”这回事——你把两个对象的运算规则混在一起了。'
  });
  cm({
    id: 'cm_la_reply1', postId: 'p_la_question', authorId: 'u_linjian', parentId: 'cm_la_answer',
    replyToUserId: 'u_zhixia', createdAt: at(3.4), body: '懂了，是置换的奇偶性。我再去看一遍定义里那个 (−1)^τ。'
  });
  cm({
    id: 'cm_la_reply2', postId: 'p_la_question', authorId: 'u_nanzhi', parentId: 'cm_la_answer',
    replyToUserId: 'u_zhixia', createdAt: at(3), body: '补一句：|kA| = kⁿ|A| 也常被写成 k|A|，一起记。'
  });

  cm({
    id: 'cm_calc_1', postId: 'p_calc_notes', authorId: 'u_zhixia', createdAt: at(2.5),
    body: '第二页那个符号可能写反了？左边应当是小于等于吧。'
  });
  cm({
    id: 'cm_calc_1_r', postId: 'p_calc_notes', authorId: 'u_qinghe', parentId: 'cm_calc_1',
    replyToUserId: 'u_zhixia', createdAt: at(2.2), body: '确实，已经改到 v2 了，谢谢提醒。'
  });
  cm({
    id: 'cm_calc_2', postId: 'p_calc_notes', authorId: 'u_alan', createdAt: at(1.5),
    body: '这个例题的条件写清楚以后好懂多了。夹逼那部分建议再补一道两端都随 n 变的题。'
  });
  cm({
    id: 'cm_calc_3', postId: 'p_calc_notes', authorId: 'u_zhouzhou', createdAt: at(0.8),
    body: '下载了，先对着课堂笔记过一遍。'
  });

  cm({
    id: 'cm_py_1', postId: 'p_py_recursion', authorId: 'u_qinghe', createdAt: at(1.2),
    body: '画调用栈这招好用。我是把返回值写成箭头，一路指回去。'
  });
  cm({
    id: 'cm_py_1_r', postId: 'p_py_recursion', authorId: 'u_alan', parentId: 'cm_py_1',
    replyToUserId: 'u_qinghe', createdAt: at(1), body: '对，箭头往回画就不容易丢层。'
  });

  cm({
    id: 'cm_discuss_1', postId: 'p_calc_discuss', authorId: 'u_qinghe', createdAt: at(0.6),
    body: '补充一条：可导必连续，但连续不一定可导，反例用 |x| 就够。'
  });
  cm({
    id: 'cm_method_1', postId: 'p_method_review', authorId: 'u_linjian', createdAt: at(6),
    body: '“只留能回答那一句的”这条很受用，我以前收藏夹就是这么爆的。'
  });
  cm({
    id: 'cm_prob_1', postId: 'p_prob_help', authorId: 'u_zhixia', createdAt: at(10),
    body: '条件概率要在已知发生的事件上重新标准化，样本空间变小了，等可能也不再成立。'
  });
  cm({
    id: 'cm_ds_1', postId: 'p_ds_notes', authorId: 'u_alan', createdAt: at(36),
    body: '复杂度表很清楚，BFS 用队列那栏建议标一下空间是 O(V)。'
  });
  cm({
    id: 'cm_phys_1', postId: 'p_phys_circuit', authorId: 'u_linjian', createdAt: at(17),
    body: '星三角变换一般是为了把没有直接串并联关系的三个电阻化简，节点电压方程也能做，只是未知数多。'
  });

  /* 互动 */
  const reactions = [
    { userId: 'u_zhixia', postId: 'p_calc_notes', kind: 'like', createdAt: at(2.4) },
    { userId: 'u_alan', postId: 'p_calc_notes', kind: 'like', createdAt: at(1.5) },
    { userId: 'u_linjian', postId: 'p_calc_notes', kind: 'save', createdAt: at(2.9) },
    { userId: 'u_zhixia', postId: 'p_calc_notes', kind: 'save', createdAt: at(2.1) },
    { userId: 'u_zhouzhou', postId: 'p_calc_notes', kind: 'save', createdAt: at(0.9) },
    { userId: 'u_qinghe', postId: 'p_la_solutions', kind: 'like', createdAt: at(19) },
    { userId: 'u_nanzhi', postId: 'p_la_solutions', kind: 'save', createdAt: at(18) },
    { userId: 'u_qinghe', postId: 'p_py_recursion', kind: 'like', createdAt: at(1.1) },
    { userId: 'u_qinghe', postId: 'p_calc_problems', kind: 'save', createdAt: at(24) },
    { userId: 'u_alan', postId: 'p_calc_problems', kind: 'save', createdAt: at(25) },
    { userId: 'u_qinghe', postId: 'p_ds_notes', kind: 'save', createdAt: at(39) }
  ];

  const follows = [
    { followerId: 'u_linjian', targetType: 'user', targetId: 'u_qinghe', createdAt: atDay(20) },
    { followerId: 'u_zhixia', targetType: 'user', targetId: 'u_qinghe', createdAt: atDay(18) },
    { followerId: 'u_alan', targetType: 'user', targetId: 'u_qinghe', createdAt: atDay(12) },
    { followerId: 'u_qinghe', targetType: 'user', targetId: 'u_zhixia', createdAt: atDay(10) },
    { followerId: 'u_qinghe', targetType: 'course', targetId: 'c_calc', createdAt: atDay(30) }
  ];

  /* 页签：钱包、流水、领取、赠送（余额由流水推出来，保证自洽） */
  const wallets = {};
  const ledger = [];
  const claims = [];
  const gifts = [];

  const addLedger = (userId, type, delta, when, sourceId, note) => {
    const prev = wallets[userId] ? wallets[userId].balance : 0;
    const balanceAfter = prev + delta;
    const id = `lg_${ledger.length + 1}`;
    wallets[userId] = { userId, balance: balanceAfter, updatedAt: when };
    ledger.push({ id, userId, delta, type, sourceId, balanceAfter, at: when, note });
    return id;
  };

  addLedger('u_qinghe', 'seed', 3, atDay(6), null, '演示初始余额');
  const claimYesterday = addLedger('u_qinghe', 'claim', 1, atDay(1), null, '每日领取');
  addLedger('u_qinghe', 'gift_out', -1, atDay(1), 'p_py_recursion', '送给阿岚的递归帖');
  claims.push({ userId: 'u_qinghe', date: shDateOf(atDay(1)), ledgerId: claimYesterday, at: atDay(1) });

  addLedger('u_zhixia', 'seed', 5, atDay(5), null, '演示初始余额');
  const claimZhixia = addLedger('u_zhixia', 'claim', 1, at(2), null, '每日领取');
  addLedger('u_zhixia', 'gift_out', -2, at(1.8), 'p_calc_notes', '送给清禾的期中笔记');
  claims.push({ userId: 'u_zhixia', date: shDateOf(at(2)), ledgerId: claimZhixia, at: at(2) });

  addLedger('u_alan', 'seed', 2, atDay(4), null, '演示初始余额');
  addLedger('u_linjian', 'seed', 8, atDay(3), null, '演示初始余额');
  addLedger('u_zhouzhou', 'seed', 30, atDay(2), null, '演示初始余额（已存满）');
  addLedger('u_nanzhi', 'seed', 1, atDay(2), null, '演示初始余额');
  addLedger('u_admin', 'seed', 0, atDay(2), null, '演示初始余额');

  gifts.push(
    {
      id: 'g_1', senderId: 'u_zhixia', receiverId: 'u_qinghe', postId: 'p_calc_notes',
      qty: 2, day: shDateOf(at(1.8)), status: 'active', idemKey: 'seed-g1', createdAt: at(1.8)
    },
    {
      id: 'g_2', senderId: 'u_qinghe', receiverId: 'u_alan', postId: 'p_py_recursion',
      qty: 1, day: shDateOf(atDay(1)), status: 'active', idemKey: 'seed-g2', createdAt: atDay(1)
    },
    {
      id: 'g_3', senderId: 'u_momo', receiverId: 'u_alan', postId: 'p_py_recursion',
      qty: 1, day: shDateOf(at(0.7)), status: 'active', idemKey: 'seed-g3', createdAt: at(0.7)
    },
    {
      id: 'g_4', senderId: 'u_zhouzhou', receiverId: 'u_zhixia', postId: 'p_calc_notes',
      qty: 2, day: shDateOf(at(1.1)), status: 'active', idemKey: 'seed-g4', createdAt: at(1.1)
    },
    {
      id: 'g_5', senderId: 'u_nanzhi', receiverId: 'u_alan', postId: 'p_py_recursion',
      qty: 1, day: shDateOf(at(2.5)), status: 'active', idemKey: 'seed-g5', createdAt: at(2.5)
    },
    {
      id: 'g_6', senderId: 'u_qinghe', receiverId: 'u_linjian', postId: 'p_la_solutions',
      qty: 1, day: shDateOf(at(3.2)), status: 'active', idemKey: 'seed-g6', createdAt: at(3.2)
    }
  );

  /* 成长值：只按来源记账，等级由流水汇总 */
  const xp = [
    { id: 'xp_1', userId: 'u_qinghe', sourceType: 'post', sourceId: 'p_calc_notes', delta: 5, at: at(3), reason: '发布帖子' },
    { id: 'xp_2', userId: 'u_qinghe', sourceType: 'post', sourceId: 'p_calc_problems', delta: 5, at: at(26), reason: '发布帖子' },
    { id: 'xp_3', userId: 'u_qinghe', sourceType: 'comment', sourceId: 'cm_calc_1_r', delta: 1, at: at(2.2), reason: '有内容的评论' },
    { id: 'xp_4', userId: 'u_qinghe', sourceType: 'seed', sourceId: null, delta: 149, at: atDay(5), reason: '演示历史成长值' },
    { id: 'xp_5', userId: 'u_zhixia', sourceType: 'seed', sourceId: null, delta: 112, at: atDay(5), reason: '演示历史成长值' },
    { id: 'xp_6', userId: 'u_linjian', sourceType: 'post', sourceId: 'p_la_question', delta: 5, at: at(5), reason: '发布帖子' },
    { id: 'xp_7', userId: 'u_linjian', sourceType: 'seed', sourceId: null, delta: 18, at: atDay(5), reason: '演示历史成长值' },
    { id: 'xp_8', userId: 'u_zhixia', sourceType: 'accepted', sourceId: 'cm_la_answer', delta: 10, at: at(3.5), reason: '回答被采纳' },
    { id: 'xp_9', userId: 'u_alan', sourceType: 'seed', sourceId: null, delta: 40, at: atDay(5), reason: '演示历史成长值' },
    { id: 'xp_10', userId: 'u_zhouzhou', sourceType: 'seed', sourceId: null, delta: 455, at: atDay(5), reason: '演示历史成长值' },
    { id: 'xp_11', userId: 'u_nanzhi', sourceType: 'seed', sourceId: null, delta: 60, at: atDay(5), reason: '演示历史成长值' }
  ];

  /* 消息 */
  const notifications = [
    {
      id: 'n_1', userId: 'u_qinghe', actorId: 'u_zhixia', type: 'reply', postId: 'p_calc_notes',
      commentId: 'cm_calc_1', text: '回复了你的帖子：第二页那个符号可能写反了？', readAt: null, createdAt: at(2.5)
    },
    {
      id: 'n_2', userId: 'u_qinghe', actorId: 'u_zhixia', type: 'gift', postId: 'p_calc_notes',
      commentId: null, text: '给你的「微积分期中笔记」送了 2 枚页签。', readAt: null, createdAt: at(1.8)
    },
    {
      id: 'n_3', userId: 'u_qinghe', actorId: null, type: 'system', postId: null,
      commentId: null, text: '你分享的资料已通过扫描，进入找资料索引。', readAt: at(1), createdAt: at(2.8)
    },
    {
      id: 'n_4', userId: 'u_zhixia', actorId: 'u_qinghe', type: 'reply', postId: 'p_calc_notes',
      commentId: 'cm_calc_1_r', text: '在你指出问题的评论下回复了你。', readAt: null, createdAt: at(2.2)
    },
    {
      id: 'n_5', userId: 'u_alan', actorId: 'u_qinghe', type: 'reply', postId: 'p_py_recursion',
      commentId: 'cm_py_1', text: '评论了你的帖子：画调用栈这招好用……', readAt: null, createdAt: at(1.2)
    },
    {
      id: 'n_6', userId: 'u_linjian', actorId: null, type: 'accepted', postId: 'p_la_question',
      commentId: 'cm_la_answer', text: '你采纳了一条回答。', readAt: at(3), createdAt: at(3.5)
    }
  ];

  /* 举报与审计 */
  const reports = [
    {
      id: 'rp_1', reporterId: 'u_zhouzhou', targetType: 'post', targetId: 'p_calc_problems',
      reason: '版权风险', detail: '附件疑似整本教材的扫描件，不止章节整理。',
      status: 'open', resolution: null, handledBy: null, createdAt: at(6)
    },
    {
      id: 'rp_2', reporterId: 'u_nanzhi', targetType: 'comment', targetId: 'cm_phys_1',
      reason: '不当内容', detail: '语气有点冲。',
      status: 'dismissed', resolution: '经核查属于正常讨论分歧，不构成违规。',
      handledBy: 'u_admin', createdAt: at(20)
    }
  ];

  const audit = [
    {
      id: 'au_1', actorId: 'u_admin', action: '处理举报', target: '评论 cm_phys_1',
      reason: '属于讨论分歧，不做处理', at: at(19)
    }
  ];

  /* 平台事件（仅本地演示统计，不上报） */
  const events = [
    { type: 'resource_landing_view', resourceId: 'r_calc_notes', at: at(1.5), meta: { source: 'direct' } },
    { type: 'resource_search', at: at(1.6), meta: { q: '数列极限' } },
    { type: 'resource_preview_view', resourceId: 'r_calc_notes', at: at(1.4), meta: {} },
    { type: 'resource_download_authorized', resourceId: 'r_calc_notes', at: at(1.3), meta: {} }
  ];

  /* 9.2：历史的分教学班/学期圈合并进课程圈。
   * 旧圈 ci_calc_b、ci_calc_old 的帖子与成员都归到 c_calc 的课程圈 ci_calc_a。 */
  const legacyCircleMap = { ci_calc_b: 'ci_calc_a', ci_calc_old: 'ci_calc_a' };
  const remapCircle = (id) => legacyCircleMap[id] || id;
  posts.forEach((post) => { if (post.circleId) post.circleId = remapCircle(post.circleId); });
  memberships.forEach((row) => { row.circleId = remapCircle(row.circleId); });
  const seenMembership = new Set();
  for (let i = memberships.length - 1; i >= 0; i -= 1) {
    const key = `${memberships[i].userId}|${memberships[i].circleId}`;
    if (seenMembership.has(key)) memberships.splice(i, 1);
    else seenMembership.add(key);
  }

  const db = {
    version: 4,
    seedVersion: 6,
    createdAt: iso(now),
    demo: true,
    session: null,
    users,
    courses,
    circles,
    memberships,
    posts,
    attachments,
    resources,
    comments,
    reactions,
    follows,
    courseCollections: [
      {
        postId: 'p_calc_notes', courseId: 'c_calc', authorId: 'u_qinghe',
        createdAt: at(2), note: '作者确认收录到课程，复用原帖'
      }
    ],
    wallets,
    ledger,
    claims,
    gifts,
    xp,
    notifications,
    reports,
    audit,
    events,
    applications: [],
    prefs: {},
    drafts: {}
  };

  // Art V3：8 个生活化账号、12 条帖子的语气与页页表情（在既有结构上就地替换）
  const seeded = applyArtV3(db, now);
  // 固定演示帖子不再公开出现在新初始化的数据里。
  if (options.keepDemoPosts === false) removeKnownDemoPosts(seeded, { now, reason: '初始化时移除已确认的源码演示帖子' });
  return seeded;
}

/** 生成上海日期字符串，种子数据内部使用（避免循环依赖） */
function shDateOf(isoString) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(isoString));
}






