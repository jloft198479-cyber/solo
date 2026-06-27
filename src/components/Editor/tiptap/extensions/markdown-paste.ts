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

export function markdownPastePlugin(): Plugin {
  return new Plugin({
    key: markdownPastePluginKey,
    props: {
      handlePaste(view, event) {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;

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

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    return [markdownPastePlugin()];
  },
});
