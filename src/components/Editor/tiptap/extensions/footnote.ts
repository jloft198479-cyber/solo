import { Node, mergeAttributes } from '@tiptap/core';

export const FootnoteRef = Node.create({
  name: 'footnoteRef',

  inline: true,

  group: 'inline',

  atom: true,

  addAttributes() {
    return {
      label: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote-ref]' }];
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
      label: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-footnote-def]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-footnote-def': '' }), 0];
  },
});
