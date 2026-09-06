/**
 * HTML 站点配置表 — 首批 10 个活源。
 * 加新站点：复制一份配置改 4 个字段（name/base/searchUrl/hrefRe）即可。
 */

import type { HtmlSiteConfig } from './engine';

/** AppleCMS 模板站（muou/zhizhen/duoduo/erxiao 共用同一套搜索路由与详情路径） */
function appleCms(name: string, base: string, maxDetail?: number): HtmlSiteConfig {
  return {
    name,
    base,
    searchUrl: `${base}/index.php/vod/search/wd/{kw}.html`,
    hrefRe: /\/vod\/detail\/id\/\d+\.html/,
    maxDetail,
  };
}

export const HTML_SITES: HtmlSiteConfig[] = [
  // muou(muoua.top) / hdmoli(hdmoli.com)：本机可达但源站拦截 CF 数据中心出口 IP，fetch 直接失败，故不启用
  // xiaozhang(xzys.fun)：详情页 302 到 binhd.com（域名已废）
  // leso(leso.cc)：Discuz 搜索页对 CF 出口返回空壳页，无法提取
  appleCms('zhizhen', 'http://www.miqk.cc'),
  appleCms('duoduo', 'https://tv.yydsys.top'),
  appleCms('erxiao', 'https://www.wexwp.cc'),
  {
    // 高清888：详情 href 形如 /123/detail
    name: 'gaoqing888',
    base: 'https://www.gaoqing888.com',
    searchUrl: 'https://www.gaoqing888.com/search?kw={kw}',
    hrefRe: /\/\d+\/detail/,
    maxDetail: 3,
  },
];
