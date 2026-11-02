# Art V3 落地记录（Logo · 生活化头像 · 页页表情 · 角色克制）

日期：2026-10-26 · 版本：2.4.0
输入：`gongye-art-v3/`（01 企划、02 指导、03 头像说明、04 页页（最新，优先）、tokens、registry、demo JSON、art/）

业务、数据模型、接口、权限、页签与路由语义未改；仅新增「页页表情」这一项小功能（固定白名单、可保存回显），其余是视觉与演示内容。

---

## 1. 做了什么

| 项 | 结果 |
| --- | --- |
| 品牌 Logo | 使用用户提供的书页 Logo（`assets/brand/logo.png`，由原稿透明化并缩到 96px 高，显示 30px / 手机 26px） |
| 演示账号 | 8 个生活化账号：猫、山景、咖啡照片 + 涂鸦、月亮、像素苗、橘子、海浪 SVG；昵称/简介按 03 文档，允许空简介 |
| 演示内容 | 12 条帖子改成具体学习过程与更新说明；评论改为自然短句；18 条评论（含 4 条新增） |
| 页页表情 | 4 张固定表情（收到 / 再想想 / 谢谢 / 补好了）；评论与发帖可选 1 个；选择只进待发送区，发送后保存并回显；服务端白名单校验，非法 ID 拒绝；仅表情评论允许；加载失败显示文本 fallback |
| 共共/页页 | 按 04 克制使用：只在“空收藏”放一处 128px 双人插画；没有常驻助手、没有跟随鼠标、没有逐卡表情 |
| 头像路径 | 支持子目录（`assets/avatars/*`），统一 `object-fit: cover`，避免照片被拉伸 |
| 视觉 | 沿用 V2.3 暖色圆润卡片与全部动效，未回退绿色或深色 |

## 2. 改动文件

| 文件 | 改动 |
| --- | --- |
| `assets/brand/logo.png` `logo-original.png` | 新增（原稿保留，透明版用于页面） |
| `assets/avatars/*` | 新增 3 张照片、5 张 SVG 与 `photo-sources.json` |
| `assets/stickers/*.png` | 新增 4 张页页表情（缩到 224px，约 44–51KB） |
| `assets/mascot/duo.png` | 新增透明双人插画（440px） |
| `src/data/stickers.js` | 新增：表情白名单、`stickerMarkup()`、`isValidSticker()` |
| `src/data/demo-v3.js` | 新增：8 账号、帖子/评论/资料标题、页页表情与 4 条新评论、账号加入圈子 |
| `src/data/seed.js` | 结尾套用 `applyArtV3`，保持原数据结构 |
| `src/state/actions.js` | 评论/发帖支持 `stickerId`；白名单校验；仅表情评论允许；新用户默认中性头像 |
| `src/components/ui.js` | 帖子/评论渲染表情；评论表单加选择器；表情加载失败 fallback；空态支持插画 |
| `src/pages/posts.js` | 详情渲染表情；发布器加表情选择器 |
| `src/pages/account.js` | 空收藏显示插画；设置页头像候选换成 8 张 |
| `src/lib/icons.js` | 头像支持 `avatars/` 路径 |
| `src/components/layout.js` | 顶栏换用户 Logo |
| `assets/css/app.css` | 表情、选择器、插画、Logo 尺寸样式；头像 `object-fit` |
| `index.html` | （上一轮已改）主题色与浅色声明 |
| `tests/logic.test.mjs` | 新增 2 项：表情白名单/仅表情评论；8 账号与演示表情 |
| `scripts/qa.mjs` | 更新验收文案（新昵称、详情标题） |

## 3. 数据映射与偏差（如实）

- **12 帖 / 18 评论**：12 条主帖按 03/04 的语境改写；18 条评论（原 14 + 新 4，其中 1 条只有页页表情）。
- **额外保留的演示记录**：为保留此前的界面状态与回归用例，仍保留 5 条非主帖演示记录（处理中、扫描失败、未收录草稿、归档旧帖、物理电路讨论）和 1 条新用户帖子。它们均标记为演示，不计入“12 条生活化主帖”。
- **资料文件**：v3 fixture 的 6 份资料是 `file_bound=false`（未绑定）。本工程此前为验证下载/预览/权限准备了一份**明确标注的示例 PDF**，本轮保留绑定，以免破坏已有回归；界面、权限与文案仍明确标注“演示内容”。
  - 若要完全按 fixture 走：给 `resource` 加 `fileBound: false` 并移除 `attachments`，资料会显示“尚未绑定测试文件”、下载按钮禁用（状态分支已预留）。
- **角色**：只使用 `mascot/duo.png` 一处（空收藏）；未做上传状态插画，因为本工程没有真实上传进度（静态演示 + 试用后端都使用示例 PDF）。未使用共共单独表情。
- **Logo**：使用透明试制版并目视核对；未声称是已校准的矢量稿或完成商标检索。

## 4. 验收（Y01–Y07 与 R 系列实测）

| ID | 结果 | 证据 |
| --- | --- | --- |
| Y01 Logo | 通过 | 顶栏为 `assets/brand/logo.png`，桌面 30px / 手机 26px；截图 |
| Y02 四表情 / fallback | 通过 | 4 张独立 PNG；加载失败由捕获监听替换为「【页页表情：…】」 |
| Y03 面板行为 | 通过 | 浏览器实测：打开面板 → 4 项 → 选择后进入待发送区（未发送）→ 可移除 |
| Y04 保存与回显 | 通过 | 仅表情评论发送成功并渲染；刷新后仍存在；非法 ID 返回 `bad_sticker`；空正文无表情返回 `empty_comment` |
| Y05 权限不绕过 | 通过 | 复用原评论权限校验；`npm test` 权限用例全过 |
| Y06 克制 | 通过 | 常规页面无角色；仅空收藏一处；无假用户 |
| Y07 真实成功态 | 部分 | 发送成功后才渲染表情；失败有真实错误提示。没有真实上传状态，故未接入“补好了”状态页页 |
| R01 宽度 | 通过 | 1440/390 截图；QA 无横向溢出 |
| R02 五入口 | 通过 | 手机底部五入口截图 |
| R05 8 头像稳定 | 通过 | 数据层固定 `avatar`，不随机；测试断言 8 账号均有路径 |
| R06 12 帖映射 | 部分 | 12 条主帖已映射；另有 6 条状态/归档演示记录（见第 3 节） |
| R07 课程隔离 | 通过 | 圈内过滤逻辑未改；`p_prob_help` 已改为微积分内容 |
| R08 文件未绑定 | 部分 | 保留示例 PDF 绑定（见偏差），未绑定分支已实现但未启用 |
| R09 动效 | 通过 | 沿用 V2.3 的 hover/press/共享元素/返回滚动，未回退 |
| R10 长内容/加载失败 | 部分 | 文本、代码、头像失败有处理；未做图片断网矩阵 |
| R11 键盘/reduce | 部分 | 选择器可用键盘；reduce 关闭空间动画；未做完整键盘走查 |
| R12 演示隔离 | 通过 | 演示内容只在 `demo-static` 种子里；试用后端从同一份种子启动并从磁盘持久化 |

自动化结果：

```text
node scripts/check.mjs  → 自检通过
npm test                → 35/35（业务 17 + 渲染 4 + 启动 3 + 试用后端 11）
node scripts/qa.mjs     → 30 张截图，无控制台异常、无横向溢出
node scripts/qa-flow.mjs→ 15/15
```

浏览器实测（Chrome 156，1440×900）：

```text
表情面板可打开 → 4 个表情 → 选择后待发送（不自动发送）
仅表情评论发送成功 → 回显 yeye-thanks.png
刷新后表情仍在
空收藏显示 mascot/duo.png
```

## 5. 已知限制

1. 页页面板是**内联面板**（展开在按钮下方），不是桌面锚定浮层 / 手机底部抽屉；键盘可用，未做边缘避让。
2. 没有共共单独表情、没有角色养成、没有自动回复（符合 04 的限制）。
3. 未接入上传状态页页（没有真实上传流程）；“补好了”只在用户主动选择时使用。
4. 没有真机测试与录屏；Safari/Firefox 未验证。
5. 6 份资料仍绑示例 PDF，与 v3 fixture 的 `file_bound=false` 不同（见第 3 节）。

## 6. 部署提示

- 新增目录：`assets/brand/`、`assets/avatars/`、`assets/stickers/`、`assets/mascot/`；新增文件：`src/data/stickers.js`、`src/data/demo-v3.js`。
- 仍需**整目录覆盖** `src/` 与 `assets/`；缓存策略同 V2.3（`/assets/css` 不缓存，`/assets/art` 1 小时；新增的 `assets/avatars`、`stickers`、`brand`、`mascot` 建议同样 1 小时）。
- 部署验收增加两项：顶栏是新 Logo；评论里能看到页页表情（含刷新后）。

---

## 7. 素材清单与去向（v3 包逐项）

| 素材 | 去向 | 说明 |
| --- | --- | --- |
| `brand/logo-transparent-candidate.png` | 页面顶栏 | 缩到 96px 高（显示 30/26px），用于 `assets/brand/logo.png` |
| `brand/logo-user-original.png` | 保留为源文件 | 只作为原稿留存，不在页面直接加载（1.5MB，且带背景） |
| `avatars/cat.jpg` `mountains.jpg` `coffee.jpg` | 演示账号头像 | 橘子还没熟 / 阿椰 / 小半杯 |
| `avatars/doodle.svg` `moon.svg` `sprout.svg` `orange.svg` `wave.svg` | 演示账号头像 | 括号没闭合 / 晚点再睡 / 周三再说 / momo / 小林 |
| `avatars/photo-sources.json` | 随素材保留 | 照片出处记录，不在页面展示 |
| `stickers/*.png`（4 张） | 页页表情 | 评论/发帖选择器、已发送内容回显、空态之外不出现 |
| `stickers/registry.json` | 映射为 `src/data/stickers.js` | 白名单、显示名、fallback 文案 |
| `art/mascot-duo-transparent.png` | 空收藏 + 资料首页右栏小品牌模块 | 缩到 440px 源图，页面 128px / 140px |
| `art/final-desktop.png` `final-mobile.png` | **不直接使用** | 美术方向参考，按组件实现；包内文档明确禁止整屏铺图 |
| `art/mascot-style-reference.png` | **不直接使用** | 角色设定板，不能整张当组件或 Sprite |
| `art/yeye-interaction-board.png` | **不直接使用** | 表情与状态示意，实际按 04 的尺寸与克制度实现 |
| `demo/community-demo.json` | 映射进 `src/data/demo-v3.js` | 8 用户 / 12 帖 / 18 评论 / 6 资料；字段按现有模型转换，不照抄 |
| `design/design-tokens.json` | 映射进 `assets/css/tokens.css` | 颜色、圆角、动效、角色尺寸约束 |
| `00-设计与内容预览.html` | 只作为设计册 | 不是网站实现，未放入站点 |
| `baseline/*` | 文档参考 | 上一轮暖色动效规范，冲突时以本轮 01/02/04 为准 |
| `文件清单.json` | 交付核对用 | 不参与页面 |

**没有“丢素材”**：所有 PNG/JPG/SVG 都能在 `assets/` 下访问到（200）。看不到的几项是参考图或源文件，按包内规则不应直接铺到页面上。
