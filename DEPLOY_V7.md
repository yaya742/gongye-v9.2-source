# WorkBuddy 部署说明 · 共页 v7.3.0

更新时间：2026-10-27
发布目录：`app/`（静态站点，**不需要构建、不需要 npm install**）
本版重点：全站下拉菜单统一、帖子维度「今日页签榜」、亮色配色、纪念版每日页签。

---

## 1. 发布前确认

| 项 | 值 |
| --- | --- |
| 版本 | `7.3.0` |
| 演示数据版本 | `STORE_VERSION = 6`（老访客首次打开会重建一次演示数据，属预期） |
| 业务规则 | 页签领取/赠送、成长经验、下载权限、来源确认均沿用 v4–v6，本版未改 |
| 测试账号 | `admin@gongye.test` / `123456`（仅演示模式；生产需接真实后端） |
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
src/data/quotes.js                  # bookmarkOfDay / 周年规则
src/data/growth.js                  # 等级与经验
src/pages/growth.js                 # 我的成长
src/main.js                         # 全站下拉增强、页签弹层、tab 动画
src/state/selectors.js              # bookmarkBoard（帖子榜）
src/components/ui.js                # 资料卡、页签卡、榜单
assets/css/app.css                  # 亮色 tokens + .fsel 下拉菜单
assets/art/v5-book.webp             # 收藏空状态书本插画
assets/art/v5/bookmark-background.svg
assets/badges/level-3-chip.svg
assets/mascot/yeye-growth.png
```

本地核对：

```powershell
cd app
node scripts/check.mjs      # 导入、路由、本地资源引用
npm test                    # 期望 47/47（29 + 4 + 3 + 11）
node scripts/qa.mjs         # 30 张截图，无控制台异常/横向溢出
node scripts/qa-flow.mjs    # 期望 15/15
```

---

## 3. 缓存策略（重要）

| 路径 | 建议 |
| --- | --- |
| `/`、`/index.html` | `no-cache` |
| `/assets/css/*` | **不缓存**（本版换了色板，必须让老访客拿到新 CSS） |
| `/assets/*`（图片/字体） | 1 小时 |
| `/src/*.js` | `no-cache` 或短缓存（静态站点无构建哈希） |

没有配置缓存时，发布后让访客按一次 **Ctrl + F5**。
若平台支持 `_headers` / `netlify.toml`，用它们声明；平台不回传 `Cache-Control` 时以刷新为准。

---

## 4. 线上验收（25 项）

### 基础
- [ ] 1. 首页 200，控制台无红色报错
- [ ] 2. 找资料、资料详情、课友圈、找课、我的课程、个人主页可到达
- [ ] 3. 手机 390 无横向滚动
- [ ] 4. 1440 / 1280 / 1024 / 768 / 390 布局不塌

### 视觉（v7）
- [ ] 5. 底色 `#FFFAF5`、主卡纯白 `#FFFFFF`、主色 `#BD513C`
- [ ] 6. 主卡 16px 圆角 + 细边框 + 极淡阴影；悬停不上移
- [ ] 7. 资料卡顺序：类型 → 标题 → 课程/学期 → 摘要 → `18 页 · PDF` → 作者
- [ ] 8. 右栏没有重复的「分享资料」「一起学的同学」卡
- [ ] 9. 全站搜索标「搜全站」，页面搜索标「搜本页资料」

### 每日页签（v7）
- [ ] 10. 页签卡显示日期、句子、署名、共页标记、「可赠页签」余额
- [ ] 11. 2026-10-27 显示「创立纪念 / 世界很大，我们共读一页。」
- [ ] 12. 普通日期走泰戈尔句；已领取按钮变「查看今日页签」
- [ ] 13. 领取后弹层显示日期、句子、署名、纪念徽标

### 帖子页签榜（v7.2）
- [ ] 14. 首页右栏「今日页签榜」按**帖子**列出前 5 名与枚数
- [ ] 15. 点击榜单项进入对应帖子；自己的帖子浅桃底高亮
- [ ] 16. 当天没有赠送时显示自然空态

### 下拉菜单（v7.3）
- [ ] 17. 找资料筛选栏 5 个下拉都是白底卡片菜单，选中项有勾选
- [ ] 18. 课友圈找课的学校/课程/学期/教学班同样是卡片菜单
- [ ] 19. 发帖、发资料、后台建圈、搜索页 tab 的下拉一致
- [ ] 20. 选择后筛选自动提交或表单值正确；Esc/点击空白收起

### 旧功能不回退
- [ ] 21. 页签领取、赠送、成长经验与 v4.3 规则一致
- [ ] 22. 列表不显示等级，详情显示 LV 徽记，我的成长可打开
- [ ] 23. 带图/附件/资料发布未勾选「文档来源」被拦截
- [ ] 24. 切换 tab / 筛选有卡片展开动画，不是瞬移
- [ ] 25. 管理员可建圈、封禁帖子/账号，审计记录正常

---

## 5. 管理员与数据

- 管理员邮箱由启动环境变量 `ADMIN_EMAIL` 指定；本机试用脚本默认 `admin@gongye.test`
- 演示模式下数据在浏览器 localStorage，换设备/清缓存会重置
- `server/` 是内部试用后端，**不参与静态部署**；真实密码登录/上传/单会话尚未接入

---

## 6. 回滚

1. 平台回滚到上一版部署（或重新上传上一版 `app/` 包）
2. 本版涉及的文件：`src/main.js`、`src/state/selectors.js`、`src/components/ui.js`、`src/state/seed.js`、`src/state/store.js`、`assets/css/app.css`、`assets/art/v5-book.webp`
3. 回滚后若演示数据异常，清理站点 localStorage 或让访客重置演示数据

---

## 7. 已知限制

1. 下拉菜单支持鼠标/触屏、Tab 与 Esc，但**没有上下方向键**在菜单内移动
2. 今日页签榜由前端按当天赠送记录计算，真实后端上线需补聚合接口
3. 收藏集/卡册未实现，页面不会出现「已收藏到卡册」的假提示
4. PDF 仍是前两页图片预览，不是完整 PDF 渲染器
5. 页签日期取本机时钟；生产应由服务端时间与账号+日期唯一性校验

---

## 8. 一句话发给 WorkBuddy

> 共页 v7.3.0 静态更新：用 `app/` 的 `index.html`、`assets/`、`src/` 整包覆盖部署，不构建、不 npm install，不上传 `server/`、`docs/`。必检 `src/main.js`、`src/state/selectors.js`、`src/components/ui.js`、`src/data/quotes.js`、`assets/css/app.css`、`assets/art/v5-book.webp`。把 `/assets/css/` 设为不缓存，其余 `/assets/` 1 小时。验收 25 项，重点：亮色配色、帖子页签榜、全站下拉菜单、纪念版页签、tab 卡片动画。

---

## 9. 交付记录

```text
站点域名：https://gongye.app.workbuddy.host/?sharecode=BJKQFJVWTT
托管平台：WorkBuddy 静态托管（sandbox c9a70c9767da447eb6788e27038e2440）
发布目录 / 文件数 / 体积：C:\Users\33494\deploy\gongye-v7 / 121 个文件 / 2.43 MB
发布时间 / 发布人：2026-10-27 20:11（GMT+8）/ WorkBuddy
本地检查：check.mjs 通过（是：素材 36 / 模块 28 / 路由 23）  npm test 47 项（是：47/47 全过）
线上验收：25 项全部通过（是；未通过项：无；第 2 项有一处与文档不符，见备注 2）
  1 首页 200、标题正常；8 个页面巡检 exceptions=0、console error=0，无「页面脚本出错」提示条；
  2 找资料 / 资料详情 / 课友圈 / 找课（#/find-circles）/ 个人主页（#/u/:id）均可达；
  3 手机 390 无横向滚动（overflow=0）；4 1440 / 1280 / 1024 / 768 / 390 全部 overflow=0，390 才切底部导航；
  5 --canvas #FFFAF5、body rgb(255,250,245)、主卡 rgb(255,255,255)、--brand #BD513C；
  6 主卡 16px 圆角、1px rgb(240,227,220)、阴影 rgba(73,51,35,.03)；悬停 transform:none（不上移），
    边框加深到 rgb(234,223,214)、阴影升到 rgba(73,51,35,.08) 0 8px 22px；
  7 资料卡顺序：类型 → 标题 → 课程·学期 → 摘要 → 「18 页 · PDF」→ 作者/时间 → 原帖讨论 + 查看预览；
  8 右栏无「一起学的同学」，也无重复的「分享资料」卡；
  9 顶栏占位「搜全站：资料、课程或讨论」，页面搜索「搜本页资料：课程、章节或标题」；
  10 页签卡含 共页 · 每日页签 / 2026.10.27 / 句子 / 署名「共页」/ 可赠页签余额 / 领取按钮；
  11 2026-10-27 命中周年：卡片与弹层均为「创立纪念 · 世界很大，我们共读一页。」；
  12 普通日期走泰戈尔《飞鸟集》「每日一句」；领取后按钮变「查看今日页签」，2027-10-27 标「1周年」；
  13 领取弹层含日期、句子、署名、纪念徽标（今日页签 · 创立纪念 | 2026.10.27 | 世界很大… | 共页）；
  14 右栏「今日页签榜」按帖子列出 3 行（今日仅 3 帖有赠送），每行带「N 枚」，底部「共 N 枚页签在今天被送出 · 按帖子统计」；
  15 点击榜单第 1 行跳到 #/posts/p_calc_notes；登录本人后该行 .is-me 底色 rgb(255,240,230)（浅桃），其他行为透明；
  16 把当天赠送作废后刷新：榜单 0 行，显示「今天还没有帖子收到页签。」；
  17 找资料筛选 5 个下拉（学校/课程/学期/类型/标签）均为白底 rgb(255,255,255)、12px 圆角卡片菜单，
     选中项勾选 opacity=1、未选中 opacity=0；
  18 找课页 4 个下拉（学校/课程/学期/教学班）同样白底卡片菜单；
  19 发帖 6 个、发资料 6 个（22 个选项）、后台建圈 1 个、搜索页 1 个，全部白底卡片菜单；
  20 选「示例大学」后菜单自动收起、地址变为 #/resources?school=示例大学&sort=recent，按钮文案同步；Esc 可收起；
  21 领取页签、钱包（3 枚可送 · 上限 30）、我的成长（LV.3 成册）均正常；赠送/经验规则由 47 项单测覆盖，未改动；
  22 列表 .level-chip = 0；帖子详情 7 处等级徽记（LV.3 成册）；我的成长可打开；
  23 带图帖未勾选「文档来源」提交被拦（16→16、停留 #/publish、出现提示），勾选后 16→17；
  24 切筛选：data-enter="tab"、卡片 animation-name=gy-card-open、0.22s、startViewTransition 调用 0 次；
  25 管理员登录进 #/admin；封禁 p_calc_notes → status=banned，解封 → published；操作记录页写入「解封帖子」审计行
缓存策略：未配置（否）。该平台不回传 Cache-Control，_headers / netlify.toml 不生效；本版换了色板，务必让访客首次 Ctrl+F5
内部文件：server/ docs/ tests/ scripts/ package.json *.md 已排除（是）；/server/allowlist.txt 线上 404
回滚点：平台应用记录中重新发布或下线（本地 v6 包仍在 C:\Users\33494\deploy\gongye-v6）
备注：
  1) 本文第 2 节「必检文件」里的 assets/art/v5/bookmark-background.svg 实际不存在，包内文件名为
     assets/art/v5/bookmark-bg.svg（另有 bookmark-anniversary.svg / bookmark-daily.svg）。
     这三个 SVG 目前没有被 src 或 CSS 引用，check.mjs 的 36 个素材引用全部可解析，不影响运行；文档里的名字需要改。
  2) 第 2 项「我的课程可到达」与现版本不符：路由表里没有 /me/courses，个人主页明确写「页面不展示修课清单」。
     找课入口是 #/find-circles，课程详情是 #/courses/:id。按现状记录，未擅自新增页面。
  3) 首次进入会因 STORE_VERSION=6 重建演示数据；在冷启动（刚部署完）时首屏可能 3–6 秒停在「正在载入界面」，
     之后正常。演示数据只在浏览器 localStorage（键仍为 gongye-demo-v1），首次无写入前该键为空，属预期。
  4) 第 7 节的已知限制（下拉无上下方向键、榜单前端聚合、页签日期取本机时钟）本版未变。
```

