import { Node, mergeAttributes } from '@tiptap/vue-3';
import { getKatex } from './math-block';

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'math-inline',
        class: 'mk-math-inline',
        'data-latex': node.attrs.latex,
      }),
      node.attrs.latex,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'mk-math-inline';
      let renderVersion = 0;

      async function render(latex: string) {
        const version = ++renderVersion;
        dom.dataset.latex = latex;
        dom.replaceChildren();
        try {
          const katex = await getKatex();
          if (version !== renderVersion) return;
          dom.innerHTML = katex.default.renderToString(latex, {
            displayMode: false,
            throwOnError: false,
            trust: false,
          });
        } catch {
          if (version !== renderVersion) return;
          dom.textContent = `$${latex}$`;
        }
      }

      render(typeof node.attrs.latex === 'string' ? node.attrs.latex : '');

      return {
        dom,
        contentDOM: undefined,
        update(updatedNode) {
          if (updatedNode.type.name !== 'mathInline') return false;
          node = updatedNode;
          render(typeof node.attrs.latex === 'string' ? node.attrs.latex : '');
          return true;
        },
        ignoreMutation() {
          return true;
        },
      };
    };
  },
});
