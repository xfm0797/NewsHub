# 热点聚合 NewsHub

中外要闻与游戏资讯的聚合站点：定时抓取 16 家公开媒体 RSS，跨源去重、四因子热度打分，输出纯静态站点。无数据库、无服务端运行时，任何静态托管平台均可一键部署。

## 功能特性

- **实时热点榜**：四类（国内 / 国际 / 科技 / 游戏）各 15 条、共 60 条，按热度排序，支持分类筛选、热度/时间双排序、关键词搜索
- **自动更新机制**：CI 定时抓取（默认每 2 小时）+ 部署时抓取 + 前端 5 分钟静默轮询，三层保证数据新鲜
- **跨源去重**：字符二元组 Jaccard + 前缀包含判断，同一事件的多源报道合并为一条并标注「N 源印证」
- **透明打分**：每条热度可悬停查看 时效 / 权重 / 交叉 / 信号 四因子明细
- **每日快照**：按日归档 JSON，可在「历史快照」中回看任意日期
- **性能**：零依赖前端、无图片、`content-visibility` 惰性渲染、资源分级缓存，首屏 < 50KB（HTML+CSS+JS）
- **体验**：响应式三档断点、深浅色主题、骨架屏、相对时间自动刷新、`/` 快捷搜索

## 快速开始

```bash
npm run fetch     # 抓取并生成 public/data/latest.json
npm run dev       # 本地预览 http://localhost:4173
npm run fetch:daily  # 抓取 + 写入当日归档快照
```

要求 Node.js ≥ 20，无任何 npm 依赖。

## 项目结构

```
├── config/sources.json        # 信源与分类配置（唯一需要维护的配置文件）
├── scripts/
│   ├── fetch.mjs              # 抓取编排：并发抓取 → 清洗 → 去重打分 → 写 JSON
│   ├── serve.mjs              # 本地静态预览服务器
│   └── lib/
│       ├── http.mjs           # 超时/重试/字符集嗅探
│       ├── xml.mjs            # 极简 XML 解析（CDATA/实体/命名空间）
│       ├── feed.mjs           # RSS 2.0 / Atom / RDF 统一解析
│       ├── text.mjs           # 清洗、时间解析、bigram 相似度
│       └── rank.mjs           # 聚类去重 + 四因子打分 + 分类配额
├── public/
│   ├── index.html             # 单页应用
│   ├── assets/                # CSS / JS（零依赖）
│   └── data/
│       ├── latest.json        # 榜单数据接口
│       └── archive/           # 按日归档快照 + index.json
├── .github/workflows/         # data.yml 定时抓取 · pages.yml 自动部署
├── Dockerfile + deploy/nginx.conf   # 自托管方案
└── vercel.json / netlify.toml / wrangler.toml   # 各平台部署配置
```

详细架构说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 榜单排序逻辑

每条新闻（跨源合并后称 topic）计算 0–100 热度分：

```
heat = 0.36 × 时效 + 0.24 × 权重 + 0.18 × 交叉 + 0.22 × 信号
```

| 因子 | 计算 | 说明 |
|---|---|---|
| 时效 | `6 + 94 × exp(-age / halfLife)` | 半衰期按分类不同：国内 8h、国际 10h、科技 12h、游戏 14h |
| 权重 | `min(100, 信源权重/4×100)` | 信源权重在 `sources.json` 中配置 |
| 交叉 | `100 × (1 - e^-(源数-1)/1.2)` | 多家媒体同时报道的事件获得加成 |
| 信号 | 热词命中 + 数字/引号/标点启发式 | 「突发/重磅/官宣/发售/公测…」等词表可配置 |

排序 = 热度降序；**分类配额**保证每类固定露出 15 条（等额配额优先，剩余名额按全局热度补足），避免单一类别霸榜。

## 数据来源接入

- 全部来自**公开 RSS/Atom**，只取标题、链接、摘要、时间，不抓正文
- 新增/替换信源：编辑 `config/sources.json` 的 `sources` 数组即可，无需改代码
- 当前 16 源：中国新闻网（综合/国内/国际）、界面新闻、France 24、Indian Express、Korea Times、IT之家、少数派、极客公园、钛媒体、Ars Technica、机核、IGN 中国、GameSpot、Gematsu
- 单源失败不影响整体，失败原因记录在 `latest.json → sourceStatus`，前端「信源状态」卡片实时展示
- 全部源失败时保留上一份数据并以非 0 退出码通知 CI

## 部署方案

| 平台 | 方式 | 说明 |
|---|---|---|
| **GitHub Pages** | 推送即可，`.github/workflows/pages.yml` 已内置 | 自动构建 + Pages 部署，仓库 Settings → Pages 选 GitHub Actions |
| **Vercel** | 导入仓库，已含 `vercel.json` | 构建命令 `node scripts/fetch.mjs`，输出 `public` |
| **Netlify** | 导入仓库，已含 `netlify.toml` | 同上 |
| **Cloudflare Pages** | 构建命令 `node scripts/fetch.mjs \|\| true`，输出目录 `public` | 或 `wrangler pages deploy public` |
| **自托管** | `docker build -t news-hub . && docker run -p 80:80 news-hub` | 构建期抓取、运行期 nginx 纯静态 |

更新机制：GitHub Actions 定时提交最新 JSON → Pages/托管平台跟随自动重新发布；前端另有 5 分钟轮询兜底。

## 自定义

- **调权重**：`scripts/lib/rank.mjs` 的 `WEIGHTS`
- **调词表**：`config/sources.json → signals.hot / signals.noise`
- **调榜单长度/窗口**：`config/site.maxTopics / windowHours`（默认 60 条 / 48 小时）
- **调频率**：`.github/workflows/data.yml` 的 `cron`

## 数据接口

- `GET /data/latest.json` —— 完整榜单、快讯、信源状态
- `GET /data/archive/index.json` —— 归档日期索引
- `GET /data/archive/YYYY-MM-DD.json` —— 当日快照（前 40 条）

数据仅聚合公开 RSS 的标题与摘要，版权归原媒体所有，点击标题跳转原始媒体阅读全文。
