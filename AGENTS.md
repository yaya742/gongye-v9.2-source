# 共页工程约定（app/ 目录）

本文件是给后续接手的人（或 AI）的工作规则。优先级：用户当轮指令 > 本文件 > 其他文档。

## 1. 每次改动都要写更新日志（强制）

- 所有改动（代码、样式、数据、文档、部署配置）必须追加到 `CHANGELOG.md`。
- 写入位置：`## [Unreleased]` 下；发版时改成 `## [x.y.z] - YYYY-MM-DD`。
- 每条至少写清：**改了什么 / 影响文件 / 怎么验证**。
- 涉及业务规则、接口、数据结构、权限、部署方式的，必须写 **影响** 与 **回滚方式**。
- 禁止只写“优化体验”“修复若干问题”这类无法验证的描述。
- 只改文档归 `Docs`，只改测试归 `Tests`；改动的实测结果归 `Verified`。

## 2. 改完必须自己验一遍

```bash
node scripts/check.mjs        # 导入、路由、本地资源引用
npm test                      # 37 项（业务 19 + 渲染 4 + 启动 3 + 试用后端 11）
```

涉及交互或视觉的改动，另外执行：

```bash
node scripts/serve.mjs        # 起本地静态服务
node scripts/qa.mjs           # 30 张截图 + 控制台异常 + 横向溢出
node scripts/qa-flow.mjs      # 15 项核心交互
```

浏览器验收需要 Chrome 调试端口（见 `PILOT.md` / `DEPLOY_HANDOFF.md`）。没有条件跑浏览器时，必须在 CHANGELOG 里写明“未跑浏览器验证”。

## 3. 不要动的东西

- 业务规则以 `gongye-v2/01-产品与美术企划书.md`（v2.2）为准；视觉以 `gongye-v2/gongye-visual-update/`（V2.3 暖色）和 `gongye-v2/gongye-art-v3/`（Art V3：Logo/头像/页页表情，以 04 文档为准）为准。
- 不要为了视觉改动去改权限、公开范围、下载条件、页签规则、数据结构。
- 不要提交 `server/data/`（同事账号）与填了真实邮箱的 `server/allowlist.txt`。
- 不要改 `src/config.js` 的 `mode`（除非明确要切真实后端）。
- 静态部署不需要 `npm install`、不需要构建；`package.json` 里没有运行时依赖。

## 4. 目录职责

| 目录 | 职责 |
| --- | --- |
| `assets/css/tokens.css` | 主题变量（颜色/圆角/阴影/动效）。改视觉先改这里 |
| `assets/css/app.css` | 组件与页面样式；V2.3 段落集中放主题覆盖与动效 |
| `assets/art/` | 品牌、图标、空态与默认占位头像；重着色时保持文件名不变 |
| `assets/brand/` `assets/avatars/` `assets/stickers/` `assets/mascot/` | 用户 Logo、V3 头像、页页表情、共共/页页插画（Art V3） |
| `src/data/stickers.js` `src/data/demo-v3.js` | 表情白名单与 V3 演示内容补丁 |
| `src/state/` | `store`（本地/远程）、`actions`（业务校验）、`selectors`（只读查询） |
| `src/pages/` | 页面渲染函数；在 `src/pages/index.js` 注册 |
| `src/main.js` | 路由渲染、全局交互、弹层、动效（View Transitions） |
| `src/api/client.js` | 试用后端客户端（`production` 模式才使用） |
| `server/` | 内部试用后端；**不参与静态部署** |
| `docs/` | 截图与素材生成脚本；**不参与静态部署** |

## 5. 文档对应关系

- 重新部署（视觉 V2.3）：`REDEPLOY_V2.3.md`
- 首次部署 / 换平台：`DEPLOY_HANDOFF.md`
- 内部试用后端：`PILOT.md`
- 视觉改造与验收：`VISUAL_V2.3.md`（暖色动效）、`VISUAL_V3.md`（Logo/头像/页页表情）
- 真实后端方案：`BACKEND_PLAN.md`
- 实现状态：`IMPLEMENTATION_STATUS.md`
- 改动历史：`CHANGELOG.md`



