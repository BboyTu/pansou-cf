/**
 * pansou-cf 共享类型（兼容 PanSou /api/search 协议）
 */

/**
 * Workers 环境绑定。KV 缓存命名空间。
 */
export interface Env {
  CACHE?: KVNamespace;
  ENV?: string;
  VERSION?: string;
}

/**
 * 网盘链接类型（与原版 PanSou 支持的 type 对齐）
 */
export type LinkType =
  | 'quark'
  | 'uc'
  | 'baidu'
  | 'aliyun'
  | 'xunlei'
  | 'tianyi'
  | '115'
  | '123'
  | 'mobile'
  | 'pikpak'
  | 'magnet'
  | 'ed2k'
  | 'others';

/**
 * 单条网盘链接
 */
export interface SearchLink {
  type: LinkType;
  url: string;
  password?: string;
}

/**
 * 搜索结果条目
 */
export interface SearchResult {
  /** 全局唯一 ID，格式：{plugin}-{native_id} */
  unique_id: string;
  /** 来源插件名 */
  source: string;
  title: string;
  content?: string;
  /** ISO 8601，可为空 */
  datetime?: string;
  /** 人类可读大小（磁力链源用） */
  size?: string;
  /** 热度（做种数/热度值，用于排序展示） */
  hot?: number;
  /** 来源频道名（TG 源用，网盘插件源可空） */
  channel?: string;
  /** 标签 */
  tags?: string[];
  links: SearchLink[];
}

/**
 * 按网盘类型合并的结果项（pansou-web 前端展示用）
 */
export interface MergedResultItem {
  url: string;
  password?: string;
  note: string;
  datetime?: string;
  source?: string;
}

/**
 * /api/search 响应体（兼容 PanSou 协议）
 */
export interface SearchResponse {
  code: number;
  message: string;
  data: {
    total: number;
    results: SearchResult[];
    /** 按网盘类型合并的链接视图（pansou-web 前端依赖） */
    merged_by_type?: Record<string, MergedResultItem[]>;
    /** 本次来自缓存的渠道（调试用） */
    cached?: boolean;
    /** 各渠道结果数（调试用） */
    sources?: Record<string, number>;
  };
}
