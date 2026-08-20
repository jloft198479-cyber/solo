/**
 * 粘贴处理 —— 「默认流程 + 管道钩子」范式
 *
 * 设计原则：信任 ProseMirror 默认粘贴流程（上下文感知、Slice 合并），
 * 只在必要环节加管道钩子做增量改写，避免 handlePaste 全接管。
 *
 * 四层架构：
 * Layer 0  默认管道（ProseMirror 内置）
 *          - HTML 路径：clipboardParser (DOMParser, schema 感知)
 *          - 纯文本路径：clipboardTextParser 钩子（Layer 1）
 *          - 上下文感知插入（代码块自动纯文本、列表自动合并）
 *
 * Layer 1  clipboardTextParser 钩子
 *          - 触发：走纯文本路径时（text/html 缺失或不可用）
 *          - 职责：识别结构化 Markdown 源 → 解析为 Slice
 *          - 保留默认上下文感知插入
 *
 * Layer 2  transformPasted 钩子
 *          - 触发：所有粘贴路径（HTML 和纯文本都会过）
 *          - 职责：装饰性 HTML 塌方时，从 slice.textContent 反查 Markdown 源救回
 *
 * Layer 3  handlePaste 逃生舱（图片 + 来源嗅探）
 *          - 触发：剪贴板含图片文件 或 text/plain + text/html 同时存在时嗅探专有语法
 *          - 职责：图片异步落盘、markdown 专有语法嗅探接管
 *
 * Layer 4  handlePaste 异步系统剪贴板 fallback（占位升级模式）
 *          - 触发：text/html 不可用（WebView2 常见），text/plain 存在且非 markdown，
 *            且非代码块上下文（code 上下文默认流程已按纯文本处理）
 *          - 模式：复刻默认插入（PM 预解析 slice，多行=多段落）→ 异步读 Rust 系统剪贴板
 *            → 成功则把占位内容原地升级为富格式
 *          - 失败降级：保留占位（= 默认粘贴结果，绝不降级）
 */
import { Extension } from '@tiptap/vue-3';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DOMParser as PMDOMParser, Slice } from '@tiptap/pm/model';
import type { Schema } from '@tiptap/pm/model';

import { parseMarkdown } from '../markdown/parser';
import { authorizeImageAsset, saveClipboardImage } from '../../../../services/tauri/document';
import { confirm } from '../../../../services/tauri/dialog';
import { readClipboardHtml } from '../../../../services/tauri/clipboard';

// 递增粘贴请求 ID，用于防 async 后发先至乱序
let nextPasteId = 0;

/** 检测剪贴板中是否包含图片文件 */
function hasClipboardImage(clipboard: DataTransfer): boolean {
  if (!clipboard.files) return false;
  // 检查 clipboardData.files 中是否有图片
  for (let i = 0; i < clipboard.files.length; i++) {
    if (clipboard.files[i]?.type.startsWith('image/')) return true;
  }
  return false;
}

/** 从剪贴板读取第一张图片为 data URL */
function readClipboardImageAsDataUrl(clipboard: DataTransfer): Promise<string | null> {
  return new Promise((resolve) => {
    if (!clipboard.files) { resolve(null); return; }
    for (let i = 0; i < clipboard.files.length; i++) {
      const file = clipboard.files[i];
      if (!file || !file.type.startsWith('image/')) continue;

      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
      return;
    }
    resolve(null);
  });
}

/** 在编辑器中插入图片节点（相对路径），包在段落里作为独立 Block */
function insertImageNode(editorView: any, src: string, alt: string) {
  const schema = editorView.state.schema;
  const imgNode = schema.nodes.image?.create({ src, alt });
  if (!imgNode) return;

  const paragraph = schema.nodes.paragraph.create(null, imgNode);
  const tr = editorView.state.tr.replaceSelectionWith(paragraph);
  editorView.dispatch(tr);
}

/**
 * 粗判一段文本是否为 GFM 表格：第一行是表头（含 `|`），第二行是分隔行
 * （每个单元格形如 `---` / `:--` / `--:` / `:-:`）。普通文本几乎不会出现这种
 * 第二行模式，足以作为「是否尝试转换」的门槛；真正的解析交给 parseMarkdown。
 */
export function looksLikeMarkdownTable(text: string): boolean {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return false;

  if (!lines[0].includes('|')) return false;

  const sepCells = lines[1]
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|');
  if (sepCells.length === 0) return false;
  return sepCells.every((cell) => /^\s*:?-+:?\s*$/.test(cell));
}

/**
 * 粗判是否为结构化 Markdown 源码（存在明确的块级语法）。
 * 用于 handlePaste 的门槛过滤，避免对纯文本段落做无谓的解析。
 *
 * 命中条件（任一即可）：
 * - 至少一行 ATX 标题
 * - 至少一行块引用
 * - 至少一行代码围栏
 * - 至少两行列表项（无序/有序/任务）
 */
export function looksLikeMarkdownSource(text: string): boolean {
  const lines = text.split(/\r?\n/);
  let listCount = 0;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (/^#{1,6}\s/.test(t)) return true;
    if (/^>\s/.test(t)) return true;
    if (/^```/.test(t)) return true;
    // frontmatter 定界符 —— 单独成行时才触发，避免误伤正文中的 ---
    if (/^---$/.test(t) && text.trim().startsWith('---')) return true;
    // 数学块标记
    if (/^\$\$$/.test(t)) return true;
    if (/^\s*[-*+]\s/.test(t) || /^\s*\d+\.\s/.test(t) || /^\s*\[[ x]\]\s/.test(t)) {
      listCount++;
      if (listCount >= 2) return true;
    }
  }

  return false;
}

/**
 * 检测 text/plain 中是否包含 markdown 专有语法——这些标记在 HTML 渲染后必然丢失，
 * 只可能来自 markdown 编辑器的原始源码（如 Obsidian、Typora）。
 *
 * 用于粘贴来源嗅探：当 text/plain 和 text/html 同时存在时，
 * 如果 text/plain 含有这些标记，说明来源是 markdown 编辑器，应走 markdown 解析；
 * 否则走 HTML 放行给 ProseMirror DOMParser。
 */
export function hasMarkdownOnlySyntax(text: string): boolean {
  const lines = text.split(/\r?\n/);

  // frontmatter：文本以 --- 开头
  if (lines[0]?.trim() === '---') return true;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    // $$ 数学块（独占一行）
    if (/^\$\$/.test(t)) return true;
    // [[wikilink]]
    if (/\[\[[^\]]+\]\]/.test(t)) return true;
    // > [!NOTE] / > [!TIP] / > [!WARNING] 等 callout
    if (/^>\s*\[![A-Z]+\]/.test(t)) return true;
  }

  // $inline math$：单美元符号包裹，且内部不含空格（排除 "$10 到 $20" 类货币/价格误判）。
  // 真正的行内数学通常无空格（如 $x^2$），含空格的几乎都是价格/普通文本，不应误判为 markdown 源。
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    // 匹配 $...$，要求内部不含 $ 和空格，排除 $$ 与转义 \$
    if (/(?<!\$)\$(?!\$)([^\$\s]+)\$(?!\$)/.test(line)) return true;
  }

  return false;
}

/**
 * 若 text 是 Markdown 表格，解析成可插入当前选区的 Slice；否则返回 null。
 * 额外校验解析结果确实含 table 节点，避免把非表格内容误转成节点。
 */
export function parseMarkdownTablePaste(schema: Schema, text: string): Slice | null {
  if (!schema.nodes.table) return null;
  if (!looksLikeMarkdownTable(text)) return null;

  let doc;
  try {
    doc = parseMarkdown(schema, text);
  } catch {
    return null;
  }
  if (!doc || doc.childCount === 0) return null;

  let hasTable = false;
  doc.descendants((node) => {
    if (node.type.name === 'table') hasTable = true;
    return !hasTable;
  });
  if (!hasTable) return null;

  return new Slice(doc.content, 0, 0);
}

/**
 * 将结构化 Markdown 文本解析为 Slice（不含纯段落文本兜底）。
 * 仅当解析结果包含至少一个非 paragraph 的块级节点时才返回有效 Slice，
 * 避免纯文本被误转为段落。
 *
 * openStart/openEnd 策略：首尾节点若是可合并类型给 1，让 ProseMirror 默认合并逻辑生效
 * （如列表内粘贴并入当前列表、段落内粘贴并入当前段落）；
 * 其他类型（heading/codeBlock/table 等）给 0，独立插入。
 */
const MERGEABLE_TYPES = new Set([
  'paragraph',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
]);

export function parseGeneralMarkdownPaste(schema: Schema, text: string): Slice | null {
  if (!looksLikeMarkdownSource(text)) return null;

  let doc;
  try {
    doc = parseMarkdown(schema, text);
  } catch {
    return null;
  }
  if (!doc || doc.childCount === 0) return null;

  const first = doc.firstChild;
  const last = doc.lastChild;
  const openStart = first && MERGEABLE_TYPES.has(first.type.name) ? 1 : 0;
  const openEnd = last && MERGEABLE_TYPES.has(last.type.name) ? 1 : 0;

  return new Slice(doc.content, openStart, openEnd);
}

/**
 * 解析含 markdown 专有语法的纯文本为 Slice（数学块 / wikilink / callout / frontmatter）。
 * 与 parseGeneralMarkdownPaste 的区别：不要求 looksLikeMarkdownSource 命中——专有语法
 * 可能不满足块级启发式（如单行 `[[wikilink]]`、单独 `$$x$$`），只要解析出有效 doc 即返回。
 * 调用方必须先过 hasMarkdownOnlySyntax 闸门，本函数只负责解析，不承担误判防护。
 */
export function parseProprietaryMarkdownPaste(schema: Schema, text: string): Slice | null {
  let doc;
  try {
    doc = parseMarkdown(schema, text);
  } catch {
    return null;
  }
  if (!doc || doc.childCount === 0) return null;

  const first = doc.firstChild;
  const last = doc.lastChild;
  const openStart = first && MERGEABLE_TYPES.has(first.type.name) ? 1 : 0;
  const openEnd = last && MERGEABLE_TYPES.has(last.type.name) ? 1 : 0;

  return new Slice(doc.content, openStart, openEnd);
}

/**
 * 粗判文本是否含行内 Markdown 标记（**加粗** / `代码` / ~~删除线~~）。
 * 仅匹配双字符包裹的标记，排除单 `*`（`a*b*c`、`5 * 3` 等不误判）。
 * 用于 clipboardTextParser 兜底前的「单段落行内标记转换」，弥补纯文本路径不保留
 * 行内格式的缺口（从 Markdown 编辑器复制单段落、HTML 缺失时）。
 */
export function hasInlineMarkdownSyntax(text: string): boolean {
  return /(\*\*[^*]+\*\*|`[^`\n]+`|~~[^~]+~~)/.test(text);
}

/**
 * 纯文本粘贴的 Markdown 解析链（表格 → 结构化 → 专有语法 → 整段 URL → 行内标记）。
 * clipboardTextParser（Layer 1）与 Layer 4 的占位升级守卫共用同一判定，
 * 保证「Layer 1 会转换的文本，Layer 4 绝不拦截」——两处判定永不漂移。
 * 返回 null 表示纯文本，交给默认流程 / Layer 4 占位升级。
 */
function tryParseClipboardMarkdown(schema: Schema, text: string): Slice | null {
  // GFM 表格识别
  if (looksLikeMarkdownTable(text)) {
    const tableSlice = parseMarkdownTablePaste(schema, text);
    if (tableSlice) return tableSlice;
  }

  // 结构化 Markdown 识别（标题/引用/代码围栏/列表/frontmatter）
  if (looksLikeMarkdownSource(text)) {
    const generalSlice = parseGeneralMarkdownPaste(schema, text);
    if (generalSlice) return generalSlice;
  }

  // 专有语法识别（数学块 / wikilink / callout / frontmatter）——
  // 允许单行（如 `[[wikilink]]`、单独 `$$x$$`）无块级语法也走 markdown 解析
  if (hasMarkdownOnlySyntax(text)) {
    const proprietarySlice = parseProprietaryMarkdownPaste(schema, text);
    if (proprietarySlice) return proprietarySlice;
  }

  // 整段 URL → 自动转链接（仅粘贴路径，不开全局 linkify）
  const urlSlice = parseUrlPaste(schema, text);
  if (urlSlice) return urlSlice;

  // 单段落行内标记（**bold** / `code` / ~~strike~~）→ 走 markdown 解析保留格式
  if (hasInlineMarkdownSyntax(text)) {
    const inlineSlice = parseInlineMarkdownPaste(schema, text);
    if (inlineSlice) return inlineSlice;
  }

  return null;
}

/**
 * 将「含行内标记、但无块级语法」的纯文本解析为 Slice。
 * 校验：解析结果必须全部是段落，且至少一个段落含行内 mark（否则说明上层块级
 * 启发式漏了块级语法，或标记是误判——两种情况都返回 null 交给默认流程）。
 * openStart/openEnd 用 1，让 ProseMirror 把结果合并进当前段落。
 */
function parseInlineMarkdownPaste(schema: Schema, text: string): Slice | null {
  let doc;
  try {
    doc = parseMarkdown(schema, text);
  } catch {
    return null;
  }
  if (!doc || doc.childCount === 0) return null;

  let allParagraph = true;
  let hasMark = false;
  doc.forEach((block) => {
    if (block.type.name !== 'paragraph') {
      allParagraph = false;
      return;
    }
    block.descendants((node) => {
      if (node.isText && node.marks.length > 0) hasMark = true;
      return !hasMark;
    });
  });
  if (!allParagraph || !hasMark) return null;

  return new Slice(doc.content, 1, 1);
}

/**
 * 将「整段就是一个 URL」的纯文本粘贴转成链接（仅粘贴路径，不做全文 linkify）。
 * 匹配：trim 后整体是 http(s):// 开头的无空白连续串，允许结尾带中英文标点。
 * 命中后去掉句末标点，手动构建 link mark + 段落返回 Slice。
 * 返回 null 表示不含「整段 URL」，交给后续行内标记/默认流程。
 */
export function parseUrlPaste(schema: Schema, text: string): Slice | null {
  const trimmed = text.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  if (!schema.marks.link || !schema.nodes.paragraph) return null;

  const url = trimmed.replace(/[.,;:!?，。；：！？、]+$/, '');
  if (!url) return null;

  const linkMark = schema.marks.link.create({ href: url });
  const textNode = schema.text(url, [linkMark]);
  const paragraph = schema.nodes.paragraph.create(null, textNode);
  const doc = schema.nodes.doc.create(null, paragraph);
  return new Slice(doc.content, 1, 1);
}

// ── Word HTML 清理 ─────────────────────────────────────────────────
// 体积熔断：超过 2MB 的 HTML 直接降级（防超大粘贴卡死）
const HTML_VOLUME_LIMIT = 2_000_000;

/**
 * 嗅探是否为 Word HTML（含 mso 垃圾）。
 * 正则匹配：mso- CSS 属性、MsoNormal 类、<o:p> 标签。
 * 成本 <0.1ms，不命中即原样放行，零负优化。
 */
export function hasMsoHtml(html: string): boolean {
  return /mso-|MsoNormal|<o:p/i.test(html);
}

/**
 * 字符串级预清理 Word HTML 垃圾（比 DOMParser + DOM 遍历快一个量级）。
 * 只删不掉留——非 Word HTML 不命中 hasMsoHtml，不走此函数。
 *
 * 清理项：
 * - `<o:p>` 标签（仅删标签，保留内容）
 * - `style` 属性内的 `mso-*` 声明（只动 style 属性，不碰正文——
 *   正文里讨论 "mso-xxx: 1" 的文字不属于垃圾，必须原样保留）
 * - `MsoNormal`/`MsoList*` 等 class
 * - `<!--[if ...]>` 条件注释
 * - XML namespace 声明
 * - `<xml>` 标签及其内容
 */
function stripMsoMarkup(html: string): string {
  // 条件注释
  html = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/g, '');
  // <o:p> 标签（保留内容）
  html = html.replace(/<\/?o:p[^>]*>/gi, '');
  // mso-* CSS 声明——限定在 style 属性值内移除，正文文字不受影响。
  // 内层字符类必须排除引号：否则「属性值里最后一条声明无分号」时
  // [^;]* 会连闭合引号一起吃掉，产出 style="> 的残缺 HTML。
  html = html.replace(/style\s*=\s*"[^"]*"/gi, (attr) =>
    attr.replace(/\s*mso-[^:;"]+:[^;"]*;?/gi, ''),
  );
  // Mso 类名
  html = html.replace(/\sclass="Mso[^"]*"/gi, '');
  // XML namespace
  html = html.replace(/ xmlns:\w+="[^"]*"/g, '');
  // <xml> 及其内容
  html = html.replace(/<xml[^>]*>[\s\S]*?<\/xml>/gi, '');
  return html;
}

/**
 * 体积熔断 + Word HTML 预清理。
 * >2MB 返回 null（降级为纯文本）；Word HTML 嗅探命中后先瘦身再解析。
 */
export function parseHtmlSlice(schema: Schema, htmlString: string): Slice | null {
  if (!htmlString || !htmlString.trim()) return null;
  if (htmlString.length > HTML_VOLUME_LIMIT) return null; // 体积熔断

  const cleaned = hasMsoHtml(htmlString) ? stripMsoMarkup(htmlString) : htmlString;
  try {
    const dom = new DOMParser().parseFromString(cleaned, 'text/html');
    const doc = PMDOMParser.fromSchema(schema).parse(dom.body);
    if (!doc || doc.childCount === 0) return null;
    return new Slice(doc.content, 0, 0);
  } catch {
    return null;
  }
}

const markdownPastePluginKey = new PluginKey('markdownPaste');

export function markdownPastePlugin(opts?: {
  getDocumentPath?: () => string | null;
  getStoragePath?: () => string | null;
}): Plugin {
  return new Plugin({
    key: markdownPastePluginKey,
    props: {
      // ── Layer 3: handlePaste 逃生舱（图片 + 来源嗅探 + Layer 4 占位升级） ──────
      // 非图片场景优先 return false，放行给默认流程（上下文感知：代码块自动纯文本、列表自动合并）
      // 注意：PM 管线是 parseFromClipboard（先跑 Layer 1）→ handlePaste → 默认插入，
      // 第三个参数 slice 即「默认流程将插入的内容」——Layer 4 复用它复刻默认插入行为。
      handlePaste(view, event, slice) {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;

        const hasImage = hasClipboardImage(clipboard);

        // 来源嗅探：text/plain 与 text/html 同时存在，且 text/plain 含 markdown 专有语法
        //（数学块 / wikilink / callout / frontmatter）。这些标记经 HTML 渲染后必然丢失，
        // 只可能来自 markdown 编辑器（Obsidian / Typora 等）——此时 HTML 路径会丢扩展语法，
        // 强制改走纯文本 Markdown 管道。不命中则放行默认流程（HTML 路径格式更完整）。
        if (!hasImage && (clipboard.types?.includes('text/html') ?? false)) {
          const text = clipboard.getData('text/plain');
          if (text && hasMarkdownOnlySyntax(text)) {
            const mdSlice = parseProprietaryMarkdownPaste(view.state.schema, text);
            if (mdSlice) {
              view.dispatch(view.state.tr.replaceSelection(mdSlice).scrollIntoView());
              return true;
            }
          }
        }

        // ── Layer 4: 异步系统剪贴板 fallback（占位升级模式） ──────────
        // 触发：text/html 不可用（WebView2 常见），text/plain 存在且满足全部守卫：
        //   1. 非代码块上下文（code 上下文默认流程已按纯文本插入，升级反而会破坏代码块）
        //   2. markdown 解析链不命中（命中则 return false 放行默认流程插入 Layer 1 的 slice，
        //      否则会吞掉表格/URL/行内标记转换）
        //   3. PM 预解析 slice 可用（保证占位=默认插入内容，多行=多段落而非单个含 \n 的文本节点）
        // 模式：复刻默认插入（占位）→ 异步读系统剪贴板 → 成功则原地升级为富格式
        // 三条防线：isDestroyed 守卫 + 占位文本未变 + 请求序号防乱序
        // 失败/超时 → 保留占位（下限=默认粘贴结果，绝不降级）
        if (!hasImage && !(clipboard.types?.includes('text/html') ?? false)) {
          const text = clipboard.getData('text/plain');
          const inCode = Boolean(view.state.selection.$from.parent.type.spec.code);
          if (text && text.trim() && !inCode && slice && slice.size > 0
            && !tryParseClipboardMarkdown(view.state.schema, text)) {
            const from = view.state.selection.from;
            // 复刻 doPaste 默认插入（prosemirror-view paste 事件处理）：
            // 单节点闭环 slice 用 replaceSelectionWith，其余用 replaceSelection
            const singleNode = slice.openStart === 0 && slice.openEnd === 0
              && slice.content.childCount === 1
              ? slice.content.firstChild
              : null;
            const tr = singleNode
              ? view.state.tr.replaceSelectionWith(singleNode)
              : view.state.tr.replaceSelection(slice);
            view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
            const to = view.state.selection.from;
            // 占位插入后的实际文本（含块分隔符），作为「用户未编辑」的比对基准
            const expected = view.state.doc.textBetween(from, to, '\n');
            const requestId = ++nextPasteId;

            void readClipboardHtml().then((html) => {
              if (!html || view.isDestroyed) return;
              if (requestId !== nextPasteId) return; // 防乱序
              if (view.state.doc.textBetween(from, to, '\n') !== expected) return; // 用户已编辑
              const rich = parseHtmlSlice(view.state.schema, html);
              if (!rich) return;
              view.dispatch(view.state.tr.replaceWith(from, to, rich.content).scrollIntoView());
            });
            return true;
          }
        }

        if (!hasImage) return false;

        // 图片处理：异步落盘 + 插入 image 节点，同时手动插入文字
        // return true 消费事件，阻止默认流程基于 text/html 再插一次 <img>
        handleClipboardImagePaste(view, clipboard, opts);
        return true;
      },

      // ── Layer 1: clipboardTextParser 钩子 ─────────────────────────
      // 触发：走纯文本路径时（text/html 缺失或不可用，如 WebView2 常见场景）
      // 职责：识别结构化 Markdown 源 → 解析为 Slice（链在 tryParseClipboardMarkdown，
      // 与 Layer 4 占位升级守卫共用同一判定）
      // 返回 null → ProseMirror fallback 到默认纯文本处理（逐行成段）
      // 类型断言：ProseMirror 类型签名要求返回 Slice，但运行时 someProp 支持 null fallback
      clipboardTextParser: ((text: string, $context: { doc: { type: { schema: Schema } } }) => {
        // 兜底：纯文本，让 ProseMirror 用默认逻辑逐行成段
        return tryParseClipboardMarkdown($context.doc.type.schema, text);
      }) as any,

      // ── Layer 2: transformPasted 钩子 ─────────────────────────────
      // 触发：所有粘贴路径（HTML 和纯文本都会过这一环）
      // 职责：装饰性 HTML 塌方时，从 slice.content 反查 Markdown 源救回
      // 双重闸门：isLowQualityParse + looksLikeMarkdownSource，绝不误伤正常路径
      transformPasted(slice, view) {
        if (!isLowQualityParse(slice)) return slice;

        // 装饰性 HTML 塌方：遍历 slice.content 子节点取 textContent 拼接，反查原 Markdown 源
        // （千问/豆包文档典型路径：div/span+CSS 被 DOMParser 拍平成纯段落，textContent 保留原 markdown 字符）
        const parts: string[] = [];
        slice.content.forEach((node) => {
          parts.push(node.textContent);
        });
        const md = parts.join('\n');
        if (!md || !looksLikeMarkdownSource(md)) return slice;

        const rescued = parseGeneralMarkdownPaste(view.state.schema, md);
        return rescued ?? slice;
      },
    },
  });
}

/**
 * 处理剪贴板图片粘贴：异步落盘 + 插入 image 节点，同时手动插入文字。
 * 调用方应 return true 消费事件，阻止默认流程基于 text/html 再插 <img>。
 *
 * 文字部分：同步插入纯文本（丢失格式，但图片是主体，可接受降级）
 * 图片部分：异步落盘为 asset URL（保留本地优先特性）
 */
function handleClipboardImagePaste(
  view: any,
  clipboard: DataTransfer,
  opts?: { getDocumentPath?: () => string | null; getStoragePath?: () => string | null },
) {
  const docPath = opts?.getDocumentPath?.() ?? null;
  const storagePath = opts?.getStoragePath?.() ?? null;

  // 文字部分：同步插入纯文本
  const text = clipboard.getData('text/plain');
  if (text && text.trim()) {
    view.dispatch(view.state.tr.insertText(text).scrollIntoView());
  }

  // 图片部分：异步落盘
  if (storagePath || docPath) {
    void readClipboardImageAsDataUrl(clipboard).then(async (dataUrl) => {
      if (!dataUrl || !view || view.isDestroyed) return;

      try {
        const saved = await saveClipboardImage(
          dataUrl,
          docPath ?? undefined,
          storagePath ?? undefined,
        );
        if (!view || view.isDestroyed) return;

        await authorizeImageAsset(saved.absolutePath);
        insertImageNode(view, saved.relativePath, '');
      } catch (err) {
        console.error('Failed to handle pasted image:', err);
      }
    });
  } else {
    void confirm(
      '请先保存文档，或设置图片存储位置，才能粘贴图片。',
      { title: '粘贴图片', kind: 'warning', okLabel: '我知道了' },
    );
  }
}

/**
 * 判断 HTML 解析结果是否"格式塌方"——解析虽然成功，但几乎没保住任何格式。
 *
 * 触发条件（同时满足）：
 * - 至少 2 个块级节点（单段落不判塌方，避免对 legitimately 纯文本误救）
 * - 全部块都是「无 mark 的纯段落」：没有标题/列表/表格/代码块/引用等块级结构，
 *   也没有任何加粗/斜体/链接等行内 mark
 *
 * 这是装饰性 HTML（div/span + CSS，如千问聊天、豆包生成的文档）的典型后果：
 * ProseMirror DOMParser 只认语义标签，div/span 被拍平成纯段落、CSS 样式被丢弃，
 * 解析"成功"但格式全失。此时若纯文本其实是 markdown 源，回头走 markdown 解析能救回。
 *
 * 安全性：已正常还原格式的解析（含标题/列表/加粗等）必然 formatted > 0 → 返回 false，
 * 不会被救——保证豆包/DeepSeek 问答等已正常路径行为完全不变。
 */
export function isLowQualityParse(slice: Slice): boolean {
  let blocks = 0;
  let formatted = 0;

  slice.content.forEach((block) => {
    blocks++;
    // 非段落块（heading/list/table/codeBlock/blockquote 等）= 保住了结构
    if (block.type.name !== 'paragraph') {
      formatted++;
      return;
    }
    // 段落内含任意 mark（bold/italic/link/code 等）= 保住了行内格式
    let hasMark = false;
    block.descendants((node) => {
      if (node.isText && node.marks.length > 0) hasMark = true;
      return !hasMark;
    });
    if (hasMark) formatted++;
  });

  if (blocks === 0) return true;
  return formatted === 0 && blocks >= 2;
}

export const MarkdownPaste = Extension.create<{
  getDocumentPath?: () => string | null;
  getStoragePath?: () => string | null;
}>({
  name: 'markdownPaste',

  addOptions() {
    return {
      getDocumentPath: undefined,
      getStoragePath: undefined,
    };
  },

  addProseMirrorPlugins() {
    return [markdownPastePlugin(this.options)];
  },
});
