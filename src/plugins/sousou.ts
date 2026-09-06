/**
 * sousou 插件 — 盘搜（原 sousou.pro API 已死，走 panso.vip 服务端渲染网页）。
 *
 * 流程: GET https://www.panso.vip/search?q={kw}
 *       → 解析 div.search-item 块（/doc/ 链接 + 标题 + 云盘类型 + 时间）
 *       → 逐个抓详情页，从整页文本提取网盘链接（预算内最多 6 条）。
 * 移植自原版 sousou.go 的 searchWeb 方案，DOM 解析改为正则切块。
 */

import type { Env, SearchResult } from '../types';
import type { SearchPlugin } from './types';
import { extractLinks, normalizeDate } from './links';

const WEB = 'https://www.panso.vip';
const UA_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const MAX_DETAILS = 6;

interface PansoItem {
  docPath: string;
  title: string;
  info: string;
  date?: string;
}

/** 提取码兜底正则（百度盘等链接不带 pwd 参数时用） */
const PWD_RE = /(?:提取码|密码|pwd)[:：]?\s*([a-zA-Z0-9]{4})/;

async function fetchText(url: string, referer: string, timeout = 12_000): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA_CHROME,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: referer,
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

/** 解析搜索页：按 <div class="search-item"> 切块后逐块正则提取 */
function parseSearchPage(html: string): PansoItem[] {
  const items: PansoItem[] = [];
  const blocks = html.split('<div class="search-item">').slice(1);
  for (const block of blocks) {
    // 块边界：到下一个 metadata 结束/tags 结束处，取前 3000 字符足够
    const chunk = block.slice(0, 3000);
    const docM = chunk.match(/href="(\/doc\/[a-z0-9]+)"/);
    if (!docM) continue;
    const titleM = chunk.match(/title="([^"]*)"/);
    const infoM = chunk.match(/search-item-info">([\s\S]*?)<\/span>/);
    const dateM = chunk.match(/\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?/);
    items.push({
      docPath: docM[1],
      title: (titleM?.[1] ?? '').trim(),
      info: (infoM?.[1] ?? '').replace(/<[^>]*>/g, '').trim(),
      date: dateM?.[0],
    });
    if (items.length >= MAX_DETAILS + 4) break;
  }
  return items;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

export const sousou: SearchPlugin = {
  name: 'sousou',
  priority: 2,

  async search(keyword: string, _env: Env, ctx?): Promise<SearchResult[]> {
    try {
      const searchHtml = await fetchText(`${WEB}/search?q=${encodeURIComponent(keyword)}`, `${WEB}/`);
      const items = parseSearchPage(searchHtml);
      if (items.length === 0) return [];

      const results: SearchResult[] = [];
      for (const item of items) {
        if (results.length >= MAX_DETAILS) break;
        // 详情页消耗预算
        if (ctx?.budget && !ctx.budget.take()) break;

        let detailHtml: string;
        try {
          detailHtml = await fetchText(`${WEB}${item.docPath}`, `${WEB}/search?q=`);
        } catch {
          continue;
        }

        const links = extractLinks(decodeEntities(detailHtml));
        if (links.length === 0) continue;

        // 提取码兜底：页面明文写"提取码: xxxx"而链接没带 pwd 时补上
        const pwdM = decodeEntities(detailHtml).match(PWD_RE);
        const password = pwdM?.[1];
        const finalLinks = links.map((l) =>
          !l.password && password ? { ...l, password } : l,
        );

        const docId = item.docPath.replace('/doc/', '');
        results.push({
          unique_id: `sousou-${docId}`,
          source: 'sousou',
          title: item.title || docId,
          content: item.info.slice(0, 300),
          datetime: normalizeDate(item.date),
          links: finalLinks,
        });
      }
      return results;
    } catch {
      return [];
    }
  },
};
