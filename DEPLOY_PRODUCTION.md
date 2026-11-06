# 共页 v10 部署与运营交接

## 1. 版本边界

保留现有 HTML/CSS/ES Modules 前端、全校课程目录及「一门课一个圈」。默认启动改为真实服务端：可信邮箱 OTP、SQLite 共享状态、Cookie 会话、私有 PDF 上传与受控下载。

这是一套**单实例起步部署**，不是已经压测的全校并发平台。资料目录覆盖全校，不等于课程信息、授权材料或同时在线容量已全部核实。邮件、扫描、服务器和已有资料尚需运营方提供；不得未经授权公开历史资料。

`npm run dev` 仍是独立静态演示。不要向真实用户发布演示服务器，也不要把固定码试用后端当作登录服务。历史 DEPLOY/PILOT 文档不适用于本版本生产部署。

## 2. 依赖与首次启动

- Node.js ≥ 22.13.0（含 `node:sqlite`；实验警告不表示测试失败）。
- 安装：`npm ci --ignore-scripts`；Windows 执行策略拦截 npm.ps1 时用 `npm.cmd`。
- 校验：`npm test`、`npm run check`、`npm audit --omit=dev`。
- 生产进程：`npm start`，不要使用静态文件服务器代替 API 服务。
- 公网用 HTTPS 反向代理，同一域名转发静态页面和 `/api/*`；禁止把完整工程根目录作为公开下载目录。
- 持久磁盘保存 SQLite 和私有文件目录，进程使用非管理员账号，不对外开放 ClamAV 端口。

## 3. 环境配置（示例不是实际凭证）

进程管理器或安全的环境变量系统注入下表；当前入口不会自动加载 `.env` 文件（`gongye/.env.example` 只是变量清单示例，复制后仍需由部署工具注入）。不要把密码写入前端 `src/config.js`、浏览器、仓库或聊天。需要本机测试秘密时应使用密钥保管工具。

| 变量 | 用途与默认 |
| --- | --- |
| PUBLIC_ORIGIN | 正式外部来源，如 `https://study.example.org`；本机可 `http://127.0.0.1:8787` |
| HOST / PORT | 默认 `127.0.0.1` / `8787`；公网监听需配置 HTTPS PUBLIC_ORIGIN |
| DATA_FILE | 默认 `server/data/production.sqlite`；只允许服务账号访问，私有上传默认为同目录 `uploads/` |
| ZJU_EMAIL_DOMAINS | 逗号分隔精确域名，默认 `zju.edu.cn,st.zju.edu.cn`；不接受任意子域通配 |
| ADMIN_EMAILS | 逗号分隔管理员邮箱；仍须真实收码验证，名单不构成登录凭证 |
| SMTP_HOST / SMTP_PORT | 邮件服务器与端口，二者均须显式配置；587常用于STARTTLS |
| SMTP_SECURE | 必须显式 `true`/`1` 或 `false`/`0`；true直接TLS（通常465），false强制STARTTLS；按服务商配置 |
| SMTP_USER / SMTP_PASS | 邮件服务账号和凭证，两者均为必填 |
| MAIL_FROM | 经邮件商允许的发件邮箱/地址；须配置，不能伪造校方发件人 |
| SUPPORT_EMAIL | 可公开接收版权、隐私、申诉的邮箱；正式公开前必须核实可收信 |
| CLAMAV_HOST / CLAMAV_PORT | clamd TCP INSTREAM，PORT 默认3310；HOST未设置时上传503，不会绕过扫描 |

```powershell
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:8787'
$env:HOST = '127.0.0.1'
$env:PORT = '8787'
$env:ZJU_EMAIL_DOMAINS = 'zju.edu.cn,st.zju.edu.cn'
# 其它邮件、扫描和管理员变量由运营方通过安全环境注入。
npm.cmd start
```

邮件未配置仍可启动公开只读页面，但登录按钮禁用/请求503。扫描未配置不能上传；这不是故障回退理由。服务器不信任任意 X-Forwarded-For，代理后所有请求可能共用一个IP限额，应在受信反向代理层另做有界限流，切勿直接信任客户端伪造头。

## 4. 文件与权限

真实上传接口接收 PDF 二进制，不接受客户端的 path/ready/pages 作为扫描结果。只有本人尚未绑定的可信 uploadId 可提交；扫描、结构检查和预览失败不会发布。当前仅支持 PDF，单文件默认 20 MiB，最多 3 个附件。

游客可看公开帖子和前两页 PNG 预览。完整文件须活跃且邮箱已验证的账号，每次请求重新检查原帖、作者、附件状态；不要求先加入课程圈。移除、隐藏、封禁后旧链接失效。取消找资料索引不删除原帖，也不会撤销原帖仍允许的附件访问。

技术扫描不能证明版权、准确性或绝对安全。运营方仍需举报处理、版权核查、备份、滥用响应和更新依赖。

## 5. 已有资料如何迁入

1. 保留原文件只读备份，先列作者、课程、年份/学期、标题、适用章节、缺漏及授权证据。不知道来源或权利范围的项目先不公开。
2. 复制 `migration/manifest.example.json` 为自己的清单，资料 PDF 放在同目录子目录。清单里的 `file` 是相对路径，禁止越出清单目录。
3. 执行 `npm run import:preview -- ./migration/manifest.json`。只读检查课程 ID、文件头、大小、重复和元信息，不写数据库、不发网络请求、不自动发布。检查通过不是病毒扫描或版权审查通过。
4. 用已完成真实邮箱验证的授权账号逐份经正常上传入口扫描、预览并确认分享。独立资料投稿不要求加入课程圈。
5. 先预检少量有代表性的资料，检查课程、预览、下载、下架和来源展示，再继续其余。不要把历史资料伪装成当前学生原创；代为迁入时注明原作者及授权。
6. 当前未提供无需确认的大规模自动发布命令，避免绕过扫描和授权。资料数量明确后可再做带预检和逐批确认的导入工具。

## 6. 备份与恢复

- SQLite WAL 模式不能在运行时只复制主 `.sqlite` 文件，否则可能遗漏 WAL 中的提交。
- 起步阶段推荐停止服务后，将完整数据库目录和私有文件目录作为**同一时间点**备份，离线加密保存，限制访问并设置保留周期。
- 备份包括用户邮箱、帖子、会话等敏感数据，禁止随源代码发包、上传公共仓库或经静态服务器公开。
- 恢复前停服务，备份当前目录，恢复同一批数据库与文件到原路径，检查拥有者和权限，先在隔离环境验收。不要对已有数据直接重跑演示初始化。
- 定期演练：登录、成员隐私、原帖和附件对应关系、管理员下架、备份恢复。备份不是“已验证可恢复”，只有实际演练后才算。

## 7. 上线前必须人工验收

- 实际浙大邮箱可收码；默认域名是否覆盖目标人群由运营方核实。错码、过期、重放、连续请求会被拒绝；管理员身份只能在真实验证后授予。
- 外网 HTTPS Cookie 正常，HTTP 不暴露正式会话；普通用户无法取得管理员接口、他人草稿/收藏/入圈清单或服务端文件。
- ClamAV 服务和病毒库正常，实际 PDF 可以预览、下载；不可用或恶意/加密/损坏文件不会变成 ready。
- 两个真实账号在两台设备验证共享帖子与本人私有数据隔离，举报、隐藏、删除后旧附件地址不可用。
- 配置可接收投诉的 SUPPORT_EMAIL，明确运营主体、响应人员、隐私保留周期、授权审查和账号注销处理方式。站点为非官方学习互助，不做学校背书。
- 公网反向代理限制请求体、连接数与速率；SMTP 出站及 ClamAV 仅受信网络可达；建立监控、磁盘空间告警和依赖升级机制。
- 以预计同时在线、搜索和上传比例做压测。当前串行扫描会阻塞同实例写队列，试点可用，扩大前应转有界扫描任务队列和更细粒度数据库模型。

## 8. 回滚

保留用户原始 `gongye-v9.2-source.zip` 不变。v10 采用新生产数据库，不自动导入旧演示账号/帖子。代码回滚不等于数据格式可回滚；停止服务并恢复成套备份后才能退回对应版本。旧固定验证码版本不可作为真实用户服务的回滚目标。

## 9. 一键部署（云主机 / 校内 Linux）

### 9.1 Docker 方案（推荐，含 ClamAV 与自动 HTTPS）

前置：一台 1 核 2G 起的 Linux 主机、一个已解析到该机 IP 的域名、放行 80/443 入站、允许出站 SMTP。

```bash
# 1) 上传并解压代码
scp gongye-v10.0.0-source.zip user@host:/opt/ && ssh user@host
cd /opt && unzip -q gongye-v10.0.0-source.zip && cd gongye

# 2) 写配置（不要把 .env 提交进仓库）
cp .env.example .env && nano .env   # 至少填 DOMAIN、SMTP_*、MAIL_FROM、ADMIN_EMAILS、SUPPORT_EMAIL

# 3) 启动（首次会拉镜像并下载病毒库，约 3–10 分钟）
docker compose up -d --build
docker compose logs -f app          # 出现“已启动”即可 Ctrl+C

# 4) 自检
npm ci --omit=dev --ignore-scripts && npm run smoke -- https://你的域名
```

- `compose.yaml`：应用（仅内网 8787）+ `clamav/clamav:stable`（不暴露端口）+ `caddy:2-alpine`（80/443，自动申请与续期证书）。数据在 `app-data` 卷（`/data`：SQLite 与私有 PDF），病毒库在 `clamav-db` 卷。
- 容器以 uid 10001 非 root 运行；`PUBLIC_ORIGIN` 必须与域名完全一致，否则同源校验会拒绝写操作。
- 病毒库首次启动要下载，`docker compose logs clamav` 看到 `Database updated` 后再传文件；在此之前上传失败关闭，属预期。
- 更新：替换代码后 `docker compose up -d --build`，**升级前先备份 `app-data` 卷**。

### 9.2 不用 Docker（systemd + 本机 clamd）

1. 安装 Node ≥ 22.13 到 `/usr/bin/node`，代码放 `/opt/gongye`，建 `gongye` 用户，数据目录 `/var/lib/gongye`。
2. 安装 `clamav-daemon`，确认 clamd 在本机 3310 可连；应用设 `CLAMAV_HOST=127.0.0.1`。
3. 复制 `deploy/gongye.service` 到 `/etc/systemd/system/`，环境变量写 `/etc/gongye.env`（`chmod 600`，含 `PUBLIC_ORIGIN=https://域名`、`DATA_FILE=/var/lib/gongye/production.sqlite`、SMTP、`ADMIN_EMAILS`）。
4. `systemctl daemon-reload && systemctl enable --now gongye`，再用 Caddy/Nginx 做 TLS 反代（Nginx 参考 `nginx.conf.example`，只反代，切勿用 `root` 指向整个工程）。
5. `npm run smoke -- https://域名` 自检。

### 9.3 自检脚本做什么

`npm run smoke -- <URL>` 只做只读探测：首页与静态资源可加载、`/api/health` 的运行模式、`/api/state` 的课程数及是否泄露内部路径、7 个敏感路径必须 404、跨站 POST 必须 403、公网必须 https。退出码 0 全通过、1 有硬性失败、2 通过但有需人工确认项（例如 `authReady=false` 表示 SMTP 还没配好）。不登录、不上传、不改数据，可随时对线上运行。

### 9.4 仍未包含的工作

- 我没有代你购买或托管服务器；`Dockerfile`/`compose.yaml` 未在真实云主机上构建验证（本机无 Docker），首次部署请按 9.3 自检并人工点一遍登录与上传。
- DNS、证书签发、防火墙与 SMTP 出站白名单需在云控制台完成。
- 备份见第 6 节；`app-data` 卷不能只复制主 `.sqlite` 文件。
