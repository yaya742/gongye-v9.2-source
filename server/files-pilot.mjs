/* 共页 · 试用后端的文件存储
 *
 * 职责：接收上传、按文件内容校验类型、生成 PDF 预览、输出下载响应、清理与备份。
 * 文件落在数据目录下，不走静态路由；访问权限由 pilot.mjs 按附件 ID 判断。
 * 零依赖。pdfinfo / pdftoppm（poppler-utils）是可选工具：没有时页数退回粗略统计，也没有预览图。
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, promises as fsp } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const MiB = 1024 * 1024;
const DAY_MS = 24 * 3600 * 1000;

export const DEFAULT_LIMITS = Object.freeze({
  pdfBytes: 20 * MiB,
  imageBytes: 3 * MiB,
  userBytes: 300 * MiB,
  totalBytes: 5 * 1024 * MiB,
  uploadsPerHour: 40
});

export class FileError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const tooLarge = (bytes) => new FileError(413, 'too_large', `文件不能超过 ${Math.round(bytes / MiB)} MiB`);

/** 按文件头判断图片类型；SVG 可以带脚本，不接受 */
function sniffImage(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

function checkPdf(bytes) {
  if (!bytes.subarray(0, 1024).includes('%PDF-')) {
    throw new FileError(415, 'not_pdf', '这不是有效的 PDF 文件');
  }
  if (!bytes.includes('%%EOF')) {
    throw new FileError(415, 'broken_pdf', 'PDF 文件不完整，请重新导出后再上传');
  }
  // 只是基础拦截：压缩流里的内容查不到，不能代替杀毒扫描
  if (bytes.includes('/JavaScript') || bytes.includes('/Launch')) {
    throw new FileError(415, 'active_pdf', '这个 PDF 含有脚本或启动动作，不能上传');
  }
}

function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let output = '';
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs });
    } catch {
      resolve({ ok: false, output: '' });
      return;
    }
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', () => resolve({ ok: false, output: '' }));
    child.on('close', (code) => resolve({ ok: code === 0, output }));
  });
}

function cleanName(raw, fallback) {
  const name = String(raw || '').replace(/[\\/\u0000-\u001f]/g, ' ').trim();
  return (name || fallback).slice(0, 120);
}

export function decodeFileName(header) {
  try {
    return decodeURIComponent(String(header || ''));
  } catch {
    return '';
  }
}

export function createFileStore({ dir, limits = {}, previews = true, scanner = null }) {
  const limit = { ...DEFAULT_LIMITS, ...limits };
  let previewQueue = Promise.resolve();

  const filePath = (record) => path.join(dir, `${record.id}.${record.ext}`);
  const previewPath = (record, page) => path.join(dir, `${record.id}-p${page}.jpg`);

  async function countPages(file, bytes) {
    const info = await run('pdfinfo', [file], 8000);
    const match = info.ok && info.output.match(/^Pages:\s+(\d+)/m);
    if (match) return Number(match[1]);
    const found = bytes.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g);
    return found ? found.length : null;
  }

  /** 把前两页转成 JPEG。同一时间只转一份，失败时资料照常可用，只是没有预览 */
  function renderPreviews(record) {
    if (!previews) return Promise.resolve(0);
    const task = previewQueue.then(async () => {
      const prefix = path.join(dir, `${record.id}-render`);
      const result = await run('pdftoppm', [
        '-f', '1', '-l', '2', '-scale-to', '1000', '-jpeg', '-jpegopt', 'quality=72', filePath(record), prefix
      ], 20_000);
      const names = (await fsp.readdir(dir)).filter((name) => name.startsWith(`${record.id}-render`)).sort();
      if (!result.ok) {
        await Promise.all(names.map((name) => fsp.unlink(path.join(dir, name)).catch(() => {})));
        return 0;
      }
      await Promise.all(names.map((name, index) => fsp.rename(path.join(dir, name), previewPath(record, index + 1))));
      return names.length;
    });
    previewQueue = task.catch(() => 0);
    return task.catch(() => 0);
  }

  /** 流式写入临时文件，超限立刻中止，校验通过后才转成正式文件 */
  async function receive(req, { kind, ownerId, name }) {
    const max = kind === 'pdf' ? limit.pdfBytes : limit.imageBytes;
    if (Number(req.headers['content-length'] || 0) > max) throw tooLarge(max);
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });

    const id = crypto.randomBytes(12).toString('hex');
    const temp = path.join(dir, `${id}.part`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    try {
      await pipeline(req, async function* meter(source) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > max) throw tooLarge(max);
          hash.update(chunk);
          yield chunk;
        }
      }, createWriteStream(temp, { mode: 0o600 }));
      if (!size) throw new FileError(400, 'empty_file', '文件是空的');

      const bytes = await fsp.readFile(temp);
      let type;
      if (kind === 'pdf') {
        checkPdf(bytes);
        type = { ext: 'pdf', mime: 'application/pdf' };
      } else {
        type = sniffImage(bytes);
        if (!type) throw new FileError(415, 'not_image', '只支持 JPEG、PNG、WebP 图片');
      }

      // 配置了扫描服务就每个文件都扫；扫描服务出故障时拒绝上传，不放过未扫描的文件
      let scan = 'off';
      if (scanner) {
        let verdict;
        try {
          verdict = await scanner.scan(bytes);
        } catch {
          throw new FileError(503, 'scan_unavailable', '病毒扫描服务暂时不可用，请稍后再试');
        }
        if (!verdict.clean) throw new FileError(422, 'infected', '文件没有通过病毒扫描，已拒绝上传');
        scan = 'clean';
      }

      const record = {
        id, ownerId, kind, ext: type.ext, mime: type.mime, scan,
        name: cleanName(name, kind === 'pdf' ? '未命名.pdf' : '图片'),
        sizeBytes: size, sha256: hash.digest('hex'),
        pages: null, previewCount: 0,
        createdAt: new Date().toISOString(), postId: null
      };
      await fsp.rename(temp, filePath(record));
      if (kind === 'pdf') {
        record.pages = await countPages(filePath(record), bytes);
        record.previewCount = await renderPreviews(record);
      }
      return record;
    } catch (error) {
      await fsp.unlink(temp).catch(() => {});
      if (error instanceof FileError) throw error;
      throw new FileError(400, 'upload_failed', '上传中断，请重试');
    }
  }

  /** 新上传前检查配额，避免一个账号或一批文件占满磁盘 */
  function assertQuota(uploads, ownerId) {
    const own = uploads.filter((row) => row.ownerId === ownerId).reduce((sum, row) => sum + row.sizeBytes, 0);
    if (own >= limit.userBytes) throw new FileError(507, 'quota', '你的上传空间已用完，请先删除不需要的内容');
    const total = uploads.reduce((sum, row) => sum + row.sizeBytes, 0);
    if (total >= limit.totalBytes) throw new FileError(507, 'storage_full', '站点存储空间已满，请联系管理员');
  }

  async function send(req, res, target, headers) {
    const stat = await fsp.stat(target).catch(() => null);
    if (!stat) throw new FileError(404, 'not_found', '文件不存在');
    res.writeHead(200, {
      'content-length': stat.size,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      ...headers
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    await pipeline(createReadStream(target), res);
  }

  function sendFile(req, res, record, { download = false, cache = 'no-store' } = {}) {
    return send(req, res, filePath(record), {
      'content-type': record.mime,
      'cache-control': cache,
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(record.name)}`
    });
  }

  function sendPreview(req, res, record, page) {
    return send(req, res, previewPath(record, page), {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=600'
    });
  }

  async function removeFiles(record) {
    const targets = [filePath(record)];
    for (let page = 1; page <= (record.previewCount || 0); page += 1) targets.push(previewPath(record, page));
    await Promise.all(targets.map((target) => fsp.unlink(target).catch(() => {})));
  }

  /** 清理：帖子已永久移除的文件，以及选了却一直没发布的文件 */
  async function sweep(db, now = Date.now()) {
    const uploads = db.uploads || [];
    const keep = [];
    const drop = [];
    uploads.forEach((row) => {
      const post = row.postId ? (db.posts || []).find((item) => item.id === row.postId) : null;
      const orphaned = !row.postId && now - new Date(row.createdAt).getTime() > DAY_MS;
      const removed = !!row.postId && (!post || post.status === 'removed');
      (orphaned || removed ? drop : keep).push(row);
    });
    if (!drop.length) return 0;
    db.uploads = keep;
    await Promise.all(drop.map(removeFiles));
    return drop.length;
  }

  /** 全量备份：tar 格式，含数据文件和全部上传文件，解压到数据目录即可恢复 */
  async function writeBackup(res, dataBody, uploads) {
    const header = (name, size) => {
      const block = Buffer.alloc(512);
      block.write(name, 0, 100, 'utf8');
      block.write('0000600\0', 100);
      block.write('0000000\0', 108);
      block.write('0000000\0', 116);
      block.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
      block.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136);
      block.write('        ', 148);
      block.write('0', 156);
      block.write('ustar\0', 257);
      block.write('00', 263);
      const sum = block.reduce((total, byte) => total + byte, 0);
      block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
      return block;
    };
    const padding = (size) => Buffer.alloc((512 - (size % 512)) % 512);
    const write = (chunk) => new Promise((resolve, reject) => {
      res.write(chunk, (error) => (error ? reject(error) : resolve()));
    });

    const body = Buffer.from(dataBody);
    await write(header('db.json', body.length));
    await write(body);
    await write(padding(body.length));

    const names = await fsp.readdir(dir).catch(() => []);
    const known = new Set(uploads.map((row) => row.id));
    for (const name of names) {
      if (!known.has(name.split(/[.-]/)[0]) || name.endsWith('.part')) continue;
      const target = path.join(dir, name);
      const stat = await fsp.stat(target);
      await write(header(`files/${name}`, stat.size));
      await write(await fsp.readFile(target));
      await write(padding(stat.size));
    }
    await write(Buffer.alloc(1024));
    res.end();
  }

  /** 立即删除一批文件及预览（注销账号时用） */
  async function purge(records) {
    await Promise.all(records.map(removeFiles));
  }

  return { limit, receive, assertQuota, sendFile, sendPreview, sweep, writeBackup, purge };
}
