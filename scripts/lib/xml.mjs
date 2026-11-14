/**
 * 极简 XML 解析器 —— 无第三方依赖。
 * 只覆盖 RSS 2.0 / Atom / RDF 所需的子集：
 * 元素、属性、CDATA、注释、处理指令、自闭合标签、常见实体。
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  middot: '·'
};

export function decodeEntities(input = '') {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function parseAttrs(raw = '') {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(raw))) {
    attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function findTagEnd(src, start) {
  let quote = null;
  for (let i = start + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return src.length - 1;
}

/** @returns {{name:string, attrs:object, children:Array, text:string}} */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const src = String(xml || '').replace(/^\uFEFF/, '');
  let i = 0;

  const appendText = (raw) => {
    if (raw) stack[stack.length - 1].text += decodeEntities(raw);
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      appendText(src.slice(i));
      break;
    }
    if (lt > i) appendText(src.slice(i, lt));

    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += src.slice(lt + 9, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt + 2);
      i = end < 0 ? src.length : end + 1;
      continue;
    }

    const gt = findTagEnd(src, lt);
    const raw = src.slice(lt + 1, gt);

    if (raw[0] === '/') {
      const name = raw.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k -= 1) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
    } else {
      const selfClose = raw.trimEnd().endsWith('/');
      const body = selfClose ? raw.trimEnd().slice(0, -1) : raw;
      const spaceIdx = body.search(/\s/);
      const name = (spaceIdx < 0 ? body : body.slice(0, spaceIdx)).trim();
      const node = {
        name,
        attrs: parseAttrs(spaceIdx < 0 ? '' : body.slice(spaceIdx)),
        children: [],
        text: ''
      };
      if (name) {
        stack[stack.length - 1].children.push(node);
        if (!selfClose) stack.push(node);
      }
    }
    i = gt + 1;
  }

  return root;
}

export function child(node, name) {
  if (!node) return null;
  return node.children.find((c) => c.name === name) || null;
}

/** 兼容带命名空间前缀的查找，如 dc:date / content:encoded */
export function childLoose(node, name) {
  if (!node) return null;
  const target = name.toLowerCase();
  return (
    node.children.find((c) => c.name.toLowerCase() === target) ||
    node.children.find((c) => c.name.toLowerCase().endsWith(`:${target}`)) ||
    null
  );
}

export function nodeText(node, name) {
  const target = childLoose(node, name);
  if (!target) return '';
  return (target.text || target.children.map((c) => c.text).join('')).trim();
}
