#!/usr/bin/env node
/**
 * 抓取编排器
 *   npm run fetch         -> 刷新 public/data/latest.json
 *   npm run fetch:daily   -> 额外写入当日归档快照
 *
 * 设计要点：
 * 1. 单源失败不影响整体，失败信息记录进 sourceStatus 供前端展示；
 * 2. 全部源失败时保留上一份数据并以非 0 退出码提醒 CI；
 * 3. 输出为纯静态 JSON，前端无需任何运行时依赖。
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchText, mapLimit } from './lib/http.mjs';
import { parseFeed } from './lib/feed.mjs';
import { cluster, scoreTopics } from './lib/rank.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');

const args = new Set(process.argv.slice(2));
const FORCE_ARCHIVE = args.has('--archive');

const config = JSON.parse(await readFile(path.join(ROOT, 'config', 'sources.json'), 'utf8'));
const now = Date.now();
const windowMs = (config.site.windowHours || 48) * 36e5;

function fmtLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isoWithOffset(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${fmtLocal(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

async function loadSource(source) {
  const started = Date.now();
  try {
    const xml = await fetchText(source.url, { timeout: 15000, retries: 1 });
    const { entries } = parseFeed(xml, source);
    return {
      source,
      ok: true,
      entries,
      ms: Date.now() - started,
      error: entries.length ? null : '解析到 0 条'
    };
  } catch (error) {
    return {
      source,
      ok: false,
      entries: [],
      ms: Date.now() - started,
      error: error?.message || String(error)
    };
  }
}

function dedupeExact(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = entry.url.replace(/[?#].*$/, '').replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeArchive(payload, dateKey) {
  await mkdir(ARCHIVE_DIR, { recursive: true });
  const file = path.join(ARCHIVE_DIR, `${dateKey}.json`);
  await writeFile(
    file,
    JSON.stringify(
      {
        date: dateKey,
        generatedAt: payload.generatedAt,
        stats: payload.stats,
        topics: payload.topics.slice(0, 40)
      },
      null,
      1
    )
  );

  const indexPath = path.join(ARCHIVE_DIR, 'index.json');
  const index = await readJson(indexPath, { dates: [] });
  const dates = index.dates.filter((d) => d.date !== dateKey);
  dates.unshift({
    date: dateKey,
    generatedAt: payload.generatedAt,
    total: payload.stats.total,
    top: payload.topics[0]?.title || ''
  });
  dates.sort((a, b) => (a.date < b.date ? 1 : -1));

  const keep = config.site.archiveKeepDays || 30;
  const kept = dates.slice(0, keep);
  await writeFile(indexPath, JSON.stringify({ dates: kept }, null, 1));

  // 清理超出保留期的归档文件
  try {
    const files = await readdir(ARCHIVE_DIR);
    const allowed = new Set(kept.map((d) => `${d.date}.json`));
    for (const name of files) {
      if (name.endsWith('.json') && name !== 'index.json' && !allowed.has(name)) {
        await writeFile(path.join(ARCHIVE_DIR, name), '');
      }
    }
  } catch {
    /* 清理失败不影响主流程 */
  }
  return file;
}

async function main() {
  console.log(`\n▶ 抓取开始 ${new Date().toLocaleString('zh-CN')}  共 ${config.sources.filter((s) => s.enabled).length} 个源\n`);

  const sources = config.sources.filter((s) => s.enabled);
  const results = await mapLimit(sources, 5, loadSource);

  const entries = [];
  const sourceStatus = [];

  for (const result of results) {
    const { source } = result;
    let kept = 0;
    for (const entry of result.entries) {
      const ts = entry.publishedAt ?? now - 3 * 36e5;
      if (ts > now + 2 * 36e5) continue; // 明显异常的"未来时间"
      if (now - ts > windowMs) continue;
      entries.push({ ...entry, publishedAt: ts });
      kept += 1;
    }
    sourceStatus.push({
      id: source.id,
      name: source.name,
      category: source.category,
      lang: source.lang,
      ok: result.ok && kept > 0,
      count: kept,
      ms: result.ms,
      error: result.ok ? (kept ? null : '窗口期内无内容') : result.error
    });
    const flag = result.ok && kept ? '✓' : '✗';
    console.log(
      `${flag} ${source.name.padEnd(14, ' ')} ${String(kept).padStart(3)} 条  ${String(
        result.ms
      ).padStart(5)}ms ${result.ok ? '' : `— ${result.error}`}`
    );
  }

  const unique = dedupeExact(entries);
  const topics = cluster(unique, { now, categories: config.categories });
  const ranked = scoreTopics(topics, config, now);

  if (!ranked.length) {
    console.error('\n✗ 本轮没有任何可用内容，保留上一份数据。');
    process.exitCode = 1;
    return;
  }

  const today = new Date(now);
  const dateKey = fmtLocal(today);

  // 快讯：按时间取最新，但单类最多 4 条，避免被高频源刷屏
  const byTime = [...ranked].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  const perCat = new Map();
  const flashes = [];
  for (const topic of byTime) {
    const used = perCat.get(topic.category) || 0;
    if (used >= 4) continue;
    perCat.set(topic.category, used + 1);
    flashes.push({
      id: topic.id,
      title: topic.title,
      url: topic.url,
      category: topic.category,
      source: topic.sources[0]?.name || '',
      publishedAt: topic.publishedAt
    });
    if (flashes.length >= 14) break;
  }

  const categoryCounts = {};
  for (const c of config.categories) {
    categoryCounts[c.id] = ranked.filter((t) => t.category === c.id).length;
  }

  const payload = {
    version: 1,
    site: { name: config.site.name, tagline: config.site.tagline },
    generatedAt: isoWithOffset(today),
    generatedAtMs: now,
    date: dateKey,
    stats: {
      total: ranked.length,
      sources: sources.length,
      sourcesOk: sourceStatus.filter((s) => s.ok).length,
      categories: categoryCounts,
      windowHours: config.site.windowHours
    },
    categories: config.categories.map((c) => ({ id: c.id, label: c.label })),
    topics: ranked,
    flashes,
    sourceStatus
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, 'latest.json'), JSON.stringify(payload, null, 1));

  if (FORCE_ARCHIVE) {
    const file = await writeArchive(payload, dateKey);
    console.log(`\n✓ 归档写入 ${path.relative(ROOT, file)}`);
  }

  const okCount = sourceStatus.filter((s) => s.ok).length;
  console.log(
    `\n✓ 完成：${ranked.length} 条榜单 / ${unique.length} 条原始 / 源 ${okCount}-${sources.length}`
  );
  console.log(`  榜首：${ranked[0].title} (heat ${ranked[0].heat})`);
  console.log(`  输出：public/data/latest.json\n`);

  if (okCount === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('抓取失败：', error);
  process.exitCode = 1;
});
