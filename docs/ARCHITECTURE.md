# 架构说明

## 1. 总体架构

采用「**抓取流水线 + 纯静态站点**」的两段式架构：内容生产在构建期完成，运行期没有任何服务端，站点本身就是一堆 JSON + 静态资源，因此可以部署到任意静态托管平台，且天然抗流量（CDN 直出）。

```
┌──────────────────────────── 构建期（抓取流水线） ────────────────────────────┐
│                                                                            │
│  config/sources.json ──► scripts/fetch.mjs（编排器）                        │
│        │                        │                                          │
│        │            ┌───────────┴───────────┐                          │
│        │            │  lib/http.mjs  并发抓取(5路)                      │
│        │            │  超时 15s · 重试 1 次 · 字符集嗅探                │
│        │            └───────────┬───────────┘                          │
│        │            ┌───────────┴───────────┐                          │
│        │            │  lib/xml.mjs  XML 解析 │                          │
│        │            │  lib/feed.mjs RSS/Atom/RDF 统一化               │
│        │            │  lib/text.mjs 清洗/时间/bigram                  │
│        │            └───────────┬───────────┘                          │
│        │            ┌───────────┴───────────┐                          │
│        │            │  lib/rank.mjs          │                          │
│        │            │  ① URL 精确去重         │                          │
│        │            │  ② 标题聚类合并(同事件)  │                          │
│        │            │  ③ 四因子打分           │                          │
│        │            │  ④ 分类配额 + 全局排序   │                          │
│        │            └───────────┬───────────┘                          │
│        │                        ▼                                      │
│        │            public/data/latest.json + archive/YYYY-MM-DD.json  │
└────────┼───────────────────────────┬────────────────────────────────────┘
         │                           │ git commit / CI 触发部署
┌────────┼───────────────────────────┼────────────── 运行期（纯静态） ────┐
│        ▼                           ▼                                    │
│  public/index.html ──► assets/js/app.js（零依赖渲染）                      │
│                          │  fetch latest.json / archive/*.json            │
│                          │  分类筛选 · 搜索 · 排序 · 快照 · 主题 · 轮询     │
│                          ▼                                                │
│                      assets/css/main.css（三档响应式 + 深浅色）             │
└───────────────────────────────────────────────────────────────────────────┘
```

## 2. 模块划分

| 模块 | 职责 | 关键设计 |
|---|---|---|
| `config/sources.json` | 信源、分类、词表、站点参数 | 所有运营配置的唯一入口，改配置不改代码 |
| `scripts/lib/http.mjs` | HTTP 获取 | 5 路并发上限；UA 标识；超时 15s + 退避重试；按 Content-Type/XML 声明嗅探编码（兼容 GBK 源） |
| `scripts/lib/xml.mjs` | XML 解析 | 自研 200 行解析器，支持 CDATA、命名空间前缀、常见实体；无第三方依赖 |
| `scripts/lib/feed.mjs` | Feed 统一化 | RSS 2.0 / Atom / RDF 三种格式归一为 `{title,url,summary,publishedAt,...}`；链接相对路径补全 |
| `scripts/lib/text.mjs` | 文本处理 | 标题清洗（去栏目头、署名尾缀）；RFC822/ISO8601 双时间解析；字符 bigram + Jaccard 相似度 |
| `scripts/lib/rank.mjs` | 榜单核心 | 聚类去重、四因子打分、分类配额选择 |
| `scripts/fetch.mjs` | 编排器 | 容错策略（单源失败降级、全失败保留旧数据退出非 0）；产物：latest.json + 当日归档 + 归档索引 |
| `public/assets/js/app.js` | 前端渲染 | 状态驱动的单页渲染；骨架屏、静默轮询、快照回看、快捷键 |
| `public/assets/css/main.css` | 样式 | CSS 变量双主题；三档断点（1080/820/640）；`content-visibility` 惰性渲染 |

## 3. 更新逻辑（三层保鲜）

1. **CI 定时抓取**：`data.yml` 每 2 小时运行 `node scripts/fetch.mjs --archive`，有变化则提交数据并触发 Pages 重新部署；
2. **部署时抓取**：Vercel / Netlify / Cloudflare / GitHub Pages 的构建命令均包含 `node scripts/fetch.mjs`，每次部署数据即新鲜；
3. **前端兜底轮询**：页面每 5 分钟静默拉取 `latest.json`，`generatedAtMs` 变化则热更新榜单并 toast 提示；标签页重新可见时也会立即校验一次。

归档策略：`--archive` 时写入 `archive/YYYY-MM-DD.json`（保留前 40 条）并更新 `archive/index.json`，默认保留 30 天。

## 4. 排序与去重细节

### 去重（两级）

1. **URL 精确去重**：去掉查询串与尾部斜杠后比对；
2. **标题聚类**：仅在同分类内比较。判定为同一事件的条件：
   - 归一化后短标题被长标题完整包含（≥8 字）；或
   - 字符二元组 Jaccard ≥ 0.62。
   
   合并时保留权重最高的来源作为代表，其余来源进入 `sources[]`，发布时间取最早值（多源首发时间）。

### 打分

```
heat = round(0.36·时效 + 0.24·权重 + 0.18·交叉 + 0.22·信号)      ∈ [1,100]
时效   = 6 + 94·exp(-ageHours / halfLife)    halfLife: 国内8h 国际10h 科技12h 游戏14h
权重   = min(100, sourceWeight / 4 × 100)    权重来自 sources.json
交叉   = 100·(1 - exp(-(源数-1)/1.2))        1 源 = 0，2 源 ≈ 57，3 源 ≈ 78
信号   = 热词命中(≤3 个 × 26) + 数字12 + 引号8 + 叹问4 + 长度修正 − 噪声词30
```

### 配额选择

每类先取热度前 `maxTopics / 类别数`（= 15）条，剩余名额按全局热度补足，最终 60 条全局降序输出。这样保证「中外 + 游戏」四类稳定露出，又不牺牲整体热度秩序。

## 5. 数据 Schema（latest.json）

```jsonc
{
  "generatedAt": "2026-11-14T21:42:51+08:00",
  "date": "2026-11-14",
  "stats": { "total": 60, "sources": 16, "sourcesOk": 15, "categories": {...}, "windowHours": 48 },
  "categories": [{ "id": "china", "label": "国内" }, ...],
  "topics": [{
    "id": "t1", "rank": 1,
    "title": "…", "url": "https://…", "summary": "…",
    "category": "china", "lang": "zh", "publishedAt": "…",
    "heat": 60,
    "factors": { "recency": 93, "authority": 80, "coverage": 0, "signal": 36 },
    "sources": [{ "id": "chinanews", "name": "中国新闻网", "url": "…" }]
  }],
  "flashes": [ /* 最新 14 条，每类最多 4 条 */ ],
  "sourceStatus": [{ "id": "…", "name": "…", "ok": true, "count": 30, "ms": 167, "error": null }]
}
```

## 6. 性能策略

- **无框架无依赖**：HTML/CSS/JS 合计约 45KB（未压缩），无图片资源，LCP 即首屏文字；
- **数据体量**：latest.json 约 60–80KB，`content-visibility:auto` 让首屏外列表项跳过渲染；
- **缓存分级**：HTML/JSON `no-store` 保证实时性；`/assets/*` 长缓存 + `stale-while-revalidate`；
- **搜索去抖** 120ms；相对时间 60s 批量刷新而非逐条定时器。

## 7. 扩展点

- **接入 API 型数据源**（如需 JSON 接口的平台）：在 `lib/` 新增 adapter，输出与 `feed.mjs` 相同的条目结构即可进入打分流水线；
- **多语言翻译**：`topic.lang` 已标记 `en`，可在此挂接翻译服务（前端展示 EN 徽章）；
- **个性化**：前端可在 `state` 上叠加用户偏好（如置顶某分类），数据层无需改动。
