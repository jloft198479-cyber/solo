import { Node, mergeAttributes } from '@tiptap/core';

export const Frontmatter = Node.create({
  name: 'frontmatter',

  group: 'block',

  content: 'text*',

  marks: '',

  code: true,

  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="frontmatter"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'frontmatter', class: 'mk-frontmatter' }), 0];
  },

  addNodeView() {
    return () => {
      const container = document.createElement('div');
      container.className = 'mk-frontmatter';
      container.dataset.type = 'frontmatter';

      const header = document.createElement('div');
      header.className = 'mk-frontmatter-header';
      header.textContent = 'Frontmatter';

      const content = document.createElement('div');
      content.className = 'mk-frontmatter-content';

      container.appendChild(header);
      container.appendChild(content);

      return { dom: container, contentDOM: content };
    };
  },
});
