# pansou-cf

> PanSou 免费版 @ Cloudflare Workers — 插件化网盘/磁力链搜索，兼容原版 [/api/search](https://github.com/fish2018/pansou) 协议

[![Version](https://img.shields.io/badge/version-v0.02-blue)](#版本记录)
[![Runtime](https://img.shields.io/badge/Cloudflare-Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)
[![Cost](https://img.shields.io/badge/cost-%240-success)](#部署)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## 定位

把 [fish2018/pansou](https://github.com/fish2018/pansou)（Go 长驻服务）的核心搜索能力搬到 **Cloudflare Workers 免费版**：

- **砍掉**：TG 频道源、常驻 goroutine 扫描、磁盘缓存（与 Serverless 模型冲突）
- **保留**：插件化搜索源架构、`/api/search` 协议、结果聚合与去重
- **缓存**：Workers KV（聚合结果 1h + pansearch buildId 30min），KV 未绑定自动降级直连
- **费用**：$0（Workers 免费 100k req/天 + KV 免费额度，个人用量绰绰有余）

## 与原版 PanSou 的差异

| 维度 | PanSou（Go 原版） | pansou-cf |
|---|---|---|
| 运行时 | 长驻 Go 进程 | Workers 请求级 isolate |
| TG 频道源 | ✅ | ❌ 移除 |
| 插件数量 | 90+ | 2 个（v0.02，按需增加） |
| 缓存 | 内存 + 磁盘 | KV（可降级） |
| 部署成本 | VPS 24h 计费 | 免费 |

## 搜索源

| 渠道 | 类型 | 说明 |
|---|---|---|
| `apibay` | 磁力链 | ThePirateBay 官方镜像 API，纯 JSON，按做种数排序 |
| `pansearch` | 网盘聚合 | 移植原版 pansearch 插件：夸克/UC/百度/阿里/迅雷/天翼/115/123 等 |

新增源：在 `src/plugins/` 新建文件实现 `SearchPlugin` 接口，到 `registry.ts` 注册一行即可。

## 快速开始

```bash
# 本地开发（KV 用本地模拟，无需真实 ID）
npm install
npx wrangler dev

# 测试
curl "http://127.0.0.1:8787/api/search?kw=ubuntu"
curl "http://127.0.0.1:8787/api/search?kw=塞尔达&channels=pansearch"

# 部署
npx wrangler deploy
```

## API

### `GET /api/search`

| 参数 | 必填 | 说明 |
|---|---|---|
| `kw` | ✅ | 关键词 |
| `channels` | ❌ | 逗号分隔，如 `apibay,pansearch`；默认全部 |
| `refresh` | ❌ | `true` 跳过缓存强制刷新 |

响应（兼容 PanSou）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 2,
    "results": [
      {
        "unique_id": "apibay-2C6B6858...",
        "source": "apibay",
        "title": "Ubuntu 22.04 LTS",
        "size": "3.4 GB",
        "hot": 37,
        "links": [{ "type": "magnet", "url": "magnet:?xt=urn:btih:..." }]
      },
      {
        "unique_id": "pansearch-123456",
        "source": "pansearch",
        "title": "某资源名称",
        "links": [{ "type": "quark", "url": "https://pan.quark.cn/s/...", "password": "a1b2" }]
      }
    ],
    "sources": { "apibay": 50, "pansearch": 8 }
  }
}
```

### `GET /`

健康检查：返回版本号、可用渠道、缓存状态。

## 项目结构

```
src/
├── index.ts            # Hono 入口 + /api/search
├── types.ts            # 共享类型（PanSou 协议对齐）
├── scheduler.ts        # Promise.allSettled 并发调度 + 去重
├── cache.ts            # KV 包装（未绑定自动降级）
└── plugins/
    ├── types.ts        # SearchPlugin 接口
    ├── registry.ts     # 注册表
    ├── apibay.ts       # 磁力链源
    └── pansearch.ts    # 网盘聚合源
```

## 部署

1. Cloudflare 账号（免费即可）
2. `npx wrangler login`
3. KV 命名空间已配置在 `wrangler.toml`（如需自建：`npx wrangler kv namespace create CACHE`，替换 `wrangler.toml` 中的 id）
4. `npx wrangler deploy`

大陆访问 `*.workers.dev` 域名可能不稳定，建议绑定自定义域名（Workers 控制台 → Settings → Domains & Routes，CF 自动发 SSL）。

## 版本记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.01 | 2026-09-07 | 项目初始化：Hono 入口 + /api/search 占位 |
| v0.02 | 2026-09-07 | 真实搜索：apibay 磁力链 + pansearch 网盘聚合；KV 缓存；allSettled 并发调度 |

## 路线图

- **v0.03**：pansearch 多页抓取；结果按渠道分组过滤
- **v0.04**：增加夸克系独立搜索源
- **v0.05**：Cron Triggers 预热热词

## 致谢

- [fish2018/pansou](https://github.com/fish2018/pansou) — 协议与 pansearch 插件逻辑来源
- [Hono](https://hono.dev/) — Worker-first Web 框架
