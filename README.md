# pansou-cf

> PanSou 的 Cloudflare Workers 移植版 — 网盘搜索聚合 API 跑在 CF 边缘

[![Version](https://img.shields.io/badge/version-v0.01-blue)](#版本记录)
[![Runtime](https://img.shields.io/badge/Cloudflare-Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)
[![Stack](https://img.shields.io/badge/TypeScript-Hono-3178c6?logo=typescript&logoColor=white)](#技术栈)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## 项目动机

原版 [fish2018/pansou](https://github.com/fish2018/pansou) 是 Go 写的网盘搜索聚合服务，部署形态依赖长驻进程 + 本地磁盘缓存 + Telegram 长连接，**与 Cloudflare Workers 的 Serverless 模型不兼容**。

`pansou-cf` 的目标是把 PanSou 的核心搜索能力搬到 Cloudflare 边缘：

- **保留**：对外 API 协议（`/api/search` 请求/响应格式），下游客户端可零成本切换
- **重写**：进程模型改为请求级 Worker，缓存改为 KV / D1
- **取舍**：放弃本地磁盘缓存、Telegram 长连接扫描，改为 Cron Triggers 定时拉取

## 与原版 PanSou 的差异

| 维度 | PanSou（Go 原版） | pansou-cf（CF Workers） |
|---|---|---|
| 运行时 | 长驻 Go 进程（监听 8888） | Cloudflare Workers（请求级） |
| 部署 | Docker / 二进制 | `wrangler deploy` |
| 缓存 | 二级：内存 + `./cache` 目录 | KV（持久化，跨请求） |
| 数据存储 | 无外部 DB | D1（可选，用于频道元数据） |
| 插件扫描 | 常驻 goroutine | Cron Triggers 定时拉取 |
| Telegram 抓取 | 后台长连接 | 外部 Worker 反代或定时触发 |
| 冷启动 | N/A（常驻） | ~5ms（V8 isolate） |
| 成本 | VPS / 轻量 24h 计费 | Workers 免费额度 100k req/day |

## 技术栈

- **运行时**：Cloudflare Workers（V8 isolate）
- **语言**：TypeScript
- **Web 框架**：Hono（轻量、Worker-first）
- **存储**：KV（结果缓存）+ D1（频道元数据，可选）
- **部署**：Wrangler
- **测试**：Vitest（规划中）

## 项目结构

```
pansou-cf/
├── src/
│   └── index.ts          # Hono 入口，/api/search 路由
├── package.json
├── wrangler.toml         # CF Workers 配置
├── tsconfig.json
├── README.md
├── LICENSE
└── .gitignore
```

## 快速开始

### 前置

- Node.js ≥ 18
- `npm install -g wrangler`
- Cloudflare 账号（免费额度足够）

### 本地开发

```bash
npm install
wrangler dev
```

默认监听 `http://127.0.0.1:8787`。

### 测试搜索接口

```bash
curl "http://127.0.0.1:8787/api/search?kw=test&channels=quark,magnet"
```

返回示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 0,
    "results": []
  }
}
```

（v0.01 仅返回空结果，搜索逻辑将在后续版本补齐。）

### 部署到 Cloudflare

```bash
wrangler login                  # 首次需要浏览器授权
wrangler kv:namespace create CACHE  # 创建 KV 命名空间
# 把输出的 id 填到 wrangler.toml 的 [[kv_namespaces]] 节
wrangler deploy
```

部署成功后会得到一个 `*.workers.dev` 域名。

## API 协议（兼容 PanSou）

`GET /api/search`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `kw` | string | ✅ | 搜索关键词 |
| `channels` | string | ❌ | 渠道过滤，逗号分隔，如 `quark,magnet` |
| `concurrency` | number | ❌ | 并发数，默认 10 |
| `refresh` | boolean | ❌ | 强制刷新缓存 |

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 10,
    "results": [
      {
        "title": "...",
        "links": [
          { "type": "quark", "url": "https://...", "password": "" }
        ]
      }
    ]
  }
}
```

## 版本记录

| 版本 | 日期 | 状态 | 说明 |
|---|---|---|---|
| v0.01 | 2026-09-07 | 🚧 骨架 | 项目初始化：Hono 入口 + /api/search 占位路由 |

## 路线图

- **v0.02**：搜索接口真实实现（KV 缓存命中 → 转发到上游网盘源）
- **v0.03**：Cron Triggers 定时预热
- **v0.04**：D1 存储频道元数据
- **v0.05**：兼容 PanSou 全部插件的子集（quark / 磁力链）

## 致谢

- 原版 [fish2018/pansou](https://github.com/fish2018/pansou) — 思路与协议参考
- [Hono](https://hono.dev/) — Worker-first Web 框架
- [Cloudflare Workers](https://workers.cloudflare.com/) — 边缘运行时