# 实现状态与验证记录 · 共页 v2.2

更新：2026-10-29 · 状态：**9.2 静态演示版已更新**，可部署、可评审；**不是生产系统**。

---

## 0. 9.2 增量（2026-10-29）

| 项目 | 结果 |
| --- | --- |
| 课程圈规则 | 一门课程只有一个共用圈，不再区分教学班、教师与学期 |
| 数据结构 | 圈对象删除 `term / section / teacher`；课程数 6 = 圈数 6（不含「通用学习」） |
| 历史合并 | `ci_calc_b`、`ci_calc_old` 的帖子与成员并入 `ci_calc_a`，成员按 `(用户, 圈)` 去重 |
| 找课页 | 去掉学期/教学班筛选；只按学校、课程名/课程搜索；文案改为「课程圈」 |
| 建圈 | 申请只填课程 + 说明；管理员建圈只选课程；已有圈返回 `duplicate_circle` |
| 页面文案 | 圈子页、课程页、资料详情、帖子标签、邀请页、账号页、后台统一为「课程圈」 |
| 数据版本 | `STORE_VERSION` 7 → 8，`seedVersion` 5 → 6（旧演示数据重建） |
| 测试 | logic 39 / render 5 / boot 3 / pilot 11，共 58 项通过 |
| 自检 | `node scripts/check.mjs` 通过 |
| 浏览器验收 | **未执行**（沙箱无 Chrome 调试端口）；待按 `V9_ACCEPTANCE.md` 跑 360/390/430 + 桌面 |

课程圈说明：9.2 起圈只挂课程。当前只有 6 门演示课程，各有一个圈；邀请码不再带学期/教学班后缀（`GY-CALC`）。新增课程时只增不改演示圈 id，避免已加入的圈失联。

---

## 0.1 9.1 增量（2026-10-29，已被 9.2 取代部分规则）

| 项目 | 结果 |
| --- | --- |
| 每日页签插画 | 102 天逐日 WebP + 4 张 neutral，共 106 个文件（10.9 MB），接入 `assets/daily/webp/` |
| 页页表情 | 第一弹 4 + 第二弹 10 + 第三弹 8 = 22 个，弹层按弹次分组 |
| 课程 Tag | 新资料必填（前端行内校验 + `createPost` 的 `bad_course`）；旧资料显示「课程待补充」，作者可补选 |
| 课程优先搜索 | 显式 `courseId` 硬筛；查询内课程名/别名解析 + 剩余意图；A/B/C 分组，C 组独立区块 |
| 手机卡片 | ≤600px：14px 内边距、12px 间距、标题 16/22、摘要 14/20，均两行；无固定高度裁切 |
| 课程 | 6 门演示课程，每门一个圈（9.2 起合并为课程圈，不再带学期/教学班） |
| 数据版本 | `STORE_VERSION` 6 → 7（旧本地演示数据会重建，见 CHANGELOG） |
| 测试 | logic 39 / render 5 / boot 3 / pilot 11，共 58 项通过 |
| 自检 | `node scripts/check.mjs` 通过 |
| 浏览器验收 | **未执行**（沙箱无 Chrome 调试端口）；待按 `V9_ACCEPTANCE.md` 跑 360/390/430 + 桌面 |

课程圈说明：一门课一个圈，圈上不带教学班/教师/学分，学期只写在帖子与资料上。补数据时只增不改圈 id，避免已加入的圈失联。

---

## 1. 一句话结论

按 `01-产品与美术企划书.md` 在独立目录 `app/` 从零实现了「找资料 × 课友圈」双核心，全部页面、业务规则、异常状态与响应式布局可运行，并已用自动化测试 + 真实 Chrome 截图/点击验收。数据层是浏览器内的演示仓库（`localStorage`），没有真实后端；真实上线所需的认证、数据库、对象存储、扫描与事务清单见第 4 节。

| 项目 | 结果 |
| --- | --- |
| 技术形态 | 纯静态 SPA：HTML + CSS + 原生 ES Module，零依赖、零构建 |
| 代码规模 | 21 个 JS 模块（约 5.4k 行）、1 份样式表（约 660 行）、16 个页面路由 |
| 业务规则测试 | 15 项通过 |
| 页面渲染测试 | 4 项通过（45 个路由/状态组合） |
| 启动烟雾测试 | 3 项通过（含 `main.js` 真实启动） |
| 静态自检 | 通过（导入解析、路由实现、本地资源引用） |
| 浏览器渲染验收 | 30 张截图，无控制台异常、无页面错误条、无横向溢出 |
| 浏览器交互验收 | 15 项通过（游客下载拦截→登录→领签→赠签→入圈→发帖→发布资料→检索→手机导航→后台处理举报） |

---

## 2. P0-A：双核心闭环（已完成，演示级）

### 2.1 找资料（引流）

| 企划要求 | 实现 | 位置 |
| --- | --- | --- |
| 根路径进入找资料；`/resources` 稳定入口 | `#/` 首页、`#/resources` 检索页 | `pages/resources.js` |
| 搜索 + 学校/课程/学期/类型/标签筛选，全部可清空 | 左侧筛选栏 + URL 查询参数 | `resources.js`、`selectors.searchResources` |
| 排序：关键词相关性 / 最近更新 / 最多收藏 | `sort` 参数；相关性按标题>课程>标签>范围>正文加权 | `selectors.relevanceScore` |
| 结果卡：标题、匹配摘要、作者、学校课程学期、用途范围、文件信息、版本时间、来源帖与圈 | `resourceCard` | `components/ui.js` |
| 资料详情：范围/未覆盖、适用学期、前两页预览、作者来源、版本、真实文件、下载、原帖讨论 | `#/resources/:id` | `pages/resources.js` |
| 一帖一资料、最多 3 附件、只展示一条结果 | `resource_shares.postId` 唯一 + 读时校验 | `actions.createPost`、`selectors.resourceEligibility` |
| 只有「公开帖 + 作者确认 + 至少 1 个 ready PDF + 元信息齐全」进索引 | `resourceEligibility` 四类校验 | `selectors.js` |
| 处理中不进索引、失败可替换 | 附件 `processing / failed / removed` 状态 | `actions.finishAttachmentProcessing` |
| 取消索引不删原帖；原帖删除则下架 | `setResourceIndex` / `removePost` | `actions.js` |
| 游客可搜索看详情和前两页预览；下载只需验证登录，不需入圈/等级/页签 | `downloadResource` 仅校验登录、验证、账号状态 | `actions.downloadResource` |
| 资料发布不要求入圈 | 发布器「不分享到圈子」是默认项 | `pages/resources.js` 发布表单 |
| 空态、无匹配、已下架、预览失败、登录后返回 | 对应空态与说明卡 | `emptyState`、`resourceDetail` 分支 |

### 2.2 课友圈（留存）

| 企划要求 | 实现 | 位置 |
| --- | --- | --- |
| 课程（跨学期）与圈（学期+教学班）两层结构 | `courses / course_circles` 分离 | `seed.js`、`selectors.circleLabel` |
| 找课：按学校/课程/学期/教学班 | `#/find-circles` 表单 + 结果卡 | `pages/circles.js` |
| 加入需确认、幂等、归档拒收、被移出需解除 | `joinCircle` 四条校验 | `actions.joinCircle` |
| 邀请落地页：先看内容，登录后确认，不自动加入 | `#/invite/:code` | `pages/circles.invite` |
| 我的课友圈聚合流（退出/静音/往期不进入） | `feedPosts mode=my` 过滤 | `selectors.feedPosts` |
| 圈页：讨论 / 本周 / 资料三视图 | `tab` 参数 | `pages/circles.circle` |
| 本周 = 上海周一 00:00 起，正文或附件更新 | `weekStart` + `contentUpdatedAt` | `lib/format.js` |
| 置顶＝普通帖子，非学校通知 | `pinnedPostId` + 标注 | `pages/circles.circle` |
| 圈内发帖课程由圈派生，禁止伪造 course_id | `createPost` 覆盖 `courseId` | `actions.createPost` |
| 归档只读、不删帖、不退款 | `circleWriteBlock` + 归档提示 | `actions.js`、`pages/circles.circle` |
| 静音/往期/退出 | `setCircleFlag` / `leaveCircle` | `actions.js` |
| 成员名单不公开、不采集学号课表 | 界面明确说明，数据结构不存这些字段 | `pages/circles.*` |

### 2.3 内容、互动与消息

| 要求 | 实现 |
| --- | --- |
| 四板块、每帖必选一个 | `BOARDS` + 发布器 chips |
| 正文 1–20000、标题 ≤60、标签 ≤3、图片 ≤9、PDF ≤3 | `validatePostInput` |
| 基础 Markdown（段落/列表/引用/代码/链接），禁用原始 HTML | `lib/markdown.js` 先转义再渲染 |
| 两层评论（主评论 + 回复），回复显示被回复人 | `commentTree`、`addComment` |
| 求助帖作者采纳一条，改选需先取消 | `acceptComment / unacceptComment` |
| 公开资料帖允许非成员登录纠错，禁言/归档仍生效 | `addComment` 分支 + `resourceCommentBlock` |
| 点赞、收藏可撤回；关注作者/课程 | `toggleReaction`、`toggleFollow*` |
| 站内消息：回复、采纳、页签、系统、退款；自己操作不通知自己 | `notifyUser`、`pages/account.messages` |
| 举报 + 管理员隐藏/移除/恢复 + 必填理由 + 审计 | `reportContent`、`resolveReport`、`pages/misc.admin` |

### 2.4 页签与成长（P0-B 的核心部分已实现）

| 规则 | 实现 | 验证 |
| --- | --- | --- |
| 每日 1 枚、上海自然日、满额不写记录 | `claimDaily` + 唯一 claim | 测试「页签领取」 |
| 上限 30、退款可超上限、满额暂停领取 | `claimState` | 同上 |
| 赠送：不自赠、每帖 2、每作者每天 2、每天 5、幂等键 | `sendGift` + `giftAvailability` | 测试「赠送」 |
| 接收者只增获赠统计、不进可送余额 | 无入账逻辑 | 测试「移除帖子」 |
| 永久移除退款一次、不重复入账 | `refundGiftsForPost` | 同上 |
| 成长值：发帖每日 2 次、采纳 2 次、评论 5 次且 ≥10 字；点赞/领签/下载不计分 | `awardXp` | 测试「成长值」 |
| 等级 0/50/150/400/1000 | `levelOf` + 徽记 | 页面/截图 |

### 2.5 其他已实现

- 课程页：当期圈、往期圈、作者收录、课程资料、最近讨论、关注课程。
- 全站搜索：帖子 / 课程 / 用户 + 「仅看含附件」，明确说明不搜 PDF 正文。
- 个人主页：等级、帖子、关注者、获赠页签，不展示修课清单。
- 消息页：全部/回复/页签/系统，未读标记、单条与全部已读。
- 管理后台：举报处理、圈子归档、账号停用/恢复、建圈申请、审计记录、来源统计。
- 响应式：1440 三栏 / 1024 两栏 / 768 单栏顶部筛选 / 390 底部五栏导航。
- 运行时错误兜底：捕获异常并显示「页面脚本出错」，避免白屏。
- 无障碍：跳转链接、`aria-current`、`aria-pressed`、`aria-selected`、可见焦点框、44px 触控目标、状态不仅靠颜色。

---

## 3. 与企划的已知偏差（如实记录）

| 偏差 | 说明 | 影响 |
| --- | --- | --- |
| 路由用 hash（`#/resources/:id`） | 静态托管零配置可用；同时支持 `/resources/:id`（需平台回退） | 分享链接形式与企划的「稳定 `/resources/:id`」略有差异，已提供干净链接兼容 |
| 数据层是浏览器本地仓库 | 用 `localStorage` 模拟服务端行为 | 不能作为生产；换设备或清缓存即丢失 |
| 附件是示例 PDF | `assets/samples/*.pdf` 明确标注「演示占位」 | 下载流程可验证，但不是真实用户文件 |
| 前两页预览是生成的 SVG | `assets/previews/*.svg`，标注「演示预览 · 非真实 PDF 渲染」 | 真实实现需服务端 PDF→图片 |
| 没有真实上传 | 发布器从预置示例 PDF 中选择附件 | 上传进度、扫描回调、失败重传未验证 |
| 「同时收录到找资料」在发布器内折叠面板完成 | 没有做成独立二次确认页 | 交互略简，字段与确认项齐全 |
| 消息能力 | 通知与私信均为站内；静态版私信只存本机，试用后端按双方账号筛选并保存 | 跨设备互发依赖已部署且启用的服务端；试用后端不作为生产系统 |
| 收录到课程只有展示与取消 | 作者确认收录仅提供数据与页面呈现 | 未做完整的作者操作入口（企划 P1 范围） |

---

## 4. 未实现：需要真实后端才能完成

以下能力在静态站点里**无法真实实现**，当前只是演示或缺失。生产化时按此清单补齐：

1. **认证与会话**：邮箱验证码发送与校验、HttpOnly Cookie、CSRF/CORS、登录限流、会话吊销。
2. **数据库**：PostgreSQL 或云数据库；`users / courses / circles / memberships / posts / attachments / resources / comments / reactions / wallets / claims / gifts / ledger / xp / notifications / reports / audit / outbox` 等表与迁移。
3. **文件**：私有对象存储、随机对象键、上传签名、真实 MIME/大小校验、扫描服务、缩略图与 PDF 前两页转图、短时下载链接或代理下载。
4. **事务与任务**：页签领取/赠送的数据库事务与唯一约束、幂等键、退款 outbox worker、通知聚合。
5. **权限**：所有写操作在服务端重新校验角色/归属/圈子状态/禁言/归档（当前仅前端校验）。
6. **检索**：服务端筛选与稳定游标分页、中文分词验证（当前是前端子串 + 权重，不能代表生产检索质量）。
7. **运营**：埋点上报（当前事件只写本地）、来源统计、告警与日志、备份恢复。
8. **SEO**：预渲染/SSR 与 sitemap（当前明确未承诺搜索引擎收录）。

对接时的接口清单（与 `state/actions.js` 一一对应）：
`/auth`、`/posts`、`/media`、`/comments`、`/reactions`、`/follows`、`/resources`、`/resources/:id/download`、`/courses`、`/search`、`/circles`、`/invites`、`/circle-applications`、`/course-collections`、`/bookmarks`、`/notifications`、`/reports`、`/admin/*`。试用后端私信使用 `/api/action` 的 `sendDirectMessage` 与 `markDirectMessagesRead` 动作。

---

## 5. 验证记录（可复现）

环境：Windows 11 · Node v24.21.0 · Chrome 156 headless。

```powershell
cd app

node scripts/check.mjs
# 素材文件 34 个；模块 21 个；路由 22 个
# 自检通过：导入、路由与本地资源引用均可解析。

npm test
# tests 15+4+3，全部 pass，fail 0

node scripts/serve.mjs                     # http://127.0.0.1:4173/
node scripts/qa.mjs        # 30 张截图；无控制台异常 / 无页面错误 / 无横向溢出（--shots 可指定输出目录）
node scripts/qa-flow.mjs   # 15/15：游客下载拦截、登录、领签、赠签、入圈、发帖、发布资料、检索、手机导航、后台处理举报
```

截图（`docs/screenshots/`）：

| 文件 | 内容 |
| --- | --- |
| `01-home-1440.png` | 找资料首页 · 三栏 |
| `02-resource-search-1440.png` | 资料检索与筛选 |
| `03-resource-detail-1440.png` | 资料详情（含前两页预览） |
| `04-circles-1440.png` | 我的课友圈（游客态） |
| `05-circle-1440.png` | 圈页（置顶索引、讨论、处理中附件） |
| `06-post-1440.png` | 帖子详情（附件、标签、讨论、回复） |
| `07-compose-1440.png` | 发布器 |
| `08-wallet-1440.png` | 页签与收支记录 |
| `09-home-390.png` | 手机首页 |
| `10-circles-390.png` | 手机课友圈 + 底部导航 |

未做过的验证（不要声称已完成）：
- 真实邮件发送、真实文件上传/扫描/预览生成、真实数据库事务与限流。
- 多账号跨设备一致性、真实退款任务的重复执行与死锁重试。
- 搜索引擎收录与社交平台卡片抓取（`og:` 标签存在，但未做预渲染）。
- 屏幕阅读器逐项朗读测试（只做了语义与键盘焦点检查）。

---

## 6. 运行与协作

```bash
cd app
node scripts/serve.mjs       # 本地预览
npm test                     # 业务 + 渲染 + 启动
npm run check                # 静态自检
```

- 入口：`index.html` → `src/main.js`；配置：`src/config.js`（部署后可直接改）。
- 新增页面：`src/pages/*.js` 导出渲染函数 → 在 `src/pages/index.js` 注册 → 在 `src/router.js` 增加路由名。
- 新增业务动作：写在 `src/state/actions.js`，返回 `{ ok, code, message, data }`，前端统一 toast。
- 新增查询：写在 `src/state/selectors.js`，保持只读。
- 演示数据：`src/data/seed.js`；改完记得同步测试与 `docs/screenshots`。

## 7. 下一步建议

1. 需求方确认：是否继续走真实后端（第 4 节），还是先以演示站做小范围评审。
2. 若继续：先落地认证 + 数据库 + 文件三件套，再按接口清单替换 `state/*` 适配层；前端页面可复用。
3. 若只做评审：按 `DEPLOY_HANDOFF.md` 部署到 Cloudflare Pages/Vercel，收集反馈后再决定是否投入后端。
4. 视觉细节可按 `03-视觉验收与素材清单.md` 再做一轮设计走查（当前已按 tokens 与设计册实现，截图见上）。


