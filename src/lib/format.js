/* 通用格式化与领域常量 */

export const SHANGHAI = 'Asia/Shanghai';

export const LEVELS = [
  { min: 0, name: '初翻', level: 1 },
  { min: 50, name: '拾页', level: 2 },
  { min: 150, name: '成册', level: 3 },
  { min: 400, name: '共著', level: 4 },
  { min: 1000, name: '传薪', level: 5 }
];

export const BOARDS = [
  { key: 'notes', label: '笔记分享', file: 'board-notes' },
  { key: 'help', label: '学习求助', file: 'board-help' },
  { key: 'course', label: '课程讨论', file: 'board-courses' },
  { key: 'method', label: '学习方法', file: 'board-methods' }
];

export const RESOURCE_TYPES = ['笔记', '题解', '复习整理', '学习方法'];

export const TERMS = ['2026秋冬', '2026秋', '2026春', '2025秋', '通用·不限学期'];

export const SCHOOLS = ['示例大学', '通用·不限学校'];

export const DEMO_STORAGE_FALLBACK = 'gongye-demo-v1';

export function boardOf(key) {
  return BOARDS.find((b) => b.key === key) || BOARDS[0];
}

export function levelOf(xp = 0) {
  const value = Math.max(0, Math.floor(Number(xp) || 0));
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (value >= LEVELS[i].min) idx = i;
  }
  const current = LEVELS[idx];
  const next = LEVELS[idx + 1] || null;
  const within = value - current.min;
  const span = next ? next.min - current.min : 0;
  return {
    index: idx + 1,
    level: current.level,
    name: current.name,
    nextAt: next ? next.min : null,
    nextName: next ? next.name : null,
    within,
    span,
    remaining: next ? next.min - value : 0,
    isMax: !next,
    percent: next ? Math.min(100, Math.round((within / span) * 100)) : 100,
    progress: next ? Math.min(1, within / span) : 1,
    chip: `badges/level-${current.level}-chip.svg`,
    icon: `badges/level-${current.level}-icon.svg`
  };
}

/* ---------- 时间 ---------- */

const shDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHANGHAI, year: 'numeric', month: '2-digit', day: '2-digit'
});
const shTimeFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI, hour: '2-digit', minute: '2-digit', hour12: false
});

/** 上海自然日，YYYY-MM-DD */
export function shanghaiDate(date = new Date()) {
  return shDateFmt.format(date);
}

/** 上海日期时间，2026-10-26 14:05 */
export function formatDateTime(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return `${shDateFmt.format(d)} ${shTimeFmt.format(d)}`;
}

export function formatDay(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return shDateFmt.format(d);
}

/** 相对时间：刚刚 / 25 分钟前 / 3 小时前 / 昨天 / 10 月 12 日 */
export function timeAgo(input, now = Date.now()) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24 && sameDay(d, new Date(now))) return `${hours} 小时前`;
  const today = shanghaiDate(new Date(now));
  const yesterday = shanghaiDate(new Date(now - 86400000));
  if (shanghaiDate(d) === yesterday) return '昨天';
  const dayDiff = Math.floor(diff / 86400000);
  if (dayDiff < 7) return `${dayDiff} 天前`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function sameDay(a, b) {
  return shanghaiDate(a) === shanghaiDate(b);
}

/** 上海时间「本周一 00:00」对应的 UTC 时间戳（毫秒） */
export function weekStart(now = Date.now()) {
  const today = shanghaiDate(new Date(now));           // YYYY-MM-DD（上海）
  const parts = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay(); // 0=周日
  const back = (weekday + 6) % 7;                       // 距本日周一的自然日差
  const mondayUtc = Date.UTC(parts[0], parts[1] - 1, parts[2] - back);
  // 该自然日的上海 00:00 = UTC 前一日 16:00
  return mondayUtc - 8 * 3600 * 1000;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

/* ---------- 文本 ---------- */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESC[c]);
}

export function truncate(text, max) {
  const s = String(text == null ? '' : text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function stripMarkdown(text) {
  return String(text == null ? '' : text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_~\-]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countChars(text) {
  return String(text == null ? '' : text).trim().length;
}

export function plural(n, unit) {
  return `${n} ${unit}`;
}

