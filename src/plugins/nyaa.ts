/**
 * nyaa 插件 — nyaa.si（动漫/影视种子站，HTML 表格解析）。
 *
 * 端点: GET https://nyaa.si/?f=0&c=0_0&q={kw}
 * 解析: 每行 <tr> 提取 /view/{id}、标题、magnet 链接、大小、做种数。
 */

import type { Env, LinkType, SearchResult } from '../types';
import type { SearchPlugin } from './types';

const SITE = 'https://nyaa.si';

export const nyaa: SearchPlugin = {
  name: 'nyaa',
  priority: 3,

  async search(keyword: string, _env: Env, ctx?): Promise<SearchResult[]> {
    try {
      const url = `${SITE}/?f=0&c=0_0&q=${encodeURIComponent(keyword)}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'pansou-cf/0.04', Accept: 'text/html' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        // 源站屏蔽 CF 数据中心 IP（v0.04 确认），主动上报供熔断器计数
        ctx?.fail(`HTTP ${resp.status}`);
        return [];
      }

      const html = await resp.text();
      const out: SearchResult[] = [];
      // 每个结果行: <tr> ... /view/{id} ... title ... magnet:... ... size ... seeders ...
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
      const viewRe = /href="\/view\/(\d+)"/;
      const magnetRe = /href="(magnet:\?xt=urn:btih:[^"]+)"/;
      const titleRe = /title="([^"]+)"/;
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;

      let row: RegExpExecArray | null;
      while ((row = rowRe.exec(html)) !== null) {
        const rowHtml = row[1];
        const vm = rowHtml.match(viewRe);
        const mm = rowHtml.match(magnetRe);
        if (!vm || !mm) continue;

        const id = vm[1];
        const magnet = mm[1].replace(/&amp;/g, '&');

        // 取各单元格: 分类 | 名称链接 | 评论? | 时间 | 大小 | 做种 | 下载 | 完成
        const tds: string[] = [];
        let td: RegExpExecArray | null;
        tdRe.lastIndex = 0;
        while ((td = tdRe.exec(rowHtml)) !== null) tds.push(td[1].replace(/<[^>]*>/g, '').trim());

        let title = '';
        const tm = rowHtml.match(titleRe);
        if (tm) title = tm[1];
        else {
          // 回退：取含 /view/ 的 <a> 文本
          const am = rowHtml.match(/<a[^>]*href="\/view\/\d+"[^>]*>([\s\S]*?)<\/a>/);
          title = am ? am[1].replace(/<[^>]*>/g, '').trim() : '';
        }
        if (!title) continue;

        const size = tds.find((t) => /^\d+(\.\d+)?\s?(KB|MB|GB|TB|B)$/i.test(t)) ?? '';
        const seedersMatch = tds.find((t) => /^\d+/.test(t) && t !== size);

        out.push({
          unique_id: `nyaa-${id}`,
          source: 'nyaa',
          title,
          datetime: tds.find((t) => /\d{4}-\d{2}-\d{2}/.test(t)),
          size: size || undefined,
          hot: parseInt(seedersMatch ?? '0', 10) || 0,
          links: [{ type: 'magnet' as LinkType, url: magnet }],
        });
        if (out.length >= 60) break;
      }
      return out;
    } catch (e) {
      ctx?.fail(String(e).slice(0, 80));
      return [];
    }
  },
};
