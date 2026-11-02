# 第五次更新验收（v5.0.0）

日期：2026-10-26 · 版本：`5.0.0`
范围：上传来源确认、手机端过渡、手机自适应排版。

---

## 1. 三个问题的修复

| 问题 | 处理 | 结果 |
| --- | --- | --- |
| 不勾选“文档来源”仍能上传 | 服务端对**所有带图片/附件/资料**的发布强制 `confirmedOriginal`；表单复选框文案改为「文档来源」，并注明未勾选无法发布/上传 | 带图、带附件、发布资料未勾选 → `need_confirm`；纯文字帖仍可发（表单默认 required） |
| 手机端卡片过渡闪一下、不够顺 | 手机不再使用 View Transition 的整页快照交叉（会把两页叠成半透明），也不叠加页面淡入；改为渲染后详情卡**不透明上移 10px / 220ms** 的轻动效，点击高亮关闭 | 390 宽逐帧采样：暗部占比全程 2.57%–2.59%，没有空白帧；桌面仍保留共享元素 |
| 手机排版半屏空、内容被切 | 表格改为自适应三列（`table-layout: fixed`、单元格换行，不再撑宽页面）；附件/文件行允许名称换行、操作独占一行；补 `touch-action: manipulation` 与 `-webkit-tap-highlight-color: transparent`；主栏/卡片在手机上强制 100% | 390 宽：`scrollWidth = innerWidth = 390`；钱包表格 328px 完整显示、无横向滚动；后台内容表不再裁切 |

---

## 2. 实测

```text
node scripts/check.mjs   → 自检通过
npm test                 → 45/45（业务 27 + 渲染 4 + 启动 3 + 试用后端 11）
node scripts/qa.mjs      → 30 张截图，无控制台异常、无横向溢出
node scripts/qa-flow.mjs → 15/15
```

浏览器断言：

```text
手机（390，触摸模拟）：
- 卡片点击后 routeTransitions 不增加（未走 VT）
- 详情卡 class 含 is-sheet-in，animation: gy-sheet-in
- 逐帧暗部占比 2.57%–2.59%，无空白帧
- 钱包页 innerWidth=390，表格 328px，tableScroll=false
桌面（1440）：仍使用 View Transition，打开/关闭、滚动恢复不变
```

---

## 3. 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/state/actions.js` | 发布/上传强制确认文档来源（带图、附件、资料） |
| `src/pages/posts.js`、`resources.js` | 复选框文案改为「文档来源」并写明后果 |
| `src/main.js` | 触屏不走 VT、不加页面淡入；详情卡 `is-sheet-in` 动效；`isTouchPointer()` 判断 |
| `assets/css/app.css` | 手机表格/附件自适应、tap highlight、sheet 动效、触屏 VT 规则清理 |
| `src/pages/account.js` | 个人主页“参与等级”改为新称号与页签经验说明 |
| `scripts/qa.mjs` | 个人主页断言改为「经验」 |
| `tests/logic.test.mjs` | 新增“上传必须确认文档来源”测试（27 项） |

---

## 4. 已知限制

1. 触摸设备上不再有卡片“展开”形变，只有详情卡轻上移；这是为了避免快照闪白。
2. 手机表格改为换行而不是堆叠卡片，长标题会变高；没有做横向滚动提示。
3. 360/430 宽度与真机未逐台测；200% 字号未回归。
4. 上传确认是服务端规则 + 表单 required，没有做“按钮禁用 + 实时提示”的交互。

---

## 5. 回滚

还原上述文件；或回退平台上一版部署。演示数据不受影响（`STORE_VERSION` 仍为 4）。
