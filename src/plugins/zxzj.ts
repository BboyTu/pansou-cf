/**
 * zxzj 插件 — 因翅网盘（www.zxzj.run，原 zxzjys.com 已 301 迁移）。
 *
 * 流程: GET /vodsearch/-------------.html?wd={kw}&submit=
 *       → 解析 /voddetail/{id}.html（预算内最多 4 条）
 *       → 详情页 h3 线路标题（百度网盘/夸克/迅雷）对应的 /vodplay/ 播放页
 *       → 播放页 player_aaaa JSON 的 url 字段即网盘链接（带 ?pwd=）。
 * 移植自原版 zxzj.go，DOM 解析改为正则，子请求严格预算控制。
 */

import type { Env, SearchResult } from '../types';
import type { SearchPlugin } from './types';
import { extractLinks, normalizeDate } from './links';

const BASE = 'https://www.zxzj.run';
const UA_91 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const MAX_DETAILS = 4;
const MAX_PLAY_PER_DETAIL = 2;

/** 线路标题 → 是否网盘线路（播放线路1-9 是 m3u8，跳过） */
function isPanLine(title: string): boolean {
  return /百度|夸克|迅雷/.test(title);
}

async function fetchText(url: string, referer: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA_91,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: referer,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

interface SearchHit {
  id: string;
  detailPath: string;
  title: string;
}

/** 解析搜索页 /voddetail/{id}.html 链接 */
function parseSearchPage(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]*href="(\/voddetail\/(\d+)\.html)"[^>]*>([^<]{1,80})<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    hits.push({ id: m[2], detailPath: path, title: m[3].trim() });
    if (hits.length >= MAX_DETAILS) break;
  }
  return hits;
}

/** 详情页：找到网盘线路标题后紧随的 /vodplay/ 链接 */
function parsePanPlayPaths(html: string): string[] {
  const out: string[] = [];
  // 按 <h3 分段，段首是线路标题，段内是播放链接
  const segments = html.split(/<h3[^>]*>/).slice(1);
  for (const seg of segments) {
    const headEnd = seg.indexOf('</h3>');
    if (headEnd < 0) continue;
    const head = seg.slice(0, headEnd).replace(/<[^>]*>/g, '');
    if (!isPanLine(head)) continue;
    const playRe = /href="(\/vodplay\/[^"]+)"/g;
    let pm: RegExpExecArray | null;
    let taken = 0;
    while ((pm = playRe.exec(seg)) !== null && taken < MAX_PLAY_PER_DETAIL) {
      if (!out.includes(pm[1])) out.push(pm[1]);
      taken++;
    }
  }
  return out;
}

/** 播放页：提取 player_aaaa 的 url 字段 */
function parsePlayerUrl(html: string): string | undefined {
  const m = html.match(/var\s+player_aaaa\s*=\s*\{[^;]*?"url"\s*:\s*"([^"]*)"/);
  if (!m) return undefined;
  const url = m[1].replace(/\\\//g, '/').trim();
  return url || undefined;
}

export const zxzj: SearchPlugin = {
  name: 'zxzj',
  priority: 2,

  async search(keyword: string, _env: Env, ctx?): Promise<SearchResult[]> {
    try {
      const searchHtml = await fetchText(
        `${BASE}/vodsearch/-------------.html?wd=${encodeURIComponent(keyword)}&submit=`,
        BASE,
      );
      const hits = parseSearchPage(searchHtml);
      if (hits.length === 0) return [];

      const results: SearchResult[] = [];
      for (const hit of hits) {
        if (ctx?.budget && !ctx.budget.take()) break; // 详情页预算

        let detailHtml: string;
        try {
          detailHtml = await fetchText(`${BASE}${hit.detailPath}`, BASE);
        } catch {
          continue;
        }

        const playPaths = parsePanPlayPaths(detailHtml);
        const links = [];
        const seenUrls = new Set<string>();
        for (const playPath of playPaths) {
          if (links.length >= 3) break;
          if (ctx?.budget && !ctx.budget.take()) break; // 播放页预算
          let playHtml: string;
          try {
            playHtml = await fetchText(`${BASE}${playPath}`, `${BASE}${hit.detailPath}`);
          } catch {
            continue;
          }
          const panUrl = parsePlayerUrl(playHtml);
          if (!panUrl) continue;
          const found = extractLinks(panUrl);
          for (const l of found) {
            if (seenUrls.has(l.url)) continue;
            seenUrls.add(l.url);
            links.push(l);
          }
        }
        if (links.length === 0) continue;

        // 详情页简介（p.data 段）
        const desc = detailHtml.match(/<div class="stui-content__detail">([\s\S]*?)<\/div>/);
        const content = desc
          ? desc[1]
              .replace(/<[^>]*>/g, '\n')
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
              .join(' | ')
              .slice(0, 300)
          : hit.title;

        // 更新时间
        const timeM = detailHtml.match(/更新[：:]\s*(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?)/);

        results.push({
          unique_id: `zxzj-${hit.id}`,
          source: 'zxzj',
          title: hit.title,
          content,
          datetime: normalizeDate(timeM?.[1]),
          links,
        });
      }
      return results;
    } catch {
      return [];
    }
  },
};
