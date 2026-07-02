/**
 * Callout 块扩展 — 重点提示
 *
 * 语法：> [!type] 其中 type 可为 note/warning/tip/info 等
 * 参见 Obsidian callout 语法兼容。
 */
import { Node, mergeAttributes } from '@tiptap/core';

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
    };
  },

  parseHTML() {
    return [{ tag: 'div.mk-callout' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return () => {
      const dom = document.createElement('div');
      dom.className = 'mk-callout';

      return { dom, contentDOM: dom };
    };
  },
});
