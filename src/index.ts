/**
 * pansou-cf — v0.02
 *
 * Cloudflare Workers 免费版。插件化网盘/磁力链搜索，兼容 PanSou /api/search 协议。
 * 无 TG 源、无常驻进程；KV 缓存可选（绑定缺失时自动降级直连）。
 */

import { Hono } from 'hono';
import type { Env, SearchResponse, SearchResult } from './types';
import { PLUGINS, CHANNELS } from './plugins/registry';
import { runSearch, dedupe } from './scheduler';
import { getJSON, putJSON, aggKey } from './cache';

const app = new Hono<{ Bindings: Env }>();

/** 健康检查 */
app.get('/', (c) => {
  return c.json({
    name: 'pansou-cf',
    version: c.env.VERSION ?? 'dev',
    env: c.env.ENV ?? 'dev',
    channels: CHANNELS,
    cache: c.env.CACHE ? 'kv' : 'disabled',
    endpoints: ['/api/search'],
  });
});

/**
 * 网盘/磁力链搜索（PanSou 协议兼容）
 *
 * Query:
 *   - kw       (required) 搜索关键词
 *   - channels (optional) 逗号分隔渠道过滤，如 "apibay,pansearch"；默认全部
 *   - refresh  (optional) "true" 跳过聚合缓存强制刷新
 */
app.get('/api/search', async (c) => {
  const kw = (c.req.query('kw') ?? '').trim();
  const channelsParam = (c.req.query('channels') ?? '').trim();
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
  if (!refresh && c.env.CACHE) {
    const hit = await getJSON<SearchResult[]>(c.env, cacheKey);
    if (hit) {
      return c.json<SearchResponse>({
        code: 0,
        message: 'ok',
        data: { total: hit.length, results: hit, cached: true },
      });
    }
  }

  // 并发调度全部插件
  const { results, sources } = await runSearch(plugins, kw, c.env);
  const merged = dedupe(results);

  // 写缓存（KV 缺失时 putJSON 内部直接跳过）
  await putJSON(c.env, cacheKey, merged);

  return c.json<SearchResponse>({
    code: 0,
    message: 'ok',
    data: { total: merged.length, results: merged, sources },
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
