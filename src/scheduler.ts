/**
 * 并发调度器 — Promise.allSettled 跑全部插件，部分失败不影响整体。
 */

import type { Env, SearchResult } from './types';
import type { SearchContext, SearchPlugin } from './plugins/types';

export interface SchedulerOutcome {
  results: SearchResult[];
  sources: Record<string, number>;
  errors: string[];
  debug: string[];
}

/** 子请求预算：Workers 免费版 50 fetch/请求（KV 占 1-2），HTML 详情页共享 30 份额 */
function makeBudget(total: number): SearchContext['budget'] {
  let left = total;
  return {
    take(): boolean {
      if (left <= 0) return false;
      left--;
      return true;
    },
  };
}

export async function runSearch(
  plugins: SearchPlugin[],
  keyword: string,
  env: Env,
): Promise<SchedulerOutcome> {
  const debug: string[] = [];
  const ctx: SearchContext = { budget: makeBudget(30), debug };
  const settled = await Promise.allSettled(plugins.map((p) => p.search(keyword, env, ctx)));

  const results: SearchResult[] = [];
  const sources: Record<string, number> = {};
  const errors: string[] = [];

  settled.forEach((outcome, i) => {
    const plugin = plugins[i];
    if (outcome.status === 'fulfilled') {
      const list = outcome.value;
      sources[plugin.name] = list.length;
      results.push(...list);
    } else {
      sources[plugin.name] = 0;
      errors.push(`${plugin.name}: ${String(outcome.reason).slice(0, 200)}`);
      console.error(`[pansou-cf] plugin ${plugin.name} failed: ${outcome.reason}`);
    }
  });

  return { results, sources, errors, debug };
}

/** 按 unique_id 去重 */
export function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    if (seen.has(r.unique_id)) continue;
    seen.add(r.unique_id);
    out.push(r);
  }
  return out;
}
