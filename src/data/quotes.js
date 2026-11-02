/* 每日页签的“今日一句”：测试阶段固定使用泰戈尔《飞鸟集》。
 * 文案由产品提供，不引入外部接口；按上海日期稳定选取，刷新不变。
 */

export const QUOTES = [
  {
    id: 'tagore-stray-birds-1',
    text: '天空不留下鸟的痕迹，但我已飞过。',
    author: '泰戈尔',
    source: '《飞鸟集》'
  }
];

export function quoteOfDay(dateKey = '') {
  const key = String(dateKey || '');
  let hash = 0;
  for (const ch of key) hash = (hash + ch.codePointAt(0)) % 100000;
  return QUOTES[hash % QUOTES.length];
}

export const BOOKMARK_RULES = {
  timezone: 'Asia/Shanghai',
  monthDay: '10-27',
  firstYear: 2026,
  anniversaryQuote: '世界很大，我们共读一页。',
  anniversaryAttribution: '共页'
};

/** 由上海日期（YYYY-MM-DD）决定今日页签的句子与标签 */
export function bookmarkOfDay(dateKey) {
  const date = String(dateKey || '');
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const isAnniversary = month === 10 && day === 27 && year >= BOOKMARK_RULES.firstYear;
  if (isAnniversary) {
    const years = year - BOOKMARK_RULES.firstYear;
    return {
      date,
      quote: BOOKMARK_RULES.anniversaryQuote,
      attribution: BOOKMARK_RULES.anniversaryAttribution,
      label: years === 0 ? '创立纪念' : `${years}周年`,
      isAnniversary: true
    };
  }
  const quote = quoteOfDay(date);
  return {
    date,
    quote: quote.text,
    attribution: `${quote.author} · ${quote.source}`,
    label: '每日一句',
    isAnniversary: false
  };
}
