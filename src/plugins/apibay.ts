/**
 * apibay 插件 — ThePirateBay 官方镜像 API（纯 JSON，稳定）。
 *
 * 端点: GET https://apibay.org/q.php?q={kw}&cat=0
 * 返回: [{ id, name, info_hash, leechers, seeders, size, num_files, username, added, status, category, imdb }]
 * 空结果返回: [{ name: "No results" }]
 */

import type { Env, LinkType, SearchResult } from '../types';
import type { SearchPlugin } from './types';

const API = 'https://apibay.org/q.php';

interface ApibayItem {
  name: string;
  info_hash: string;
  leechers: string;
  seeders: string;
  size: string;
  added: string;
  status: string;
}

/** 字节数 → 人类可读大小 */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export const apibay: SearchPlugin = {
  name: 'apibay',
  priority: 1,

  async search(keyword: string, _env: Env): Promise<SearchResult[]> {
    try {
      const url = `${API}?q=${encodeURIComponent(keyword)}&cat=0`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'pansou-cf/0.02' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return [];

      const items = (await resp.json()) as ApibayItem[];
      if (!Array.isArray(items)) return [];

      const results: SearchResult[] = [];
      for (const it of items) {
        // 空结果哨兵：[{"name":"No results"}]
        if (!it.info_hash || it.name === 'No results') continue;

        const seeders = parseInt(it.seeders ?? '0', 10) || 0;
        const sizeBytes = parseInt(it.size ?? '0', 10) || 0;
        const magnet = `magnet:?xt=urn:btih:${it.info_hash}&dn=${encodeURIComponent(it.name)}`;

        results.push({
          unique_id: `apibay-${it.info_hash}`,
          source: 'apibay',
          title: it.name,
          datetime: it.added ? new Date(parseInt(it.added, 10) * 1000).toISOString() : undefined,
          size: formatSize(sizeBytes),
          hot: seeders,
          links: [{ type: 'magnet' as LinkType, url: magnet }],
        });
      }

      // 做种数降序，热度高的排前
      results.sort((a, b) => (b.hot ?? 0) - (a.hot ?? 0));
      return results.slice(0, 50);
    } catch {
      // 容错：源站失败不影响其他插件
      return [];
    }
  },
};
