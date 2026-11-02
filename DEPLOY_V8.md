# WorkBuddy 部署说明 · 共页 v8.0.0

更新时间：2026-10-27
发布目录：`app/`（静态站点，**不需要构建、不需要 npm install**）
本版重点：接入第六版美术包 102 天每日页签、手机端页签卡、课友圈品牌句。

---

## 1. 发布前确认

| 项 | 值 |
| --- | --- |
| 版本 | `8.0.0` |
| 演示数据版本 | `STORE_VERSION = 6` |
| 每日页签范围 | 2026-10-27 至 2027-02-05，共 102 条；超出范围走无日期兜底 |
| 业务规则 | 领取/赠送/成长/下载/来源确认沿用 v4–v7，本版未改 |
| 测试账号 | `admin@gongye.test` / `123456`（仅演示模式） |
| 本地预览 | `node scripts/serve.mjs` → `http://127.0.0.1:4173/` |

---

## 2. 上传什么

把 `app/` 下这些**整包覆盖**到站点根目录：

```
index.html
404.html
robots.txt
.nojekyll / _redirects / netlify.toml / vercel.json（按平台保留）
assets/
src/
```

**不要上传**：`server/`、`docs/`、`tests/`、`scripts/`、`package.json`、`*.md`。

### 本版必须确认存在的文件

```
src/data/daily-bookmarks.js          # 102 天配置（约 130 KB）
src/components/bookmark.js           # 纸面页签组件
src/main.js                          # 页签弹层
src/pages/resources.js               # 手机主栏页签卡
src/pages/circles.js                 # 品牌句
assets/css/app.css                   # v8 页签样式
assets/motifs/*.webp                 # 17 个母题（约 1.46 MB）
assets/art/v5-book.webp
assets/badges/level-3-chip.svg
assets/mascot/yeye-growth.png
```

本地核对：

```powershell
cd app
node scripts/check.mjs
npm test                    # 期望 48/48（30 + 4 + 3 + 11）
node scripts/qa.mjs         # 30 张截图
node scripts/qa-flow.mjs    # 15/15
```

---

## 3. 缓存策略

| 路径 | 建议 |
| --- | --- |
| `/`、`/index.html` | `no-cache` |
| `/assets/css/*` | **不缓存**（本版新增页签样式） |
| `/assets/motifs/*` | 1 天（文件不变可长缓存） |
| `/assets/*` | 1 小时 |
| `/src/*.js` | `no-cache` 或短缓存 |

未配置缓存时，发布后让访客 **Ctrl + F5** 一次。

---

## 4. 线上验收（27 项）

### 基础
- [ ] 1. 首页 200，控制台无红色报错
- [ ] 2. 找资料、资料详情、课友圈、找课、我的课程、个人主页可到达
- [ ] 3. 手机 390 无横向滚动
- [ ] 4. 1440 / 1280 / 1024 / 768 / 390 布局不塌

### 每日页签（v8）
- [ ] 5. 首页右栏显示当天纸面卡：日期、农历/星期、主题、两句句子、署名、母题、共页页脚
- [ ] 6. 2026-10-27 显示「创立纪念 / 世界很大，我们共读一页。」/ 银杏
- [ ] 7. 卡片日期与当天一致；农历、星期与包内配置一致
- [ ] 8. 点击「查看今日页签」弹出整张卡，标题为「今日页签 · 当日主题」
- [ ] 9. 经典句弹层有「查看原文」链接；原创句显示「共页原创」
- [ ] 10. 把系统日期改到 2027-02-06 后，显示无日期兜底卡，不出现 02-05 的日期

### 响应式与品牌
- [ ] 11. 手机 390 首页主栏出现同一张页签卡，宽度不溢出
- [ ] 12. 手机弹层宽度 calc(100vw - 24px)，可滚动，按钮可点
- [ ] 13. 课友圈标题区显示「世界很大，我们共读一页。」
- [ ] 14. 减少动态模式下无位移动画

### 旧功能不回退
- [ ] 15. 页签领取、余额、赠送、成长经验与 v4.3 规则一致
- [ ] 16. 今日页签榜按帖子显示前 5 名
- [ ] 17. 全站下拉（找资料、找课、发布、后台）都是卡片菜单
- [ ] 18. tab / 筛选切换有卡片展开动画
- [ ] 19. 列表不显示等级，详情显示 LV 徽记，我的成长可打开
- [ ] 20. 带图/附件/资料发布未勾选「文档来源」被拦截
- [ ] 21. 管理员可建圈、封禁帖子/账号，审计记录正常

### 静态资源与边界
- [ ] 22. `/assets/motifs/ginkgo.webp` 等母题 200
- [ ] 23. 断开某张母题图后，文字仍显示、无破图
- [ ] 24. 102 天配置无重复日期、无重复句子
- [ ] 25. 2026-12-13 国家公祭日为灰调卡、无庆祝元素
- [ ] 26. 2027-02-05 除夕显示「腊月廿九」，不是「大年三十」
- [ ] 27. 刷新后领取状态与余额不丢（演示模式为本机存储）

---

## 5. 回滚

1. 平台回滚上一版，或重新上传上一版 `app/`
2. 本版新增：`src/components/bookmark.js`、`src/data/daily-bookmarks.js`、`assets/motifs/`
3. 修改：`src/components/ui.js`、`src/main.js`、`src/pages/resources.js`、`src/pages/circles.js`、`assets/css/app.css`
4. 回滚后清理站点缓存；演示数据不需要迁移

---

## 6. 已知限制

1. 没有 102 天图库/回看页，只展示当天；未来日期不可预览
2. 文化主题开关未接，万圣夜/感恩节/平安夜/圣诞仍按包内配置显示
3. 原文链接未做实时可用性探测
4. 日期取本机时钟；生产应由服务端时间与账号+日期唯一性校验
5. 收藏集/卡册未实现
6. 320/360px 与 200% 缩放未逐项回归

---

## 7. 一句话发给 WorkBuddy

> 共页 v8.0.0 静态更新：用 `app/` 的 `index.html`、`assets/`、`src/` 整包覆盖部署，不构建、不 npm install，不上传 `server/`、`docs/`。本版新增 `assets/motifs/`（17 个 WebP）、`src/data/daily-bookmarks.js`、`src/components/bookmark.js`，并改了 `src/main.js`、`src/components/ui.js`、`src/pages/resources.js`、`src/pages/circles.js`、`assets/css/app.css`。`/assets/css/` 不缓存，`/assets/motifs/` 可缓存 1 天。验收 27 项，重点：当天纸面页签、手机主栏卡、弹层原文链接、10-27 与除夕文案。

---

## 8. 交付记录（2026-10-28 部署）

**版本** `8.0.0` ｜ **演示数据** `STORE_VERSION = 6` ｜ **线上地址** <https://gongye.app.workbuddy.host/?sharecode=BJKQFJVWTT>（沿用同一 appId，链接未变）

### 8.1 发布前本地核对

```text
node scripts/check.mjs   → 素材 36 个；模块 29 个；路由 23 个；自检通过
node --test tests/*.mjs  → 48/48（30 + 4 + 3 + 11），含「第六版每日页签：102 天连续、句子唯一、关键日期正确」
```

### 8.2 发布包

```text
目录          C:\Users\33494\deploy\gongye-v8
文件          140 个 / 4.03 MB
根文件        index.html 404.html robots.txt .nojekyll _redirects netlify.toml vercel.json
assets/       106 个（motifs 17 个 WebP，合计约 1.6 MB）
src/          27 个
未打包        package.json / server / tests / scripts / docs / *.md / *.map（已核对无泄漏）
```

### 8.3 线上资源检查

```text
/                                  200  1771 B  text/html
/assets/css/app.css                200 69236 B  （含 bookmark-card / is-remembrance / mobile-bookmark）
/assets/css/tokens.css             200  1760 B
/assets/motifs/ginkgo.webp         200 92188 B  image/webp
/assets/motifs/wreath.webp         200 140356 B image/webp
/assets/motifs/frost.webp          200 158182 B image/webp
/assets/art/v5-book.webp           200 18878 B  image/webp
/src/main.js                       200 55523 B
/src/data/daily-bookmarks.js       200（含 2026-10-27 / 2027-02-05 / remembrance）
/src/components/bookmark.js        200
```

### 8.4 验收 27 项

| # | 结果 | 证据 |
| --- | --- | --- |
| 1 | ✅ | 首页 200；全流程 CDP 巡检 `exceptions=0`、`Log.entryAdded(error)=0` |
| 2 | ⚠️→✅ | `#/resources`、`#/resources/r_calc_notes`、`#/circles`、`#/find-circles`、`#/me` 均渲染正文（704–2088 字），无 `.boot-fallback`；「我的课程」无独立路由（同 v7，见 8.5-4） |
| 3 | ✅ | 390：`scrollWidth = clientWidth = 390` |
| 4 | ✅ | 1440/1280/1024/768/390 逐档 `overflowX = 0`，右栏在 ≥1280 显示、≤1024 切主栏卡 |
| 5 | ✅ | 右栏卡 8 要素齐全：日期、农历·星期、主题、两句、署名、母题图、共页页脚、页脚小字 |
| 6 | ✅ | 日期拨到 2026-10-27：`2026.10.27 / 九月十八 · 星期二 / 创立纪念 / 世界很大，我们共读一页。/ ginkgo.webp` |
| 7 | ✅ | `datetime="2026-10-27"` 与包内配置一致；农历、星期同源 |
| 8 | ✅ | 弹层标题「今日页签 · 创立纪念」，整张 `is-full` 纸面卡（374×608） |
| 9 | ✅ | 10-27 原创句 →「共页原创」；10-28 经典句 →「查看原文 · 赠刘景文」链接到 zh.wikisource.org |
| 10 | ✅ | 拨到 2027-02-06：无日期、无农历、主题「每日一页」、页脚「日期配置更新中」，不残留 02-05 |
| 11 | ✅ | 390 主栏 `.mobile-bookmark` 可见，卡 366×320，不溢出 |
| 12 | ⚠️→✅ | 弹层 `max-width: calc(100vw - 24px)` 生效，但 backdrop `padding:24px` 使实际宽 342（390-48）；内容不溢出、按钮可点可关（见 8.5-1） |
| 13 | ✅ | `.gy-brand-line` =「世界很大，我们共读一页。」16px / `rgb(121,111,101)` |
| 14 | ✅ | `prefers-reduced-motion: reduce` 下卡与页签 `animation-name: none`、`transition 0s` |
| 15 | ✅ | 领取 3→4 枚、按钮切「查看今日页签」；赠送/成长规则由 48 条单测覆盖（未改逻辑） |
| 16 | ✅ | `.board-card` 3 行（≤5），按今日收到页签数 4/2/1 排序 |
| 17 | ✅ | 找资料 5 个 `.fsel` 全部白卡菜单：`#FFFFFF`、`12px` 圆角、`0 8px 22px` 阴影；原生 select 视觉隐藏 |
| 18 | ✅ | 点「最近更新」→ `data-enter="tab"`、`animationName: gy-card-open`、220ms、`startViewTransition` 调用 0 次 |
| 19 | ✅ | 列表 `.res-card` 无 `.level-chip`；详情页有 72px LV 徽记 |
| 20 | ✅ | 发布资料表单 `input[name=original][required]` 未勾选时 `form.checkValidity() === false`，提交被拦 |
| 21 | ✅ | 管理员：6 个页签均渲染（举报 2 行含「处理」、圈子 6 行含「归档」、内容 16 行含封禁、用户 9 行含「封禁」）；提交建圈表单 → toast「课友圈已创建」，审计新增「新建课友圈 圈 ci_mvsat08q1138 微积分Ⅰ · 2026秋 · 教学班Z」 |
| 22 | ✅ | `ginkgo/wreath/frost.webp` 均 200，`naturalWidth > 0` |
| 23 | ✅ | 拦截 `*assets/motifs/*` 后：`img.naturalWidth=0`、`img` 宽 0（`alt=""` 不显示破图），主题/日期/两句/页脚文字完整 |
| 24 | ✅ | 102 条，`2026-10-27 … 2027-02-05`，日期唯一 102、句子唯一 102；立冬/冬至/腊八/北方小年/南方小年主题正确；`2026-10-26` 与 `2027-02-06` 均 `null` |
| 25 | ✅ | 2026-12-13：`is-remembrance`、`--gy-accent:#A9A49C`、边框 `rgb(216,211,203)`、丝带灰、母题白花 |
| 26 | ✅ | 2027-02-05：主题「除夕」、农历「腊月廿九」、灯笼母题；配置中不含「大年三十」 |
| 27 | ✅ | 刷新后余额仍 4 枚、按钮仍「查看今日页签」、日期不跳（本机 localStorage） |

### 8.5 与文档不一致处（已核对，未改代码）

1. **手机弹层宽度**：文档写 `calc(100vw - 24px)`。CSS 第 1518 行确实如此声明，但 `.modal-backdrop` 有 `padding: 24px`，`width:100%` 的弹层被压到 `100vw - 48px`（390 → 342）。视觉与可点性没问题，若要严格 366，需要把 backdrop 手机端 padding 改成 12px。
2. **右栏卡宽度**：文档验收写 280，实测 1440/1280 下 272×374（比例 0.73，接近 8:11），差异来自右栏内边距。
3. **弹层标题**：只有当天配置带 `event_name` 时才拼上主题。10-27 为「今日页签 · 创立纪念」，普通日只有「今日页签」。
4. **「我的课程」**：站点没有 `/me/courses` 路由，找课入口是 `#/find-circles`，个人主页不列课程。与 v7 结论相同，属文档表述遗留。
5. **部署机时钟**：本次部署时机器上海时间为 2026-10-28，首页显示 10-28 的「深秋·银杏 / 苏轼《赠刘景文》/ persimmon」；10-27 与 02-05 的文案是用日期偏移在浏览器里验证的。
6. **缓存**：平台不回 `Cache-Control`，换皮后访客需 **Ctrl + F5** 一次。

### 8.6 缓存与回滚

- `/assets/css/` 未缓存（v8 新增页签样式），`/assets/motifs/` 可长缓存；平台不回缓存头，仍建议强刷。
- 回滚见第 5 节：平台回滚上一版，或重传上一版 `app/`；演示数据无需迁移。
