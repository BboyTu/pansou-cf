/**
 * quarkres 插件 — 热门夸克资源（squark.cc.cd，TG 频道 @quark_res 数据面）。
 *
 * 端点: GET https://squark.cc.cd/api/search?kw={kw}
 * 返回: { code:200, data:[{ unique_id, title, content, datetime, links:[{type,url,password}] }] }
 * 链接已过实时有效性校验，转存成功率高。
 */

import type { Env, LinkType, SearchResult } from '../types';
import type { SearchPlugin } from './types';

const API = 'https://squark.cc.cd/api/search';

interface ResItem {
  unique_id: string;
  title: string;
  content?: string;
  datetime?: string;
  links: Array<{ type: string; url: string; password?: string }>;
}

export const quarkres: SearchPlugin = {
  name: 'quarkres',
  priority: 2,

  async search(keyword: string, _env: Env): Promise<SearchResult[]> {
    try {
      const resp = await fetch(`${API}?kw=${encodeURIComponent(keyword)}`, {
        headers: {
          'User-Agent': 'pansou-cf/0.04',
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://squark.cc.cd/',
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!resp.ok) return [];

      const body = (await resp.json()) as { code?: number; data?: ResItem[] };
      if (body.code !== 200 || !Array.isArray(body.data)) return [];

      const out: SearchResult[] = [];
      for (const it of body.data) {
        // 原版只保留夸克链接
        const links = (it.links ?? [])
          .filter((l) => l.type === 'quark' && l.url)
          .map((l) => ({ type: 'quark' as LinkType, url: l.url, ...(l.password ? { password: l.password } : {}) }));
        if (links.length === 0) continue;

        const id = it.unique_id || crypto.randomUUID();
        out.push({
          unique_id: id.startsWith('quarkres-') ? id : `quarkres-${id}`,
          source: 'quarkres',
          title: it.title,
          content: it.content,
          datetime: it.datetime,
          links,
        });
      }
      return out;
    } catch {
      return [];
    }
  },
};
