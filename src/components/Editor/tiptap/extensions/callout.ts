/**
 * Callout 块扩展 — 重点提示
 *
 * 语法：> [!type] 其中 type 可为 note/warning/tip/info 等
 * 参见 Obsidian callout 语法兼容。
 */
import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const VALID_TYPES = [
  'note', 'abstract', 'info', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote',
  'callout',
] as const;

export type CalloutType = (typeof VALID_TYPES)[number];

/**
 * 归一化 callout 类型。
 * 已知类型 → 标准小写；未知类型 → 原样保留（避免数据静默丢失）。
 */
export function normalizeCalloutType(type: string | null | undefined): string {
  if (!type) return 'note';
  const lower = type.toLowerCase().trim();
  if ((VALID_TYPES as readonly string[]).includes(lower)) return lower;
  return lower; // 保留未知类型，不降级
}

export const Callout = Node.create({
  name: 'callout',

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      calloutType: {
        default: 'note',
        parseHTML: (el) => normalizeCalloutType(el.getAttribute('data-callout-type')),
        renderHTML: (attrs) => ({
          'data-callout-type': (attrs.calloutType as string) || 'note',
          class: 'mk-callout',
        }),
      },
      // B10：Obsidian `> [!NOTE]+ 标题` 的标题与折叠标记，保真建模防 roundtrip 语义漂移
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') || '',
        renderHTML: (attrs) => (attrs.title ? { 'data-title': attrs.title as string } : {}),
      },
      fold: {
        default: null, // '+'（默认展开）| '-'（默认折叠）| null（不可折叠）
        parseHTML: (el) => {
          const v = el.getAttribute('data-fold');
          return v === '+' || v === '-' ? v : null;
        },
        renderHTML: (attrs) => (attrs.fold ? { 'data-fold': attrs.fold as string } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.mk-callout' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');

      // NodeView 的 DOM 不会自动应用 addAttributes 的 renderHTML（那只作用于
      // 剪贴板/HTML 序列化）——必须手动同步，否则类型配色/标题 CSS 全部失效
      const applyAttrs = (n: ProseMirrorNode) => {
        dom.className = 'mk-callout';
        dom.setAttribute('data-callout-type', normalizeCalloutType(n.attrs.calloutType as string));
        const title = typeof n.attrs.title === 'string' ? n.attrs.title.trim() : '';
        if (title) dom.setAttribute('data-title', title);
        else dom.removeAttribute('data-title');
        const fold = n.attrs.fold === '+' || n.attrs.fold === '-' ? n.attrs.fold : null;
        if (fold) dom.setAttribute('data-fold', fold);
        else dom.removeAttribute('data-fold');
      };
      applyAttrs(node);

      return {
        dom,
        contentDOM: dom,
        update: (updatedNode: ProseMirrorNode) => {
          if (updatedNode.type !== node.type) return false;
          applyAttrs(updatedNode);
          return true;
        },
      };
    };
  },
});
