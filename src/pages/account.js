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
  const domains = Array.isArray(ctx.config?.emailDomains) ? ctx.config.emailDomains : ['zju.edu.cn', 'st.zju.edu.cn'];
  const domainText = domains.map((domain) => `@${domain}`).join('、');
  const authReady = !pilot || (ctx.config.authMode === 'email-otp' && ctx.config.authReady === true);
  const cooldown = Math.max(0, Math.ceil(((ctx.ui?.codeRetryAt || 0) - Date.now()) / 1000));
  const sending = !!ctx.ui?.codeSending;
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
      <h1>${pilot ? '浙大邮箱登录 / 注册' : '登录共页（本地演示）'}</h1>
      <p class="secondary small mt-2">${pilot
        ? `使用 ${esc(domainText)} 接收真实邮件验证码，注册和登录是同一步。`
        : '独立本地演示：不会真的发邮件，演示数据只保存在本机。'}</p>
      ${pilot ? `<p class="small mt-3">共页是学生自发的课程资料交流项目，非浙江大学官方网站，亦不代表学校或教师。</p>
        <div class="mt-3">${notice(authReady
          ? '验证码由服务端发送与验证；请到邮箱收取，没收到先看垃圾邮件。'
          : '邮箱登录暂不可用：真实邮件服务（SMTP）尚未配置或未就绪，已禁用发送与登录。请联系维护者，不要使用演示验证码。', authReady ? 'info' : 'warn', 'lock')}</div>` : ''}
      ${next ? `<div class="mt-3">${notice(`登录后会回到：${esc(next)}`, 'info', 'arrow')}</div>` : ''}

      <form data-form="login-verify" class="mt-4" novalidate>
        <div class="field">
          <label for="login-email">邮箱</label>
          <input class="input" id="login-email" name="email" type="email" required
            placeholder="${pilot ? esc(domains[0] ? `学号@${domains[0]}` : '请输入已配置域名的邮箱') : 'name@company.com'}" autocomplete="email" value="${pilot ? '' : 'qinghe@example.com'}">
        </div>
        <div class="field">
          <label for="login-code">验证码</label>
          <div class="row">
            <input class="input" id="login-code" name="code" inputmode="numeric" maxlength="6"
              placeholder="6 位验证码" autocomplete="one-time-code">
            <button class="btn btn-ghost" type="button" data-action="send-code" ${!authReady || cooldown || sending ? 'disabled' : ''}>${sending ? '发送中…' : cooldown ? `${cooldown} 秒后重发` : '发送验证码'}</button>
          </div>
          <p class="field-help" data-code-hint role="status">${pilot
            ? esc(ctx.ui?.codeHint || `支持 ${domainText}；发送成功后至少等待 60 秒再重发，以服务端限制为准。`)
            : '演示环境验证码固定为 123456；只用于本地演示。'}</p>
        </div>
        <label class="checkbox">
          <input type="checkbox" name="agree" required>
          <span>${pilot
            ? '我了解这是非官方学生项目，同意邮箱用于登录；只分享来源合法且有权公开的资料，不上传隐私或整本商业教材。'
            : '我已了解这是本地演示环境。'}</span>
        </label>
        <button class="btn btn-block mt-4" type="submit" ${!authReady || ctx.ui?.verifying ? 'disabled' : ''}>${ctx.ui?.verifying ? '验证中…' : '登录 / 注册'}</button>
      </form>

      ${pilot
        ? `<p class="tiny muted mt-3">开放域名：${esc(domainText)}。一个邮箱一个账号，会话由同源 Cookie 维持，前端不保存登录令牌。</p>`
        : `<hr>
      <div class="stack-12">
        <div class="section-title">使用演示账号（无需验证码）</div>
        <div class="chips">
          ${demoUsers.map((user) => `<button class="chip" type="button" data-action="quick-login" data-user="${esc(user.id)}">
            ${avatar(user, 'avatar-xs')}${esc(user.nickname)}${user.role === 'admin' ? '（管理员）' : ''}
          </button>`).join('')}
        </div>
        <p class="tiny muted">演示账号的数据只存在于本机浏览器；真实环境必须由可信后端签发会话。</p>
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

  if (user.status === 'deleted') {
    return `<div class="layout-1">${emptyState({
      img: 'removed.svg', title: '这个账号已注销', text: '账号资料已经删除；作者选择保留的内容会显示为“已注销用户”。',
      actions: `<a class="btn btn-sm" href="${href('/circles')}">回到课友圈</a>`
    })}</div>`;
  }

  const isMe = !!me && me.id === user.id;
  const level = S.levelInfo(db, user.id);
  const posts = S.postsByAuthor(db, user.id);
  const followers = S.followerCount(db, user.id);
  const received = S.receivedGiftTotal(db, user.id);
  const following = me ? S.isFollowing(db, me.id, 'user', user.id) : false;
  const showCircles = ctx.config?.mode !== 'production' || isMe;
  const blockedByMe = !!me && S.blockedBy(db, me.id, user.id);
  const circles = showCircles ? S.myCircles(db, user.id) : [];

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
            </div>
            <p class="small secondary mt-2">${esc(user.bio || '还没有写简介。')}</p>
            <p class="tiny muted mt-2">加入于 ${esc(formatDay(user.joinedAt))}</p>
          </div>
        </div>
        ${statRow([
          { value: posts.length, label: '篇帖子' },
          { value: followers, label: '位关注者' },
          { value: received, label: '枚收到的页签' }
        ])}
        <div class="row wrap mt-4">
          ${isMe
            ? `<a class="btn btn-ghost btn-sm" href="${href('/me/settings')}">编辑资料</a>
               <a class="btn btn-ghost btn-sm" href="${href('/me/wallet')}">我的页签</a>
               <a class="btn btn-ghost btn-sm" href="${href('/me/saved')}">我的收藏</a>
               <a class="btn btn-ghost btn-sm" href="${href('/me/growth')}">我的成长</a>`
            : `<button class="btn btn-sm" type="button" data-action="follow-user" data-user="${esc(user.id)}">
                 ${following ? '已关注' : '关注作者'}
               </button>
               ${me
                 ? `<button class="btn btn-ghost btn-sm" type="button" data-action="open-direct-thread" data-peer="${esc(user.id)}">私信</button>
                    <details class="more-menu">
                      <summary class="icon-btn" aria-label="更多操作">${icon('more')}</summary>
                      <div class="more-menu-panel">
                        <button type="button" data-action="block-user" data-user="${esc(user.id)}" data-value="${blockedByMe ? '0' : '1'}">${blockedByMe ? '取消拉黑' : '拉黑'}</button>
                      </div>
                    </details>`
                 : `<a class="btn btn-ghost btn-sm" href="${href('/login', { next: `/me/messages?tab=direct&with=${encodeURIComponent(user.id)}` })}">登录后私信</a>`}`}
        </div>
      </div>

      <h2 class="section-heading">帖子 ${posts.length}</h2>
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
      ${isMe ? `<section class="card">
        <div class="card-title">我的常用入口</div>
        <div class="stack">
          <a class="link small" href="${href('/me/saved')}">我的收藏</a>
          <a class="link small" href="${href('/me/messages')}">消息</a>
          <a class="link small" href="${href('/me/wallet')}">页签与记录</a>
          <a class="link small" href="${href('/me/settings')}">账号设置</a>
        </div>
      </section>` : ''}
      ${showCircles ? `<section class="card">
        <div class="card-title">${isMe ? '我的课友圈（仅自己可见）' : '加入的课友圈'}</div>
        ${circles.length
          ? circles.slice(0, 6).map(({ circle }) => `<div class="mb-3">
              <a class="small" href="${href(`/circles/${circle.id}`)}">${esc(S.circleShort(db, circle))}</a>
              <div class="tiny muted">课程圈 · ${S.countMembers(db, circle.id)} 位成员</div>
            </div>`).join('')
          : '<p class="small muted">没有公开的圈子。</p>'}
        <p class="tiny muted mt-2">成员名单不公开，也不提供导出。</p>
      </section>` : ''}
      <section class="card">
        <div class="card-title">参与等级</div>
        <p class="small secondary">等级只表达参与程度，不影响下载、提问和评论等基本权利。点赞、下载、领页签和赠页签不产生经验；收到同学送的页签 +5（每天最多 5 枚）。</p>
        <div class="stack tiny muted mt-3">
          <p>初翻 / 拾页 / 成册 / 共著 / 传薪</p>
          <p>阈值 0 / 50 / 150 / 400 / 1000</p>
        </div>
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
      ${notice('登录后查看回复、页签和系统通知。', 'warn', 'lock')}
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
        const blockedPeer = S.blockedBy(db, me.id, peer.id);
        directContent = `
          <section class="card dm-thread">
            <div class="row dm-thread-head">
              <a class="link" href="${href('/me/messages', { tab: 'direct' })}">‹ 私信列表</a>
              <span class="grow"></span>
              <details class="more-menu">
                <summary class="icon-btn" aria-label="更多操作">${icon('more')}</summary>
                <div class="more-menu-panel">
                  <button type="button" data-action="report-dm" data-peer="${esc(peer.id)}">举报对方</button>
                  <button type="button" data-action="block-user" data-user="${esc(peer.id)}" data-value="${blockedPeer ? '0' : '1'}">${blockedPeer ? '取消拉黑' : '拉黑'}</button>
                </div>
              </details>
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
                  ${message.status === 'removed'
                    ? '<div class="dm-bubble is-removed">这条私信已被删除</div>'
                    : `<div class="dm-bubble">${esc(message.body).replace(/\n/g, '<br>')}</div>`}
                  ${mine && message.readAt ? '<div class="dm-read-state">已读</div>' : ''}
                </div>`;
              }).join('') : '<p class="tiny muted dm-empty-thread">还没有消息，可以从课程问题开始聊。</p>'}
              <div id="dm-thread-end"></div>
            </div>
            ${blockedPeer ? `<div class="dm-compose"><div class="notice notice-warn"><span>你已拉黑对方，双方都不能发私信。</span>
              <button class="text-button" type="button" data-action="block-user" data-user="${esc(peer.id)}" data-value="0">取消拉黑</button></div></div>` : `
            <form class="dm-compose" data-form="direct-message" data-recipient="${esc(peer.id)}">
              <label class="visually-hidden" for="dm-body">私信内容</label>
              <textarea class="textarea" id="dm-body" name="body" rows="3" maxlength="2000" required
                placeholder="写一条私信……"></textarea>
              <div class="row wrap dm-compose-foot">
                <span class="tiny muted">最多 2000 字</span>
                <button class="btn btn-sm" type="submit">发送</button>
              </div>
            </form>`}
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
                  <span>${last.senderId === me.id ? '我：' : ''}${last.status === 'removed' ? '[已删除的私信]' : esc(last.body)}</span></span>
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
      <p>${isDirect ? `${directUnread ? `${directUnread} 条未读私信` : '查看你的私信对话'}` : (unread ? `${unread} 条未读通知` : '通知已读完')}</p>
    </div>

    <div class="tabs">
      <a class="tab" aria-current="${!isDirect ? 'page' : 'false'}" href="${href('/me/messages')}">通知${unread ? ` · ${unread}` : ''}</a>
      <a class="tab" aria-current="${isDirect ? 'page' : 'false'}" href="${href('/me/messages', { tab: 'direct' })}">私信${directUnread ? ` · ${directUnread}` : ''}</a>
      ${isDirect ? `<button class="icon-btn direct-help" type="button" data-action="direct-mode-info" aria-label="私信说明">${icon('question')}</button>` : ''}
      <span class="grow"></span>
      ${!isDirect && unread ? `<button class="btn btn-quiet btn-sm" type="button" data-action="mark-all-read">全部标为已读</button>` : ''}
    </div>

    ${isDirect ? directContent : `
    <div class="chips mb-3">
      ${['all', 'reply', 'gift', 'system'].map((key) => `<a class="chip chip-sm ${noticeTab === key ? 'is-active' : ''}"
        href="${href('/me/messages', { tab: key === 'all' ? '' : key })}">
        ${key === 'all' ? '全部' : key === 'reply' ? '回复' : key === 'gift' ? '页签' : '系统'}
      </a>`).join('')}
      <span class="grow"></span>
      ${unread ? `<button class="btn btn-quiet btn-sm" type="button" data-action="mark-all-read">全部标为已读</button>` : ''}
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
                <div class="notification-meta">
                  <span>${esc(formatDateTime(n.createdAt))}</span>
                  ${target ? `<a class="link" href="${href(`/posts/${target.id}`)}" ${n.readAt ? '' : `data-action="open-notification" data-notification="${esc(n.id)}" data-href="/posts/${esc(target.id)}"`}>打开相关帖子</a>` : ''}
                  ${!n.readAt ? `<button class="text-button" type="button" data-action="mark-read" data-notification="${esc(n.id)}">标为已读</button>` : ''}
                </div>
              </div>
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

    <p class="tiny muted mt-4">首版只有站内消息：不做私信、邮件营销或浏览器推送。圈内动态用轻量提示，不逐帖群发；归档与静音圈不制造红点焦虑。</p>
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
      </div>

      <div class="card">
        <div class="card-title">收支记录</div>
        ${entries.length ? `<table class="table ledger-table">
          <thead><tr><th>时间</th><th>类型</th><th>变动</th><th>余额</th></tr></thead>
          <tbody>
            ${entries.map((e) => `<tr>
              <td>${esc(formatDateTime(e.at))}</td>
              <td>${esc(LEDGER_LABELS[e.type] || e.type)}${e.note ? `<div class="tiny muted">${esc(e.note)}</div>` : ''}</td>
              <td class="${e.delta > 0 ? 'brand-text' : ''}">${e.delta > 0 ? '+' : ''}${e.delta}</td>
              <td>${e.balanceAfter}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : '<p class="small muted">还没有记录。</p>'}
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

      <details class="card circle-help">
        <summary>页签规则</summary>
        <div class="stack small secondary mt-3">
          <p>· 每个上海自然日可手动领取 1 枚；未领取不补发，无连续签到要求</p>
          <p>· 可送余额可累积到 30 枚；满额时须送出后才可再领</p>
          <p>· 每帖最多 2 枚，每位作者每天最多收你 2 枚，每天最多送出 5 枚</p>
          <p>· 不能自赠；收到页签只计入作者认可，不进入可送余额，不可转赠</p>
          <p>· 赠送成功不可主动撤回；帖子被永久移除时按记录退回，退款可让余额短时超过 30</p>
          <p>· 页签不可购买、提现、私下转账，也不抵扣下载</p>
        </div>
      </details>
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
  const blocked = (db.blocks || []).filter((row) => row.blockerId === me.id)
    .map((row) => ({ user: S.userOf(db, row.blockedId) })).filter((row) => row.user);

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
          <p class="field-help">首版提供 6 款几何默认头像；上传自定义头像需要真实存储服务。</p>
        </div>
        <div class="field">
          <label for="set-nickname">昵称 <span class="label-hint">2–16 个字符，可用化名</span></label>
          <input class="input" id="set-nickname" name="nickname" value="${esc(me.nickname)}" maxlength="16" required>
        </div>
        <div class="field">
          <label for="set-bio">简介 <span class="label-hint">最多 120 字</span></label>
          <textarea class="textarea textarea-sm" id="set-bio" name="bio" rows="2" maxlength="120">${esc(me.bio || '')}</textarea>
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
        <label class="checkbox mb-2"><input type="checkbox" checked disabled>
          <span>系统通知：采纳、审核结果、举报处理、退款（不能关闭）</span></label>
        <p class="field-help">只有站内通知，没有邮件营销和浏览器推送。</p>
        <button class="btn btn-ghost" type="submit">保存设置</button>
      </form>
    </div>

    <div class="card">
      <div class="card-title">账号与数据</div>
      <div class="settings-rows">
        <div class="settings-row">
          <div class="grow"><b>导出我的数据</b><p class="tiny muted">下载一份文件，包含你的资料、发布内容、私信和各项记录。</p></div>
          <button class="btn btn-ghost btn-sm" type="button" data-action="export-my-data">导出</button>
        </div>
        <div class="settings-row">
          <div class="grow"><b>已拉黑的账号</b>
            ${blocked.length ? `<ul class="list-plain blocked-list">${blocked.map(({ user }) => `<li class="row">
                ${avatar(user, 'avatar-xs')}<span class="grow small">${esc(user.nickname)}</span>
                <button class="text-button" type="button" data-action="block-user" data-user="${esc(user.id)}" data-value="0">取消拉黑</button>
              </li>`).join('')}</ul>` : '<p class="tiny muted">没有拉黑任何人。在对方主页或私信里可以拉黑。</p>'}
          </div>
        </div>
        <div class="settings-row">
          <div class="grow"><b>注销账号</b><p class="tiny muted">${me.role === 'admin'
            ? '管理员账号不能在这里注销，请先移交管理权限。'
            : '删除个人资料和私信等数据，发布过的内容可以选择保留或删除，无法恢复。'}</p></div>
          ${me.role === 'admin' ? '' : '<button class="btn btn-danger btn-sm" type="button" data-action="open-delete-account">注销</button>'}
        </div>
      </div>
      <p class="tiny muted mt-3">我们如何处理你的数据：<a class="link" href="${href('/privacy')}">隐私政策</a> · <a class="link" href="${href('/terms')}">用户协议</a></p>
    </div>

    <div class="row wrap mt-4">
      <button class="btn btn-ghost btn-sm" type="button" data-action="logout">退出登录</button>
      ${ctx.config && ctx.config.mode === 'production'
        ? ''
        : '<button class="btn btn-danger btn-sm" type="button" data-action="reset-demo">重置演示数据</button>'}
    </div>
  </div>`;
}






