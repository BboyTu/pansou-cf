/**
 * pansou-cf — v0.01
 *
 * Cloudflare Workers 入口。基于 Hono 实现 PanSou 兼容的 /api/search 接口。
 *
 * v0.01 仅实现接口骨架，搜索逻辑在后续版本补齐。
 */

import { Hono } from 'hono';

/**
 * 环境变量绑定类型。KV / D1 等后续版本启用后在此扩展。
 */
export interface Env {
  ENV: string;
  VERSION: string;
  // CACHE?: KVNamespace;     // v0.02+
  // DB?: D1Database;          // v0.04+
}

/**
 * 搜索结果链接（兼容 PanSou 协议）
 */
interface SearchLink {
  type: 'quark' | 'uc' | 'baidu' | 'aliyun' | 'magnet' | 'ed2k' | 'others';
  url: string;
  password?: string;
}

/**
 * 搜索结果条目（兼容 PanSou 协议）
 */
interface SearchResult {
  title: string;
  links: SearchLink[];
}

/**
 * /api/search 响应体（兼容 PanSou 协议）
 */
interface SearchResponse {
  code: number;
  message: string;
  data: {
    total: number;
    results: SearchResult[];
  };
}

const app = new Hono<{ Bindings: Env }>();

/**
 * 健康检查
 */
app.get('/', (c) => {
  return c.json({
    name: 'pansou-cf',
    version: c.env.VERSION,
    env: c.env.ENV,
    endpoints: ['/api/search'],
  });
});

/**
 * 网盘搜索接口（PanSou 兼容）
 *
 * Query:
 *   - kw          (required)  搜索关键词
 *   - channels    (optional)  渠道过滤，逗号分隔：quark,uc,baidu,aliyun,magnet
 *   - concurrency (optional)  并发数，默认 10
 *   - refresh     (optional)  强制刷新缓存，默认 false
 */
app.get('/api/search', (c) => {
  const kw = c.req.query('kw');
  const channels = c.req.query('channels');
  const concurrency = Number(c.req.query('concurrency') ?? 10);
  const refresh = c.req.query('refresh') === 'true';

  // 关键词必填校验
  if (!kw || kw.trim() === '') {
    return c.json<SearchResponse>(
      {
        code: 400,
        message: 'kw is required',
        data: { total: 0, results: [] },
      },
      400,
    );
  }

  // v0.01 仅返回空结果，搜索逻辑在 v0.02+ 补齐
  return c.json<SearchResponse>({
    code: 0,
    message: 'ok',
    data: {
      total: 0,
      results: [],
    },
  });
});

/**
 * 404 兜底
 */
app.notFound((c) => {
  return c.json({ code: 404, message: 'not found' }, 404);
});

/**
 * 全局错误处理
 */
app.onError((err, c) => {
  console.error(`[pansou-cf] unhandled error: ${err.message}`);
  return c.json<SearchResponse>(
    {
      code: 500,
      message: 'internal error',
      data: { total: 0, results: [] },
    },
    500,
  );
});

export default app;