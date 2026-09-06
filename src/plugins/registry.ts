/**
 * 插件注册表 — 新增搜索源在这里加一行即可。
 */

import type { SearchPlugin } from './types';
import { apibay } from './apibay';
import { pansearch } from './pansearch';

export const PLUGINS: SearchPlugin[] = [apibay, pansearch];

/** 所有可用 channel 名 */
export const CHANNELS = PLUGINS.map((p) => p.name);
