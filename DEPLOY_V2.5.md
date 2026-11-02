# WorkBuddy 部署说明 · 共页 v2.5.0（历史版，已被 `DEPLOY_V4.md` 取代）

> 读者：负责部署的 WorkBuddy。
> 适用：把当前 `app/` 部署到静态托管（Cloudflare Pages / Vercel / Netlify / Nginx / GitHub Pages）。
> 结论：**纯静态、零构建、零依赖**。不要 `npm install`，不要跑构建命令，上传目录就是 `app/` 的运行时文件。

> **重要：本次是“两版美术一起发”。** 暖色圆润卡片与动效（视觉 V2.3）和 用户 Logo / 生活化头像 / 页页表情 / 共共页页插画（Art V3）在同一个包里，**一次覆盖**即可，不需要先发 V2.3 再发 V3。线上如果还停在旧绿色版本，直接按本文覆盖，不要分两次。

---

## 0. 一页结论

| 项 | 值 |
| --- | --- |
| 版本 | `2.5.0`（**V2.3 暖色 + 动效** ＋ **Art V3 Logo/头像/表情/插画** ＋ 管理员后台，一次更新） |
| 部署形态 | 静态站点；真实注册/共享数据需要单独跑 Node 试用后端（见 `PILOT.md`） |
| 构建 | **无**。HTML + CSS + 原生 ES Module |
| 发布文件 | `index.html`、`404.html`、`robots.txt`、`.nojekyll`、`_redirects`、`netlify.toml`、`vercel.json`、`assets/`、`src/` |
| 体积 | 约 **2.3 MB**（比上版多 1.9 MB：两版美术新增的头像、表情、吉祥物与演示数据） |
| 不能上传 | `server/`（试用后端与白名单）、`docs/`（截图约 9 MB）、`tests/`、`scripts/`、`*.md`、`package.json` |
| 最容易翻车 | ① 只挑“改过的文件”上传，漏了 `src/api/client.js` / `src/data/demo-v3.js` → 白屏或没头像；② `/assets/` 7 天缓存 → 同事仍看到旧绿色；③ 静态站没有后端，注册/共享数据不会生效 |
| 必做 | 第 6 节 16 项验收全部通过 |

---

## 1. 这次更新包含什么（两版美术 + 管理员）

**本次发布 = V2.3 + Art V3 两版美术合并，再叠加管理员功能。** 下表只是说明每一项来自哪一版，便于对照问题，不是分三次部署。

| 来源 | 内容 | 关键文件 |
| --- | --- | --- |
| 视觉 V2.3 | 暖色圆润卡片、悬停/按压、共享元素过渡 | `assets/css/tokens.css`、`app.css`、`index.html`、`src/main.js` |
| Art V3 | 用户 Logo、8 个生活化头像、4 张页页表情、共共/页页插画、生活化演示内容 | `assets/brand/`、`assets/avatars/`、`assets/stickers/`、`assets/mascot/`、`src/data/stickers.js`、`src/data/demo-v3.js` |
| 过渡修复 | 修掉过渡闪白；进入/退出动画对称 | `src/main.js`、`app.css` |
| 管理员 | 管理员测试账号、登录进后台、新建课友圈、封禁账号/帖子 | `src/state/actions.js`、`src/pages/misc.js`、`src/data/seed.js`（`STORE_VERSION=4`） |

> 两份美术包的文件都在同一个 `assets/` 与 `src/` 里：**整目录覆盖 = 两版一起生效**。不要只传其中一版的 CSS 或 SVG，否则会出现“新卡片 + 旧图标”或“有 Logo 没头像”的混搭。
>
> 演示数据版本升到 4：**老访客第一次打开会自动重建演示数据**（本机测试内容会清空一次），这是预期行为，不是 bug。

---

## 2. 制作发布包

### 2.1 Windows PowerShell（推荐）

```powershell
$src = "C:\Users\33494\Desktop\共页v2\gongye-v2\app"
$out = "C:\deploy\release-v25"

Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null

$rootFiles = @("index.html","404.html","robots.txt",".nojekyll","_redirects","netlify.toml","vercel.json")
Copy-Item ($rootFiles | ForEach-Object { Join-Path $src $_ }) $out -Force -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force "$src\assets" $out
Copy-Item -Recurse -Force "$src\src"    $out

# 必检文件（缺一个就不要发布）
$must = @(
  "index.html",
  "src\api\client.js",
  "src\data\demo-v3.js",
  "src\data\stickers.js",
  "assets\brand\logo.png",
  "assets\avatars\cat.jpg",
  "assets\stickers\yeye-thanks.png",
  "assets\mascot\duo.png",
  "assets\css\tokens.css"
)
$missing = $must | Where-Object { -not (Test-Path (Join-Path $out $_)) }
if ($missing) { Write-Host "缺少文件：" ($missing -join ", ") -ForegroundColor Red; exit 1 }

"文件数：$((Get-ChildItem $out -Recurse -File).Count)"
"体积：{0:N2} MB" -f ((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
```

期望输出：**文件数约 87，体积约 2.3 MB**。

### 2.2 Linux / macOS

```bash
cd gongye-v2
rsync -av --delete \
  --exclude 'server' --exclude 'docs' --exclude 'tests' --exclude 'scripts' \
  --exclude 'package.json' --exclude '*.md' --exclude 'nginx.conf.example' \
  app/ /tmp/release-v25/
du -sh /tmp/release-v25
```

---

## 3. 上传 / 覆盖

| 平台 | 操作 |
| --- | --- |
| **Cloudflare Pages** | 项目 → Create deployment → 上传 `release-v25` 内容 → Deploy |
| **Vercel** | `npx vercel deploy --prod "C:\deploy\release-v25"` |
| **Netlify** | `npx netlify-cli deploy --prod --dir "C:\deploy\release-v25"` |
| **自有 Nginx** | `rsync -av --delete "C:\deploy\release-v25/" user@host:/var/www/gongye/`，无需重启 |
| **GitHub Pages** | 推送 `release-v25` 内容到发布分支，等 1–2 分钟 |

> 覆盖部署即可，**不需要**新建项目，也不需要改 `src/config.js`（保持 `mode: 'demo-static'`）。

---

## 4. 缓存必须处理（否则会看到旧绿色）

`/assets/` 默认 7 天缓存，而这次换了 CSS、Logo、头像、表情。建议：

| 路径 | 缓存 |
| --- | --- |
| `/index.html`、`/src/*` | `no-cache` |
| `/assets/css/*` | `no-cache` |
| `/assets/art/*`、`/assets/brand/*`、`/assets/avatars/*`、`/assets/stickers/*`、`/assets/mascot/*` | `public, max-age=3600` |
| `/assets/previews/*`、`/assets/samples/*` | `public, max-age=604800` |

### Cloudflare Pages

在发布目录新增 `_headers`：

```
/assets/css/*
  Cache-Control: no-cache

/assets/art/*
  Cache-Control: public, max-age=3600

/assets/brand/*
  Cache-Control: public, max-age=3600

/assets/avatars/*
  Cache-Control: public, max-age=3600

/assets/stickers/*
  Cache-Control: public, max-age=3600

/assets/mascot/*
  Cache-Control: public, max-age=3600

/src/*
  Cache-Control: no-cache
```

### Netlify（`netlify.toml` 追加）

```toml
[[headers]]
  for = "/assets/css/*"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=3600"
```

### Nginx

```nginx
location /assets/css/ { expires -1; try_files $uri =404; }
location /assets/     { expires 1h; try_files $uri =404; }
```

> 不改缓存也能上线：让同事 **Ctrl + F5** 一次。但下次更新还会遇到，建议一次配好。

---

## 5. 部署前自检

```powershell
cd C:\Users\33494\Desktop\共页v2\gongye-v2\app
node scripts/check.mjs    # 期望：自检通过
npm test                  # 期望：37 项通过（19 + 4 + 3 + 11）
```

若 `npm test` 报 `spawn EPERM`，说明终端在受限沙箱：换普通终端，或分别运行 `node tests/logic.test.mjs`、`render.test.mjs`、`boot.test.mjs`、`pilot.test.mjs`。

---

## 6. 线上验收（16 项）

把站点记作 `$SITE`。

### 6.1 资源（可直接跑）

```powershell
$SITE = "https://你的域名"

(Invoke-WebRequest "$SITE/" -UseBasicParsing).StatusCode                              # 200
(Invoke-WebRequest "$SITE/src/api/client.js" -UseBasicParsing).StatusCode             # 200
(Invoke-WebRequest "$SITE/src/data/demo-v3.js" -UseBasicParsing).StatusCode            # 200
(Invoke-WebRequest "$SITE/src/data/stickers.js" -UseBasicParsing).StatusCode           # 200
(Invoke-WebRequest "$SITE/assets/brand/logo.png" -UseBasicParsing).StatusCode          # 200
(Invoke-WebRequest "$SITE/assets/avatars/cat.jpg" -UseBasicParsing).StatusCode         # 200
(Invoke-WebRequest "$SITE/assets/stickers/yeye-thanks.png" -UseBasicParsing).StatusCode # 200
(Invoke-WebRequest "$SITE/assets/mascot/duo.png" -UseBasicParsing).StatusCode          # 200
(Invoke-WebRequest "$SITE/assets/css/tokens.css" -UseBasicParsing).Content -match 'FFFAF5' # True
(Invoke-WebRequest "$SITE/server/allowlist.txt" -UseBasicParsing -SkipHttpErrorCheck).StatusCode # 404
```

- [ ] 1. 首页 200，标题「找资料 · 共页」
- [ ] 2. `src/api/client.js`、`demo-v3.js`、`stickers.js` 都是 200（白屏三兄弟）
- [ ] 3. Logo、头像、表情、吉祥物四类图片都是 200
- [ ] 4. `tokens.css` 含 `FFFAF5`（新主题）
- [ ] 5. `/server/allowlist.txt` 返回 404（内部文件没上传）

### 6.2 页面（人工点）

- [ ] 6. 首页奶油白 + 白卡 + 珊瑚橙按钮；顶栏是**书页 Logo**；没有绿色残留
- [ ] 7. 资料卡头像是猫/山景/咖啡等照片或 SVG，不是旧的人脸
- [ ] 8. 桌面右栏有共共/页页插画；手机搜索无结果时也能看到插画
- [ ] 9. 打开任意帖子（如 `/posts/p_calc_notes`），能看到页页表情（「谢谢」「收到」等）
- [ ] 10. 点卡片进详情有展开动画，返回恢复滚动位置与焦点；关闭不再闪白
- [ ] 11. 手机 390 宽：单列、底部五个入口、无横向滚动、无黑底
- [ ] 12. 控制台无红色报错；没有「页面脚本出错」提示条

### 6.3 管理员（演示模式）

- [ ] 13. 登录页用 `admin@gongye.test` / `123456` 登录 → 自动进入 `#/admin`
- [ ] 14. 「圈子」页新建一个课友圈（如 微积分Ⅰ / 2027春 / 教学班D）→ 跳转到新圈
- [ ] 15. 「内容」页封禁一条帖子 → 首页与资料列表里消失，详情显示“已被管理员封禁”；解封恢复
- [ ] 16. 「用户」页封禁一个账号 → 状态变“已封禁”，该账号无法继续登录互动

> 验收先开**无痕窗口**，避免把本机缓存误判为线上问题。

---

## 7. 管理员账号与安全边界（请务必知道）

静态站是**纯前端演示**，数据只存在每个访客自己的浏览器里：

- 演示管理员 `admin@gongye.test / 123456` 是**公开的演示入口**，谁都能点。它只能改自己浏览器里的演示数据，**不会影响别人**，也不能访问真实数据。
- 因此静态站适合内部演示/评审，**不能**当作真实社区上线。真实注册、共享帖子、真正封禁，需要跑 Node 试用后端（`server/`）或正式后端：
  - 试用后端：见 `PILOT.md`；管理员由 `ADMIN_EMAIL` + `server/allowlist.txt` 决定，不依赖演示账号。
  - 正式方案：见 `BACKEND_PLAN.md`。
- 若把试用后端部署到公网：**删除** `allowlist.txt` 里的 `admin@gongye.test`，把 `ADMIN_EMAIL` 改成自己的邮箱，并确保 `ALLOWED_ORIGINS` 只列自己的站点。

---

## 8. 回滚

| 平台 | 回滚 |
| --- | --- |
| Cloudflare Pages | Deployments → 上一版 → Rollback |
| Vercel | Deployments → 上一版 → Promote to Production |
| Netlify | Deploys → 上一版 → Publish deploy |
| Nginx | 切回旧目录，`nginx -t && systemctl reload nginx` |
| GitHub Pages | 回退到上一个 commit |

回滚后确认首页能打开、卡片是旧样式即可，不必重测全部。

---

## 9. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 整站白屏，控制台 `Failed to load module … client.js` | 漏传 `src/api/client.js` 或 `src/data/*.js` | 用第 2 节整包重发 |
| 仍是绿色旧样式 / 旧人脸头像 | `/assets/` 7 天缓存 | 配第 4 节缓存；或强刷验证 |
| 头像/表情 404 | 只传了 `assets/art/`，漏了 `brand/avatars/stickers/mascot` | 整目录覆盖 `assets/` |
| 登录管理员后没进后台 | 登录页是旧 JS 缓存 | 强刷；确认 `src/main.js` 已更新 |
| 管理员登录提示“不在名单内” | 当前是 `production`（试用后端）模式 | 用 `ADMIN_EMAIL` 对应邮箱，或改回演示模式 |
| 封禁的帖子还能搜到 | 浏览器缓存了旧页面 | 强刷；检查 `src/state/actions.js` 是否更新 |
| 同事打开后演示数据被重置 | `STORE_VERSION` 升到 4，一次性重建 | 预期行为，不是故障 |
| `npm test` 报 `spawn EPERM` | 终端沙箱限制 | 换普通终端或分别跑四个测试文件 |

---

## 10. 交付记录（请回填）

```text
站点域名：https://gongye.app.workbuddy.host/?sharecode=BJKQFJVWTT
托管平台：WorkBuddy 静态托管（sandbox c9a70c9767da447eb6788e27038e2440）
发布方式：覆盖部署（同一 appId，分享链接与分享码不变）
发布目录：C:\Users\33494\deploy\gongye（由 app/ 抽取运行时文件，87 个文件 / 2.27 MB）
文件数 / 体积：87 / 2.27 MB
发布时间 / 发布人：2026-10-26 17:0x（GMT+8）/ WorkBuddy
本地检查：check.mjs 通过（是）  npm test 37 项通过（是：19 + 4 + 3 + 11）
线上验收：第 6 节 16 项全部通过（是；未通过项：无）
缓存策略：未生效（否）。该托管平台不回传 Cache-Control，_headers / netlify.toml 均不被读取；
          换皮后请让评审同学首次 Ctrl+F5，或改用 Cloudflare Pages / Netlify 承载以生效第 4 节规则
内部文件：server/ docs/ tests/ scripts/ package.json 已排除（是）；/server/allowlist.txt 线上 404
管理员测试：演示账号 admin@gongye.test / 123456 可登录并进入 #/admin（是）；是否需要接试用后端（否）
回滚点：平台应用记录中重新发布或下线；本地未保留 v2.2 旧源码（app/ 已被 v2.5 覆盖）
备注：
  本次覆盖前做了 3 处代码修正（否则第 15、16 项与"控制台无报错"不成立）：
  1) src/pages/posts.js：封禁帖详情文案判定写错（外层判 hidden、内层判 banned，永远进不到 banned 分支），
     封禁后显示"仍是草稿"。已改为先判 banned，现在显示"这篇内容已被管理员封禁，暂时不可见。"
  2) src/state/actions.js：quickLogin 未校验 status，被封账号仍能用"一键演示账号"进入。
     已补 `if (user.status !== 'active') return fail('suspended', '该账号已停用，不能登录')`。
  3) src/main.js：ViewTransition 的 finished.finally(...) 未 catch，连续快速切换路由会抛未捕获
     AbortError（红色控制台报错）。已追加 .catch(() => {})，保留原过渡行为。
  另在 tests/logic.test.mjs 补了一条回归断言：被封账号不能快捷登录。
  这 3 处如被重新生成覆盖，请重新核对第 15/16 项。
```

---

## 11. 一句话发给 WorkBuddy

> 共页 v2.5.0 静态更新（**V2.3 暖色动效 + Art V3 Logo/头像/页页表情，两版美术一次覆盖**）：用 `app/` 的 `index.html`、`assets/`、`src/` 和托管配置整包覆盖部署，**不要构建、不要 npm install、不要上传 `server/` 与 `docs/`**。必须确认 `src/api/client.js`、`src/data/demo-v3.js`、`src/data/stickers.js`、`assets/brand|avatars|stickers|mascot` 都在包里（缺一个就白屏或没图）。把 `/assets/css/` 设为不缓存，其余 `/assets/` 1 小时。部署后按 `DEPLOY_V2.5.md` 第 6 节验收 16 项（含管理员登录、建圈、封禁帖子/账号），并回填第 10 节记录。



