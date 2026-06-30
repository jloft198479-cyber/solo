export type ExportRenderTarget = 'html' | 'wechat';
export type ExportFrontmatterValue = string | string[];

export interface ExportMetaTag {
  name: string;
  content: string;
}

export interface ExportMetadata {
  frontmatterRaw: string | null;
  frontmatter: Record<string, ExportFrontmatterValue>;
  title: string;
  meta: ExportMetaTag[];
}

export interface ExportDocument {
  kind: 'document';
  metadata: ExportMetadata;
  blocks: ExportBlock[];
}

export type ExportBlock =
  | ExportParagraph
  | ExportHeading
  | ExportBlockquote
  | ExportList
  | ExportCodeBlock
  | ExportTable
  | ExportMathBlock
  | ExportMermaidBlock
  | ExportCallout
  | ExportHorizontalRule;

export interface ExportParagraph {
  kind: 'paragraph';
  inlines: ExportInline[];
}

export interface ExportHeading {
  kind: 'heading';
  level: number;
  inlines: ExportInline[];
}

export interface ExportBlockquote {
  kind: 'blockquote';
  blocks: ExportBlock[];
}

export interface ExportList {
  kind: 'bulletList' | 'orderedList' | 'taskList';
  start?: number;
  items: ExportListItem[];
}

export interface ExportListItem {
  kind: 'listItem';
  checked?: boolean;
  blocks: ExportBlock[];
}

export interface ExportCodeBlock {
  kind: 'codeBlock';
  language: string | null;
  code: string;
}

export interface ExportTable {
  kind: 'table';
  rows: ExportTableRow[];
}

export interface ExportTableRow {
  kind: 'tableRow';
  cells: ExportTableCell[];
}

export interface ExportTableCell {
  kind: 'tableHeader' | 'tableCell';
  blocks: ExportBlock[];
}

export interface ExportMathBlock {
  kind: 'mathBlock';
  latex: string;
}

export interface ExportMermaidBlock {
  kind: 'mermaidBlock';
  source: string;
}

export interface ExportCallout {
  kind: 'callout';
  calloutType: string;
  title: string;
  blocks: ExportBlock[];
}

export interface ExportHorizontalRule {
  kind: 'horizontalRule';
}

export type ExportInline =
  | ExportText
  | ExportHardBreak
  | ExportImage
  | ExportMathInline
  | ExportWikilink;

export interface ExportText {
  kind: 'text';
  text: string;
  marks: ExportMark[];
}

export interface ExportHardBreak {
  kind: 'hardBreak';
  marks: ExportMark[];
}

export interface ExportImage {
  kind: 'image';
  src: string;
  alt: string;
  title: string | null;
  marks: ExportMark[];
}

export interface ExportMathInline {
  kind: 'mathInline';
  latex: string;
  marks: ExportMark[];
}

export interface ExportWikilink {
  kind: 'wikilink';
  target: string;
  alias: string;
  marks: ExportMark[];
}

export type ExportMark =
  | { kind: 'bold' }
  | { kind: 'italic' }
  | { kind: 'strike' }
  | { kind: 'code' }
  | { kind: 'highlight' }
  | { kind: 'link'; href: string; title: string | null }
  | { kind: 'superscript' }
  | { kind: 'subscript' };

export interface ExportThemeTokens {
  accent: string;
  accentStrong: string;
  accentSoft: string;
  text: string;
  textMuted: string;
  border: string;
  surface: string;
  surfaceMuted: string;
  codeBackground: string;
  codeForeground: string;
  preBackground: string;
  preForeground: string;
  highlightBg: string;
}

export interface ExportRenderOptions {
  themeId?: string;
  /** 预解析的导出色彩 tokens，优先于 themeId */
  tokens?: ExportThemeTokens;
  fileName?: string | null;
  /** 用户选择的编辑器字体，用于导出时同步字体 */
  fontFamily?: string;
  /** 用户选择的正文字号 (px)，用于导出时同步字号 */
  fontSize?: number;
  /** 本地图片 src → base64 data URL 的映射表。
   *  在 IR 渲染阶段直接替换 img.src，避免 HTML 字符串后替换的子串匹配风险。 */
  imageMap?: Map<string, string>;
}

export interface WechatRenderResult {
  html: string;
  text: string;
}
