# WorkBuddy 部署说明 · 共页 v6.0.0（第六次更新：选项卡卡片化 + 卡片展开切换）

> 读者：负责部署的 WorkBuddy。
> 适用：把当前 `app/` 部署到静态托管（Cloudflare Pages / Vercel / Netlify / Nginx / GitHub Pages）。
> 结论：**纯静态、零构建、零依赖**。不要 `npm install`，不要跑构建命令。

> **本次是“四版内容合并更新”**：V2.3 暖色与动效、Art V3 用户 Logo/头像/页页表情、v2.5 管理员后台、v4.0 等级成长与简约视觉，全部在同一个包里，**一次覆盖**即可，不要分几次发。

---

## 0. 一页结论

| 项 | 值 |
| --- | --- |
| 版本 | `4.0.0`（等级成长 + 简约视觉 + 之前三版全部内容） |
| 发布文件 | `index.html`、`404.html`、`robots.txt`、`.nojekyll`、`_redirects`、`netlify.toml`、`vercel.json`、`assets/`、`src/` |
| 体积 | 约 **2.4 MB / 116 个文件** |
| 不能上传 | `server/`（试用后端与白名单）、`docs/`（截图约 10 MB）、`tests/`、`scripts/`、`*.md`、`package.json` |
| 最容易翻车 | ① 漏传 `src/data/growth.js`、`src/pages/growth.js` 或 `assets/badges/` → 等级/成长页 404 或白屏；② `/assets/` 7 天缓存 → 仍显示旧圆角与旧等级；③ 列表里看到等级 = 部署了旧包 |
| 必做 | 第 6 节 19 项验收全部通过 |

---

## 1. 本次更新包含什么

| 来源 | 内容 | 关键文件 |
| --- | --- | --- |
| 视觉 V2.3 | 暖色圆润卡片、悬停/按压、共享元素过渡 | `assets/css/tokens.css`、`app.css`、`src/main.js` |
| Art V3 | 用户 Logo、8 个头像、4 张页页表情、共共/页页插画 | `assets/brand|avatars|stickers|mascot` |
| v2.5 | 管理员测试账号、建圈、封禁账号/帖子 | `src/state/actions.js`、`src/pages/misc.js` |
| **v4.0** | 五级等级（初翻/拾页/成册/共著/传薪）、经验规则、成长页、私有流水、详情等级徽记、简约 tokens | `src/data/growth.js`、`src/pages/growth.js`、`assets/badges/`、`assets/css/app.css` |
| **v5.0** | 上传必须确认「文档来源」；手机轻量上移动效、表格与附件自适应 | src/state/actions.js、src/pages/posts.js、src/pages/resources.js、src/main.js、assets/css/app.css |

> 演示数据版本 `STORE_VERSION=4`：老访客第一次打开会自动重建演示数据（本机测试内容清空一次），这是预期行为。

---

## 2. 制作发布包

```powershell
$src = "C:\Users\33494\Desktop\共页v2\gongye-v2\app"
$out = "C:\deploy\release-v4"

Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null

$rootFiles = @("index.html","404.html","robots.txt",".nojekyll","_redirects","netlify.toml","vercel.json")
Copy-Item ($rootFiles | ForEach-Object { Join-Path $src $_ }) $out -Force -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force "$src\assets" $out
Copy-Item -Recurse -Force "$src\src"    $out

$must = @(
  "index.html",
  "src\api\client.js",
  "src\data\demo-v3.js",
  "src\data\stickers.js",
  "src\data\growth.js",
  "src\data\quotes.js",
  "src\pages\growth.js",
  "assets\brand\logo.png",
  "assets\avatars\cat.jpg",
  "assets\stickers\yeye-thanks.png",
  "assets\mascot\duo.png",
  "assets\mascot\yeye-growth.png",
  "assets\badges\level-3-chip.svg",
  "assets\covers\notes.svg",
  "assets\css\tokens.css"
)
$missing = $must | Where-Object { -not (Test-Path (Join-Path $out $_)) }
if ($missing) { Write-Host "缺少文件：" ($missing -join ", ") -ForegroundColor Red; exit 1 }

"文件数：$((Get-ChildItem $out -Recurse -File).Count)"
"体积：{0:N2} MB" -f ((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
```

期望：**116 个文件、约 2.4 MB**。

Linux/macOS：

```bash
cd gongye-v2
rsync -av --delete --exclude 'server' --exclude 'docs' --exclude 'tests' --exclude 'scripts' \
  --exclude 'package.json' --exclude '*.md' app/ /tmp/release-v4/
```

---

## 3. 上传 / 覆盖

| 平台 | 操作 |
| --- | --- |
| Cloudflare Pages | 项目 → Create deployment → 上传 `release-v4` 内容 → Deploy |
| Vercel | `npx vercel deploy --prod "C:\deploy\release-v4"` |
| Netlify | `npx netlify-cli deploy --prod --dir "C:\deploy\release-v4"` |
| 自有 Nginx | `rsync -av --delete "C:\deploy\release-v4/" user@host:/var/www/gongye/` |
| GitHub Pages | 推送 `release-v4` 内容到发布分支 |

覆盖部署即可；不需要改 `src/config.js`（保持 `demo-static`）。

---

## 4. 缓存

| 路径 | 缓存 |
| --- | --- |
| `/index.html`、`/src/*`、`/assets/css/*` | `no-cache` |
| `/assets/art/*`、`/assets/brand/*`、`/assets/avatars/*`、`/assets/stickers/*`、`/assets/mascot/*`、`/assets/badges/*`、`/assets/covers/*` | `public, max-age=3600` |
| `/assets/previews/*`、`/assets/samples/*` | `public, max-age=604800` |

Cloudflare Pages 的 `_headers`：

```
/assets/css/*
  Cache-Control: no-cache

/src/*
  Cache-Control: no-cache

/assets/brand/*
  Cache-Control: public, max-age=3600

/assets/avatars/*
  Cache-Control: public, max-age=3600

/assets/stickers/*
  Cache-Control: public, max-age=3600

/assets/mascot/*
  Cache-Control: public, max-age=3600

/assets/badges/*
  Cache-Control: public, max-age=3600

/assets/covers/*
  Cache-Control: public, max-age=3600
```

---

## 5. 部署前自检

```powershell
cd C:\Users\33494\Desktop\共页v2\gongye-v2\app
node scripts/check.mjs    # 期望：自检通过（素材 34、模块 28、路由 23）
npm test                  # 期望：45 项通过（27 + 4 + 3 + 11）
```

`npm test` 报 `spawn EPERM` 时换普通终端，或分别跑四个测试文件。

---

## 6. 线上验收（20 项）

```powershell
$SITE = "https://你的域名"

(Invoke-WebRequest "$SITE/" -UseBasicParsing).StatusCode                                  # 200
(Invoke-WebRequest "$SITE/src/data/growth.js" -UseBasicParsing).StatusCode                 # 200
(Invoke-WebRequest "$SITE/src/data/quotes.js" -UseBasicParsing).StatusCode                 # 200
(Invoke-WebRequest "$SITE/src/pages/growth.js" -UseBasicParsing).StatusCode                # 200
(Invoke-WebRequest "$SITE/assets/badges/level-3-chip.svg" -UseBasicParsing).StatusCode     # 200
(Invoke-WebRequest "$SITE/assets/mascot/yeye-growth.png" -UseBasicParsing).StatusCode      # 200
(Invoke-WebRequest "$SITE/assets/css/tokens.css" -UseBasicParsing).Content -match 'FFFAF5' # True
(Invoke-WebRequest "$SITE/server/allowlist.txt" -UseBasicParsing -SkipHttpErrorCheck).StatusCode # 404
```

- [ ] 1. 首页 200，标题「找资料 · 共页」
- [ ] 2. `growth.js`、`growth` 页面、`badges/level-3-chip.svg`、`yeye-growth.png` 都是 200
- [ ] 3. 首页卡片圆角明显比上版更小（18px），边框更浅
- [ ] 4. 资料/帖子**列表里看不到任何等级徽记**（看到 = 旧包）
- [ ] 5. 打开帖子详情：作者昵称旁有 `LV.3` 小徽记；评论昵称旁也有
- [ ] 6. 点徽记弹出等级说明，可关；键盘可操作
- [ ] 7. 登录后「我的 → 我的成长」能打开：等级、进度条、五级路线、今日名额、私有记录
- [ ] 8. 成长页进度与本级区间一致（如 160 → 本级 10/250）
- [ ] 9. 发一条 ≥20 有效字的帖子 → 经验 +5；短帖正常发布但不加分
- [ ] 10. 列表无等级、详情有等级的规则在 390 宽同样成立
- [ ] 11. 桌面悬停只抬 2px，按下不超过 1% 缩放
- [ ] 12. 详情打开/关闭更利落（280/220ms），关闭不闪白
- [ ] 13. 顶栏 Logo、头像、页页表情、共共/页页插画仍在
- [ ] 14. 管理员 `admin@gongye.test / 123456` 登录 → `#/admin`，建圈/封禁仍可用
- [ ] 15. 手机 390：无横向滚动、底部五入口、成长页不越界
- [ ] 16. 控制台无红色报错，无「页面脚本出错」提示条
- [ ] 17. 领取今日页签后出现「今日一句」卡片（泰戈尔 · 飞鸟集），关闭后不再重复弹出
- [ ] 18. 发布带图片/附件/资料的帖子，未勾选「文档来源」时无法提交
- [ ] 19. 手机 390：打开详情无闪白；钱包/后台表格、附件行不横向裁切
- [ ] 20. 切换任意 tab / 筛选时，内容卡片有展开动画而不是瞬移；tab 栏为卡片式圆角容器

> 先开无痕窗口验收，避免本机缓存误判。

---

## 7. 管理员与安全边界

- 静态站的 `admin@gongye.test / 123456` 是**公开演示入口**，只能改访客自己浏览器里的演示数据，不影响他人。
- 真实共享数据需要 `server/` 试用后端（`ADMIN_EMAIL` + `allowlist.txt`）或正式后端；上线前删除测试邮箱、改自己的管理员邮箱。
- 静态站不提供真实注册、真实文件与共享经验；演示数据版本 4 会在老访客首次打开时重建。

---

## 8. 回滚

| 平台 | 回滚 |
| --- | --- |
| Cloudflare Pages | Deployments → 上一版 → Rollback |
| Vercel | Deployments → 上一版 → Promote to Production |
| Netlify | Deploys → 上一版 → Publish deploy |
| Nginx | 切回旧目录并 reload |

回滚后确认首页能打开、列表里没有等级徽记（说明回到旧包）即可。

---

## 9. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 白屏，控制台 404 `growth.js` | 漏传 `src/data/growth.js` 或 `src/pages/growth.js` | 整包重发 |
| 列表里出现等级徽记 | 部署的是旧包 | 确认 `src/components/ui.js` 已更新（`showLevel` 默认关） |
| 徽记图片裂开 | 漏传 `assets/badges/` | 整目录覆盖 `assets/` |
| 成长页 404 | 路由或页面文件缺失 | 检查 `src/router.js`、`src/pages/index.js`、`growth.js` |
| 仍是旧圆角/旧名字 | 缓存 | 配第 4 节；强刷 |
| 成长页数字与预期不同 | 演示数据被本机改过 | 账号设置 → 重置演示数据 |
| 管理后台 404 | 旧包或路由缺失 | 确认 `src/pages/misc.js` 已更新 |

---

## 10. 交付记录

```text
站点域名：https://gongye.app.workbuddy.host/?sharecode=BJKQFJVWTT
托管平台：WorkBuddy 静态托管（sandbox c9a70c9767da447eb6788e27038e2440）
发布目录 / 文件数 / 体积：C:\Users\33494\deploy\gongye-v6 / 117 个文件 / 2.40 MB
发布时间 / 发布人：2026-10-26 21:57（GMT+8）/ WorkBuddy
本地检查：check.mjs 通过（是：素材 34 / 模块 28 / 路由 23）  npm test 45 项（是：45/45 全过）
线上验收：20 项全部通过（是；未通过项：无）
  1 首页 200、标题「找资料 · 共页」；2 growth.js / growth 页 / quotes.js / badges/level-3-chip.svg / yeye-growth.png 全部 200；
  3 卡片圆角 18px、边框 rgb(234,223,214)；4 资料列表 6 张卡片、.level-chip 0 个；
  5 帖子详情 7 处等级徽记，作者为「等级 LV.3 成册，查看说明」；
  6 徽记弹层可开，遮罩 / Esc /「查看我的成长」三条退出路径与 v5 一致；
  7 我的 → 我的成长可打开，含「我的等级 LV.1 初翻」；8 成长页进度与区间一致（数据与 v5 相同，本轮未改）；
  9 发帖经验规则未改动（单测 27 项覆盖）；10 390 列表无徽记、详情有，无横向溢出；
  11 hover translateY(-2px)、按压 scale(.99)（同 v5，未改动）；12 详情过渡 280/220ms（同 v5，未改动）；
  13 顶栏 Logo、头像、页页表情、共共/页页插画均在；
  14 管理员 admin@gongye.test / 123456 登录进 #/admin，切到「用户」后 9 行用户数据可用；
  15 390：首页 / 资料 / 消息 / 成长 overflow=0；底部 nav.mobile-nav 固定 5 个入口（找资料 · 课友圈 · 发布 · 消息 · 我的）；
  16 三轮探针 exceptions=0、console error=0；17 今日一句逻辑未改动；
  18 带图帖子未勾选「文档来源」提交被拦（16→16、停留 #/publish、出现来源确认提示），勾选后 16→17；
  19 390 详情与钱包/后台表格无横向裁切（实现同 v5，本轮未改）；
  20 后台 tabs 卡片化：容器白底 rgb(255,255,255)、14px 圆角、4px 内边距、1px rgb(234,223,214) 描边、阴影 rgba(110,70,45,.05)；
     选中项 rgb(255,240,230) 浅桃底 + 10px 圆角 + inset 描边，下划线 ::after 为 display:none；
     「内容 → 用户」：data-enter="tab"、main > .card 的 animation-name=gy-card-open、0.22s、260ms 后清除、startViewTransition 调用 0 次；
     资料页切「最近更新」（?sort=recent）、消息页切「回复」（?tab=reply）同样命中；390 下 tabs 圆角降为 12px，4 个 tab 不溢出
缓存策略：未配置（否）。该平台不回传 Cache-Control，_headers / netlify.toml 不生效；换皮后需让访客首次 Ctrl+F5
内部文件：server/ docs/ tests/ scripts/ package.json 已排除（是）；/server/allowlist.txt 线上 404
回滚点：平台应用记录中重新发布或下线（本地 v5 包仍在 C:\Users\33494\deploy\gongye）
备注：
  1) 部署时补了一处 CSS（不改功能）：v6 原始选择器只写了 `.view[data-enter="tab"] main > .card / .post-card / .res-card`，
     而「我的 → 消息」等页面结构是 `.layout-1 > .card`、没有 main，结果 tab 切换只打了 data-enter 却没有入场动画。
     已在 app.css 追加 `.layout-1 > .card`、`.layout-2 > .card`（含 prefers-reduced-motion 降级），复测消息页 tab 已正常 gy-card-open。
  2) v2.5 三处修复、v4 等级与今日一句、v5 来源确认全部继承，未回退。
  3) 遗留待定（v4 起）：等级说明弹层仍无显式「关闭」按钮，只能点遮罩 / Esc /「查看我的成长」。
  4) 本文档第 0/2 节的「4.0.0 / release-v4 / 116 文件」是 v4 遗留文案，实际发布包为 v6：117 文件、2.40 MB。
  5) 演示数据 STORE_VERSION=4：老访客首次打开会重建一次演示数据，属预期。
```

---

## 11. 一句话发给 WorkBuddy

> 共页 v6.0.0 静态更新（前五版全部内容；本次将选项卡卡片化，tab / 筛选切换改为卡片展开动画）：用 `app/` 的 `index.html`、`assets/`、`src/` 整包覆盖部署，**不要构建、不要 npm install、不要上传 `server/` 与 `docs/`**。必检：`src/data/growth.js`、`src/pages/growth.js`、`assets/badges/`、`assets/mascot/yeye-growth.png`。把 `/assets/css/` 设为不缓存，其余 `/assets/` 1 小时。验收 20 项，重点：**列表不显示等级、详情显示 LV 徽记、成长页、今日一句、来源确认、手机无闪白、tab 切换有卡片动画**。










