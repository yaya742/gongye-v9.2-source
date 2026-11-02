/* 等级与经验规则（第四次更新 v4.2）
 * 机器可读来源：gongye-update-v4/design/growth-rules.json
 * 规则版本固定写进决策，调参不改写旧流水。
 */

export const GROWTH_RULES = {
  version: 'growth-v4.3',
  timezone: 'Asia/Shanghai',
  levels: [
    { level: 1, name: '初翻', threshold: 0 },
    { level: 2, name: '拾页', threshold: 50 },
    { level: 3, name: '成册', threshold: 150 },
    { level: 4, name: '共著', threshold: 400 },
    { level: 5, name: '传薪', threshold: 1000 }
  ],
  rewards: {
    post: { xp: 5, daily: 2, minChars: 20 },
    comment: { xp: 1, daily: 5, perPostDaily: 1, minChars: 10 },
    accepted: { xp: 10, daily: 2, perAskerDaily: 1, minChars: 10 },
    marker: { xp: 5, daily: 5, perSenderDaily: 1 }
  },
  dedupeWindowDays: 30,
  presentation: {
    badgeHeight: 24,
    progressMs: 260,
    upgradeFadeMs: 200,
    upgradeNoticeSeconds: 4,
    maxInlineBrandIllustrations: 1
  }
};

const LEVELS = GROWTH_RULES.levels;

/** 按「阈值本身归入新等级」计算等级与进度 */
export function levelFor(xpInput = 0) {
  const xp = Math.max(0, Math.floor(Number(xpInput) || 0));
  let index = 0;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (xp >= LEVELS[i].threshold) index = i;
  }
  const current = LEVELS[index];
  const next = LEVELS[index + 1] || null;
  const within = xp - current.threshold;
  const span = next ? next.threshold - current.threshold : 0;
  const remaining = next ? next.threshold - xp : 0;
  return {
    level: current.level,
    name: current.name,
    threshold: current.threshold,
    nextAt: next ? next.threshold : null,
    nextName: next ? next.name : null,
    within,
    span,
    remaining,
    isMax: !next,
    percent: next ? Math.min(100, Math.round((within / span) * 100)) : 100
  };
}

/** 有效文本：NFKC、去掉引用/链接/图片，按 Unicode 字母与数字码点计数 */
export function effectiveTextLength(input) {
  let text = String(input || '').normalize('NFKC');
  text = text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\((?:https?:\/\/|#|\/)[^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*\n?/gi, ''))
    .replace(/[*_~`#]/g, '');
  let count = 0;
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch)) count += 1;
  }
  return count;
}

/** 去重摘要：casefold + 去空白标点，只保留字母与数字 */
export function normalizeForDedupe(input) {
  return String(input || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

