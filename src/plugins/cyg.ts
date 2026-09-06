/**
 * cyg 插件 — 次元狗（www.acgndog.com，WordPress REST API）。
 *
 * 步骤:
 *   1. GET /wp-json/wp/v2/posts?per_page=10&search={kw}  → 文章列表
 *   2. 逐篇 GET /wp-json/acg-studio/v1/download?id={id}  → [{name, url, downloadPwd, extractPwd}]
 */

import type { Env, LinkType, SearchResult } from '../types';
import type { SearchPlugin } from './types';
import { stripHtml } from './links';

const BASE = 'https://www.acgndog.com';
const PER_PAGE = 10;

interface WpPost {
  id: number;
  date?: string;
  link?: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
}

interface CygDownload {
  name: string;
  url: string;
  downloadPwd?: string;
  extractPwd?: string;
}

/** 网盘名称 → 标准类型 */
function nameToType(name: string): LinkType {
  const n = name.toLowerCase();
  if (n.includes('quark') || n.includes('夸克')) return 'quark';
  if (n.includes('uc')) return 'uc';
  if (n.includes('baidu') || n.includes('百度') || n.includes('度云')) return 'baidu';
  if (n.includes('ali') || n.includes('阿里') || n.includes('alipan')) return 'aliyun';
  if (n.includes('xunlei') || n.includes('迅雷')) return 'xunlei';
  if (n.includes('189') || n.includes('天翼')) return 'tianyi';
  if (n.includes('115')) return '115';
  if (n.includes('123')) return '123';
  if (n.includes('移动') || n.includes('139') || n.includes('caiyun')) return 'mobile';
  return 'others';
}

export const cyg: SearchPlugin = {
  name: 'cyg',
  priority: 3,

  async search(keyword: string, _env: Env): Promise<SearchResult[]> {
    try {
      const searchUrl = `${BASE}/wp-json/wp/v2/posts?per_page=${PER_PAGE}&search=${encodeURIComponent(keyword)}`;
      const resp = await fetch(searchUrl, {
        headers: { 'User-Agent': 'pansou-cf/0.04', Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!resp.ok) return [];
      const posts = (await resp.json()) as WpPost[];
      if (!Array.isArray(posts)) return [];

      // 并发拉取每篇文章的下载链接（1+10 个子请求，免费档 50 以内）
      const settled = await Promise.allSettled(
        posts.map(async (post) => {
          const dlResp = await fetch(`${BASE}/wp-json/acg-studio/v1/download?id=${post.id}`, {
            headers: { 'User-Agent': 'pansou-cf/0.04', Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
          });
          if (!dlResp.ok) return null;
          const downloads = (await dlResp.json()) as CygDownload[];
          if (!Array.isArray(downloads) || downloads.length === 0) return null;

          const links = downloads
            .filter((d) => d.url)
            .map((d) => ({
              type: nameToType(d.name ?? ''),
              url: d.url,
              ...(d.downloadPwd ? { password: d.downloadPwd } : {}),
            }));
          if (links.length === 0) return null;

          const result: SearchResult = {
            unique_id: `cyg-${post.id}`,
            source: 'cyg',
            title: stripHtml(post.title?.rendered ?? ''),
            content: post.excerpt?.rendered ? stripHtml(post.excerpt.rendered).slice(0, 200) : undefined,
            datetime: post.date,
            links,
          };
          return result;
        }),
      );

      const out: SearchResult[] = [];
      for (const s of settled) {
        if (s.status === 'fulfilled' && s.value) out.push(s.value);
      }
      return out;
    } catch {
      return [];
    }
  },
};
