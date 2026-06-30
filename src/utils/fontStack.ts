/**
 * 字体栈构建工具
 *
 * 统一编辑器和导出端的 font-family 生成逻辑，避免多处硬编码。
 * 编辑器和导出端共享同一套 fallback 链。
 */

/** 衬线 fallback：优先中文字体，再西文衬线 */
const SERIF_FALLBACK =
  "'Source Han Serif SC', 'STSong', 'Songti SC', 'SimSun', Georgia, 'Times New Roman', serif";

/** 无衬线 fallback：优先中文字体，再西文无衬线 */
const SANS_FALLBACK =
  "'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'STHeiti', system-ui, -apple-system, 'Segoe UI', sans-serif";

/** 仿宋 fallback */
const FANGSONG_FALLBACK = "'FangSong', 'STFangsong', 'Source Han Serif SC', Georgia, serif";

/** 明朝 fallback */
const MINCHO_FALLBACK =
  "'Huiwen-mincho', 'Source Han Serif SC', 'STSong', Georgia, 'Times New Roman', serif";

/**
 * 根据用户选择的字体生成完整的 font-family 栈。
 *
 * 此函数被编辑器（useEditorAppearance）和导出端（wechat/html 渲染器）共享，
 * 确保编辑器中看到的字体效果与导出结果一致。
 *
 * @param primary - 用户选择的字体 CSS 名称（对应 FONT_OPTIONS 中的 value）
 * @returns 完整的 CSS font-family 值
 */
export function buildFontStack(primary: string): string {
  // 无衬线字体
  if (primary === 'Microsoft YaHei UI') {
    return `'${primary}', ${SANS_FALLBACK}`;
  }
  // system-ui 是 CSS 关键字，不能加引号
  if (primary === 'system-ui') {
    return `system-ui, ${SANS_FALLBACK}`;
  }
  // 仿宋
  if (primary === 'Zhuque Fangsong') {
    return `'${primary}', ${FANGSONG_FALLBACK}`;
  }
  // 明朝
  if (primary === 'Huiwen-mincho') {
    return `'${primary}', ${MINCHO_FALLBACK}`;
  }
  // 手写/圆体 → 无衬线兜底
  if (primary === 'Xiaolai SC') {
    return `'${primary}', ${SANS_FALLBACK}`;
  }
  // 霞鹜文楷 → 楷体 fallback
  if (primary === 'LXGW WenKai') {
    return `'${primary}', 'Kaiti SC', 'STKaiti', 'KaiTi', ${SANS_FALLBACK}`;
  }
  // 默认：思源宋体等衬线字体
  return `'${primary}', ${SERIF_FALLBACK}`;
}
