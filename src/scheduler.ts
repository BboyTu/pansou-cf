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

/**
 * 插件熔断器（借鉴 PanHub pluginHealth 思路，2026-09-07）。
 *
 * - 连续失败 ≥ FAIL_THRESHOLD → 熔断 COOLDOWN_MS，期间跳过该插件（省预算提速）
 * - 冷却到期自动恢复放行（半开），成功即清零；继续失败则再次熔断
 * - 状态存模块级 Map（Workers 隔离实例级，无需 KV）；显式指定 channels 时可绕过
 */
const FAIL_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60_000;

interface CircuitState {
  fails: number;
  openUntil: number;
}
const circuit = new Map<string, CircuitState>();

function recordFailure(name: string): void {
  const st = circuit.get(name) ?? { fails: 0, openUntil: 0 };
  st.fails += 1;
  if (st.fails >= FAIL_THRESHOLD) {
    st.openUntil = Date.now() + COOLDOWN_MS;
    st.fails = 0;
  }
  circuit.set(name, st);
}

function recordSuccess(name: string): void {
  circuit.delete(name);
}

function isOpen(name: string): boolean {
  const st = circuit.get(name);
  return !!st && st.openUntil > Date.now();
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

/**
 * 无效链接过滤 — 标题/正文带"分享已取消/链接失效"等字样的结果直接丢弃。
 * 借鉴 my-pansou 的关键词过滤思路（2026-09-07）。
 */
const INVALID_CONTENT_RE =
  /该分享已被取消|分享已被取消|分享已取消|分享的文件已经被取消|链接已失效|分享链接已失效|该链接无法访问|此内容因违规无法|该内容无法查看|文件已经被删除|你访问的页面不存在/;

function filterInvalid(list: SearchResult[]): SearchResult[] {
  return list.filter((r) => {
    const text = `${r.title ?? ''} ${r.content ?? ''}`;
    return !INVALID_CONTENT_RE.test(text);
  });
}

export async function runSearch(
  plugins: SearchPlugin[],
  keyword: string,
  env: Env,
  opts?: { skipCircuit?: boolean; deadlineMs?: number },
): Promise<SchedulerOutcome> {
  const debug: string[] = [];

  // 熔断跳过（显式 channels 指定时绕过，便于调试）
  const active = opts?.skipCircuit
    ? plugins
    : plugins.filter((p) => {
        if (!isOpen(p.name)) return true;
        debug.push(`circuit-open: ${p.name} skipped`);
        return false;
      });

  const results: SearchResult[] = [];
  const sources: Record<string, number> = {};
  const errors: string[] = [];
  const done = new Set<string>();
  let timedOut = false;

  // 被熔断跳过的插件也在 sources 里占位为 0（保持渠道数稳定）
  for (const p of plugins) sources[p.name] = 0;

  const budget = makeBudget(30);
  const ctxFor = (name: string): SearchContext => ({
    budget,
    debug,
    fail: (reason?: string) => {
      recordFailure(name);
      if (reason) debug.push(`circuit-fail: ${name} ${reason}`);
    },
  });

  // 插件各自完成后立即写入结果（软截止时间到达时已完成的自然保留）
  const tasks = active.map(async (p) => {
    try {
      const list = filterInvalid(await p.search(keyword, env, ctxFor(p.name)));
      sources[p.name] = list.length;
      results.push(...list);
      done.add(p.name);
      if (list.length > 0) recordSuccess(p.name);
    } catch (e) {
      sources[p.name] = 0;
      done.add(p.name);
      recordFailure(p.name);
      errors.push(`${p.name}: ${String(e).slice(0, 200)}`);
      console.error(`[pansou-cf] plugin ${p.name} failed: ${e}`);
    }
  });

  // 软截止：慢源不再拖累整体响应（原版 PanSou 的"尽快响应"思路）
  // 超时后未完成的插件被记录并从结果中排除，请求结束后其后续动作随响应一起结束。
  const deadlineMs = opts?.deadlineMs ?? 0;
  if (deadlineMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, deadlineMs);
    });
    await Promise.race([Promise.all(tasks), timeout]);
    if (timer) clearTimeout(timer);
    if (timedOut) {
      const pending = active.filter((p) => !done.has(p.name)).map((p) => p.name);
      if (pending.length > 0) debug.push(`deadline ${deadlineMs}ms hit, pending: ${pending.join(',')}`);
    }
  } else {
    await Promise.all(tasks);
  }

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
