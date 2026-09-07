# pansou-cf

> PanSou @ Cloudflare Workers — 插件化网盘/磁力链搜索 + Web 界面，兼容原版 [/api/search](https://github.com/fish2018/pansou) 协议

[![Version](https://img.shields.io/badge/version-v0.08-blue)](#版本记录)
[![Runtime](https://img.shields.io/badge/Cloudflare-Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## 定位

把 [fish2018/pansou](https://github.com/fish2018/pansou)（Go 长驻服务）+ [fish2018/pansou-web](https://github.com/fish2018/pansou-web)（Vue 前端）搬到 Cloudflare Workers：

- **砍掉**：TG 频道源、常驻 goroutine 扫描、磁盘缓存（与 Serverless 模型冲突）
- **保留**：插件化搜索源架构、`/api/search` 协议、结果聚合与去重、**Web 搜索界面**
- **缓存**：Workers KV（聚合结果 1h + pansearch buildId 30min），KV 未绑定自动降级直连

## 特性

- **19 个搜索源插件**：JSON API、HTML 抓取（通用配置驱动引擎）、磁力链等多类来源
- **无效链接过滤**：标题/正文含"分享已取消/链接失效"等关键词的结果直接丢弃（调度器统一处理）
- **插件熔断器**：连续失败 ≥3 次的插件熔断 5 分钟自动跳过（冷却后恢复）；显式指定 `channels=` 可绕过；状态为 Workers 隔离实例级
- **子请求预算**：全插件共享 30 fetch 份额（Workers 单请求 50 子请求上限），重源（多详情页）自动按需领取
- **调试**：`?debug=1` 返回熔断/引擎诊断信息

新增源：在 `src/plugins/` 新建文件实现 `SearchPlugin` 接口，到 `registry.ts` 注册一行即可。

## 快速开始

```bash
# 本地开发（KV 用本地模拟，无需真实 ID）
npm install
npx wrangler dev

# 测试
curl "http://127.0.0.1:8787/api/search?kw=ubuntu"
curl "http://127.0.0.1:8787/api/search?kw=塞尔达&channels=pansearch"
```

## API

### `GET /api/search`

| 参数 | 必填 | 说明 |
|---|---|---|
| `kw` | ✅ | 关键词 |
| `channels` / `plugins` | ❌ | 逗号分隔渠道过滤，默认全部；**显式指定时绕过熔断器** |
| `cloud_types` | ❌ | 逗号分隔网盘类型过滤，如 `quark,magnet` |
| `refresh` | ❌ | `true` 跳过缓存强制刷新（只认 `true`） |
| `debug` | ❌ | `1` 返回熔断/引擎诊断 |

响应（兼容 PanSou，含 pansou-web 前端依赖的 `merged_by_type`）：

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
      }
    ],
    "merged_by_type": {
      "magnet": [{ "url": "magnet:?xt=...", "note": "Ubuntu 22.04 LTS", "source": "apibay" }]
    },
    "sources": { "apibay": 50, "pansearch": 8 }
  }
}
```

### `GET /api/health`

pansou-web 前端使用的健康检查（部署渠道 `deployment`、插件列表、认证状态 `auth_enabled:false`）。

### `GET /`

服务信息 + Web 界面入口。

## Web 界面

前端直接复用 [fish2018/pansou-web](https://github.com/fish2018/pansou-web)（Vue 3 + Vite + Tailwind），构建产物已入库（`dist-web/`）。如需重新构建：

```bash
git clone --depth 1 https://github.com/fish2018/pansou-web.git
cd pansou-web && npm install && npm run build && cd ..
rm -rf dist-web && cp -r pansou-web/dist dist-web
```

无需改动前端源码：它的 `baseURL: '/api'` 天然同域，`/api/*` 由 Worker 处理（`run_worker_first`），其余路径走静态资源。

## 项目结构

```
src/
├── index.ts            # Hono 入口：/api/search + /api/health + merged_by_type
├── types.ts            # 共享类型（PanSou 协议对齐）
├── scheduler.ts        # 并发调度 + 子请求预算 + 无效链接过滤 + 插件熔断器
├── cache.ts            # KV 包装（未绑定自动降级）
└── plugins/
    ├── types.ts        # SearchPlugin 接口 + SearchContext（budget/fail 上报）
    ├── registry.ts     # 注册表
    ├── links.ts        # 共享链接提取正则（16 类网盘/磁力链）
    ├── html/engine.ts  # 通用 HTML 抓取引擎（配置驱动）
    ├── html/sites.ts   # HTML 站点配置表
    └── {apibay,pansearch,...}.ts  # 搜索源插件
dist-web/               # pansou-web 构建产物（已入库，Git 部署需要）
```

## 部署

**方式一：Cloudflare Workers**

1. Fork/导入本仓库到你的 GitHub
2. Cloudflare Dashboard → Workers & Pages → 创建 Worker（或选现有）→ **Settings → Build → Connect Git repository**，选仓库和 `main` 分支
3. 构建命令留空，部署命令默认 `npx wrangler deploy`（无编译步骤，TS 由 wrangler 直接打包）
4. 保存后 **push 即自动部署**（构建约 1 分钟）；KV 绑定按 `wrangler.toml` 的 `[[kv_namespaces]]` 自动生效

> 注意：`dist-web/` 必须在仓库里（已入库），否则部署缺前端。

**方式二：本地 wrangler**

```bash
npm install
npx wrangler login
npx wrangler deploy
```

KV 如需自建：`npx wrangler kv namespace create CACHE`，替换 `wrangler.toml` 中的 id。

大陆访问 `*.workers.dev` 域名可能不稳定，建议绑定自定义域名（Workers 控制台 → Settings → Domains & Routes，CF 自动发 SSL）。

## 版本记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.01 | 2026-09-07 | 项目初始化：Hono 入口 + /api/search 占位 |
| v0.02 | 2026-09-07 | 真实搜索：磁力链 + 网盘聚合源；KV 缓存；allSettled 并发调度 |
| v0.03 | 2026-09-07 | Web 界面（pansou-web 前端 @ Workers Assets）；健康检查；merged_by_type；类型过滤 |
| v0.04 | 2026-09-07 | 插件扩至 10 个 |
| v0.05 | 2026-09-07 | 通用 HTML 抓取引擎 + 子请求预算管理器；扩至 14 源；?debug=1 诊断参数 |
| v0.06 | 2026-09-07 | 新增 4 个搜索源（共 18 源）；子请求预算 22→30 |
| v0.07 | 2026-09-07 | 新增 1 个搜索源（共 19 源）；无效链接关键词过滤 |
| v0.08 | 2026-09-07 | 插件熔断器（失败 ≥3 次熔断 5 分钟，双层失败信号）；迁移 Git 集成自动部署 |

## 路线图

- 加密签名类插件（9 个活源，需逐个啃签名算法）
- 链接有效性检测（/api/check/links 实装，分平台探活 + 分级 TTL 缓存）
- D1 累积资源库（搜索结果沉淀，先查本地库绕开源站不稳定）
- Cron Triggers 预热热词

## 致谢

- [fish2018/pansou](https://github.com/fish2018/pansou) — 协议与 pansearch 插件逻辑来源
- [fish2018/pansou-web](https://github.com/fish2018/pansou-web) — Web 界面来源
- [wu529778790/panhub.shenzjd.com](https://github.com/wu529778790/panhub.shenzjd.com) — dyyjv 插件、熔断器思路
- [Hono](https://hono.dev/) — Worker-first Web 框架
