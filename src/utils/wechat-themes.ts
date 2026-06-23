/**
 * 微信导出主题配置
 *
 * 设计理念：与编辑器「书卷气」主色调同源，低饱和、暖棕系、留白充足。
 * 三套新主题按饱和度递进：素雅 → 书卷 → 暖杏，保留经典蓝作为通用备选。
 */

export interface WechatTheme {
  id: string;
  name: string;
  colors: {
    primary: string;       // 主色调（标题、链接）
    primaryDark: string;   // 主色深色
    primaryLight: string;  // 主色浅色
    text: string;          // 正文颜色
    textMuted: string;     // 次要文字颜色
    codeBg: string;        // 行内代码背景
    codeColor: string;     // 行内代码文字
    blockquoteBg: string;  // 引用背景
    blockquoteBorder: string; // 引用边框
    preBg: string;         // 代码块背景
    preColor: string;      // 代码块文字
    tableBorder: string;   // 表格边框
    tableHeaderBg: string; // 表头背景
  };
}

/**
 * 预设主题列表
 */
export const WECHAT_THEMES: WechatTheme[] = [
  // ── 书卷墨色（默认）─────────────────────────────────────
  // 直接复用编辑器主色调 #8b7355，导出后视觉与编辑器完全一致。
  // 适合学术/散文/随笔类内容，墨棕配色沉稳内敛。
  {
    id: 'scholar',
    name: '书卷墨色',
    colors: {
      primary: '#8b7355',
      primaryDark: '#6b5a3e',
      primaryLight: '#a08868',
      text: '#2c2416',
      textMuted: '#5c5040',
      codeBg: '#f3efe8',
      codeColor: '#8b7355',
      blockquoteBg: '#faf8f5',
      blockquoteBorder: '#8b7355',
      preBg: '#f5f1eb',
      preColor: '#2c2416',
      tableBorder: '#e4ddd2',
      tableHeaderBg: '#f5f1eb',
    },
  },

  // ── 素雅米白 ──────────────────────────────────────────
  // 极简风格，大量留白，色彩几乎融入背景。
  // 适合诗歌/极短篇/禅意类内容，干净到极致。
  {
    id: 'minimal',
    name: '素雅米白',
    colors: {
      primary: '#9a8e7e',
      primaryDark: '#7a7060',
      primaryLight: '#b0a494',
      text: '#333333',
      textMuted: '#999999',
      codeBg: '#f5f5f0',
      codeColor: '#666666',
      blockquoteBg: '#fafaf7',
      blockquoteBorder: '#d4cfc5',
      preBg: '#fafaf7',
      preColor: '#444444',
      tableBorder: '#eeebe5',
      tableHeaderBg: '#f8f7f4',
    },
  },

  // ── 暖杏书香 ──────────────────────────────────────────
  // 比书卷墨色更暖，带纸张泛黄的质感。
  // 适合怀旧/人文/生活美学类内容，温暖有厚度。
  {
    id: 'warm',
    name: '暖杏书香',
    colors: {
      primary: '#a07848',
      primaryDark: '#806038',
      primaryLight: '#c09860',
      text: '#2a2010',
      textMuted: '#6b5a42',
      codeBg: '#fef6ed',
      codeColor: '#a07848',
      blockquoteBg: '#fdf8ef',
      blockquoteBorder: '#c4a882',
      preBg: '#fdf8ef',
      preColor: '#2a2010',
      tableBorder: '#e8dfd0',
      tableHeaderBg: '#faf5ed',
    },
  },

  // ── 经典蓝（保留）──────────────────────────────────────
  // 高对比度技术风格，作为通用备选保留。
  // 部分用户偏好蓝色链接的公众号排版传统。
  {
    id: 'blue',
    name: '经典蓝',
    colors: {
      primary: '#3b82f6',
      primaryDark: '#1e40af',
      primaryLight: '#1e3a8a',
      text: '#333333',
      textMuted: '#6b7280',
      codeBg: '#f3f4f6',
      codeColor: '#ef4444',
      blockquoteBg: '#f9fafb',
      blockquoteBorder: '#d1d5db',
      preBg: '#1f2937',
      preColor: '#f9fafb',
      tableBorder: '#e5e7eb',
      tableHeaderBg: '#f3f4f6',
    },
  },
];

/**
 * 根据主题 ID 获取主题配置
 */
export function getThemeById(id: string): WechatTheme {
  return WECHAT_THEMES.find((t) => t.id === id) || WECHAT_THEMES[0];
}
