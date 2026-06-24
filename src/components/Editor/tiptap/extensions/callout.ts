/**
 * Callout 块扩展 — 极简重点提示
 *
 * 仅一个类型，无 icon 无 label，仅有底色区分。
 * 语法：> [!callout]
 */
import { Node, mergeAttributes } from '@tiptap/core';

export function normalizeCalloutType(_type: string | null | undefined): 'callout' {
  return 'callout';
}

export const Callout = Node.create({
  name: 'callout',

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      calloutType: {
        default: 'callout',
        parseHTML: () => 'callout',
        renderHTML: () => ({
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
