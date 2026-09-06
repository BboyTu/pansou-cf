/**
 * dyyjv 插件 — 电影云集影视网（WordPress 站点，两段式搜索）。
 *
 * 参考 PanHub（wu529778790/panhub.shenzjd.com）的 dyyjv 插件移植。
 * 端点1: GET https://dyyjv.com/wp-json/wp/v2/search?search={kw}&per_page=10
 *        匿名可用，返回 [{id, title, url}]
 * 端点2: GET https://dyyjv.com/{id}.html
 *        详情页内嵌夸克/百度等网盘链接，密码常在 URL query ?pwd=xxx
 * 子请求成本：1 + min(5, N) ≈ 6 次
 */

import type { Env, SearchResult } from '../types';
import type { SearchPlugin } from './types';
import { extractLinks, stripHtml } from './links';

const BASE = 'https://dyyjv.com';
const MAX_DETAILS = 5;

interface WpSearchItem {
  id: number;
  title: string;
  url: string;
}

export const dyyjv: SearchPlugin = {
  name: 'dyyjv',
  priority: 2,

  async search(keyword: string, _env: Env, ctx?): Promise<SearchResult[]> {
    try {
      // 第一步：wp-json 搜索
      const searchUrl = `${BASE}/wp-json/wp/v2/search?search=${encodeURIComponent(keyword)}&per_page=10`;
      const resp = await fetch(searchUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
          Referer: `${BASE}/`,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return [];
      const items = (await resp.json()) as WpSearchItem[];
      if (!Array.isArray(items) || items.length === 0) return [];

      // 第二步：抓详情页提取链接（预算内最多 5 个）
      const out: SearchResult[] = [];
      for (const it of items) {
        if (!it.id || out.length >= MAX_DETAILS) break;
        if (ctx && !ctx.budget.take()) break;

        const detailUrl = it.url || `${BASE}/${it.id}.html`;
        try {
          const dresp = await fetch(detailUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              Referer: `${BASE}/`,
            },
            signal: AbortSignal.timeout(10_000),
          });
          if (!dresp.ok) continue;
          // 整页跑链接正则（href 属性里的 URL 是完整的，正文里被截断的不受影响）
          const html = await dresp.text();
          const links = extractLinks(html);
          if (links.length === 0) continue;

          out.push({
            unique_id: `dyyjv-${it.id}`,
            source: 'dyyjv',
            title: it.title ? stripHtml(it.title).slice(0, 200) : `dyyjv-${it.id}`,
            links,
          });
        } catch {
          continue;
        }
      }
      return out;
    } catch {
      return [];
    }
  },
};
