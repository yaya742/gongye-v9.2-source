# 共页 v9.2 源码交接说明

给接手维护的同事：这份包是**9.2.0 源码快照**，包含前端、测试、自检脚本、文档和独立试用后端代码。源码中 `src/config.js` 默认是 `demo-static`，但托管平台可覆盖运行时配置；不能据此断定当前线上状态。检查线上时以实际页面运行提示和 `/api/health` 为准，健康检查只证明后端在响应，不代表已通过安全审查。

- 版本：`9.2.0`
- 打包日期：2026-10-30
- 前端形态：纯静态 SPA（原生 ES Module + 一份 CSS），无打包、无运行时依赖；可单独运行 `demo-static`，也可配置为连接试用后端
- 演示数据：浏览器 `localStorage`，键名 `gongye-demo-v1`，`STORE_VERSION = 10`

---

## 1. 30 秒跑起来

需要 Node.js 18+（只用来自带静态服务器和测试，站点本身不需要 Node）。

```bash
node scripts/serve.mjs
# 打开 http://127.0.0.1:4173/
```

改完代码验证：

```bash
node scripts/check.mjs   # 导入、路由、本地资源引用
npm test                 # 58 项：业务 39 + 渲染 5 + 启动 3 + 试用后端 11
```

浏览器验收（可选，需要本机 Chrome 调试端口，见 `PILOT.md`）：

```bash
node scripts/qa.mjs        # 截图 + 横向溢出 + 控制台异常
node scripts/qa-flow.mjs   # 核心交互
```

---

## 2. 目录里有什么

| 路径 | 作用 | 要不要改 |
| --- | --- | --- |
| `index.html`、`404.html`、`_redirects`、`netlify.toml`、`vercel.json`、`robots.txt` | 站点入口与托管配置 | 换托管平台时才改 |
| `src/main.js` | 路由、全局事件、弹层、动效 | 加页面/交互时改 |
| `src/pages/` | 每个页面一个渲染函数，在 `src/pages/index.js` 注册路由 | 主要改这里 |
| `src/components/` | 资料卡、帖子卡、页签插画、表情选择器等复用组件 | 改卡片/组件样式时 |
| `src/state/store.js` | 本地存储、种子初始化、`STORE_VERSION` | 改数据结构时 |
| `src/state/actions.js` | 所有写操作与业务校验（权限、状态码） | 改规则时 |
| `src/state/selectors.js` | 只读查询、搜索排序、圈/课程读模型 | 改搜索/展示逻辑时 |
| `src/data/seed.js` | 演示数据（账号、课程、圈、帖子、资料） | 改演示内容时 |
| `src/lib/format.js` | 学期、学校、资料类型、格式化 | 加枚举值时 |
| `assets/css/tokens.css`、`assets/css/app.css` | 主题变量、全部样式（9.1/9.2 规则在文件末尾） | 改视觉时 |
| `assets/` | Logo、头像、表情、逐日插画、演示图片 | 换素材时 |
| `scripts/check.mjs` | 静态自检（导入/路由/资源） | 加路由后无需改，自动扫描 |
| `scripts/serve.mjs` | 本地静态服务器 | 一般不动 |
| `tests/` | 业务、渲染、启动、试用后端测试 | 改规则/页面时同步补 |
| `server/` | 内部试用后端（可选，线上不用） | 只有要接真实后端时才看 |
| `*.md` | 产品、部署、验收、变更记录 | 改完更新 `CHANGELOG.md` |

**本包不含**：`server/data/`（同事试用数据）、`server/allowlist.txt`（真实邮箱白名单）、`docs/`（截图与素材生成脚本）、`node_modules/`。需要时向原维护者索取。

---

## 3. 当前版本的关键规则（改之前先看）

1. **课友圈一门课一个**（9.2 起）：圈对象只有 `id / courseId / status / createdBy / inviteCode / createdAt / pinnedPostId`，没有 `term / section / teacher`。建圈、申请、搜索都按 `courseId` 唯一校验，见 `src/state/actions.js` 的 `createCircle`、`submitApplication` 和 `selectors.js` 的 `circleOfCourse`。
2. **资料必须挂课程**（9.1 起）：新发布资料在 `validateResourceInput` 里强制 `courseId`，前端有行内错误；历史缺失课程的资料仍可读，作者可在详情页补选。
3. **搜索以课程优先**：`resolveCourseQuery` 解析课程名/别名，`searchResources` 返回 A/B/C 三组，`courseOnly` 不与主结果混排。
4. **页签与表情**：`DAILY_BOOKMARKS` 102 天，`culturalThemes` 控制 4 个文化日期换 neutral 图；表情 22 个，白名单在 `src/data/stickers.js`。
5. **权限**：普通用户不能建圈；管理员可归档圈、封禁帖子/账号；归档圈只读。

数据结构或规则一改，就要按第 5 节升 `STORE_VERSION`，否则老访客的本地数据不会重建。

---

## 4. 数据都在哪

- `demo-static` 模式从 `src/data/seed.js` 生成演示数据，首次打开写入 `localStorage['gongye-demo-v1']`；这不适用于连接后端时的线上数据。
- 想重置演示数据：浏览器 DevTools → Application → Local Storage 删除该键，或把 `src/state/store.js` 的 `STORE_VERSION` +1。
- `STORE_VERSION = 10` 会对版本 9 的本地演示库按固定 ID、标题和正文标记移除已确认的源码样例；JSON 试用后端沿用旧数据文件时，也会在首次启动执行同一清理并先备份，细节见 `server/MIGRATE_PILOT_DATA.md`。
- 演示账号、密码、邀请码都在 `seed.js` 顶部和 `actions.js` 的 `DEMO_CODE` 里。
- **静态演示没有真实后端**：该模式的账号、登录、发帖、上传都是本地模拟。`server/` 是独立的 Node 试用后端，不参与静态部署；旧版 `PILOT.md` 中的固定码和网络开放步骤仅供本机隔离验收，不可作为公网或真实用户的部署指南。
- 已发布帖子、资料和圈内公开内容任何访问者都可浏览；登录资格不代表内容私密。当前线上状态应另行检查运行配置与 `/api/health`。

---

## 5. 改代码的固定流程

1. 读 `AGENTS.md`（工程约定）和 `IMPLEMENTATION_STATUS.md`（当前状态）。
2. 改源码，同步改/加 `tests/`。
3. 跑 `node scripts/check.mjs` 和 `npm test`，全绿再继续。
4. 在 `CHANGELOG.md` 的 `## [Unreleased]` 下写：改了什么 / 影响文件 / 怎么验证；涉及规则、数据结构、权限、部署的，补「影响」和「回滚方式」。
5. 发版时把 `Unreleased` 改成 `## [x.y.z] - YYYY-MM-DD`，同步 `package.json` 版本号，按 `DEPLOY_V9.2.md` 重新打发布包。
6. 视觉/交互改动补浏览器验收；没条件跑必须在 CHANGELOG 写明「未跑浏览器验证」。

---

## 6. 部署（静态站）

完整清单看 `DEPLOY_V9.2.md`，核心只有三步：

1. `node scripts/check.mjs` 通过；
2. 上传 `index.html`、`404.html`、`_redirects`、`robots.txt`、`.nojekyll`、`netlify.toml`/`vercel.json`、`src/`、`assets/`（**不要**传 `tests/`、`scripts/`、`docs/`、`server/`）；
3. HTML 设 `no-cache`，`assets/` 长缓存（文件名不带指纹，靠路径区分）。

当前线上地址：<https://gongye.app.workbuddy.host/?sharecode=BJKQFJVWTT>（appId 未变）。

---

## 7. 已知限制 / 下一步

- 没有真实后端：认证、数据库、对象存储、附件扫描都未接；`localStorage` 只适合演示与评审。
- 课程只有名称维度，没有教学班、教师、学分；9.2 后这些维度已从圈上移除，不需要再补。
- 浏览器自动化（`qa.mjs` / `qa-flow.mjs`）在本机沙箱未执行，360/390/430 三档视觉请在本机补跑一次。
- 圈数量 = 课程数（6，不含「通用学习」）；新增课程时记得同时建圈，或让管理员在后台建。

---

## 8. 校验与版本

- 源码清单（文件数、大小、SHA-256）见同目录 `SOURCE_MANIFEST.txt`。
- 发布包（可直接上传的静态文件）是 `gongye-v9.2-static.zip`，与本源码包同版本。
- 本说明随源码走；有疑问先看 `CHANGELOG.md` 最近两条和 `DEPLOY_V9.2.md`。
