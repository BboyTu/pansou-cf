/**
 * 共享工具：从任意文本中提取网盘/磁力链链接。
 * 移植自原版 pansearch/ouge/cyg 插件的链接识别正则。
 */

import type { LinkType, SearchLink } from '../types';

/** 常见网盘链接模式（type + 正则） */
export const PAN_LINK_PATTERNS: Array<[LinkType, RegExp]> = [
  ['quark', /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/g],
  ['uc', /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(?:\?[^"'\s<]*)?/g],
  ['baidu', /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]+(?:\?pwd=[0-9a-zA-Z]+)?/g],
  ['aliyun', /https?:\/\/(?:www\.)?(?:aliyundrive\.com|alipan\.com)\/s\/[0-9a-zA-Z]+/g],
  ['xunlei', /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_-]+(?:\?pwd=[0-9a-zA-Z]+)?/g],
  ['tianyi', /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/g],
  ['115', /https?:\/\/115\.com\/s\/[0-9a-zA-Z]+/g],
  ['mobile', /https?:\/\/caiyun\.feixin\.10086\.cn\/[0-9a-zA-Z]+/g],
  ['123', /https?:\/\/123pan\.com\/s\/[0-9a-zA-Z]+/g],
  ['pikpak', /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z]+/g],
  ['magnet', /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/g],
  ['ed2k', /ed2k:\/\/\|file\|[^|]+\|\d+\|[0-9a-fA-F]{32}\|\//g],
];

/** 从 URL 提取 ?pwd= 参数 */
export function pwdFromUrl(url: string): string | undefined {
  const m = url.match(/[?&]pwd=([0-9a-zA-Z]+)/);
  return m ? m[1] : undefined;
}

/** 去重 + 提取密码，返回结构化链接列表 */
export function extractLinks(text: string): SearchLink[] {
  if (!text) return [];
  const seen = new Set<string>();
  const links: SearchLink[] = [];
  for (const [type, re] of PAN_LINK_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const url = m[0];
      const key = `${type}:${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const password = pwdFromUrl(url);
      links.push({ type, url, ...(password ? { password } : {}) });
    }
  }
  return links;
}

/** 清理 HTML 标签 + 常见实体 */
export function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** 归一化 datetime：无法解析则原样返回 */
export function normalizeDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : new Date(t).toISOString();
}
