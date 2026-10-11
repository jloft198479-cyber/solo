import { Node, mergeAttributes } from '@tiptap/core';

export const FootnoteRef = Node.create({
  name: 'footnoteRef',

  inline: true,

  group: 'inline',

  atom: true,

  addAttributes() {
    return {
      // 显式 parseHTML 绕开 Tiptap fromString 对 `label="1"` 的数字强转（P1-1），保住字符串语义
      label: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('label') ?? '',
      },
    };
  },

  parseHTML() {
    // priority 100：让本规则排在 superscript mark 的 `{tag:'sup'}`（默认 50）之前命中，
    // 否则 `<sup data-footnote-ref>` 被 superscript 抢走、footnoteRef atom 永不创建（P1-2）
    return [{ tag: 'sup[data-footnote-ref]', priority: 100 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-footnote-ref': '' }), `[^${HTMLAttributes.label || ''}]`];
  },
});

export const FootnoteSection = Node.create({
  name: 'footnoteSection',

  group: 'block',

  content: 'footnoteDef+',

  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-footnote-section]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-footnote-section': '' }), 0];
  },
});

export const FootnoteDef = Node.create({
  name: 'footnoteDef',

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      // 同 FootnoteRef.label：显式 parseHTML 绕开 fromString 数字强转（P1-1）
      label: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('label') ?? '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-footnote-def]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-footnote-def': '' }), 0];
  },
});
