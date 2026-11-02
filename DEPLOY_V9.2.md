# 共页 v9.2 部署说明（静态站）

版本：9.2.0　构建日期：2026-10-29　部署形态：纯静态（无构建、无运行时依赖）

本文件是 v9.2 的唯一部署入口。`DEPLOY_V9.1.md` 及更早版本仅作历史记录，不要再照着部署。

---

## 1. 这一版包含什么

| 类别 | 内容 | 位置 |
| --- | --- | --- |
| 课程圈规则 | **一门课程只有一个共用课友圈**，不再区分教学班、教师与学期 | `src/state/actions.js`、`src/state/selectors.js` |
| 圈子数据 | 圈对象去掉 `term / section / teacher`；每门课程各一个圈（「通用学习」除外） | `src/data/seed.js` |
| 合并历史圈 | `ci_calc_b`、`ci_calc_old` 的帖子与成员并入 `ci_calc_a`，成员按 `(用户, 圈)` 去重 | `src/data/seed.js` |
| 页面文案 | 找课、圈子、课程、资料详情、帖子标签、邀请、账号、后台统一称「课程圈」 | `src/pages/*`、`src/components/ui.js` |
| 表单简化 | 找课去掉学期/教学班筛选；建圈申请只填课程 + 说明；后台建圈只选课程 | `src/pages/circles.js`、`src/pages/misc.js`、`src/main.js` |
| 9.1 内容 | 102 张逐日插画 + 4 张 neutral（106 WebP）、22 个页页表情、2371 门课程名、课程 Tag 必填规则 | `assets/`、`src/data/` |

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
- 任何 `.env`、旧版本 ZIP（如 v9.1 美术包）。

上传前自检：

```bash
node scripts/check.mjs
```

应输出「自检通过：导入、路由与本地资源引用均可解析」。

---

## 3. 缓存与 MIME（关键）

逐日插画与表情文件数量多、体积大，缓存策略必须区分 HTML 与静态资源：

- `index.html`、`404.html`：`Cache-Control: no-cache`（保证每次拿到新版本入口）；
- `src/*.js`、`assets/css/*.css`：`max-age=0, must-revalidate` 或短缓存（本版无文件名指纹，靠 revalidate 更新）；
- `assets/daily/`、`assets/stickers/`、`assets/art/`、`assets/brand/`：`max-age=31536000, immutable`（路径带日期/版本，内容不变）。

MIME 至少确保：

```
.webp  image/webp
.js    text/javascript
.mjs   text/javascript
.css   text/css
.json  application/json
```

`_redirects` / `netlify.toml` / `vercel.json` 已包含 SPA 回退（任意路径回 `index.html`），不要删除。

---

## 4. 本地验证

```bash
node scripts/check.mjs
npm test
node scripts/serve.mjs
# 打开 http://127.0.0.1:4173/
```

预期：

- `check.mjs`：23 条路由、31 个模块、36 个素材引用全部可解析；
- `npm test`：58 项全过（logic 39 + render 5 + boot 3 + pilot 11）；
- 手动核对：`#/find-circles` 只按课程搜索；进入任一课程圈，页头不出现「教学班 / 教师」；资料详情页的课程圈入口可正常跳转。

---

## 5. 数据与兼容说明

- 本版 `STORE_VERSION` 由 7 升到 8，`seedVersion` 5 → 6：浏览器里旧的本地演示数据会在首次打开时**重建**（演示账号、帖子、成员关系、页签领取记录）。
- 重建后每门课程只有一个圈；原「教学班 A/B」「2025秋」旧圈的内容合并进课程圈，不会丢帖子。
- 真实用户数据不在本机存储，不受影响；若已接入试用后端，需按第 6 节迁移。
- 9.1 的课程 Tag 必填规则继续生效（只作用于新发布资料）。

---

## 6. 试用后端（可选）

静态站默认 `mode: 'demo-static'`，不依赖 `server/`。若切 `production` 模式：

1. 旧库里 `circles` 表若含 `term / section / teacher`，先按 `course_id` 合并重复圈，并把 `posts.circle_id`、`memberships.circle_id` 指向保留的圈；
2. 同一课程保留一条圈记录（建议保留创建最早或内容最多的那条），删除其余；
3. `memberships` 按 `(user_id, circle_id)` 去重；
4. 迁移后跑一次 `node scripts/check.mjs` 与 `npm test`。

---

## 7. 回滚

1. 静态站回滚：重新上传 v9.1 发布目录（或恢复上一版托管部署），入口 HTML 的 no-cache 会让访客立即拿到旧版。
2. 只回滚代码：恢复 `src/data/seed.js`、`src/state/actions.js`、`src/state/selectors.js`、`src/pages/circles.js`、`src/pages/misc.js`、`src/pages/resources.js`、`src/pages/posts.js`、`src/pages/account.js`、`src/components/ui.js`、`src/main.js`，并把 `STORE_VERSION` 改回 7。
3. 回滚会恢复分教学班的圈；访客本地数据会因版本号变化再次重建。

---

## 8. 发布记录

**版本** `9.2.0` ｜ **演示数据** `STORE_VERSION = 8` ｜ **线上地址** <https://gongye.app.workbuddy.host/?sharecode=BJKQFJVWTT>（沿用同一 appId，链接未变）

### 9.2 本地核对（2026-10-29）

```
node scripts/check.mjs → 自检通过（23 路由 / 31 模块 / 36 素材）
npm test → 58/58（logic 39 + render 5 + boot 3 + pilot 11）
数据核对 → 2376 门课程、2375 个圈、courseId 无重复、圈无 term/section/teacher
```

### 发布包

- 目录：`release/gongye-v9.2/`
- ZIP：`release/gongye-v9.2-static.zip`
- 内容：`index.html`、`404.html`、`_redirects`、`robots.txt`、`.nojekyll`、`src/`、`assets/`（含 106 张逐日插画与 22 个表情）

浏览器视觉验收（360/390/430 三档、`qa.mjs` / `qa-flow.mjs`）未在本机执行：沙箱内 Chrome 无调试端口。上线前建议在本地补跑一次，重点看找课页表单、课程圈页头、后台建圈表单。

---

## 9. 上线交付记录（2026-10-29 部署）

### 9.1 本地核对

```text
node scripts/check.mjs  → 素材 36 个；模块 31 个；路由 23 个；自检通过
node --test tests/*.mjs → 58/58（logic 39 + render 5 + boot 3 + pilot 11）
                          含 9.2 新增「课程圈：一门课一个圈，不再有教学班、教师与学期字段」
数据核对                → STORE_VERSION = 8，seedVersion = 6，seed.js 无 section / teacher 字段
```

### 9.2 发布包

```text
目录    C:\Users\33494\deploy\gongye-v92
文件    284 个 / 16.37 MB（与 9.1 同量级：daily webp 106、stickers vol2 10 + vol3 8、motifs 17）
未打包  package.json / tests / scripts / docs / server / *.md / *.map（0 泄漏）
```

### 9.3 线上浏览器验收

| 项 | 结果 | 实测 |
| --- | --- | --- |
| 找课页表单简化 | ✅ | `form[data-form="find-circles"]` 字段只剩 `school / q / courseId`；`term`、`section` 均不存在；标题「找到你的课程圈」；导语「9.2 起一门课只有一个共用圈，不再分教学班、教师或学期。」 |
| 找课卡片文案 | ✅ | 「微积分Ⅰ / 示例大学 · 0 位成员 · 全课程共用一个圈」，无「教学班待补充」「教师未填写」 |
| 课程圈计数 | ✅ | `q=学` → 结果按页返回，21 张卡全部无教学班残留 |
| 课程圈页头 | ✅ | 进入 `#/circles/ci_calc_a`：「微积分Ⅰ · 示例大学 · 全课程共用一个圈 · 6 位成员」；「关于这个圈」为 课程 / 范围 / 成员 三行，没有学期、教学班、教师字段 |
| 资料详情入口 | ✅ | `#/resources/r_calc_notes` → 「微积分Ⅰ · 课友圈」与「已加入 · 进入课友圈」两条，均指向 `#/circles/ci_calc_a`，点击可跳转 |
| 建圈申请表单 | ✅ | 找课页底部 `form[data-form="application"]`：只有 `courseId`（60 门候选）+ `reason`（选填说明），标题「没有找到课程？提交建圈申请」 |
| 后台建圈表单 | ✅ | `form[data-form="admin-circle"]` 只有 `courseId` 一个字段；圈子表首行「微积分Ⅰ · 课友圈 / 6 位成员 / 微积分Ⅰ / 进行中 / 归档为只读」，全表无「教学班」 |
| 9.1 回归 | ✅ | 首页页签仍为 `assets/daily/webp/2026-10-29.webp`（640×640，深秋·相逢），余额正常；控制台 `4xx = 0`、异常 = 0 |

### 9.4 验收时需注意的三点

1. **「教学班」「教师」并非全部消失**：课程圈页里仍会出现「不分教学班与教师」这句解释文案（共 3 处，都在 9.2 迁移说明里）。判验收应看**页头字段与筛选器**，不要全文搜关键词。
2. **资料仍显示「2026秋」**：那是资料自身的 `term` 字段（第 5 节已声明「学期写在帖子和资料里」），不是圈的字段，属预期。
3. **建圈申请不在 `#/circles`**：它在 `#/find-circles` 页面底部，`#/circles` 只有「我加入的圈」。找错页面会误以为表单被删。

### 9.5 上线注意

- `STORE_VERSION` 7 → 8、`seedVersion` 5 → 6：访客首次打开会**重建本机演示数据**；原「教学班 A/B」「2025秋」旧圈的帖子与成员会并入课程圈，不会丢帖。
- 平台不回 `Cache-Control`；`src/*.js` 无文件名指纹，升级后请让访客 **Ctrl + F5**。
- 体积仍为 16.4 MB，无新增资源，首屏不受影响。