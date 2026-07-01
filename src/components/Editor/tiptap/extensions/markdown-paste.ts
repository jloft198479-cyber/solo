/**
 * Markdown 粘贴识别
 *
 * 从别的 Markdown 工具/源码里拷贝文本粘进来时，默认只会变成纯文本。
 * 这个扩展挂一个 handlePaste，分两阶段识别：
 * 1. GFM 表格（精确匹配，已有）
 * 2. 通用 Markdown 块结构（标题/列表/引用/围栏等），用统一 parseMarkdown 转换
 *
 * 非结构化纯文本一律放行给默认粘贴，避免误伤普通文本。
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
    if (/^\s*[-*+]\s/.test(t) || /^\s*\d+\.\s/.test(t) || /^\s*\[[ x]\]\s/.test(t)) {
      listCount++;
      if (listCount >= 2) return true;
    }
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

        // ── 0. 剪贴板图片 ─────────────────────────────────────────
        // 用户粘贴截图或复制的图片 → 保存到 assets/ 并插入相对路径
        if (hasClipboardImage(clipboard)) {
          const docPath = opts?.getDocumentPath?.() ?? null;
          const storagePath = opts?.getStoragePath?.() ?? null;

          if (!storagePath && !docPath) {
            void confirm(
              '请先保存文档，或设置图片存储位置，才能粘贴图片。',
              { title: '粘贴图片', kind: 'warning', okLabel: '我知道了' },
            );
            return true;
          }

          void readClipboardImageAsDataUrl(clipboard).then(async (dataUrl) => {
            if (!dataUrl || !view || view.isDestroyed) return;

            try {
              const saved = await saveClipboardImage(
                dataUrl,
                docPath ?? undefined,
                storagePath ?? undefined,
              );
              if (!view || view.isDestroyed) return;

              // 授权 asset 协议作用域
              await authorizeImageAsset(saved.absolutePath);

              // 始终存相对路径（便携 + 跨 session 有效）
              insertImageNode(view, saved.relativePath, '');
            } catch (err) {
              console.error('Failed to handle pasted image:', err);
            }
          });

          return true;
        }

        const text = clipboard.getData('text/plain');
        if (!text || !text.trim()) return false;

        // ── 1. GFM 表格 ──────────────────────────────────────────
        // 剪贴板带有富文本 `<table>`（从网页/Excel 拷）时，交给默认 HTML 粘贴
        if (looksLikeMarkdownTable(text)) {
          const html = clipboard.getData('text/html');
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

        // ── 2. 通用 Markdown ─────────────────────────────────────
        // 非表格的结构化 markdown（标题/列表/引用/围栏等）
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
