/**
 * 插件注册表 — 新增搜索源在这里加一行即可。
 */

import type { SearchPlugin } from './types';
import { apibay } from './apibay';
import { pansearch } from './pansearch';
import { quarkres } from './quarkres';
import { ikantv } from './ikantv';
import { meitizy } from './meitizy';
import { hunhepan } from './hunhepan';
import { quark4k } from './quark4k';
import { ouge } from './ouge';
import { cyg } from './cyg';
import { nyaa } from './nyaa';

export const PLUGINS: SearchPlugin[] = [
  apibay,
  pansearch,
  quarkres,
  ikantv,
  meitizy,
  hunhepan,
  quark4k,
  ouge,
  cyg,
  nyaa,
];

/** 所有可用 channel 名 */
export const CHANNELS = PLUGINS.map((p) => p.name);
