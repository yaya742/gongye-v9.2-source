#!/usr/bin/env node
/* 静态自检：模块导入是否可解析、页面路由是否都有实现、index.html 引用的本地资源是否存在。
 * 只做文本与文件检查，不执行浏览器代码。 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const notes = [];

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const jsFiles = [
  ...(await walk(path.join(ROOT, 'src'))),
  ...(await walk(path.join(ROOT, 'server')).catch(() => []))
].filter((f) => !f.includes(`${path.sep}data${path.sep}`) && /\.(m?js)$/.test(f));
const scriptFiles = (await walk(path.join(ROOT, 'scripts'))).filter((f) => /\.mjs$/.test(f));
const all = [...jsFiles, ...scriptFiles];

for (const file of all) {
  const text = await fs.readFile(file, 'utf8');
  const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of specs) {
    if (!spec.startsWith('.')) continue;
    const base = path.resolve(path.dirname(file), spec);
    const candidates = [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')];
    let found = false;
    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          found = true;
          break;
        }
      } catch {
        /* 继续尝试下一个候选 */
      }
    }
    if (!found) errors.push(`${path.relative(ROOT, file)} → 无法解析导入 ${spec}`);
  }
}

// 路由名 → 页面实现
const routerText = await fs.readFile(path.join(ROOT, 'src/router.js'), 'utf8');
const routeNames = new Set([...routerText.matchAll(/name:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]));
const registryText = await fs.readFile(path.join(ROOT, 'src/pages/index.js'), 'utf8');
const implemented = new Set([...registryText.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((m) => m[1]));
for (const name of routeNames) {
  if (!implemented.has(name)) errors.push(`路由 ${name} 没有对应的页面实现`);
}
for (const name of implemented) {
  if (!routeNames.has(name) && name !== 'notFound') notes.push(`页面实现 ${name} 未被路由引用（可能是死代码）`);
}

// index.html 本地引用
const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1]);
for (const ref of refs) {
  if (/^https?:/.test(ref)) continue;
  try {
    const stat = await fs.stat(path.join(ROOT, ref));
    if (!stat.isFile()) errors.push(`index.html 引用的 ${ref} 不是文件`);
  } catch {
    errors.push(`index.html 引用的 ${ref} 不存在`);
  }
}

// 关键素材
const assets = [
  'assets/art/icons.svg',
  'assets/art/extra-icons.svg',
  'assets/art/logo-wordmark.svg',
  'assets/art/logo-mono.svg',
  'assets/art/empty-feed.svg',
  'assets/art/empty-search.svg',
  'assets/art/empty-saved.svg',
  'assets/art/network-error.svg',
  'assets/art/removed.svg',
  'assets/art/bookmark-filled.svg',
  'assets/css/tokens.css',
  'assets/samples/demo-calculus-notes.pdf',
  'assets/brand/logo.png',
  'assets/avatars/cat.jpg',
  'assets/avatars/wave.svg',
  'assets/stickers/yeye-thanks.png',
  'assets/mascot/duo.png',
  'assets/previews/calc-notes-p1.svg',
  'assets/badges/level-3-chip.svg',
  'assets/covers/notes.svg',
  'assets/mascot/yeye-growth.png'
];
for (const asset of assets) {
  try {
    const stat = await fs.stat(path.join(ROOT, asset));
    if (!stat.isFile()) errors.push(`素材缺失：${asset}`);
  } catch {
    errors.push(`素材缺失：${asset}`);
  }
}

// 所有 art 目录中的头像都被引用（存在即可）
const avatarDir = path.join(ROOT, 'assets/art');
const artFiles = await fs.readdir(avatarDir);
notes.push(`素材文件 ${artFiles.length} 个；模块 ${all.length} 个；路由 ${routeNames.size} 个`);

console.log(notes.join('\n'));
if (errors.length) {
  console.error('\n自检失败：');
  errors.forEach((e) => console.error(` - ${e}`));
  process.exit(1);
}
console.log('\n自检通过：导入、路由与本地资源引用均可解析。');


