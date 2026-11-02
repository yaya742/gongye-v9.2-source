# 共页 v9.1 部署说明（静态站）

版本：9.1.0　构建日期：2026-10-29　部署形态：纯静态（无构建、无运行时依赖）

本文件是 v9.1 的唯一部署入口。旧的 DEPLOY_V8.md 及更早版本仅作历史记录，不要再照着部署。

---

## 1. 这一版包含什么

| 类别 | 内容 | 位置 |
| --- | --- | --- |
| 每日页签插画 | 102 天逐日插画 + 4 张文化日期 neutral 替代，共 106 个 WebP（约 10.9 MB） | `assets/daily/webp/` |
| 页页表情 | 第二弹 10 个 + 第三弹 8 个（webp + thumb），与第一弹 4 个共 22 个 | `assets/stickers/vol2|vol3/` |
| 9.1 规则 | 课程 Tag 必填（前端校验 + 动作层校验）、课程优先搜索、卡片配色层级、手机卡片密度 | `src/`、`assets/css/app.css` |

静态站直接读取 `src/config.js` 的 `window.__GONGYE_CONFIG__`，不需要打包环境。

---

## 2. 上传清单

必须上传（相对 `gongye-v2/app/`）：

```
index.html
404.html
_redirects
netlify.toml            # 仅 Netlify
vercel.json             # 仅 Vercel
robots.txt
.nojekyll
nginx.conf.example      # 仅供参考，不直接上传
src/
assets/
  css/  art/  brand/  avatars/  stickers/  mascot/
  motifs/  daily/webp/  previews/  samples/  covers/  badges/
```

**不要上传**：

- `server/`：仅内部试用后端，静态站不使用；
- `tests/`、`scripts/`、`docs/`：开发与截图工具，线上不需要；
- `node_modules/`、`server/data/`、填了真实邮箱的 `server/allowlist.txt`；
- 任何 `.env`、旧版本 ZIP（如 v6/v8 美术包）。

上传前自检：

```bash
node scripts/check.mjs
```

应输出「自检通过：导入、路由与本地资源引用均可解析」。

---

## 3. 缓存与 MIME（关键）

逐日插画与表情文件数量多、体积大，缓存策略必须区分 HTML 与静态资源：

| 路径 | 缓存 | 说明 |
| --- | --- | --- |
| `index.html` / `404.html` | `no-cache` | 用户刷新必须拿到新引用 |
| `src/*.js` | `no-cache` 或短缓存（≤5 分钟） | 没有哈希文件名，长缓存会锁死旧代码 |
| `assets/css/*.css` | 短缓存 + `ETag` | 同上 |
| `assets/daily/webp/*` | `public, max-age=31536000, immutable` | 文件名含日期，内容不会再变 |
| `assets/stickers/**` | `public, max-age=31536000, immutable` | 文件名含弹次与名字 |
| `assets/**` 其它 | `public, max-age=604800` | 一周 |

MIME 至少确认：`.webp → image/webp`、`.svg → image/svg+xml`、`.mjs/.js → text/javascript`、`.pdf → application/pdf`。若服务器把 `.webp` 回成 `application/octet-stream`，页签插画会显示为裂图。

Netlify：`netlify.toml` 与 `_redirects` 已包含 SPA 回退；Vercel：`vercel.json` 已包含 rewrites。nginx 参考 `nginx.conf.example` 的 `try_files $uri /index.html`。

---

## 4. 部署步骤（任选其一）

### 4.1 静态托管（Netlify / Vercel / Cloudflare Pages）

1. 把第 2 节清单里的文件放到站点根目录（`index.html` 与 `src/` 同级）。
2. 构建命令留空；发布目录填站点根目录。
3. 部署后打开首页，确认右上角「找资料 / 课友圈」与今日页签插画正常。
4. 若挂在子路径（如 `/gongye/`），同时修改：
   - `src/config.js` 的 `basePath: '/gongye/'`；
   - `index.html` 的 `<base href="/gongye/">`。

### 4.2 自建 nginx

```bash
rsync -av --delete \
  --exclude 'server' --exclude 'tests' --exclude 'scripts' --exclude 'docs' \
  ./gongye-v2/app/ /var/www/gongye/
```

```nginx
location / { try_files $uri $uri/ /index.html; }
location ~* \.(webp|png|svg|woff2)$ { expires 30d; add_header Cache-Control "public"; }
location = /index.html { add_header Cache-Control "no-cache"; }
```

改完 `nginx -t && nginx -s reload`。

### 4.3 本地快速验证

```bash
node scripts/serve.mjs
# 打开 http://127.0.0.1:4173/
```

只验证静态资源与页面，不需要 `npm install`，也没有构建步骤。

---

## 5. 数据与版本迁移（重要）

- 本版 `STORE_VERSION` 由 6 升到 7：浏览器里旧的本地演示数据会在首次打开时**重建**，包括演示账号、帖子、页签领取记录。
- 这是 demo-static 的既定行为；线上没有真实后端时，用户本机数据本来就不跨设备。若你已经在某台机器上积累了需要保留的演示数据，先在旧版本导出/截图，再升级。
- 9.1 的课程 Tag 必填只作用于**新发布**的资料；历史资料缺少课程仍可搜索、可阅读，作者在详情页可补选主课程。

---

## 6. 验收

按 `V9_ACCEPTANCE.md` 逐项勾选。最低限度：

1. 首页今日页签显示当日插画（不是母题占位图）；
2. 手机 390px 下资料卡：课程 Tag 在标题上方、标题与摘要各最多两行、无固定高度裁切；
3. 发布资料不选课程会停在表单并提示「请选择这份资料对应的课程。」；
4. 搜索「线代 复习清单」出现「已按课程「线性代数」优先匹配」，线性代数资料排在前面；
5. 找课页搜索「微积分」能出现课程圈并翻页；
6. 控制台无 404（尤其 `assets/daily/webp/*.webp` 与 `assets/stickers/vol2|vol3/*`）。

---

## 7. 回滚

1. 保留上一版（v8.0）的整站目录或 Git tag；
2. 回滚时整目录替换，不要只回滚 `src/` 而留下新的 `assets/daily/`（会多出 10.9 MB 无用文件）；
3. 若只回滚代码：把 `src/data/seed.js`、`src/state/selectors.js`、`src/pages/resources.js`、`src/pages/circles.js`、`src/pages/misc.js`、`src/main.js`、`assets/css/app.css` 恢复，并把 `STORE_VERSION` 改回 6；
4. 回滚后确认 404 页、登录、发布、搜索四条主链路仍可用。

---

## 8. 已知限制

- 沙箱内没有 Chrome 调试端口，本版**未执行** `scripts/qa.mjs` / `qa-flow.mjs` 的浏览器截图与交互验收；上线前请在本地按 `V9_ACCEPTANCE.md` 跑一遍 360/390/430 与桌面。
- 「2026秋冬」是占位学期名，秋冬细分与教学班信息后补；补数据时只增不改 id，避免已加入的圈失联。
- 资料下载仍是演示 PDF；真实上传、扫描、鉴权需接 `server/` 或自建后端（见 `BACKEND_PLAN.md`）。

---

## 9. 交付记录（2026-10-29 部署上线）

**版本** `9.1.0` ｜ **演示数据** `STORE_VERSION = 7` ｜ **线上地址** <https://gongye.app.workbuddy.host/?sharecode=BJKQFJVWTT>（沿用同一 appId，链接未变）

### 9.1 本地核对

```text
node scripts/check.mjs  → 素材 36 个；模块 31 个；路由 23 个；自检通过
node --test tests/*.mjs → 58/58（logic 39 + render 5 + boot 3 + pilot 11），9.1 新增 9 项全过
```

### 9.2 发布包

```text
目录    C:\Users\33494\deploy\gongye-v91
文件    284 个 / 16.37 MB
        assets/daily/webp        106 张逐日插画（含 4 张 -neutral：10-31 / 11-26 / 12-24 / 12-25）
        assets/stickers/vol2     10 张 + 10 缩略图
        assets/stickers/vol3     8 张 + 8 缩略图
        assets/motifs            17 张（v8 母题，作为 illustration_path 缺失时的兜底）
        src/                     含 daily-bookmarks.js（180 KB）
未打包  package.json / tests / scripts / docs / server / *.md / *.map（已核对 0 泄漏）
```

### 9.3 线上资源（MIME 已确认）

```text
/                                  200  1771 B  text/html
/assets/css/app.css                200 74602 B  text/css
/src/main.js                       200 58224 B  text/javascript
/src/config.js                     200   941 B  text/javascript
/src/data/daily-bookmarks.js       200 180272 B text/javascript
/assets/daily/webp/2026-10-29.webp 200 154024 B image/webp
/assets/daily/webp/2026-10-31-neutral.webp 200 56610 B image/webp
/assets/daily/webp/2027-02-05.webp 200 138830 B image/webp
```

### 9.4 验收（V9_ACCEPTANCE 浏览器项）

| 项 | 结果 | 实测 |
| --- | --- | --- |
| 首页当日插画（非母题占位） | ✅ | `2026-10-29`：`assets/daily/webp/2026-10-29.webp`，640×640 已加载；右栏与手机主栏两张卡同图；`data-bookmark-art` 命中，无 `assets/motifs/` 回退 |
| 当日文案 | ✅ | `2026.10.29 / 深秋·相逢 / 问渠那得清如许？为有源头活水来。/ 宋·朱熹` |
| 手机 390 资料卡 | ✅ | 子元素顺序 `res-tag-row → res-title → res-summary → res-foot`；卡高 169px 由内容撑开；`overflow: visible`；标题 16/22 两行、摘要 14/20 两行；内边距 14px；`scrollWidth = 390` 无横向滚动 |
| 课程 Tag 可点 | ✅ | 微积分Ⅰ → `#/courses/c_calc`；`#F3DDC8` 底 / `#713E2A` 字 / 26px 视觉高 + 44px 触控区 |
| 发布资料缺课程 | ✅ | 停在 `#/publish/resource` 不跳转，错误槽「请选择这份资料对应的课程。」可见，焦点落到 `resourceCourse`，表单内容保留 |
| 课程优先搜索 | ✅ | `#/resources?q=线代 复习清单`：提示「已按课程「线性代数」优先匹配，剩余关键词「复习清单」。」；2 条结果，首条「线代前三章…」Tag=线性代数，次条 Tag=微积分Ⅰ |
| 找课搜索 | ✅ | `#/find-circles?q=微积分` → 匹配到对应课友圈，卡片显示课程名 / 学校 / 学期 |
| 找课翻页 | ✅ | `q=学` → 匹配到 727 个课友圈，第 1/37 页；点下一页 → `#/find-circles?q=学&page=2`，条数变化、筛选词保留 |
| 表情弹层 | ✅ | 三组（第一弹/第二弹/第三弹）共 22 个，`max-height:420px`、`overflow-y:auto`、可滚动；选中后 `.sticker-preview` 出现、`input[name=stickerId]` 写入 `yeye.received.v1` |
| 控制台 | ✅ | 全流程 `Network` 4xx = 0、`Runtime.exceptionThrown` = 0、`Log.entryAdded(error)` = 0 |

### 9.5 与验收单不一致处（已核对，未改代码）

1. **课程 Tag 换行**：`V9_ACCEPTANCE` C 组写「Tag 不换行、不压标题」，实际 CSS `app.css` 里 `.res-course-tag` 是 `white-space: normal; overflow-wrap: anywhere;`——有意允许长课程名换行（如「AI赋能教育：交叉理论与实践应用」），靠 26px 视觉高 + 44px 触控区 + `flex-wrap` 保证不压标题。短课程名单行显示正常。
2. **课程优先搜索在哪个页面**：验收单说「搜索页」，实际课程优先匹配出现在**找资料**页 `#/resources?q=`；`#/search` 是帖子搜索（帖子/课程/用户三种范围），不显示该提示。
3. **文化日期 neutral 只做了数据层**：`culturalThemes:false` 时切 neutral 由 `logic.test.mjs` 覆盖；本日 10-29 不是文化日期，浏览器侧没有可见切换点（`src/config.js` 里写死 `culturalThemes: true`），要验需改配置重启。

### 9.6 上线注意

- `STORE_VERSION` 6 → 7：访客首次打开会**重建本机演示数据**（账号、帖子、页签领取记录），已在文档第 5 节声明；真实用户数据不在本机就不受影响。
- 平台不回 `Cache-Control`：`assets/daily/webp`、`assets/stickers` 建议长缓存但我们无法设置，换版本后仍让访客 **Ctrl + F5**。
- 体积从 4 MB 涨到 16.4 MB，首屏不受影响（插画 `loading="lazy"` + `decoding="async"`），但弱网下页签插画会稍慢出现。