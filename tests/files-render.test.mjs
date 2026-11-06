import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { renderPdfPreview } from '../server/file-processing.mjs';

// Opt-in integration: RUN_PDF_INTEGRATION=1 node --test tests/files-render.test.mjs
// Requires deployment dependencies pdfjs-dist and @napi-rs/canvas. All artifacts
// remain beneath tests/, including on failure; no OS temp directory is used.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const enabled = process.env.RUN_PDF_INTEGRATION === '1';

function documentBytes({ size = '200 200', count = 2 } = {}) {
  const pageIds = Array.from({ length: count }, (_, index) => index + 3);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${count} >>`,
    ...pageIds.map(() => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size}] /Resources << >> >>`)
  ];
  let output = '%PDF-1.7\n';
  const offsets = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

async function input(t, bytes) {
  const directory = await mkdtemp(path.join(HERE, '.files-render-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'input.pdf');
  await writeFile(filename, bytes);
  return filename;
}

test('integration: real PDF.js isolated worker renders first two PNG pages', { skip: !enabled }, async (t) => {
  const filename = await input(t, documentBytes({ count: 3 }));
  const result = await renderPdfPreview(filename);
  assert.equal(result.totalPages, 3);
  assert.deepEqual(result.pages.map(({ page }) => page), [1, 2]);
  for (const { png } of result.pages) {
    assert.ok(Buffer.isBuffer(png));
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), 300);
    assert.equal(png.readUInt32BE(20), 300);
  }
});

test('integration: oversized page rejected by the real parser', { skip: !enabled }, async (t) => {
  const filename = await input(t, documentBytes({ size: '20000 20000', count: 1 }));
  await assert.rejects(renderPdfPreview(filename), { code: 'pdf_too_complex' });
});

test('integration: corrupt xref cannot yield ready previews', { skip: !enabled }, async (t) => {
  const filename = await input(t, Buffer.from('%PDF-1.7\ninvalid object\n%%EOF\n'));
  await assert.rejects(renderPdfPreview(filename), { code: 'invalid_pdf' });
});

test('aborted parser is rejected before any dependency or worker is started', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(renderPdfPreview(path.join(HERE, 'never-opened.pdf'), { signal: controller.signal }),
    { code: 'processing_timeout' });
});
