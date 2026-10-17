/**
 * 图标图源 —— 唯一真理源（设计规范化 2026-10-17 · 批 3 第 1 步）
 *
 * 来源：Lucide v1.58.0（https://lucide.dev，ISC License，可商用）
 * 规格：24×24 画布 / 线宽 2 / 圆头圆角 / currentColor —— 全部图标共用一组属性
 * 消费：`.vue` 用 `<Icon name="copy" :size="16" />`；`.ts` 用 `iconSvg('copy', 14)`
 * 为什么是字符串而不是纯 Vue 组件：代码块 / 公式 / 图表的按钮在 `.ts` 里 innerHTML 拼装，
 *   纯组件在那边用不了；一边组件一边字符串就是两套定义，日后必然漂移。
 * 新增图标：只在本文件加，**不要在使用处内联 `<svg>`**（内联即漂移，正是统一前的老毛病）。
 * 命名：键用语义名（close / bulletList / paragraph …），注释里标 Lucide 原始名便于日后更新。
 */

/** 所有图标共用的根属性 —— 规格的唯一出口（改线宽 / 端点只改这一处） */
export const ICON_PROPS = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
} as const;

/** 图标内容（不含 <svg> 外壳）。键 = 语义名 */
export const ICONS = {
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/> <circle cx="12" cy="12" r="3"/>',
  search: '<path d="m21 21-4.34-4.34"/> <circle cx="11" cy="11" r="8"/>',
  close: '<path d="M18 6 6 18"/> <path d="m6 6 12 12"/>',
  type: '<path d="M12 4v16"/> <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/> <path d="M9 20h6"/>',
  palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/> <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/> <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/> <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/> <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/> <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/> <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  bulletList: '<path d="M3 5h.01"/> <path d="M3 12h.01"/> <path d="M3 19h.01"/> <path d="M8 5h13"/> <path d="M8 12h13"/> <path d="M8 19h13"/>',
  removeFormatting: '<path d="M4 7V4h16v3"/> <path d="M5 20h6"/> <path d="M13 4 8 20"/> <path d="m15 15 5 5"/> <path d="m20 15-5 5"/>',
  trash: '<path d="M10 11v6"/> <path d="M14 11v6"/> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/> <path d="M3 6h18"/> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  upload: '<path d="M12 3v12"/> <path d="m17 8-5-5-5 5"/> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  maximize: '<path d="M15 3h6v6"/> <path d="m21 3-7 7"/> <path d="m3 21 7-7"/> <path d="M9 21H3v-6"/>',
  paragraph: '<path d="M13 4v16"/> <path d="M17 4v16"/> <path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>',
  heading1: '<path d="M4 12h8"/> <path d="M4 18V6"/> <path d="M12 18V6"/> <path d="m17 12 3-2v8"/>',
  heading2: '<path d="M4 12h8"/> <path d="M4 18V6"/> <path d="M12 18V6"/> <path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>',
  heading3: '<path d="M4 12h8"/> <path d="M4 18V6"/> <path d="M12 18V6"/> <path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/> <path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/>',
  orderedList: '<path d="M11 5h10"/> <path d="M11 12h10"/> <path d="M11 19h10"/> <path d="M4 4h1v5"/> <path d="M4 9h2"/> <path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"/>',
  taskList: '<rect width="18" height="18" x="3" y="3" rx="2"/> <path d="m16 9-5.5 5.5L8 12"/>',
  quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/> <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  code: '<path d="m16 18 6-6-6-6"/> <path d="m8 6-6 6 6 6"/>',
  divider: '<path d="M5 12h14"/>',
  table: '<path d="M12 3v18"/> <rect width="18" height="18" x="3" y="3" rx="2"/> <path d="M3 9h18"/> <path d="M3 15h18"/>',
  math: '<path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"/>',
  diagram: '<rect width="8" height="8" x="3" y="3" rx="2"/> <path d="M7 11v4a2 2 0 0 0 2 2h4"/> <rect width="8" height="8" x="13" y="13" rx="2"/>',
} as const;

export type IconName = keyof typeof ICONS;

const ATTR_STRING = Object.entries(ICON_PROPS)
  .map(([k, v]) => `${k}="${v}"`)
  .join(' ');

/** 生成完整 svg 字符串，供 `.ts` 侧 innerHTML 使用 */
export function iconSvg(name: IconName, size = 16): string {
  return `<svg ${ATTR_STRING} width="${size}" height="${size}">${ICONS[name]}</svg>`;
}
