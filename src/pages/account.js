/* 账号相关：登录、个人主页、收藏、消息、页签、设置 */

import { href } from '../router.js';
import * as S from '../state/selectors.js';
import { postCard, emptyState, notice, icon, avatar, statRow } from '../components/ui.js';
import { esc, timeAgo, formatDateTime, formatDay, RESOURCE_TYPES } from '../lib/format.js';

const AVATARS = [
  'avatars/cat.jpg', 'avatars/mountains.jpg', 'avatars/coffee.jpg',
  'avatars/doodle.svg', 'avatars/moon.svg', 'avatars/sprout.svg',
  'avatars/orange.svg', 'avatars/wave.svg'
];

/* ---------- 登录 ---------- */

export function login(ctx) {
  const { db, me, route } = ctx;
  const next = route.query.next || '';
  const pilot = ctx.config && ctx.config.mode === 'production';
  const cloudAuth = pilot && ctx.config && ctx.config.authMode === 'cloud';
  const loginIntro = cloudAuth
    ? '用邮箱接收验证码，登录与注册是同一步。'
    : pilot
      ? '仅允许名单内邮箱注册或登录。'
      : '使用演示账号或固定验证码体验共页。';
  const loginReminders = cloudAuth
    ? [
      '邮箱验证码只证明你能收取邮件，不代表学籍认证；注册与登录都需要邮箱验证码。',
      '修课清单、学号、课表、上课地点及成员名单不公开；已发布内容对任何访问者公开。',
      '请勿上传隐私或整本教材。'
    ]
    : pilot
      ? [
        '邮箱白名单只控制注册和登录资格，不代表邮箱所有权或学籍认证。',
        '修课清单、学号、课表、上课地点及成员名单不公开；已发布内容对任何访问者公开。',
        '试用数据保存在服务端，可能按试用安排清空；请勿上传隐私或整本教材。'
      ]
      : [
        '本机演示不会验证邮箱所有权或学籍，验证码是固定演示码。',
        '修课清单、学号、课表、上课地点及成员名单不公开；已发布内容对任何访问者公开。',
        '演示数据保存在当前浏览器，不会同步给他人；清除浏览器数据即可移除。'
      ];
  if (me) {
    return `<div class="layout-1"><div class="card">
      <h1>已登录</h1>
      <p class="secondary small mt-2">当前账号：${esc(me.nickname)}（${esc(me.email)}）</p>
      <div class="row mt-4 wrap">
        <a class="btn btn-ghost btn-sm" href="${href(`/u/${me.id}`)}">我的主页</a>
        <button class="btn btn-ghost btn-sm" type="button" data-action="logout">退出登录</button>
      </div>
    </div></div>`;
  }

  const demoUsers = ['u_qinghe', 'u_zhixia', 'u_linjian', 'u_alan', 'u_zhouzhou', 'u_nanzhi', 'u_momo', 'u_xiaolin', 'u_admin']
    .map((id) => S.userOf(db, id))
    .filter(Boolean);

  return `
  <div class="layout-1">
    <div class="card">
      <h1>${cloudAuth ? '登录 / 注册（校园内测）' : pilot ? '登录 / 注册（内部试用）' : '登录共页'}</h1>
      <p class="secondary small mt-2">${loginIntro}</p>
      <section class="login-reminder mt-3" aria-label="登录前公告与提醒">
        <div class="card-title">登录前公告与提醒</div>
        <ul>${loginReminders.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
      </section>
      ${next ? `<div class="mt-3">${notice(`登录后会回到：${esc(next)}`, 'info', 'arrow')}</div>` : ''}

      <form data-form="login-verify" class="mt-4" novalidate>
        <div class="field">
          <label for="login-email">邮箱</label>
          <input class="input" id="login-email" name="email" type="email" required
            placeholder="${pilot ? 'name@example.com' : 'name@company.com'}" autocomplete="email" value="${pilot ? '' : 'qinghe@example.com'}">
        </div>
        <div class="field">
          <label for="login-code">验证码</label>
          <div class="row">
            <input class="input" id="login-code" name="code" inputmode="numeric" maxlength="6"
              placeholder="6 位验证码" autocomplete="one-time-code">
            <button class="btn btn-ghost" type="button" data-action="send-code">发送验证码</button>
          </div>
          <p class="field-help" data-code-hint>${cloudAuth
            ? '点「发送验证码」后去邮箱取 6 位数字，10 分钟内有效。'
            : pilot
            ? '试用期验证码固定 123456；接入企业邮箱后会改为真实邮件。'
            : '演示环境验证码固定为 123456；真实环境由邮件服务发送并设发送冷却。'}</p>
        </div>
        <button class="btn btn-block mt-4" type="submit">登录 / 注册</button>
      </form>

      ${cloudAuth
        ? ''
        : pilot
          ? `<p class="tiny muted mt-3">注册由管理员白名单控制；如需加入，请联系管理员把邮箱加到 server/allowlist.txt。</p>`
          : `<hr>
      <div class="stack-12">
        <div class="section-title">使用演示账号（无需验证码）</div>
        <div class="chips">
          ${demoUsers.map((user) => `<button class="chip" type="button" data-action="quick-login" data-user="${esc(user.id)}">
            ${avatar(user, 'avatar-xs')}${esc(user.nickname)}${user.role === 'admin' ? '（管理员）' : ''}
          </button>`).join('')}
        </div>
      </div>`}
    </div>
    <div class="card">
      <div class="card-title">登录后可以做什么</div>
      <div class="stack small secondary">
        <p>· 下载完整 PDF（不要求加入课友圈、等级或页签）</p>
        <p>· 发布资料与帖子、评论纠错、收藏与点赞</p>
        <p>· 加入课友圈，收到回复与页签消息</p>
        <p>· 每日领取 1 枚页签，送给帮到你的分享</p>
      </div>
    </div>
  </div>`;
}

/* ---------- 个人主页 ---------- */

export function profile(ctx) {
  const { db, me, route } = ctx;
  const targetId = route.params.id === 'me' ? (me ? me.id : '') : route.params.id;
  const user = targetId ? S.userOf(db, targetId) : null;
  if (!user) {
    return `<div class="layout-1">${emptyState({
      img: 'removed.svg', title: '这个账号不存在', text: '可能已注销，或链接有误。',
      actions: `<a class="btn btn-sm" href="${href('/circles')}">回到课友圈</a>`
    })}</div>`;
  }

  const isMe = !!me && me.id === user.id;
  const level = S.levelInfo(db, user.id);
  const posts = S.postsByAuthor(db, user.id);
  const followers = S.followerCount(db, user.id);
  const received = S.receivedGiftTotal(db, user.id);
  const following = me ? S.isFollowing(db, me.id, 'user', user.id) : false;
  const circles = S.myCircles(db, user.id);

  return `
  <div class="layout-2">
    <main>
      <div class="card">
        <div class="profile-head">
          ${avatar(user, 'avatar-lg')}
          <div class="grow">
            <h1 style="font-size:22px">${esc(user.nickname)}</h1>
            <div class="row wrap mt-1" style="gap:8px;align-items:center">
              <img class="level-chip" src="assets/${esc(level.chip)}" alt="LV.${level.level} ${esc(level.name)}" width="72" height="24">
              <span class="small">${esc(level.name)}</span>
              ${isMe ? `<span class="tiny muted">${level.xp} 经验${level.isMax ? ' · 已达最高等级' : ` · 还差 ${level.remaining} 到下一级`}</span>` : ''}
              ${user.role === 'admin' ? '<span class="status-pill">站点维护</span>' : ''}
              <button class="icon-btn level-help-trigger" type="button" data-action="level-info"
                data-level="${level.level}" data-name="${esc(level.name)}"
                aria-label="查看参与等级说明">${icon('question')}</button>
            </div>
            <p class="small secondary mt-2">${esc(user.bio || '还没有写简介。')}</p>
            <p class="tiny muted mt-2">加入于 ${esc(formatDay(user.joinedAt))} · 自述学校并非认证信息，页面不展示修课清单</p>
          </div>
        </div>
        ${statRow([
          { value: posts.length, label: '篇帖子' },
          { value: followers, label: '位关注者' },
          { value: received, label: '枚收到的页签' }
        ])}
        <div class="row wrap mt-4">
          ${isMe
            ? `<a class="btn btn-ghost btn-sm" href="${href('/me/settings')}">编辑资料</a>`
            : `<button class="btn btn-sm" type="button" data-action="follow-user" data-user="${esc(user.id)}">
                 ${following ? '已关注' : '关注作者'}
               </button>
               ${me
                 ? `<button class="btn btn-ghost btn-sm" type="button" data-action="open-direct-thread" data-peer="${esc(user.id)}">私信</button>`
                 : `<a class="btn btn-ghost btn-sm" href="${href('/login', { next: `/me/messages?tab=direct&with=${encodeURIComponent(user.id)}` })}">登录后私信</a>`}`}
        </div>
      </div>

      <div class="tabs"><a class="tab" role="tab" aria-selected="true" href="${href(`/u/${user.id}`)}">帖子 ${posts.length}</a></div>
      ${posts.length
        ? posts.map((post) => postCard(ctx, post)).join('')
        : `<div class="card">${emptyState({
          img: 'empty-feed.svg',
          title: isMe ? '你还没有发过帖子' : '这个账号还没有公开帖子',
          text: isMe ? '把整理或问题放上来，比一个人卡着更好受。' : '',
          actions: isMe ? `<a class="btn btn-sm" href="${href('/publish')}">发布第一篇</a>` : ''
        })}</div>`}
    </main>

    <aside class="rail">
      <section class="card">
        <div class="card-title">加入的课友圈</div>
        ${circles.length
          ? circles.slice(0, 6).map(({ circle }) => `<div class="mb-3">
              <a class="small" href="${href(`/circles/${circle.id}`)}">${esc(S.circleShort(db, circle))}</a>
              <div class="tiny muted">课程圈 · ${S.countMembers(db, circle.id)} 位成员</div>
            </div>`).join('')
          : '<p class="small muted">没有公开的圈子。</p>'}
        <p class="tiny muted mt-2">成员名单不公开，也不提供导出。</p>
      </section>
    </aside>
  </div>`;
}

/* ---------- 我的收藏 ---------- */

export function saved(ctx) {
  const { db, me } = ctx;
  if (!me) {
    return `<div class="layout-1"><div class="card">
      <h1>我的收藏</h1>
      ${notice('登录后查看你收藏的帖子。', 'warn', 'lock')}
      <a class="btn mt-4" href="${href('/login', { next: '/me/saved' })}">登录 / 注册</a>
    </div></div>`;
  }
  const items = S.savedPosts(db, me.id);

  return `
  <div class="layout-1">
    <nav class="crumbs" aria-label="面包屑"><a href="${href(`/u/${me.id}`)}">我的主页</a><span>/</span><span>收藏</span></nav>
    <div class="page-head"><h1>我的收藏</h1><p>共 ${items.length} 条。原文被删除或隐藏时会明确标出。</p></div>
    ${items.length
      ? items.map(({ post }) => {
        if (!post) return '';
        if (post.status !== 'published') {
          return `<div class="card"><div class="row wrap" style="gap:8px">
            <span class="status-pill status-removed">已不可见</span>
            <span class="small secondary">你收藏的这条内容已被作者删除或由平台隐藏。</span>
          </div></div>`;
        }
        return postCard(ctx, post);
      }).join('')
      : `<div class="card">${emptyState({
        book: true,
        title: '还没有收藏',
        text: '遇到想再看的帖子，可以先收藏；收藏不产生成长值。',
        actions: `<a class="btn btn-sm" href="${href('/circles')}">去看看最新</a>`
      })}</div>`}
  </div>`;
}

/* ---------- 消息 ---------- */

const NOTIFY_TYPES = {
  reply: '回复', gift: '页签', accepted: '采纳', system: '系统', refund: '退款'
};

export function messages(ctx) {
  const { db, me, route } = ctx;
  if (!me) {
    return `<div class="layout-1"><div class="card">
      <h1>消息</h1>
      ${notice('登录后查看通知和私信。', 'warn', 'lock')}
      <a class="btn mt-4" href="${href('/login', { next: '/me/messages' })}">登录 / 注册</a>
    </div></div>`;
  }
  const tab = route.query.tab || 'all';
  const isDirect = tab === 'direct';
  const noticeTab = ['all', 'reply', 'gift', 'system'].includes(tab) ? tab : 'all';
  const all = S.notificationsFor(db, me.id);
  const unread = all.filter((n) => !n.readAt).length;
  const directMessages = (db.directMessages || [])
    .filter((message) => message.senderId === me.id || message.recipientId === me.id);
  const directUnread = directMessages.filter((message) => message.recipientId === me.id && !message.readAt).length;
  const items = noticeTab === 'all'
    ? all
    : all.filter((n) => (noticeTab === 'system' ? ['system', 'refund', 'accepted'].includes(n.type) : n.type === noticeTab));

  let directContent = '';
  if (isDirect) {
    const peerId = String(route.query.with || '');
    if (peerId) {
      const peer = S.userOf(db, peerId);
      if (!peer || peer.id === me.id || peer.status !== 'active') {
        directContent = `<div class="card">${emptyState({
          img: 'removed.svg', title: '无法打开这段对话', text: '对方账号不存在或当前不可用。',
          actions: `<a class="btn btn-sm" href="${href('/me/messages', { tab: 'direct' })}">返回私信</a>`
        })}</div>`;
      } else {
        const thread = directMessages
          .filter((message) => (message.senderId === me.id && message.recipientId === peer.id)
            || (message.senderId === peer.id && message.recipientId === me.id))
          .slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const previousList = document.querySelector('.dm-message-list');
        const wasAtBottom = !previousList
          || previousList.scrollHeight - previousList.scrollTop - previousList.clientHeight < 80;
        const unreadInThread = thread.some((message) => message.senderId === peer.id
          && message.recipientId === me.id && !message.readAt);
        directContent = `
          <section class="card dm-thread">
            <div class="row dm-thread-head">
              <a class="link" href="${href('/me/messages', { tab: 'direct' })}">‹ 私信列表</a>
              <span class="grow"></span>
              ${unreadInThread ? `<button class="btn btn-quiet btn-sm" type="button" data-action="mark-direct-read" data-peer="${esc(peer.id)}">标为已读</button>` : ''}
            </div>
            <div class="author dm-peer">${avatar(peer)}<div class="grow"><b>${esc(peer.nickname)}</b></div>
              <a class="link small" href="${href(`/u/${peer.id}`)}">查看主页</a>
            </div>
            <div class="dm-message-list">
              ${thread.length ? thread.map((message) => {
                const mine = message.senderId === me.id;
                return `<div class="dm-message-row ${mine ? 'is-mine' : ''}">
                  <div class="dm-message-meta">${mine ? '我' : esc(peer.nickname)} · ${esc(formatDateTime(message.createdAt))}</div>
                  <div class="dm-bubble">${esc(message.body).replace(/\n/g, '<br>')}</div>
                  ${mine && message.readAt ? '<div class="dm-read-state">已读</div>' : ''}
                </div>`;
              }).join('') : '<p class="tiny muted dm-empty-thread">还没有消息，可以从课程问题开始聊。</p>'}
              <div id="dm-thread-end"></div>
            </div>
            <form class="dm-compose" data-form="direct-message" data-recipient="${esc(peer.id)}">
              <label class="visually-hidden" for="dm-body">私信内容</label>
              <textarea class="textarea" id="dm-body" name="body" rows="3" maxlength="2000" required
                placeholder="写一条私信……"></textarea>
              <div class="row wrap dm-compose-foot">
                <span class="tiny muted">最多 2000 字</span>
                <button class="btn btn-sm" type="submit">发送</button>
              </div>
            </form>
          </section>`;
        ctx.after.push(() => {
          const list = document.querySelector('.dm-message-list');
          if (list && wasAtBottom) list.scrollTop = list.scrollHeight;
        });
      }
    } else {
      const conversations = new Map();
      directMessages.forEach((message) => {
        const peerIdForMessage = message.senderId === me.id ? message.recipientId : message.senderId;
        const previous = conversations.get(peerIdForMessage);
        if (!previous || new Date(message.createdAt) > new Date(previous.last.createdAt)) {
          conversations.set(peerIdForMessage, { last: message });
        }
      });
      const sortedConversations = [...conversations.entries()]
        .map(([peerIdForMessage, row]) => ({ peer: S.userOf(db, peerIdForMessage), ...row }))
        .filter((row) => row.peer && row.peer.status === 'active')
        .sort((a, b) => new Date(b.last.createdAt) - new Date(a.last.createdAt));
      directContent = sortedConversations.length
        ? `<div class="card card-flush"><ul class="list-plain dm-conversations">
            ${sortedConversations.map(({ peer, last }) => {
              const unreadCount = directMessages.filter((message) => message.senderId === peer.id
                && message.recipientId === me.id && !message.readAt).length;
              return `<li><button class="dm-conversation" type="button" data-action="open-direct-thread" data-peer="${esc(peer.id)}">
                ${avatar(peer)}<span class="grow dm-conversation-copy"><b>${esc(peer.nickname)}</b>
                  <span>${last.senderId === me.id ? '我：' : ''}${esc(last.body)}</span></span>
                <span class="dm-conversation-end"><time>${esc(timeAgo(last.createdAt))}</time>
                  ${unreadCount ? `<i class="dm-unread" aria-label="${unreadCount} 条未读">${unreadCount > 99 ? '99+' : unreadCount}</i>` : ''}</span>
              </button></li>`;
            }).join('')}
          </ul></div>`
        : `<div class="card">${emptyState({
          img: 'empty-feed.svg', title: '还没有私信',
          text: '打开同学主页，点击“私信”即可开始一段对话。',
          actions: `<a class="btn btn-sm" href="${href('/circles', { mode: 'discover' })}">去课友圈认识同学</a>`
        })}</div>`;
    }
  }

  return `
  <div class="layout-1">
    <nav class="crumbs" aria-label="面包屑"><a href="${href(`/u/${me.id}`)}">我的主页</a><span>/</span><span>消息</span></nav>
    <div class="page-head">
      <h1>消息</h1>
      <p>${isDirect ? `${directUnread ? `${directUnread} 条未读私信` : '查看你的私信对话'}` : `${unread ? `${unread} 条未读通知` : '通知已读完'} · 自己的操作不会通知自己`}</p>
    </div>

    <div class="tabs">
      <a class="tab" aria-current="${!isDirect ? 'page' : 'false'}" href="${href('/me/messages')}">通知${unread ? ` · ${unread}` : ''}</a>
      <a class="tab" aria-current="${isDirect ? 'page' : 'false'}" href="${href('/me/messages', { tab: 'direct' })}">私信${directUnread ? ` · ${directUnread}` : ''}</a>
      ${isDirect ? `<button class="icon-btn direct-help" type="button" data-action="direct-mode-info" aria-label="私信说明">${icon('question')}</button>` : ''}
      <span class="grow"></span>
      ${!isDirect && unread ? `<button class="btn btn-quiet btn-sm" type="button" data-action="mark-all-read">全部标为已读</button>` : ''}
    </div>

    ${isDirect ? directContent : `
    <div class="tabs dm-notice-tabs" role="tablist">
      ${['all', 'reply', 'gift', 'system'].map((key) => `<a class="tab" role="tab"
        aria-selected="${noticeTab === key}" href="${href('/me/messages', { tab: key === 'all' ? '' : key })}">
        ${key === 'all' ? '全部' : key === 'reply' ? '回复' : key === 'gift' ? '页签' : '系统'}
      </a>`).join('')}
    </div>
    ${items.length ? `<div class="card card-flush">
      <ul class="list-plain">
        ${items.map((n) => {
          const actor = n.actorId ? S.userOf(db, n.actorId) : null;
          const target = n.postId ? S.postOf(db, n.postId) : null;
          return `<li style="padding:14px 16px">
            <div class="author">
              ${actor ? avatar(actor) : `<span class="avatar" style="display:flex;align-items:center;justify-content:center">${icon('bell', 'i-sm')}</span>`}
              <div class="grow">
                <div class="author-name">
                  ${actor ? `<a href="${href(`/u/${actor.id}`)}">${esc(actor.nickname)}</a>` : '系统'}
                  <span class="status-pill ${n.readAt ? '' : 'status-ready'}">${n.readAt ? NOTIFY_TYPES[n.type] || '通知' : '未读'}</span>
                </div>
                <div class="small mt-1">${esc(n.text)}</div>
                <div class="tiny muted mt-1">${esc(formatDateTime(n.createdAt))}
                  ${target ? ` · <a class="link" href="${href(`/posts/${target.id}`)}">打开相关帖子</a>` : ''}
                </div>
              </div>
              ${!n.readAt ? `<button class="btn btn-quiet btn-sm" type="button" data-action="mark-read" data-notification="${esc(n.id)}">标为已读</button>` : ''}
            </div>
          </li>`;
        }).join('')}
      </ul>
    </div>` : `<div class="card">${emptyState({
      img: 'empty-feed.svg',
      title: '还没有消息',
      text: '别人回复你的帖子、采纳你的回答或给你送页签时，会在这里提醒。',
      actions: `<a class="btn btn-sm" href="${href('/circles')}">去课友圈看看</a>`
    })}</div>`}
    `}
  </div>`;
}

/* ---------- 页签 ---------- */

const LEDGER_LABELS = { claim: '每日领取', gift_out: '赠送', gift_refund: '退款', seed: '初始余额' };

export function wallet(ctx) {
  const { db, me } = ctx;
  if (!me) {
    return `<div class="layout-1"><div class="card">
      <h1>我的页签</h1>
      ${notice('登录后查看页签余额、领取与赠送记录。', 'warn', 'lock')}
      <a class="btn mt-4" href="${href('/login', { next: '/me/wallet' })}">登录 / 注册</a>
    </div></div>`;
  }
  const state = S.claimState(db, me.id);
  const balance = state.balance;
  const entries = (db.ledger || []).filter((e) => e.userId === me.id).slice().reverse().slice(0, 20);
  const sentToday = S.sentToday(db, me.id);
  const received = S.receivedGiftTotal(db, me.id);
  const giftsSent = (db.gifts || []).filter((g) => g.senderId === me.id).slice().reverse().slice(0, 8);

  const claimBlock = state.canClaim
    ? `<button class="btn" type="button" data-action="claim-daily">领取今日页签</button>
       <p class="tiny muted mt-2">领取条件只有登录且邮箱已验证，不需要发帖、点赞或连续签到。</p>`
    : state.code === 'claimed'
      ? `<div class="notice">${icon('check', 'i-sm')}<span>今天已经领取过了，上海时间明日零点后可再领。未领取不补发，也不显示错过天数。</span></div>`
      : state.code === 'full'
        ? `<div class="notice notice-warn">${icon('lock', 'i-sm')}<span>已存满 30 枚，送出后再领。</span></div>`
        : `<div class="notice notice-warn">${icon('lock', 'i-sm')}<span>当前状态不能领取。</span></div>`;

  return `
  <div class="layout-2">
    <main>
      <nav class="crumbs" aria-label="面包屑"><a href="${href(`/u/${me.id}`)}">我的主页</a><span>/</span><span>页签</span></nav>
      <div class="card mt-4 sign-card">
        <h1>我的页签</h1>
        <div class="sign-balance">
          <img src="assets/art/bookmark-filled.svg" alt="">
          <strong>${balance}</strong><span>枚可送 · 上限 30</span>
        </div>
        <p class="small secondary">今天的页签，想留给哪篇帮到你的分享？</p>
        <div class="mt-3">${claimBlock}</div>
        ${state.code === 'claimed' ? '' : ''}
      </div>

      <div class="card">
        <div class="card-title">规则</div>
        <div class="stack small secondary">
          <p>· 每个上海自然日可手动领取 1 枚；未领取不补发，无连续签到要求</p>
          <p>· 可送余额可累积到 30 枚；满额时须送出后才可再领</p>
          <p>· 每帖最多 2 枚，每位作者每天最多收你 2 枚，每天最多送出 5 枚</p>
          <p>· 不能自赠；收到页签只计入作者认可，不进入可送余额，不可转赠</p>
          <p>· 赠送成功不可主动撤回；帖子被永久移除时按记录退回，退款可让余额短时超过 30</p>
          <p>· 页签不可购买、提现、私下转账，也不抵扣下载</p>
        </div>
      </div>

      <div class="card">
        <div class="card-title">收支记录</div>
        ${entries.length ? `<table class="table">
          <thead><tr><th>时间</th><th>类型</th><th>变动</th><th>变动后余额</th></tr></thead>
          <tbody>
            ${entries.map((e) => `<tr>
              <td>${esc(formatDateTime(e.at))}</td>
              <td>${esc(LEDGER_LABELS[e.type] || e.type)}${e.note ? `<div class="tiny muted">${esc(e.note)}</div>` : ''}</td>
              <td class="${e.delta > 0 ? 'brand-text' : ''}">${e.delta > 0 ? '+' : ''}${e.delta}</td>
              <td>${e.balanceAfter}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : '<p class="small muted">还没有记录。</p>'}
        <p class="tiny muted mt-3">真实余额只由服务端事务写入；页面显示的余额来自服务端结果，不做乐观更新。</p>
      </div>

      ${giftsSent.length ? `<div class="card">
        <div class="card-title">我送出的页签</div>
        <div class="stack">
          ${giftsSent.map((gift) => {
            const post = S.postOf(db, gift.postId);
            const receiver = S.userOf(db, gift.receiverId);
            return `<div class="row wrap" style="gap:8px">
              <span class="small">给 ${esc(receiver ? receiver.nickname : '')} 的
                ${post ? `<a class="link" href="${href(`/posts/${post.id}`)}">${esc(post.title || '一条分享')}</a>` : '一条已移除内容'}</span>
              <span class="tiny muted">${gift.qty} 枚 · ${esc(formatDay(gift.createdAt))} · ${gift.status === 'refunded' ? '已退回' : '有效'}</span>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}
    </main>

    <aside class="rail">
      <section class="card">
        <div class="card-title">今日状态</div>
        <div class="stack small">
          <p>今日已送出：<b>${sentToday}</b> / 5 枚</p>
          <p>历史收到页签：<b>${received}</b> 枚</p>
          <p>领取状态：<b>${state.code === 'claimed' ? '今日已领取' : state.canClaim ? '可领取' : '不可领取'}</b></p>
        </div>
        <p class="tiny muted mt-3">收到页签不进入可送余额，也不能转赠。</p>
      </section>
      <section class="card">
        <div class="card-title">页面说明</div>
        <p class="small secondary">页签是辅助机制，不替代找资料与课友圈两个核心。它不决定推荐，不设全站财富排行，也不以连续登录惩罚用户。</p>
      </section>
    </aside>
  </div>`;
}

/* ---------- 设置 ---------- */

export function settings(ctx) {
  const { db, me } = ctx;
  if (!me) {
    return `<div class="layout-1"><div class="card">
      <h1>账号设置</h1>
      ${notice('登录后管理昵称、头像与通知。', 'warn', 'lock')}
      <a class="btn mt-4" href="${href('/login', { next: '/me/settings' })}">登录 / 注册</a>
    </div></div>`;
  }
  const prefs = (db.prefs && db.prefs[me.id]) || { replies: true, gifts: true, system: true };

  return `
  <div class="layout-1">
    <nav class="crumbs" aria-label="面包屑"><a href="${href(`/u/${me.id}`)}">我的主页</a><span>/</span><span>设置</span></nav>
    <div class="card mt-4">
      <h1>账号设置</h1>
      <p class="small secondary mt-2">邮箱 ${esc(me.email)} · ${me.verified ? '已验证' : '未验证'} · 账号 ${me.status === 'active' ? '正常' : '已停用'}</p>
    </div>

    <div class="card">
      <div class="card-title">公开资料</div>
      <form data-form="profile">
        <div class="field">
          <label>头像</label>
          <div class="chips">
            ${AVATARS.map((file, index) => `<label class="chip ${me.avatar === file ? 'is-active' : ''}" style="cursor:pointer;padding:4px">
              <input type="radio" name="avatar" value="${esc(file)}" ${me.avatar === file ? 'checked' : ''}
                style="position:absolute;opacity:0;width:1px;height:1px">
              <img src="assets/${esc(file)}" alt="默认头像 ${index + 1}" width="32" height="32" style="border-radius:50%;display:block">
            </label>`).join('')}
          </div>
          <p class="field-help">可选 8 款内置头像，随时可更换。</p>
        </div>
        <div class="field">
          <label for="set-nickname">昵称 <span class="label-hint">2–16 个字符，可用化名</span></label>
          <input class="input" id="set-nickname" name="nickname" value="${esc(me.nickname)}" maxlength="16" required>
        </div>
        <div class="field">
          <label for="set-bio">简介 <span class="label-hint">最多 120 字</span></label>
          <textarea class="textarea" id="set-bio" name="bio" rows="2" maxlength="120">${esc(me.bio || '')}</textarea>
        </div>
        <button class="btn" type="submit">保存资料</button>
      </form>
    </div>

    <div class="card">
      <div class="card-title">通知</div>
      <form data-form="settings-notify">
        <label class="checkbox mb-2"><input type="checkbox" name="replies" ${prefs.replies !== false ? 'checked' : ''}>
          <span>有人回复我的帖子或评论时通知我</span></label>
        <label class="checkbox mb-2"><input type="checkbox" name="gifts" ${prefs.gifts !== false ? 'checked' : ''}>
          <span>收到页签时通知我（同一帖的赠签可合并）</span></label>
        <label class="checkbox mb-2"><input type="checkbox" name="system" ${prefs.system !== false ? 'checked' : ''}>
          <span>系统通知：资料审核结果、举报处理、退款</span></label>
        <p class="field-help">系统通知不可关闭；邮件营销和浏览器推送暂不提供。</p>
        <button class="btn btn-ghost" type="submit">保存设置</button>
      </form>
    </div>

    <div class="row wrap mt-4">
      <button class="btn btn-ghost btn-sm" type="button" data-action="logout">退出登录</button>
      ${ctx.config && ctx.config.mode === 'production'
        ? ''
        : '<button class="btn btn-danger btn-sm" type="button" data-action="reset-demo">重置演示数据</button>'}
    </div>
  </div>`;
}






