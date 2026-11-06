#!/usr/bin/env node
/* Production entry only. PUBLIC_ORIGIN must be HTTPS outside loopback.
 * SMTP_HOST/PORT/SECURE/USER/PASS/MAIL_FROM enable real email OTP.
 * ZJU_EMAIL_DOMAINS and ADMIN_EMAILS are exact allowlists; DATA_FILE is SQLite.
 * Explicit local-only legacy demo entry: node server/pilot.mjs (never npm start).
 */

import { createProductionServer } from './production.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || major === 22 && minor < 13) throw new Error('共页生产服务需要 Node.js >=22.13');
process.env.NODE_ENV = 'production';
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 必须是有效端口');
let service;
try {
  service = await createProductionServer();
  const address = await service.listen(port, host);
  console.log('共页 · 单实例生产服务已启动（SQLite WAL；请勿多进程共享此数据目录）');
  console.log(`访问来源：${process.env.PUBLIC_ORIGIN || `http://${host}:${address.port}`}`);
  console.log(`登录方式：email-otp；域名白名单：${service.emailDomains.join('、')}（需核实实际校内邮箱域名）`);
  if (!service.authReady) console.warn(`邮箱登录不可用：${service.configurationIssue}；requestCode 将返回 503，不会使用固定码。`);
  if (!process.env.SUPPORT_EMAIL) console.warn('正式上线前请配置 SUPPORT_EMAIL 以接收版权/隐私投诉。');
  if (!process.env.ADMIN_EMAILS && !process.env.ADMIN_EMAIL) console.warn('尚未配置 ADMIN_EMAILS：没有管理员账号。');
  console.log('上传需配置可信扫描器和 PDF 预览；缺失时失败关闭。HTTPS 反向代理必须同源并限制上传请求大小。');
} catch (error) {
  await service?.close();
  console.error('生产服务启动失败。请检查 Node 版本、PUBLIC_ORIGIN、SQLite 数据完整性和运行配置；不会自动重建数据库。');
  process.exitCode = 1;
}
if (service && process.exitCode !== 1) {
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await service.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
