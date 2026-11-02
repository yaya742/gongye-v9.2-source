# WorkBuddy 静态部署交接 · 共页 v2.2

> 读者：负责上线的 WorkBuddy。
> 目标：把 `app/` 目录发布成一个可访问的静态站点，并通过本文件末尾的验收清单。
> 本文件不假设你了解项目上下文；所有命令都可直接复制执行。
>
> **范围说明：本文件只描述静态演示版部署。**源码包默认 `demo-static`，但现有托管站点可能由运行时配置连接试用后端；不要用本文件或 ZIP 默认值推断线上运行模式。检查线上时查看当前站点提示及 `/api/health`；健康接口有响应不代表该后端已通过安全审查。试用后端限制见 [PILOT.md](PILOT.md)。

---

## 0. 结论先行（TL;DR）

| 项目 | 值 |
| --- | --- |
| 部署形态 | **纯静态站点**，无服务端、无数据库、无构建步骤 |
| 构建命令 | **不需要**（如果平台强制要求，填 `echo "static site, nothing to build"` 或留空） |
| 发布目录 | `app/`（目录内容即站点根目录，`index.html` 在根） |
| Node 版本 | 仅本地预览/验收脚本需要 Node ≥ 20；**部署本身不需要 Node** |
| 依赖安装 | 无。`package.json` 里没有任何 dependencies，不要执行 `npm install` |
| 环境变量 | **无必填项**。`src/config.js` 是公开配置，不能放任何密钥 |
| 路由方式 | hash 路由（`/#/resources/r_xxx`），同时兼容 `/resources/r_xxx` 这类干净链接（需回退配置） |
| 必做配置 | 1 条 SPA 回退规则 + 正确 MIME（`.svg` `image/svg+xml`、`.pdf` `application/pdf`、`.js` `text/javascript`） |
| 推荐平台 | Cloudflare Pages（免费额度、自动 HTTPS、按目录发布最省事） |
| 上线前必须做 | 第 3 节本地验收 + 第 10 节线上验收，两项都通过才算完成 |

**一句话流程**：本地验收 → 选平台 → 上传 `app/` → 配 SPA 回退与安全头 → 绑域名与 HTTPS → 按第 10 节逐条验收 → 记录版本与回滚点。

---

## 1. 交付物与环境要求

### 1.1 交付物

```
app/
├── index.html            # 站点入口（必须存在且在根目录）
├── 404.html              # 可选：静态托管的缺省 404
├── _redirects            # Cloudflare Pages / Netlify 的 SPA 回退
├── netlify.toml          # Netlify 配置（重写 + 安全头 + 缓存）
├── vercel.json           # Vercel 配置（同上）
├── nginx.conf.example    # 自有服务器参考配置
├── robots.txt .nojekyll .gitignore
├── assets/               # 样式、图标、示例 PDF、预览图（静态资源）
├── src/                  # 前端代码（原生 ES Module，浏览器直接执行）
├── scripts/ tests/ docs/ # 本地工具与文档（不需要公开，可不上传）
├── README.md
├── DEPLOY_HANDOFF.md     # 本文件
└── IMPLEMENTATION_STATUS.md
```

### 1.2 环境要求

- 只要平台能托管静态文件即可。**不需要** Node、数据库、对象存储、容器镜像。
- 浏览器要求：Chrome / Edge / Safari / Firefox 近两年版本（使用 ES2022 语法、CSS Grid、`:has` 未使用）。
- 本地验收需要 Node ≥ 20 + 一个现代浏览器（Chrome 无头模式即可）。

### 1.3 路径提醒（Windows）

项目路径含中文（`共页v2`）。部分 CLI 工具在 Windows 上会因编码问题打不开中文目录。**上传前先把 `app/` 复制到一个纯 ASCII 路径**再操作，例如：

```powershell
Copy-Item -Recurse -Force "C:\Users\33494\Desktop\共页v2\gongye-v2\app" "C:\deploy\gongye"
```

后续所有命令都在 `C:\deploy\gongye` 下执行。

---

## 2. 部署形态与约束

1. **纯静态**：浏览器直接请求 HTML/CSS/JS/PDF/SVG。没有 API、没有 Cookie 会话、没有服务端渲染。
2. **零构建**：源文件就是产物。不要引入 Webpack/Vite/TypeScript 编译步骤，否则需要额外维护产物目录。
3. **演示数据**：所有内容打在前端 `src/data/seed.js`，用户改动存 `localStorage`。换浏览器/清缓存即还原。
4. **不要把它当生产社区**：登录、权限、页签账务、文件访问控制都在浏览器里模拟。真实上线必须先接后端（见第 13 节）。如果需求方要求“直接开放给真实用户注册使用”，请暂停并回报，不要用演示站交付。
5. **多平台配置已就绪**：`_redirects`、`netlify.toml`、`vercel.json`、`nginx.conf.example` 四选一即可，互不冲突（各平台只读自己的）。

---

## 3. 部署前必须在本地通过的验收

在 `C:\deploy\gongye`（或原路径）下执行：

```powershell
# 1) 静态自检：模块导入、路由实现、本地资源引用
node scripts/check.mjs
# 期望输出：自检通过：导入、路由与本地资源引用均可解析。

# 2) 业务与渲染测试（22 项）
npm test
# 期望：15 + 4 + 3 全过，最后 "fail 0"

# 3) 起本地服务
node scripts/serve.mjs
# 期望：共页静态预览：http://127.0.0.1:4173/
```

另开一个终端做浏览器验收（Chrome 已安装）：

```powershell
# 起带调试端口的无头 Chrome（保持运行）
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --headless=new --no-sandbox --remote-debugging-port=9222 `
  --user-data-dir="$env:TEMP\gongye-qa" about:blank

# 在另一个终端：
node scripts/qa.mjs        # 期望：无控制台异常、无页面错误、无横向溢出
node scripts/qa-flow.mjs   # 期望：15/15 项通过
```

三项都通过后再继续。任何一项失败都先修，不要带病上线。

---

## 4. 整理上传包

### 4.1 方式 A：整目录上传（最省事）

直接把 `app/` 的全部内容作为站点根目录。`docs/`、`scripts/`、`tests/` 会被一起发布，虽然不影响功能，但会把内部脚本和截图暴露出去。

### 4.2 方式 B：只上传运行所需（推荐公开站点）

```powershell
$src = "C:\deploy\gongye"
$out = "C:\deploy\release"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null

Copy-Item "$src\index.html","$src\404.html","$src\robots.txt","$src\.nojekyll" $out -Force
Copy-Item "$src\_redirects","$src\netlify.toml","$src\vercel.json" $out -Force
Copy-Item -Recurse -Force "$src\assets" $out
Copy-Item -Recurse -Force "$src\src" $out
```

`C:\deploy\release` 就是发布目录。第 5 节各平台都把它的内容当作站点根目录。

### 4.3 上传前自检

```powershell
Test-Path "C:\deploy\release\index.html"                 # True
Test-Path "C:\deploy\release\src\main.js"                # True
Test-Path "C:\deploy\release\assets\samples\demo-calculus-notes.pdf"  # True
(Get-ChildItem "C:\deploy\release" -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
# 约 2–4 MB（不含 docs/screenshots 时更小）
```

---

## 5. 五个平台的逐步部署

> 五个平台任选其一。配置文件名不要改、不要删；平台会自动读取。

### 5.1 Cloudflare Pages（推荐）

1. 登录 Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**（直传，不接 Git）。
2. 项目名：`gongye`（决定默认域名 `gongye.pages.dev`）。
3. 把 `C:\deploy\release` 里的**内容**（不是这个文件夹本身）拖进上传区，Deploy。
   也可以用 Wrangler：
   ```powershell
   npx wrangler pages deploy "C:\deploy\release" --project-name gongye
   ```
4. SPA 回退：`_redirects` 已随包上传（内容为 `/* /index.html 200`），无需额外操作。可在 **Deployments → Functions/Routing** 确认。
5. 自定义域：**Custom domains** → 添加 `gongye.example.com` → 按提示在 DNS 加 CNAME 到 `gongye.pages.dev`。HTTPS 由平台自动签发（通常 1–5 分钟）。
6. 缓存与安全头：`_headers` 文件本项目未提供；如需 CSP 等头，在 **Headers** 规则里按第 8 节配置，或改用 Netlify/Vercel（它们的配置文件已内置）。

**验收重点**：`https://gongye.pages.dev/resources/r_calc_notes` 应返回 200 并打开资料页（说明回退生效）。

### 5.2 Vercel

1. 把 `C:\deploy\release` 初始化为一个 Git 仓库并推到 GitHub/GitLab，或使用 `vercel` CLI 直传。
2. Vercel → **Add New… → Project** → 导入仓库。
3. 关键设置：
   - **Framework Preset**：`Other`
   - **Build Command**：留空（或 `echo "static"`）
   - **Output Directory**：`.`（仓库根就是产物）
   - **Install Command**：留空（没有依赖）
4. 部署。`vercel.json` 已包含：`/:path*` → `/index.html` 重写、安全头、`/assets` 缓存 7 天、`/src` 不缓存。
5. **Domains** → 添加域名 → 按提示配置 DNS。HTTPS 自动。
6. CLI 直传（可选）：
   ```powershell
   npx vercel deploy --prod "C:\deploy\release"
   ```

**注意**：Vercel 对根目录 `vercel.json` 生效；若你把站点放在子目录（如 `app/`），要在 Vercel 项目设置里把 Root Directory 指到该目录，或把 `vercel.json` 一起放到该目录。

### 5.3 Netlify

1. Netlify → **Add new site → Deploy manually**，把 `C:\deploy\release` 拖入。
2. `netlify.toml` 已在包内：`publish = "."`、`/* → /index.html 200`、安全头、缓存头。
3. 或者 CLI：
   ```powershell
   npx netlify-cli deploy --prod --dir "C:\deploy\release"
   ```
4. **Domain settings** → 添加自定义域，HTTPS 自动（Let's Encrypt）。
5. 如需强制 HTTPS，在 **Domain management → HTTPS** 打开 “Force HTTPS”。

### 5.4 自有服务器（Nginx + HTTPS）

适用于“已经有一台 Linux 服务器和一个域名”。

1. 上传（在本地执行，把 `USER@HOST` 换成实际值）：
   ```powershell
   ssh USER@HOST "mkdir -p /var/www/gongye"
   scp -r "C:\deploy\release\*" USER@HOST:/var/www/gongye/
   ```
   Windows 没有 `scp` 时，用 WinSCP / FileZilla 上传，或先用 `Compress-Archive` 打包再在服务器上解压。
2. 配置站点：
   ```bash
   sudo cp nginx.conf.example /etc/nginx/sites-available/gongye
   sudo ln -sf /etc/nginx/sites-available/gongye /etc/nginx/sites-enabled/gongye
   # 把 server_name 改成你的域名
   sudo nano /etc/nginx/sites-available/gongye
   sudo nginx -t && sudo systemctl reload nginx
   ```
   示例配置已包含：SPA 回退 `try_files $uri $uri/ /index.html`、安全头、gzip、`/assets` 7 天缓存、`/src` 不缓存、屏蔽 `/docs/` `/scripts/` `/tests/`。
3. HTTPS：
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d gongye.example.com
   sudo certbot renew --dry-run   # 验证自动续期
   ```
4. 权限：`sudo chown -R www-data:www-data /var/www/gongye && sudo chmod -R 755 /var/www/gongye`
5. 确认 MIME：Nginx 默认 `mime.types` 已含 `image/svg+xml`、`application/pdf`；如果 404/下载异常，检查 `/etc/nginx/nginx.conf` 是否 `include mime.types;`。

**发版脚本（幂等、可回滚）**：

```bash
# 服务器上保留两份：current 软链 + 上一版目录
cd /var/www
mv gongye gongye-prev.$(date +%Y%m%d%H%M) 2>/dev/null || true
# 上传新版本到 /var/www/gongye，然后
chown -R www-data:www-data /var/www/gongye
sudo nginx -t && sudo systemctl reload nginx
```

**回滚**：把 `gongye` 改名为 `gongye-bad`，把上一版目录改回 `gongye`，reload nginx。

### 5.5 GitHub Pages（可选）

适用于“想用仓库托管、免费公开访问”。项目使用 hash 路由，不需要额外重写。

1. 把 `C:\deploy\release` 推到仓库的 `main` 分支（或 `gh-pages` 分支）。
2. 仓库 Settings → Pages → Source: `Deploy from a branch` → 分支 `main`、目录 `/ (root)`。
3. 包内 `.nojekyll` 已确保下划线文件不被 Jekyll 忽略。
4. 如果是项目站点（`https://user.github.io/gongye/`），**必须**修正站点根路径：
   - 打开 `index.html`，把 `<script src="src/config.js">`、`<link rel="stylesheet" href="assets/...">`、`<script type="module" src="src/main.js">` 改成**相对路径**（去掉开头的 `/`）；
   - 打开 `src/config.js`，把 `basePath` 改成 `/gongye/`；
   - 本项目默认使用相对路径引用资源，通常无需修改，但请实际打开页面确认。
5. 自定义域：Settings → Pages → Custom domain，并在 DNS 配置 CNAME。

---

## 6. 路由与重写规则（为什么需要）

- 站内导航使用 hash：`https://站点/#/resources/r_calc_notes`。**任何静态托管都能直接工作**，不需要服务端配置。
- 同时兼容干净链接：`https://站点/resources/r_calc_notes`。首次加载时 `src/router.js` 会读取 `location.pathname`，随后统一成 hash 形式。
  这需要托管平台对“不存在的路径”返回 `index.html`：
  - Cloudflare Pages / Netlify：`_redirects`（`/* /index.html 200`）
  - Vercel：`vercel.json` 的 `rewrites`
  - Nginx：`try_files $uri $uri/ /index.html`
  - GitHub Pages：不支持回退，**只能用 hash 链接**（`/#/resources/r_xxx`），这是可接受的。
- 如果平台既不支持回退，也不想改配置，请在所有对外分享的场景使用 `/#/...` 链接即可，功能不受影响。

---

## 7. 运行时配置（`src/config.js`）

部署后可以直接在服务器上编辑这个文件并刷新页面，**不需要重新构建**：

以下示例仅用于静态演示版。若线上静态前端连接了独立后端，托管平台可能覆盖或替换此文件；修改前先确认目标环境，避免误把线上站点切回本地演示。

```js
window.__GONGYE_CONFIG__ = {
  mode: 'demo-static',              // 保持 demo-static
  apiBase: '',                      // 预留：接入真实后端时填 API 地址
  storageKey: 'gongye-demo-v1',     // localStorage 键名；改这里等于换一套独立演示数据
  basePath: '/',                    // 部署到子目录时改成 '/子目录/'
  demoNotice: '静态演示版：内容与账号均为演示数据，数据保存在本机浏览器，不会上传服务器。'
};
```

- 把这个文件暴露在公网是安全的：它**不能**包含任何密钥。
- `demoNotice` 会显示在页面顶部提示条，可按需求方要求调整措辞。
- 若改 `basePath`，同时确认 `index.html` 里的资源引用是相对路径（默认就是相对路径）。

---

## 8. 缓存与安全响应头

推荐值（`netlify.toml`、`vercel.json`、`nginx.conf.example` 已内置）：

```
Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

- 页面没有内联 `<script>`，所以 `script-src 'self'` 可用；样式用了内联 `style=""` 属性，因此 `style-src` 必须保留 `'unsafe-inline'`。
- 图片包含用户选择的本机图片（`data:` URL），所以 `img-src` 保留 `data:`。
- 缓存建议：
  - `index.html`：`no-cache`（发版立即生效）
  - `/src/*`、`/assets/css/*`：`no-cache` 或 5 分钟
  - `/assets/art/*`、`/assets/previews/*`：7 天
  - `/assets/samples/*.pdf`：1 天
- 如果平台不支持自定义头，优先保证站点可访问；安全头作为后续优化项记录在交付记录里，不要静默跳过不记录。

---

## 9. 域名与 HTTPS

1. DNS：
   - 根域（`example.com`）用 A 记录指向平台 IP（或平台要求的 CNAME 扁平化）；
   - 子域（`gongye.example.com`）用 CNAME 指向平台提供的域名。
2. 证书：Cloudflare/Vercel/Netlify 自动签发；自有服务器用 `certbot --nginx`。
3. 强制 HTTPS：平台默认即 HTTPS；自有服务器保留 80 → 443 的 301。
4. HSTS：**确认 HTTPS 正常后再开**，避免把自己锁死：
   `Strict-Transport-Security: max-age=31536000; includeSubDomains`
5. 检查混合内容：本项目没有外链字体/CDN，正常不会有 `http://` 资源。

---

## 10. 上线验收清单（逐条打勾）

把 `https://你的域名` 记为 `$SITE`。

### 10.1 资源可达与 MIME

```powershell
$SITE = "https://gongye.example.com"

(Invoke-WebRequest "$SITE/" -UseBasicParsing).StatusCode                      # 200
(Invoke-WebRequest "$SITE/src/main.js" -UseBasicParsing).Headers['Content-Type']     # text/javascript
(Invoke-WebRequest "$SITE/assets/css/app.css" -UseBasicParsing).Headers['Content-Type'] # text/css
(Invoke-WebRequest "$SITE/assets/art/logo-wordmark.svg" -UseBasicParsing).Headers['Content-Type'] # image/svg+xml
(Invoke-WebRequest "$SITE/assets/samples/demo-calculus-notes.pdf" -UseBasicParsing).StatusCode # 200
(Invoke-WebRequest "$SITE/resources/r_calc_notes" -UseBasicParsing).StatusCode  # 200（回退生效）
```

- [ ] 首页 200，且标题为「找资料 · 共页」
- [ ] `/src/main.js` 的 Content-Type 是 `text/javascript`（不是 `text/plain`，否则浏览器拒绝执行）
- [ ] SVG 是 `image/svg+xml`；PDF 是 `application/pdf`
- [ ] `/resources/r_calc_notes` 返回 200（若平台不支持回退，记录并改用 `/#/resources/r_calc_notes`）

### 10.2 页面与交互

- [ ] `/#/` 找资料首页：搜索框、课程快筛、资料卡、右侧说明
- [ ] `/#/resources?q=数列极限` 有结果；筛选项可组合；清空后回到全部
- [ ] `/#/resources/r_calc_notes`：适用范围、未覆盖、真实文件、前两页预览、资料讨论
- [ ] `/#/circles` 游客态：提示登录 + 「找我的教学班」入口
- [ ] `/#/find-circles`：可搜索教学班；加入需要登录
- [ ] `/#/login`：一键演示账号（清禾）可登录；验证码流程填 `123456` 也能登录
- [ ] 登录后 `/#/me/wallet`：点「领取今日页签」余额 +1；刷新后仍为 +1（说明本地持久化）
- [ ] 任意帖子点「送页签」：弹层显示当前余额、送出后余额，确认后余额 -1
- [ ] `/#/publish` 发帖成功并进入详情；返回列表能看到
- [ ] 管理员账号（站点维护）`/#/admin`：举报可处理，审计记录增加
- [ ] 浏览器控制台无红色报错；页面无「页面脚本出错」提示条

### 10.3 响应式与可访问性

- [ ] 1440px：三栏布局，内容居中，无横向滚动条
- [ ] 1024px：隐藏右栏，左栏收窄，无横向滚动
- [ ] 768px：单栏 + 左栏变成顶部横向筛选
- [ ] 390px：底部导航 5 项（找资料/课友圈/发布/消息/我的），无横向滚动
- [ ] 键盘 Tab 能到达主要按钮，焦点框可见
- [ ] 页面文字对比可读（墨绿主色 `#285E4B`，正文 `#202A25`）

### 10.4 运维项

- [ ] 记录发布版本号、发布时间、发布人、域名
- [ ] 记录回滚方式（平台 rollback 或上一版目录名）
- [ ] 记录缓存与安全头是否生效（截图或 `curl -I` 输出）
- [ ] 记录已知边界：这是演示站，数据存浏览器本地（见第 13 节）

---

## 11. 回滚

| 平台 | 回滚方式 |
| --- | --- |
| Cloudflare Pages | Deployments → 选上一个成功部署 → **Rollback to this deployment** |
| Vercel | Deployments → 上一个 Production → **Promote to Production** |
| Netlify | Deploys → 选上一个 → **Publish deploy** |
| 自有 Nginx | 保留上一版目录（如 `/var/www/gongye-20261026`），改软链或改名后 `nginx -t && systemctl reload nginx` |
| GitHub Pages | Settings → Pages → 切换到上一个 commit 的分支/目录，或 `git revert` 后推送 |

回滚后按第 10 节再验一次首页与一个资料详情页即可。

---

## 12. 环境变量与密钥

**当前版本不需要任何环境变量或密钥。** `src/config.js` 是公开文件，禁止写入任何私密信息。

未来接入真实后端时，密钥只放在后端环境（示例命名，供需求方与后端同学对齐）：

```
DATABASE_URL=
SESSION_SECRET=
APP_ORIGIN=
API_ORIGIN=
MAIL_PROVIDER=
MAIL_API_KEY=
MAIL_FROM=
STORAGE_ENDPOINT=
STORAGE_BUCKET=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
SCAN_SERVICE_URL=
```

前端只允许出现可公开的值（如 `apiBase`），不要把任何 `*_KEY` / `*_SECRET` 写进 `VITE_` 或 `config.js`。

---

## 13. 静态演示与真实业务的边界（必须如实转达）

这个站点**可以**用来：内部演示、评审产品方向、给同学看交互与视觉、收集反馈、做小范围体验。

这个站点**不能**用来：真实注册、真实上传资料、真实下载受控文件、真实页签账务、真实内容审核。原因：

1. 登录态与权限在前端判断，改几行脚本即可绕过。
2. 页签余额、领取、赠送、退款写在 `localStorage`，没有事务与幂等保障。
3. 附件是包内示例 PDF，没有上传、扫描、真实 MIME 校验、短时签名下载。
4. 数据只在当前浏览器；换设备就没了，也没有备份与审计。
5. 没有邮件、通知、限流、风控与速率限制。

**如果需求方要求“正式上线、让真实用户注册并上传资料”**，需要先做后端（建议顺序）：

1. 认证：邮箱验证码、HttpOnly Cookie 会话、CSRF/CORS 策略、限流。
2. 数据库：PostgreSQL（或云数据库），迁移脚本，用户/课程/圈/帖子/资料/评论/页签流水/通知/举报/审计。
3. 存储：S3 兼容私有桶、随机对象键、上传签名、真实 MIME 与大小校验、扫描服务、PDF 前两页转图。
4. 事务与后台任务：页签领取/赠送/退款的原子事务与幂等键、outbox 事件、通知与退款任务。
5. 检索：服务端筛选、相关性、稳定游标分页；中文分词需要真实验证。
6. 然后把前端 `src/state/*` 替换成调用 API 的适配层（接口清单见 `IMPLEMENTATION_STATUS.md` 第 4 节）。

`mode: 'production'` 与 `apiBase` 是为此预留的配置位，当前代码仍走本地演示仓库。

---

## 14. 常见故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 打开是「正在载入界面」不动 | 通过 `file://` 直接打开了 `index.html`，ES Module 被跨域拦截 | 必须用 HTTP 访问；用平台域名或 `node scripts/serve.mjs` |
| 白屏 + 控制台 `Failed to load module script` | JS 的 Content-Type 不是 `text/javascript`（常见于某些对象存储/静态服务器） | 配置 MIME 映射；Nginx 确认 `include mime.types` |
| 图标/头像全部空白 | SVG 的 Content-Type 不是 `image/svg+xml` | 同上，补 MIME |
| 直接分享 `/resources/r_xxx` 打开 404 | 平台没有配置 SPA 回退 | 加 `_redirects` / `vercel.json` / `try_files`；或统一分享 `/#/resources/r_xxx` |
| 发布后还是旧版本 | 缓存了 `index.html` | 把 `index.html` 设为 `no-cache`，强刷 CDN 缓存 |
| 刷新后登录/改动消失 | 换浏览器/清缓存/无痕模式，`localStorage` 被清 | 属预期；这是演示数据 |
| 手机能打开但底部导航被挡住 | 安全区适配缺失 | 检查 `viewport-fit=cover` 与 `env(safe-area-inset-bottom)`（已在样式内） |
| `npm test` 报 `spawn EPERM` | 受限沙箱禁止子进程 | 在普通终端里跑；或分别执行 `node tests/logic.test.mjs` 等三个文件 |
| 截图脚本连不上 9222 | Chrome 没带 `--remote-debugging-port` 或已退出 | 重新按第 3 节启动 |

---

## 15. 历史静态演示交付记录（不代表当前线上配置）

以下记录对应 2026-10-26 的静态演示发布。当前线上站点可能已经切换到后端试用模式；以实时页面提示和 `/api/health` 核对，不要据此认为线上仍是浏览器本地模式。

```
站点域名：https://gongye.app.workbuddy.host/?sharecode=BJKQFJVWTT
托管平台：WorkBuddy 静态托管（sandbox c9a70c9767da447eb6788e27038e2440）
发布目录：C:\Users\33494\deploy\gongye（由 app/ 剔除非运行文件后打包，66 个文件 / 0.35 MB）
发布版本：共页 v2.2 静态演示版
发布时间：2026-10-26 13:5x（GMT+8）
发布人：WorkBuddy
本地验收：scripts/check.mjs 通过 / npm test 前 22 项通过（logic 15 + render 4 + boot 3）
          pilot 后端 8 项未跑（本平台只跑纯静态，server/ 未上传）
线上验收：第 10.1 节通过；10.2/10.3 由本地测试覆盖
缓存与安全头：未配置（平台不提供自定义响应头；非阻断项，记录在此）
回滚点：平台「设置—数据管理—应用」中重新发布或下线该应用
已知边界：演示数据保存在浏览器本地；无真实账号、上传、扫描与页签事务
平台差异：
  1) 不支持「未知路径回退 index.html」，/resources/r_xxx 这类干净链接返回 404，
     对外分享统一用 /#/resources/r_xxx（第 6 节已说明这是可接受方案）
  2) 访问受分享跳转授权：直接 curl 无 UA 会 403，浏览器正常打开
后续待办：
  1) 需求方确认是否需要接真实后端（第 13 节）
  2) 如需收录搜索引擎，再评估预渲染/SSR 与 sitemap
```

---

## 附：最短可用命令（复制即用）

```powershell
# 1. 准备
Copy-Item -Recurse -Force "C:\Users\33494\Desktop\共页v2\gongye-v2\app" "C:\deploy\gongye"
cd C:\deploy\gongye

# 2. 验收
node scripts/check.mjs
npm test
node scripts/serve.mjs        # 保持运行，另开终端做浏览器验收

# 3. 打包发布目录
#    见 4.2 节的 PowerShell 片段（只保留运行所需文件）

# 4. 选择平台
#    Cloudflare Pages: npx wrangler pages deploy "C:\deploy\release" --project-name gongye
#    Vercel:           npx vercel deploy --prod "C:\deploy\release"
#    Netlify:          npx netlify-cli deploy --prod --dir "C:\deploy\release"
#    Nginx:            scp -r "C:\deploy\release\*" USER@HOST:/var/www/gongye/

# 5. 线上验收：按第 10 节逐条检查，填写第 15 节记录
```

