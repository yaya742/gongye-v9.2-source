# 更新日志（CHANGELOG）

共页项目的所有改动记录。目的：后期 debug、回滚、交接时能快速回答“哪一版改了什么、怎么验证、怎么退回去”。

## 维护规则（每次改动都必须遵守）

1. **任何改动**（代码、样式、数据、文档、部署配置）都要在 `## [Unreleased]` 下加一条；发版时把 `Unreleased` 改成 `## [x.y.z] - YYYY-MM-DD`。
2. 条目用**可验证的语言**：做了什么、影响哪些文件、怎么验证。不要写“优化了体验”这类无法复现的话。
3. 每条至少包含：**改动**、**影响文件**、**验证方式**。
4. 涉及业务规则、接口、数据结构、权限、部署方式的改动，必须额外写 **影响** 与 **回滚方式**。
5. 只改了文档也要记，归到 `Docs`；只改测试归到 `Tests`。
6. 版本号：视觉/功能改动升 minor（2.2 → 2.3），修复升 patch（2.3.0 → 2.3.1）；纯文档可用 patch。

## 条目模板

```markdown
### Changed
- 资料卡改为整卡可点击，保留标题链接语义（Ctrl/Cmd 点击仍开新标签）。
  - 文件：`src/components/ui.js`、`src/main.js`
  - 影响：无接口/数据变化；仅交互
  - 验证：`node scripts/qa-flow.mjs`；点击卡片进入详情，返回后滚动与焦点恢复
  - 回滚：还原上述两个文件
```

## 分类标签

`Added` 新增 · `Changed` 变更 · `Fixed` 修复 · `Removed` 移除 · `Security` 安全 · `Docs` 文档 · `Tests` 测试 · `Verified` 本次实测结果

---

## [Unreleased]

### Added · 部署与上线自检（2026-11-02）
- 新增 `Dockerfile`、`.dockerignore`、`compose.yaml`（应用 + ClamAV + Caddy 自动 HTTPS）、`deploy/Caddyfile`、`deploy/gongye.service`（systemd 非 Docker 方案）与 `.env.example` 的 `DOMAIN` 变量。
  - 应用容器以 uid 10001 非 root 运行，仅 `app-data` 卷可写；数据与病毒库分卷持久化。
  - 验证：本机无 Docker，未做镜像构建验证；首次部署须按 `DEPLOY_PRODUCTION.md` 第 9 节执行。
- 新增 `scripts/smoke-deploy.mjs`（`npm run smoke -- <URL>`）：只读检查首页/静态资源、`/api/health` 模式、`/api/state` 课程数与内部路径泄露、7 个敏感路径 404、跨站 POST 403、公网强制 https。
  - 验证：对本机生产实例运行，16 项 PASS、1 项 WARN（SMTP 未配置 → `authReady=false`），退出码 2 符合“通过但有需人工确认项”的定义。

### Fixed · 集成验收修复（2026-11-02）
- PDF 渲染改为一次性子进程（`server/file-processing.mjs`）：原生画布在 worker 线程里偶发访问违例（0xC0000005）会拖垮整个服务进程；隔离后崩溃或超时只让本次上传返回 503，也避免损坏文件把原生依赖加载进服务进程。
  - 影响：预览改为「本机 fork 子进程 + IPC」，限制不变（20 MiB、500 页、30 秒、前两页 PNG）。
  - 验证：`RUN_PDF_INTEGRATION=1 node --test tests/files-render.test.mjs`，上传链路测试连续 5 次全绿。
- 未发布附件的匿名预览统一返回 404（原 401），避免用状态码区分「上传中」和「不存在」。
- 补上 `/api/files` 上传端点路由（原先只匹配 `/api/files/` 前缀，真实上传会 404）。
- 生产发帖缺少 `courseId`/`term` 时按预期返回 `bad_course`/`bad_term`，测试示例同步补齐。
- 课程圈没有邀请码时不再渲染 `#/invite/undefined` 与「邀请课友」按钮。
- 旧固定码入口 `启动试用.cmd`、跨域 `启动跨域后端.cmd`、`清空数据.cmd` 改为拒绝执行并指向 `DEPLOY_PRODUCTION.md`，避免误删生产数据或用固定码对外服务。

### Security · v10 生产化修复
- 默认入口切换为服务端随机邮箱验证码、精确域名白名单、HttpOnly Cookie 与 SQLite WAL 共享持久化；拒绝仅凭 email 的 cloudSignIn、固定码和客户端伪造会话。
  - 文件：`server/index.mjs`、生产服务/会话/存储/最小化视图模块、`src/api/client.js`
  - 影响：真实账号不复用演示用户；SMTP 缺失不发码，不回落演示。单实例部署，不代表全校容量已压测。
  - 验证：HTTP 安全回归测试（身份伪造、静态内部路径、数据隔离、停用会话、CSRF）。
- 接入可信 PDF 上传、ClamAV 扫描、PDF 结构校验与前两页 PNG，发布只接收本人 uploadId；每次下载重查授权，下架关闭旧链接。
  - 文件：`server/files.mjs`、发布/详情 UI 与文件集成测试
  - 验证：伪造路径、跨用户上传、扫描失败、私有下载和下架反例；真实扫描服务仍需部署联调。
- 拆分通知静音与管理员发言限制，编辑也复核圈权限，停用账号吊销会话；服务端只提供本人私有关系及公开聚合计数。
  - 文件：`src/state/actions.js`、`selectors.js`、`tests/community.test.mjs`
  - 验证：个人设置、退出重入不能解除管理限制；聚合计数无需暴露成员/收藏清单。
  - 回滚：停止服务，恢复成套数据库/私有文件备份与对应代码；禁止回滚成固定验证码公开服务。

### Changed · v10 学生贡献与治理
- 保留全校目录、一门课一个圈；有内容课程优先，帖子支持学期与章节、圈内按学期筛选；资料需标明原创/已授权/公开许可及来源。
- 新增建圈申请审核、非官方说明、隐私/版权/学术诚信与申诉信息；已有资料迁入仅提供只读清单预检，不绕过扫描和人工授权。
  - 文件：`src/pages/circles.js`、`misc.js`、`src/components/layout.js`、`scripts/import-resources.mjs`、部署交接文档。
  - 验证与未完成外部联调以 `DELIVERY_STATUS.md` 为准；不沿用历史浏览器截图结论。

### Docs
- 新增 `SOURCE_HANDOFF.md`：给接手维护者的源码交接说明（目录职责、运行/测试命令、9.2 关键规则、数据位置、改码与发版流程、部署清单、已知限制）。
  - 文件：`SOURCE_HANDOFF.md`
  - 验证：照文档执行 `node scripts/serve.mjs`、`node scripts/check.mjs`、`npm test`，均可复现
- 打包源码交接包 `release/gongye-v9.2-source/` 与 `release/gongye-v9.2-source.zip`：含 `src/`、`assets/`、`scripts/`、`tests/`、`server/` 代码、全部 `*.md` 与站点配置；不含 `server/data/`、`server/allowlist.txt`、`docs/` 截图。
  - 文件：`release/gongye-v9.2-source/`、`release/gongye-v9.2-source.zip`、`SOURCE_MANIFEST.txt`
  - 验证：解压后 `node scripts/check.mjs` 与 `npm test` 通过；清单 SHA-256 与文件一致
  - 影响：无代码/数据变化，仅交付物
  - 回滚：删除该目录与 ZIP 即可，不影响线上

---

## [9.2.0] - 2026-10-29

主题：课友圈改为「一门课程一个共用圈」——不再区分教学班、教师与学期。

### Changed
- 圈子数据模型只保留 `id / courseId / status / createdBy / inviteCode / createdAt / pinnedPostId`，删除 `term / section / teacher`。
  - 文件：`src/data/seed.js`、`src/state/actions.js`、`src/state/selectors.js`
  - 影响：旧帖子和成员关系按课程合并；圈数量 = 课程数（2375，不含「通用学习」）
  - 回滚：还原上述文件并把 `STORE_VERSION` 改回 7
- 种子数据合并：`ci_calc_b`、`ci_calc_old` 的帖子与成员并入 `ci_calc_a`；成员关系按 `(用户, 圈)` 去重。
- 「找课」页去掉学期、教学班筛选和输入框，只按学校、课程名/课程搜索；标题改为「找到你的课程圈」，卡片只显示课程名、学校、成员数。
- 建圈申请只填课程 + 说明；管理员建圈只选课程，已有圈的课程返回 `duplicate_circle`。
- 圈子页、课程页、资料详情、帖子标签、邀请页、账号页、后台列表统一称「课程圈」，不再展示教学班/教师/学期。
- `circleLabel` 改为「课程名 · 课友圈」；新增 `circleOfCourse(db, courseId)` 供一对一校验。
- `submitApplication`、`createCircle` 在课程已有圈时直接拒绝。
- `STORE_VERSION` 7 → 8，`seedVersion` 5 → 6（本地演示数据重建一次）。

### Removed
- 种子里的归档演示圈 `ci_calc_old` 与分教学班圈 `ci_calc_b`；归档能力仍保留（管理员可归档课程圈）。
- 找课页学期/教学班筛选、后台建圈表单的学期/教学班/教师输入。

### Tests
- 逻辑测试：建圈只按课程、重复课程被拒、归档圈加入被拒（改为管理员归档 `ci_phys` 后验证）。
- 新增 9.2 断言：课程数 = 圈数、每门课唯一圈、圈对象不含 term/section/teacher、邀请码唯一。
- 渲染测试：圈页不再出现「教学班待补充 / 教师未填写」，找课页文案改为「课程圈」。

### Docs
- 新增 `DEPLOY_V9.2.md`；`V9_ACCEPTANCE.md` 增补 9.2 验收；README 部署入口指向 9.2；`IMPLEMENTATION_STATUS.md` 更新。

### Verified
- `node scripts/check.mjs` 通过（23 条路由、31 个模块、36 个素材引用）。
- `npm test`：logic 39/39、render 5/5、boot 3/3、pilot 11/11，共 58 项通过。
- 数据核对：2376 门课程中 2375 门有圈（「通用学习」除外），`courseId` 无重复，圈对象无 term/section/teacher；`ci_calc_a` 合并后 6 条帖子，成员含原 A/B/旧圈用户。
- 浏览器视觉验收未执行（沙箱无 Chrome 调试端口），见 `V9_ACCEPTANCE.md` 待办。

---

## [9.1.0] - 2026-10-29

主题：接入第九版美术包「每日一页」102 张逐日插画 + 18 张新页页表情；落地 9.1 的课程 Tag 必填、课程优先搜索、手机卡片密度与卡片配色层级；导入浙大 2026-2027 秋冬课程并建立 2026秋冬 待补充课友圈。

### Added
- 每日页签接入 102 天逐日插画：`assets/daily/webp/*.webp`（106 个文件，含 4 张 `-neutral` 文化替代）；`src/data/daily-bookmarks.js` 每条新增 `illustration_id/path/png_path/scene/variant/neutral_illustration_path`，`src/components/bookmark.js` 优先读 `illustration_path`，失败再退回母题。
  - 文件：`scripts/v9-merge-art.mjs`、`src/data/daily-bookmarks.js`、`src/components/bookmark.js`、`src/main.js`、`assets/daily/webp/`
  - 验证：`node tests/logic.test.mjs`（每日页签插画路径）；`node scripts/check.mjs` 资源引用通过
- 页页表情第二、三弹共 18 个：`assets/stickers/vol2|vol3/{webp,thumb}`；`src/data/stickers.js` 改为 3 个弹次、22 个稳定 ID，弹层按弹次分组、单列滚动（`max-height:min(58vh,420px)`）。
  - 文件：`src/data/stickers.js`、`src/components/ui.js`、`assets/css/app.css`、`assets/stickers/`
  - 验证：逻辑测试断言 22 个 ID 唯一、v1/v2/v3 均在白名单；`check.mjs` 通过
- 新增 `src/data/zju-courses-2026aw.js`（2371 门浙大 2026-2027 秋冬课程名）与生成脚本 `scripts/build-zju-catalog.mjs`；`seed.js` 为每门课派生一个「2026秋冬 · 教学班待补充」课友圈（id `zjc_*`，邀请码 `ZJ-*`），同名演示课程复用。
  - 文件：`scripts/build-zju-catalog.mjs`、`src/data/zju-courses-2026aw.js`、`src/data/seed.js`、`src/lib/format.js`（`TERMS` 增加 `2026秋冬`）
  - 说明：与演示课程同名的（数据结构、概率论与数理统计）复用课程记录，但仍各补一个 2026秋冬 圈；共 2371 个「教学班待补充」圈
  - 影响：`STORE_VERSION` 6 → 7，旧本地演示数据会在首次打开时重建；线上真实数据不受影响（部署包不含后端）
  - 回滚：还原上述文件并把 `STORE_VERSION` 改回 6
- 找课页支持按课程名搜索与分页（每页 20），课程下拉只列当前筛选/前 60 门；建圈申请默认学期改为 `2026秋冬`。
- 资料发布表单：主课程改为必选（空选项 + 必填标记 + 行内错误「请选择这份资料对应的课程。」）；支持 `?course=` 预填、草稿回填、保存草稿、申请补充课程；课程页新增「分享本课程资料」入口。
- 资料详情：旧资料缺少课程时显示「课程待补充」低强调 Tag；作者本人可补选主课程（`setResourceCourse`），其他人不可改。
- 搜索页新增「已按课程优先」提示、别名歧义候选 chips、以及独立的「该课程其他资料」（C 组）区块。

### Changed
- 资料卡结构改为课程 Tag 优先：`.res-course-tag`（背景 `#F3DDC8`、文字 `#713E29`、边框 `#D7AA87`、600 字重、44px 触达区）→ 类型 Tag → 标题 → 摘要 → 元信息 + 操作；缺课程时显示「课程待补充」。
- 手机（≤600px）卡片：内边距 14、间距 12、标题 16/22 两行、摘要 14/20 两行、次要信息一行；不设固定高度、不裁切。
- `searchResources` 返回 `{items,total,courseOnly,mode,course}`：显式 `courseId` 为硬筛选；查询中的课程名/别名解析为课程 + 剩余意图；别名同名校过多时优先已有资料的课程，仍多门则给候选不合并；排序按分数，`courseOnly` 永不混入主结果。
- `resolveCourseQuery` 增加最长课程名优先、同名课程按资料量收敛、别名精确匹配优先等规则，避免浙大目录里的同名课程把搜索全部判为歧义。

### Fixed
- 页签插画加载失败时不再把整张卡降级为无图：仅移除插画区域（`data-bookmark-art`），文字与署名保留。

### Tests
- `tests/logic.test.mjs` 新增 8 项：课程优先搜索分组、硬筛选、同名歧义候选、发布缺课程/不存在课程被拒、草稿不入索引、旧资料可搜且作者可补选、逐日插画与文化替代、22 个表情、浙大课程与 2026秋冬 圈数量。
- 合计 `node tests/logic.test.mjs` 39 项通过；`render/boot/pilot` 分别为 5/3/11 项通过（`npm test` 共 58 项）。

### Docs
- 新增 `DEPLOY_V9.1.md`（上传清单、缓存与验收、回滚）与 `V9_ACCEPTANCE.md`（9.1 验收单）；README 部署入口指向 9.1；`IMPLEMENTATION_STATUS.md` 更新到 9.1。

### Verified
- `node scripts/check.mjs`：素材 36+、模块 32、路由 23 全部可解析。
- `npm test`：logic 39/39、render 5/5、boot 3/3、pilot 11/11，共 58 项通过。
- 静态服务冒烟：`/`、`/src/main.js`、`/src/data/zju-courses-2026aw.js`、`/assets/daily/webp/2026-10-27.webp`、`/assets/stickers/vol3/webp/yeye-hungry.webp` 均 200，WebP MIME 正确。
- 发布包：`release/gongye-v9.1/`（310 个文件、16.66 MB）与 `release/gongye-v9.1-static.zip`（313 项、16.7 MB），均含 106 张逐日插画。
- 浏览器视觉验收（360/390/430 + 桌面）未在沙箱内执行，见 `V9_ACCEPTANCE.md` 待办。

---

## [Unreleased]

### Docs
- 重写 DEPLOY_V7.md：只保留 v7.3.0 当前版本的部署说明（上传清单、缓存、25 项验收、回滚、限制），移除 v6 遗留部署记录与旧版本号。
- 新增 DEPLOY_V8.md（v8.0 部署说明、27 项验收、母题资源与回滚）；README 部署入口切换到 v8。


（暂无新改动。下一条改动请从这里开始写。）

---

## [8.0.0] - 2026-10-27

主题：接入第六版美术包「每日一页，从深秋到除夕」（102 天）。

### Added
- 新增 `src/data/daily-bookmarks.js`：2026-10-27 至 2027-02-05 共 102 条每日配置（日期、农历、星期、主题、句子、作者/朝代/篇名、原文链接、母题）。
- 新增 `src/components/bookmark.js`：浅色纸面页签组件（full / compact 两种排版），日期、农历、主题、宋体句子、署名、母题插画、共页页脚；`is-remembrance` 使用灰调。
- 新增 17 个母题 WebP：`assets/motifs/*.webp`，按配置加载，加载失败时隐藏插画、文字照常显示。
- 首页右栏与手机主栏改用当日配置：今天是 2026-10-27「创立纪念 / 世界很大，我们共读一页。」；右栏在 ≤1279 宽时隐藏，因此新增 `.mobile-bookmark` 在手机主栏展示同一张卡。
- 页签弹层改为整张纸面卡（640×1040 比例，桌面 380px、手机 calc(100vw-24px)），保留「收下」；经典句显示「查看原文」链接，原创标「共页原创」。
- 课友圈标题区加入品牌句「世界很大，我们共读一页。」（15–16px 次文字，手机 14px）。
- 配置超出 2027-02-05 时进入无日期兜底卡，不显示昨天日期。

### Files
- `src/data/daily-bookmarks.js`、`src/components/bookmark.js`、`src/components/ui.js`（转出 signCard）、`src/main.js`（页签弹层）、`src/pages/resources.js`（手机卡插入）、`src/pages/circles.js`（品牌句）、`assets/css/app.css`、`assets/motifs/`
- 数据来源：`gongye-v6/data/daily-bookmarks.json`；插画来源：`gongye-v6/assets/motifs/`

### Verified
- `npm test` 48/48（新增 102 天连续性/唯一性/关键日期测试）；`qa` 30 张；`qa-flow` 15/15。
- 浏览器：首页日期 2026.10.27、农历九月十八、星期二、创立纪念、母题银杏；桌面右栏与手机主栏各一张；弹层标题「今日页签 · 创立纪念」。

### Impact
- 仅展示与文案；领取额度、成长经验、下载权限未改。
- 102 天配置静态内置，不请求接口；超出范围走兜底，不循环复用旧日期。

### Rollback
删除 `daily-bookmarks.js`、`bookmark.js`、`assets/motifs/` 与相关样式，恢复 ui.js 的 signCard 与 main.js 的 quote modal。

---
## [7.3.0] - 2026-10-27

主题：全站下拉栏统一为自定义菜单（补上课友圈等页面）。

### Changed
- 下拉增强从「找资料的筛选栏」扩展到全站所有 `select.select`：课友圈找课（学校/课程/学期/教学班）、发布帖与发布资料（圈子/课程/类型/学校/学期/示例 PDF）、搜索页 tab、后台建圈课程。
- 自定义菜单沿用同一套美术：白底卡片、12px 圆角、轻阴影、选中项浅桃底 + 勾选、悬停、箭头旋转、焦点描边；选择后写回原生 select 并触发原有 `change`（自动提交/文件选择逻辑不变）。
- 窄下拉（如搜索页 tab）继承原 `max-width`，不撑宽布局。

### Verified
- `npm test` 47/47；`qa` 30 张；`qa-flow` 15/15。
- 浏览器逐页核对 `select.select` 与 `.fsel` 数量一致：
  - 找资料筛选 5/5、找课 4/4、发帖 6/6、发资料 6/6、搜索 1/1、后台建圈 1/1。
- 找课页选「通用·不限学校」后按钮文案更新，原生 select 值同步。

### Rollback
删除 `enhanceFilterSelects` 调用与 `.fsel*` 样式即可回到原生 select；业务逻辑不受影响。

---
## [7.2.0] - 2026-10-27

主题：今日页签榜改为帖子维度；筛选栏下拉菜单美术化。

### Changed
- 「今日页签榜」从“收到页签最多的人”改为“收到页签最多的帖子”：显示帖子标题、作者、枚数，点击进帖子；自己的帖子浅桃底高亮；标题单行省略。
  - 文件：`src/state/selectors.js`（`bookmarkBoard` 返回 post）、`src/components/ui.js`、`assets/css/app.css`
- 筛选栏的原生 select 增强为自定义下拉面板：白底卡片、12px 圆角、轻阴影、选中项浅桃底 + 勾选、悬停反馈、展开时箭头旋转与焦点描边；选择后仍自动提交筛选。
  - 文件：`src/main.js`（`enhanceFilterSelects`）、`assets/css/app.css`
- 演示数据补第 6 条今日赠送，`STORE_VERSION` 升到 6（老访客重建一次演示数据）。

### Verified
- `npm test` 47/47；`qa` 30 张；`qa-flow` 15/15。
- 浏览器：榜单为 4 / 2 / 1 枚的三篇帖子；学校下拉展开 32 个选项，选择「浙江大学」后 URL 带上 `school`，菜单收起。

### Rollback
还原 `bookmarkBoard`、榜单组件与 `enhanceFilterSelects`，并删除 `.fsel*` 样式；`STORE_VERSION` 改回 5。

---
## [7.1.0] - 2026-10-27

主题：颜色回退到较亮版本；右栏新增今日页签榜。

### Changed
- 颜色回退到 v6 的亮色板：底色 #FFFAF5、表面 #FFFFFF、浅区 #FFF0E6、主文字 #3C302B、陶红 #BD513C、边界 #F0E3DC；保留 v7 的字体、16px 圆角、卡片层级与页签纪念卡结构。
- 首页右栏新增「今日页签榜」：按今天收到的页签数取前 5 名，显示名次、头像、昵称、枚数；自己上榜时浅桃底高亮；空榜显示自然空态。
  - 文件：`src/state/selectors.js`（`bookmarkBoard`）、`src/components/ui.js`（`bookmarkBoardCard`）、`src/pages/resources.js`、`assets/css/app.css`
- 演示数据补 3 条今天的赠送（g_3–g_5），`STORE_VERSION` 升到 5，老访客首次打开会重建演示数据一次。
  - 文件：`src/data/seed.js`、`src/state/store.js`

### Verified
- `npm test` 47/47（新增今日页签榜 1 项）；`qa` 30 张；`qa-flow` 15/15。
- 浏览器：首页右栏榜单为 橘子还没熟 2 枚 / 括号没闭合 2 枚 / 晚点再睡 2 枚；底色 rgb(255,250,245)、卡片纯白、主色 rgb(189,81,60)。

### Impact
- 仅颜色、右栏小组件与演示数据；领取/赠送/成长规则未改。
- `STORE_VERSION=5` 会清空本机旧演示数据一次，生产后端不受影响。

### Rollback
还原 `assets/css/app.css` 的 v7 `:root` 颜色、移除榜单组件与 `bookmarkBoard`，并把 `STORE_VERSION` 改回 4。

---
## [7.0.0] - 2026-10-27

主题：第七次更新（第五轮美术精修：配色、字体、卡片层级、找资料列表、每日页签）。

### Changed
- 全站色板、字体与标题层级按第五轮美术包调整：底色 #F8F5EF、表面 #FFFDF9、陶红 #A55243、边界 #E6DDD2；系统无衬线，宋体只用于页签句子。
- 主卡片 16px 圆角 + 细边框 + 极淡阴影，悬停不再上移；侧栏辅助分区改透明 + 细分隔线，移除右栏重复的分享卡与找课卡。
- 资料卡重排：类型 → 标题 → 课程/学期 → 摘要 → 文件页数 → 作者/时间；文件大小、版本、学校、未覆盖范围移入详情；列表不再显示内部规则句。
- 全站搜索标「搜全站」，页面搜索标「搜本页资料」，避免同名不同行为。
- 每日页签改为纪念卡：日期、句子、署名、共页标记、可赠余额；10-27 起启用「世界很大，我们共读一页。」，2026 标「创立纪念」，2027 起标「N周年」；已领取显示「查看今日页签」。
- 资料详情前两页预览在手机改单页适宽；收藏空状态改用书本插画。

### Files
- `src/data/quotes.js`、`src/state/actions.js`、`src/components/ui.js`、`src/main.js`、`src/pages/resources.js`、`src/pages/account.js`、`src/components/layout.js`、`assets/css/app.css`
- 新增素材：`assets/art/v5-book.webp`、`assets/art/v5/bookmark-*.svg`

### Impact
- 仅视觉、文案与页签展示；领取额度、上限、下载权限、成长值规则未改。
- 页签句子改由 `bookmarkOfDay` 计算；普通日期仍用 `quoteOfDay`，旧数据无需迁移。

### Verified
- `npm test` 46/46（新增周年/普通日期 1 项）；`qa` 30 张；`qa-flow` 15/15。
- 浏览器：2026.10.27 页签显示「创立纪念 / 世界很大，我们共读一页。/ 共页」，领取弹层一致。

### Known
- 收藏集/卡册未实现；PDF 仍为前两页图片预览；日期取本机时钟，生产需服务端校验。

---
## [6.0.0] - 2026-10-26

主题：第六次更新（选项卡卡片化 + 同页切换卡片展开）。

### Changed
- `.tabs` 改为独立卡片（白底、暖边框、14px 圆角、轻阴影），`.tab` 改为圆角按钮，选中项浅桃底 + 内描边，不再用下划线。
  - 文件：`assets/css/app.css`
- 仅 query 变化（tab、筛选、排序）时，内容卡片以 `gy-card-open`（220ms，上移 8px + 缩放 0.995 + 透明度）入场，不再瞬移。
  - 文件：`src/main.js`、`assets/css/app.css`
  - 验证：管理后台切换 tab 后 `data-enter="tab"`、卡片 `animation-name: gy-card-open`，且不触发 View Transition
- `prefers-reduced-motion` 下取消位移/缩放。

### Docs
- 新增 `V6_ACCEPTANCE.md`、`DEPLOY_V6.md`；README 部署入口切换到 v6。

### Verified
- `npm test` 45/45；`qa` 30 张；`qa-flow` 15/15。

---
## [5.0.0] - 2026-10-26

主题：第五次更新（上传来源确认、手机过渡、手机自适应）。

### Fixed
- 未勾选“文档来源”仍能上传：现在所有带图片、附件或资料元信息的发布都在服务端校验 `confirmedOriginal`，未勾选返回 `need_confirm`；表单文案改为「文档来源」并注明后果。
  - 文件：`src/state/actions.js`、`src/pages/posts.js`、`src/pages/resources.js`
- 手机端卡片过渡闪白：触屏不再使用 View Transition 快照交叉，也不叠加页面淡入；改为详情卡不透明上移 10px / 220ms，关闭恢复列表。
  - 文件：`src/main.js`、`assets/css/app.css`
  - 验证：390 触摸逐帧采样无空白帧（暗部 2.57%–2.59%）
- 手机排版半屏空/被裁切：表格改为自适应三列、单元格换行；附件与文件行允许换行、操作独占一行；关闭点击高亮并强制主栏/卡片 100%。
  - 验证：390 下 `scrollWidth = 390`，钱包表格 328px 无横向滚动

### Changed
- 个人主页“参与等级”更新为新称号（初翻/拾页/成册/共著/传薪）与页签经验说明。

### Docs
- 新增 `V5_ACCEPTANCE.md`、`DEPLOY_V5.md`（部署入口同步到 README）。

### Verified
- `npm test` 45/45（业务 27 + 渲染 4 + 启动 3 + 试用后端 11）；`qa` 30 张；`qa-flow` 15/15。

---
## [4.2.0] - 2026-10-26

主题：每日页签卡片显示今日日期；领取后推送“今日一句”。

### Added
- 页签卡片显示上海时区的今日日期（`2026.10.26 星期一`），游客与登录态一致。
  - 文件：`src/components/ui.js`、`assets/css/app.css`
  - 验证：首页右栏与课友圈侧栏均显示
- 领取页签成功后弹出“今日一句”卡片：测试阶段固定使用泰戈尔《飞鸟集》「天空不留下鸟的痕迹，但我已飞过。」，附作者与出处；衬线排版、细分割线、柔和渐变、淡入 240ms，`prefers-reduced-motion` 下取消位移动画。
  - 文件：`src/data/quotes.js`、`src/state/actions.js`（`claimDaily` 返回 `quote`）、`src/main.js`（`showQuoteModal`）、`assets/css/app.css`
  - 验证：浏览器实测领取 → 弹层文本/出处正确；同一天重复领取仍被拒绝
- 文案固定在本地的 `QUOTES` 数组，不请求外部接口；后续换句子只改这一处。

### Verified
- `npm test` 44/44（业务 26 + 渲染 4 + 启动 3 + 试用后端 11）；`qa-flow` 15/15。
- 截屏：`docs/screenshots/15-daily-quote.png`。

### Known
- 目前只有一句（按测试阶段要求）；每日轮换逻辑已按日期哈希预留，但只有一条时不会变化。

---
## [4.1.0] - 2026-10-26

主题：页签正式参与成长（按用户要求，覆盖 v4 包里“页签不换经验”的默认设定）。

### Added
- 收到同学送的页签：每枚 +5 经验，每天最多 5 枚；同一发送者每天最多触发 1 次；领取、赠送、自赠不加经验。
  - 文件：`src/data/growth.js`（规则版本 `growth-v4.3`）、`src/state/actions.js`（`evaluateMarkerXp`）、`src/state/selectors.js`
  - 影响：等级会因获赠页签上升；帖子被移除、页签退回时对应经验撤销
  - 验证：新增测试覆盖 +5、同发送者 0、日额 5 枚、第 6 枚 0
- 成长页新增「收到页签」规则行与「今日页签 x/5」计数；私有流水显示“收到页签 · 原帖”。
- 等级说明浮层同步文案。

### Docs
- `V4_ACCEPTANCE.md` 补充 G26 与 G18 说明（页签参与成长是本轮用户指定偏离）。

### Verified
- `npm test` 43/43（业务 25 + 渲染 4 + 启动 3 + 试用后端 11）；`qa-flow` 15/15。

---
## [4.0.0] - 2026-10-26

主题：第四次更新（等级成长 + 简约视觉）。

### Added
- 五级等级与称号：初翻 / 拾页 / 成册 / 共著 / 传薪，门槛 0/50/150/400/1000；进度按本级真实区间计算，最高级不除零。
  - 文件：`src/data/growth.js`、`src/lib/format.js`
  - 验证：等级边界、185→35/250、1000/1005 测试
- 经验账务改为「决策 + 流水」：发帖 +5（≥20 有效字、每天 2 篇）、评论 +1（≥10 字、每天 5 条、同帖 1 条、本人帖不计）、被采纳 +10（主评论、求助帖、每天 2 次、同提问者 1 次）；重复文本 30 天去重；删除/取消采纳可撤销。
  - 文件：`src/state/actions.js`
  - 验证：24 项业务测试（含撤销、日额、改选、重复）
- 「我的成长」页：等级、进度、五级路线、经验来源与今日名额、私有流水。
  - 文件：`src/pages/growth.js`、`src/router.js`、`src/pages/index.js`
- 详情作者行与评论显示中性等级徽记（`badges/level-N-chip.svg`，72×24），列表/搜索/发布器不显示；他人主页不展示经验。
- 升级提示：跨级后 900ms 轻提示「升到 LV.x 名称了」。
- 新增素材：`assets/badges/`（5 组 chip/icon）、`assets/covers/`（3 组封面底稿）、`assets/mascot/yeye-growth.png`。

### Changed
- 简约视觉：卡片圆角 24→18，输入/按钮 12，标签 6；边框 `#EADFD6`；桌面悬停 4→2px；按压 0.985→0.99；详情打开/关闭 300/300→280/220ms；正文 16px/1.65。
  - 文件：`assets/css/app.css`
- 个人主页本人显示经验与「我的成长」入口，他人只显示公开等级。

### Docs
- 新增 `V4_ACCEPTANCE.md`（G01–G25、V01–V12、限制、回滚）。
- 新增 `DEPLOY_V4.md`；README 部署入口切换到 V4。

### Verified
- `npm test` 42/42（业务 24 + 渲染 4 + 启动 3 + 试用后端 11）；`qa` 30 张；`qa-flow` 15/15。
- 浏览器：信息流等级徽记 0 个，详情 7 个；成长页 LV.3、5 个路线节点、4 条私有记录。

### Known
- 升级提示是 toast，不是可关闭小卡；封面素材已接入但列表仍用紧凑附件行；并发/跨零点/多设备/200% 字号未验证；旧数据迁移仅按旧流水计入。

---
## [2.5.2] - 2026-10-26

### Docs
- `DEPLOY_V2.5.md` 明确本次是 **V2.3（暖色与动效）+ Art V3（Logo/头像/页页表情/插画）两版美术合并发布**，一次整包覆盖，不需要分两次；并补充“只传一版会出现新卡片+旧图标混搭”的提醒。

### Verified
- 文档内关键文件清单已与当前 `app/` 实际文件核对（87 个文件、约 2.3 MB）。

---
## [2.5.1] - 2026-10-26

### Docs
- 新增 `DEPLOY_V2.5.md`：面向 WorkBuddy 的当前部署说明，覆盖发布包制作、必检文件、缓存策略、16 项线上验收、管理员测试账号的安全边界、回滚与常见问题。
- `README.md` 的部署入口改为指向新文档；旧 `REDEPLOY_V2.3.md` 标注为历史版本。

### Verified
- 发布包实测：87 个文件、约 2.3 MB；必检文件全部存在。

---
## [2.5.0] - 2026-10-26

主题：管理员测试账号 + 建圈 + 封禁账号/帖子。

### Added
- 内置管理员测试账号：`admin@gongye.test` / 验证码 `123456`（演示模式登录页也有「管理员测试」一键切换）；试用后端 `启动试用.cmd` 默认 `ADMIN_EMAIL=admin@gongye.test`，`allowlist.txt` 已加入该邮箱。
  - 文件：`src/data/seed.js`、`src/data/demo-v3.js`、`server/启动试用.cmd`、`server/allowlist.txt`、`PILOT.md`
  - 验证：邮箱登录后落在 `#/admin`；刷新仍保持登录
- 管理员登录后自动进入管理后台（普通用户仍去 `/resources`）。
  - 文件：`src/main.js`
- 管理后台「圈子」页新增**新建课友圈**表单：课程、学期、教学班、教师；同一课程/学期/教学班不可重复，邀请码自动生成，写入审计。
  - 文件：`src/state/actions.js`（`createCircle`）、`src/pages/misc.js`、`src/main.js`
  - 验证：创建后跳转到新圈，圈内可发帖
- 管理后台新增「内容」页：帖子列表支持**封禁/解封**；封禁后帖子从列表、搜索、详情下架，关联资料同步下架，解封恢复。
  - 文件：`src/state/actions.js`（`setPostStatus`）、`src/pages/misc.js`、`src/main.js`、`src/pages/posts.js`
- 「用户」页把“停用/恢复”改为**封禁/解封**，记录封禁时间与原因；被封禁账号会话失效、不能登录或互动。

### Changed
- `STORE_VERSION` 3 → 4：旧演示数据自动重建，确保每台机器都能出现管理员测试账号（本机测试内容会重置）。
- 管理后台表格列宽调整（状态/操作/作者不换行）。

### Verified
- 浏览器流程：管理员邮箱登录 → `#/admin`；新建「教学班C」课友圈 → 跳转成功；封禁 `p_calc_notes` → 详情/列表/资料均不可见 → 解封恢复；封禁 `u_zhixia` → `status=suspended`。
- `npm test` 37/37（业务 19 + 渲染 4 + 启动 3 + 试用后端 11）；`qa` 30 张截图；`qa-flow` 15/15；`docs/gallery` 重新生成（含 4 个管理页）。

---
## [2.4.5] - 2026-10-26

主题：退出详情的动画与进入对称。

### Changed
- 关闭时长 240ms → **300ms**，缓动与打开一致（`cubic-bezier(0.22,1,0.36,1)`）；背景同样在 140ms 后淡入 160ms。
- 关闭时详情快照保持不透明到 84%，卡片缩到接近列表大小时再切到列表卡内容；不再出现“整张大卡半途洗白”的观感。
- 打开时的图片解码等待 120ms → 60ms，让打开/关闭的整体时长更接近（实测 416ms / 334ms，动画本身都是 300ms）。

### Verified
- 逐帧采样（900×600 screencast）：关闭过程内容暗部占比稳定在 0.75–1.07%，不再出现 <0.2% 的空白帧。
- 关闭后 `scrollY 413 → 413`、焦点回到来源卡片；无运行时异常。
- `npm test` 35/35、`qa-flow` 15/15、`qa` 30 张截图通过。

---
## [2.4.4] - 2026-10-26

主题：修掉卡片过渡时整页「闪一下」。

### Fixed
- **根因**：共享元素过渡期间用 CSS 压掉了页面淡入（`data-vt`），过渡结束撤掉标记时，`gy-fade-up` 会**从 opacity 0 重新播放**，整页白一下再淡回来。
  - 修复：使用 View Transition 的那次渲染直接不排队页面淡入与列表错峰；路由淡入改为只在 `[data-enter="route"]` 时生效。
  - 文件：`src/main.js`、`assets/css/app.css`
  - 验证：过渡期间与结束后逐帧采样 `.layout` 的 computed opacity，最小值为 1，无重播动画帧
- 过渡结束不再重绘头部/底部导航（之前会重建 Logo 与头像节点，可能闪一帧）。
- 背景改为“旧页保持不透明、新页延迟淡入”，避免两层半透明叠加时透出底色；`html` 也补了底色，任何透明帧都不会露出白底。
- 详情打开/关闭结束时，圆角（24 → 28）与阴影改为 200ms 过渡，不再瞬间跳变。

### Verified
- 帧采样：打开/关闭整段中 `.layout` opacity 恒为 1；`qa` 30 张截图、`qa-flow` 15/15、`npm test` 35/35。
- 降级路径（模拟无 `startViewTransition`）：打开/返回、滚动与焦点正常，无异常。

---
## [2.4.3] - 2026-10-26

主题：把「卡片展开」调顺（只让卡片动、背景延迟换、滚动对齐）。

### Changed
- 背景不再和卡片同时交叉淡入：旧页面先停留 140ms，再用 140ms 换成新页面；卡片仍是唯一在动的元素，避免“旧列表 + 新侧栏”两层半透明叠在一起。
- 打开/关闭分开时长：打开 300ms、关闭 240ms（原 320/320），关闭曲线更干脆。
- 打开详情时按来源卡片的视口位置对齐滚动，不再无条件跳回顶部（页面不够高时以最大滚动为限）。
- 过渡期间两边卡片统一 24px 圆角、详情卡暂时去掉阴影，避免边角与阴影“提前出现”。
- 过渡回调只重绘 `#view`，头部与底部导航在过渡结束后再更新，减少过渡期间的布局与重绘。
- 新页面快照前等待图片解码（最多 120ms），避免头像/预览在动画中途补出来。
- 去掉“过渡结束后内容再淡入”的做法：它会在快照撤下的瞬间闪一下空白。

### Verified
- 打开/关闭均正常；`scrollY 1003 → 1003`，焦点回到来源卡片。
- 过渡后 `data-vt` / `data-vt-dir` 已清理，无运行时异常。
- `node scripts/qa.mjs` 30 张截图通过；`qa-flow.mjs` 15/15。

### Known
- View Transition 对整张卡是“快照交叉淡入”，在动画前 1/3 仍能看到一点新旧内容叠影；要完全消除需要改成自绘浮层 + FLIP（约 150 行，尚未做）。

---
## [2.4.2] - 2026-10-26

### Fixed
- 旧浏览器数据导致看不到 V3 账号/对话：`STORE_VERSION` 2 → 3，`seed.version` 同步为 3；旧 `localStorage` 会被丢弃并重新生成 V3 演示数据，不再需要手动清缓存。
  - 文件：`src/state/store.js`、`src/data/seed.js`
  - 验证：带旧版本 localStorage 打开页面，用户为 8 个 V3 账号、评论 18 条、表情 5 处

### Changed
- 登录页演示账号由 4 个扩到 9 个（含 momo、小林、周三再说等），方便逐个查看不同用户。
- 搜索无结果时显示共共/页页插画（手机也能看到）。
  - 文件：`src/pages/account.js`、`src/pages/resources.js`

### Verified
- `node scripts/check.mjs` 通过；`npm test` 35/35。

---
## [2.4.1] - 2026-10-26

### Changed
- 资料首页右栏新增小品牌模块：共共/页页双人插画 140px + “找我的教学班”入口；常规信息流仍不放角色。
- 演示帖「连续性这一页重写了」带上「补好了」页页表情，使列表/详情能直接看到表情效果。

### Docs
- `VISUAL_V3.md` 新增「素材清单与去向」：逐项说明 v3 包每个文件用在哪里、哪些按规则不直接使用。
- `docs/screenshots/01-home-1440.png`、`09-home-390.png`、`06-post-1440.png` 重新截取。

### Verified
- `node scripts/qa.mjs` 30 张截图，无控制台异常、无横向溢出。

---
## [2.4.0] - 2026-10-26

主题：接入美术包 Art V3（用户 Logo、生活化头像与演示内容、页页表情、共共/页页克制使用）。

### Added
- 用户提供的书页 Logo 用于顶栏（`assets/brand/logo.png`，原稿保留为 `logo-original.png`）。
  - 文件：`src/components/layout.js`、`assets/css/app.css`
  - 验证：顶栏截图；桌面 30px / 手机 26px
- 8 个生活化演示账号（猫/山景/咖啡照片 + 涂鸦/月亮/像素苗/橘子/海浪 SVG），昵称与简介按 V3 文档，允许空简介。
  - 文件：`assets/avatars/*`、`src/data/demo-v3.js`
- 页页表情：4 张固定 PNG、白名单、评论/发帖可选 1 个、仅表情评论允许、发送后保存并回显、加载失败文本 fallback。
  - 文件：`src/data/stickers.js`、`src/state/actions.js`、`src/components/ui.js`、`src/pages/posts.js`、`src/main.js`、`assets/stickers/*`、`assets/css/app.css`
  - 影响：新增可选字段 `post.stickerId` / `comment.stickerId`（老数据为 undefined，兼容）；无接口破坏
  - 验证：`npm test` 新增 2 项（白名单、仅表情评论）；浏览器实测发送→回显→刷新仍在；非法 ID 返回 `bad_sticker`
- 空收藏使用共共/页页双人插画（`assets/mascot/duo.png`，128px），常规页面不放角色。

### Changed
- 12 条主帖与 18 条评论改为 V3 的生活化语气与具体学习上下文；资料标题、附件名同步更新。
  - 文件：`src/data/demo-v3.js`、`src/data/seed.js`
  - 验证：QA 页面文案与截图
- 头像路径支持子目录并统一 `object-fit: cover`；设置页头像候选换成 8 张生活化头像。
  - 文件：`src/lib/icons.js`、`src/pages/account.js`

### Docs
- 新增 `VISUAL_V3.md`（落地记录、Y01–Y07 / R 系列结果、已知限制）。
- 更新 `docs/screenshots/` 与 `docs/gallery/`（V3 内容与头像）。

### Verified
- `node scripts/check.mjs` 通过；`npm test` 35/35（业务 17 + 渲染 4 + 启动 3 + 试用后端 11）。
- `node scripts/qa.mjs` 30 张截图，无控制台异常、无横向溢出；`qa-flow.mjs` 15/15。
- 浏览器断言：表情面板 4 项、选择不自动发送、仅表情评论保存回显、刷新仍在、空收藏插画存在。

### Known
- 页页面板为内联面板，不是桌面锚定浮层/手机抽屉；未接入上传状态插画；未做真机与录屏。
- 6 份资料仍绑定明确标注的示例 PDF（v3 fixture 为未绑定）；未绑定分支已实现但未启用。
- 12 条主帖之外保留了 6 条状态/归档演示记录（处理中、扫描失败、未收录、归档、物理讨论、新用户帖）。

### 影响 / 回滚
- 影响：静态文件 + 演示数据；接口仅新增可选 `stickerId` 字段；权限与页签规则未改。
- 回滚：还原 `assets/`、`src/data/seed.js`、`demo-v3.js`、`stickers.js`、`actions.js`、`ui.js`、`posts.js`、`account.js`、`icons.js`、`layout.js`；或回退平台上一版部署。

---
## [2.3.1] - 2026-10-26

### Added
- 新增 `REDEPLOY_V2.3.md`：给 WorkBuddy 的重新部署说明（发布清单、整目录覆盖、缓存处理、12 项验收、回滚、交付记录表）。
  - 文件：`REDEPLOY_V2.3.md`、`README.md`（部署段落改为优先指向本文）
  - 验证：按文档第 2 节生成 release 目录，`Test-Path src\api\client.js` 为 True
- 新增 `VISUAL_V2.3.md`：视觉改造记录、V01–V20 验收表与已知限制。
- 新增 `CHANGELOG.md`（本文件）与 `AGENTS.md` 维护规则。

### Docs
- `README.md` 增加“视觉 V2.3”章节与更新日志入口。

---

## [2.3.0] - 2026-10-26

主题：按 `gongye-visual-update` 包做**暖色圆润卡片 + 动效**增量改造（业务、数据、接口、权限未改）。

### Changed
- 整站主题由绿改为奶油白 / 浅蜜桃 / 珊瑚橙；强制浅色，移除深色可能性。
  - 文件：`assets/css/tokens.css`（语义变量整体重映射）、`index.html`（`theme-color`、`color-scheme`）
  - 影响：所有页面的颜色；无接口/数据变化
  - 验证：`getComputedStyle(body).backgroundColor` 为 `rgb(255,250,245)`；1440/390 截图
  - 回滚：还原 `tokens.css` 与 `index.html`
- 卡片、按钮、输入、标签的圆角与阴影按 token 调整：卡 24（手机 22）、详情 28（手机 26）、输入 16、按钮 14、媒体 16、小标签 8。
  - 文件：`assets/css/app.css`（追加 V2.3 段落）
  - 验证：DevTools 读 `border-radius` / `box-shadow`；截图对照
- 桌面悬停抬起 4px / 180ms、离开 160ms、按下 0.985 / 90ms（仅精细指针启用悬停）。
  - 验证：模拟鼠标移入后 `transform: matrix(1,0,0,1,0,-4)`、阴影含 `rgba(110,70,45,0.13)`
- 打开资料/帖子详情改为共享元素过渡（View Transitions），320ms；返回 260ms；不支持或 reduce 时降级淡入。
  - 文件：`src/main.js`
  - 验证：打开详情后 `window.__gyMotion.routeTransitions` +1；返回 `scrollY` 恢复、焦点回来源卡
- 列表首屏前 6 张错峰 20ms 入场；页签指示线 180ms；新评论单独淡入。
  - 验证：`document.querySelectorAll('.stagger-in')` 为 6，delay 0–100ms，320ms 后清理
- 25 个 SVG（图标、板块、空态、文件、页签、笔记样张）按暖色重着色；6 个默认头像重绘为暖色人物剪影（原三角在橙色下像警告图标）。
  - 文件：`assets/art/*.svg`
  - 验证：`avatar-01.svg` 含 `FFE9DC`；页面无绿色残留
- 资料卡/帖子卡支持整卡点击（保留标题链接、Ctrl/Cmd、新标签、按钮独立），新增 `card-hover`、`data-card-id`、`data-href`。
  - 文件：`src/components/ui.js`、`src/main.js`
  - 验证：点击卡片空白处进入详情；点收藏/送签/其他链接不误触

### Added
- 滚动位置按路径记忆、返回恢复；焦点回到来源卡片；共享元素过渡期间禁用页面淡入与错峰，避免双重动画。

### Docs
- 重新生成 `docs/screenshots/`（10 张精选）与 `docs/gallery/`（39 组、67 张）。
- 新增 `VISUAL_V2.3.md`。

### Verified
- `npm test`：33/33（业务 15 + 渲染 4 + 启动 3 + 试用后端 11）
- `node scripts/qa.mjs`：30 张截图，无控制台异常、无横向溢出
- `node scripts/qa-flow.mjs`：15/15
- 动效断言：悬停/按下/圆角/页签/错峰/共享元素/返回恢复/reduce 降级均通过

### Known
- 详情是“页面式共享元素过渡”，不是弹窗浮层（无 dialog 焦点锁）。
- 未做桌面悬停摘要、手机下拉收回、真机与帧率测量；无录屏。

### 影响 / 回滚
- 影响：纯静态文件；无 `config.js`、后端、数据变化。
- 回滚：平台回退上一版部署；或还原 `tokens.css`、`app.css`、`assets/art/`、`index.html`、`src/main.js`、`src/components/ui.js`。

---

## [2.2.2] - 2026-10-26

主题：跨域名部署支持（静态站与后端不同域）。

### Added
- CORS 预检与来源白名单（`ALLOWED_ORIGINS`），跨域登录改用 `Authorization: Bearer <token>`（浏览器默认不带第三方 Cookie）。
  - 文件：`server/pilot.mjs`、`src/api/client.js`、`src/main.js`
  - 验证：`node tests/pilot.test.mjs` 中“跨域预检 / Bearer token / 来源拒绝”3 项
- `server/启动跨域后端.cmd`；`PILOT.md` 增加“跨域名”章节（Cloudflare Tunnel 步骤、注意事项）。

### Verified
- 浏览器实测：静态站 4173 + 后端 8787 跨域注册 → 发帖 → 刷新保持登录 → 退出，8/8。

### 影响 / 回滚
- 影响：仅试用后端的接口行为；静态演示不受影响。
- 回滚：还原上述三个文件；关闭 `ALLOWED_ORIGINS` 即可退回同域。

---

## [2.2.1] - 2026-10-26

主题：内部试用后端（只给同事注册）。

### Added
- 单进程零依赖试用后端：白名单注册、HttpOnly Cookie 会话、状态脱敏、数据落盘 `server/data/db.json`、随时清空。
  - 文件：`server/index.mjs`、`server/pilot.mjs`、`server/allowlist.txt`、`server/启动试用.cmd`、`server/清空数据.cmd`
- 前端 `production` 模式：`src/api/client.js`、`createRemoteStore`、异步 `invoke`、登录页试用提示、隐藏演示账号切换与重置按钮。
  - 文件：`src/api/client.js`、`src/state/store.js`、`src/main.js`、`src/pages/account.js`、`src/pages/misc.js`、`src/components/layout.js`
- `PILOT.md` 使用说明；`tests/pilot.test.mjs`（8 项）；`scripts/qa-pilot.mjs`（8 项浏览器验收）。

### Fixed
- `claimDaily` / `markAllNotificationsRead` 的第二个参数被当成时间戳（`{}` 导致 Invalid time）——改为 `(db, payload, now)`，并给 `invoke` 加异常兜底。
  - 验证：领取页签余额 +1、同日重复领取被拒

### 影响 / 回滚
- 影响：新增 `src/api/client.js`（静态部署必须整目录覆盖 `src/`，否则白屏）。
- 回滚：删除 `server/` 与 `src/api/`，还原 `store.js`、`main.js`、`account.js`、`misc.js`、`layout.js`。

---

## [2.2.0] - 2026-10-26

主题：共页 v2.2 双核心静态站初版（找资料 + 课友圈）。

### Added
- 16 个页面路由：找资料首页/检索/详情/资料发布、课友圈聚合流/圈页/找课/邀请、帖子详情/发布/编辑、课程、搜索、个人主页、收藏、消息、页签、设置、登录、管理后台。
- 业务规则实现：资料索引条件、检索排序、入圈幂等、评论权限（含资料帖纠错）、页签领取/赠送/退款、成长值、举报与审计、归档只读。
- 演示数据（课程、圈、帖子、资料、评论、消息）与 `localStorage` 持久化；`demo-static` 模式。
- 部署文档 `DEPLOY_HANDOFF.md`（五平台）、`README.md`、`IMPLEMENTATION_STATUS.md`。
- 自动化：`tests/`（22 项）、`scripts/check.mjs`、`scripts/qa.mjs`、`scripts/qa-flow.mjs`、`scripts/qa-gallery.mjs`。

### Verified
- `npm test` 22/22；`qa.mjs` 30 张截图无异常；`qa-flow.mjs` 15/15。

---

## 补记说明

2.2.0–2.3.1 的条目由本次会话补齐（此前没有强制日志）。从 2.3.0 起严格执行上面的维护规则；历史条目只记录**已发生且可验证**的改动，不补写未实现的计划。





















