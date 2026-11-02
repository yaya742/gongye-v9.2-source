# WorkBuddy 重新部署说明 · 视觉 V2.3 / Art V3（历史版，已被 `DEPLOY_V2.5.md` 取代）

> **Art V3 追加（版本 2.4.0）**：本次比 V2.3 多了四类资源与两个数据文件，仍按“整目录覆盖”执行即可：
>
> - 新增目录：`assets/brand/`（用户 Logo）、`assets/avatars/`（8 张头像）、`assets/stickers/`（4 张页页表情）、`assets/mascot/`（双人插画）
> - 新增文件：`src/data/stickers.js`、`src/data/demo-v3.js`
> - 缓存建议：上述新目录与 `/assets/art/` 一样设 `max-age=3600`，CSS 仍 `no-cache`
> - 额外验收两项：顶栏是用户提供的书页 Logo；帖子/评论里能看到页页表情（刷新后仍在），且表情面板不会自动发送
> 读者：负责部署的 WorkBuddy。
> 场景：线上已经有一版共页静态站，本次要**用新视觉替换它**（或重建一个全新的静态项目）。
> 结论：**只替换静态文件，不需要构建、不需要改配置、不需要动后端**。但本次有一条必须注意：`src/` 里新增了文件，**必须整目录覆盖，不能只挑改过的文件**。

---

## 0. 一页结论

| 项 | 值 |
| --- | --- |
| 部署形态 | 纯静态，零构建、零依赖；**不要执行 `npm install` / 构建命令** |
| 本次发布的目录 | `app/` 里的 `index.html` + `assets/` + `src/` + `404.html` + 托管配置 |
| 上传体积 | 约 0.4 MB（运行时文件很小；若连 `docs/` 截图一起传会多出约 9 MB，建议**不要**传） |
| 是否改后端 | 不改。`server/` 不上传，`config.js` 保持 `mode: 'demo-static'` |
| 是否改数据 | 不改。演示数据在各访问者浏览器，换代码不会清空 |
| 最关键的一条 | **整目录覆盖 `src/` 与 `assets/`**：`src/api/client.js` 是新增文件，漏传会导致整站白屏 |
| 必须处理的第二件事 | 缓存：`/assets/` 默认缓存 7 天，不改缓存策略同事可能还看到旧绿色样式 |
| 必做验收 | 第 6 节的 12 项，全部通过才算完成 |

---

## 1. 本次改了什么（为什么不能只传一个 CSS）

视觉 V2.3 把旧绿主题改成奶油白 + 珊瑚橙，并加入动效。涉及：

| 类别 | 文件 | 不传会怎样 |
| --- | --- | --- |
| 主题变量 | `assets/css/tokens.css` | 仍是旧绿主题 |
| 样式与动效 | `assets/css/app.css`（新增约 300 行 V2.3 段） | 卡片不圆、无悬停抬起、无过渡 |
| 资源 | `assets/art/*.svg`（25 个重着色 + 6 个头像重绘） | 图标/头像仍是绿色，和新主题冲突 |
| 页面元信息 | `index.html`（`theme-color`、`color-scheme`） | 浏览器工具栏/移动端状态栏颜色不一致 |
| 组件 | `src/components/ui.js`（卡片可点击、数据属性、新评论标记） | 整卡点击与共享元素过渡失效 |
| 入口 | `src/main.js`（共享元素、滚动记忆、焦点、错峰、reduce） | 详情没有过渡，返回不恢复滚动 |
| **新增文件** | **`src/api/client.js`** | **`main.js` 导入失败 → 整站白屏（最常见事故）** |
| 其他 | `src/state/store.js`、`src/pages/*`、`src/components/layout.js` | 试用后端模式与演示横幅不生效（静态演示仍可用，但版本不一致） |

所以：**不要按“改了哪些文件”挑选上传，直接整目录替换。**

---

## 2. 发布清单

### 2.1 必须包含

```
index.html
404.html
robots.txt
.nojekyll
_redirects           # Cloudflare Pages / Netlify
netlify.toml         # 仅 Netlify 需要，其余平台会忽略
vercel.json          # 仅 Vercel 需要，其余平台会忽略
assets/              # css / art / previews / samples
src/                 # config.js、main.js、router.js、api/、lib/、data/、state/、components/、pages/
```

### 2.2 不要包含（内部文件，不需要公开）

```
server/              # 内部试用后端：含白名单与数据，绝对不能上传
docs/                # 截图约 9 MB，只用于评审
tests/               # 自动化测试
scripts/             # 本地工具（serve/qa/check）
package.json 项目说明 *.md  nginx.conf.example
server/data/         # 如果本地跑过试用，这里可能有同事邮箱，务必排除
server/allowlist.txt # 同上
```

> 如果上一次部署把整目录都传了，这次顺手清理掉 `server/`、`tests/`、`scripts/`。可以用第 7 节验收里的 `…/server/allowlist.txt` 应返回 404 来确认。

### 2.3 生成发布目录（Windows PowerShell）

```powershell
$src = "C:\Users\33494\Desktop\共页v2\gongye-v2\app"
$out = "C:\deploy\release-v23"

Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null

Copy-Item "$src\index.html","$src\404.html","$src\robots.txt","$src\.nojekyll",
          "$src\_redirects","$src\netlify.toml","$src\vercel.json" $out -Force
Copy-Item -Recurse -Force "$src\assets" $out
Copy-Item -Recurse -Force "$src\src" $out

# 自检：这三个文件必须在，缺一个就会出问题
Test-Path "$out\index.html"                 # True
Test-Path "$out\src\api\client.js"          # True  ← 新增文件，最容易漏
Test-Path "$out\assets\css\tokens.css"      # True
(Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB   # 约 0.4
```

### 2.4 Linux / macOS

```bash
cd gongye-v2
rsync -av --delete \
  --exclude 'server' --exclude 'docs' --exclude 'tests' --exclude 'scripts' \
  --exclude 'package.json' --exclude '*.md' --exclude 'nginx.conf.example' \
  app/ /tmp/release-v23/
```

---

## 3. 覆盖方式

### 3.1 已有站点：覆盖部署（推荐）

| 平台 | 操作 |
| --- | --- |
| **Cloudflare Pages**（直传） | 打开项目 → **Create deployment** → 上传 `release-v23` 的内容 → Deploy。历史部署会保留，可回滚 |
| **Vercel** | `npx vercel deploy --prod "C:\deploy\release-v23"`；或在项目里替换文件后 **Redeploy** |
| **Netlify** | `npx netlify-cli deploy --prod --dir "C:\deploy\release-v23"`；或拖拽目录到 **Deploys** |
| **自有 Nginx** | `rsync -av --delete "C:\deploy\release-v23/" user@host:/var/www/gongye/`，**不需要 restart**（静态文件即时生效） |
| **GitHub Pages** | 把 `release-v23` 内容推到发布分支，等 1 分钟 |

### 3.2 重建全新项目（如果决定新开一个）

步骤与 3.1 相同，只是平台里新建项目、绑定同一个域名。**注意**：新项目上线前先确认旧项目还在，便于回滚；DNS 切换后旧项目保留至少一周。

**不要**为了“重做”去改 `src/config.js`（保持 `mode: 'demo-static'`），也不要执行构建命令。前端没有构建产物。

---

## 4. 缓存：这次必须处理

静态站默认给 `/assets/` 设了 7 天缓存（图片、SVG、CSS）。V2.3 改了 CSS 和 25 个 SVG，如果不处理缓存，同事会看到“一半新一半旧”的页面（新文案 + 旧绿色）。

**推荐策略**（改动小、最容易验证）：

| 路径 | 缓存 |
| --- | --- |
| `/index.html` | `no-cache` |
| `/src/*` | `no-cache`（代码，必须有） |
| `/assets/css/*` | `no-cache`（本次改动） |
| `/assets/art/*` | `public, max-age=3600`（1 小时，图标会变） |
| `/assets/previews/*`、`/assets/samples/*` | `public, max-age=604800`（内容不变，可长缓存） |

### 4.1 Cloudflare Pages

在发布目录根新增 `_headers`（如果平台支持；WorkBuddy 可直接创建此文件）：

```
/assets/css/*
  Cache-Control: no-cache

/assets/art/*
  Cache-Control: public, max-age=3600

/src/*
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache
```

### 4.2 Netlify

`netlify.toml` 里追加（放在现有 `[[headers]]` 之前，先匹配先生效）：

```toml
[[headers]]
  for = "/assets/css/*"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/assets/art/*"
  [headers.values]
    Cache-Control = "public, max-age=3600"
```

### 4.3 Vercel

`vercel.json` 的 `headers` 数组最前面插入：

```json
{ "source": "/assets/css/(.*)", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
{ "source": "/assets/art/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=3600" }] }
```

### 4.4 Nginx

参考 `nginx.conf.example`，把 CSS 单独设短缓存：

```nginx
location /assets/css/ {
    expires -1;
    try_files $uri =404;
}
location /assets/art/ {
    expires 1h;
    try_files $uri =404;
}
```

> 如果本次不方便改缓存头：部署后让同事 **Ctrl + F5** 强刷一次也能看到新样式，但下次更新还会遇到同样问题，建议一次性配好。

---

## 5. 部署前检查（3 条命令，约 30 秒）

```powershell
cd C:\Users\33494\Desktop\共页v2\gongye-v2\app

node scripts/check.mjs     # 期望：自检通过（导入、路由、本地资源引用均可解析）
npm test                   # 期望：15 + 4 + 3 + 11 全过，fail 0
# 可选：起本地服务后用浏览器看一眼
node scripts/serve.mjs     # http://127.0.0.1:4173/ ，确认是暖色、卡片会抬起
```

如果 `npm test` 报 `spawn EPERM`，说明终端在受限沙箱里，换普通终端或分别执行 `node tests/logic.test.mjs` 等四个文件。

---

## 6. 线上验收清单（12 项，逐条打勾）

把 `https://你的域名` 记为 `$SITE`。

### 6.1 资源与缓存

```powershell
$SITE = "https://gongye.example.com"
(Invoke-WebRequest "$SITE/" -UseBasicParsing).StatusCode                                  # 200
(Invoke-WebRequest "$SITE/src/api/client.js" -UseBasicParsing).StatusCode                 # 200（新增文件）
(Invoke-WebRequest "$SITE/assets/css/tokens.css" -UseBasicParsing).Content -match 'FFFAF5' # True（新主题）
(Invoke-WebRequest "$SITE/assets/art/avatar-01.svg" -UseBasicParsing).Content -match 'FFE9DC' # True（新头像）
(Invoke-WebRequest "$SITE/index.html" -UseBasicParsing).Content -match 'FFFAF5'            # True（theme-color）
```

- [ ] 1. 首页 200，标题「找资料 · 共页」
- [ ] 2. `/src/api/client.js` 返回 200（不是 404）——这条决定整站是否白屏
- [ ] 3. `tokens.css` 含 `FFFAF5`；`avatar-01.svg` 含 `FFE9DC`（确认新资源已生效）
- [ ] 4. `/server/allowlist.txt` 与 `/server/data/db.json` 返回 **404**（内部文件没被上传）
- [ ] 5. 响应头里 `/assets/css/app.css` 的 `Cache-Control` 不是 7 天（或你已用强刷验证）

### 6.2 视觉与动效

- [ ] 6. 整站奶油白背景、白卡、珊瑚橙按钮；**看不到绿色**（旧主题）
- [ ] 7. 桌面：鼠标移到资料卡上，卡片抬起 4px、阴影变大；移开回落
- [ ] 8. 点击资料卡 → 进入详情（有从卡片展开的过渡感）；浏览器返回 → 回到原来的滚动位置，焦点回到该卡片
- [ ] 9. 手机 390 宽：单列、底部 5 个导航、无横向滚动、无黑底
- [ ] 10. 列表首屏卡片有轻微错开入场；页签切换有指示线过渡
- [ ] 11. 控制台无红色报错；页面没有「页面脚本出错」提示条
- [ ] 12. 登录页、发布页、弹层（送页签/举报）都是浅色，表单圆角 16px

> 验收时先开一个**无痕窗口**，避免把自己浏览器的旧缓存当成线上问题；如果无痕正常、普通窗口异常，就是缓存没配好。

---

## 7. 回滚

| 平台 | 回滚 |
| --- | --- |
| Cloudflare Pages | Deployments → 选上一个成功版本 → **Rollback** |
| Vercel | Deployments → 上一版 → **Promote to Production** |
| Netlify | Deploys → 上一版 → **Publish deploy** |
| 自有 Nginx | 保留 `gongye-20261026` 旧目录，改名切回后 `nginx -t && systemctl reload nginx` |
| GitHub Pages | 回退到上一个 commit 并推送 |

回滚后只需确认首页能打开、卡片是旧样式（说明旧文件生效），其余不必重测。

---

## 8. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 整站白屏，控制台 `Failed to load module … client.js` | 只上传了部分 `src/`，漏了新增文件 | 整目录覆盖 `src/` |
| 文案是新的，但仍是绿色卡片 | CSS/SVG 走了 7 天缓存 | 按第 4 节改缓存；或强刷验证 |
| 卡片会抬起，但点击没有过渡 | `main.js` 没更新，或浏览器不支持 View Transitions（Safari/Firefox 旧版） | 确认 `main.js` 已更新；不支持时会自动淡入，属正常降级 |
| 手机出现黑底 | 仍是旧 CSS（`color-scheme`/背景色未生效） | 强刷或清缓存；确认 `index.html` 含 `color-scheme` meta |
| `/resources/xxx` 直接打开 404 | 平台回退规则丢了 | 补 `_redirects` / `vercel.json` / `try_files`；或改用 `/#/resources/xxx` 分享 |
| 首页正常，但详情页样式错乱 | `assets/css/app.css` 没更新 | 整目录覆盖 `assets/` |
| `npm test` 报 spawn EPERM | 终端在受限沙箱 | 换普通终端，或分别跑四个测试文件 |

---

## 9. 交付记录（请 WorkBuddy 填写后回传）

```text
站点域名：
托管平台：
发布方式：覆盖部署 / 新建项目
发布目录：C:\deploy\release-v23（或实际路径）
发布时间：
发布人：
本地检查：check.mjs 通过（是/否）  npm test 33 项通过（是/否）
线上验收：第 6 节 12 项全部通过（是/否，未通过项：）
缓存策略：已调整（是/否，平台与规则）
内部文件：server/ docs/ tests/ scripts/ 已排除（是/否）
回滚点：平台部署 ID / 旧目录名
备注：
```

---

## 10. 附：一句话发给 WorkBuddy

> 这是共页的视觉 V2.3 静态更新。请用 `app/` 里的 `index.html`、`assets/`、`src/`、`404.html` 和托管配置做一次覆盖部署（或新建静态项目），**不要构建、不要 npm install、不要上传 `server/` 和 `docs/`**。注意 `src/` 里新增了 `src/api/client.js`，必须整目录覆盖；并把 `/assets/css/` 设为不缓存（或让用户强刷），否则会看到旧绿色样式。部署后按 `REDEPLOY_V2.3.md` 第 6 节 12 项验收，回填第 9 节记录。



