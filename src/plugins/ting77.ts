/**
 * ting77 插件 — 77听（sou.77ting.top）。
 *
 * 流程: GET /search?q={kw}
 *       → 解析 a.resource-row（/resource/{id} + row-title/desc/size/date + cloud-badge 类型）
 *       → 每条资源×云盘类型: GET /api/link/token?id&type 取 token
 *         → GET /go?id&type&token&ts（302 Location 即网盘链接）。
 * 站点限流 8 次 token/65 秒，预算耗尽即止。移植自原版 ting77.go。
 */

import type { Env, SearchResult } from '../types';
import type { SearchPlugin } from './types';
import { extractLinks, normalizeDate, pwdFromUrl } from './links';

const BASE = 'https://sou.77ting.top';
const UA_124 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_ENTRIES = 5;

interface TingEntry {
  id: string;
  title: string;
  desc: string;
  size: string;
  date?: string;
  cloudTypes: string[];
}

async function fetchText(url: string, referer: string, accept: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA_124,
      Accept: accept,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Referer: referer,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

/** cloud-badge class → 标准类型（站点仅 quark/ali/baidu 三类） */
function normalizeBadge(cls: string): string | undefined {
  const m = cls.match(/cloud-badge\s+([a-z]+)/);
  if (!m) return undefined;
  switch (m[1]) {
    case 'quark':
      return 'quark';
    case 'ali':
      return 'aliyun';
    case 'baidu':
      return 'baidu';
    default:
      return undefined;
  }
}

/** 解析搜索页 resource-row 块 */
function parseEntries(html: string): TingEntry[] {
  const entries: TingEntry[] = [];
  const blocks = html.split('<a class="resource-row').slice(1);
  for (const chunk of blocks) {
    const seg = chunk.slice(0, 4000);
    const idM = seg.match(/href="\/resource\/([a-z0-9-]+)"/);
    if (!idM) continue;
    const titleM = seg.match(/row-title[^>]*>([\s\S]*?)<\/(?:div|span|h\d)>/);
    const title = (titleM?.[1] ?? '').replace(/<[^>]*>/g, '').trim();
    if (!title) continue;
    const descM = seg.match(/row-desc[^>]*>([\s\S]*?)<\/(?:div|span)>/);
    const sizeM = seg.match(/row-size[^>]*>([\s\S]*?)<\/(?:div|span)>/);
    const dateM = seg.match(/row-date[^>]*>([\s\S]*?)<\/(?:div|span)>/);
    const cloudTypes: string[] = [];
    const badgeRe = /class="cloud-badge\s+[a-z]+"/g;
    let bm: RegExpExecArray | null;
    while ((bm = badgeRe.exec(seg)) !== null) {
      const t = normalizeBadge(bm[0].slice(7, -1));
      if (t && !cloudTypes.includes(t)) cloudTypes.push(t);
    }
    if (cloudTypes.length === 0) continue;
    entries.push({
      id: idM[1],
      title,
      desc: (descM?.[1] ?? '').replace(/<[^>]*>/g, '').trim(),
      size: (sizeM?.[1] ?? '').replace(/<[^>]*>/g, '').trim(),
      date: (dateM?.[1] ?? '').replace(/<[^>]*>/g, '').trim() || undefined,
      cloudTypes,
    });
    if (entries.length >= MAX_ENTRIES) break;
  }
  return entries;
}

/** 取跳转 token；429/限流返回 null 停止 */
async function fetchToken(id: string, type: string, referer: string) {
  const url = `${BASE}/api/link/token?id=${encodeURIComponent(id)}&type=${type}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA_124,
      Accept: 'application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: referer,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (resp.status === 429) return null;
  if (!resp.ok) throw new Error(`token HTTP ${resp.status}`);
  const body = (await resp.json()) as { code?: number; data?: { token?: string; ts?: string } };
  const token = body.data?.token;
  const ts = body.data?.ts;
  if (body.code !== 0 || !token || !ts) return null;
  return { token, ts };
}

/** /go 302 Location → 网盘链接 */
async function resolveLink(
  id: string,
  type: string,
  token: string,
  ts: string,
  referer: string,
): Promise<string | undefined> {
  const url = `${BASE}/go?id=${encodeURIComponent(id)}&type=${type}&token=${token}&ts=${ts}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA_124,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: referer,
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  const location = resp.headers.get('location');
  try { await resp.body?.cancel(); } catch { /* ignore */ }
  if (!location || resp.status < 300 || resp.status >= 400) return undefined;
  return location;
}

export const ting77: SearchPlugin = {
  name: 'ting77',
  priority: 2,

  async search(keyword: string, _env: Env, ctx?): Promise<SearchResult[]> {
    try {
      const searchHtml = await fetchText(
        `${BASE}/search?q=${encodeURIComponent(keyword)}`,
        `${BASE}/`,
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      );
      const entries = parseEntries(searchHtml);
      if (entries.length === 0) return [];

      const results: SearchResult[] = [];
      for (const entry of entries) {
        const links: SearchResult['links'] = [];
        const seen = new Set<string>();
        for (const type of entry.cloudTypes.slice(0, 2)) {
          if (links.length >= 2) break;
          if (ctx?.budget && !ctx.budget.take()) break; // token 请求预算
          const referer = `${BASE}/resource/${entry.id}`;
          let token: { token: string; ts: string } | null;
          try {
            token = await fetchToken(entry.id, type, referer);
          } catch {
            continue;
          }
          if (!token) break; // 限流，整体放弃
          if (ctx?.budget && !ctx.budget.take()) break; // go 请求预算
          let location: string | undefined;
          try {
            location = await resolveLink(entry.id, type, token.token, token.ts, referer);
          } catch {
            continue;
          }
          if (!location) continue;
          const found = extractLinks(location);
          for (const l of found) {
            if (seen.has(l.url)) continue;
            seen.add(l.url);
            links.push(l);
          }
        }
        if (links.length === 0) continue;

        const contentParts: string[] = [];
        if (entry.desc) contentParts.push(entry.desc);
        if (entry.size) contentParts.push(`大小: ${entry.size}`);

        results.push({
          unique_id: `ting77-${entry.id}`,
          source: 'ting77',
          title: entry.title,
          content: contentParts.join(' | ').slice(0, 300),
          datetime: normalizeDate(entry.date),
          links: links.map((l) => {
            const pwd = pwdFromUrl(l.url);
            return pwd && !l.password ? { ...l, password: pwd } : l;
          }),
        });
      }
      return results;
    } catch {
      return [];
    }
  },
};
