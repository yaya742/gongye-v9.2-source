import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import path from 'node:path';

export const PDF_LIMITS = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxPages: 500,
  maxPagePixels: 16_000_000,
  maxPreviewPixels: 4_000_000,
  maxPreviewBytes: 8 * 1024 * 1024,
  timeoutMs: 30_000
});

export function fileError(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

const invalid = () => fileError('invalid_pdf', 422, 'PDF 已损坏、加密或包含不支持的结构');
const unsafe = () => fileError('unsafe_pdf', 422, 'PDF 包含脚本、嵌入文件或不安全动作');
const unavailable = () => fileError('scan_unavailable', 503, '文件安全扫描服务暂不可用');
const renderUnavailable = () => fileError('render_unavailable', 503, 'PDF 预览服务暂不可用');
const decodedNames = (text) => text.replace(/#[0-9a-f]{2}/gi,
  (value) => String.fromCharCode(Number.parseInt(value.slice(1), 16)));
const DANGEROUS = /\/(?:JavaScript|JS|OpenAction|AA|Launch|RichMedia|EmbeddedFile|EmbeddedFiles|XFA|SubmitForm|ImportData|GoToR|GoToE|Movie|Sound)\b/;

// This is a cheap envelope check, not a substitute for the isolated PDF.js parse.
export function validatePdfBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 40
      || !/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(bytes.subarray(0, 16).toString('latin1'))) throw invalid();
  const tail = bytes.subarray(Math.max(0, bytes.length - 2048)).toString('latin1');
  const ending = /startxref\s+(\d+)\s+%%EOF[\t\n\f\r ]*$/.exec(tail);
  if (!ending) throw invalid();
  const offset = Number(ending[1]);
  if (!Number.isSafeInteger(offset) || offset < 9 || offset >= bytes.length) throw invalid();
  const xref = bytes.subarray(offset, Math.min(offset + 256, bytes.length)).toString('latin1');
  if (!/^xref\b/.test(xref) && !/^\d+\s+\d+\s+obj\b/.test(xref)) throw invalid();
  const text = decodedNames(bytes.toString('latin1'));
  if (/\/Encrypt\b/.test(text)) throw fileError('encrypted_pdf', 422, '暂不支持加密 PDF');
  if (DANGEROUS.test(text)) throw unsafe();
}

function inspectCompressedStreams(bytes) {
  const raw = bytes.toString('latin1');
  const stream = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/gs;
  let match;
  let inflated = 0;
  while ((match = stream.exec(raw))) {
    const dictionary = decodedNames(match[1]);
    if (!/\/FlateDecode\b/.test(dictionary)) {
      // Object streams must be inspectable; opaque image codecs are PDF.js only.
      if (/\/ObjStm\b/.test(dictionary)) throw unsafe();
      continue;
    }
    const filter = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dictionary)?.[1] || '';
    if (!/^(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])$/.test(filter)) throw unsafe();
    let data;
    try {
      data = inflateSync(Buffer.from(match[2], 'latin1'), { maxOutputLength: 16 * 1024 * 1024 });
    } catch { throw invalid(); }
    inflated += data.length;
    if (inflated > 64 * 1024 * 1024) throw fileError('pdf_too_complex', 422, 'PDF 结构过于复杂');
    const text = decodedNames(data.toString('latin1'));
    if (DANGEROUS.test(text) || /\/Encrypt\b/.test(text)) throw unsafe();
  }
}

// clamd TCP INSTREAM. CLAMAV_HOST is deliberately required, never fail open.
// An injected scanner has the same signature and must return true/{clean:true}.
export async function scanPdfWithClamd(filePath, { signal, maxBytes = PDF_LIMITS.maxBytes } = {}) {
  const host = String(process.env.CLAMAV_HOST || '').trim();
  const port = Number(process.env.CLAMAV_PORT || 3310);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw unavailable();
  if (signal?.aborted) throw unavailable();
  const bytes = await readFile(filePath);
  if (bytes.length > maxBytes) throw unavailable();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    let response = '';
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(unavailable());
    const timer = setTimeout(abort, 15_000);
    signal?.addEventListener('abort', abort, { once: true });
    socket.on('error', abort);
    socket.on('close', () => { if (!settled) abort(); });
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (response.length > 4096) return abort();
      if (!response.includes('\0') && !response.includes('\n')) return;
      const verdict = response.replace(/[\0\r\n]+$/, '');
      if (verdict === 'stream: OK') finish(null, { clean: true });
      else if (/^stream: .+ FOUND$/.test(verdict)) {
        finish(fileError('malware_detected', 422, '文件未通过安全扫描'));
      } else abort();
    });
    socket.on('connect', async () => {
      try {
        const write = (chunk) => new Promise((ok, fail) => {
          if (settled || signal?.aborted) return fail(unavailable());
          socket.write(chunk, (error) => error ? fail(error) : ok());
        });
        await write(Buffer.from('zINSTREAM\0'));
        for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
          const chunk = bytes.subarray(offset, offset + 64 * 1024);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          await write(length);
          await write(chunk);
        }
        await write(Buffer.alloc(4));
      } catch { abort(); }
    });
  });
}

// Parsing/rendering runs in a short-lived child process, not in this one. The
// native canvas/PDF.js stack can abort the whole process on hostile input; with
// process isolation a hostile or crashing file only fails its own upload, and
// the deadline kill leaves the HTTP server untouched.
export function renderPdfPreview(filePath, options = {}) {
  const limits = { ...PDF_LIMITS, ...options };
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(fileError('processing_timeout', 408, 'PDF 处理超时'));
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['gongye-pdf-child'], {
      execArgv: ['--max-old-space-size=192'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced',
      windowsHide: true
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (!child.killed && child.exitCode === null) child.kill();
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(fileError('processing_timeout', 408, 'PDF 处理超时'));
    const timer = setTimeout(abort, limits.timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(renderUnavailable()));
    child.on('exit', (code) => {
      // A non-zero/abnormal exit means the parser crashed; never fail open.
      void code;
      if (!settled) finish(renderUnavailable());
    });
    child.on('message', (message) => {
      if (!message || message.ok !== true) {
        finish(fileError(message?.code || 'invalid_pdf', message?.status || 422,
          message?.message || 'PDF 无法处理'));
        return;
      }
      finish(null, { totalPages: message.totalPages,
        pages: message.pages.map(({ page, png }) => ({ page, png: Buffer.from(png) })) });
    });
    child.send({ filePath, limits: {
      maxBytes: limits.maxBytes, maxPages: limits.maxPages,
      maxPagePixels: limits.maxPagePixels, maxPreviewPixels: limits.maxPreviewPixels,
      maxPreviewBytes: limits.maxPreviewBytes, timeoutMs: limits.timeoutMs
    } });
  });
}

async function parseAndRender(filePath, limits) {
  // Cheap structural rejection before any native dependency is loaded, so most
  // malformed files never reach @napi-rs/canvas or PDF.js at all.
  const bytes = await readFile(filePath);
  if (bytes.length > limits.maxBytes) throw invalid();
  validatePdfBytes(bytes);
  inspectCompressedStreams(bytes);
  let pdfjs;
  let canvas;
  try {
    canvas = await import('@napi-rs/canvas');
    for (const name of ['DOMMatrix', 'Path2D', 'ImageData']) {
      if (!globalThis[name] && canvas[name]) globalThis[name] = canvas[name];
    }
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch { throw renderUnavailable(); }
  let standardFontDataUrl;
  try {
    const require = createRequire(import.meta.url);
    standardFontDataUrl = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),
      'standard_fonts').replaceAll('\\', '/') + '/';
  } catch { /* PDF.js still validates; missing fonts must not bypass validation. */ }
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), password: '', isEvalSupported: false,
    enableXfa: false, useSystemFonts: false, disableFontFace: true,
    useWorkerFetch: false, useWasm: false, disableAutoFetch: true,
    disableRange: true, disableStream: true, stopAtErrors: true,
    maxImageSize: limits.maxPagePixels, standardFontDataUrl, verbosity: 0
  });
  task.onPassword = () => { void task.destroy(); };
  let document;
  try {
    document = await task.promise;
    if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > limits.maxPages) {
      throw fileError('pdf_too_complex', 422, 'PDF 页数超出限制');
    }
    if (await document.getJSActions() || await document.getAttachments()) throw unsafe();
    const fields = await document.getFieldObjects();
    if (fields && Object.values(fields).some((entries) => entries.some((entry) => entry.actions))) throw unsafe();
    const pages = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const { width, height } = viewport;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1
          || width > 14400 || height > 14400 || width * height > limits.maxPagePixels) {
        throw fileError('pdf_too_complex', 422, 'PDF 页面尺寸超出限制');
      }
      if (await page.getJSActions()) throw unsafe();
      const annotations = await page.getAnnotations();
      if (annotations.some((entry) => entry.actions || entry.js || entry.unsafeUrl
          || entry.file || entry.attachment || entry.resetForm || entry.isRichText)) throw unsafe();
      await page.getOperatorList();
      if (number <= 2) {
        const scale = Math.min(1.5, 1600 / Math.max(width, height),
          Math.sqrt(limits.maxPreviewPixels / (width * height)));
        const preview = page.getViewport({ scale });
        const output = canvas.createCanvas(Math.ceil(preview.width), Math.ceil(preview.height));
        try {
          await page.render({ canvasContext: output.getContext('2d'), viewport: preview,
            background: 'rgb(255,255,255)', annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
          const png = await output.encode('png');
          if (png.length > limits.maxPreviewBytes) throw fileError('pdf_too_complex', 422, 'PDF 预览超出限制');
          pages.push({ page: number, png });
        } finally { output.width = 1; output.height = 1; }
      }
      page.cleanup();
    }
    return { totalPages: document.numPages, pages };
  } catch (error) {
    if (error?.code && error?.status) throw error;
    throw invalid();
  } finally {
    try { if (document) await document.destroy(); else await task.destroy(); } catch { /* Child exits shortly. */ }
  }
}

// Child-process entry. Started only by renderPdfPreview above.
if (process.argv[2] === 'gongye-pdf-child' && typeof process.send === 'function') {
  process.once('message', async ({ filePath, limits }) => {
    let reply;
    try {
      const result = await parseAndRender(filePath, limits);
      reply = { ok: true, totalPages: result.totalPages, pages: result.pages };
    } catch (error) {
      const known = typeof error?.code === 'string' && Number.isInteger(error?.status);
      reply = { ok: false, code: known ? error.code : 'invalid_pdf',
        status: known ? error.status : 422,
        message: known ? error.message : 'PDF 无法处理' };
    }
    process.send(reply, () => { process.exit(0); });
  });
}
