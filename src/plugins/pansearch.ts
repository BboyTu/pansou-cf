/**
 * pansearch 插件 — 盘搜聚合（移植自原版 fish2018/pansou 的 pansearch.go）。
 *
 * 流程:
 *   1. GET https://www.pansearch.me/search 提取 Next.js buildId
 *   2. GET https://www.pansearch.me/_next/data/{buildId}/search.json?keyword={kw}&offset=0
 *   3. 解析 pageProps.data.data[]，从 content HTML 中提取链接与密码
 *
 * buildId 缓存到 KV（30 分钟），避免每次搜索都拉首页。
 */

import type { Env, LinkType, SearchResult, SearchLink } from '../types';
import { UA } from './types';
import type { SearchPlugin } from './types';

const SITE = 'https://www.pansearch.me';
const BUILD_ID_KEY = 'ps:buildid';
const BUILD_ID_TTL = 1800; // 30 min

interface PanSearchItem {
  id: number;
  content: string; // HTML 片段
  pan: string;
  image: string;
  time: string;
}

interface PanSearchResponse {
  pageProps?: {
    data?: {
      total?: number;
      data?: PanSearchItem[];
    };
  };
}

/** 从 HTML 提取 buildId */
function extractBuildId(html: string): string {
  const m = html.match(/"buildId":"([^"]+)"/);
  if (m) return m[1];
  const next = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (next) {
    try {
      const data = JSON.parse(next[1]) as { buildId?: string };
      if (data.buildId) return data.buildId;
    } catch {
      /* ignore */
    }
  }
  return '';
}

async function getBuildId(env: Env): Promise<string> {
  try {
    const cached = await env.CACHE?.get(BUILD_ID_KEY);
    if (cached) return cached;
  } catch {
    /* KV 不可用时降级 */
  }

  const resp = await fetch(`${SITE}/search`, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return '';
  const html = await resp.text();
  const buildId = extractBuildId(html);
  if (buildId) {
    try {
      await env.CACHE?.put(BUILD_ID_KEY, buildId, { expirationTtl: BUILD_ID_TTL });
    } catch {
      /* ignore */
    }
  }
  return buildId;
}

/** 从 content HTML 中提取第一条链接与密码 */
function extractLink(content: string): { url: string; password: string } {
  const hrefMatch = content.match(/<a[^>]+href="([^"]+)"/i);
  if (!hrefMatch) return { url: '', password: '' };
  const href = hrefMatch[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .trim()
    .replace(/#+$/, '');
  if (!/^https?:\/\//.test(href)) return { url: '', password: '' };

  // URL 参数里的密码
  let password = '';
  try {
    const parsed = new URL(href);
    for (const key of ['pwd', 'password', 'passcode', 'code']) {
      const v = parsed.searchParams.get(key)?.trim();
      if (v) {
        password = v;
        break;
      }
    }
  } catch {
    /* ignore */
  }

  // 正文里的"密码/提取码/访问码"文本
  if (!password) {
    const text = content.replace(/<[^>]+>/g, ' ');
    const pm = text.match(/(?:提取码|访问码|密码|pwd|code)\s*[:=：]?\s*([0-9a-zA-Z]{4,8})/i);
    if (pm) password = pm[1];
  }

  return { url: href, password };
}

/** URL → 网盘类型归一化（与原版 normalizePanSearchType 对齐） */
function normalizeType(raw: string, url: string): LinkType {
  const t = raw.trim().toLowerCase();
  if (['ali', 'alipan', 'aliyun', 'aliyundrive'].includes(t)) return 'aliyun';
  if (['quark', 'uc', 'baidu', 'xunlei', 'tianyi', '115', '123', 'mobile', 'pikpak'].includes(t)) {
    return t as LinkType;
  }
  const u = url.toLowerCase();
  if (u.includes('pan.quark.cn')) return 'quark';
  if (u.includes('drive.uc.cn')) return 'uc';
  if (u.includes('pan.baidu.com')) return 'baidu';
  if (u.includes('alipan.com') || u.includes('aliyundrive.com')) return 'aliyun';
  if (u.includes('pan.xunlei.com')) return 'xunlei';
  if (u.includes('cloud.189.cn')) return 'tianyi';
  if (u.includes('115.com')) return '115';
  if (u.includes('123pan') || u.includes('123865.com') || u.includes('123684.com')) return '123';
  if (u.includes('139.com') || u.includes('10086.cn')) return 'mobile';
  if (u.includes('pikpak')) return 'pikpak';
  return 'others';
}

/** 清理 HTML 为纯文本 */
function cleanHtml(value: string): string {
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  return text
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n');
}

/** 提取标题：优先"名称："后的内容，否则用关键词 */
function extractTitle(content: string, keyword: string): string {
  const idx = content.indexOf('名称：');
  if (idx === -1) return keyword;
  const start = idx + '名称：'.length;
  const nl = content.indexOf('\n', start);
  const raw = nl === -1 ? content.slice(start) : content.slice(start, nl);
  return cleanHtml(raw) || keyword;
}

export const pansearch: SearchPlugin = {
  name: 'pansearch',
  priority: 2,

  async search(keyword: string, env: Env): Promise<SearchResult[]> {
    try {
      const buildId = await getBuildId(env);
      if (!buildId) return [];

      const api = `${SITE}/_next/data/${buildId}/search.json?keyword=${encodeURIComponent(keyword)}&offset=0`;
      const resp = await fetch(api, {
        headers: {
          'User-Agent': UA,
          Referer: `${SITE}/`,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        signal: AbortSignal.timeout(15_000),
      });
      // buildId 过期 → 刷新一次重试
      if (resp.status === 404) {
        try {
          await env.CACHE?.delete(BUILD_ID_KEY);
        } catch {
          /* ignore */
        }
        return [];
      }
      if (!resp.ok) return [];

      const body = (await resp.json()) as PanSearchResponse;
      const items = body.pageProps?.data?.data ?? [];
      if (!Array.isArray(items)) return [];

      const results: SearchResult[] = [];
      for (const item of items) {
        if (!item?.content) continue;
        const { url, password } = extractLink(item.content);
        if (!url) continue;

        const type = normalizeType(item.pan ?? '', url);
        const title = extractTitle(item.content, keyword);
        const link: SearchLink = { type, url };
        if (password) link.password = password;

        results.push({
          unique_id: `pansearch-${item.id}`,
          source: 'pansearch',
          title,
          content: cleanHtml(item.content),
          datetime: item.time || undefined,
          links: [link],
        });
      }
      return results;
    } catch {
      // 源站不可达/被墙时静默失败，不影响其他插件
      return [];
    }
  },
};
