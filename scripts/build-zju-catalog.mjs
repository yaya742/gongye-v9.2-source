/* 从浙大教务系统课程名称清单生成课程与课友圈种子数据。
 *
 * 用法（在 app/ 目录）：
 *   node scripts/build-zju-catalog.mjs ../../zju-course-offerings-names-2026-2027-autumn-winter-20261029.md
 *
 * 说明：
 * - 清单只有课程名称，没有学分、教师、教学班，因此只生成课程与一个「2026秋冬」待补充圈；
 * - 学期统一写 2026秋冬（秋冬学期尚未细分，后续再补）；
 * - id 用课程名的稳定短哈希，重复运行结果一致；与现有演示课程按名称去重。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const source = process.argv[2] ? resolve(process.argv[2]) : null;
if (!source) {
  console.error('缺少课程清单 markdown 路径');
  process.exit(1);
}

const text = readFileSync(source, 'utf8');
const lines = text.split(/\r?\n/);
const start = lines.findIndex((line) => line.trim() === '## 课程名称');
if (start < 0) throw new Error('清单里没有「## 课程名称」小节');
const names = [];
for (const line of lines.slice(start + 1)) {
  const match = line.match(/^-\s+(.+)$/);
  if (match) names.push(match[1].trim());
}
if (names.length < 100) throw new Error(`只解析到 ${names.length} 门课程，疑似格式变化`);

function hash36(value) {
  let h = 0x811c9dc5;
  for (const char of value) {
    h ^= char.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(-7);
}

const seen = new Map();
const courses = names.map((name) => {
  let key = hash36(name);
  if (seen.has(key)) {
    let n = 2;
    while (seen.has(`${key}${n}`)) n += 1;
    key = `${key}${n}`;
  }
  seen.set(key, true);
  return { id: `zj_${key}`, name };
});

const header = `/* 浙江大学 2026-2027 秋冬学期开课课程（仅名称）。
 * 来源：zju-course-offerings-names-2026-2027-autumn-winter-20261029.md（2026-10-29 读取）。
 * 由 scripts/build-zju-catalog.mjs 生成，不要手改。
 * 只有课程名称：学期统一为「2026秋冬」，教学班/教师/学分待补充。
 * 课友圈在 seed.js 里由这里派生（id: zjc_<key>，一个课程一个待补充圈）。
 */

export const ZJU_TERM = '2026秋冬';
export const ZJU_SCHOOL = '浙江大学';

export const ZJU_COURSES = ${JSON.stringify(courses)};
`;

writeFileSync(join(appDir, 'src/data/zju-courses-2026aw.js'), header, 'utf8');
console.log(`已生成 ${courses.length} 门课程（2026秋冬 待补充圈在 seed.js 派生）`);