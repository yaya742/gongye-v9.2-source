#!/usr/bin/env node
/** 只读迁入预检：不写库、不公开、不绕过扫描或授权。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSeed } from '../src/data/seed.js';
import { TERMS, RESOURCE_TYPES } from '../src/lib/format.js';

const manifestPath = process.argv[2];
if (!manifestPath || manifestPath === '--help') {
  console.log('用法：npm run import:preview -- ./migration/manifest.json');
  console.log('只读检查PDF路径、大小、重复、课程、元信息与权利声明。报告输出到终端；不发请求、不上传、不发布。');
  console.log('清单结构见 migration/manifest.example.json；file 路径相对于清单所在目录，不能越出该目录。');
  process.exit(0);
}
const absoluteManifest = path.resolve(manifestPath);
const baseDir = await fs.realpath(path.dirname(absoluteManifest));
const rows = JSON.parse(await fs.readFile(absoluteManifest, 'utf8'));
if (!Array.isArray(rows) || rows.length > 10000) throw new Error('清单必须是最多10000项的JSON数组');
const courses = new Map(createSeed().courses.filter((c) => c.id !== 'c_general').map((c) => [c.id, c]));
const hashes = new Map();
let valid = 0;
for (const [index, row] of rows.entries()) {
  const errors = [];
  let digest = null;
  let sizeBytes = null;
  const course = courses.get(row.courseId);
  if (!course || course.school !== '浙江大学') errors.push('请选择真实浙大courseId；课程名称相同也不要自行合并ID');
  if (String(row.title || '').trim().length < 4 || String(row.title || '').length > 80) errors.push('title须4–80字');
  if (!TERMS.includes(row.term)) errors.push('无效term');
  if (!RESOURCE_TYPES.includes(row.type)) errors.push('无效type');
  if (String(row.coverage || '').trim().length < 4) errors.push('coverage至少4字');
  if (!String(row.limitations || '').trim()) errors.push('请填写limitations（如无则明确写无）');
  if (!['原创', '已授权', '公开许可'].includes(row.rights)) errors.push('rights须原创/已授权/公开许可');
  if (String(row.source || '').trim().length < 4 || String(row.source || '').length > 500) errors.push('source须4–500字');
  if (row.confirmedSharingRights !== true) errors.push('须人工核实并确认confirmedSharingRights；不等于平台鉴定版权');
  try {
    if (typeof row.file !== 'string' || path.isAbsolute(row.file)) throw new Error('file须是相对路径');
    const filename = await fs.realpath(path.resolve(baseDir, row.file));
    const relative = path.relative(baseDir, filename);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('file不能越出清单目录');
    const info = await fs.stat(filename);
    sizeBytes = info.size;
    if (!info.isFile() || info.size < 8 || info.size > 20 * 1024 * 1024) throw new Error('须为8字节至20MiB内的文件');
    const data = await fs.readFile(filename);
    if (!data.subarray(0, 8).toString('ascii').startsWith('%PDF-') || path.extname(filename).toLowerCase() !== '.pdf') throw new Error('目前只支持PDF，文件头与扩展名须匹配');
    digest = createHash('sha256').update(data).digest('hex');
    if (hashes.has(digest)) errors.push(`文件内容与第${hashes.get(digest)}项重复，先人工去重`);
    else hashes.set(digest, index + 1);
  } catch (error) { errors.push(error.message); }
  if (!errors.length) valid += 1;
  console.log(JSON.stringify({ index: index + 1, title: row.title, course: course?.name || null,
    sizeBytes, sha256: digest, precheckPassed: !errors.length, errors }));
}
console.log(`预检完成：${valid}/${rows.length}项通过元信息检查。未执行病毒扫描、PDF渲染、上传或发布。`);
console.log('通过项仍须由授权账号通过正常上传入口扫描、预览并确认发布，不能直接写入SQLite。');
if (valid !== rows.length) process.exitCode = 1;
