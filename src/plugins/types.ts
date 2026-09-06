/**
 * 插件统一接口定义。
 *
 * 新增搜索源只需：
 *   1. 新建 src/plugins/{name}.ts 实现 SearchPlugin
 *   2. 在 registry.ts 注册
 */

import type { Env, SearchResult } from '../types';

export interface SearchPlugin {
  /** 插件名（也是 channel 名） */
  name: string;
  /** 展示用途的优先级，数字越小越靠前 */
  priority: number;
  /**
   * 执行搜索。必须自行容错：
   * - 失败时返回空数组而不是抛异常（调度器也会兜底）
   * - 可用 env.CACHE 做插件级缓存（如 buildId）
   */
  search(keyword: string, env: Env): Promise<SearchResult[]>;
}

/** 请求通用 UA（模拟浏览器，部分站点校验） */
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
