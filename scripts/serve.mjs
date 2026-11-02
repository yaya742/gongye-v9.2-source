#!/usr/bin/env node
/* 零依赖静态服务器：仅用于本地预览与验收。
 * 生产部署不需要它（见 DEPLOY_HANDOFF.md）。
 *
 *   node scripts/serve.mjs [--port 4173] [--host 127.0.0.1]
 *   PORT=4173 node scripts/serve.mjs
 */

import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const PORT = Number(argValue('port') || process.env.PORT || 4173);
const HOST = argValue('host') || process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.resolve(root, `.${path.posix.normalize(decoded)}`);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

async function resolveFile(urlPath) {
  const target = safeJoin(ROOT, urlPath);
  if (!target) return null;
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      const index = path.join(target, 'index.html');
      const indexStat = await fs.stat(index);
      if (indexStat.isFile()) return index;
      return null;
    }
    if (stat.isFile()) return target;
  } catch {
    return null;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const urlPath = req.url || '/';
  let file = await resolveFile(urlPath);

  // 未命中的「无扩展名路径」回退到 index.html，模拟静态托管的重写规则
  if (!file && !path.extname(urlPath.split('?')[0])) {
    file = path.join(ROOT, 'index.html');
  }

  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    console.log(`${res.statusCode} ${urlPath} ${Date.now() - started}ms`);
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff'
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    createReadStream(file).pipe(res);
  }
  console.log(`${res.statusCode} ${urlPath} ${type} ${Date.now() - started}ms`);
});

server.listen(PORT, HOST, () => {
  console.log(`共页静态预览：http://${HOST}:${PORT}/`);
  console.log(`服务目录：${ROOT}`);
});
