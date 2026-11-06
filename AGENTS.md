# 共页工程约定（v10 生产版）

本文件是给后续接手的人（或 AI）的工作规则。优先级：用户当轮指令 > 本文件 > 其他文档。

项目根目录即站点根：`index.html`、`src/`、`assets/` 直接可部署，**没有 `app/` 子目录**。

## 1. 每次改动都要写更新日志（强制）

- 所有改动（代码、样式、数据、文档、部署配置）必须追加到 `CHANGELOG.md`。
- 写入位置：`## [Unreleased]` 下；发版时改成 `## [x.y.z] - YYYY-MM-DD`。
- 每条至少写清：**改了什么 / 影响文件 / 怎么验证**。
- 涉及业务规则、接口、数据结构、权限、部署方式的，必须额外写 **影响** 与 **回滚方式**。
- 禁止只写“优化体验”“修复若干问题”这类无法验证的描述。
- 只改文档归 `Docs`，只改测试归 `Tests`；实测结果归 `Verified`。

## 2. 改完必须自己验一遍

```bash
node scripts/check.mjs                 # 导入、路由、本地资源引用
node --test tests/*.test.mjs           # 全量：137 项（132 通过 / 0 失败 / 5 条件跳过）
```

- 新增或修改规则、页面、接口时同步补/改 `tests/`，不要只改代码。
- 涉及交互或视觉的改动，另外执行（需 Chrome 调试端口，见 `DEPLOY_PRODUCTION.md`）：

```bash
node scripts/serve.mjs      # 本地静态服务
node scripts/qa.mjs         # 截图 + 控制台异常 + 横向溢出
node scripts/qa-flow.mjs    # 核心交互
```

没有条件跑浏览器时，必须在 CHANGELOG 里写明“未跑浏览器验证”。

## 3. 两套服务端，别混

| 入口 | 用途 | 说明 |
| --- | --- | --- |
| `server/index.mjs` | 生产 | `createProductionServer`，SQLite + 邮箱 OTP + 服务端权限；`npm start` |
| `server/production.mjs` | 生产服务实现 | 业务动作直接 `import` 前端 `src/state/actions.js`，服务端再校验一次 |
| `server/pilot-entry.mjs` | 内部试用 | `createPilotServer`（JSON 文件），`npm run pilot` |
| `server/pilot.mjs` | 试用服务实现 | 含试用期上传、备份、gzip、限流；**不是**生产入口 |
| `server/files.mjs` | 生产文件服务 | PDF + 图片，私有存储、扫描、按 ID 鉴权 |
| `server/files-pilot.mjs` | 试用文件服务 | PDF/图片，限额与清理 |

## 4. 不要动的东西

- 不要提交 `server/data/`（SQLite 与上传文件）、`server/allowlist.txt`、`server/pilot.config.json`（真实邮箱/管理员/云配置）。
- 不要改 `src/config.js` 的 `mode`；生产由服务端注入 `production` 配置。
- 不要为了视觉改动去改权限、公开范围、下载条件、页签规则或数据结构。
- 生产上传必须 fail closed：扫描或预览服务不可用时应拒绝，不得伪装成功。
- 图片随帖子公开；PDF 下载必须登录并每次重新鉴权，不接受客户端提交的任意路径。

## 5. 目录职责（节选）

| 路径 | 职责 |
| --- | --- |
| `src/main.js` | 路由渲染、全局事件、上传与发布、弹层、动效 |
| `src/pages/` | 页面渲染函数，在 `src/pages/index.js` 注册 |
| `src/state/actions.js` | 全部写操作与业务校验（前后端共用） |
| `src/state/selectors.js` | 只读查询、搜索排序、圈/课程读模型 |
| `src/state/store.js` | 本地演示 store 与远程 store（生产） |
| `src/data/zju-courses-2026aw.js` | 浙大 2375 门课程（生成文件，勿手改） |
| `assets/css/tokens.css` | 主题变量；改视觉先改这里 |
| `assets/css/app.css` | 组件与页面样式 |
| `server/` | 生产与试用两套后端；不参与纯静态部署 |
| `migration/` | 旧资料迁入预检清单（只读） |

## 6. 文档对应关系

- 生产部署、备份、上线验收：`DEPLOY_PRODUCTION.md`
- 内部试用后端：`PILOT.md`
- 真实后端方案与安全边界：`BACKEND_PLAN.md`
- 实现状态与已知限制：`IMPLEMENTATION_STATUS.md`、`DELIVERY_STATUS.md`
- 改动历史：`CHANGELOG.md`
