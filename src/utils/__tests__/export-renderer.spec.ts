import { describe, expect, it } from 'vitest';
import { createMarkdownCompatSchema } from '../../components/Editor/tiptap/markdown/compat-schema';
import {
  buildExportTree,
  renderEditorDocToHtmlDocument,
  renderEditorDocToWechatFragment,
} from '../export-renderer';
import { renderWechatFragment } from '../export/renderers/wechat';
import type { ExportDocument } from '../export/model';

function createSemanticDoc() {
  const schema = createMarkdownCompatSchema();

  return schema.nodes.doc.create(null, [
    schema.nodes.heading.create({ level: 1 }, [schema.text('Heading')]),
    schema.nodes.paragraph.create(null, [
      schema.nodes.wikilink.create({ target: 'Page', alias: 'Alias' }),
    ]),
    schema.nodes.paragraph.create(null, [schema.nodes.mathInline.create({ latex: 'inline' })]),
    schema.nodes.mathBlock.create(null, [schema.text('a^2 + b^2 = c^2')]),
    schema.nodes.mermaidBlock.create(null, [schema.text('graph TD\nA-->B')]),
    schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, [
        schema.nodes.tableHeader.create(null, [
          schema.nodes.paragraph.create(null, [schema.text('H1')]),
        ]),
        schema.nodes.tableHeader.create(null, [
          schema.nodes.paragraph.create(null, [schema.text('H2')]),
        ]),
      ]),
      schema.nodes.tableRow.create(null, [
        schema.nodes.tableCell.create(null, [
          schema.nodes.paragraph.create(null, [schema.text('A')]),
        ]),
        schema.nodes.tableCell.create(null, [
          schema.nodes.paragraph.create(null, [schema.text('B')]),
        ]),
      ]),
    ]),
    schema.nodes.taskList.create(null, [
      schema.nodes.taskItem.create({ checked: true }, [
        schema.nodes.paragraph.create(null, [schema.text('done')]),
      ]),
    ]),
  ]);
}

describe('buildExportTree', () => {
  it('builds semantic headings and keeps stable mark order', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.heading.create({ level: 2 }, [schema.text('Export Title')]),
      schema.nodes.paragraph.create(null, [
        schema.text('Hello', [schema.marks.bold.create(), schema.marks.italic.create()]),
      ]),
    ]);

    const tree = buildExportTree(doc);

    expect(tree.blocks).toHaveLength(2);
    expect(tree.blocks[0]).toMatchObject({
      kind: 'heading',
      level: 2,
      inlines: [{ kind: 'text', text: 'Export Title' }],
    });
    expect(tree.blocks[1]).toMatchObject({
      kind: 'paragraph',
      inlines: [
        {
          kind: 'text',
          text: 'Hello',
          marks: [{ kind: 'bold' }, { kind: 'italic' }],
        },
      ],
    });
  });

  it('extracts custom node attrs', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.nodes.wikilink.create({ target: 'Roadmap', alias: '产品路线图' }),
      ]),
    ]);

    const tree = buildExportTree(doc);

    expect(tree.blocks[0]).toMatchObject({
      kind: 'paragraph',
      inlines: [
        {
          kind: 'wikilink',
          target: 'Roadmap',
          alias: '产品路线图',
        },
      ],
    });
  });
});

describe('renderEditorDocToHtmlDocument', () => {
  it('renders full html document from editor semantics', async () => {
    const doc = createSemanticDoc();

    const html = await renderEditorDocToHtmlDocument(doc, {
      themeId: 'blue',
      fileName: 'fallback',
    });

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('data-wikilink="Page"');
    expect(html).not.toContain('wikilink://');
    expect(html).toContain('class="ml-export-math-block"');
    expect(html).toContain('data-mermaid-source="graph TD');
    expect(html).toContain('class="ml-export-table"');
    expect(html).toContain('ml-export-task-list');
  });

  it('sanitizes dangerous link protocols in exported html', async () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('safe', [
          schema.marks.link.create({ href: 'https://example.com', title: null }),
        ]),
        schema.text(' unsafe', [
          schema.marks.link.create({ href: 'javascript:alert(1)', title: null }),
        ]),
      ]),
    ]);

    const html = await renderEditorDocToHtmlDocument(doc);

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="#"');
    expect(html).not.toContain('href="javascript:alert(1)"');
  });
});

describe('renderEditorDocToWechatFragment', () => {
  it('renders fragment html and plain text fallback with target-specific downgrades', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.nodes.wikilink.create({ target: 'Wiki', alias: '' }),
      ]),
      schema.nodes.paragraph.create(null, [schema.nodes.mathInline.create({ latex: 'inline' })]),
      schema.nodes.mermaidBlock.create(null, [schema.text('graph TD\nA-->B')]),
    ]);

    const result = renderEditorDocToWechatFragment(doc, { themeId: 'green' });

    expect(result.html).not.toContain('<!doctype html>');
    // 微信渲染器不输出 data-* 属性（微信会剥离）
    expect(result.html).not.toContain('data-wikilink');
    expect(result.html).not.toContain('data-math-inline');
    expect(result.html).not.toContain('data-mermaid-source');
    expect(result.html).not.toContain('data-lang');
    // wikilink 内容应作为 span 渲染
    expect(result.html).toContain('>Wiki<');
    // 数学公式应渲染为 code 元素
    expect(result.html).toContain('inline');
    // Mermaid 应渲染为源码块
    expect(result.html).toContain('Mermaid');
    expect(result.html).toContain('graph TD');
    // B7: 数学公式块应包含提示文案
    expect(result.text).toContain('Wiki');
  });

  it('sanitizes dangerous link protocols in copied wechat html', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('unsafe', [
          schema.marks.link.create({ href: 'javascript:alert(1)', title: null }),
        ]),
      ]),
    ]);

    const result = renderEditorDocToWechatFragment(doc);

    // 微信渲染器将危险链接降级为 span（无 href）
    expect(result.html).not.toContain('href="javascript:alert(1)"');
    expect(result.html).not.toContain('href="#"');
    expect(result.html).toContain('unsafe');
  });

  it('preserves ordered list start attribute', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.orderedList.create({ start: 5 }, [
        schema.nodes.listItem.create(null, [
          schema.nodes.paragraph.create(null, [schema.text('fifth')]),
        ]),
      ]),
    ]);

    const result = renderEditorDocToWechatFragment(doc);

    expect(result.html).toContain('start="5"');
  });

  it('renders highlight as span with theme color', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('highlighted', [schema.marks.highlight.create()]),
      ]),
    ]);

    const result = renderEditorDocToWechatFragment(doc, { themeId: 'scholar-light' });

    // 微信渲染器用 <span> 替代 <mark>，高亮色跟随主题
    expect(result.html).not.toContain('<mark');
    expect(result.html).toContain('background:');
    expect(result.html).toContain('highlighted');
  });

  it('renders sup/sub as span for wechat compatibility', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('2', [schema.marks.superscript.create()]),
        schema.text(' and '),
        schema.text('2', [schema.marks.subscript.create()]),
      ]),
    ]);

    const result = renderEditorDocToWechatFragment(doc);

    expect(result.html).not.toContain('<sup>');
    expect(result.html).not.toContain('<sub>');
    expect(result.html).toContain('vertical-align:super');
    expect(result.html).toContain('vertical-align:sub');
  });

  it('renders callout with chinese title', () => {
    // callout 不在 compat schema 中，直接构建 ExportDocument IR
    const doc: ExportDocument = {
      kind: 'document',
      metadata: { frontmatterRaw: null, frontmatter: {}, title: '', meta: [] },
      blocks: [
        {
          kind: 'callout',
          calloutType: 'warning',
          title: '',
          blocks: [
            { kind: 'paragraph', inlines: [{ kind: 'text', text: 'careful', marks: [] }] },
          ],
        },
      ],
    };

    const result = renderWechatFragment(doc, { themeId: 'scholar-light' });

    expect(result.html).toContain('警告');
    expect(result.html).toContain('careful');
  });

  it('forces light theme for dark theme export', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [schema.text('hello')]),
    ]);

    // scholar-dark 是暗色主题
    const result = renderEditorDocToWechatFragment(doc, { themeId: 'scholar-dark' });

    // 微信导出应强制白底深色文字
    expect(result.html).toContain('#ffffff');
    expect(result.html).not.toContain('background:#1e1e2e');
    expect(result.html).toContain('hello');
  });

  it('renders math block with hint label', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.mathBlock.create(null, [schema.text('E = mc^2')]),
    ]);

    const result = renderEditorDocToWechatFragment(doc, { themeId: 'scholar-light' });

    // B7: 数学公式块应包含提示文案
    expect(result.html).toContain('数学公式');
    expect(result.html).toContain('E = mc^2');
  });

  it('renders safe links as anchor tags', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('link', [
          schema.marks.link.create({ href: 'https://example.com', title: null }),
        ]),
      ]),
    ]);

    const result = renderEditorDocToWechatFragment(doc);

    expect(result.html).toContain('href="https://example.com"');
    expect(result.html).toContain('link');
  });

  it('does not output data-lang attribute on code blocks', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.codeBlock.create({ language: 'typescript' }, [schema.text('const x = 1;')]),
    ]);

    const result = renderEditorDocToWechatFragment(doc);

    // B2: 微信会剥离 data-* 属性，不再输出
    expect(result.html).not.toContain('data-lang');
    expect(result.html).toContain('const x = 1;');
  });

  it('uses imageMap to resolve local image src in IR stage', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.nodes.image.create({ src: 'local/image.png', alt: 'test', title: null }),
      ]),
    ]);

    const imageMap = new Map([['local/image.png', 'data:image/png;base64,abc123']]);

    const result = renderWechatFragment(
      { kind: 'document', metadata: { frontmatterRaw: null, frontmatter: {}, title: '', meta: [] }, blocks: [
        { kind: 'paragraph', inlines: [
          { kind: 'image', src: 'local/image.png', alt: 'test', title: null, marks: [] },
        ] },
      ] },
      { themeId: 'scholar-light', imageMap },
    );

    // C2: imageMap 在 IR 渲染阶段直接替换 src，不依赖字符串后替换
    expect(result.html).toContain('data:image/png;base64,abc123');
    expect(result.html).not.toContain('local/image.png');
  });

  it('renders code block with 6px border radius', () => {
    const schema = createMarkdownCompatSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.codeBlock.create({ language: 'rust' }, [schema.text('fn main() {}')]),
    ]);

    const result = renderEditorDocToWechatFragment(doc);

    // B5: 代码块 <pre> 圆角 6px（根容器 <div> 仍为 8px）
    expect(result.html).toContain('border-radius:6px');
    // 根容器是 8px，代码块不应是 12px
    expect(result.html).not.toContain('border-radius:12px');
    expect(result.html).toContain('fn main() {}');
  });

  it('renders callout with 6px border radius', () => {
    const doc: ExportDocument = {
      kind: 'document',
      metadata: { frontmatterRaw: null, frontmatter: {}, title: '', meta: [] },
      blocks: [
        {
          kind: 'callout',
          calloutType: 'tip',
          title: '',
          blocks: [
            { kind: 'paragraph', inlines: [{ kind: 'text', text: 'tip text', marks: [] }] },
          ],
        },
      ],
    };

    const result = renderWechatFragment(doc, { themeId: 'scholar-light' });

    expect(result.html).toContain('提示');
    expect(result.html).toContain('border-radius:6px');
  });
});
