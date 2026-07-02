/**
 * Markdown 及 HTML 粘贴识别
 *
 * 处理四种粘贴场景（按优先级）：
 * 1. Markdown 表格文本 → parseMarkdown
 * 2. 来源嗅探：text/plain 含 markdown 专有语法（$$、[[]]、callout）→ 走 markdown 解析
 * 3. HTML 富文本 → 放行给 ProseMirror 默认 DOMParser（一次转换，schema 感知）
 * 4. 通用 Markdown 块结构（纯 text/plain）→ parseMarkdown
 *
 * 非结构化纯文本放行给默认粘贴，避免误伤。
 */
import { Extension } from '@tiptap/vue-3';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Slice } from '@tiptap/pm/model';
import type { Schema } from '@tiptap/pm/model';

import { parseMarkdown } from '../markdown/parser';
import { authorizeImageAsset, saveClipboardImage } from '../../../../services/tauri/document';
import { confirm } from '../../../../services/tauri/dialog';

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

  // $inline math$：非独占行的单美元符号包裹（排除代码围栏内的误判）
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    // 匹配 $...$，排除 $$（已在上行处理）和转义的 \$
    if (/(?<!\$)\$(?!\$)([^\$\n]+)\$(?!\$)/.test(line)) return true;
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
 */
export function parseGeneralMarkdownPaste(schema: Schema, text: string): Slice | null {
  if (!looksLikeMarkdownSource(text)) return null;

  let doc;
  try {
    doc = parseMarkdown(schema, text);
  } catch {
    return null;
  }
  if (!doc || doc.childCount === 0) return null;

  return new Slice(doc.content, 0, 0);
}

const markdownPastePluginKey = new PluginKey('markdownPaste');

export function markdownPastePlugin(opts?: {
  getDocumentPath?: () => string | null;
  getStoragePath?: () => string | null;
}): Plugin {
  return new Plugin({
    key: markdownPastePluginKey,
    props: {
      handlePaste(view, event) {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;

        // ── 0. 代码块内粘贴 ───────────────────────────────────────
        // 光标在 codeBlock 中时放行给 ProseMirror 默认粘贴（只插纯文本），
        // 避免结构化 markdown 解析把块级节点注入到只允许 text* 的节点中。
        const { selection } = view.state;
        if (selection.$from.parent.type.spec.code) return false;

        // ── 1. 剪贴板图片 ─────────────────────────────────────────
        // 异步保存，不阻塞文字处理。图片和文字可以同时粘贴。
        const hasImage = hasClipboardImage(clipboard);
        if (hasImage) {
          const docPath = opts?.getDocumentPath?.() ?? null;
          const storagePath = opts?.getStoragePath?.() ?? null;

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
          // 不 return——继续处理文字，防止文字被吞
        }

        const text = clipboard.getData('text/plain');
        if (!text || !text.trim()) return hasImage;

        const html = clipboard.getData('text/html');

        // ── 2. GFM 表格 ──────────────────────────────────────────
        // 剪贴板带有富文本 `<table>`（从网页/Excel 拷）时，交给默认 HTML 粘贴
        if (looksLikeMarkdownTable(text)) {
          if (!(html && /<table[\s>]/i.test(html))) {
            const slice = parseMarkdownTablePaste(view.state.schema, text);
            if (slice) {
              const tr = view.state.tr
                .replaceSelection(slice)
                .scrollIntoView()
                .setMeta(markdownPastePluginKey, { pasted: true });
              view.dispatch(tr);
              return true;
            }
          }
        }

        // ── 2.5 来源嗅探：markdown 编辑器 vs 网页 ────────────────────
        // text/plain 和 text/html 同时存在时，判断来源：
        // - text/plain 含 markdown 专有语法（$$、[[ ]]、> [!NOTE]）→ 来自 markdown 编辑器
        //   走 markdown 解析，保留 HTML 中已丢失的语法
        // - 否则 → 来自网页，放行给 ProseMirror DOMParser
        if (html && html.trim() && hasMarkdownOnlySyntax(text)) {
          const slice = parseGeneralMarkdownPaste(view.state.schema, text);
          if (slice) {
            const tr = view.state.tr
              .replaceSelection(slice)
              .scrollIntoView()
              .setMeta(markdownPastePluginKey, { pasted: true });
            view.dispatch(tr);
            return true;
          }
        }

        // ── 3. HTML 富文本 → 放行给 ProseMirror 默认 DOMParser ──────
        // text/html 存在时优先放行。HTML 携带的信息量（图片、链接 URL、表格结构）
        // 远多于 text/plain，ProseMirror 的 DOMParser 一次转换、schema 感知。
        // 但如果图片正在异步保存（步骤 1），不能放行——ProseMirror 会从 HTML 的
        // <img> 再插一次图片，导致重复。此时消费事件，手动插文字。
        if (html && html.trim()) {
          if (hasImage) {
            if (text && text.trim()) {
              view.dispatch(view.state.tr.insertText(text).scrollIntoView());
            }
            return true;
          }
          return false;
        }

        // ── 4. 通用 Markdown（纯 text/plain 兜底）──────────────────
        // 无 HTML 时，从 markdown 编辑器复制的结构化文本仍可被识别。
        if (looksLikeMarkdownSource(text)) {
          const slice = parseGeneralMarkdownPaste(view.state.schema, text);
          if (slice) {
            const tr = view.state.tr
              .replaceSelection(slice)
              .scrollIntoView()
              .setMeta(markdownPastePluginKey, { pasted: true });
            view.dispatch(tr);
            return true;
          }
        }

        // ── 5. 纯文本兜底（仅当有图片时） ──────────────────────────
        // 上面没命中 markdown 解析，但图片正在异步保存中。
        // 消费事件+兜底插文字，避免默认粘贴通过 HTML 路径再插一次图片。
        if (hasImage) {
          if (text && text.trim()) {
            view.dispatch(view.state.tr.insertText(text).scrollIntoView());
          }
          return true;
        }

        return false;
      },
    },
  });
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
