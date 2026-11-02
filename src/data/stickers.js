/* 页页表情白名单（Art V3 + 第九版第二/三弹）
 * 服务端与前端共用：只接受这里的固定 ID，不接受任意路径或外链。
 * 第一弹 ID 与历史评论保持原样；第二/三弹按稳定 ID 追加，不改成 v9。
 */

export const STICKER_PACKS = [
  { key: 1, label: '第一弹' },
  { key: 2, label: '第二弹' },
  { key: 3, label: '第三弹' }
];

export const STICKERS = [
  {
    id: 'yeye.received.v1',
    label: '收到',
    pack: 1,
    file: 'assets/stickers/yeye-received.png',
    thumb: 'assets/stickers/yeye-received.png',
    fallback: '【页页表情：收到】'
  },
  {
    id: 'yeye.thinking.v1',
    label: '再想想',
    pack: 1,
    file: 'assets/stickers/yeye-thinking.png',
    thumb: 'assets/stickers/yeye-thinking.png',
    fallback: '【页页表情：再想想】'
  },
  {
    id: 'yeye.thanks.v1',
    label: '谢谢',
    pack: 1,
    file: 'assets/stickers/yeye-thanks.png',
    thumb: 'assets/stickers/yeye-thanks.png',
    fallback: '【页页表情：谢谢】'
  },
  {
    id: 'yeye.updated.v1',
    label: '补好了',
    pack: 1,
    file: 'assets/stickers/yeye-updated.png',
    thumb: 'assets/stickers/yeye-updated.png',
    fallback: '【页页表情：补好了】'
  },
  /* 第二弹 · 期中精神状态（10 张） */
  {
    id: 'yeye.cry.v2',
    label: '哭哭',
    pack: 2,
    file: 'assets/stickers/vol2/webp/yeye-cry.webp',
    thumb: 'assets/stickers/vol2/thumb/yeye-cry.webp',
    fallback: '【页页表情：哭哭】'
  },
  {
    id: 'yeye.bless.v2',
    label: '考神保佑',
    pack: 2,
    file: 'assets/stickers/vol2/webp/yeye-bless.webp',
    thumb: 'assets/stickers/vol2/thumb/yeye-bless.webp',
    fallback: '【页页表情：考神保佑】'
  },
  {
    id: 'yeye.confused.v2',
    label: '知识进不来',
    pack: 2,
    file: 'assets/stickers/vol2/webp/yeye-confused.webp',
    thumb: 'assets/stickers/vol2/thumb/yeye-confused.webp',
    fallback: '【页页表情：知识进不来】'
  },
  {
    id: 'yeye.five-minutes.v2',
    label: '再学五分钟',
    pack: 2,
    file: 'assets/stickers/vol2/webp/yeye-five-minutes.webp',
    thumb: 'assets/stickers/vol2/thumb/yeye-five-minutes.webp',
    fallback: '【页页表情：再学五分钟】'
  },
  {
    id: 'yeye.same.v2',
    label: '原来你也不会',
    pack: 2,
    file: 'assets/stickers/vol2/webp/yeye-same.webp',
    thumb: 'assets/stickers/vol2/thumb/yeye-same.webp',
    fallback: '【页页表情：原来你也不会】'
  },
  {
    id: 'yeye.notes.v2',
    label: '笔记给你',
    pack: 2,
    file: 'assets/stickers/vol2/webp/yeye-notes.webp',
    thumb: 'assets/stickers/vol2/thumb/yeye-notes.webp',
    fallback: '【页页表情：笔记给你】'
  },
  {
    id: 'yeye.luck.v2',
    label: '接住好运',
    pack: 2,
    file: 'assets/stickers/vol2/webp/yeye-luck.webp',
    thumb: 'assets/stickers/vol2/thumb/yeye-luck.webp',
    fallback: '【页页表情：接住好运】'
  },
  {
    id: 'yeye.revive.v2',
    label: '考完复活',
    pack: 2,
    file: 'assets/stickers/vol2/webp/yeye-revive.webp',
    thumb: 'assets/stickers/vol2/thumb/yeye-revive.webp',
    fallback: '【页页表情：考完复活】'
  },
  {
    id: 'yeye.buffering.v2',
    label: '脑子加载中',
    pack: 2,
    file: 'assets/stickers/vol2/webp/yeye-buffering.webp',
    thumb: 'assets/stickers/vol2/thumb/yeye-buffering.webp',
    fallback: '【页页表情：脑子加载中】'
  },
  {
    id: 'yeye.together.v2',
    label: '一起过过过',
    pack: 2,
    file: 'assets/stickers/vol2/webp/yeye-together.webp',
    thumb: 'assets/stickers/vol2/thumb/yeye-together.webp',
    fallback: '【页页表情：一起过过过】'
  },
  /* 第三弹 · 上课精神状态（8 张） */
  {
    id: 'yeye.overload.v3',
    label: '概念过载',
    pack: 3,
    file: 'assets/stickers/vol3/webp/yeye-overload.webp',
    thumb: 'assets/stickers/vol3/thumb/yeye-overload.webp',
    fallback: '【页页表情：概念过载】'
  },
  {
    id: 'yeye.maybe.v3',
    label: '好像听懂了',
    pack: 3,
    file: 'assets/stickers/vol3/webp/yeye-maybe.webp',
    thumb: 'assets/stickers/vol3/thumb/yeye-maybe.webp',
    fallback: '【页页表情：好像听懂了】'
  },
  {
    id: 'yeye.write-first.v3',
    label: '先记下来',
    pack: 3,
    file: 'assets/stickers/vol3/webp/yeye-write-first.webp',
    thumb: 'assets/stickers/vol3/thumb/yeye-write-first.webp',
    fallback: '【页页表情：先记下来】'
  },
  {
    id: 'yeye.pause.v3',
    label: '让我缓缓',
    pack: 3,
    file: 'assets/stickers/vol3/webp/yeye-pause.webp',
    thumb: 'assets/stickers/vol3/thumb/yeye-pause.webp',
    fallback: '【页页表情：让我缓缓】'
  },
  {
    id: 'yeye.i-know.v3',
    label: '这题我会',
    pack: 3,
    file: 'assets/stickers/vol3/webp/yeye-i-know.webp',
    thumb: 'assets/stickers/vol3/thumb/yeye-i-know.webp',
    fallback: '【页页表情：这题我会】'
  },
  {
    id: 'yeye.explain.v3',
    label: '再讲一遍',
    pack: 3,
    file: 'assets/stickers/vol3/webp/yeye-explain.webp',
    thumb: 'assets/stickers/vol3/thumb/yeye-explain.webp',
    fallback: '【页页表情：再讲一遍】'
  },
  {
    id: 'yeye.hungry.v3',
    label: '饭点到了',
    pack: 3,
    file: 'assets/stickers/vol3/webp/yeye-hungry.webp',
    thumb: 'assets/stickers/vol3/thumb/yeye-hungry.webp',
    fallback: '【页页表情：饭点到了】'
  },
  {
    id: 'yeye.dismissed.v3',
    label: '下课了！',
    pack: 3,
    file: 'assets/stickers/vol3/webp/yeye-dismissed.webp',
    thumb: 'assets/stickers/vol3/thumb/yeye-dismissed.webp',
    fallback: '【页页表情：下课了！】'
  }
];

export const STICKER_IDS = STICKERS.map((item) => item.id);

export function stickerOf(id) {
  return STICKERS.find((item) => item.id === id) || null;
}

export function isValidSticker(id) {
  return STICKER_IDS.includes(id);
}

export function stickersByPack(pack) {
  return STICKERS.filter((item) => item.pack === pack);
}

/** 渲染一个表情；失败时由 main.js 的捕获监听替换为文本 fallback */
export function stickerMarkup(id, className = '', { thumb = false } = {}) {
  const sticker = stickerOf(id);
  if (!sticker) return '';
  const src = thumb ? sticker.thumb : sticker.file;
  return `<img class="sticker ${className}" src="${src}" alt="页页表情：${sticker.label}"
    data-sticker-id="${sticker.id}" data-sticker-fallback="${sticker.fallback}" loading="lazy">`;
}
