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

export function normalizeCalloutType(type: string | null | undefined): CalloutType {
  if (!type) return 'note';
  const lower = type.toLowerCase().trim() as CalloutType;
  if (VALID_TYPES.includes(lower)) return lower;
  return 'note';
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
