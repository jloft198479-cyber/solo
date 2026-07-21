// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';

import { createMarkdownCompatSchema } from '../../markdown/compat-schema';
import {
  hasMarkdownOnlySyntax,
  looksLikeMarkdownTable,
  markdownPastePlugin,
  parseMarkdownTablePaste,
} from '../markdown-paste';

describe('looksLikeMarkdownTable', () => {
  it('recognizes a standard GFM table', () => {
    expect(looksLikeMarkdownTable('| A | B |\n| --- | --- |\n| 1 | 2 |')).toBe(true);
  });

  it('recognizes alignment separators', () => {
    expect(looksLikeMarkdownTable('| A | B | C |\n|:---|:---:|---:|\n| 1 | 2 | 3 |')).toBe(true);
  });

  it('recognizes a table without leading/trailing pipes', () => {
    expect(looksLikeMarkdownTable('A | B\n--- | ---\n1 | 2')).toBe(true);
  });

  it('recognizes a single-column table', () => {
    expect(looksLikeMarkdownTable('| A |\n| --- |\n| 1 |')).toBe(true);
  });

  it('rejects plain text', () => {
    expect(looksLikeMarkdownTable('hello world')).toBe(false);
    expect(looksLikeMarkdownTable('a | b but no separator row')).toBe(false);
  });

  it('rejects a single line', () => {
    expect(looksLikeMarkdownTable('| A | B |')).toBe(false);
  });

  it('rejects when the second line is not a separator', () => {
    expect(looksLikeMarkdownTable('| A | B |\n| 1 | 2 |')).toBe(false);
  });

  it('rejects prose that merely contains pipes', () => {
    expect(looksLikeMarkdownTable('use a | b in shell\nthen pipe to grep')).toBe(false);
  });
});

describe('parseMarkdownTablePaste', () => {
  const schema = createMarkdownCompatSchema();

  it('parses a GFM table into an insertable slice containing a table node', () => {
    const slice = parseMarkdownTablePaste(schema, '| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(slice).not.toBeNull();

    let hasTable = false;
    let rowCount = 0;
    slice!.content.descendants((node) => {
      if (node.type.name === 'table') hasTable = true;
      if (node.type.name === 'tableRow') rowCount += 1;
      return true;
    });
    expect(hasTable).toBe(true);
    // 表头行 + 一行数据 = 2 行。
    expect(rowCount).toBe(2);
  });

  it('returns null for non-table text', () => {
    expect(parseMarkdownTablePaste(schema, 'just a paragraph')).toBeNull();
  });

  it('returns null for an incomplete table (no separator row)', () => {
    expect(parseMarkdownTablePaste(schema, '| A | B |\n| 1 | 2 |')).toBeNull();
  });
});

describe('markdownPastePlugin handlePaste（真实 EditorView 端到端）', () => {
  const schema = createMarkdownCompatSchema();
  let view: EditorView | null = null;
  let mount: HTMLElement | null = null;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });
  afterEach(() => {
    if (view && !view.isDestroyed) view.destroy();
    view = null;
    if (mount) mount.remove();
    mount = null;
  });

  function mountEmpty(): EditorView {
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1),
      plugins: [markdownPastePlugin()],
    });
    view = new EditorView(mount!, { state });
    return view;
  }

  // 仅模拟 handlePaste 实际读取的 clipboardData.getData；用 ProseMirror 自己的
  // someProp 分发，等价于真实粘贴时引擎调用 handlePaste 的路径。
  function pasteEvent(parts: Record<string, string>): ClipboardEvent {
    return {
      clipboardData: { getData: (type: string) => parts[type] ?? '' },
    } as unknown as ClipboardEvent;
  }

  function firePaste(v: EditorView, event: ClipboardEvent): boolean {
    return Boolean(
      v.someProp('handlePaste', (handler) => handler(v, event, Slice.empty)),
    );
  }

  function tableIn(doc: PMNode): PMNode | null {
    let found: PMNode | null = null;
    doc.descendants((node) => {
      if (node.type.name === 'table') found = node;
      return !found;
    });
    return found;
  }

  it('粘贴 GFM 表格文本 → 插入真实表格节点', () => {
    const v = mountEmpty();
    const handled = firePaste(
      v,
      pasteEvent({ 'text/plain': '| A | B |\n| --- | --- |\n| 1 | 2 |' }),
    );

    expect(handled).toBe(true);
    const table = tableIn(v.state.doc);
    expect(table).not.toBeNull();
    expect(table!.textContent).toContain('A');
    expect(table!.textContent).toContain('2');
  });

  it('粘贴纯文本（无 HTML）→ 拦截并走兜底（最终插入纯文本，内容不丢）', async () => {
    const v = mountEmpty();
    const handled = firePaste(v, pasteEvent({ 'text/plain': 'just a paragraph' }));

    expect(handled).toBe(true);
    // 兜底路径异步把纯文本插入文档（navigator.clipboard.read 在测试环境返回 promise，需 flush）
    await new Promise((r) => setTimeout(r, 0));
    expect(v.state.doc.textContent).toContain('just a paragraph');
    expect(tableIn(v.state.doc)).toBeNull();
  });

  it('剪贴板带富文本 <table> → 显式解析并插入表格节点（保留格式）', () => {
    const v = mountEmpty();
    const handled = firePaste(
      v,
      pasteEvent({
        'text/plain': '| A | B |\n| --- | --- |\n| 1 | 2 |',
        'text/html': '<table><tr><td>A</td><td>B</td></tr></table>',
      }),
    );

    expect(handled).toBe(true);
    expect(tableIn(v.state.doc)).not.toBeNull();
  });

  it('粘贴富文本 <strong> → 插入加粗节点（验证 HTML 真的还原了格式）', () => {
    const v = mountEmpty();
    const handled = firePaste(
      v,
      pasteEvent({
        'text/plain': 'Hello world',
        'text/html': '<p>Hello <strong>world</strong></p>',
      }),
    );

    expect(handled).toBe(true);
    let hasBold = false;
    v.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'bold')) hasBold = true;
      return !hasBold;
    });
    expect(hasBold).toBe(true);
  });

  it('粘贴富文本 <h2> → 插入二级标题节点（验证标题格式还原）', () => {
    const v = mountEmpty();
    const handled = firePaste(
      v,
      pasteEvent({
        'text/plain': 'Section',
        'text/html': '<h2>Section</h2>',
      }),
    );

    expect(handled).toBe(true);
    let hasH2 = false;
    v.state.doc.descendants((node) => {
      if (node.type.name === 'heading' && node.attrs.level === 2) hasH2 = true;
      return !hasH2;
    });
    expect(hasH2).toBe(true);
  });
});

describe('hasMarkdownOnlySyntax 误判防护', () => {
  it('货币/价格 "$10 到 $20" 不误判为 markdown 源', () => {
    expect(hasMarkdownOnlySyntax('价格从 $10 到 $20 不等')).toBe(false);
  });

  it('行内数学 "$x^2$" 仍判为 markdown 源', () => {
    expect(hasMarkdownOnlySyntax('公式是 $x^2$ 没错')).toBe(true);
  });

  it('普通含 $ 文本（无成对 $）不误判', () => {
    expect(hasMarkdownOnlySyntax('这家公司估值 $5B')).toBe(false);
  });
});
