# pansou-cf

> PanSou 免费版 @ Cloudflare Workers — 插件化网盘/磁力链搜索 + Web 界面，兼容原版 [/api/search](https://github.com/fish2018/pansou) 协议

[![Version](https://img.shields.io/badge/version-v0.03-blue)](#版本记录)
[![Runtime](https://img.shields.io/badge/Cloudflare-Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)
[![Cost](https://img.shields.io/badge/cost-%240-success)](#部署)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## 定位

把 [fish2018/pansou](https://github.com/fish2018/pansou)（Go 长驻服务）+ [fish2018/pansou-web](https://github.com/fish2018/pansou-web)（Vue 前端）搬到 **Cloudflare Workers 免费版**：

- **砍掉**：TG 频道源、常驻 goroutine 扫描、磁盘缓存（与 Serverless 模型冲突）
- **保留**：插件化搜索源架构、`/api/search` 协议、结果聚合与去重、**Web 搜索界面**
- **缓存**：Workers KV（聚合结果 1h + pansearch buildId 30min），KV 未绑定自动降级直连
- **费用**：$0（Workers 免费 100k req/天 + KV 免费额度 + 静态资源免费托管）

## 与原版 PanSou 的差异

| 维度 | PanSou（Go 原版） | pansou-cf |
|---|---|---|
| 运行时 | 长驻 Go 进程 | Workers 请求级 isolate |
| TG 频道源 | ✅ | ❌ 移除 |
| 插件数量 | 90+ | 2 个（按需增加） |
| Web 界面 | ✅（前后端集成镜像） | ✅（pansou-web 构建产物，Workers Assets 托管） |
| 缓存 | 内存 + 磁盘 | KV（可降级） |
| 部署成本 | VPS 24h 计费 | 免费 |

## 搜索源

| 渠道 | 类型 | 说明 |
|---|---|---|
| `apibay` | 磁力链 | ThePirateBay 官方镜像 API，纯 JSON，按做种数排序 |
| `pansearch` | 网盘聚合 | 移植原版 pansearch 插件：夸克/UC/百度/阿里/迅雷/天翼/115/123 等 |
| `quarkres` | 夸克 | squark.cc.cd（TG @quark_res 数据面），链接实时校验过 |
| `ikantv` | 多网盘 | api.naspt.vip 公开搜索 |
| `meitizy` | 多网盘 | apis.451024.xyz 影视资源 |
| `hunhepan` | 多网盘 | 混合盘系 4 个 API 聚合（hunhepan/qkpanso/kuake8/misoso） |
| `quark4k` | 夸克 | quark4k.com（Flarum 论坛，4K 资源） |
| `ouge` | 多网盘 | 欧哥资源（苹果CMS vod API） |
| `cyg` | 多网盘 | 次元狗（源站已加 401 认证，暂不可用保留代码） |
| `nyaa` | 磁力链 | nyaa.si（源站屏蔽 CF 数据中心 IP，暂不可用保留代码） |
| `zhizhen` | 多网盘 | 指针影视（AppleCMS vod 路由，通用 HTML 引擎） |
| `duoduo` | 多网盘 | 多多影视（AppleCMS） |
| `erxiao` | 多网盘 | 二小影视（AppleCMS） |
| `gaoqing888` | 夸克 | 高清888（4K 影视） |

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
| `channels` / `plugins` | ❌ | 逗号分隔，如 `apibay,pansearch`；默认全部 |
| `cloud_types` | ❌ | 逗号分隔网盘类型过滤，如 `quark,magnet` |
| `refresh` | ❌ | `true` 跳过缓存强制刷新 |

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

pansou-web 前端使用的健康检查（版本、插件列表、认证状态 `auth_enabled:false`）。

### `GET /`

服务信息 + Web 界面入口。

## Web 界面

前端直接复用 [fish2018/pansou-web](https://github.com/fish2018/pansou-web)（Vue 3 + Vite + Tailwind）：

```bash
# 构建前端（产物拷到 dist-web，wrangler.toml [assets] 已指向这里）
git clone --depth 1 https://github.com/fish2018/pansou-web.git
cd pansou-web && npm install && npm run build && cd ..
rm -rf dist-web && cp -r pansou-web/dist dist-web
npx wrangler deploy
```

无需改动前端源码：它的 `baseURL: '/api'` 天然同域，`/api/*` 由 Worker 处理（`run_worker_first`），其余路径走静态资源。

## 项目结构

```
src/
├── index.ts            # Hono 入口：/api/search + /api/health + merged_by_type
├── types.ts            # 共享类型（PanSou 协议对齐）
├── scheduler.ts        # Promise.allSettled 并发调度 + 去重
├── cache.ts            # KV 包装（未绑定自动降级）
└── plugins/
    ├── types.ts        # SearchPlugin 接口
    ├── registry.ts     # 注册表
    ├── apibay.ts       # 磁力链源
    └── pansearch.ts    # 网盘聚合源
dist-web/               # pansou-web 构建产物（Workers Assets 托管，不入库）
```

## 部署

1. Cloudflare 账号（免费即可）
2. `npx wrangler login`
3. KV 命名空间已配置在 `wrangler.toml`（如需自建：`npx wrangler kv namespace create CACHE`，替换 `wrangler.toml` 中的 id）
4. （可选）按上文构建 Web 界面到 `dist-web/`
5. `npx wrangler deploy`

大陆访问 `*.workers.dev` 域名可能不稳定，建议绑定自定义域名（Workers 控制台 → Settings → Domains & Routes，CF 自动发 SSL）。

## 版本记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.01 | 2026-09-07 | 项目初始化：Hono 入口 + /api/search 占位 |
| v0.02 | 2026-09-07 | 真实搜索：apibay 磁力链 + pansearch 网盘聚合；KV 缓存；allSettled 并发调度 |
| v0.03 | 2026-09-07 | Web 界面（pansou-web 前端 @ Workers Assets）；/api/health；merged_by_type；cloud_types 过滤 |
| v0.04 | 2026-09-07 | 插件扩容：新增 quarkres/ikantv/meitizy/hunhepan/quark4k/ouge/cyg/nyaa（8 个，共 10 源） |
| v0.05 | 2026-09-07 | 通用 HTML 抓取引擎 + 子请求预算管理器；新增 zhizhen/duoduo/erxiao/gaoqing888（共 14 源）；?debug=1 诊断参数 |

## 路线图

- **v0.06+**：加密签名类插件（haitunsou/miosou 等 9 个活源）；GB18030 编码站（dygang）；候选池见 `src/plugins/html/sites.ts` 注释
  - 已排除：muou/hdmoli（源站拦截 CF 出口 IP）、xiaozhang（详情页 302 到已废域名）、leso/clmao/rrbt（反爬）
- **v0.05**：Cron Triggers 预热热词
- **v0.06**：链接有效性检测（/api/check/links 实装）

## 致谢

- [fish2018/pansou](https://github.com/fish2018/pansou) — 协议与 pansearch 插件逻辑来源
- [fish2018/pansou-web](https://github.com/fish2018/pansou-web) — Web 界面来源
- [Hono](https://hono.dev/) — Worker-first Web 框架
