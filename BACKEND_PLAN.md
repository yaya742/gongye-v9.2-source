# 共页 v2.2 后端化方案（真实可用版）

> 面向：项目负责人 + 后续开发/部署同学。
> 前提：前端已经完成（纯静态，双核心闭环可用），本方案只讨论「怎么让它变成真实可用的系统」。
> 结论：**前端继续静态部署；新增一个独立后端服务（API + Worker）+ PostgreSQL + 私有对象存储**。这是唯一能同时满足「登录可信、权限不可绕过、文件受控、页签账务正确」的形态。

---

## 0. 一页摘要

| 项目 | 结论 |
| --- | --- |
| 前端 | 保持现在的静态站，只把 `state/*` 换成调用 API 的适配层；页面与样式不重写 |
| 后端 | Node.js 22 + Fastify + TypeScript；PostgreSQL 16；S3 兼容私有对象存储；ClamAV 扫描；同一代码库里的 Worker 进程 |
| 认证 | 邮箱验证码 → 服务端会话（HttpOnly Cookie），不把长期令牌放浏览器 |
| 文件 | 预签名直传 → 服务端复核大小/MIME → 扫描 → PDF 转前两页 → 受控下载（代理或 60 秒短链） |
| 页签 | 全部在数据库事务里：唯一约束 + 行锁 + 幂等键；退款由 Worker 逐笔幂等处理 |
| 部署 | 单机 Docker Compose（api / worker / postgres / minio / clamav / caddy）即可支撑试点；后续可拆托管数据库与 OSS |
| 工期 | 单人 5–6 周；两人并行 3–4 周（见第 13 节里程碑） |
| 费用 | 试点约 ¥150–300/月（服务器 + 存储 + 邮件），以云厂商当期报价为准 |
| 主要前置 | 域名 + 大陆服务器需 ICP 备案；邮件域名要配 SPF/DKIM/DMARC |

**为什么不用「纯静态 + 浏览器直连数据库」**：数据库密钥会公开，任何人都能改数据；行级权限靠客户端声明，不可信。**为什么先不自建 Kubernetes**：试点规模用不上，单机 Compose 的备份与恢复更容易做对。

---

## 1. 目标与非目标

### 目标（v1 必须做到）

1. 真实邮箱验证码注册/登录，会话由服务端签发；未验证邮箱不能发布、评论、领取页签、下载。
2. 游客可浏览公开帖子与资料详情；登录后可下载完整 PDF，**不要求入圈、等级或页签**。
3. 资料索引规则与前端一致：公开帖 + 作者确认 + 至少 1 个已扫描通过 PDF + 元信息齐全。
4. 课友圈：按课程 + 学期 + 教学班；加入需确认；禁言、归档、往期真实生效；服务端对每次写入校验。
5. 文件全部私有：上传、扫描、预览图、下载全部经过服务端；删帖后旧链接立即失效。
6. 页签：每日 1 枚、上限 30、赠送四重限额、幂等、永久移除退款，全部事务化。
7. 管理后台：举报处理、隐藏/移除、停用账号、审计；操作留痕不可静默改写。
8. 可运维：健康检查、结构化日志、每日备份、可回滚。

### 非目标（v1 不做）

- 私信、邮件推送、浏览器推送；PDF 全文 OCR；全站财富榜；多校正式学籍认证；推荐算法；移动 App。
- 搜索引擎收录优化（预渲染/SSR 放到 v2）。

---

## 2. 总体架构

```
浏览器（静态站，任意静态托管）
   │  HTTPS + Cookie
   ▼
Caddy / Nginx ──► API（Fastify, Node 22）
                    │         │            │
                    ▼         ▼            ▼
             PostgreSQL    S3 私有桶    邮件服务（验证码）
                    ▲         ▲
                    │         │
              Worker 进程（同一镜像，另一个入口）
                    │
                    ├─ 文件扫描（ClamAV）
                    ├─ PDF 前两页转图（pdftoppm）
                    ├─ outbox：通知、退款、清理
                    └─ 定时任务：预览重建、过期清理
```

- **前端静态**：沿用现有 `DEPLOY_HANDOFF.md` 的部署方式，只改 `apiBase`。
- **API 与 Worker 同镜像**：入口不同（`node dist/api.js` / `node dist/worker.js`），代码与模型共享，减少部署件。
- **对象存储**：试点用 MinIO 容器（同机磁盘），生产切阿里云 OSS / 腾讯云 COS；接口保持 S3 兼容，代码不变。

---

## 3. 技术选型

| 层 | 选型 | 理由 | 备选 |
| --- | --- | --- | --- |
| 运行时 | Node 22 LTS + TypeScript | 前端同语言，团队切换成本低 | Go（更高并发，但人力成本高） |
| Web | Fastify 5 | 轻、插件生态够用（cookie/rate-limit/multipart） | Express（更常见但需自己拼安全件） |
| 数据库 | PostgreSQL 16 | 事务、行锁、唯一约束、trigram 检索都成熟 | MySQL 8（JSON 与部分索引弱一些） |
| ORM/查询 | `pg` + 手写 SQL 仓储层 + SQL 迁移文件 | 页签事务需要显式 `FOR UPDATE`；SQL 透明好审计 | Drizzle ORM（可叠加在迁移之上） |
| 对象存储 | S3 兼容：MinIO（试点）/ OSS / COS | 私有桶 + 预签名，代码不绑供应商 | 本地磁盘（仅本地开发） |
| 扫描 | ClamAV（clamd，TCP） | 免费、可容器化；失败时文件保持不可下载 | VirusTotal API（有外部依赖与费用） |
| PDF 预览 | `pdftoppm`（poppler-utils） | 稳定、资源占用可控 | `mutool` / Ghostscript |
| 图片处理 | `sharp` | 去 EXIF、生成缩略图 | ImageMagick |
| 邮件 | 阿里云邮件推送 / 腾讯云 SES / Resend | 送达率与备案合规 | SMTP 自建（不推荐） |
| 反向代理/TLS | Caddy 2 | 自动 HTTPS，配置短 | Nginx + certbot |
| 日志 | pino（JSON） | 结构化、易采集 | Winston |

**明确不引入**：Redis（试点用 Postgres 计数即可）、消息队列（用 outbox 表）、Kubernetes、GraphQL（接口量不需要）。

---

## 4. 数据模型

与企划书 C 节一致，按实现需要补了 `otp_codes`、`sessions`、`outbox_events`、`rate_events`、`audit_logs`。主键统一 `uuid`，时间统一 `timestamptz`（UTC），展示按 `Asia/Shanghai`。

### 4.1 用户与会话

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  email_verified_at timestamptz,
  nickname text not null check (char_length(nickname) between 2 and 16),
  avatar_key text,
  bio text default '',
  role text not null default 'user' check (role in ('user','admin')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  code_hash text not null,          -- sha256(code + pepper)，不存明文
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on otp_codes (email, created_at desc);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,  -- sha256(随机 32 字节)
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
```

### 4.2 课程 / 圈子 / 成员

```sql
create table courses (
  id uuid primary key default gen_random_uuid(),
  school_scope text not null,
  name text not null,
  normalized_name text not null,    -- 去空格、全角转半角、小写
  course_code text,
  status text not null default 'active',
  unique (school_scope, normalized_name)
);

create table course_circles (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  term text not null,
  section_key text not null,
  display_name text not null,
  teacher text,
  status text not null default 'active' check (status in ('active','archived')),
  pinned_post_id uuid,
  invite_code text unique not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (course_id, term, section_key)
);

create table circle_memberships (
  user_id uuid references users(id) on delete cascade,
  circle_id uuid references course_circles(id) on delete cascade,
  status text not null default 'active' check (status in ('active','left','removed')),
  muted boolean not null default false,
  shelved boolean not null default false,
  write_restricted_until timestamptz,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  primary key (user_id, circle_id)
);
```

### 4.3 内容与文件

```sql
create table posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users(id),
  board text not null check (board in ('notes','help','course','method')),
  circle_id uuid references course_circles(id),
  course_id uuid references courses(id),
  title text,
  body text not null check (char_length(body) between 1 and 20000),
  status text not null default 'published' check (status in ('draft','published','hidden','removed')),
  accepted_comment_id uuid,
  published_at timestamptz not null default now(),
  edited_at timestamptz,
  content_updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid,
  removed_reason text
);
create index on posts (circle_id, published_at desc) where status = 'published';
create index on posts (course_id, published_at desc) where status = 'published';

create table media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  post_id uuid references posts(id) on delete cascade,
  kind text not null check (kind in ('image','pdf')),
  object_key text not null unique,
  mime text not null,
  size_bytes bigint not null,
  pages int,
  sha256 text,
  scan_status text not null default 'pending' check (scan_status in ('pending','clean','infected','error')),
  visibility text not null default 'private',
  created_at timestamptz not null default now()
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  current_version_id uuid,
  status text not null default 'active' check (status in ('active','removed')),
  unique (post_id)   -- 首版：一帖一个 PDF 位；多附件用 versions 扩展
);

create table attachment_versions (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references attachments(id) on delete cascade,
  media_id uuid not null references media(id),
  version_no int not null,
  change_note text default '',
  created_at timestamptz not null default now(),
  unique (attachment_id, version_no)
);
```

> 现状说明：演示版里一个帖子可带多个 PDF，索引按「至少一个 ready」判断。生产建议保留「一帖多附件」，把 `attachments` 的唯一约束去掉，`resource_shares` 仍按 `post_id` 唯一。**v1 先实现一帖多附件**（与前端一致），`attachment_versions` 保留版本能力。

### 4.4 资料索引

```sql
create table resource_shares (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references posts(id) on delete cascade,
  title text not null,
  course_id uuid not null references courses(id),
  school_scope text not null,
  applicable_term text not null,
  resource_type text not null,
  coverage text not null,
  limitations text,
  index_enabled boolean not null default false,
  status text not null default 'processing' check (status in ('processing','indexed','unindexed','blocked')),
  content_updated_at timestamptz not null default now()
);

-- 可重建投影：写入与索引在同一事务里维护，读列表仍校验 posts/attachments 状态
create table resource_search_documents (
  resource_id uuid primary key references resource_shares(id) on delete cascade,
  title text not null,
  body_excerpt text,
  course_name text,
  term text,
  resource_type text,
  tags text[],
  available_file_count int not null default 0,
  search_text text not null,        -- 规范化后的可检索文本
  updated_at timestamptz not null default now()
);
create index on resource_search_documents using gin (search_text gin_trgm_ops);
```

### 4.5 互动、页签、消息、审计

```sql
create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  author_id uuid not null references users(id),
  parent_id uuid references comments(id),
  reply_to_user_id uuid references users(id),
  body text not null check (char_length(body) between 1 and 2000),
  status text not null default 'visible' check (status in ('visible','hidden','removed')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create table reactions (
  user_id uuid references users(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  kind text not null check (kind in ('like','save')),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id, kind)
);

create table wallets (
  user_id uuid primary key references users(id) on delete cascade,
  spendable_balance int not null default 0 check (spendable_balance >= 0),
  updated_at timestamptz not null default now()
);

create table daily_claims (
  user_id uuid not null references users(id) on delete cascade,
  claim_date date not null,                    -- 上海自然日，服务端计算
  ledger_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, claim_date)            -- 并发领取的最终防线
);

create table bookmark_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  delta int not null,
  type text not null check (type in ('claim','gift_out','gift_refund','admin_adjust')),
  source_id uuid,
  balance_after int not null,
  created_at timestamptz not null default now(),
  unique (type, source_id, user_id)            -- 同一来源只入账一次
);

create table bookmark_gifts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references users(id),
  receiver_id uuid not null references users(id),
  post_id uuid not null references posts(id),
  quantity int not null check (quantity between 1 and 2),
  gift_day date not null,
  status text not null default 'active' check (status in ('active','refunded')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (sender_id, idempotency_key),
  check (sender_id <> receiver_id)
);
create index on bookmark_gifts (sender_id, gift_day);
create index on bookmark_gifts (sender_id, receiver_id, gift_day);
create index on bookmark_gifts (sender_id, post_id);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references users(id) on delete cascade,
  actor_id uuid references users(id),
  type text not null,
  post_id uuid,
  comment_id uuid,
  text text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (recipient_id, created_at desc);

create table outbox_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now()
);
create index on outbox_events (processed_at, next_attempt_at);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  target_type text,
  target_id uuid,
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
```

---

## 5. 认证与会话

1. `POST /auth/code`：邮箱格式校验 → 冷却检查（同邮箱 60 秒、同 IP 每小时 10 次）→ 生成 6 位码（`crypto.randomInt`）→ 存 `sha256(code + pepper)`，10 分钟过期，最多 5 次尝试 → 调邮件服务。
2. `POST /auth/verify`：校验验证码（未过期、未消费、次数未超）→ 若用户不存在则创建（`email_verified_at = now()`）→ 写 `sessions`（随机 32 字节，存 hash）→ 下发 Cookie：`gy_sess`，`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`。
3. `POST /auth/logout`：`revoked_at = now()` 并清 Cookie。
4. 每个请求：读 Cookie → 查 session（未过期、未撤销、用户未停用）→ 挂到 `request.user`。会话滑动续期（只在 > 7 天未活跃时更新）。
5. CSRF：所有写请求校验 `Origin`/`Referer` 属于 `APP_ORIGIN`；同时校验自定义头部 `X-Requested-With: gongye`（简单、够用）。
6. 停用账号：`users.status = 'suspended'` 后所有写操作与领取、下载都拒绝（中间件统一拦截）。

**不做**：把 access token 放 `localStorage`；无状态 JWT 吊销困难，本产品需要「封号立即生效」。

---

## 6. 权限模型（服务端每次校验）

| 操作 | 规则 |
| --- | --- |
| 浏览帖子/资料 | 公开；`status != published` 仅作者/管理员可见 |
| 发帖到圈 | 圈 `active` + 成员 `active` + 未静音 + 未限制 + 账号正常 + 邮箱已验证 |
| 发公开帖（不挂圈） | 登录 + 验证；资料帖必须关联课程 |
| 评论普通圈帖 | 圈内 `active` 成员 + 未禁言 + 圈未归档 |
| 评论资料原帖 | 登录 + 验证即可（非成员可纠错）；但该圈禁言/限制/归档仍然生效 |
| 下载 | 登录 + 验证 + 账号正常 + 附件 `clean` + 帖子 `published`；**不检查**入圈/等级/页签 |
| 领取页签 | 登录 + 验证 + 账号正常 + 当日未领 + 余额 < 30 |
| 赠送 | 登录 + 验证 + 账号正常 + 非本人 + 帖子公开 + 四重限额 + 余额足够 |
| 采纳 | 帖子作者 + 板块为求助 + 评论属于该帖 + 非作者本人 |
| 管理操作 | `role = 'admin'` + 必填理由 + 写审计 |
| 建圈申请 | 登录 + 验证；审核通过才建圈 |

实现方式：每个路由声明 `preHandler`（认证）+ 资源级 `assertCan*` 函数；拒绝时返回稳定错误码（前端按码提示）。

---

## 7. 文件链路

1. **申请上传** `POST /media/upload-url`：登录 + 归属校验 → 校验大小上限（图片 10 MiB、PDF 50 MiB）与 MIME 白名单 → 生成随机键 `u/{userId}/{uuid}.pdf` → 返回预签名 PUT（含 `Content-Length` 限制，15 分钟有效）。
2. **完成登记** `POST /media/complete`：服务端 `HEAD` 对象复核真实大小与 `Content-Type`；计算 sha256；写 `media(scan_status='pending')`；投递 outbox `scan.requested`。
3. **扫描** Worker：下载对象到临时目录 → clamd 扫描 → 更新 `scan_status`；感染则标记 `infected` 并通知作者；通过则 `clean` 并投递 `preview.requested`。
4. **预览** Worker：`pdftoppm -f 1 -l 2 -r 96 -png` → 转 webp → 上传到 `previews/{mediaId}/1.webp`、`2.webp` → 写 `media_previews`。
5. **发布**：帖子只引用 `media_id`；只有 `clean` 的附件计入 `available_file_count`，资料才可 `indexed`。
6. **下载** `GET /resources/:id/download?attachment=...`：
   - 校验登录、附件 clean、帖子公开；
   - 默认**流式代理**（便于删帖后立即阻断），设置 `Content-Disposition` 与 `Content-Length`；
   - 大文件可选 302 到 60 秒签名 URL（需接受"短链窗口"）。
7. **删除/下架**：帖子 `removed` 时立即置 `attachments.status='removed'`、`resource_shares.status='blocked'`；对象清理由 Worker 延迟执行。
8. **图片**：上传后由 Worker `sharp` 去 EXIF、生成 3 档缩略图；原图仅登录用户可见（按帖子可见性）。

---

## 8. 页签事务（必须照抄的写法）

### 8.1 领取

```sql
-- 单事务
select id, spendable_balance from wallets where user_id = $1 for update;       -- 锁钱包
insert into daily_claims (user_id, claim_date, ledger_id)
values ($1, $2, gen_random_uuid())
on conflict (user_id, claim_date) do nothing
returning ledger_id;                                                            -- 已领则返回空
-- 若上面没有返回行 → 直接回滚并返回「今日已领」
update wallets set spendable_balance = spendable_balance + 1, updated_at = now()
where user_id = $1 and spendable_balance < 30 returning spendable_balance;      -- 满额则不更新
insert into bookmark_ledger (id, user_id, delta, type, source_id, balance_after)
values ($3, $1, 1, 'claim', null, $balance);
-- 并发重复请求：primary key 冲突使其只成功一次；余额不会 +2
```

### 8.2 赠送

```sql
-- 单事务；先锁发送者钱包，串行化当日限额
select spendable_balance from wallets where user_id = $sender for update;
select id, author_id, status from posts where id = $post for update;            -- 锁帖子
-- 幂等：unique (sender_id, idempotency_key)；已存在则按原参数返回原结果，参数不同返回冲突
-- 限额查询（在锁内）：
--   sum(quantity) where sender_id=$sender and gift_day=$today       <= 5
--   sum(quantity) where sender_id=$sender and receiver_id=$author and gift_day=$today <= 2
--   sum(quantity) where sender_id=$sender and post_id=$post and status='active' <= 2
insert into bookmark_gifts (...) values (...);
insert into bookmark_ledger (...) values (...);
update wallets set spendable_balance = spendable_balance - $qty where user_id = $sender;
insert into outbox_events (type, payload) values ('notification.gift', ...);
```

### 8.3 退款（Worker）

```sql
-- 逐笔处理，锁顺序固定：gift → 发送者钱包，避免死锁
select * from bookmark_gifts where id = $gift for update;
-- 仅 active → refunded 一次
update bookmark_gifts set status = 'refunded' where id = $gift and status = 'active';
select spendable_balance from wallets where user_id = $sender for update;
update wallets set spendable_balance = spendable_balance + $qty where user_id = $sender;  -- 允许超过 30
insert into bookmark_ledger (user_id, delta, type, source_id, balance_after)
values ($sender, $qty, 'gift_refund', $gift, $after)
on conflict (type, source_id, user_id) do nothing;                              -- 重跑不重复入账
insert into notifications (...) values (...);
```

要点：
- **唯一约束是最后防线**，不是可选优化；
- 不允许「先读限额再更新」的无锁写法；
- 客户端金额只用服务端返回值，不做乐观更新；
- 退款任务可重跑，结果幂等。

---

## 9. 接口清单（REST）

统一：`/api` 前缀；`limit` 上限 50；游标 `?cursor=`；错误体 `{ error: { code, message } }`；写接口要求 JSON + `Origin` 校验。

| 分组 | 方法 + 路径 | 说明 |
| --- | --- | --- |
| 认证 | `POST /auth/code`、`POST /auth/verify`、`POST /auth/logout`、`GET /auth/me` | 验证码、登录、退出、当前用户 |
| 帖子 | `GET /posts`、`GET /posts/:id`、`POST /posts`、`PATCH /posts/:id`、`DELETE /posts/:id` | 列表筛选、详情、发布、编辑、删除 |
| 评论 | `GET /posts/:id/comments`、`POST /posts/:id/comments`、`DELETE /comments/:id`、`POST /posts/:id/accept`、`DELETE /posts/:id/accept` | 两层结构、采纳 |
| 互动 | `PUT/DELETE /posts/:id/like`、`PUT/DELETE /posts/:id/save`、`PUT/DELETE /follows/user/:id`、`PUT/DELETE /follows/course/:id` | 幂等 |
| 资料 | `GET /resources`、`GET /resources/:id`、`POST /resources`、`PATCH /resources/:id/index`、`GET /resources/:id/download` | 检索、详情、发布、收录开关、下载 |
| 文件 | `POST /media/upload-url`、`POST /media/complete`、`GET /media/:id/status`、`GET /media/:id/previews` | 上传、复核、扫描状态、预览 |
| 圈 | `GET /circles`、`GET /circles/:id`、`GET /circles/:id/posts`、`POST /circles/:id/join`、`POST /circles/:id/leave`、`PATCH /circles/:id/settings`、`POST /circles/:id/seen`、`GET /invites/:code` | 找圈、圈页、入退、静音/往期、已读游标、邀请 |
| 申请 | `POST /circle-applications` | 建圈申请 |
| 课程 | `GET /courses`、`GET /courses/:id`、`POST /courses/:id/collect` | 目录、课程页、作者收录 |
| 搜索 | `GET /search` | `q`、`tab=posts|courses|users`、`hasAttachment` |
| 页签 | `GET /bookmarks`、`GET /bookmarks/state`、`POST /bookmarks/claim`、`POST /bookmarks/gifts`、`GET /bookmarks/ledger` | 余额、今日状态、领取、赠送、流水 |
| 消息 | `GET /notifications`、`POST /notifications/:id/read`、`POST /notifications/read-all`、`PATCH /me/preferences` | |
| 举报 | `POST /reports` | |
| 管理 | `GET /admin/reports`、`POST /admin/reports/:id/resolve`、`GET /admin/circles`、`POST /admin/circles/:id/archive`、`GET /admin/users`、`PATCH /admin/users/:id/status`、`GET /admin/audit` | 全部写 `audit_logs` |
| 我的 | `PATCH /me`、`GET /me/posts`、`GET /me/saves` | 资料、帖子、收藏 |
| 健康 | `GET /healthz`、`GET /readyz` | 存活 / 就绪（含数据库与存储探测） |

---

## 10. 前端改造（文件级）

| 文件 | 改动 |
| --- | --- |
| `src/config.js` | `mode` 增加 `'production'`，`apiBase` 指向 API |
| 新增 `src/api/client.js` | `fetch` 封装：`credentials: 'include'`、统一错误码、超时、`X-Requested-With` 头 |
| `src/state/store.js` | 生产模式下不再读写 `localStorage`，只缓存 UI 偏好；会话来自 `GET /auth/me` |
| `src/state/actions.js` | 改为调用 API；保留轻量前端校验（即时提示），**权威校验在服务端** |
| `src/state/selectors.js` | 列表/详情改由接口返回；保留纯展示辅助（时间、等级、标签） |
| `src/data/seed.js` | 移出前端产物（或仅 demo 模式动态加载） |
| `src/pages/*` | 基本不动；错误提示按服务端 `code` 映射文案 |
| 新增 `src/api/types.d.ts` | 与后端共享的响应类型（可用 OpenAPI 生成） |

**保留演示模式**：`mode: 'demo-static'` 时继续走本地仓库，方便评审与离线演示；生产模式走 API。这样静态部署文档仍然成立，只是多一个 `apiBase`。

---

## 11. 部署拓扑

试点（单机）：

```yaml
# docker-compose.yml（示意）
services:
  caddy:     { image: caddy:2, ports: ["80:80","443:443"], volumes: [./Caddyfile:/etc/caddy/Caddyfile, caddy_data:/data] }
  api:       { build: ., command: node dist/api.js, env_file: .env, depends_on: [postgres, minio, clamav] }
  worker:    { build: ., command: node dist/worker.js, env_file: .env, depends_on: [postgres, minio, clamav] }
  postgres:  { image: postgres:16, volumes: [pgdata:/var/lib/postgresql/data], env_file: .env }
  minio:     { image: minio/minio, command: server /data --console-address ":9001", volumes: [miniodata:/data] }
  clamav:    { image: clamav/clamav:stable }
volumes: { pgdata: {}, miniodata: {}, caddy_data: {} }
```

- 服务器建议 **2 vCPU / 4 GB / 60 GB SSD** 起步（ClamAV 占内存，低于 4 GB 会紧张）。
- 前端：同机 Caddy 托管静态目录，或继续用 Cloudflare Pages/Vercel（但要接受 API 跨域与 Cookie 配置）。
- 备份：每天 `pg_dump -Fc` 到对象存储，保留 14 天；每月做一次恢复演练。
- 日志：pino JSON → 文件 + 轮转，保留 ≥ 6 个月（合规要求）。
- 监控：`/healthz` 探活 + 简单 uptime 监控；错误率高时先看日志与 outbox 积压。

生产演进（用户量上来后）：
1. Postgres 换托管实例、对象存储换 OSS/COS；
2. Worker 独立机器（扫描/转图吃 CPU 与内存）；
3. 引入 Redis 做限流与缓存；
4. 静态前端上 CDN。

---

## 12. 环境变量与密钥

```
NODE_ENV=production
APP_ORIGIN=https://gongye.example.com
API_ORIGIN=https://api.gongye.example.com
PORT=8080
DATABASE_URL=postgres://gongye:***@postgres:5432/gongye
SESSION_SECRET=            # 会话/验证码 pepper
MAIL_PROVIDER=aliyun|tencent|resend|smtp
MAIL_API_KEY=
MAIL_FROM="共页 <no-reply@gongye.example.com>"
STORAGE_ENDPOINT=          # MinIO 内网地址或 OSS endpoint
STORAGE_BUCKET=gongye-private
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_REGION=
SCAN_SERVICE_URL=tcp://clamav:3310
PREVIEW_TMP_DIR=/tmp/gongye
LOG_LEVEL=info
```

规则：**只有服务器持有这些**；前端 `config.js` 只允许 `apiBase`、`mode`、`demoNotice` 这类公开值。

---

## 13. 里程碑与验收

| 里程碑 | 内容 | 交付 | 验收 |
| --- | --- | --- | --- |
| **M0**（2–3 天） | 仓库骨架、迁移工具、Docker Compose、日志/健康检查、CI（lint + test） | 本地一条命令起全套 | `/healthz` 200；迁移可重复执行 |
| **M1**（1 周） | 认证（OTP + 会话）、用户、课程/圈目录、帖子与资料只读接口、搜索 | 游客可浏览全站 | 未登录能看帖子/资料；登录后 `GET /auth/me` 正确；错误码稳定 |
| **M2**（1 周） | 发帖/编辑/删除、评论与采纳、点赞收藏、入圈/退圈/静音/往期、资料发布与索引、举报 | 双核心写入闭环 | 权限矩阵用例全过；非成员不能评论普通圈帖；归档只读 |
| **M3**（1 周） | 上传签名、复核、扫描、预览转图、受控下载、图片 EXIF 与缩略图 | 真实 PDF 可上传、预览、下载 | 伪 PDF/超大文件/未扫描文件下载被拒；删帖后链接立即 403 |
| **M4**（1 周） | 页签领取/赠送/退款、消息、管理后台、审计 | 账务可用 | 并发 20 次领取只 +1；限额与幂等测试；退款重跑不重复 |
| **M5**（3–5 天） | 限流、越权与 XSS 测试、备份恢复演练、压测、上线检查表 | 可上线 | 第 14 节清单全绿；回滚演练成功 |

单人 5–6 周；两人并行（一人后端一人前端适配/测试）约 3–4 周。**M1–M2 完成即可邀请小范围真实用户**（此时还没有文件下载，资料只能看元信息）。

---

## 14. 测试策略与验收清单（对应企划 H 节）

自动化（后端仓库）：

- 单元：限额计算、权限判断、URL/键生成、Markdown 清洗。
- 集成（真实 Postgres，容器内）：认证流程、资料索引条件、入圈幂等、评论权限矩阵、页签事务。
- **并发**：20 个请求同时领取 → 余额 +1；同幂等键并发赠送 → 一笔；赠送与删帖并发 → 不丢钱。
- **越权**：改 `postId` 评论他人圈、伪造 `courseId`、退圈后提交旧草稿、被移出后重入、上传对象归属劫持。
- **文件**：伪 PDF（改扩展名）、超大文件、未扫描下载、签名过期、删除后旧链接。
- **XSS**：正文与评论注入 `<script>`、`javascript:` 链接、Markdown 图片外链。
- 迁移：空库 → 最新；回滚一步；重复执行幂等。

人工验收：双账号两浏览器完整走一遍「游客找资料 → 登录下载 → 自愿入圈 → 发帖 → 回复 → 回访」，以及管理后台处理一条举报。

---

## 15. 成本与合规（需按当期报价核实）

| 项 | 试点估算 | 说明 |
| --- | --- | --- |
| 云服务器 2C4G | ¥100–200/月 | 活动价更低；ClamAV 吃内存，不建议 2 GB |
| 对象存储 + 流量 | ¥5–30/月 | 小规模，图片/PDF 不大 |
| 邮件推送 | ¥0–50/月 | 有免费额度，量大按量计费 |
| 域名 | ¥40–80/年 | |
| 备案 | 免费，需 7–20 个工作日 | 大陆服务器 + 域名必须备案 |
| 合计 | **约 ¥150–300/月** + 人力 | 不含内容审核人力 |

合规要点：

- 大陆服务器上的域名需 **ICP 备案**；用境外服务器则无备案但访问速度与合规风险另议。
- UGC 站点需要：用户协议与隐私说明、举报入口（已有）、违法信息处置流程、**网络日志留存 ≥ 6 个月**。
- 邮件发信域名配置 **SPF / DKIM / DMARC**，否则验证码容易进垃圾箱。
- 文件版权：保留「上传者确认有权分享」记录；对整本教材扫描件保留下架与申诉流程。
- 不要采集学号、完整课表、精确位置；不做「学校官方认证」表述。

---

## 16. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 验证码邮件进入垃圾箱 | 新用户无法注册 | 配置 SPF/DKIM/DMARC；提供「重发」与备用邮件通道；监控送达率 |
| 扫描/转图占满 CPU | 上传后长时间不可下载 | 单独 Worker + 队列限并发；明确「处理中」状态（前端已支持） |
| 页签并发或重试导致余额错误 | 用户信任受损 | 唯一约束 + 行锁 + 幂等键；上线前跑并发测试 |
| 存储与下载盗链 | 流量费用与版权风险 | 私有桶、短时签名或代理下载、Referer/Origin 校验、限流 |
| 成本超预期 | 项目停摆 | 先单机试点，按流量再拆；设置存储与流量告警 |
| 内容合规事件 | 站点被要求下线 | 举报流程 + 24 小时内处置 + 审计留痕；准备「紧急隐藏全部文件」开关 |

---

## 17. 需要你确认的 5 件事

1. **用户在哪里访问**：大陆为主（→ 国内云 + 备案 + 国内邮件服务）还是境外为主（→ 可用 Cloudflare/Supabase）？
2. **月预算**：¥150–300/月 的试点成本是否可接受？
3. **域名与备案**：是否已有域名？是否愿意走 ICP 备案？
4. **邮件服务**：用哪家（阿里云邮件推送 / 腾讯云 SES / Resend）？
5. **上线范围**：校内小范围邀请（可以先不做公开注册）还是完全公开注册？

确认后我建议的推进顺序：**M0 骨架 + M1 认证与只读** 先做，做完就能让真实用户登录浏览；然后再做写入、文件、页签。

---

## 18. 备选方案：Supabase 映射（若选海外/香港）

如果决定走 BaaS（最快上线），按下面映射即可，前端改造思路不变：

| 本方案 | Supabase 对应 |
| --- | --- |
| PostgreSQL 表 | 直接用；迁移用 `supabase db push` |
| 业务校验 | Postgres Row Level Security + `security definer` 函数（页签事务必须写成 SQL 函数） |
| 认证 | Supabase Auth 邮箱 OTP（自带限流与 Cookie 兼容的会话） |
| 文件 | Storage 私有桶 + 签名 URL；扫描仍需自建 Worker（Edge Function 跑不了 ClamAV） |
| Worker | 一台小机器或 GitHub Actions 定时任务 |
| 反向代理 | 不需要（平台托管） |

注意：Supabase 在大陆访问速度不稳定；邮件送达与合规需实际验证。**页签事务仍然只能用 SQL 函数实现**，不要在 Edge Function 里用内存计数。

---

## 19. 附：与现有静态站的关系

- 现有静态站**不需要重写**：上线后它变成「前端 + 演示模式」双用途，`mode: 'demo-static'` 继续可用。
- 现在的部署文档 `DEPLOY_HANDOFF.md` 依然适用于前端；后端按本方案单独部署，域名建议 `api.xxx`。
- 数据库与接口完成后，`IMPLEMENTATION_STATUS.md` 里「未实现」的清单即可逐项划掉。

---

*本方案中的版本号、价格、工期均为工程估算，需以实际环境与云厂商当期报价为准。*

---

## 20. 内部试点版（国内、5–20 人、暂不公开注册）

场景：只有内部工作人员注册试用，验证真实登录、发帖、入圈、页签与文件流程。**这个阶段不需要备案、不需要对外宣传、也不需要完整运营能力。**

### 20.1 先选“怎么让同事访问到”

| 方式 | 适合 | 需要 | 优点 | 风险 / 代价 |
| --- | --- | --- | --- | --- |
| **A. 局域网访问**（办公电脑或内网服务器） | 同事在同一办公室/校园网 | 一台常开的电脑 + Docker | 零成本、零备案、随时关停 | 只能内网访问；电脑需常开 |
| **B. Cloudflare Tunnel**（把 A 暴露到公网） | 同事不在同一网络、需要 https | Cloudflare 免费账号 | 自动 HTTPS、不占公网端口、不涉及备案（服务在本地）、可随时关闭 | 国内访问速度一般；依赖隧道进程；域名是临时的（也可绑自己的域名） |
| **C. 国内云服务器 + 已备案域名** | 试点要稳定、长期 | 轻量服务器 + 备案域名 | 速度最好、最正式 | 备案需 7–20 个工作日；服务器约 ¥100–200/月 |
| D. 境外/香港小服务器 + 域名 | 不想备案、要稳定 | 服务器 + 域名 | 无需备案 | 大陆访问延迟较高，邮件与合规另议 |

**建议**：先用 **A** 把功能跑通（今天就能开始）；如果试用同事不在同一网络，再加 **B**（半小时能配好）；等确认要继续做，再走 **C** 的备案与正式部署。

> 说明：在大陆服务器上用域名对外提供 80/443 服务需要 ICP 备案；直接 IP + 非标准端口可以访问但通常没有 HTTPS，不建议长期使用。Cloudflare Tunnel 的特点是服务跑在你们自己的机器上，公网入口在 Cloudflare，因此不涉及大陆服务器备案。

### 20.2 邮件验证码：先别卡在“发信”上

| 方式 | 做法 | 适合 |
| --- | --- | --- |
| **企业邮箱 SMTP**（推荐先用） | 用公司/学校已有的腾讯企业邮、阿里企业邮账号发信 | 已有企业邮箱，几分钟配好 |
| 邮件推送服务（阿里云/腾讯云） | 需要发信域名 + DNS 验证（SPF/DKIM）+ 实名审核 | 正式上线、发信量大 |
| **白名单 + 固定验证码**（最快） | 只允许指定邮箱注册，验证码固定 `123456` 并写服务端日志 | 5–10 人内部试用，第一天就能跑 |

三种方式在代码里是同一个 `MailAdapter` 接口，切换只改环境变量。**试用期建议**：白名单 + 企业邮箱 SMTP 二选一，白名单必须默认开启——只有名单内邮箱能注册，等于关闭公开注册。

### 20.3 试点版后端范围（分两步，别一次做完）

**Pilot-1（3–4 天）——能注册、能看、能发、能领签**

- 认证：邮箱验证码（白名单）→ 会话 Cookie；`GET /auth/me`；退出。
- 只读：课程/圈目录、帖子列表与详情、资料列表与详情、搜索（复用现有规则）。
- 写入：发帖/编辑/删除、评论与回复、点赞收藏、入圈/退圈/静音、资料发布与索引。
- 页签：领取、赠送、流水、限额（事务写法见第 8 节）。
- 通知：回复、采纳、赠签（站内）。
- 管理：一个最小后台（举报处理 + 停用账号）。

**Pilot-2（3–4 天）——真实文件**

- 上传（先落本地磁盘，接口按 S3 兼容设计）、大小/MIME 复核。
- 扫描：Docker 起 ClamAV；未通过不可下载。
- 预览：`pdftoppm` 转前两页，替换现在的演示 SVG。
- 下载：受控代理，删帖立即失效。
- 图片：去 EXIF、缩略图。

**明确不做**：公开注册、邀请码分发、CDN、全文检索优化、邮件通知、多校、备案相关页面。

### 20.4 试点期间的合规与安全（内部也要做）

1. **默认关闭公开注册**：`ALLOWED_EMAILS` 或 `ALLOWED_DOMAINS` 白名单，非名单邮箱直接拒绝并记录。
2. **告知**：给试用同事一句话说明——「这是内部试用，仅用于课程资料与讨论测试，请勿上传他人隐私或整本教材；可随时要求删除账号」。不需要长篇隐私政策，但不能没有。
3. **日志**：登录、发布、删除、管理操作留日志；内部试用也保留 ≥ 30 天，转正式后按 6 个月执行。
4. **一个总开关**：环境变量 `READ_ONLY=1` 或后台「暂停写入」，出问题能 1 分钟内关掉写操作。
5. **数据最小化**：只存邮箱、昵称、内容；不收集学号、课表、位置。
6. **能导出与删除**：管理员可导出某用户内容、可彻底删号，用于试用结束后的清理。

### 20.5 时间表（单人）

| 时间 | 事项 |
| --- | --- |
| 第 1 天 | M0 骨架：仓库、Compose、迁移、日志、健康检查、白名单认证跑通 |
| 第 2–3 天 | Pilot-1 只读 + 发帖/评论/入圈 + 页签 + 站内消息 |
| 第 4 天 | 内部 3–5 人走查，修权限与文案问题；确定要不要做 Pilot-2 |
| 第 5–7 天 | 文件上传/扫描/预览/下载（若需要真实资料） |
| 第 8 天 | 部署到内网/隧道，给同事发试用说明与账号白名单 |

### 20.6 需要你准备的东西（Pilot-1 只要前 3 项）

1. 一台常开的电脑或服务器（2C4G 起；办公电脑 8G 内存也够），装好 Docker Desktop / Docker Engine。
2. 试用同事的邮箱名单（5–20 个）。
3. 一个管理员邮箱（用于后台账号）。
4. （可选）企业邮箱 SMTP 账号与授权码。
5. （可选，Pilot-2 前）云服务器与域名；如需外网访问，Cloudflare 账号。

### 20.7 已经做出来的最小版本

不用等服务器：`server/` 里已经实现了这一节描述的**最小真实后端**（零依赖、单进程、JSON 文件存储），前端在 `mode: 'production'` 下走同一套动作接口。使用说明见 [PILOT.md](PILOT.md)，验收脚本 `node tests/pilot.test.mjs` 与 `node scripts/qa-pilot.mjs`。

它覆盖：白名单注册/登录（HttpOnly Cookie）、服务端执行发帖/评论/入圈/页签等业务规则、状态脱敏、数据随时清空。**尚未覆盖**：真实文件上传与扫描、真实邮件、HTTPS、多实例与备份——这些仍按本方案第 13 节推进。

### 20.8 试点结束后的三个去向

1. **继续做**：按第 13 节补 M3–M5，走备案与正式域名，开放邀请码。
2. **只保留演示**：把后端下线，前端回到 `demo-static`，用于产品评审。
3. **限期归档**：导出内容、删除账号与文件、销毁数据库与对象存储。
