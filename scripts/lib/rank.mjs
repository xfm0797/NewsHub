/**
 * 榜单核心：跨源去重 -> 多因子打分 -> 分类保底 + 全局排序。
 * 所有因子都会输出到前端，便于透明展示"为什么排在这里"。
 */

import { bigrams, isSameTopic, jaccard, tokenize } from './text.mjs';

const WEIGHTS = {
  recency: 0.36,
  authority: 0.24,
  coverage: 0.18,
  signal: 0.22
};

function signalScore(title, config) {
  const hits = (config.signals?.hot || []).filter((word) => title.includes(word));
  const noise = (config.signals?.noise || []).filter((word) => title.includes(word));
  let score = Math.min(hits.length, 3) * 26;
  if (/[0-9０-９]/.test(title)) score += 12;
  if (/[「《“"『]/.test(title)) score += 8;
  if (/[！!？?]/.test(title)) score += 4;
  if (title.length >= 12 && title.length <= 36) score += 10;
  if (title.length > 46) score -= 12;
  score -= noise.length * 30;
  return Math.max(0, Math.min(100, score));
}

function recencyScore(publishedAt, now, halfLifeHours) {
  const ageHours = Math.max(0, (now - publishedAt) / 36e5);
  const decay = Math.exp(-ageHours / halfLifeHours);
  return Math.round(6 + decay * 94);
}

function coverageScore(sourceCount) {
  if (sourceCount <= 1) return 0;
  return Math.round(Math.min(100, 100 * (1 - Math.exp(-(sourceCount - 1) / 1.2))));
}

function authorityScore(weight) {
  return Math.round(Math.min(100, (weight / 4) * 100));
}

/** 把同一事件的不同来源报道合并为一个 topic */
export function cluster(entries, { now, categories }) {
  const groups = [];

  for (const entry of entries) {
    const grams = bigrams(entry.title);
    let merged = false;

    for (const group of groups) {
      if (group.category !== entry.category) continue;
      const rep = group.members[0];
      const lengthRatio =
        Math.min(entry.title.length, rep.title.length) /
        Math.max(entry.title.length, rep.title.length);
      if (lengthRatio < 0.55) continue;

      const same =
        isSameTopic(entry.title, rep.title) ||
        jaccard(grams, group.grams) >= 0.62;

      if (same) {
        group.members.push(entry);
        group.sources.add(entry.sourceId);
        merged = true;
        break;
      }
    }

    if (!merged) {
      groups.push({
        members: [entry],
        grams,
        sources: new Set([entry.sourceId]),
        category: entry.category
      });
    }
  }

  return groups.map((group) => {
    const members = [...group.members].sort((a, b) => b.weight - a.weight);
    const rep = members.find((m) => m.summary.length > 40) || members[0];
    const publishedAt = Math.min(
      ...members.map((m) => m.publishedAt || now)
    );
    const sourceList = [];
    const seen = new Set();
    for (const m of members) {
      if (seen.has(m.sourceId)) continue;
      seen.add(m.sourceId);
      sourceList.push({ id: m.sourceId, name: m.sourceName, url: m.url });
    }

    return {
      category: rep.category,
      lang: rep.lang,
      weight: rep.weight,
      title: rep.title,
      url: rep.url,
      summary: rep.summary || members.find((m) => m.summary)?.summary || '',
      publishedAt: new Date(publishedAt).toISOString(),
      sources: sourceList,
      keywords: [...tokenize(rep.title)].slice(0, 8)
    };
  });
}

export function scoreTopics(topics, config, now) {
  const halfLives = new Map(config.categories.map((c) => [c.id, c.halfLifeHours]));

  const scored = topics.map((topic) => {
    const hl = halfLives.get(topic.category) || 10;
    const factors = {
      recency: recencyScore(new Date(topic.publishedAt).getTime(), now, hl),
      authority: authorityScore(topic.weight || 3),
      coverage: coverageScore(topic.sources.length),
      signal: signalScore(topic.title, config)
    };

    const total =
      factors.recency * WEIGHTS.recency +
      factors.authority * WEIGHTS.authority +
      factors.coverage * WEIGHTS.coverage +
      factors.signal * WEIGHTS.signal;

    return {
      ...topic,
      factors,
      heat: Math.round(Math.max(1, Math.min(100, total)))
    };
  });

  scored.sort((a, b) => b.heat - a.heat || new Date(b.publishedAt) - new Date(a.publishedAt));

  // 分类配额：先按等额配额取每类头部，剩余名额再按全局热度补足，
  // 保证"中外 + 游戏"各类都有稳定露出，同时不牺牲整体热度。
  const quota = Math.ceil(config.site.maxTopics / Math.max(1, config.categories.length));
  const picked = [];
  const pickedKeys = new Set();
  for (const category of config.categories) {
    const bucket = scored.filter((t) => t.category === category.id).slice(0, quota);
    for (const topic of bucket) {
      picked.push(topic);
      pickedKeys.add(topic.url + topic.title);
    }
  }
  for (const topic of scored) {
    if (picked.length >= config.site.maxTopics) break;
    if (!pickedKeys.has(topic.url + topic.title)) {
      picked.push(topic);
      pickedKeys.add(topic.url + topic.title);
    }
  }

  picked.sort((a, b) => b.heat - a.heat || new Date(b.publishedAt) - new Date(a.publishedAt));

  return picked.slice(0, config.site.maxTopics).map((topic, index) => ({
    id: `t${index + 1}`,
    rank: index + 1,
    title: topic.title,
    url: topic.url,
    summary: topic.summary,
    category: topic.category,
    lang: topic.lang,
    publishedAt: topic.publishedAt,
    heat: topic.heat,
    factors: topic.factors,
    sources: topic.sources.map((s) => ({ id: s.id, name: s.name, url: s.url })),
    keywords: topic.keywords
  }));
}
