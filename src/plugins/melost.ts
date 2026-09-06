/**
 * melost 插件 — 影盘社（www.melost.cn）。
 *
 * 端点: POST https://www.melost.cn/v1/search/disk（JSON body）
 * 返回: { code:200, data:{ list:[{ disk_id, disk_name, disk_pass, disk_type,
 *        files, share_user, shared_time, tags, link }] } }
 * 移植自原版 melost.go：2 页并发 → 去重 → 类型映射。
 */

import type { Env, SearchResult, SearchLink } from '../types';
import type { SearchPlugin } from './types';
import { extractLinks, normalizeDate, stripHtml } from './links';

const API = 'https://www.melost.cn/v1/search/disk';
const PAGE_SIZE = 30;
const MAX_PAGES = 2;

interface MelostItem {
  disk_id?: string;
  disk_name?: string;
  disk_pass?: string;
  disk_type?: string;
  files?: string;
  share_user?: string;
  shared_time?: string;
  tags?: unknown;
  link?: string;
}

/** 站点类型码 → 标准链接类型 */
const DISK_TYPE_MAP: Record<string, string> = {
  BDY: 'baidu',
  BAIDU: 'baidu',
  ALY: 'aliyun',
  ALIYUN: 'aliyun',
  QUARK: 'quark',
  TIANYI: 'tianyi',
  UC: 'uc',
  CAIYUN: 'mobile',
  MOBILE: 'mobile',
  '115': '115',
  XUNLEI: 'xunlei',
  '123': '123',
  '123PAN': '123',
  PIKPAK: 'pikpak',
  LANZOU: 'others',
};

function buildPageBody(keyword: string, page: number): string {
  return JSON.stringify({
    page,
    q: keyword,
    user: '',
    exact: false,
    user_distinct: false,
    format: [],
    share_time: '',
    share_year: '',
    size: PAGE_SIZE,
    order: '',
    type: '',
    search_ticket: '',
    exclude_user: [],
    adv_params: {
      wechat_pwd: '',
      search_code: '',
      platform: 'pc',
      fp_data: '',
      automated: '0',
    },
  });
}

async function searchPage(keyword: string, page: number): Promise<MelostItem[]> {
  const resp = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Origin: 'https://www.melost.cn',
      Referer: 'https://www.melost.cn/search',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    },
    body: buildPageBody(keyword, page),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return [];
  const body = (await resp.json()) as { code?: number; data?: { list?: MelostItem[] } };
  if (body.code !== 200 || !Array.isArray(body.data?.list)) return [];
  return body.data.list;
}

export const melost: SearchPlugin = {
  name: 'melost',
  priority: 2,

  async search(keyword: string, _env: Env, ctx?): Promise<SearchResult[]> {
    try {
      const pages = await Promise.allSettled([
        searchPage(keyword, 1),
        // 第 2 页消耗子请求预算，耗尽则只跑第 1 页
        ctx?.budget.take() ? searchPage(keyword, 2) : Promise.resolve([] as MelostItem[]),
      ]);

      const items: MelostItem[] = [];
      for (const r of pages) if (r.status === 'fulfilled') items.push(...r.value);

      // 去重（disk_id 优先，其次 link）
      const seen = new Set<string>();
      const out: SearchResult[] = [];
      for (const it of items) {
        const link = (it.link ?? '').trim();
        if (!link) continue;
        const key = it.disk_id || link;
        if (seen.has(key)) continue;
        seen.add(key);

        const type = DISK_TYPE_MAP[(it.disk_type ?? '').toUpperCase()] ?? undefined;
        // 类型码不认识时从链接本身识别
        let links: SearchLink[] = type ? [{ type: type as SearchLink['type'], url: link }] : [];
        if (links.length === 0) {
          const detected = extractLinks(link);
          if (detected.length === 0) continue;
          links = detected;
        }
        const password = (it.disk_pass ?? '').trim();
        if (password && !links[0].password) {
          links = [{ ...links[0], password }];
        }

        const tags = Array.isArray(it.tags)
          ? (it.tags as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim() !== '')
          : [];
        const contentParts: string[] = [];
        const files = stripHtml(it.files ?? '').trim();
        if (files) contentParts.push(files);
        if (it.share_user?.trim()) contentParts.push(`分享用户: ${it.share_user.trim()}`);
        if (tags.length) contentParts.push(`标签: ${tags.join('、')}`);

        out.push({
          unique_id: `melost-${it.disk_id || key.slice(0, 32)}`,
          source: 'melost',
          title: stripHtml(it.disk_name ?? '').trim() || link,
          content: contentParts.join('\n').slice(0, 400),
          datetime: normalizeDate(it.shared_time),
          links: links as SearchResult['links'],
        });
      }
      return out;
    } catch {
      return [];
    }
  },
};
