/**
 * Markdown ↔ PM Doc round-trip 测试
 *
 * 验证：md → parseMarkdown → serializeMarkdown → md'，md' === md
 * 这些测试不依赖 DOM/Editor（纯 schema + parser + serializer）。
 */
import { describe, it, expect } from 'vitest';
import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import { parseMarkdown } from '../parser';
import { serializeMarkdown } from '../serializer';

// ── 构建最小可用 schema（模拟 TipTap StarterKit 的核心 nodes + marks） ──

function createTestSchema(): Schema {
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
      heading: {
        group: 'block',
        content: 'inline*',
        attrs: { level: { default: 1 } },
        defining: true,
        parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
        toDOM: (node: PMNode) => [`h${node.attrs.level}`, 0],
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
      table: {
        group: 'block',
        content: 'tableRow+',
        tableRole: 'table',
        parseDOM: [{ tag: 'table' }],
        toDOM: () => ['table', ['tbody', 0]],
      },
      tableRow: {
        content: '(tableHeader | tableCell)+',
        tableRole: 'row',
        parseDOM: [{ tag: 'tr' }],
        toDOM: () => ['tr', 0],
      },
      tableHeader: {
        content: 'paragraph+',
        tableRole: 'header_cell',
        isolating: true,
        parseDOM: [{ tag: 'th' }],
        toDOM: () => ['th', 0],
      },
      tableCell: {
        content: 'paragraph+',
        tableRole: 'cell',
        isolating: true,
        parseDOM: [{ tag: 'td' }],
        toDOM: () => ['td', 0],
      },
      image: {
        inline: true, group: 'inline',
        attrs: { src: { default: '' }, alt: { default: '' }, title: { default: null } },
        parseDOM: [{ tag: 'img' }], toDOM: () => ['img'],
      },
      mathInline: {
        inline: true,
        group: 'inline',
        atom: true,
        attrs: { latex: { default: '' } },
        parseDOM: [{ tag: 'span[data-type="math-inline"]' }],
        toDOM: () => ['span', { 'data-type': 'math-inline' }, 0],
      },
      mathBlock: {
        group: 'block',
        content: 'text*',
        marks: '',
        code: true,
        parseDOM: [{ tag: 'div[data-type="math-block"]' }],
        toDOM: () => ['div', { 'data-type': 'math-block' }, 0],
      },
      mermaidBlock: {
        group: 'block',
        content: 'text*',
        marks: '',
        code: true,
        parseDOM: [{ tag: 'div[data-type="mermaid-block"]' }],
        toDOM: () => ['div', { 'data-type': 'mermaid-block' }, 0],
      },
      frontmatter: {
        group: 'block',
        content: 'text*',
        marks: '',
        code: true,
        defining: true,
        parseDOM: [{ tag: 'pre[data-frontmatter]' }],
        toDOM: () => ['pre', { 'data-frontmatter': '' }, ['code', 0]],
      },
      callout: {
        group: 'block',
        content: 'block+',
        attrs: {
          calloutType: { default: 'note' },
        },
        parseDOM: [{ tag: 'div.mk-callout' }],
        toDOM: () => ['div', { 'data-type': 'callout' }, 0],
      },
      footnoteRef: {
        inline: true,
        group: 'inline',
        atom: true,
        attrs: { label: { default: '' } },
        parseDOM: [{ tag: 'sup[data-footnote-ref]' }],
        toDOM: () => ['sup', { 'data-footnote-ref': '' }, 0],
      },
      footnoteSection: {
        group: 'block',
        content: 'footnoteDef+',
        defining: true,
        parseDOM: [{ tag: 'div[data-footnote-section]' }],
        toDOM: () => ['div', { 'data-footnote-section': '' }, 0],
      },
      footnoteDef: {
        group: 'block',
        content: 'block+',
        defining: true,
        attrs: { label: { default: '' } },
        parseDOM: [{ tag: 'div[data-footnote-def]' }],
        toDOM: () => ['div', { 'data-footnote-def': '' }, 0],
      },
      wikilink: {
        inline: true,
        group: 'inline',
        atom: true,
        attrs: {
          target: { default: '' },
          alias: { default: '' },
        },
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
        parseDOM: [{ tag: 'a' }],
        toDOM: () => ['a', 0],
      },
      superscript: { parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
      subscript: { parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
    },
  });
}

function roundTrip(md: string): string {
  const schema = createTestSchema();
  const doc = parseMarkdown(schema, md);
  return serializeMarkdown(doc);
}

function normalize(md: string): string {
  return md.replace(/\n+$/, '\n');
}

// ── 基础 round-trip 测试 ─────────────────────────────────────

describe('Round-trip: parse → serialize', () => {
  describe('Phase A: bold / italic / strike', () => {
    it('bold', () => {
      expect(roundTrip('**hello**\n')).toBe(normalize('**hello**\n'));
    });

    it('italic', () => {
      expect(roundTrip('*hello*\n')).toBe(normalize('*hello*\n'));
    });

    it('strike', () => {
      expect(roundTrip('~~hello~~\n')).toBe(normalize('~~hello~~\n'));
    });

    it('nested bold + italic', () => {
      expect(roundTrip('**a *b* c**\n')).toBe(normalize('**a *b* c**\n'));
    });

    it('nested strike + bold (mark order normalized by PM schema)', () => {
      // PM 按 schema 定义顺序排列同范围 mark：bold 在 strike 外层
      expect(roundTrip('~~**hello**~~\n')).toBe(normalize('**~~hello~~**\n'));
    });

    it('multiple marks in sequence', () => {
      expect(roundTrip('**bold** then *italic* then ~~strike~~\n'))
        .toBe(normalize('**bold** then *italic* then ~~strike~~\n'));
    });
  });

  describe('headings', () => {
    it('parses heading as semantic inline content without marker nodes', () => {
      const schema = createTestSchema();
      const doc = parseMarkdown(schema, '## Hello\n');
      const heading = doc.firstChild;

      expect(heading?.type.name).toBe('heading');
      expect(heading?.attrs.level).toBe(2);
      expect(heading?.firstChild?.isText).toBe(true);
      expect(heading?.textContent).toBe('Hello');
    });

    it('heading', () => {
      expect(roundTrip('## Hello\n')).toBe(normalize('## Hello\n'));
    });

    it('heading with bold', () => {
      expect(roundTrip('## **Bold heading**\n')).toBe(normalize('## **Bold heading**\n'));
    });
  });

  describe('other marks', () => {
    it('inline code', () => {
      expect(roundTrip('`code`\n')).toBe(normalize('`code`\n'));
    });

    it('inline math', () => {
      expect(roundTrip('$E = mc^2$\n')).toBe(normalize('$E = mc^2$\n'));
    });

    it('highlight', () => {
      expect(roundTrip('==highlight==\n')).toBe(normalize('==highlight==\n'));
    });

    it('link', () => {
      expect(roundTrip('[text](https://example.com)\n'))
        .toBe(normalize('[text](https://example.com)\n'));
    });

    it('wikilink', () => {
      expect(roundTrip('See [[Roadmap]] and [[Project Alpha|Alpha]].\n'))
        .toBe(normalize('See [[Roadmap]] and [[Project Alpha|Alpha]].\n'));
    });

    it('superscript', () => {
      expect(roundTrip('^sup^\n')).toBe(normalize('^sup^\n'));
    });

    it('subscript', () => {
      expect(roundTrip('~sub~\n')).toBe(normalize('~sub~\n'));
    });
  });

  describe('block contexts', () => {
    it('bold in list item', () => {
      expect(roundTrip('- **bold item**\n')).toBe(normalize('- **bold item**\n'));
    });

    it('block math', () => {
      const md = '$$\n\\begin{aligned}\nd_{i, j} &\\leftarrow d_{i, j} + 1 \\\\\nd_{i, y + 1} &\\leftarrow d_{i, y + 1} - 1 \\\\\nd_{x + 1, j} &\\leftarrow d_{x + 1, j} - 1 \\\\\nd_{x + 1, y + 1} &\\leftarrow d_{x + 1, y + 1} + 1\n\\end{aligned}\n$$\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('mermaid block', () => {
      const md = '```mermaid\ngraph TD\n  A --> B\n```\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('inline image', () => {
      const md = '![doocs](https://cdn-doocs.oss-cn-shenzhen.aliyuncs.com/gh/doocs/md/images/logo-2.png)\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('bold in blockquote', () => {
      expect(roundTrip('> **bold quote**\n')).toBe(normalize('> **bold quote**\n'));
    });

    it('plain paragraph', () => {
      expect(roundTrip('hello world\n')).toBe(normalize('hello world\n'));
    });

    it('horizontal rule', () => {
      expect(roundTrip('---\n')).toBe(normalize('---\n'));
    });

    it('table cell hard break as br', () => {
      const md = '| A | B |\n| --- | --- |\n| line1<br>line2 | ok |\n';
      // <br> 在 html:false 模式下是字面文本，序列化时 < > 会被转义
      expect(roundTrip(md)).toBe(
        normalize('| A                | B   |\n| ---------------- | --- |\n| line1\\<br\\>line2 | ok  |\n'),
      );
    });
  });

  describe('Phase B: highlight / superscript / subscript nesting', () => {
    it('highlight with bold inside', () => {
      expect(roundTrip('==**bold highlight**==\n')).toBe(normalize('**==bold highlight==**\n'));
    });

    it('multiple superscripts', () => {
      expect(roundTrip('^2^+^3^\n')).toBe(normalize('^2^+^3^\n'));
    });

    it('subscript in list item', () => {
      expect(roundTrip('- H~2~O\n')).toBe(normalize('- H~2~O\n'));
    });

    it('highlight in blockquote', () => {
      expect(roundTrip('> ==important==\n')).toBe(normalize('> ==important==\n'));
    });
  });

  describe('Phase C: inline code', () => {
    it('code in list item', () => {
      expect(roundTrip('- `code item`\n')).toBe(normalize('- `code item`\n'));
    });

    it('code in blockquote', () => {
      expect(roundTrip('> `code quote`\n')).toBe(normalize('> `code quote`\n'));
    });

    it('code does not nest with bold (excludes)', () => {
      expect(roundTrip('`code **not bold**`\n')).toBe(normalize('`code **not bold**`\n'));
    });
  });

  describe('Phase D: link tokens', () => {
    it('link with title', () => {
      expect(roundTrip('[text](https://example.com "title")\n'))
        .toBe(normalize('[text](https://example.com "title")\n'));
    });

    it('link with bold inside (PM normalizes bold outside link)', () => {
      expect(roundTrip('[**bold link**](https://example.com)\n'))
        .toBe(normalize('**[bold link](https://example.com)**\n'));
    });

    it('link in list item', () => {
      expect(roundTrip('- [link](https://example.com)\n'))
        .toBe(normalize('- [link](https://example.com)\n'));
    });

    it('link in blockquote', () => {
      expect(roundTrip('> [link](https://example.com)\n'))
        .toBe(normalize('> [link](https://example.com)\n'));
    });
  });

  describe('edge cases', () => {
    it('empty document', () => {
      const result = roundTrip('');
      expect(result.trim()).toBe('');
    });

    it('multiple paragraphs', () => {
      const md = 'first\n\nsecond\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });

    it('escapes literal markdown punctuation', () => {
      const schema = createTestSchema();
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text('literal [text] (paren) *star* ~tilde~ ^sup^ ==mark== !bang|pipe`tick`'),
      ]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      expect(serializeMarkdown(doc))
        .toBe(normalize('literal \\[text\\] \\(paren\\) \\*star\\* \\~tilde\\~ \\^sup\\^ \\=\\=mark\\=\\= \\!bang\\|pipe\\`tick\\`\n'));
    });

    it('escapes dollar sign and curly braces and angle brackets', () => {
      const schema = createTestSchema();
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text('cost $5 {key} <tag> end'),
      ]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      expect(serializeMarkdown(doc))
        .toBe(normalize('cost \\$5 \\{key\\} \\<tag\\> end\n'));
    });

    it('escapes line-start hash to prevent heading misparse', () => {
      const schema = createTestSchema();
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text('#hashtag not a heading'),
      ]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      expect(serializeMarkdown(doc))
        .toBe(normalize('\\#hashtag not a heading\n'));
    });

    it('escapes line-start dash to prevent list misparse', () => {
      const schema = createTestSchema();
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text('-5 degrees'),
      ]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      expect(serializeMarkdown(doc))
        .toBe(normalize('\\-5 degrees\n'));
    });

    it('escapes line-start plus to prevent list misparse', () => {
      const schema = createTestSchema();
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text('+5 offset'),
      ]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      expect(serializeMarkdown(doc))
        .toBe(normalize('\\+5 offset\n'));
    });

    it('does not escape dash in middle of text', () => {
      const schema = createTestSchema();
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text('mid-dash here'),
      ]);
      const doc = schema.nodes.doc.create(null, [paragraph]);

      expect(serializeMarkdown(doc))
        .toBe(normalize('mid-dash here\n'));
    });

    it('escapes quoted link titles', () => {
      const md = '[text](https://example.com "say \\"hi\\"")\n';
      expect(roundTrip(md)).toBe(normalize(md));
    });
  });

  describe('callout', () => {
    it('callout with default type', () => {
      expect(roundTrip('> [!note]\n> hello\n')).toBe(normalize('> [!NOTE]\n> hello\n'));
    });

    it('callout with warning type', () => {
      expect(roundTrip('> [!warning]\n> be careful\n')).toBe(normalize('> [!WARNING]\n> be careful\n'));
    });

    it('callout with info type', () => {
      expect(roundTrip('> [!info]\n> some info\n')).toBe(normalize('> [!INFO]\n> some info\n'));
    });
  });

  describe('frontmatter', () => {
    it('parses and serializes YAML frontmatter', () => {
      const md = '---\ntitle: Hello\ncreated: 2025-01-01\n---\n\nbody text\n';
      expect(roundTrip(md)).toBe(normalize('---\ntitle: Hello\ncreated: 2025-01-01\n---\n\nbody text\n'));
    });

    it('frontmatter preserves multiple lines', () => {
      const md = '---\ntitle: My Document\ntags: [a, b, c]\ndraft: true\n---\n\nContent here\n';
      expect(roundTrip(md)).toBe(normalize('---\ntitle: My Document\ntags: [a, b, c]\ndraft: true\n---\n\nContent here\n'));
    });
  });

  describe('footnotes', () => {
    it('single footnote', () => {
      const md = 'Here is text[^1]\n\n[^1]: the footnote\n';
      expect(roundTrip(md)).toBe(normalize('Here is text[^1]\n\n[^1]: the footnote\n'));
    });

    it('multiple footnotes', () => {
      const md = 'First[^1] and second[^2]\n\n[^1]: First footnote\n\n[^2]: Second footnote\n';
      expect(roundTrip(md)).toBe(normalize('First[^1] and second[^2]\n\n[^1]: First footnote\n\n[^2]: Second footnote\n'));
    });

    it('footnote with rich text', () => {
      const md = 'Ref[^1]\n\n[^1]: **bold** and *italic* in footnote\n';
      expect(roundTrip(md)).toBe(normalize('Ref[^1]\n\n[^1]: **bold** and *italic* in footnote\n'));
    });
  });

  describe('table round-trip with inline marks', () => {
    it('bold in table cell', () => {
      const md = '| A | B |\n| --- | --- |\n| **bold** | plain |\n';
      expect(roundTrip(md)).toBe(
        normalize('| A        | B     |\n| -------- | ----- |\n| **bold** | plain |\n'),
      );
    });

    it('italic in table cell', () => {
      const md = '| A | B |\n| --- | --- |\n| *em* | plain |\n';
      expect(roundTrip(md)).toBe(
        normalize('| A    | B     |\n| ---- | ----- |\n| *em* | plain |\n'),
      );
    });

    it('inline code in table cell', () => {
      const md = '| A | B |\n| --- | --- |\n| `code` | plain |\n';
      expect(roundTrip(md)).toBe(
        normalize('| A      | B     |\n| ------ | ----- |\n| `code` | plain |\n'),
      );
    });

    it('mixed marks across cells', () => {
      const md = '| **a** | *b* | `c` |\n| --- | --- | --- |\n| x | y | z |\n';
      expect(roundTrip(md)).toBe(
        normalize('| **a** | *b* | `c` |\n| ----- | --- | --- |\n| x     | y   | z   |\n'),
      );
    });
  });
});
