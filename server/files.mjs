import path from 'node:path';
import { constants } from 'node:fs';
import { mkdir, lstat, realpath, open, unlink } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { PDF_LIMITS, fileError, validatePdfBytes, scanPdfWithClamd, renderPdfPreview } from './file-processing.mjs';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ID = new RegExp(`^${UUID}$`);
const ROUTE = new RegExp(`^/api/files/(${UUID})/(download|image|preview/([12]))$`);
const IMAGE_EXT = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
const IMAGE_MIME = Object.freeze({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' });
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;

/** 按文件头确认图片类型，不信任声明的 content-type */
function sniffImage(bytes, contentType) {
  if (contentType === 'image/jpeg') {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === 'image/webp') {
    return bytes.length > 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const knownResourceStates = new Set(['indexed', 'unindexed', 'processing']);
const publicDownload = (id) => `/api/files/${id}/download`;
const publicImage = (id) => `/api/files/${id}/image`;
const publicPreview = (id, page) => `/api/files/${id}/preview/${page}`;
const safeFailure = () => fileError('file_unavailable', 404, '文件不存在或已不可用');
const failed = (code, message) => ({ ok: false, code, message });
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const allowedErrors = new Set(['login', 'unverified', 'suspended', 'email_not_allowed',
  'invalid_file_name', 'unsupported_media_type', 'file_too_large', 'invalid_content_length',
  'invalid_pdf', 'encrypted_pdf', 'unsafe_pdf', 'pdf_too_complex', 'scan_unavailable',
  'scan_failed', 'malware_detected', 'render_unavailable', 'invalid_preview',
  'upload_timeout', 'upload_aborted', 'processing_timeout', 'file_unavailable',
  'storage_unavailable', 'too_many_attachments', 'invalid_attachment', 'upload_consumed']);

function publicError(error) {
  if (allowedErrors.has(error?.code) && Number.isInteger(error.status)) return error;
  return fileError('storage_unavailable', 503, '文件服务暂不可用');
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

function originalName(header, ext = 'pdf') {
  if (typeof header !== 'string' || header.length > 1500) {
    throw fileError('invalid_file_name', 400, '请提供 PDF 文件名');
  }
  let name;
  try { name = decodeURIComponent(header).normalize('NFC'); } catch {
    throw fileError('invalid_file_name', 400, '文件名编码无效');
  }
  if (!name || name.length > 240 || /[/\\\x00-\x1f\x7f:]/.test(name)
      || name === '.' || name === '..'
      || !['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(path.extname(name).toLowerCase().slice(1))
      || (ext === 'pdf' && path.extname(name).toLowerCase() !== '.pdf')) {
    throw fileError('invalid_file_name', 400, '仅支持无路径的 PDF 或图片文件名');
  }
  name = name.replace(/[<>"|?*\u202a-\u202e\u2066-\u2069]/g, '_').trim().replace(/[. ]+$/, '');
  const stem = name.slice(0, name.length - path.extname(name).length).trim().slice(0, 112);
  if (!stem || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) {
    throw fileError('invalid_file_name', 400, '文件名不可用');
  }
  return `${stem}.${ext}`;
}

function receivePdf(req, maxBytes, signal) {
  const rawLength = req.headers['content-length'];
  let declared = null;
  if (rawLength !== undefined) {
    if (typeof rawLength !== 'string' || !/^\d+$/.test(rawLength)) {
      throw fileError('invalid_content_length', 400, '文件长度无效');
    }
    declared = Number(rawLength);
    if (!Number.isSafeInteger(declared) || declared < 1) {
      throw fileError('invalid_content_length', 400, '文件长度无效');
    }
    if (declared > maxBytes) throw fileError('file_too_large', 413, 'PDF 不能超过上传大小限制');
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let finished = false;
    const finish = (error, bytes) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      req.removeListener('data', data);
      req.removeListener('end', end);
      req.removeListener('error', abort);
      req.removeListener('aborted', abort);
      signal?.removeEventListener('abort', abort);
      if (error) {
        chunks.length = 0;
        req.on('error', () => {});
        req.resume();
        reject(error);
      } else resolve(bytes);
    };
    const data = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) return finish(fileError('file_too_large', 413, 'PDF 不能超过上传大小限制'));
      chunks.push(buffer);
    };
    const end = () => {
      if (declared !== null && size !== declared) {
        finish(fileError('invalid_content_length', 400, '文件长度不一致'));
      } else finish(null, Buffer.concat(chunks, size));
    };
    const abort = () => finish(fileError('upload_aborted', 400, '文件上传已中断'));
    const timer = setTimeout(() => finish(fileError('upload_timeout', 408, '文件上传超时')), 30_000);
    req.on('data', data);
    req.once('end', end);
    req.once('error', abort);
    req.once('aborted', abort);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted || req.aborted) abort();
  });
}

async function deadline(operation, milliseconds, signal) {
  if (signal?.aborted) throw fileError('upload_aborted', 400, '文件上传已中断');
  const controller = new AbortController();
  let abort;
  let timer;
  const cancelled = new Promise((_, reject) => {
    abort = () => {
      controller.abort();
      reject(fileError('upload_aborted', 400, '文件上传已中断'));
    };
    timer = setTimeout(() => {
      controller.abort();
      reject(fileError('processing_timeout', 408, 'PDF 处理超时'));
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), cancelled]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

function validatePreview(result) {
  if (!Number.isInteger(result?.totalPages) || result.totalPages < 1 || result.totalPages > PDF_LIMITS.maxPages
      || !Array.isArray(result.pages) || result.pages.length !== Math.min(2, result.totalPages)) {
    throw fileError('invalid_preview', 422, 'PDF 预览无效');
  }
  return result.pages.map((entry, index) => {
    const png = entry?.png;
    if (entry?.page !== index + 1 || !Buffer.isBuffer(png) || png.length < 45
        || png.length > PDF_LIMITS.maxPreviewBytes || !png.subarray(0, 8).equals(PNG)
        || png.toString('ascii', 12, 16) !== 'IHDR') {
      throw fileError('invalid_preview', 422, 'PDF 预览无效');
    }
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (!width || !height || width * height > PDF_LIMITS.maxPreviewPixels || width > 4096 || height > 4096) {
      throw fileError('invalid_preview', 422, 'PDF 预览尺寸无效');
    }
    return { page: entry.page, png };
  });
}

/** Single-instance private storage. The caller serializes ALL writes; save()
 * persists immediately and MUST NOT re-enqueue behind the currently held lock.
 * prepareAttachments/finalizePost/downloadResource are deliberately synchronous.
 */
export function createFileService({ rootDir, db, save, scanPdf = scanPdfWithClamd, imageMaxBytes = IMAGE_MAX_BYTES,
  renderPreview = renderPdfPreview, maxBytes = PDF_LIMITS.maxBytes,
  allowedDomains = ['zju.edu.cn', 'st.zju.edu.cn'] } = {}) {
  if (typeof rootDir !== 'string' || !rootDir.trim() || !db || typeof save !== 'function') {
    throw new TypeError('A private rootDir, database and persistence callback are required');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > PDF_LIMITS.maxBytes) {
    throw new TypeError('maxBytes must be a positive integer no greater than 20 MiB');
  }
  if (typeof scanPdf !== 'function' || typeof renderPreview !== 'function' || !Array.isArray(allowedDomains)) {
    throw new TypeError('Invalid file processor or allowedDomains configuration');
  }
  const domains = new Set(allowedDomains.map((domain) => String(domain).trim().toLowerCase()));
  const root = path.resolve(rootDir);
  if (db.uploads !== undefined && !Array.isArray(db.uploads)) throw new TypeError('db.uploads must be an array');
  db.uploads ||= [];
  const preparedBatches = new WeakSet();
  const preparedImages = new WeakSet();

  function requireUser(user) {
    if (!user?.id) throw fileError('login', 401, '请先登录');
    const current = (db.users || []).find((entry) => entry.id === user.id);
    if (!current || current.status !== 'active') throw fileError('suspended', 403, '账号停用期间不能访问文件');
    if (current.verified !== true) throw fileError('unverified', 403, '请先验证浙大邮箱');
    const email = typeof current.email === 'string' ? current.email.trim().toLowerCase() : '';
    const parts = email.split('@');
    if (parts.length !== 2 || !parts[0] || !domains.has(parts[1])) {
      throw fileError('email_not_allowed', 403, '仅已验证的浙大邮箱账号可访问完整文件');
    }
    return current;
  }

  async function ensureRoot(create = false) {
    if (create) await mkdir(root, { recursive: true, mode: 0o700 });
    let cursor = root;
    while (true) {
      const stat = await lstat(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw safeFailure();
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    if (!samePath(await realpath(root), root)) throw safeFailure();
  }

  function localPath(key) {
    if (typeof key !== 'string' || !new RegExp(`^${UUID}(?:\\.pdf|\\.jpg|\\.png|\\.webp|\\.[12]\\.png)$`).test(key)) throw safeFailure();
    const filename = path.resolve(root, key);
    if (!samePath(path.dirname(filename), root)) throw safeFailure();
    return filename;
  }

  async function privateWrite(key, bytes) {
    await ensureRoot(true);
    const filename = localPath(key);
    const handle = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW || 0), 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      await handle.close();
      try { await unlink(filename); } catch { /* Best-effort cleanup of our exclusive file. */ }
      throw error;
    }
    await handle.close();
  }

  async function privateRead(key, limit) {
    await ensureRoot();
    const filename = localPath(key);
    const before = await lstat(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
        || before.size < 1 || before.size > limit || !samePath(await realpath(filename), filename)) throw safeFailure();
    const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.ino !== before.ino || current.dev !== before.dev
          || current.size !== before.size || current.nlink !== 1) throw safeFailure();
      const bytes = await handle.readFile();
      if (bytes.length !== before.size) throw safeFailure();
      return bytes;
    } finally { await handle.close(); }
  }

  async function discard(keys) {
    for (const key of keys) {
      try { await ensureRoot(); await unlink(localPath(key)); } catch { /* Never remove user-controlled paths. */ }
    }
  }

  function canonical(upload) {
    const kind = upload.kind === 'image' ? 'image' : 'pdf';
    return Object.freeze({ uploadId: upload.id, kind, name: upload.name,
      sizeBytes: upload.sizeBytes, pages: upload.pages, status: 'ready',
      path: kind === 'image' ? publicImage(upload.id) : publicDownload(upload.id), demo: false });
  }

  async function upload(req, res, user) {
    const actor = requireUser(user);
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (IMAGE_EXT[contentType]) return uploadImage(req, res, actor, contentType);
    const id = randomUUID();
    const record = { id, ownerId: actor.id, status: 'receiving', createdAt: new Date().toISOString(),
      objectKey: `${id}.pdf`, hash: null, pages: null, previews: [], postId: null };
    db.uploads.push(record);
    const createdKeys = [];
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', disconnected);
    res.once('close', disconnected);
    try {
      await save();
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/pdf'
          || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
        throw fileError('unsupported_media_type', 415, '仅支持原始 application/pdf 文件上传');
      }
      record.name = originalName(req.headers['x-file-name']);
      const bytes = await receivePdf(req, maxBytes, controller.signal);
      record.sizeBytes = bytes.length;
      validatePdfBytes(bytes);
      record.hash = createHash('sha256').update(bytes).digest('hex');
      await privateWrite(record.objectKey, bytes);
      createdKeys.push(record.objectKey);
      record.status = 'scanning';
      await save();
      let verdict;
      try {
        verdict = await deadline((signal) => scanPdf(localPath(record.objectKey), { signal, maxBytes }),
          20_000, controller.signal);
      } catch (error) {
        if (['scan_unavailable', 'malware_detected', 'processing_timeout', 'upload_aborted'].includes(error?.code)) throw error;
        throw fileError('scan_failed', 503, '文件未能完成安全扫描');
      }
      if (!(verdict === true || verdict?.clean === true)) {
        throw fileError('scan_failed', 503, '文件未通过安全扫描');
      }
      record.scan = 'clean';
      record.scannedAt = new Date().toISOString();
      record.status = 'rendering';
      await save();
      let result;
      try {
        result = await deadline((signal) => renderPreview(localPath(record.objectKey), {
          ...PDF_LIMITS, maxBytes, signal
        }), PDF_LIMITS.timeoutMs, controller.signal);
      } catch (error) {
        if (allowedErrors.has(error?.code)) throw error;
        throw fileError('render_unavailable', 503, 'PDF 预览服务暂不可用');
      }
      const previews = validatePreview(result);
      for (const preview of previews) {
        const key = `${id}.${preview.page}.png`;
        await privateWrite(key, preview.png);
        createdKeys.push(key);
      }
      // Recheck after the asynchronous processors; callers must also serialize moderation.
      requireUser(actor);
      if (controller.signal.aborted) throw fileError('upload_aborted', 400, '文件上传已中断');
      record.pages = result.totalPages;
      record.previews = previews.map(({ page, png }) => ({ page, objectKey: `${id}.${page}.png`,
        sizeBytes: png.length, hash: createHash('sha256').update(png).digest('hex') }));
      record.status = 'ready';
      record.readyAt = new Date().toISOString();
      await save();
      sendJson(res, 201, { attachment: { uploadId: id, name: record.name, sizeBytes: record.sizeBytes,
        pages: record.pages, status: 'ready' }, previews: previews.map(({ page }) => publicPreview(id, page)) });
    } catch (error) {
      const safe = publicError(error);
      record.status = 'failed';
      record.errorCode = safe.code;
      record.failedAt = new Date().toISOString();
      record.previews = [];
      await discard(createdKeys);
      await save();
      throw safe;
    } finally {
      req.removeListener('aborted', disconnected);
      res.removeListener('close', disconnected);
    }
  }

  async function uploadImage(req, res, actor, contentType) {
    const id = randomUUID();
    const ext = IMAGE_EXT[contentType];
    const record = { id, ownerId: actor.id, kind: 'image', status: 'receiving',
      createdAt: new Date().toISOString(), objectKey: `${id}.${ext}`, mime: IMAGE_MIME[ext],
      hash: null, pages: null, previews: [], postId: null };
    db.uploads.push(record);
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', disconnected);
    res.once('close', disconnected);
    try {
      await save();
      if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
        throw fileError('unsupported_media_type', 415, '请上传原始图片文件');
      }
      record.name = originalName(req.headers['x-file-name'], ext);
      const bytes = await receivePdf(req, imageMaxBytes, controller.signal);
      record.sizeBytes = bytes.length;
      if (!sniffImage(bytes, contentType)) throw fileError('unsupported_media_type', 415, '图片内容与声明类型不一致');
      record.hash = createHash('sha256').update(bytes).digest('hex');
      await privateWrite(record.objectKey, bytes);
      record.status = 'scanning';
      await save();
      let verdict;
      try {
        verdict = await deadline((signal) => scanPdf(localPath(record.objectKey), { signal, maxBytes: imageMaxBytes }),
          20_000, controller.signal);
      } catch (error) {
        if (['scan_unavailable', 'malware_detected', 'processing_timeout', 'upload_aborted'].includes(error?.code)) throw error;
        throw fileError('scan_failed', 503, '图片未能完成安全扫描');
      }
      if (!(verdict === true || verdict?.clean === true)) throw fileError('scan_failed', 503, '图片未通过安全扫描');
      requireUser(actor);
      if (controller.signal.aborted) throw fileError('upload_aborted', 400, '文件上传已中断');
      record.scan = 'clean';
      record.scannedAt = new Date().toISOString();
      record.status = 'ready';
      record.readyAt = new Date().toISOString();
      await save();
      sendJson(res, 201, { attachment: { uploadId: id, kind: 'image', name: record.name,
        sizeBytes: record.sizeBytes, status: 'ready' }, previews: [] });
    } catch (error) {
      const safe = publicError(error);
      record.status = 'failed';
      record.errorCode = safe.code;
      record.failedAt = new Date().toISOString();
      await discard([record.objectKey]).catch(() => {});
      await save();
      throw safe;
    } finally {
      req.removeListener('aborted', disconnected);
      res.removeListener('close', disconnected);
    }
  }

  function usableUpload(upload) {
    if (!upload || !ID.test(upload.id) || upload.status !== 'ready' || upload.scan !== 'clean'
        || !Number.isSafeInteger(upload.sizeBytes) || upload.sizeBytes <= 0
        || !/^[0-9a-f]{64}$/.test(upload.hash)) return false;
    if (upload.kind === 'image') {
      const ext = String(upload.objectKey || '').startsWith(`${upload.id}.`)
        ? String(upload.objectKey).slice(upload.id.length + 1) : '';
      return !!IMAGE_MIME[ext] && upload.mime === IMAGE_MIME[ext]
        && upload.sizeBytes <= imageMaxBytes
        && Array.isArray(upload.previews) && upload.previews.length === 0;
    }
    return upload.objectKey === `${upload.id}.pdf`
      && Number.isInteger(upload.pages) && upload.pages >= 1 && upload.pages <= PDF_LIMITS.maxPages
      && upload.sizeBytes <= maxBytes
      && Array.isArray(upload.previews) && upload.previews.length === Math.min(2, upload.pages)
      && upload.previews.every((entry, index) => entry.page === index + 1
        && entry.objectKey === `${upload.id}.${index + 1}.png` && /^[0-9a-f]{64}$/.test(entry.hash));
  }

  function prepareAttachments(user, inputs = []) {
    const actor = requireUser(user);
    if (!Array.isArray(inputs)) throw fileError('invalid_attachment', 400, '附件列表无效');
    if (inputs.length > 3) throw fileError('too_many_attachments', 400, '每帖最多 3 个 PDF 附件');
    const ids = new Set();
    const result = inputs.map((input) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'uploadId') || !ID.test(input.uploadId)) {
        throw fileError('invalid_attachment', 400, '附件仅可提交 uploadId');
      }
      if (ids.has(input.uploadId)) throw fileError('invalid_attachment', 400, '同一附件不能重复提交');
      ids.add(input.uploadId);
      const upload = db.uploads.find((entry) => entry.id === input.uploadId);
      if (!usableUpload(upload) || upload.ownerId !== actor.id) {
        throw fileError('invalid_attachment', 400, '附件不存在、尚未就绪或不属于当前账号');
      }
      if (upload.postId || upload.attachmentId || (db.attachments || []).some((entry) => entry.uploadId === upload.id)) {
        throw fileError('upload_consumed', 409, '附件已用于其他帖子，请重新上传');
      }
      return canonical(upload);
    });
    Object.freeze(result);
    preparedBatches.add(result);
    return result;
  }

  function finalizePost(post, inputs) {
    if (!preparedBatches.has(inputs)) throw fileError('invalid_attachment', 400, '必须使用服务端校验后的附件');
    const actualPost = (db.posts || []).find((entry) => entry.id === post?.id);
    if (!actualPost || actualPost.status !== 'published') throw fileError('invalid_attachment', 400, '帖子不可绑定附件');
    requireUser({ id: actualPost.authorId });
    const attachments = (db.attachments || []).filter((entry) => entry.postId === actualPost.id);
    if (attachments.length !== inputs.length) throw fileError('invalid_attachment', 400, '帖子附件数量不一致');
    const uploads = inputs.map((input, index) => {
      const upload = db.uploads.find((entry) => entry.id === input.uploadId);
      if (!usableUpload(upload) || upload.ownerId !== actualPost.authorId || upload.postId || upload.attachmentId
          || attachments[index].path !== publicDownload(upload.id)
          || (db.attachments || []).some((entry) => entry.uploadId === upload.id && entry !== attachments[index])) {
        throw fileError('upload_consumed', 409, '附件不可重复绑定');
      }
      return upload;
    });
    for (let index = 0; index < uploads.length; index += 1) {
      const upload = uploads[index];
      const attachment = attachments[index];
      Object.assign(attachment, canonical(upload));
      delete attachment.demoPath;
      delete attachment.objectKey;
      upload.postId = actualPost.id;
      upload.attachmentId = attachment.id;
      upload.boundAt = new Date().toISOString();
    }
    for (const resource of (db.resources || []).filter((entry) => entry.postId === actualPost.id)) {
      resource.previews = uploads.flatMap((upload) => upload.previews.map(({ page }) => publicPreview(upload.id, page)));
    }
    preparedBatches.delete(inputs);
    return attachments;
  }

  function prepareImages(user, inputs = []) {
    const actor = requireUser(user);
    if (!Array.isArray(inputs)) throw fileError('invalid_image', 400, '图片列表无效');
    if (inputs.length > 9) throw fileError('too_many_images', 400, '每帖最多 9 张图片');
    const ids = new Set();
    const result = inputs.map((input) => {
      const uploadId = typeof input === 'string' ? input : input?.uploadId;
      if (typeof uploadId !== 'string' || !ID.test(uploadId) || ids.has(uploadId)) {
        throw fileError('invalid_image', 400, '图片参数无效');
      }
      ids.add(uploadId);
      const upload = db.uploads.find((entry) => entry.id === uploadId);
      if (!usableUpload(upload) || upload.kind !== 'image' || upload.ownerId !== actor.id) {
        throw fileError('invalid_image', 400, '图片不存在、尚未就绪或不属于当前账号');
      }
      if (upload.postId) throw fileError('upload_consumed', 409, '图片已用于其他帖子，请重新上传');
      return Object.freeze({ uploadId: upload.id, kind: 'image', path: publicImage(upload.id) });
    });
    Object.freeze(result);
    preparedImages.add(result);
    return result;
  }

  function finalizeImages(post, inputs) {
    if (!preparedImages.has(inputs)) throw fileError('invalid_image', 400, '必须使用服务端校验后的图片');
    const actualPost = (db.posts || []).find((entry) => entry.id === post?.id);
    if (!actualPost || actualPost.status !== 'published') throw fileError('invalid_image', 400, '帖子不可绑定图片');
    requireUser({ id: actualPost.authorId });
    const bound = inputs.map((input) => {
      const upload = db.uploads.find((entry) => entry.id === input.uploadId);
      if (!usableUpload(upload) || upload.ownerId !== actualPost.authorId || upload.postId) {
        throw fileError('upload_consumed', 409, '图片不可重复绑定');
      }
      return upload;
    });
    for (const upload of bound) {
      upload.postId = actualPost.id;
      upload.boundAt = new Date().toISOString();
    }
    preparedImages.delete(inputs);
    return inputs.map((input) => input.path);
  }

  function publishedAttachment(upload) {
    if (!usableUpload(upload) || !upload.postId || !upload.attachmentId) return null;
    const attachment = (db.attachments || []).find((entry) => entry.id === upload.attachmentId);
    const post = (db.posts || []).find((entry) => entry.id === upload.postId);
    const author = (db.users || []).find((entry) => entry.id === post?.authorId);
    if (!attachment || attachment.uploadId !== upload.id || attachment.postId !== upload.postId
        || attachment.status !== 'ready' || attachment.demo !== false || attachment.kind !== 'pdf'
        || attachment.path !== publicDownload(upload.id) || post?.status !== 'published'
        || author?.status !== 'active' || author.id !== upload.ownerId) return null;
    // Index/search visibility is not attachment authorization. Unindexing retains
    // access from the original published post, while explicit blocking revokes it.
    const resources = (db.resources || []).filter((entry) => entry.postId === post.id);
    if (resources.some((resource) => !knownResourceStates.has(resource.status))) return null;
    if (post.circleId) {
      const circle = (db.circles || []).find((entry) => entry.id === post.circleId);
      if (!circle || !['active', 'archived'].includes(circle.status)) return null;
    }
    return { attachment, post };
  }

  function publishedImage(upload) {
    if (!upload || upload.kind !== 'image' || !upload.postId) return null;
    const post = (db.posts || []).find((entry) => entry.id === upload.postId);
    const author = (db.users || []).find((entry) => entry.id === post?.authorId);
    if (!post || post.status !== 'published' || !author || author.status !== 'active') return null;
    return { upload, post };
  }

  function checkViewer(user) {
    if (user?.id) {
      const current = (db.users || []).find((entry) => entry.id === user.id);
      if (!current || current.status !== 'active') throw fileError('suspended', 403, '账号停用期间不能访问文件');
    }
  }

  function downloadResource(user, payload = {}) {
    try {
      const actor = requireUser(user);
      const attachment = (db.attachments || []).find((entry) => entry.id === payload.attachmentId);
      if (!attachment || attachment.postId !== payload.postId) throw safeFailure();
      const upload = db.uploads.find((entry) => entry.id === attachment.uploadId);
      const current = publishedAttachment(upload);
      if (!current || current.attachment.id !== attachment.id) throw safeFailure();
      // Authentication is checked against db, never trusted fields on payload/user.
      void actor;
      return { ok: true, code: 'ok', message: '已授权下载',
        data: { path: publicDownload(upload.id), name: upload.name } };
    } catch (error) {
      const safe = publicError(error);
      return failed(safe.code, safe.message);
    }
  }

  async function serve(req, res, id, operation, page, user) {
    checkViewer(user);
    const upload = db.uploads.find((entry) => entry.id === id);
    if (!usableUpload(upload)) throw safeFailure();
    if (operation === 'image') {
      // 图片随帖子公开：帖子已发布且作者可用才可读，不要求登录
      if (!publishedImage(upload)) throw safeFailure();
      let bytes;
      try { bytes = await privateRead(upload.objectKey, imageMaxBytes); } catch { throw safeFailure(); }
      if (createHash('sha256').update(bytes).digest('hex') !== upload.hash) throw safeFailure();
      res.writeHead(200, { 'Content-Type': upload.mime, 'Content-Length': bytes.length,
        'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Disposition': 'inline', 'Referrer-Policy': 'no-referrer' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
      return;
    }
    if (operation === 'download') {
      requireUser(user);
      if (!publishedAttachment(upload)) throw safeFailure();
    } else if (upload.postId || upload.attachmentId) {
      if (!publishedAttachment(upload)) throw safeFailure();
    } else {
      // Unpublished previews stay owner-only; 404 (not 401) so anonymous probes
      // cannot distinguish an in-progress upload from a missing one.
      const owner = user?.id ? (db.users || []).find((entry) => entry.id === user.id) : null;
      if (!owner || owner.id !== upload.ownerId) throw safeFailure();
    }
    let key = upload.objectKey;
    let hash = upload.hash;
    let limit = maxBytes;
    if (operation !== 'download') {
      const preview = upload.previews.find((entry) => entry.page === Number(page));
      if (!preview) throw safeFailure();
      key = preview.objectKey;
      hash = preview.hash;
      limit = PDF_LIMITS.maxPreviewBytes;
    }
    let bytes;
    try { bytes = await privateRead(key, limit); } catch { throw safeFailure(); }
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw safeFailure();
    // No expiry tokens, no public static paths and no cached authorization.
    if ((upload.postId || upload.attachmentId) && !publishedAttachment(upload)) throw safeFailure();
    checkViewer(user);
    if (operation === 'download') requireUser(user);
    const headers = { 'Content-Type': operation === 'download' ? 'application/pdf' : 'image/png',
      'Content-Length': bytes.length, 'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer' };
    if (operation === 'download') {
      const encoded = encodeURIComponent(upload.name).replace(/['()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      headers['Content-Disposition'] = `attachment; filename="document.pdf"; filename*=UTF-8''${encoded}`;
    } else headers['Content-Disposition'] = 'inline';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : bytes);
  }

  async function handle(req, res, { pathname, user } = {}) {
    if (pathname !== '/api/files' && !String(pathname || '').startsWith('/api/files/')) return false;
    try {
      if (pathname === '/api/files' && req.method === 'POST') {
        await upload(req, res, user);
      } else {
        const match = ROUTE.exec(pathname);
        if (!match) throw safeFailure();
        if (!['GET', 'HEAD'].includes(req.method)) {
          res.setHeader('Allow', 'GET, HEAD');
          sendJson(res, 405, failed('method_not_allowed', '此接口仅支持读取'));
          return true;
        }
        await serve(req, res, match[1], match[2], match[3], user);
      }
    } catch (error) {
      const safe = publicError(error);
      if (req.method === 'POST') {
        // Close after the error response, rather than buffering an unbounded body.
        res.setHeader('Connection', 'close');
        req.resume();
      }
      if (!res.headersSent && !res.destroyed) sendJson(res, safe.status, failed(safe.code, safe.message));
      else if (!res.writableEnded) res.end();
    }
    return true;
  }

  return { handle, prepareAttachments, finalizePost, prepareImages, finalizeImages, downloadResource };
}
