#!/usr/bin/env node
/* 网页总览生成器（开发用）
 * 逐页截取「电脑端 1440」与「手机端 390」的整页截图，并生成一个
 * 可以直接双击打开的 HTML 总览（docs/gallery/index.html）。
 *
 * 前提：Chrome 已用调试端口启动；本地静态服务已运行。
 *   node scripts/qa-gallery.mjs [--base http://127.0.0.1:4173] [--port 9222]
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = argOf('base', 'http://127.0.0.1:4173');
const PORT = Number(argOf('port', '9222'));
const OUT = path.join(ROOT, 'docs/gallery');

const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };

/* 页面清单：guest / member / admin 三种身份 */
const GUEST_PAGES = [
  { slug: 'home', route: '#/', title: '找资料首页', note: '搜索、课程快筛、近期更新；根路径入口' },
  { slug: 'resources-search', route: '#/resources?q=数列极限', title: '资料搜索结果', note: '关键词 + 相关性排序，可继续筛选' },
  { slug: 'resources-filter', route: '#/resources?courseId=c_calc&term=2026%E7%A7%8B', title: '资料筛选', note: '学校 / 课程 / 学期 / 类型 / 标签组合筛选' },
  { slug: 'resource-detail', route: '#/resources/r_calc_notes', title: '资料详情', note: '适用范围、未覆盖、真实文件、前两页预览、讨论' },
  { slug: 'resource-old', route: '#/resources/r_calc_old', title: '旧学期资料', note: '明确标注 2025 秋，不暗示适用新学期' },
  { slug: 'circles-guest', route: '#/circles', title: '课友圈（游客）', note: '未登录时的引导：登录或先看公开内容' },
  { slug: 'circle', route: '#/circles/ci_calc_a', title: '课友圈页', note: '置顶索引、讨论/本周/资料、加入、邀请' },
  { slug: 'circle-physics', route: '#/circles/ci_phys', title: '课程圈（物理）', note: '9.2 起一门课一个圈，不分教学班与教师' },
  { slug: 'find-circles', route: '#/find-circles', title: '找课 / 加入', note: '按学校、课程、学期、教学班查找' },
  { slug: 'invite', route: '#/invite/GY-CALC-A26', title: '邀请落地页', note: '先看内容，登录后确认加入' },
  { slug: 'post', route: '#/posts/p_calc_notes', title: '帖子详情', note: '全文、附件、标签、讨论与回复' },
  { slug: 'post-help', route: '#/posts/p_la_question', title: '求助帖（已采纳）', note: '采纳答案置顶，可取消改选' },
  { slug: 'course', route: '#/courses/c_calc', title: '课程页', note: '当期圈 / 往期圈 / 作者收录 / 课程资料' },
  { slug: 'search', route: '#/search?q=递归', title: '全站搜索', note: '帖子 / 课程 / 用户，含附件筛选' },
  { slug: 'login', route: '#/login', title: '登录 / 注册', note: '邮箱验证码 + 演示账号一键切换' },
  { slug: 'saved-guest', route: '#/me/saved', title: '收藏（未登录）', note: '未登录时的权限提示' }
];

const MEMBER_PAGES = [
  { slug: 'circles-member', route: '#/circles', title: '我的课友圈', note: '已加入圈子的聚合流、板块筛选' },
  { slug: 'circle-member', route: '#/circles/ci_calc_a', title: '圈页（已加入）', note: '静音 / 往期 / 退出、发帖入口' },
  { slug: 'publish', route: '#/publish', title: '发帖', note: '板块、目标圈、图片、PDF、同时收录资料' },
  { slug: 'publish-resource', route: '#/publish/resource', title: '发布资料', note: '独立于圈子，必填范围与确认收录' },
  { slug: 'wallet', route: '#/me/wallet', title: '页签', note: '余额、领取状态、规则、收支流水' },
  { slug: 'growth', route: '#/me/growth', title: '我的成长', note: '等级、真实进度、五级路线、规则与私有流水' },
  { slug: 'messages', route: '#/me/messages', title: '消息', note: '回复 / 页签 / 系统通知，未读与已读' },
  { slug: 'saved', route: '#/me/saved', title: '我的收藏', note: '收藏列表，失效内容明确标出' },
  { slug: 'profile', route: '#/u/u_qinghe', title: '个人主页', note: '公开等级、帖子、关注者、获赠页签（不展示他人经验）' },
  { slug: 'settings', route: '#/me/settings', title: '账号设置', note: '头像、昵称、简介、通知、重置演示数据' },
  { slug: 'post-own', route: '#/posts/p_calc_notes', title: '自己的帖子', note: '作者视角：编辑 / 删除入口' }
];

const ADMIN_PAGES = [
  { slug: 'admin-reports', route: '#/admin', title: '管理后台 · 举报', note: '处理举报、状态与理由、审计' },
  { slug: 'admin-circles', route: '#/admin?tab=circles', title: '管理后台 · 圈子', note: '管理员新建课友圈、归档为只读、建圈申请' },
  { slug: 'admin-content', route: '#/admin?tab=content', title: '管理后台 · 内容', note: '封禁/解封帖子，关联资料同步下架' },
  { slug: 'admin-users', route: '#/admin?tab=users', title: '管理后台 · 用户', note: '脱敏邮箱、封禁/解封账号' }
];

const MOBILE_EXTRA = [
  { slug: 'm-home', route: '#/', title: '手机 · 找资料首页' },
  { slug: 'm-resource-detail', route: '#/resources/r_calc_notes', title: '手机 · 资料详情' },
  { slug: 'm-circles', route: '#/circles', title: '手机 · 课友圈' },
  { slug: 'm-circle', route: '#/circles/ci_calc_a', title: '手机 · 圈页' },
  { slug: 'm-post', route: '#/posts/p_calc_notes', title: '手机 · 帖子详情' },
  { slug: 'm-find', route: '#/find-circles', title: '手机 · 找课' },
  { slug: 'm-invite', route: '#/invite/GY-CALC-A26', title: '手机 · 邀请落地' },
  { slug: 'm-publish', route: '#/publish', title: '手机 · 发帖' },
  { slug: 'm-wallet', route: '#/me/wallet', title: '手机 · 页签' },
  { slug: 'm-messages', route: '#/me/messages', title: '手机 · 消息' },
  { slug: 'm-login', route: '#/login', title: '手机 · 登录' }
];

const { WebSocket } = globalThis;
if (!WebSocket) {
  console.error('需要 Node 22+（内置 WebSocket）');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetUrl() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = await response.json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到 Chrome 页面目标，请确认调试端口已开启');
  return page.webSocketDebuggerUrl;
}

function createClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let seq = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', (e) => reject(e.error || new Error('WS 连接失败')));
  });
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, { resolve, reject });
    socket.send(JSON.stringify({ id: seq, method, params }));
  });
  return { ready, send, close: () => socket.close() };
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const client = createClient(await targetUrl());
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  const evaluate = async (expression) => {
    const result = await client.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '求值失败');
    return result.result.value;
  };

  const viewport = (size) => client.send('Emulation.setDeviceMetricsOverride', {
    width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.width < 768
  });

  const shoot = async (page, size) => {
    await viewport(size);
    await client.send('Page.navigate', { url: `${BASE}/${page.route}` });
    await sleep(750);
    const shot = await client.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true
    });
    const suffix = size.width < 768 ? '390' : '1440';
    const file = `${page.slug}-${suffix}.png`;
    await fs.writeFile(path.join(OUT, file), Buffer.from(shot.data, 'base64'));
    console.log(`  ${file}`);
    return file;
  };

  const setSession = async (userId) => {
    await viewport(DESKTOP);
    await evaluate(`(async () => {
      const { createStore } = await import('/src/state/store.js');
      const store = createStore({ key: 'gongye-demo-v1' });
      ${userId ? `store.commit((db) => { db.session = { userId: '${userId}', startedAt: new Date().toISOString() }; });`
        : 'store.commit((db) => { db.session = null; });'}
      return 'ok';
    })()`);
    await client.send('Page.reload', { ignoreCache: true });
    await sleep(900);
  };

  // 干净状态
  await viewport(DESKTOP);
  await client.send('Page.navigate', { url: `${BASE}/?gallery=${Date.now()}` });
  await sleep(800);
  await evaluate("localStorage.clear(); sessionStorage.clear(); 'ok'");
  await client.send('Page.reload', { ignoreCache: true });
  await sleep(900);

  const groups = [];

  console.log('— 游客 / 未登录 —');
  const guest = [];
  for (const page of GUEST_PAGES) {
    guest.push({ page, desktop: await shoot(page, DESKTOP), mobile: await shoot(page, MOBILE) });
  }
  groups.push({ key: 'guest', title: '游客视角（未登录）', items: guest });

  console.log('— 登录会员：清禾 —');
  await setSession('u_qinghe');
  const member = [];
  for (const page of MEMBER_PAGES) {
    member.push({ page, desktop: await shoot(page, DESKTOP), mobile: await shoot(page, MOBILE) });
  }
  groups.push({ key: 'member', title: '登录会员视角（清禾）', items: member });

  console.log('— 手机端补充 —');
  await viewport(MOBILE);
  const mobile = [];
  for (const page of MOBILE_EXTRA) {
    mobile.push({ page, file: await shoot(page, MOBILE) });
  }
  groups.push({ key: 'mobile', title: '手机端（390px）', items: mobile, mobileOnly: true });

  console.log('— 管理员 —');
  await setSession('u_admin');
  const admin = [];
  for (const page of ADMIN_PAGES) {
    admin.push({ page, desktop: await shoot(page, DESKTOP), mobile: await shoot(page, MOBILE) });
  }
  groups.push({ key: 'admin', title: '管理员视角', items: admin });

  client.close();

  const html = buildGallery(groups);
  await fs.writeFile(path.join(OUT, 'index.html'), html, 'utf8');
  console.log(`\n总览已生成：${path.relative(ROOT, path.join(OUT, 'index.html'))}`);
}

function buildGallery(groups) {
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const sections = groups.map((group) => {
    const cards = group.items.map((item) => {
      const title = item.page.title;
      const note = item.page.note || '';
      const route = item.page.route;
      if (group.mobileOnly || !item.desktop) {
        return `<article class="item single">
          <header><h3>${escapeHtml(title)}</h3><code>${escapeHtml(route)}</code><p>${escapeHtml(note)}</p></header>
          <div class="shots"><figure><img src="${item.file}" alt="${escapeHtml(title)}" loading="lazy"><figcaption>手机 390px</figcaption></figure></div>
        </article>`;
      }
      return `<article class="item">
        <header><h3>${escapeHtml(title)}</h3><code>${escapeHtml(route)}</code><p>${escapeHtml(note)}</p></header>
        <div class="shots">
          <figure><img src="${item.desktop}" alt="${escapeHtml(title)} 桌面端" loading="lazy"><figcaption>电脑 1440px</figcaption></figure>
          <figure class="phone"><img src="${item.mobile}" alt="${escapeHtml(title)} 手机端" loading="lazy"><figcaption>手机 390px</figcaption></figure>
        </div>
      </article>`;
    }).join('\n');
    return `<section id="${group.key}">
      <h2>${escapeHtml(group.title)} <span class="count">${group.items.length} 页</span></h2>
      <div class="grid">${cards}</div>
    </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>共页 v2.2 · 网页总览（电脑端 / 手机端）</title>
<style>
  :root{--canvas:#F6F7F5;--surface:#fff;--text:#202A25;--secondary:#57645D;--muted:#69756E;--line:#DFE5DF;--brand:#285E4B;--brand-soft:#EAF2ED;--appreciation-soft:#F8F0DF}
  *{box-sizing:border-box}
  body{margin:0;background:var(--canvas);color:var(--text);font:15px/1.75 "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif}
  header.top{background:var(--surface);border-bottom:1px solid var(--line);padding:24px;position:sticky;top:0;z-index:5}
  header.top .inner{max-width:1320px;margin:0 auto}
  h1{margin:0;font-size:22px}
  .meta{color:var(--secondary);font-size:13.5px;margin-top:6px}
  .notice{background:var(--appreciation-soft);color:#6B4E14;border:1px solid #EBDCBE;border-radius:6px;padding:8px 12px;font-size:12.5px;margin-top:12px}
  nav.jump{max-width:1320px;margin:12px auto 0;display:flex;gap:8px;flex-wrap:wrap}
  nav.jump a{border:1px solid var(--line);border-radius:6px;padding:4px 10px;color:var(--secondary);text-decoration:none;font-size:13px;background:var(--surface)}
  nav.jump a:hover{border-color:var(--brand);color:var(--brand)}
  main{max-width:1320px;margin:0 auto;padding:24px}
  section{margin-bottom:40px}
  h2{font-size:18px;margin:0 0 16px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  .count{font-size:12px;color:var(--muted);font-weight:400;margin-left:6px}
  .grid{display:grid;gap:20px}
  .item{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px}
  .item header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:12px}
  .item h3{margin:0;font-size:16px}
  .item code{background:var(--canvas);border:1px solid var(--line);border-radius:4px;padding:1px 6px;font-size:12px;color:var(--secondary)}
  .item p{margin:0;color:var(--secondary);font-size:13px;flex-basis:100%}
  .shots{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:12px;align-items:start}
  .item.single .shots{grid-template-columns:320px}
  figure{margin:0}
  figure img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:4px;background:#fff}
  figcaption{font-size:12px;color:var(--muted);text-align:center;margin-top:4px}
  .item.single .shots{margin:0 auto}
  @media (max-width:900px){.shots{grid-template-columns:1fr}.item.single .shots{grid-template-columns:1fr}main{padding:12px}}
</style>
</head>
<body>
<header class="top">
  <div class="inner">
    <h1>共页 v2.2 · 网页总览（电脑端 / 手机端）</h1>
    <div class="meta">同一套自适应网页：电脑端 1440px 三栏，手机端 390px 单列 + 底部五栏导航。共 ${total} 组页面截图。</div>
    <div class="notice">静态演示版：账号、资料与页签数据均为演示，保存在本机浏览器；示例 PDF 不是真实课程资料。截图由 scripts/qa-gallery.mjs 自动生成。手机整页截图里，固定的底部导航会出现在首屏底部，这是整页截图的正常现象，不是页面错位。</div>
    <nav class="jump">
      ${groups.map((g) => `<a href="#${g.key}">${escapeHtml(g.title)}</a>`).join('')}
      <a href="http://127.0.0.1:4173/" target="_blank" rel="noopener">打开本地预览 →</a>
    </nav>
  </div>
</header>
<main>
${sections}
</main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});



