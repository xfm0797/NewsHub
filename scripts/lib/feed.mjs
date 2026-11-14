/** RSS 2.0 / RDF / Atom 统一解析为内部条目结构。 */

import { parseXml, child, childLoose, nodeText } from './xml.mjs';
import { cleanTitle, parseDate, stripHtml, truncate } from './text.mjs';

function pickLink(node) {
  const link = childLoose(node, 'link');
  if (!link) return '';
  if (link.attrs?.href) return link.attrs.href;
  return (link.text || '').trim();
}

function pickAtomLink(node) {
  const links = node.children.filter((c) => c.name.toLowerCase() === 'link');
  if (!links.length) return '';
  const alternate =
    links.find((l) => !l.attrs?.rel || l.attrs.rel === 'alternate') || links[0];
  return alternate.attrs?.href || (alternate.text || '').trim();
}

function absolutize(url, base) {
  if (!url) return '';
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export function parseFeed(xml, source) {
  const tree = parseXml(xml);
  const root = tree.children.find((c) => c.name !== '#text');
  if (!root) return { entries: [] };

  const isAtom = root.name.toLowerCase() === 'feed';
  const channel = isAtom ? root : child(root, 'channel') || root;

  // RSS 2.0 的 item 在 channel 内；RDF(RSS 1.0) 的 item 与 channel 平级
  const tag = isAtom ? 'entry' : 'item';
  let itemNodes = channel.children.filter((c) => c.name.toLowerCase() === tag);
  if (!itemNodes.length && channel !== root) {
    itemNodes = root.children.filter((c) => c.name.toLowerCase() === tag);
  }

  const entries = [];
  for (const node of itemNodes) {
    const title = cleanTitle(nodeText(node, 'title'));
    if (!title) continue;

    const rawLink = isAtom ? pickAtomLink(node) : pickLink(node) || nodeText(node, 'guid');
    const url = absolutize(rawLink, source.homepage);
    if (!/^https?:/i.test(url)) continue;

    const rawSummary =
      nodeText(node, 'description') ||
      nodeText(node, 'summary') ||
      nodeText(node, 'content') ||
      nodeText(node, 'encoded');

    const rawDate =
      nodeText(node, 'pubDate') ||
      nodeText(node, 'published') ||
      nodeText(node, 'updated') ||
      nodeText(node, 'date');

    const author =
      nodeText(node, 'creator') || nodeText(node, 'author') || '';

    entries.push({
      title,
      url,
      summary: truncate(stripHtml(rawSummary), 180),
      publishedAt: parseDate(rawDate),
      author: stripHtml(author).slice(0, 40),
      sourceId: source.id,
      sourceName: source.name,
      category: source.category,
      lang: source.lang,
      weight: source.weight
    });
  }

  return { entries };
}
