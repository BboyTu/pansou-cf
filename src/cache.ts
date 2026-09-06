/**
 * KV 缓存包装 — CACHE 绑定不存在时自动降级为直通（不缓存）。
 */

import type { Env } from './types';

const AGG_TTL = 3600; // 聚合结果缓存 1 小时

export async function getJSON<T>(env: Env, key: string): Promise<T | null> {
  if (!env.CACHE) return null;
  try {
    const raw = await env.CACHE.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function putJSON(env: Env, key: string, value: unknown, ttl = AGG_TTL): Promise<void> {
  if (!env.CACHE) return;
  try {
    await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl });
  } catch {
    // KV 写失败（超 1k/天 等）静默降级
  }
}

/** 聚合结果缓存 key */
export function aggKey(keyword: string, channels: string): string {
  return `r:agg:${channels}:${keyword}`;
}
