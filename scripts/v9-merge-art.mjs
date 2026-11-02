/* 第九版美术合并：把 bookmarks 包的逐日插画字段合并进每日页签数据。
 *
 * 用法（在 app/ 目录）：
 *   node scripts/v9-merge-art.mjs ../../gongye-v9-complete-art-pack/bookmarks
 *
 * 规则：
 * - 以项目现有 daily-bookmarks.js 为文案唯一来源（线上可能人工改过），只补插画字段；
 * - 102 天主版本写 illustration_path = assets/daily/webp/<date>.webp；
 * - 4 个公历文化日期额外写 neutral_illustration_path，并把完整中性文案导出为
 *   CULTURAL_FALLBACKS，供文化主题开关关闭时切换；
 * - 不覆盖 id / quote / 作者 / 出处 / 领取相关字段。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const packRoot = process.argv[2] ? resolve(process.argv[2]) : null;
if (!packRoot) {
  console.error('缺少 bookmarks 包路径');
  process.exit(1);
}

const { DAILY_BOOKMARKS, BOOKMARK_RANGE } = await import(pathToFileURL(join(appDir, 'src/data/daily-bookmarks.js')));

const packDaily = JSON.parse(readFileSync(join(packRoot, 'data/daily-bookmarks.json'), 'utf8'));
const packNeutral = JSON.parse(readFileSync(join(packRoot, 'data/cultural-fallbacks.json'), 'utf8'));
const byDate = new Map(packDaily.map((entry) => [entry.date, entry]));
const neutralByDate = new Map(packNeutral.map((entry) => [entry.date, entry]));

if (DAILY_BOOKMARKS.length !== BOOKMARK_RANGE.count) {
  throw new Error(`现有数据条数 ${DAILY_BOOKMARKS.length} 与 BOOKMARK_RANGE.count 不一致`);
}

const textKeys = ['quote', 'quote_author', 'quote_title', 'source_url', 'theme_title', 'weekday', 'lunar_label'];
const diffs = [];
for (const entry of DAILY_BOOKMARKS) {
  const pack = byDate.get(entry.date);
  if (!pack) throw new Error(`包内缺少日期 ${entry.date}`);
  for (const key of textKeys) {
    const a = entry[key] ?? null;
    const b = pack[key] ?? null;
    if (a !== b) diffs.push(`${entry.date} ${key}: 项目=${JSON.stringify(a)} 包=${JSON.stringify(b)}`);
  }
  const neutral = neutralByDate.get(entry.date);
  if (neutral && neutral.quote !== pack.quote) {
    diffs.push(`${entry.date} neutral 文案与主版本不同（预期，用于文化开关）`);
  }
}

const next = DAILY_BOOKMARKS.map((entry) => {
  const pack = byDate.get(entry.date);
  const neutral = neutralByDate.get(entry.date);
  const merged = {
    ...entry,
    illustration_id: pack.illustration_id || `gy-art-${entry.date}`,
    illustration_path: `assets/daily/webp/${entry.date}.webp`,
    illustration_png_path: `assets/daily/png/${entry.date}.png`,
    illustration_scene: pack.illustration_scene || '',
    illustration_variant: 'primary',
    neutral_illustration_path: neutral ? `assets/daily/webp/${entry.date}-neutral.webp` : null
  };
  return merged;
});

const fallbacks = Array.from(neutralByDate.values()).map((entry) => ({
  id: entry.id,
  date: entry.date,
  weekday: entry.weekday,
  lunar_label: entry.lunar_label,
  theme_title: entry.theme_title,
  quote: entry.quote,
  quote_lines: entry.quote_lines,
  quote_author: entry.quote_author,
  quote_title: entry.quote_title ?? null,
  quote_attribution: entry.quote_attribution,
  footer_label: entry.footer_label,
  event_type: 'seasonal',
  illustration_id: entry.illustration_id,
  illustration_path: `assets/daily/webp/${entry.date}-neutral.webp`,
  illustration_png_path: `assets/daily/png/${entry.date}-neutral.png`,
  illustration_scene: entry.illustration_scene || '',
  illustration_variant: 'neutral'
}));

const header = `/* 每日页签配置：2026-10-27 至 2027-02-05，共 102 天。
 * 文案与出处沿用第六版；插画为第九版「一日一画」逐日独立图（assets/daily/webp）。
 * 4 个公历文化日期保留中性替代版本，由配置项 culturalThemes 控制。
 * 本文件由 scripts/v9-merge-art.mjs 生成，改动请改脚本或包数据后重新生成。
 * 仅展示用；领取额度仍由现有业务规则校验。
 */

`;

const body = `export const DAILY_BOOKMARKS = ${JSON.stringify(next, null, 2)};

/** 公历文化日期的中性替代：文化主题开关关闭时整张卡（文案+插画）切到这里 */
export const CULTURAL_FALLBACKS = ${JSON.stringify(fallbacks, null, 2)};

export const CULTURAL_DATES = ${JSON.stringify(fallbacks.map((entry) => entry.date), null, 2)};

export const BOOKMARK_RANGE = ${JSON.stringify(BOOKMARK_RANGE)};

export function bookmarkEntry(dateKey) {
  return DAILY_BOOKMARKS.find((entry) => entry.date === dateKey) || null;
}

export function culturalFallback(dateKey) {
  return CULTURAL_FALLBACKS.find((entry) => entry.date === dateKey) || null;
}

/** 按文化主题开关取当日配置；默认开启（节日版本） */
export function bookmarkEntryFor(dateKey, { culturalThemes = true } = {}) {
  const entry = bookmarkEntry(dateKey);
  if (!entry) return null;
  if (!culturalThemes) {
    const neutral = culturalFallback(dateKey);
    if (neutral) return neutral;
  }
  return entry;
}

export function bookmarkInRange(dateKey) {
  return dateKey >= BOOKMARK_RANGE.start && dateKey <= BOOKMARK_RANGE.end;
}
`;

writeFileSync(join(appDir, 'src/data/daily-bookmarks.js'), header + body, 'utf8');

console.log(`已合并 ${next.length} 天插画；中性替代 ${fallbacks.length} 张`);
console.log(`文案差异 ${diffs.filter((line) => !line.includes('neutral 文案')).length} 条`);
for (const line of diffs) console.log(`  - ${line}`);
