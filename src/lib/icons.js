/* 图标、头像与徽记 */
import { esc, levelOf } from './format.js';

const EXTRA = new Set(['circle', 'share', 'link']);

export function icon(name, cls = '') {
  const file = EXTRA.has(name) ? 'assets/art/extra-icons.svg' : 'assets/art/icons.svg';
  return `<svg class="i ${cls}" aria-hidden="true" focusable="false"><use href="${file}#${esc(name)}"></use></svg>`;
}

export function avatar(user, cls = '') {
  const raw = user && user.avatar ? user.avatar : 'art/avatar-01.svg';
  const file = raw.includes('/') ? raw : `art/${raw}`;
  const name = user ? user.nickname : '未登录';
  return `<img class="avatar ${cls}" src="assets/${esc(file)}" alt="${esc(name)}的头像" loading="lazy">`;
}

export function levelBadge(xp) {
  const level = levelOf(xp);
  return `<img class="level-badge" src="assets/art/${esc(level.file)}.svg" alt="等级：${esc(level.name)}">`;
}

export function boardIcon(key) {
  const map = {
    notes: 'board-notes.svg',
    help: 'board-help.svg',
    course: 'board-courses.svg',
    method: 'board-methods.svg'
  };
  return `<img src="assets/art/${map[key] || map.notes}" width="26" height="26" alt="">`;
}

export function fileIcon(kind = 'pdf') {
  const map = { pdf: 'file-pdf.svg', image: 'file-image.svg', unavailable: 'file-unavailable.svg' };
  return `<img src="assets/art/${map[kind] || map.pdf}" alt="${kind === 'pdf' ? 'PDF' : '文件'}" width="34" height="40">`;
}

