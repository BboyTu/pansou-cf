/**
 * meitizy 插件 — 影视资源网盘链接搜索（apis.451024.xyz，POST JSON）。
 *
 * 端点: POST https://apis.451024.xyz/api/media/search  body {title, page, size}
 * 返回: { data:[{ id, title, content, link, link_type, tags, created_at }], total }
 */

import type { Env, LinkType, SearchResult } from '../types';
import type { SearchPlugin } from './types';
import { normalizeDate, stripHtml } from './links';

const API = 'https://apis.451024.xyz/api/media/search';

interface ApiItem {
  id: number;
  title: string;
  content?: string;
  link: string;
  link_type: string;
  tags?: string;
  created_at?: string;
}

/** link_type → 标准类型（原版映射，缺省 others） */
function convertLinkType(t: string): LinkType {
  const map: Record<string, LinkType> = {
    alipan: 'aliyun',
    xunlei: 'xunlei',
    baidu: 'baidu',
    quark: 'quark',
    uc: 'uc',
    '115': '115',
    '123': '123',
    tianyi: 'tianyi',
    magnet: 'magnet',
    ed2k: 'ed2k',
  };
  return map[t] ?? 'others';
}

export const meitizy: SearchPlugin = {
  name: 'meitizy',
  priority: 2,

  async search(keyword: string, _env: Env): Promise<SearchResult[]> {
    try {
      const resp = await fetch(API, {
        method: 'POST',
        headers: {
          'User-Agent': 'pansou-cf/0.04',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ title: keyword, page: 1, size: 10 }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!resp.ok) return [];

      const body = (await resp.json()) as { data?: ApiItem[] };
      if (!Array.isArray(body.data)) return [];

      const out: SearchResult[] = [];
      for (const it of body.data) {
        if (!it.link || !it.title) continue;
        out.push({
          unique_id: `meitizy-${it.id}`,
          source: 'meitizy',
          title: stripHtml(it.title),
          content: it.content ? stripHtml(it.content) : undefined,
          datetime: normalizeDate(it.created_at),
          tags: it.tags ? it.tags.split(/[,，#\s]+/).filter(Boolean) : undefined,
          links: [{ type: convertLinkType(it.link_type), url: it.link }],
        });
      }
      return out;
    } catch {
      return [];
    }
  },
};
