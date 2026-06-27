import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import { parseMarkdown } from '../parser';
import { serializeMarkdown, serializeMarkdownForClipboard } from '../serializer';

/** 构建最小 schema（匹配 solo 实际使用的 nodes + marks） */
export function createTestSchema(): Schema {
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
      heading: {
        group: 'block', content: 'inline*',
        attrs: { level: { default: 1 } },
        defining: true,
        parseDOM: [1, 2, 3, 4, 5, 6].map((l) => ({ tag: `h${l}`, attrs: { level: l } })),
        toDOM: (n: PMNode) => [`h${n.attrs.level}`, 0],
      },
      blockquote: { group: 'block', content: 'block+', parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
      bulletList: { group: 'block', content: 'listItem+', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
      orderedList: { group: 'block', content: 'listItem+', attrs: { start: { default: 1 } }, parseDOM: [{ tag: 'ol' }], toDOM: () => ['ol', 0] },
      listItem: { content: 'block+', parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
      taskList: { group: 'block', content: 'taskItem+', parseDOM: [{ tag: 'ul[data-type="taskList"]' }], toDOM: () => ['ul', { 'data-type': 'taskList' }, 0] },
      taskItem: { content: 'block+', attrs: { checked: { default: false } }, parseDOM: [{ tag: 'li[data-type="taskItem"]' }], toDOM: (n: PMNode) => ['li', { 'data-type': 'taskItem', 'data-checked': n.attrs.checked }, 0] },
      codeBlock: {
        group: 'block', content: 'text*', marks: '', code: true,
        attrs: { language: { default: null } },
        parseDOM: [{ tag: 'pre' }], toDOM: () => ['pre', ['code', 0]],
      },
      hardBreak: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
      horizontalRule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
      table: { group: 'block', content: 'tableRow+', tableRole: 'table', parseDOM: [{ tag: 'table' }], toDOM: () => ['table', ['tbody', 0]] },
      tableRow: { content: '(tableHeader | tableCell)+', tableRole: 'row', parseDOM: [{ tag: 'tr' }], toDOM: () => ['tr', 0] },
      tableHeader: { content: 'paragraph+', tableRole: 'header_cell', isolating: true, parseDOM: [{ tag: 'th' }], toDOM: () => ['th', 0] },
      tableCell: { content: 'paragraph+', tableRole: 'cell', isolating: true, parseDOM: [{ tag: 'td' }], toDOM: () => ['td', 0] },
      image: {
        inline: true, group: 'inline',
        attrs: { src: { default: '' }, alt: { default: '' }, title: { default: null } },
        parseDOM: [{ tag: 'img' }], toDOM: () => ['img'],
      },
      mathInline: {
        inline: true, group: 'inline', atom: true,
        attrs: { latex: { default: '' } },
        parseDOM: [{ tag: 'span[data-type="math-inline"]' }],
        toDOM: () => ['span', { 'data-type': 'math-inline' }, 0],
      },
      mathBlock: {
        group: 'block', content: 'text*', marks: '', code: true,
        parseDOM: [{ tag: 'div[data-type="math-block"]' }],
        toDOM: () => ['div', { 'data-type': 'math-block' }, 0],
      },
      mermaidBlock: {
        group: 'block', content: 'text*', marks: '', code: true,
        parseDOM: [{ tag: 'div[data-type="mermaid-block"]' }],
        toDOM: () => ['div', { 'data-type': 'mermaid-block' }, 0],
      },
      frontmatter: {
        group: 'block', content: 'text*', marks: '', code: true, defining: true,
        parseDOM: [{ tag: 'pre[data-frontmatter]' }],
        toDOM: () => ['pre', { 'data-frontmatter': '' }, ['code', 0]],
      },
      callout: {
        group: 'block', content: 'block+',
        attrs: { calloutType: { default: 'note' } },
        parseDOM: [{ tag: 'div.mk-callout' }],
        toDOM: () => ['div', { 'data-type': 'callout' }, 0],
      },
      footnoteRef: {
        inline: true, group: 'inline', atom: true,
        attrs: { label: { default: '' } },
        parseDOM: [{ tag: 'sup[data-footnote-ref]' }],
        toDOM: () => ['sup', { 'data-footnote-ref': '' }, 0],
      },
      footnoteSection: {
        group: 'block', content: 'footnoteDef+', defining: true,
        parseDOM: [{ tag: 'div[data-footnote-section]' }],
        toDOM: () => ['div', { 'data-footnote-section': '' }, 0],
      },
      footnoteDef: {
        group: 'block', content: 'block+', defining: true,
        attrs: { label: { default: '' } },
        parseDOM: [{ tag: 'div[data-footnote-def]' }],
        toDOM: () => ['div', { 'data-footnote-def': '' }, 0],
      },
      wikilink: {
        inline: true, group: 'inline', atom: true,
        attrs: { target: { default: '' }, alias: { default: '' } },
        parseDOM: [{ tag: 'span[data-wikilink]' }],
        toDOM: () => ['span', { 'data-wikilink': '' }, 0],
      },
      text: { group: 'inline' },
    },
    marks: {
      bold: { parseDOM: [{ tag: 'strong' }], toDOM: () => ['strong', 0] },
      italic: { parseDOM: [{ tag: 'em' }], toDOM: () => ['em', 0] },
      strike: { parseDOM: [{ tag: 's' }], toDOM: () => ['s', 0] },
      code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
      highlight: { parseDOM: [{ tag: 'mark' }], toDOM: () => ['mark', 0] },
      link: {
        attrs: { href: { default: '' }, target: { default: null }, title: { default: null } },
        parseDOM: [{ tag: 'a' }], toDOM: () => ['a', 0],
      },
      superscript: { parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
      subscript: { parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
    },
  });
}

export function normalize(md: string): string {
  return md.replace(/\n+$/, '\n');
}

export function roundTrip(md: string): string {
  const schema = createTestSchema();
  const doc = parseMarkdown(schema, md);
  return serializeMarkdown(doc);
}

export function roundTripClipboard(md: string): string {
  const schema = createTestSchema();
  const doc = parseMarkdown(schema, md);
  return serializeMarkdownForClipboard(doc);
}

/** 获取随机整数 [min, max] */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 随机选择数组中的一项 */
export function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}
