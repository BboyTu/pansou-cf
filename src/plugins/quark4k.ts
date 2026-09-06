/**
 * quark4k 插件 — quark4k.com（Flarum 论坛 API，夸克 4K 资源）。
 *
 * 端点: GET https://quark4k.com/api/discussions?include=firstPost,mostRelevantPost&filter[q]={kw}&page[offset]=0&page[limit]=50
 * 注意: 帖子正文在 attributes.contentHtml（content 为空），从 HTML 里提取网盘链接。
 */

import type { Env, SearchResult } from '../types';
import type { SearchPlugin } from './types';
import { extractLinks, pwdFromUrl } from './links';

const API = 'https://quark4k.com/api/discussions';

interface FlarumPost {
  type: string;
  id: string;
  attributes?: { content?: string; contentHtml?: string };
}

interface FlarumDiscussion {
  type: string;
  id: string;
  attributes?: { title?: string; createdAt?: string };
  relationships?: {
    mostRelevantPost?: { data?: { id?: string } };
    firstPost?: { data?: { id?: string } };
  };
}

export const quark4k: SearchPlugin = {
  name: 'quark4k',
  priority: 3,

  async search(keyword: string, _env: Env): Promise<SearchResult[]> {
    try {
      const url =
        `${API}?include=firstPost,mostRelevantPost` +
        `&filter[q]=${encodeURIComponent(keyword)}` +
        `&page[offset]=0&page[limit]=50`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'pansou-cf/0.04',
          Accept: 'application/json, text/plain, */*',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) return [];

      const body = (await resp.json()) as { data?: FlarumDiscussion[]; included?: FlarumPost[] };
      if (!Array.isArray(body.data)) return [];

      const posts = new Map<string, FlarumPost>();
      for (const inc of body.included ?? []) {
        if (inc.type === 'posts') posts.set(inc.id, inc);
      }

      const out: SearchResult[] = [];
      for (const d of body.data) {
        if (d.type !== 'discussions') continue;
        const title = d.attributes?.title ?? '';
        if (!title) continue;

        // 汇总关联帖子（firstPost + mostRelevantPost）的正文
        const rel = d.relationships ?? {};
        const postIds = [rel.firstPost?.data?.id, rel.mostRelevantPost?.data?.id].filter(
          (x): x is string => !!x,
        );
        const text = postIds
          .map((id) => {
            const p = posts.get(id);
            return p ? `${p.attributes?.contentHtml ?? ''}\n${p.attributes?.content ?? ''}` : '';
          })
          .join('\n');

        const allLinks = extractLinks(`${title}\n${text}`);
        // 原版是夸克资源站：优先保留夸克链接，没有再保留其他类型
        const links = allLinks.filter((l) => l.type === 'quark');
        const picked = links.length > 0 ? links : allLinks;
        if (picked.length === 0) continue;

        for (const l of picked) {
          const pwd = pwdFromUrl(l.url);
          if (pwd && !l.password) l.password = pwd;
        }

        out.push({
          unique_id: `quark4k-${d.id}`,
          source: 'quark4k',
          title,
          datetime: d.attributes?.createdAt,
          content: undefined,
          links: picked,
        });
      }
      return out;
    } catch {
      return [];
    }
  },
};
