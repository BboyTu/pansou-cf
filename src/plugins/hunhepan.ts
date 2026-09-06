/**
 * hunhepan 插件 — 混合盘系 4 个同构搜索 API 并行聚合。
 *
 * 端点（POST JSON {page, q, user, exact, format, share_time, size, type, exclude_user, adv_params}）:
 *   - https://hunhepan.com/open/search/disk
 *   - https://qkpanso.com/v1/search/disk
 *   - https://kuake8.com/v1/search/disk
 *   - https://www.misoso.cc/v1/search/disk
 * 返回: { code:200, data:{ list:[{ disk_id, disk_name, disk_pass, disk_type, link, shared_time, share_user }] } }
 */

import type { Env, LinkType, SearchResult } from '../types';
import type { SearchPlugin } from './types';
import { normalizeDate, stripHtml } from './links';

const APIS = [
  'https://hunhepan.com/open/search/disk',
  'https://qkpanso.com/v1/search/disk',
  'https://kuake8.com/v1/search/disk',
  'https://www.misoso.cc/v1/search/disk',
];

interface HItem {
  disk_id: string;
  disk_name: string;
  disk_pass?: string;
  disk_type: string;
  link?: string;
  shared_time?: string;
  share_user?: string;
}

interface HResp {
  code: number;
  msg?: string;
  data?: { list?: HItem[] };
}

/** API 网盘类型 → 标准类型（原版映射） */
function convertDiskType(t: string): LinkType {
  const map: Record<string, LinkType> = {
    BDY: 'baidu',
    ALY: 'aliyun',
    QUARK: 'quark',
    TIANYI: 'tianyi',
    UC: 'uc',
    CAIYUN: 'mobile',
    '115': '115',
    XUNLEI: 'xunlei',
    '123PAN': '123',
    PIKPAK: 'pikpak',
  };
  return map[t] ?? 'others';
}

async function searchOne(api: string, keyword: string, page: number): Promise<HItem[]> {
  const resp = await fetch(api, {
    method: 'POST',
    headers: {
      'User-Agent': 'pansou-cf/0.04',
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Referer: new URL(api).origin + '/',
    },
    body: JSON.stringify({
      page,
      q: keyword,
      user: '',
      exact: false,
      format: [],
      share_time: '',
      size: 30,
      type: '',
      exclude_user: [],
      adv_params: { wechat_pwd: '', platform: 'pc' },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) return [];
  const body = (await resp.json()) as HResp;
  if (body.code !== 200) return [];
  return body.data?.list ?? [];
}

export const hunhepan: SearchPlugin = {
  name: 'hunhepan',
  priority: 3,

  async search(keyword: string, _env: Env): Promise<SearchResult[]> {
    // 4 站点 × 2 页并行（Workers 免费档 subrequest 上限 50，这里 8 个没问题）
    const tasks: Promise<HItem[]>[] = [];
    for (const api of APIS) {
      for (const page of [1, 2]) {
        tasks.push(searchOne(api, keyword, page).catch(() => []));
      }
    }
    const batches = await Promise.all(tasks);

    const out: SearchResult[] = [];
    const seen = new Set<string>();
    for (const items of batches) {
      for (const it of items) {
        if (!it.link) continue;
        const key = it.disk_id || `${it.link}|${it.disk_type}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const type = convertDiskType(it.disk_type);
        const links = [{ type, url: it.link, ...(it.disk_pass ? { password: it.disk_pass } : {}) }];
        out.push({
          unique_id: `hunhepan-${key}`,
          source: 'hunhepan',
          title: stripHtml(it.disk_name ?? ''),
          datetime: normalizeDate(it.shared_time),
          content: it.share_user ? `分享者: ${it.share_user}` : undefined,
          links,
        });
      }
    }
    return out;
  },
};
