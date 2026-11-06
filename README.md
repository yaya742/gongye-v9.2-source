# 共页 v10.0 · 浙大课程学习互助

> **当前版本入口已改变：`npm start` 启动可信邮箱＋SQLite＋私有附件服务，不再是固定验证码试用服务器。**
> 当前说明见 [DEPLOY_PRODUCTION.md](DEPLOY_PRODUCTION.md) 和 [DELIVERY_STATUS.md](DELIVERY_STATUS.md)。Node.js ≥ 22.13，先 `npm ci --ignore-scripts`。
> 全校课程目录与一门课一个圈保留；SMTP、ClamAV、HTTPS、投诉邮箱等须由运营方配置。未配置时登录/上传失败关闭，不会退回演示账号或示例文件。
> 本文件下方为原版本历史说明，旧“零依赖”“固定码真实注册”“静态托管生产”等表述不适用于 v10。`npm run dev` 仅独立本地演示，不能承载真实用户。

## v10 快速入口

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
$env:RUN_PDF_INTEGRATION='1'; npm.cmd test   # 含真实 PDF.js + 画布渲染
npm.cmd run check
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:8787'
npm.cmd start
```

- 邮件：配置 SMTP 后使用随机一次性验证码；`zju.edu.cn`、`st.zju.edu.cn` 为默认精确域名白名单，请运营方核实实际覆盖范围。
- 管理员：仅通过真实邮箱验证且匹配服务端管理员列表后授予。不得在前端配置管理员身份。
- 资料：真实 PDF 上传、扫描、结构检查和前两页转图后才可发帖；20 MiB / 文件，最多 3 个附件。
- PDF 解析与转图在一次性子进程执行；崩溃或超时只让本次上传失败，不会拖垮服务进程。
- 数据：单实例 Node + SQLite WAL + 私有文件目录；不等于已验证全校同时在线容量。
- 原有资料：用 `npm.cmd run import:preview -- ./migration/manifest.json` 只读预检，再通过正常上传流程迁入。
- 隐私、版权、学术诚信与申诉：网站 `#/about`，配置 `SUPPORT_EMAIL` 后公开无需登录的联系渠道。

---

# 以下为 v2–v9 历史说明（仅供追溯，不能照此部署生产）

面向大学生的学习社区首版实现。两个并列核心：**找资料**负责引流（按课程检索、看适用范围、真实预览、受控下载、来源可追溯），**课友圈**负责留存（按课程＋学期＋教学班自愿加入、同进度讨论、回复回访）。

本仓库是**纯静态站点**：HTML + CSS + 原生 ES Module，零依赖、零构建。不需要 `npm install`，把目录放到任何静态托管上就能跑。

> 当前部署形态是 **demo-static 演示模式**：全部内容与账号都是演示数据，保存在访问者浏览器本地（localStorage）。它**不是**生产社区：没有真实服务端、真实邮件、真实文件存储与扫描。生产化路径见 [DEPLOY_HANDOFF.md](DEPLOY_HANDOFF.md) 第 13 节与 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)。

---

## 30 秒跑起来

```bash
cd app
node scripts/serve.mjs        # 等价于 npm run dev
# 共页静态预览：http://127.0.0.1:4173/
```

- 需要 Node.js ≥ 20（只用内置模块，无第三方依赖）。
- 必须通过 HTTP 打开：直接双击 `index.html` 会被浏览器的 ES Module 跨域策略拦住。
- 换端口：`node scripts/serve.mjs --port 8080`。
- 不想开终端：双击上级目录的 `打开网页.cmd`（自动起服务并打开浏览器）；双击 `打开网页总览.cmd` 看全部页面的网页总览。

## 更新日志

每次改动都要在 [CHANGELOG.md](CHANGELOG.md) 里记一条：**改了什么 / 影响文件 / 怎么验证**；涉及业务、接口、数据、部署的还要写影响与回滚方式。规则写在 [AGENTS.md](AGENTS.md) 第 1 节。

当前版本：`8.0.0`（第六版美术包：102 天每日页签 + 手机页签卡 + 品牌句）。

## 视觉 V2.3（暖色圆润卡片 + 动效）

整站改为奶油白 / 浅蜜桃 / 珊瑚橙的浅暖色，保留圆润卡片：桌面悬停抬起、按下回弹、列表错峰入场、页签指示线过渡；打开资料/帖子详情使用平台 View Transitions 做共享元素展开，返回恢复滚动位置与焦点，不支持时降级为淡入。业务与数据未改。

- 色值、圆角、时长：`assets/css/tokens.css`
- 改动与验收（V01–V20）：[VISUAL_V2.3.md](VISUAL_V2.3.md)
- 新截图：[docs/screenshots](docs/screenshots)、[网页总览](docs/gallery/index.html)

## Art V3（Logo · 生活化头像 · 页页表情）

- 顶栏换成用户提供的书页 Logo；8 个演示账号使用猫/山景/咖啡照片与 5 张原创 SVG 头像。
- 评论与发帖可选 1 个「页页表情」（收到 / 再想想 / 谢谢 / 补好了）：选择只进待发送区，发送后才保存并回显；服务端只接受白名单 ID，仅表情评论允许，加载失败有文本 fallback。
- 共共/页页只在空收藏放一处 128px 双语插画，常规浏览不放角色。
- 记录与限制：[VISUAL_V3.md](VISUAL_V3.md)
- 截图：[docs/screenshots](docs/screenshots)、[网页总览](docs/gallery/index.html)

## 等级与成长（第四次更新）

- 五级：初翻 0 / 拾页 50 / 成册 150 / 共著 400 / 传薪 1000；经验按本级区间显示进度。
- 列表、搜索、发布器不显示等级；打开详情后作者与评论旁显示中性 `LV.3` 徽记。
- 经验来源：合格帖子 +5、评论 +1、被采纳 +10、**收到同学送的页签 +5（每天最多 5 枚）**；领取/赠送页签不加。
- 「我的 → 我的成长」查看等级、五级路线、今日经验名额和私有经验流水。
- 每日页签卡片显示当天日期；领取后弹出「今日一句」（当前为泰戈尔《飞鸟集》）。
- 带图片/附件/资料的发布必须勾选「文档来源」；手机端使用轻量上移动效，表格与附件行自适应。
- 规则与验收：[V4_ACCEPTANCE.md](V4_ACCEPTANCE.md)
- 部署：见 [DEPLOY_V4.md](DEPLOY_V4.md)
## 管理员测试账号

- 邮箱：`admin@gongye.test`，验证码：`123456`（演示与试用固定码）
- 演示模式登录页底部也有「管理员测试」一键进入
- 登录后直接进 `#/admin`，可以：
  - 处理举报（选择处理方式并写理由）
  - **新建课友圈**（课程 / 学期 / 教学班 / 教师）
  - **封禁账号**（封禁后不能登录与互动）
  - **封禁帖子**（列表、搜索、详情与关联资料同时下架，可解封）
  - 归档圈子为只读、查看审计记录
- 正式使用前请删除 `server/allowlist.txt` 中的测试邮箱，并把 `启动试用.cmd` 的 `ADMIN_EMAIL` 改成自己的邮箱。

## 内部试用后端（只给同事注册）

如果想让同事**用自己的邮箱真实注册**、数据留在服务器上（而不是浏览器本地），启动试用版后端即可：

```bash
cd app
# 1) 把同事邮箱写进 server/allowlist.txt（一行一个）
# 2) 启动
node server/index.mjs          # 或 npm run pilot；Windows 可双击 server/启动试用.cmd
# 本机：http://127.0.0.1:8787/   同事（同一局域网）：http://你的内网IP:8787/
```

- 只有名单内邮箱能注册；验证码固定 `123456`（试用期不发邮件）。
- 数据在 `server/data/db.json`，双击 `server/清空数据.cmd` 即可清空。
- 详细步骤、局域网/防火墙、管理员设置见 [PILOT.md](PILOT.md)。
- 静态演示模式完全不受影响：不加后端时仍然是纯前端演示。

## 演示账号

登录页可以一键切换演示账号，也可以走邮箱验证码流程（**验证码固定 `123456`**，不会真的发邮件）。

| 身份 | 邮箱 | 数据状态 |
| --- | --- | --- |
| 橘子还没熟 | `qinghe@example.com` | 已加入 2 个课友圈，发布过资料与帖子，页签余额 3 |
| 括号没闭合 | `zhixia@example.com` | 已加入 2 个圈，有采纳记录 |
| 阿椰 | `linjian@example.com` | 线代求助帖作者 |
| 晚点再睡 | `alan@example.com` | Python 圈成员 |
| 周三再说 | `zhouzhou@example.com` | 学习方法帖作者 |
| 小半杯 | `nanzhi@example.com` | 咖啡头像，资料作者 |
| momo | `momo@example.com` | 页页表情评论示例 |
| 小林 | `xiaolin@example.com` | 列表复制帖作者 |
| 管理员测试 | `admin@gongye.test` | 管理员：举报、**新建课友圈**、**封禁账号/帖子**、归档圈子、审计 |

用任意其他邮箱登录会自动创建一个已验证的新账号（没有加入任何圈），方便验证「新用户也能独立发布资料」。

演示数据存在 `localStorage['gongye-demo-v1']`。重置入口：**账号设置**页或**管理后台**右下角的「重置演示数据」。

## 目录结构

```
app/
├── index.html                 # 唯一 HTML 入口（标题、meta、启动壳）
├── 404.html                   # 静态托管缺省 404 时回首页
├── _redirects                 # Cloudflare Pages / Netlify 的 SPA 回退
├── netlify.toml vercel.json   # 其他托管平台的等价配置
├── nginx.conf.example         # 自有服务器参考配置
├── robots.txt .nojekyll
├── VISUAL_V2.3.md             # 暖色与动效改造记录、V01–V20 验收
├── VISUAL_V3.md               # Art V3 落地记录（Logo/头像/页页表情/限制）
├── CHANGELOG.md               # 更新日志（每次改动必须追加）
├── AGENTS.md                  # 工程约定：改动必须写日志、改完必须验证
├── assets/
│   ├── css/tokens.css         # 暖色主题设计变量（V2.3，见 VISUAL_V2.3.md）
│   ├── css/app.css            # 全站样式（三栏 / 平板 / 手机）
│   ├── art/*.svg              # 品牌图标、空态与默认占位头像
│   ├── brand/logo.png         # 用户提供的 Logo（透明版）
│   ├── avatars/*              # 8 张生活化演示头像（3 照片 + 5 SVG）
│   ├── stickers/*.png         # 4 张页页表情
│   ├── mascot/duo.png         # 共共/页页透明插画（空态用）
│   ├── previews/*.svg         # 「前两页预览」演示图（docs/make-assets.py 生成）
│   └── samples/*.pdf          # 明确标注的示例 PDF（演示下载用）
├── src/
│   ├── config.js              # 运行时配置（部署后可直接改，无需重新打包）
│   ├── main.js                # 装配：store、路由、渲染、全局交互、弹层、提示
│   ├── router.js              # hash 路由 + 干净路径兼容
│   ├── lib/                   # format / markdown / icons / dom
│   ├── data/seed.js           # 演示数据（课程、圈、帖子、资料、评论、消息…）
│   ├── data/demo-v3.js        # Art V3 演示内容与页页表情补丁
│   ├── data/stickers.js       # 页页表情白名单与渲染
│   ├── state/store.js         # 本地数据仓库（写入 → 持久化 → 通知重绘）
│   ├── state/actions.js       # 业务动作与校验（发布、入圈、评论、页签、审核…）
│   ├── state/selectors.js     # 只读查询（资料检索、信息流、权限、余额…）
│   ├── components/            # 外壳导航 + 卡片/评论/空态等复用片段
│   └── pages/                 # 找资料 / 课友圈 / 帖子 / 账号 / 后台
├── scripts/
│   ├── serve.mjs              # 零依赖静态服务器（仅本地验收用）
│   ├── check.mjs              # 静态自检：导入、路由、本地资源
│   ├── qa.mjs                 # 浏览器渲染验收（截图 + 控制台异常）
│   ├── qa-flow.mjs            # 浏览器交互验收（点一遍核心流程）
│   ├── qa-gallery.mjs         # 生成「电脑端 + 手机端」网页总览
│   └── qa-pilot.mjs           # 试用后端验收（注册→发帖→刷新→退出）
├── server/                    # 内部试用后端（零依赖，单进程 + JSON 文件）
│   ├── index.mjs              # 启动入口（端口、白名单、管理员）
│   ├── pilot.mjs              # 服务实现（静态文件 + API + 会话）
│   ├── allowlist.txt          # 注册白名单（改完重启生效）
│   ├── 启动试用.cmd 清空数据.cmd
│   └── data/                  # 运行时生成的数据（不要提交）
├── tests/                     # 业务、渲染、启动、试用后端测试
└── docs/
    ├── make-assets.py         # 生成示例 PDF 与预览图
    ├── screenshots/           # 精选验收截图（1440 / 390）
    └── gallery/               # 网页总览：67 张电脑端/手机端整页截图 + index.html
```

## 路由

| 路由 | 页面 |
| --- | --- |
| `#/` | 找资料首页（搜索、课程快筛、近期更新、资料说明） |
| `#/resources` | 完整检索页（关键词、学校、课程、学期、类型、标签、排序） |
| `#/resources/:id` | 资料详情（适用范围、未覆盖、真实文件、前两页预览、讨论、来源圈） |
| `#/publish/resource` | 独立资料发布（不要求入圈） |
| `#/circles` | 我的课友圈聚合流（我的圈 / 关注 / 发现） |
| `#/circles/:id` | 圈页（讨论 / 本周 / 资料，置顶索引，加入退出静音往期） |
| `#/find-circles` | 找课加入 + 建圈申请 |
| `#/invite/:code` | 邀请落地页（不自动加入，登录后确认） |
| `#/posts/:id` | 帖子详情（全文、附件、评论回复、采纳、举报、赠签） |
| `#/publish` | 发帖（不挂圈 / 圈内，可选同时收录资料） |
| `#/courses/:id` | 课程页（当期圈、往期圈、作者收录、课程资料） |
| `#/search` | 全站搜索（帖子 / 课程 / 用户，含附件筛选） |
| `#/u/:id` | 个人主页（等级、帖子、关注） |
| `#/me/saved` `#/me/messages` `#/me/wallet` `#/me/settings` | 收藏 / 消息 / 页签 / 设置 |
| `#/login` | 邮箱验证码登录（演示固定码） |
| `#/admin` | 管理后台（仅管理员） |

路由用 hash 承载，静态托管无需任何服务端重写即可直达深层页面；如果托管平台配置了「未知路径回退 index.html」，`/resources/r_xxx` 这样的干净链接也能打开（首次进入后统一成 hash 形式）。详见 DEPLOY_HANDOFF 第 6 节。

## 业务规则落在哪

| 规则 | 实现位置 |
| --- | --- |
| 资料进入索引的条件（公开帖 + 作者确认 + 至少 1 个 ready 附件 + 必填元信息） | `state/selectors.js → resourceEligibility` |
| 检索（相关性 / 最近更新 / 最多收藏，中文子串 + 显式权重） | `state/selectors.js → searchResources` |
| 一帖一资料、取消索引不删原帖、移除原帖则资料下架 | `state/actions.js → createPost / setResourceIndex / removePost` |
| 入圈幂等、归档拒收、被移出需解除、圈内课程派生 | `state/actions.js → joinCircle / createPost` |
| 评论权限（普通圈帖需成员、公开资料帖允许非成员纠错、禁言与归档生效） | `state/actions.js → addComment` |
| 页签领取（每日 1 枚、上限 30、满额不写记录） | `state/actions.js → claimDaily` |
| 页签赠送（自赠禁止、每帖 2、每作者每天 2、每天 5、幂等键） | `state/actions.js → sendGift` + `selectors.giftAvailability` |
| 永久移除退款（原路退回、允许超上限、不重复退款） | `state/actions.js → removePost / refundGiftsForPost` |
| 成长值（发帖每日 2 次、采纳 2 次、评论 5 次且 ≥10 字） | `state/actions.js → awardXp` |
| 本周视图（上海周一 00:00 起算正文/附件更新） | `lib/format.js → weekStart` + `selectors.feedPosts` |
| 审核与审计（临时隐藏不退款、永久移除触发退款、理由必填） | `state/actions.js → resolveReport` |

## 测试与验收

```bash
cd app
npm test                      # 30 项：业务规则 15 + 页面渲染 4 + 启动 3 + 试用后端 8
npm run check                 # 静态自检：模块导入、路由实现、本地资源引用
```

浏览器验收（需要本机 Chrome）：

```bash
# 1) 起服务（另开一个终端）
node scripts/serve.mjs

# 2) 起一个带调试端口的无头 Chrome（Windows 示例）
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --headless=new --no-sandbox --remote-debugging-port=9222 ^
  --user-data-dir=%TEMP%\gongye-qa about:blank

# 3) 跑验收
node scripts/qa.mjs            # 30 张截图 + 控制台异常 + 横向溢出检查
node scripts/qa-flow.mjs       # 15 项交互：登录、领签、赠签、入圈、发帖、发布资料、后台
node scripts/qa-gallery.mjs    # 生成 docs/gallery/index.html（电脑端 + 手机端逐页截图）
node scripts/qa-pilot.mjs      # 试用后端验收：白名单注册 → 发帖 → 刷新保持登录 → 退出
```

最近一次结果：`npm test` 30/30、`npm run check` 通过、`qa.mjs` 无异常无溢出、`qa-flow.mjs` 15/15、`qa-pilot.mjs` 8/8。

## 网页总览（给非技术同学看）

- 双击 `打开网页总览.cmd`，或直接打开 `docs/gallery/index.html`。
- 里面按「游客 / 登录会员 / 手机端 / 管理员」分组，每页给出电脑端 1440 与手机端 390 的整页截图，共 39 组、67 张。
- 手机整页截图里固定底部导航会出现在首屏底部，这是整页截图拼接的正常现象。

## 部署

**部署请直接看 [DEPLOY_V9.2.md](DEPLOY_V9.2.md)**（v9.2 发布清单、缓存、验收见 [V9_ACCEPTANCE.md](V9_ACCEPTANCE.md)）。历史版本：[DEPLOY_V6.md](DEPLOY_V6.md)、[DEPLOY_V5.md](DEPLOY_V5.md)、[DEPLOY_V4.md](DEPLOY_V4.md)；首次部署/换平台细节：[DEPLOY_HANDOFF.md](DEPLOY_HANDOFF.md)：Cloudflare Pages / Vercel / Netlify / 自有 Nginx / GitHub Pages 五种方式都有逐步命令，仓库里已经放好对应配置文件。部署不需要构建步骤，发布目录就是 `app/`。

## 真实后端方案

静态托管本身做不到真实业务（不执行服务端代码、不能保管密钥）。完整方案见 [BACKEND_PLAN.md](BACKEND_PLAN.md)：前端继续静态部署，新增 Node + PostgreSQL + 私有对象存储 + Worker 的后端，包含表结构、接口清单、页签事务的 SQL 写法、里程碑与成本估算。

## 已知边界（请如实转达）

- **没有服务端**：登录态、权限、页签余额与退款、文件扫描都是浏览器内的演示实现，任何人打开开发者工具都能改本机数据。它不能当作真实社区上线。
- **文件是占位的**：`assets/samples/*.pdf` 是明确标注的示例 PDF；资料预览是 `docs/make-assets.py` 生成的演示 SVG，不是真实 PDF 渲染结果。
- **数据只在本机**：换设备、清缓存、换浏览器都会重置。
- **真实上线需要**：邮箱验证码服务、PostgreSQL/云数据库、S3 兼容私有对象存储、文件扫描与 PDF 前两页转图、后台任务（退款/通知）、服务端事务与幂等、限流与审计。清单见 DEPLOY_HANDOFF 第 13 节。

## 素材说明

`assets/art/` 来自本次策划与美术交接包（原创矢量，可用于共页项目），包含品牌标志、29 枚线性图标、四板块图标、6 款默认头像、页签两态、五级徽记、文件与空态插图。`assets/previews/` 与 `assets/samples/` 由 `docs/make-assets.py` 生成，内容明确标注为演示。





























