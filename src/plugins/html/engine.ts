/**
 * 通用 HTML 站点抓取引擎。
 *
 * 原版 PanSou 的 HTML 解析类插件全部遵循同一模式：
 *   搜索页 → 提取详情页链接列表 → 并发抓详情页 → 用统一的 16 类网盘链接正则提取
 *
 * 本引擎把它参数化：每个站点只需一份 HtmlSiteConfig（搜索 URL + 详情 href 模式）。
 * 详情页不解析 DOM，直接对整页文本跑 extractLinks。
 *
 * 子请求预算：Workers 免费版单请求最多 50 个 fetch 子请求，
 * 详情页抓取由调度器注入的 SearchContext.budget 全局限额。
 */

import type { Env, SearchResult } from '../../types';
import { UA } from '../types';
import type { SearchContext, SearchPlugin } from '../types';
import { extractLinks, stripHtml } from '../links';

export interface HtmlSiteConfig {
  /** 插件名 / channel 名 */
  name: string;
  /** 站点根（相对 href 拼接 + Referer） */
  base: string;
  /** 搜索 URL 模板，{kw} 会被替换为 encodeURIComponent 后的关键词 */
  searchUrl: string;
  /** 默认 GET；Discuz 类站点需要 POST */
  method?: 'GET' | 'POST';
  /** POST body 模板（{kw} 占位，为已编码关键词） */
  body?: string;
  /** 详情页 href 匹配正则 */
  hrefRe: RegExp;
  /** 详情页抓取上限（默认 3，另受全局预算约束） */
  maxDetail?: number;
  /** 非 UTF-8 站点（Workers TextDecoder 支持 gbk/big5 等） */
  encoding?: string;
  /** 列表页标题清洗（默认去标签去空白） */
  titleClean?: (t: string) => string;
}

const ANCHOR_RE = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const DEFAULT_UA = UA;

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function cleanTitle(t: string): string {
  return stripHtml(t).replace(/\s+/g, ' ').trim();
}

async function fetchText(
  siteName: string,
  url: string,
  encoding: string | undefined,
  referer: string,
  method: 'GET' | 'POST',
  body: string | undefined,
): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      method,
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Referer: referer,
      },
      body: method === 'POST' ? body : undefined,
      signal: AbortSignal.timeout(12_000),
      redirect: 'follow',
    });
    if (!resp.ok) {
      console.error(`[html:${siteName}] status=${resp.status} ${url.slice(0, 80)}`);
      return null;
    }
    if (!encoding || encoding.toLowerCase() === 'utf-8') {
      return await resp.text();
    }
    const buf = await resp.arrayBuffer();
    return new TextDecoder(encoding).decode(buf);
  } catch (e) {
    console.error(`[html:${siteName}] fetch-err ${String(e).slice(0, 120)} ${url.slice(0, 80)}`);
    return null;
  }
}

function extractAnchors(html: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  ANCHOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANCHOR_RE.exec(html)) !== null) {
    out.push({ href: m[1], text: m[2] });
    if (out.length >= 2000) break;
  }
  return out;
}

export function makeHtmlPlugin(cfg: HtmlSiteConfig): SearchPlugin {
  const maxDetail = cfg.maxDetail ?? 3;
  return {
    name: cfg.name,
    priority: 5,
    async search(keyword: string, _env: Env, ctx?: SearchContext): Promise<SearchResult[]> {
      const kw = encodeURIComponent(keyword);
      const searchUrl = cfg.searchUrl.replace('{kw}', kw);
      const html = await fetchText(
        cfg.name,
        searchUrl,
        cfg.encoding,
        cfg.base,
        cfg.method ?? 'GET',
        cfg.body ? cfg.body.replace('{kw}', kw) : undefined,
      );
      if (!html) {
        if (ctx?.debug) ctx.debug.push(`${cfg.name}: search-page fetch failed`);
        return [];
      }

      // 收集详情链接（去重 + 上限）
      const seen = new Set<string>();
      const details: Array<{ url: string; title: string }> = [];
      for (const a of extractAnchors(html)) {
        if (!cfg.hrefRe.test(a.href)) continue;
        cfg.hrefRe.lastIndex = 0;
        const abs = a.href.startsWith('http') ? a.href : new URL(a.href, cfg.base).toString();
        if (seen.has(abs)) continue;
        seen.add(abs);
        const title = cfg.titleClean ? cfg.titleClean(a.text) : cleanTitle(a.text);
        details.push({ url: abs, title });
        if (details.length >= maxDetail) break;
      }
      if (details.length === 0) {
        if (ctx?.debug) ctx.debug.push(`${cfg.name}: 0 detail links matched (page ${(html.length / 1024).toFixed(0)}KB)`);
        return [];
      }

      const results: SearchResult[] = [];
      for (const d of details) {
        // 子请求预算：耗尽即停（免费版 50 fetch/请求）
        if (ctx && !ctx.budget.take()) break;
        const page = await fetchText(cfg.name, d.url, cfg.encoding, d.url, 'GET', undefined);
        if (!page) {
          if (ctx?.debug) ctx.debug.push(`${cfg.name}: detail fetch failed ${d.url.slice(0, 60)}`);
          continue;
        }
        const links = extractLinks(page);
        if (links.length === 0) {
          if (ctx?.debug) ctx.debug.push(`${cfg.name}: detail no links ${(page.length / 1024).toFixed(0)}KB ${d.url.slice(0, 50)}`);
          continue;
        }
        results.push({
          unique_id: `${cfg.name}-${fnv1a(d.url)}`,
          source: cfg.name,
          title: d.title || `${cfg.name} 资源`,
          links,
        });
      }
      return results;
    },
  };
}
