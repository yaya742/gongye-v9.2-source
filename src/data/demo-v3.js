/* Art V3 演示数据补丁
 *
 * 在原有种子数据之上替换：8 个生活化账号头像/昵称/简介、12 条帖子的语气与内容、
 * 评论与页页表情、资料标题；并补充两位演示用户与几条评论。
 *
 * 说明：本工程此前已经为「下载 / 预览 / 权限」准备了一份明确标注的示例 PDF。
 * v3 fixture 里 6 份资料是未绑定文件的；为了不破坏已有的下载回归，这里保留示例文件，
 * 但在 UI 上仍明确标注为演示内容。若以后要完全按 fixture 走，给 resource 加 fileBound=false
 * 并删除 attachments 即可（界面已支持「未绑定」提示）。
 */

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const USERS = {
  u_qinghe: {
    nickname: '橘子还没熟', avatar: 'avatars/cat.jpg',
    bio: '慢慢整理，写错了可以提醒我。'
  },
  u_linjian: {
    nickname: '阿椰', avatar: 'avatars/mountains.jpg',
    bio: '偶尔整理一下自己的东西。'
  },
  u_alan: {
    nickname: '晚点再睡', avatar: 'avatars/moon.svg', bio: ''
  },
  u_zhixia: {
    nickname: '括号没闭合', avatar: 'avatars/doodle.svg', bio: ''
  },
  u_zhouzhou: {
    nickname: '周三再说', avatar: 'avatars/sprout.svg', bio: ''
  },
  u_nanzhi: {
    nickname: '小半杯', avatar: 'avatars/coffee.jpg', bio: '咖啡喝完再改最后一遍。'
  },
  u_admin: {
    nickname: '管理员测试', avatar: 'art/avatar-01.svg',
    bio: '管理员测试账号：处理举报、建圈申请、封禁账号与帖子。'
  }
};

const NEW_USERS = [
  { id: 'u_momo', email: 'momo@example.com', nickname: 'momo', avatar: 'avatars/orange.svg', bio: '' },
  { id: 'u_xiaolin', email: 'xiaolin@example.com', nickname: '小林', avatar: 'avatars/wave.svg', bio: '' }
];

const POSTS = {
  p_calc_notes: {
    title: '极限这章，补了几处容易算错的地方',
    body: '上次那版第 3 页漏写了条件，已经补上。\n\n'
      + '还有两道题我没想清楚：一道是夹逼的上下界怎么取，一道是单调有界最后一步。'
      + '要是你也卡在这，可以一起看下。\n\n'
      + '> 只是我自己的整理，不是老师划的重点。',
    tags: ['极限', '夹逼']
  },
  p_calc_problems: {
    title: '连续性这一页重写了',
    body: '昨天回去看，发现原来那页只写结论没写条件。今天补了几个反例，'
      + '顺便把左右极限分开写了一遍。\n\n不保证全对，看到问题直接说。',
    tags: ['连续性', '反例'],
    stickerId: 'yeye.updated.v1'
  },
  p_la_question: {
    title: '这里为什么能交换两列？',
    body: '我知道交换两列可以算行列式，但这题在解方程组。换完以后，未知数的顺序是不是也跟着变了？\n\n'
      + '我按原来的顺序回代，结果和答案对不上。',
    tags: ['行列式', '方程组']
  },
  p_py_recursion: {
    title: '列表复制踩坑记录',
    body: 'a=b、a[:] 和嵌套列表分开记了。不是教程，就是把这几天的错法放在一起。\n\n'
      + '```python\n'
      + 'a = [[1, 2], [3, 4]]\n'
      + 'b = a[:]\n'
      + 'b[0][0] = 9   # a 也会跟着变\n'
      + '```\n\n'
      + '嵌套那层还是共用，要 copy.deepcopy。',
    tags: ['列表', '复制']
  },
  p_py_notes: {
    title: 'for和while总写乱，整理了一页对照',
    body: '凌晨改了两处缩进。例子都是我自己写的小例子，文件读取还没补。\n\n'
      + '- for：次数清楚的时候\n'
      + '- while：条件成立就继续\n\n'
      + '写不出来的时候我一般先画一遍循环变量怎么变。',
    tags: ['循环', '缩进']
  },
  p_calc_discuss: {
    title: '本周学习索引：连续性与导数定义',
    body: '这一周讨论集中在连续性和导数定义。下面是同学整理的三条链接，欢迎补充：\n\n'
      + '1. 连续的三个条件与分段函数分界点\n'
      + '2. 导数定义的两种写法与可导必连续\n'
      + '3. 夹逼准则在数列题里的三种用法\n\n'
      + '只是同学手动整理，不是学校通知。',
    tags: ['本周索引']
  },
  p_la_solutions: {
    title: '线代前三章，我自己用的复习清单',
    body: '标了我反复卡住的几道题，不是老师划的重点。\n\n列变换那部分我写了两遍才顺，附在最后。',
    tags: ['行列式', '复习清单']
  },
  p_calc_old: {
    title: '2025 秋期末前的极限整理',
    body: '去年期末前整理的版本，题型偏计算。学期不同，教学进度可能对不上，请先核对。',
    tags: ['期末复习']
  },
  p_method_review: {
    title: '复习的时候才发现符号一直记反',
    body: '一个是转置，一个是逆，我笔记里居然连着写反了两处。已经改过来了，'
      + '顺便把容易混的几组并排写了一遍。\n\n不是方法总结，就是提醒自己。',
    tags: ['符号', '复盘']
  },
  p_prob_help: {
    title: null,
    body: '导数定义那题我卡在最后一步了，为什么总比参考结果多一个负号？\n\n'
      + '我先把定义写成 lim(h→0)[f(x+h)-f(x)]/h，代入以后化简就多一个负号。',
    tags: ['导数'],
    courseId: 'c_calc'
  },
  p_calc_processing: {
    title: '极限这章的错题（整理中）',
    body: '还在整理，文件正在处理，暂时不能下载；完成后会更新到这一帖。'
  },
  p_calc_failed: {
    title: '报错截图（处理失败，待重传）',
    body: '扫描的 PDF 被判定为异常文件，正在重新导出一份。现在这份不能下载。'
  }
};

const COMMENTS = {
  cm_la_answer: {
    body: '行列式的定义是带符号的求和，交换两列相当于对列指标做一次对换，置换奇偶性翻转，所以整体变号。\n\n'
      + '你按原顺序回代，等于换了未知数的顺序，解出来还要换回去，不然就会和答案差一个符号。'
  },
  cm_la_reply1: { body: '懂了，是置换的奇偶性。我再去翻一遍定义里那个 (−1)^τ。' },
  cm_la_reply2: { body: '补一句：|kA| = kⁿ|A| 也常被写成 k|A|，一起记。' },
  cm_calc_1: { body: '第二页那个符号是不是写反了？左边应当小于等于吧。', stickerId: 'yeye.thinking.v1' },
  cm_calc_1_r: { body: '确实，已经改到 v2 了，谢谢提醒。', stickerId: 'yeye.thanks.v1' },
  cm_calc_2: { body: '夹逼那部分建议再补一道两端都随 n 变的题。' },
  cm_calc_3: { body: '下载了，先对着课堂笔记过一遍。', stickerId: 'yeye.received.v1' },
  cm_py_1: { body: 'a[:] 这层我原来也以为复制完了。' },
  cm_py_1_r: { body: '对，嵌套那层还得 deepcopy。', stickerId: 'yeye.received.v1' },
  cm_discuss_1: { body: '补充一条：可导必连续，但连续不一定可导，反例用 |x| 就够。' },
  cm_method_1: { body: '符号这块我也混过，转置和逆放一起看确实容易乱。' },
  cm_prob_1: { body: '先把 h 约掉再代入试试？负号可能是化简时提错了。' },
  cm_ds_1: { body: '复杂度表很清楚，BFS 用队列那栏建议标一下空间是 O(V)。' },
  cm_phys_1: { body: '星三角变换一般是为了把没有直接串并联关系的三个电阻化简，节点电压方程也能做，只是未知数多。' }
};

const RESOURCES = {
  r_calc_notes: {
    title: '极限这章，补了几处容易算错的地方',
    coverage: '数列极限、夹逼、单调有界；第 3 页补了条件',
    limitations: '不含导数与中值定理'
  },
  r_calc_problems: {
    title: '连续性这一页重写了',
    coverage: '函数连续的三条件、左右极限、几个反例',
    limitations: '只有连续性这一节'
  },
  r_la_solutions: {
    title: '线代前三章，我自己用的复习清单',
    coverage: '行列式、初等变换、方程组；标注反复卡住的题',
    limitations: '不是老师划的重点，未覆盖特征值'
  },
  r_py_notes: {
    title: 'for和while总写乱，整理了一页对照',
    coverage: '循环结构对照、缩进与常见错误',
    limitations: '文件读取还没补'
  },
  r_calc_old: {
    title: '2025 秋期末前的极限整理',
    coverage: '2025 秋期末范围内的极限计算与连续性判断',
    limitations: '学期不同，章节顺序与今年不一致；仅作参考'
  }
};

const NEW_POSTS = [
  {
    id: 'p_py_copy',
    authorId: 'u_xiaolin',
    board: 'notes',
    circleId: 'ci_py_b',
    courseId: 'c_py',
    title: '列表切片以后，里面的小列表还是共用的',
    body: '今天试了一下，外层确实复制了，内层还是同一个对象。\n\n'
      + '后来用 `copy.deepcopy` 才真正分开。记录一下，免得下次又踩。',
    tags: ['列表', '复制'],
    publishedAt: null
  }
];

function ensureUser(db, data) {
  let user = db.users.find((item) => item.id === data.id);
  if (!user) {
    user = {
      id: data.id,
      email: data.email,
      nickname: data.nickname,
      avatar: data.avatar,
      bio: data.bio || '',
      role: 'user',
      status: 'active',
      verified: true,
      joinedAt: new Date(Date.now() - 30 * DAY).toISOString()
    };
    db.users.push(user);
  }
  return user;
}

function ensureMembership(db, userId, circleId, joinedAt) {
  if (db.memberships.some((m) => m.userId === userId && m.circleId === circleId)) return;
  db.memberships.push({
    userId,
    circleId,
    status: 'active',
    muted: false,
    shelved: false,
    joinedAt,
    lastSeenAt: joinedAt,
    writeRestricted: false
  });
}

/**
 * 把 V3 演示内容套到已经建好的演示库上（原地修改并返回）。
 */
export function applyArtV3(db, now = Date.now()) {
  // 1) 账号头像与昵称
  Object.entries(USERS).forEach(([id, patch]) => {
    const user = db.users.find((item) => item.id === id);
    if (!user) return;
    Object.assign(user, patch);
  });

  NEW_USERS.forEach((data) => {
    ensureUser(db, data);
  });

  // 2) 新用户加入圈子，才能评论圈内帖子
  ensureMembership(db, 'u_momo', 'ci_calc_a', new Date(now - 12 * DAY).toISOString());
  ensureMembership(db, 'u_xiaolin', 'ci_py_b', new Date(now - 9 * DAY).toISOString());

  // 3) 帖子语气与内容
  Object.entries(POSTS).forEach(([id, patch]) => {
    const post = db.posts.find((item) => item.id === id);
    if (!post) return;
    Object.assign(post, patch);
    if (patch.courseId) {
      post.courseId = patch.courseId;
      if (post.circleId) post.circleId = null; // 原帖不挂圈时保持独立
    }
  });

  // 4) 资料标题与范围
  Object.entries(RESOURCES).forEach(([id, patch]) => {
    const resource = db.resources.find((item) => item.id === id);
    if (resource) Object.assign(resource, patch);
  });

  // 5) 评论语气与页页表情
  Object.entries(COMMENTS).forEach(([id, patch]) => {
    const comment = db.comments.find((item) => item.id === id);
    if (comment) Object.assign(comment, patch);
  });

  // 6) 新评论（含一条只有表情的回复，验证服务端允许）
  const extraComments = [
    {
      id: 'cm_calc_momo', postId: 'p_calc_notes', authorId: 'u_momo', parentId: null,
      replyToUserId: null, body: '', stickerId: 'yeye.received.v1',
      status: 'visible', createdAt: new Date(now - 2.6 * HOUR).toISOString(), editedAt: null
    },
    {
      id: 'cm_calc_4', postId: 'p_calc_notes', authorId: 'u_xiaolin', parentId: null,
      replyToUserId: null, body: '夹逼那道我也卡过，后来把上下界都写成 n 的表达式就清楚了。',
      status: 'visible', createdAt: new Date(now - 1.2 * HOUR).toISOString(), editedAt: null
    },
    {
      id: 'cm_la_3', postId: 'p_la_question', authorId: 'u_momo', parentId: null,
      replyToUserId: null, body: '所以回代的时候要把交换过的两列换回去？我好像也是这里错的。',
      status: 'visible', createdAt: new Date(now - 3.6 * HOUR).toISOString(), editedAt: null
    },
    {
      id: 'cm_py_2', postId: 'p_py_recursion', authorId: 'u_xiaolin', parentId: null,
      replyToUserId: null, body: '列表里放字典的话，复制以后改字典还是会串，这个坑我踩过。',
      status: 'visible', createdAt: new Date(now - 3 * HOUR).toISOString(), editedAt: null
    }
  ];
  extraComments.forEach((comment) => {
    if (!db.comments.some((item) => item.id === comment.id)) db.comments.push(comment);
  });

  // 7) 新帖子（新用户）
  NEW_POSTS.forEach((data) => {
    if (db.posts.some((item) => item.id === data.id)) return;
    const post = {
      ...data,
      images: [],
      tags: data.tags || [],
      status: 'published',
      publishedAt: data.publishedAt || new Date(now - 6 * HOUR).toISOString(),
      editedAt: null,
      acceptedCommentId: null,
      contentUpdatedAt: data.publishedAt || new Date(now - 6 * HOUR).toISOString(),
      attachmentIds: []
    };
    db.posts.push(post);
  });

  // 附件名与新标题保持一致（文件仍是明确标注的示例 PDF）
  const ATTACHMENT_NAMES = {
    p_calc_notes: '极限易错点整理.pdf',
    p_calc_problems: '连续性这一页.pdf',
    p_la_solutions: '线代前三章复习清单.pdf',
    p_py_notes: 'for和while对照页.pdf',
    p_calc_old: '2025秋_极限整理.pdf'
  };
  Object.entries(ATTACHMENT_NAMES).forEach(([postId, name]) => {
    (db.attachments || []).forEach((attachment) => {
      if (attachment.postId === postId) attachment.name = name;
    });
  });
  // 8) 消息里的标题跟随新文案
  const fixNote = (id, text) => {
    const note = (db.notifications || []).find((item) => item.id === id);
    if (note) note.text = text;
  };
  fixNote('n_2', '给你的「极限这章，补了几处容易算错的地方」送了 2 枚页签。');

  db.artV3 = { applied: true, at: new Date(now).toISOString() };
  return db;
}



