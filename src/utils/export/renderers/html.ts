import type {
  ExportBlock,
  ExportDocument,
  ExportInline,
  ExportList,
  ExportListItem,
  ExportMark,
  ExportRenderOptions,
  ExportThemeTokens,
} from '../model';
import { getKatex } from '../../../components/Editor/tiptap/extensions/math-block';
import { getExportThemeTokensFromAppTheme } from '../theme';
import { buildFontStack } from '../../fontStack';
import { escapeAttribute, escapeHtml, mergeMetadataTitle, resolveCalloutTitle, sanitizeHref, wrapMarks } from '../utils';

type KatexModule = Awaited<ReturnType<typeof getKatex>>['default'];
type SrcResolver = (src: string) => string;

const identitySrc: SrcResolver = (src: string) => src;

let mermaidCounter = 0;

export async function renderHtmlDocument(
  document: ExportDocument,
  options: ExportRenderOptions = {},
): Promise<string> {
  const theme = getExportThemeTokensFromAppTheme(options.themeId || 'scholar-light');
  const title = mergeMetadataTitle(document.metadata, options.fileName ?? '');
  const metaTags = document.metadata.meta
    .map(
      (entry) =>
        `<meta name="${escapeAttribute(entry.name)}" content="${escapeAttribute(entry.content)}" />`,
    )
    .join('\n');
  const fontFamily = options.fontFamily
    ? buildFontStack(options.fontFamily)
    : "'Microsoft YaHei', 'PingFang SC', system-ui, -apple-system, 'Segoe UI', sans-serif";
  const fontSize = options.fontSize || 16;
  const imageMap = options.imageMap;
  const resolveSrc: SrcResolver = imageMap ? (src: string) => imageMap.get(src) ?? src : identitySrc;
  const katexModule: KatexModule | null = options.themeId ? await preloadKatex() : null;
  const body = await renderBlocks(document.blocks, 'html', katexModule, resolveSrc);

  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    metaTags,
    `<style>${getHtmlDocumentStyles(theme, fontFamily, fontSize)}</style>`,
    '</head>',
    '<body>',
    `<main class="ml-export-root">${body}</main>`,
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');
}

async function preloadKatex(): Promise<KatexModule | null> {
  try {
    return (await getKatex()).default;
  } catch {
    return null;
  }
}

export async function renderBlocks(
  blocks: ExportBlock[],
  target: 'html' | 'wechat',
  katexModule?: KatexModule | null,
  resolveSrc: SrcResolver = identitySrc,
): Promise<string> {
  const rendered = await Promise.all(blocks.map(block => renderBlock(block, target, katexModule, resolveSrc)));
  return rendered.join('');
}

async function renderBlock(
  block: ExportBlock,
  target: 'html' | 'wechat',
  katexModule?: KatexModule | null,
  resolveSrc: SrcResolver = identitySrc,
): Promise<string> {
  switch (block.kind) {
    case 'paragraph':
      return `<p class="ml-export-paragraph">${await renderInlines(block.inlines, target, katexModule, resolveSrc)}</p>`;
    case 'heading':
      return `<h${block.level} class="ml-export-heading ml-export-heading-${block.level}">${await renderInlines(block.inlines, target, katexModule, resolveSrc)}</h${block.level}>`;
    case 'blockquote':
      return `<blockquote class="ml-export-blockquote">${await renderBlocks(block.blocks, target, katexModule, resolveSrc)}</blockquote>`;
    case 'bulletList':
      return `<ul class="ml-export-list ml-export-list-bullet">${await renderListItems(block, target, katexModule, resolveSrc)}</ul>`;
    case 'orderedList': {
      const startAttr = block.start && block.start !== 1 ? ` start="${block.start}"` : '';
      return `<ol class="ml-export-list ml-export-list-ordered"${startAttr}>${await renderListItems(block, target, katexModule, resolveSrc)}</ol>`;
    }
    case 'taskList':
      return `<ul class="ml-export-list ml-export-task-list">${await renderListItems(block, target, katexModule, resolveSrc)}</ul>`;
    case 'codeBlock': {
      const language = block.language ? ` data-language="${escapeAttribute(block.language)}"` : '';
      return `<pre class="ml-export-code-block"${language}><code>${escapeHtml(block.code)}</code></pre>`;
    }
    case 'table': {
      const rows = await Promise.all(
        block.rows.map(async (row) => {
          const cells = await Promise.all(row.cells.map((cell) => renderTableCell(cell, katexModule, resolveSrc)));
          return `<tr>${cells.join('')}</tr>`;
        }),
      );
      return `<div class="ml-export-table-wrap"><table class="ml-export-table"><tbody>${rows.join('')}</tbody></table></div>`;
    }
    case 'mathBlock':
      return await renderMathBlock(block.latex, katexModule);
    case 'mermaidBlock':
      return await renderMermaidBlock(block.source);
    case 'callout': {
      const title = resolveCalloutTitle(block.calloutType, block.title);
      return `<aside class="ml-export-callout" data-callout-type="${escapeAttribute(block.calloutType)}"><div class="ml-export-callout-title">${escapeHtml(title)}</div><div class="ml-export-callout-body">${await renderBlocks(block.blocks, target, katexModule, resolveSrc)}</div></aside>`;
    }
    case 'horizontalRule':
      return '<hr class="ml-export-hr" />';
  }
}

async function renderListItems(
  block: ExportList,
  target: 'html' | 'wechat',
  katexModule?: KatexModule | null,
  resolveSrc: SrcResolver = identitySrc,
): Promise<string> {
  const rendered = await Promise.all(
    block.items.map(item => renderListItem(item, block.kind === 'taskList', target, katexModule, resolveSrc)),
  );
  return rendered.join('');
}

async function renderListItem(
  item: ExportListItem,
  isTaskItem: boolean,
  target: 'html' | 'wechat',
  katexModule?: KatexModule | null,
  resolveSrc: SrcResolver = identitySrc,
): Promise<string> {
  const body = await renderListItemBody(item.blocks, target, katexModule, resolveSrc);
  const checkbox = isTaskItem
    ? `<span class="ml-export-task-checkbox" aria-hidden="true">${item.checked ? '☑' : '☐'}</span>`
    : '';
  const checkedAttr = typeof item.checked === 'boolean' ? ` data-checked="${item.checked}"` : '';

  return `<li class="ml-export-list-item"${checkedAttr}>${checkbox}${body}</li>`;
}

async function renderListItemBody(
  blocks: ExportBlock[],
  target: 'html' | 'wechat',
  katexModule?: KatexModule | null,
  resolveSrc: SrcResolver = identitySrc,
): Promise<string> {
  if (blocks.length === 1 && (blocks[0].kind === 'paragraph' || blocks[0].kind === 'heading')) {
    const block = blocks[0];
    return `<span class="ml-export-list-item-inline">${await renderInlines(block.inlines, target, katexModule, resolveSrc)}</span>`;
  }

  return `<div class="ml-export-list-item-body">${await renderBlocks(blocks, target, katexModule, resolveSrc)}</div>`;
}

async function renderTableCell(
  cell: { kind: 'tableHeader' | 'tableCell'; blocks: ExportBlock[] },
  katexModule?: KatexModule | null,
  resolveSrc: SrcResolver = identitySrc,
): Promise<string> {
  const tag = cell.kind === 'tableHeader' ? 'th' : 'td';
  const body = (await Promise.all(cell.blocks.map((block) => renderBlockSync(block, katexModule, resolveSrc)))).join('');
  return `<${tag} class="ml-export-table-cell">${body}</${tag}>`;
}

async function renderBlockSync(
  block: ExportBlock,
  katexModule?: KatexModule | null,
  resolveSrc: SrcResolver = identitySrc,
): Promise<string> {
  switch (block.kind) {
    case 'paragraph':
      return `<p class="ml-export-paragraph">${await renderInlines(block.inlines, 'html', katexModule, resolveSrc)}</p>`;
    case 'heading':
      return `<p class="ml-export-table-heading">${await renderInlines(block.inlines, 'html', katexModule, resolveSrc)}</p>`;
    case 'blockquote': {
      const inner = (await Promise.all(block.blocks.map(b => renderBlockSync(b, katexModule, resolveSrc)))).join('');
      return `<blockquote class="ml-export-blockquote">${inner}</blockquote>`;
    }
    case 'bulletList': {
      const items = await Promise.all(
        block.items.map(async (item) => {
          const inner = (await Promise.all(item.blocks.map(b => renderBlockSync(b, katexModule, resolveSrc)))).join('');
          return `<li class="ml-export-list-item">${inner}</li>`;
        }),
      );
      return `<ul class="ml-export-list ml-export-list-bullet">${items.join('')}</ul>`;
    }
    case 'orderedList': {
      const startAttr = block.start && block.start !== 1 ? ` start="${block.start}"` : '';
      const items = await Promise.all(
        block.items.map(async (item) => {
          const inner = (await Promise.all(item.blocks.map(b => renderBlockSync(b, katexModule, resolveSrc)))).join('');
          return `<li class="ml-export-list-item">${inner}</li>`;
        }),
      );
      return `<ol class="ml-export-list ml-export-list-ordered"${startAttr}>${items.join('')}</ol>`;
    }
    case 'taskList': {
      const items = await Promise.all(
        block.items.map(async (item) => {
          const inner = (await Promise.all(item.blocks.map(b => renderBlockSync(b, katexModule, resolveSrc)))).join('');
          return `<li class="ml-export-list-item"><span class="ml-export-task-checkbox">${item.checked ? '☑' : '☐'}</span>${inner}</li>`;
        }),
      );
      return `<ul class="ml-export-list ml-export-task-list">${items.join('')}</ul>`;
    }
    case 'codeBlock':
      return `<pre class="ml-export-code-block"><code>${escapeHtml(block.code)}</code></pre>`;
    case 'table': {
      const rows = await Promise.all(
        block.rows.map(async (row) => {
          const cells = await Promise.all(row.cells.map((cell) => renderTableCell(cell, katexModule, resolveSrc)));
          return `<tr>${cells.join('')}</tr>`;
        }),
      );
      return `<table class="ml-export-table"><tbody>${rows.join('')}</tbody></table>`;
    }
    case 'mathBlock':
      return await renderMathBlock(block.latex, katexModule);
    case 'mermaidBlock':
      return renderMermaidFallback(block.source);
    case 'callout': {
      const inner = (await Promise.all(block.blocks.map(b => renderBlockSync(b, katexModule, resolveSrc)))).join('');
      const title = resolveCalloutTitle(block.calloutType, block.title);
      return `<aside class="ml-export-callout" data-callout-type="${escapeAttribute(block.calloutType)}"><div class="ml-export-callout-title">${escapeHtml(title)}</div><div class="ml-export-callout-body">${inner}</div></aside>`;
    }
    case 'horizontalRule':
      return '<hr class="ml-export-hr" />';
  }
}

async function renderInlines(
  inlines: ExportInline[],
  target: 'html' | 'wechat',
  katexModule?: KatexModule | null,
  resolveSrc: SrcResolver = identitySrc,
): Promise<string> {
  const results = await Promise.all(inlines.map((inline) => renderInline(inline, target, katexModule, resolveSrc)));
  return results.join('');
}

async function renderInline(
  inline: ExportInline,
  target: 'html' | 'wechat',
  katexModule?: KatexModule | null,
  resolveSrc: SrcResolver = identitySrc,
): Promise<string> {
  let content: string;

  switch (inline.kind) {
    case 'text':
      content = escapeHtml(inline.text);
      return wrapMarks(content, inline.marks, renderMark);
    case 'hardBreak':
      content = '<br />';
      return wrapMarks(content, inline.marks, renderMark);
    case 'image':
      // C2: 图片 src 在 IR 渲染阶段直接替换为 base64
      content = `<img class="ml-export-image" src="${escapeAttribute(resolveSrc(inline.src))}" alt="${escapeAttribute(inline.alt)}"${inline.title ? ` title="${escapeAttribute(inline.title)}"` : ''} />`;
      return wrapMarks(content, inline.marks, renderMark);
    case 'mathInline':
      content =
        target === 'wechat'
          ? `<code class="ml-export-inline-math-fallback">${escapeHtml(inline.latex)}</code>`
          : await renderInlineMath(inline.latex, katexModule);
      return wrapMarks(content, inline.marks, renderMark);
    case 'wikilink': {
      const label = inline.alias || inline.target;
      content = `<span class="ml-export-wikilink" role="link" data-wikilink="${escapeAttribute(inline.target)}" title="${escapeAttribute(inline.target)}">${escapeHtml(label)}</span>`;
      return wrapMarks(content, inline.marks, renderMark);
    }
  }
}

function renderMark(content: string, mark: ExportMark): string {
  switch (mark.kind) {
    case 'bold':
      return `<strong>${content}</strong>`;
    case 'italic':
      return `<em>${content}</em>`;
    case 'strike':
      return `<s>${content}</s>`;
    case 'code':
      return `<code>${content}</code>`;
    case 'highlight':
      return `<mark>${content}</mark>`;
    case 'link': {
      const titleAttr = mark.title ? ` title="${escapeAttribute(mark.title)}"` : '';
      return `<a href="${escapeAttribute(sanitizeHref(mark.href))}"${titleAttr}>${content}</a>`;
    }
    case 'superscript':
      return `<sup>${content}</sup>`;
    case 'subscript':
      return `<sub>${content}</sub>`;
  }
}

async function renderInlineMath(
  latex: string,
  katexModule?: KatexModule | null,
): Promise<string> {
  const katex = katexModule ?? (await getKatex()).default;
  return `<span class="ml-export-inline-math" data-latex="${escapeAttribute(latex)}">${katex.renderToString(
    latex,
    {
      displayMode: false,
      throwOnError: false,
      trust: false,
    },
  )}</span>`;
}

async function renderMathBlock(
  latex: string,
  katexModule?: KatexModule | null,
): Promise<string> {
  const katex = katexModule ?? (await getKatex()).default;
  return `<div class="ml-export-math-block" data-latex="${escapeAttribute(latex)}">${katex.renderToString(
    latex,
    {
      displayMode: true,
      throwOnError: false,
      trust: false,
    },
  )}</div>`;
}

async function renderMermaidBlock(source: string): Promise<string> {
  const svg = await renderMermaidSvg(source);
  if (svg) {
    return `<figure class="ml-export-mermaid" data-mermaid-source="${escapeAttribute(source)}">${svg}</figure>`;
  }

  return renderMermaidFallback(source);
}

async function renderMermaidSvg(source: string): Promise<string | null> {
  if (typeof document === 'undefined') {
    return null;
  }

  try {
    const mermaidModule = await import('mermaid');
    const mermaid = mermaidModule.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
    });
    const id = `solo-export-mermaid-${(mermaidCounter += 1)}`;
    const { svg } = await mermaid.render(id, source);
    return svg;
  } catch {
    return null;
  }
}

function renderMermaidFallback(source: string): string {
  return `<figure class="ml-export-mermaid-fallback" data-mermaid-source="${escapeAttribute(source)}"><figcaption>Mermaid 图表源码</figcaption><pre>${escapeHtml(source)}</pre></figure>`;
}

function getHtmlDocumentStyles(
  theme: ExportThemeTokens,
  fontFamily: string,
  fontSize: number,
): string {
  const isDark = isDarkColor(theme.surface);
  const colorScheme = isDark ? 'dark' : 'light';
  return `
    :root {
      color-scheme: ${colorScheme};
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      background: ${theme.surfaceMuted};
      color: ${theme.text};
      font-family: ${fontFamily};
    }
    .ml-export-root {
      width: min(880px, calc(100vw - 48px));
      margin: 32px auto;
      padding: 40px 48px;
      background: ${theme.surface};
      border-radius: 24px;
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
      font-size: ${fontSize}px;
    }
    .ml-export-root > :first-child {
      margin-top: 0;
    }
    .ml-export-root > :last-child {
      margin-bottom: 0;
    }
    .ml-export-heading {
      line-height: 1.25;
      margin: 1.8em 0 0.8em;
      color: ${theme.accentStrong};
      font-weight: 700;
    }
    .ml-export-heading-1 {
      font-size: 2.1rem;
      border-bottom: 3px solid ${theme.accent};
      padding-bottom: 0.4rem;
    }
    .ml-export-heading-2 {
      font-size: 1.6rem;
      border-left: 4px solid ${theme.accent};
      padding-left: 0.75rem;
    }
    .ml-export-heading-3,
    .ml-export-heading-4,
    .ml-export-heading-5,
    .ml-export-heading-6 {
      color: ${theme.accentSoft};
    }
    .ml-export-paragraph,
    .ml-export-list-item,
    .ml-export-table-cell,
    .ml-export-table-heading {
      line-height: 1.8;
      margin: 0 0 1em;
    }
    .ml-export-blockquote {
      margin: 1.5em 0;
      padding: 1em 1.2em;
      border-left: 4px solid ${theme.accent};
      background: ${theme.surfaceMuted};
      color: ${theme.textMuted};
    }
    .ml-export-list {
      padding-left: 1.4em;
      margin: 0 0 1.2em;
    }
    .ml-export-list-item {
      margin-bottom: 0.6em;
    }
    .ml-export-list-item-inline {
      display: inline;
    }
    .ml-export-task-list {
      list-style: none;
      padding-left: 0;
    }
    .ml-export-task-checkbox {
      display: inline-block;
      margin-right: 0.55em;
      color: ${theme.accentStrong};
      font-weight: 700;
    }
    .ml-export-code-block,
    .ml-export-mermaid-fallback pre {
      overflow-x: auto;
      padding: 16px 18px;
      border-radius: 10px;
      background: ${theme.preBackground};
      color: ${theme.preForeground};
      font-family: "SFMono-Regular", "JetBrains Mono", monospace;
      font-size: 0.92rem;
      line-height: 1.65;
      margin: 1.4em 0;
    }
    code {
      background: ${theme.codeBackground};
      color: ${theme.codeForeground};
      border-radius: 6px;
      padding: 0.15em 0.35em;
      font-family: "SFMono-Regular", "JetBrains Mono", monospace;
      font-size: 0.92em;
    }
    pre code {
      background: transparent;
      color: inherit;
      padding: 0;
    }
    .ml-export-table-wrap {
      overflow-x: auto;
      margin: 1.4em 0;
    }
    .ml-export-table {
      width: 100%;
      border-collapse: collapse;
    }
    .ml-export-table-cell {
      min-width: 120px;
      border: 1px solid ${theme.border};
      padding: 0.8em 0.95em;
      vertical-align: top;
    }
    th.ml-export-table-cell {
      background: ${theme.surfaceMuted};
      color: ${theme.accentStrong};
      text-align: left;
    }
    .ml-export-image {
      max-width: 100%;
      border-radius: 10px;
      display: inline-block;
      vertical-align: middle;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12);
    }
    .ml-export-callout {
      margin: 1.5em 0;
      padding: 1.1em 1.25em;
      border-radius: 14px;
      border: 1px solid ${theme.border};
      background: linear-gradient(135deg, ${theme.surfaceMuted}, ${theme.surface});
    }
    .ml-export-callout-title {
      font-weight: 700;
      color: ${theme.accentStrong};
      margin-bottom: 0.7em;
    }
    .ml-export-wikilink {
      color: ${theme.accentStrong};
      border-bottom: 1px dashed ${theme.accent};
      cursor: default;
    }
    .ml-export-inline-math,
    .ml-export-math-block {
      overflow-x: auto;
    }
    .ml-export-inline-math-fallback {
      white-space: nowrap;
    }
    .ml-export-math-block {
      margin: 1.5em 0;
      padding: 1.1em 1.25em;
      border-radius: 14px;
      background: ${theme.surfaceMuted};
    }
    .ml-export-mermaid,
    .ml-export-mermaid-fallback {
      margin: 1.5em 0;
      padding: 1.1em 1.25em;
      border: 1px solid ${theme.border};
      border-radius: 14px;
      background: ${theme.surface};
    }
    .ml-export-mermaid-fallback figcaption {
      color: ${theme.textMuted};
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 0.8em;
    }
    .ml-export-hr {
      border: 0;
      border-top: 1px solid ${theme.border};
      margin: 2em 0;
    }
    a {
      color: ${theme.accentStrong};
    }
    mark {
      background: ${theme.highlightBg};
      border-radius: 4px;
      padding: 0.08em 0.2em;
    }
    @media (max-width: 768px) {
      .ml-export-root {
        width: calc(100vw - 24px);
        margin: 12px auto;
        padding: 24px 18px;
        border-radius: 18px;
      }
    }
    @media print {
      .ml-export-root {
        width: 100%;
        margin: 0;
        padding: 0;
        border-radius: 0;
        box-shadow: none;
      }
      .ml-export-image {
        box-shadow: none;
      }
    }
  `;
}

function isDarkColor(hex: string): boolean {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return false;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}
