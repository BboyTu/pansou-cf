/**
 * ouge 插件 — 欧哥资源站（woog.nxog.eu.org，苹果CMS 标准 vod API）。
 *
 * 端点: GET https://woog.nxog.eu.org/api.php/provide/vod?ac=detail&wd={kw}
 * 返回: { code:1, list:[{ vod_id, vod_name, vod_content, vod_down_url, vod_pubdate, ... }] }
 * 链接从 vod_content / vod_down_url 中用正则提取。
 */

import type { Env, SearchResult } from '../types';
import type { SearchPlugin } from './types';
import { extractLinks, normalizeDate, stripHtml } from './links';

const API = 'https://woog.nxog.eu.org/api.php/provide/vod';

interface VodItem {
  vod_id: number;
  vod_name: string;
  vod_content?: string;
  vod_down_url?: string;
  vod_pubdate?: string;
  vod_remarks?: string;
}

export const ouge: SearchPlugin = {
  name: 'ouge',
  priority: 2,

  async search(keyword: string, _env: Env): Promise<SearchResult[]> {
    try {
      const url = `${API}?ac=detail&wd=${encodeURIComponent(keyword)}`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'pansou-cf/0.04',
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://woog.nxog.eu.org/',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return [];

      const body = (await resp.json()) as { code?: number; list?: VodItem[] };
      if (!Array.isArray(body.list)) return [];

      const out: SearchResult[] = [];
      for (const it of body.list) {
        if (!it.vod_name) continue;
        // 链接可能在正文或 vod_down_url（格式: 名称$链接#名称$链接）
        const downUrls = (it.vod_down_url ?? '')
          .split('#')
          .map((s) => s.split('$').pop() ?? '')
          .join('\n');
        const links = extractLinks(`${it.vod_content ?? ''}\n${downUrls}`);
        if (links.length === 0) continue;

        out.push({
          unique_id: `ouge-${it.vod_id}`,
          source: 'ouge',
          title: stripHtml(it.vod_name),
          content: it.vod_content ? stripHtml(it.vod_content).slice(0, 300) : it.vod_remarks,
          datetime: normalizeDate(it.vod_pubdate),
          links,
        });
      }
      return out;
    } catch {
      return [];
    }
  },
};
