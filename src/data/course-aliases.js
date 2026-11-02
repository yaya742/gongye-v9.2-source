/* 课程别名表（9.1 搜索用）
 * 别名只负责“把用户说法解析到课程”，不改变任何课程的显示名或历史 course_id。
 * 解析不出唯一课程时不做自动合并：接口返回候选，由用户点选。
 *
 * canonical 用课程正式名的一部分；具体映射以 db.courses 为准，
 * 因此同一别名在不同学校/课程版本下可以指向不同课程。
 */

export const COURSE_ALIASES = [
  { alias: '线代', canonical: '线性代数' },
  { alias: '线性代数', canonical: '线性代数' },
  { alias: '高数', canonical: '微积分' },
  { alias: '微积分', canonical: '微积分' },
  { alias: '概统', canonical: '概率论' },
  { alias: '概率论', canonical: '概率论' },
  { alias: '概率', canonical: '概率论' },
  { alias: '大物', canonical: '大学物理' },
  { alias: '大学物理', canonical: '大学物理' },
  { alias: '物理', canonical: '大学物理' },
  { alias: '数构', canonical: '数据结构' },
  { alias: '数据结构', canonical: '数据结构' },
  { alias: 'python', canonical: 'python' },
  { alias: 'py', canonical: 'python' }
];

/** 常见资料类型/章节词，用于分离“课程”与“剩余意图” */
export const INTENT_WORDS = [
  '期中', '期末', '试卷', '真题', '答案', '题解', '笔记', '复习', '整理',
  '讲义', '课件', '作业', '实验', '总结', '提纲', '重点', '考纲', '习题'
];

export function aliasesOf(canonical) {
  const key = String(canonical || '').toLowerCase();
  return COURSE_ALIASES.filter((row) => row.canonical.toLowerCase() === key).map((row) => row.alias);
}
