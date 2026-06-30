import type {
  ExportBlock,
  ExportDocument,
  ExportInline,
  ExportListItem,
  ExportMark,
  ExportRenderOptions,
  ExportThemeTokens,
  WechatRenderResult,
} from '../model';
import { getExportThemeTokensFromAppTheme } from '../theme';
import { buildFontStack } from '../../fontStack';
import { escapeAttribute, escapeHtml, renderPlainText, resolveCalloutTitle, sanitizeHref, wrapMarks } from '../utils';

// ── 暗色主题检测：微信编辑器白底，暗色主题文字不可读 ──────
function ensureWechatSafeTheme(theme: ExportThemeTokens): ExportThemeTokens {
  const isDarkSurface = isDarkColor(theme.surface);
  const isDarkText = isDarkColor(theme.text);

  if (!isDarkSurface && !isDarkText) return theme;

  return {
    ...theme,
    surface: '#ffffff',
    surfaceMuted: '#faf8f5',
    text: '#2c2416',
    textMuted: '#5c5040',
    preBackground: '#f5f1eb',
    preForeground: '#2c2416',
    codeBackground: isDarkColor(theme.codeBackground) ? '#f3efe8' : theme.codeBackground,
    codeForeground: isDarkColor(theme.codeForeground) ? '#8b7355' : theme.codeForeground,
  };
}

function isDarkColor(hex: string): boolean {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return false;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

type SrcResolver = (src: string) => string;

export function renderWechatFragment(
  document: ExportDocument,
  options: ExportRenderOptions = {},
): WechatRenderResult {
  const rawTheme = options.tokens ?? getExportThemeTokensFromAppTheme(options.themeId || 'scholar-light');
  const theme = ensureWechatSafeTheme(rawTheme);
  const fontFamily = options.fontFamily
    ? buildFontStack(options.fontFamily)
    : "'Microsoft YaHei', 'PingFang SC', system-ui, -apple-system, 'Segoe UI', sans-serif";
  const fontSize = options.fontSize || 16;
  const imageMap = options.imageMap;
  const resolveSrc: SrcResolver = (src: string) => imageMap?.get(src) ?? src;
  const html = `<div style="${rootStyle(theme.text, fontFamily, fontSize, theme.surface)}">${document.blocks
    .map((block) => renderBlock(block, theme, fontSize, resolveSrc))
    .join('')}</div>`;

  return {
    html,
    text: renderPlainText(document),
  };
}

function renderBlock(
  block: ExportBlock,
  theme: ExportThemeTokens,
  fontSize: number,
  resolveSrc: SrcResolver,
): string {
  switch (block.kind) {
    case 'paragraph':
      return `<p style="margin:0 0 1.2em;line-height:1.8;color:${theme.text};font-size:${fontSize}px;">${renderInlines(block.inlines, theme, resolveSrc)}</p>`;
    case 'heading': {
      const headingSizes: Record<number, number> = { 1: 20, 2: 18, 3: 17, 4: 16, 5: 15, 6: 14 };
      const size = headingSizes[block.level] ?? 16;
      const border =
        block.level <= 2
          ? `border-${block.level === 1 ? 'bottom' : 'left'}:${block.level === 1 ? '3px solid' : '4px solid'} ${theme.accent};padding-${block.level === 1 ? 'bottom' : 'left'}:${block.level === 1 ? '8px' : '12px'};`
          : '';
      return `<h${block.level} style="margin:1.6em 0 0.8em;color:${theme.accentStrong};font-size:${size}px;line-height:1.5;font-weight:700;${border}">${renderInlines(block.inlines, theme, resolveSrc)}</h${block.level}>`;
    }
    case 'blockquote':
      return `<blockquote style="margin:1.4em 0;padding:16px 16px 12px;border-left:4px solid ${theme.accent};background:${theme.surfaceMuted};color:${theme.textMuted};">${block.blocks.map((child) => renderBlock(child, theme, fontSize, resolveSrc)).join('')}</blockquote>`;
    case 'bulletList':
      return `<ul style="margin:0 0 1.2em;padding-left:1.4em;">${block.items.map((item) => renderListItem(item, false, theme, fontSize, resolveSrc)).join('')}</ul>`;
    case 'orderedList': {
      const startAttr = block.start && block.start !== 1 ? ` start="${block.start}"` : '';
      return `<ol style="margin:0 0 1.2em;padding-left:1.4em;"${startAttr}>${block.items.map((item) => renderListItem(item, false, theme, fontSize, resolveSrc)).join('')}</ol>`;
    }
    case 'taskList':
      return `<ul style="margin:0 0 1.2em;padding-left:0;list-style:none;">${block.items.map((item) => renderListItem(item, true, theme, fontSize, resolveSrc)).join('')}</ul>`;
    case 'codeBlock': {
      // B2: 微信会剥离 data-* 属性，不再输出 data-lang
      return `<pre style="margin:1.4em 0;padding:14px 16px;border-radius:6px;background:${theme.preBackground};color:${theme.preForeground};font-size:14px;line-height:1.65;white-space:pre;overflow-x:auto;"><code>${escapeHtml(block.code)}</code></pre>`;
    }
    case 'table':
      return `<table style="width:100%;border-collapse:collapse;margin:1.4em 0;">${block.rows
        .map(
          (row) =>
            `<tr>${row.cells
              .map((cell) => {
                const tag = cell.kind === 'tableHeader' ? 'th' : 'td';
                const bg = cell.kind === 'tableHeader' ? theme.surfaceMuted : theme.surface;
                return `<${tag} style="border:1px solid ${theme.border};padding:8px 10px;background:${bg};text-align:left;vertical-align:top;">${cell.blocks
                  .map((child) => renderBlock(child, theme, fontSize, resolveSrc))
                  .join('')}</${tag}>`;
              })
              .join('')}</tr>`,
        )
        .join('')}</table>`;
    case 'mathBlock':
      // B7: 数学公式块加提示文案
      return `<div style="margin:1.4em 0;padding:12px 14px;border:1px solid ${theme.border};border-radius:6px;background:${theme.surfaceMuted};"><div style="margin-bottom:8px;color:${theme.textMuted};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">数学公式</div><pre style="margin:0;white-space:pre-wrap;color:${theme.text};font-size:14px;">${escapeHtml(block.latex)}</pre></div>`;
    case 'mermaidBlock':
      return `<div style="margin:1.4em 0;padding:12px 14px;border:1px solid ${theme.border};border-radius:6px;background:#ffffff;"><div style="margin-bottom:8px;color:${theme.textMuted};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Mermaid 图表源码</div><pre style="margin:0;white-space:pre-wrap;color:${theme.text};">${escapeHtml(block.source)}</pre></div>`;
    case 'callout': {
      const title = resolveCalloutTitle(block.calloutType, block.title);
      return `<div style="margin:1.4em 0;padding:12px 14px;border-left:4px solid ${theme.accent};background:${theme.surfaceMuted};border-radius:6px;"><div style="margin-bottom:8px;color:${theme.accentStrong};font-weight:700;">${escapeHtml(title)}</div>${block.blocks.map((child) => renderBlock(child, theme, fontSize, resolveSrc)).join('')}</div>`;
    }
    case 'horizontalRule':
      return `<hr style="border:none;border-top:1px solid ${theme.border};margin:1.6em 0;" />`;
  }
}

function renderListItem(
  item: ExportListItem,
  isTaskItem: boolean,
  theme: ExportThemeTokens,
  fontSize: number,
  resolveSrc: SrcResolver,
): string {
  const prefix = isTaskItem
    ? `<span style="display:inline-block;margin-right:8px;color:${theme.accentStrong};font-weight:700;">${item.checked ? '☑' : '☐'}</span>`
    : '';

  if (
    item.blocks.length === 1 &&
    (item.blocks[0].kind === 'paragraph' || item.blocks[0].kind === 'heading')
  ) {
    const block = item.blocks[0];
    const body = renderInlines(block.inlines, theme, resolveSrc);
    return `<li style="margin-bottom:8px;line-height:1.7;color:${theme.text};">${prefix}${body}</li>`;
  }

  return `<li style="margin-bottom:8px;color:${theme.text};">${prefix}${item.blocks
    .map((child) => renderBlock(child, theme, fontSize, resolveSrc))
    .join('')}</li>`;
}

function renderInlines(
  inlines: ExportInline[],
  theme: ExportThemeTokens,
  resolveSrc: SrcResolver,
): string {
  return inlines.map((inline) => renderInline(inline, theme, resolveSrc)).join('');
}

function renderInline(
  inline: ExportInline,
  theme: ExportThemeTokens,
  resolveSrc: SrcResolver,
): string {
  let content: string;

  switch (inline.kind) {
    case 'text':
      content = escapeHtml(inline.text);
      return wrapMarks(content, inline.marks, (inner, mark) => renderMark(inner, mark, theme));
    case 'hardBreak':
      return '<br />';
    case 'image':
      // C2: 图片 src 在 IR 渲染阶段直接替换为 base64
      content = `<img src="${escapeAttribute(resolveSrc(inline.src))}" alt="${escapeAttribute(inline.alt)}" style="max-width:100%;border-radius:8px;display:block;margin:12px auto;"${inline.title ? ` title="${escapeAttribute(inline.title)}"` : ''} />`;
      return wrapMarks(content, inline.marks, (inner, mark) => renderMark(inner, mark, theme));
    case 'mathInline':
      content = `<code style="padding:1px 4px;border-radius:4px;background:${theme.codeBackground};color:${theme.codeForeground};">${escapeHtml(inline.latex)}</code>`;
      return wrapMarks(content, inline.marks, (inner, mark) => renderMark(inner, mark, theme));
    case 'wikilink': {
      const label = inline.alias || inline.target;
      content = `<span style="color:${theme.accentStrong};border-bottom:1px dashed ${theme.accent};">${escapeHtml(label)}</span>`;
      return wrapMarks(content, inline.marks, (inner, mark) => renderMark(inner, mark, theme));
    }
  }
}

function renderMark(
  content: string,
  mark: ExportMark,
  theme: ExportThemeTokens,
): string {
  switch (mark.kind) {
    case 'bold':
      return `<strong>${content}</strong>`;
    case 'italic':
      return `<em>${content}</em>`;
    case 'strike':
      return `<span style="text-decoration:line-through;">${content}</span>`;
    case 'code':
      return `<code style="padding:1px 4px;border-radius:4px;background:${theme.codeBackground};color:${theme.codeForeground};">${content}</code>`;
    case 'highlight':
      return `<span style="background:${theme.highlightBg};padding:1px 2px;border-radius:3px;">${content}</span>`;
    case 'link': {
      const safeHref = sanitizeHref(mark.href);
      const titleAttr = mark.title ? ` title="${escapeAttribute(mark.title)}"` : '';
      if (safeHref === '#' || !safeHref) {
        return `<span style="color:${theme.accent};text-decoration:underline;"${titleAttr}>${content}</span>`;
      }
      return `<a href="${escapeAttribute(safeHref)}" style="color:${theme.accent};text-decoration:underline;"${titleAttr}>${content}</a>`;
    }
    case 'superscript':
      return `<span style="vertical-align:super;font-size:0.75em;">${content}</span>`;
    case 'subscript':
      return `<span style="vertical-align:sub;font-size:0.75em;">${content}</span>`;
  }
}

function rootStyle(text: string, fontFamily: string, fontSize: number, background: string): string {
  return [
    `font-family:${fontFamily}`,
    `color:${text}`,
    `font-size:${fontSize}px`,
    `background:${background}`,
    `padding:24px 20px`,
    `border-radius:8px`,
    `box-sizing:border-box`,
  ].join(';');
}
