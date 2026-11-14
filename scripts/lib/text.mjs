/** 文本清洗、时间解析、相似度计算 —— 均为纯函数，便于单测。 */

import { decodeEntities } from './xml.mjs';

const HTML_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function stripHtml(input = '') {
  let text = String(input)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  text = decodeEntities(text).replace(/&[a-z]+;/gi, (m) => HTML_ENTITIES[m.slice(1, -1)] ?? ' ');
  return text.replace(/\s+/g, ' ').trim();
}

export function cleanTitle(input = '') {
  let title = stripHtml(input);
  title = title
    .replace(/^(【[^】]{0,12}】|\[[^\]]{0,12}\])\s*/g, '')
    .replace(/\s*[-_|｜]\s*(IT之家|36氪|少数派|机核|IGN中国|IGN 中国|GameLook|新浪新闻|中国新闻网|人民网|联合早报|GameSpot|Gematsu|WSJ)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title;
}

export function truncate(text, max = 120) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max).replace(/[，,、；;：:\s]+$/, '')}…`;
}

const CJK = /[\u4e00-\u9fff]/;

/** 生成用于相似度比较的字符二元组集合 */
export function bigrams(text = '') {
  const clean = String(text)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) {
    set.add(clean.slice(i, i + 2));
  }
  if (!set.size && clean) set.add(clean);
  return set;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** 标题相似判定：Jaccard 为主，辅以「短标题被长标题包含」的规则 */
export function isSameTopic(titleA, titleB) {
  const a = titleA.replace(/[\s\p{P}\p{S}]+/gu, '');
  const b = titleB.replace(/[\s\p{P}\p{S}]+/gu, '');
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;
  return jaccard(bigrams(titleA), bigrams(titleB)) >= 0.62;
}

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

/** 兼容 RFC822（RSS）与 ISO8601（Atom），返回毫秒时间戳或 null */
export function parseDate(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;

  // 部分源使用中文/自定义格式：2026-11-14 21:30:00
  const normalized = raw.replace(/\//g, '-').replace(' ', 'T');
  const fallback = Date.parse(normalized);
  if (Number.isFinite(fallback)) return fallback;

  const m = raw.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month !== undefined) return Date.UTC(Number(m[3]), month, Number(m[1]), 12);
  }
  return null;
}

/** 中文按字切分、英文按词切分，用于关键词高亮与检索 */
export function tokenize(text = '') {
  const tokens = new Set();
  const lower = String(text).toLowerCase();
  for (const word of lower.match(/[a-z0-9][a-z0-9.'-]{1,}/g) || []) {
    if (word.length > 2) tokens.add(word);
  }
  for (const run of lower.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    for (let i = 0; i < run.length - 1; i += 1) tokens.add(run.slice(i, i + 2));
  }
  return tokens;
}

export function hasCjk(text = '') {
  return CJK.test(text);
}

export function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
