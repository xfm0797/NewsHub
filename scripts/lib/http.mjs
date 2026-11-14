/** 带超时、重试与字符集嗅探的 HTTP 获取。仅依赖 Node 内置能力。 */

const UA =
  'Mozilla/5.0 (compatible; NewsHubBot/1.0; +https://github.com/) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function detectCharset(contentType, buffer) {
  const headerMatch = /charset=["']?([\w-]+)/i.exec(contentType || '');
  if (headerMatch) return headerMatch[1];
  const head = Buffer.from(buffer).subarray(0, 1024).toString('latin1');
  const xmlMatch = /encoding=["']([\w-]+)["']/i.exec(head);
  if (xmlMatch) return xmlMatch[1];
  return 'utf-8';
}

function decode(buffer, contentType) {
  const charset = detectCharset(contentType, buffer).toLowerCase();
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

export async function fetchText(url, { timeout = 15000, retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) throw new Error('empty body');
      return decode(buffer, res.headers.get('content-type'));
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** 有并发上限的批量执行，避免同时打满对端 */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
