/**
 * pansou-cf — v0.02
 *
 * Cloudflare Workers 免费版。插件化网盘/磁力链搜索，兼容 PanSou /api/search 协议。
 * 无 TG 源、无常驻进程；KV 缓存可选（绑定缺失时自动降级直连）。
 */

import { Hono } from 'hono';
import type { Env, MergedResultItem, SearchResponse, SearchResult } from './types';
import { PLUGINS, CHANNELS } from './plugins/registry';
import { runSearch, dedupe } from './scheduler';
import { getJSON, putJSON, aggKey } from './cache';

const app = new Hono<{ Bindings: Env }>();

/** 按网盘类型合并链接视图（pansou-web 前端依赖此字段） */
function mergeByType(results: SearchResult[]): Record<string, MergedResultItem[]> {
  const merged: Record<string, MergedResultItem[]> = {};
  for (const r of results) {
    for (const link of r.links ?? []) {
      if (!link.url) continue;
      const type = link.type || 'others';
      (merged[type] ??= []).push({
        url: link.url,
        password: link.password,
        note: r.title,
        datetime: r.datetime,
        source: r.source,
      });
    }
  }
  return merged;
}

/** 健康检查（pansou-web 前端依赖 /api/health） */
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    auth_enabled: false,
    plugins_enabled: true,
    plugin_count: PLUGINS.length,
    plugins: PLUGINS.map((p) => p.name),
    channels: CHANNELS,
    channels_count: CHANNELS.length,
  });
});

/** 兼容旧的根路径健康检查 */
app.get('/', (c) => {
  return c.json({
    name: 'pansou-cf',
    version: c.env.VERSION ?? 'dev',
    env: c.env.ENV ?? 'dev',
    channels: CHANNELS,
    cache: c.env.CACHE ? 'kv' : 'disabled',
    endpoints: ['/api/search', '/api/health'],
  });
});

/** 链接有效性检测 — 免费版不做实时检测，返回空集由前端降级处理 */
app.post('/api/check/links', (c) => {
  return c.json({ code: 0, message: 'ok', data: { results: [] } });
});

/**
 * 网盘/磁力链搜索（PanSou 协议兼容）
 *
 * Query:
 *   - kw          (required) 搜索关键词
 *   - channels    (optional) 逗号分隔渠道过滤，如 "apibay,pansearch"；默认全部
 *   - plugins     (optional) 同 channels（原版协议别名）
 *   - cloud_types (optional) 逗号分隔网盘类型过滤，如 "quark,magnet"
 *   - refresh     (optional) "true" 跳过聚合缓存强制刷新
 *   - res / src / ext (optional) 原版协议参数，免费版接受但忽略
 */
app.get('/api/search', async (c) => {
  const kw = (c.req.query('kw') ?? '').trim();
  const channelsParam = (c.req.query('channels') ?? c.req.query('plugins') ?? '').trim();
  const cloudTypesParam = (c.req.query('cloud_types') ?? '').trim();
  const refresh = c.req.query('refresh') === 'true';

  if (!kw) {
    return c.json<SearchResponse>(
      { code: 400, message: 'kw is required', data: { total: 0, results: [] } },
      400,
    );
  }

  // 渠道选择
  let plugins = PLUGINS;
  if (channelsParam) {
    const wanted = new Set(channelsParam.split(',').map((s) => s.trim()).filter(Boolean));
    const filtered = PLUGINS.filter((p) => wanted.has(p.name));
    if (filtered.length > 0) plugins = filtered;
  }
  const channelKey = plugins.map((p) => p.name).sort().join(',');

  // 聚合缓存
  const cacheKey = aggKey(kw, channelKey);
  let merged: SearchResult[];
  let cached = false;
  let sources: Record<string, number> | undefined;
  let debug: string[] | undefined;
  const wantDebug = c.req.query('debug') === '1';
  const cacheHit = !refresh && c.env.CACHE ? await getJSON<SearchResult[]>(c.env, cacheKey) : null;
  if (cacheHit) {
    merged = cacheHit;
    cached = true;
  } else {
    // 并发调度全部插件
    const outcome = await runSearch(plugins, kw, c.env);
    merged = dedupe(outcome.results);
    sources = outcome.sources;
    if (wantDebug) debug = outcome.debug;
    // 写缓存（KV 缺失时 putJSON 内部直接跳过）
    await putJSON(c.env, cacheKey, merged);
  }

  // 网盘类型过滤（cloud_types）
  if (cloudTypesParam) {
    const wantedTypes = new Set(cloudTypesParam.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    if (wantedTypes.size > 0) {
      merged = merged
        .map((r) => ({ ...r, links: (r.links ?? []).filter((l) => wantedTypes.has(l.type)) }))
        .filter((r) => r.links.length > 0);
    }
  }

  return c.json<SearchResponse>({
    code: 0,
    message: 'ok',
    data: {
      total: merged.length,
      results: merged,
      merged_by_type: mergeByType(merged),
      ...(cached ? { cached: true } : {}),
      ...(sources ? { sources } : {}),
      ...(debug && debug.length > 0 ? { debug } : {}),
    },
  });
});

/** 404 兜底 */
app.notFound((c) => c.json({ code: 404, message: 'not found' }, 404));

/** 全局错误兜底 */
app.onError((err, c) => {
  console.error(`[pansou-cf] unhandled: ${err.message}`);
  return c.json<SearchResponse>(
    { code: 500, message: 'internal error', data: { total: 0, results: [] } },
    500,
  );
});

export default app;
