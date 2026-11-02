# 第六次更新验收（v6.0.0）

日期：2026-10-26 · 版本：`6.0.0`
主题：选项卡卡片化 + 同页切换卡片展开动画。

---

## 1. 做了什么

| 项 | 处理 |
| --- | --- |
| 选项卡容器 | `.tabs` 改为独立卡片：白底、1px 暖边框、14px 圆角、轻阴影、4px 内边距 |
| 选项卡 | 每个 `.tab` 变圆角按钮；选中项用浅桃底 + 内描边，不再用下划线 |
| 同页切换 | 只改 query（`?tab=`、筛选、排序）时不再瞬移：内容卡片以 `gy-card-open`（220ms，轻微上移 + 缩放 + 透明度）入场 |
| 路由 | `applyRouteChange` 区分「路径变化」与「仅 query 变化」；仅 query 变化走卡片入场，不触发 View Transition |
| 降动态 | `prefers-reduced-motion` 下取消位移与缩放 |
| 覆盖范围 | 管理后台 tabs、消息 tabs、课友圈模式/圈内 tabs、搜索 tabs、资料类型/筛选 chips、排序等所有 query 切换 |

---

## 2. 实测

```text
npm test                 → 45/45（业务 27 + 渲染 4 + 启动 3 + 试用后端 11）
qa-flow                  → 15/15
qa                       → 30 张截图，无控制台异常、无横向溢出
```

浏览器断言（管理后台 tab）：

```text
点击「内容」后：location.hash = #/admin?tab=content
document.getElementById('view').dataset.enter = "tab"
main > .card 的 animation-name = gy-card-open
routeTransitions 不增加（同页切换不走 VT）
```

---

## 3. 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/main.js` | 记录 query 键；仅 query 变化时 `render({ animate: 'tab' })`；渲染后打 `data-enter="tab"` 并在 260ms 后清除 |
| `assets/css/app.css` | `.tabs` / `.tab` 卡片化样式；`gy-card-open` 动画；reduce 降级 |
| `V6_ACCEPTANCE.md`、`DEPLOY_V6.md` | 本次记录与部署说明 |

### 部署时补充（WorkBuddy，2026-10-26）

原文的入场选择器只覆盖 `main > .card / .post-card / .res-card`。但「我的 → 消息」「我的成长」等页面结构是 `.layout-1 > .card`（`#view` 本身就是 `<main class="view">`，内部没有第二个 `main`），
因此这些页面切 tab 时只打上了 `data-enter="tab"`、没有入场动画。已在 `app.css` 的 `gy-card-open` 规则里追加 `.layout-1 > .card`、`.layout-2 > .card`（reduce 分支同步），
复测消息页「全部 → 回复」已命中 `gy-card-open`。其余样式与逻辑未改。

---

## 4. 已知限制

1. 动画只作用于 `main` 的直接子卡片；如果某个 tab 的内容包在卡片内部（嵌套），不会单独入场。
2. 多张卡片同时入场，没有做错峰；内容多时略显整齐划一。
3. 同页切换保留当前滚动位置；如果从长页面切到短页面，会被浏览器夹到可滚动范围。
4. 真机未逐台测试；`reduce` 下是直接切换，没有淡入。

---

## 5. 回滚

还原 `src/main.js` 与 `assets/css/app.css` 中 v6 段落；或回退平台上一版部署。
