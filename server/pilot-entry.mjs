#!/usr/bin/env node
/* 共页 · 内部试用版启动入口
 *
 *   node server/pilot-entry.mjs
 *   PORT=8787 HOST=0.0.0.0 node server/pilot-entry.mjs
 *
 * 环境变量：
 *   PORT            端口，默认 8787
 *   HOST            监听地址，默认 127.0.0.1；同事要访问就设 0.0.0.0
 *   ADMIN_EMAIL     管理员邮箱（该邮箱注册后自动成为管理员）
 *   ALLOWED_EMAILS  逗号分隔的邮箱白名单（也可以写 server/allowlist.txt）
 *   ALLOWED_DOMAINS 逗号分隔的域名白名单，例如 company.com
 *   ALLOWED_ORIGINS 允许跨域访问的完整来源（逗号分隔）；默认仅同源
 *   DATA_FILE       数据文件路径，默认 server/data/db.json
 *   COOKIE_SECURE   1 表示 Cookie 只走 HTTPS（本机 http 试用请保持 0）
 *   TRUST_PROXY     1 表示反向代理会覆盖 X-Forwarded-For，匿名请求按真实客户端 IP 限流
 *   CLAMD_HOST / CLAMD_PORT / CLAMD_SOCKET  ClamAV 扫描服务地址；配置后每个上传文件都要扫描通过
 *
 * 上传文件保存在数据文件同目录的 files/，每小时一份数据快照在 backups/。
 */

import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPilotServer } from './pilot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');

const PORT = Number(process.env.PORT || 8787);
// 托管平台会注入 PORT 并要求绑定 0.0.0.0；本机手动启动时仍默认只听 127.0.0.1
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim();

const allowlistPath = path.join(HERE, 'allowlist.txt');
const dataFile = process.env.DATA_FILE || path.join(HERE, 'data', 'db.json');

/* 部署时随包带的运行配置（仓库里没有这个文件，由打包脚本写进发布目录）。
 * 内容示例：
 *   { "requireCloudAuth": true,
 *     "adminEmails": ["admin@example.com"],
 *     "cloud": { "endpoint": "https://xxx.app.workbuddy.host", "publishableKey": "wbpk_..." },
 *     "legal": { "operator": "运营方名称", "contact": "联系邮箱", "effectiveDate": "2026-12-01", "dataLocation": "服务器所在地" } }
 */
const configPath = path.join(HERE, 'pilot.config.json');
let fileConfig = {};
if (existsSync(configPath)) {
  try {
    fileConfig = JSON.parse(readFileSync(configPath, 'utf8')) || {};
  } catch (error) {
    console.error('[pilot] pilot.config.json 解析失败，按默认配置启动', error.message);
  }
}

const pilot = await createPilotServer({
  dataFile,
  allowlistFile: allowlistPath,
  adminEmail: ADMIN_EMAIL || fileConfig.adminEmail || '',
  adminEmails: Array.isArray(fileConfig.adminEmails) ? fileConfig.adminEmails : [],
  requireCloudAuth: fileConfig.requireCloudAuth === true,
  cloud: fileConfig.cloud && fileConfig.cloud.endpoint ? fileConfig.cloud : null,
  legal: fileConfig.legal && typeof fileConfig.legal === 'object' ? fileConfig.legal : null
});

const address = await pilot.listen(PORT, HOST);
const allowCount = pilot.allowlist.emails.size;
const domainCount = pilot.allowlist.domains.size;

console.log('==============================================');
console.log('  共页 v2.2 · 内部试用版已启动');
console.log('==============================================');
console.log(`  本机访问：http://127.0.0.1:${address.port}/`);
if (HOST === '0.0.0.0') {
  const nets = os.networkInterfaces();
  const ips = Object.values(nets)
    .flat()
    .filter((info) => info && info.family === 'IPv4' && !info.internal)
    .map((info) => info.address);
  if (ips.length) {
    console.log('  同事访问（同一局域网）：');
    ips.forEach((ip) => console.log(`    http://${ip}:${address.port}/`));
  }
} else {
  console.log('  提示：只监听本机。要让同事访问，请用 HOST=0.0.0.0 启动。');
}
console.log('');
console.log(`  数据文件：${dataFile}`);
console.log(`  试用名单：${allowCount} 个邮箱 + ${domainCount} 个域名`);
if (allowCount + domainCount === 0) {
  console.log('  ⚠ 还没有配置名单：编辑 server/allowlist.txt 加入同事邮箱后重启服务');
}
console.log(`  登录方式：${pilot.loginMode === 'cloud' ? '云服务邮箱验证码（固定码已关闭）' : '固定验证码 123456'}`);
if (ADMIN_EMAIL) console.log(`  管理员邮箱：${ADMIN_EMAIL}`);
else if (Array.isArray(fileConfig.adminEmails) && fileConfig.adminEmails.length) {
  console.log(`  管理员邮箱：${fileConfig.adminEmails.join(', ')}`);
} else console.log('  提示：用 ADMIN_EMAIL=你的邮箱 启动，可让该账号成为管理员');
console.log(`  病毒扫描：${process.env.CLAMD_HOST || process.env.CLAMD_SOCKET ? '已开启（ClamAV）' : '未开启（设置 CLAMD_HOST 或 CLAMD_SOCKET）'}`);
if (pilot.corsPolicy.allowedOrigins.length) {
  console.log(`  跨域来源：仅同源 + ${pilot.corsPolicy.allowedOrigins.join(', ')}`);
} else {
  console.log('  跨域来源：仅同源；跨域静态站需配置 ALLOWED_ORIGINS 精确来源');
}
if (pilot.corsPolicy.wildcardIgnored) {
  console.log('  ⚠ ALLOWED_ORIGINS 中的 * 不生效；请填写具体来源（协议、域名和端口）');
}
console.log('  反向代理须覆盖 X-Forwarded-Proto / X-Forwarded-Host 为外部请求的协议和主机');
console.log('  跨域部署时：静态站的 src/config.js 填 mode=production + apiBase=本服务的 https 地址');
if (!existsSync(allowlistPath)) console.log(`  ⚠ 找不到 ${allowlistPath}`);
console.log('');
console.log('  按 Ctrl+C 停止服务；数据随时可删（server/data 目录）。');
console.log('==============================================');
