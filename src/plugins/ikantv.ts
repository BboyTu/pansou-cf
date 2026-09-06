/**
 * ikantv 插件 — 爱看公开搜索（api.naspt.vip，PanSou 同构 JSON）。
 *
 * 端点: GET https://api.naspt.vip/api/open/pansou/search?kw={kw}&limit=50
 * 返回: { code:0, data:[{ message_id, unique_id, channel, datetime, title, content, tags, links:[{type,url,password}] }] }
 */

import type { Env, LinkType, SearchResult } from '../types';
import type { SearchPlugin } from './types';

const API = 'https://api.naspt.vip/api/open/pansou/search';

interface Item {
  message_id?: string;
  unique_id?: string;
  channel?: string;
  datetime?: string;
  title: string;
  content?: string;
  tags?: string[];
  links?: Array<{ type: string; url: string; password?: string }>;
}

export const ikantv: SearchPlugin = {
  name: 'ikantv',
  priority: 3,

  async search(keyword: string, _env: Env): Promise<SearchResult[]> {
    try {
      const url = `${API}?kw=${encodeURIComponent(keyword)}&limit=50`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'pansou-cf/0.04',
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://api.naspt.vip/',
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!resp.ok) return [];

      const body = (await resp.json()) as { code?: number; data?: Item[] };
      if (body.code !== 0 || !Array.isArray(body.data)) return [];

      const out: SearchResult[] = [];
      for (const it of body.data) {
        const links = (it.links ?? [])
          .filter((l) => l.type && l.url)
          .map((l) => ({ type: l.type as LinkType, url: l.url, ...(l.password ? { password: l.password } : {}) }));
        if (links.length === 0) continue;

        let id = (it.unique_id ?? it.message_id ?? '').trim();
        if (!id) continue;
        id = id.replace(/^ikantv-/, '');

        out.push({
          unique_id: `ikantv-${id}`,
          source: 'ikantv',
          title: it.title,
          content: it.content,
          datetime: it.datetime,
          tags: it.tags,
          links,
        });
      }
      return out;
    } catch {
      return [];
    }
  },
};
