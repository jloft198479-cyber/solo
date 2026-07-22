// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';

import { createMarkdownCompatSchema } from '../../markdown/compat-schema';
import {
  hasMarkdownOnlySyntax,
  isLowQualityParse,
  looksLikeMarkdownTable,
  markdownPastePlugin,
  parseHtmlSlice,
  parseMarkdownTablePaste,
} from '../markdown-paste';

// 模拟系统剪贴板 HTML 读取（前端 readClipboardHtml → Rust read_clipboard_html 命令，
// 测试环境无 Tauri 运行时，故整体 mock）。默认返回 null（降级纯文本）；
// 特定用例改为返回富文本 HTML 以验证兜底路径。
const clipboardMocks = vi.hoisted(() => ({
  readClipboardHtml: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../../services/tauri/clipboard', () => ({
  readClipboardHtml: clipboardMocks.readClipboardHtml,
}));

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
    // 系统剪贴板也无 HTML → 最终降级为纯文本插入
    clipboardMocks.readClipboardHtml.mockResolvedValue(null);
    const v = mountEmpty();
    const handled = firePaste(v, pasteEvent({ 'text/plain': 'just a paragraph' }));

    expect(handled).toBe(true);
    // 兜底路径异步把纯文本插入文档（需 flush 微任务）
    await new Promise((r) => setTimeout(r, 0));
    expect(v.state.doc.textContent).toContain('just a paragraph');
    expect(tableIn(v.state.doc)).toBeNull();
  });

  it('粘贴事件无 text/html 时，从系统剪贴板读 HTML 并还原加粗格式（Rust 命令兜底）', async () => {
    // 模拟桌面端真实场景：粘贴事件只带 text/plain，但系统剪贴板里存着富文本 HTML
    clipboardMocks.readClipboardHtml.mockResolvedValue('<p>Hello <strong>world</strong></p>');
    const v = mountEmpty();
    const handled = firePaste(v, pasteEvent({ 'text/plain': 'Hello world' }));

    expect(handled).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    let hasBold = false;
    v.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'bold')) hasBold = true;
      return !hasBold;
    });
    expect(hasBold).toBe(true);
    clipboardMocks.readClipboardHtml.mockResolvedValue(null);
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

  it('粘贴纯 markdown 源（无 HTML + 系统剪贴板也无 HTML）→ markdown 解析为 heading/blockquote/listItem/bold（豆包场景）', async () => {
    // 复现用户报告：豆包复制时只给 text/plain（webview 漏 text/html），
    // 系统剪贴板也无 HTML（readClipboardHtml 返回 null）。
    // 期望：markdown 解析为结构化节点，heading/blockquote/listItem/bold 全部命中。
    clipboardMocks.readClipboardHtml.mockResolvedValue(null);
    const v = mountEmpty();
    const mdText = [
      '# 标题一',
      '**加粗文本**',
      '',
      '> 引用内容',
      '',
      '- 列表项 1',
      '- 列表项 2',
    ].join('\n');
    const handled = firePaste(v, pasteEvent({ 'text/plain': mdText }));

    expect(handled).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    let hasHeading = false;
    let hasBlockquote = false;
    let hasListItem = false;
    let hasBold = false;
    v.state.doc.descendants((node) => {
      if (node.type.name === 'heading') hasHeading = true;
      if (node.type.name === 'blockquote') hasBlockquote = true;
      if (node.type.name === 'listItem') hasListItem = true;
      if (node.isText && node.marks.some((m) => m.type.name === 'bold')) hasBold = true;
      return true;
    });
    expect(hasHeading).toBe(true);
    expect(hasBlockquote).toBe(true);
    expect(hasListItem).toBe(true);
    expect(hasBold).toBe(true);
  });

  it('text/plain 是 markdown 源 + html 是壳（AI 工具通用：豆包/千问等）→ 走 markdown 解析保留格式', () => {
    // 复现通用场景：AI 工具把 markdown 源字面包在 <pre>/<div> 里放进剪贴板 HTML。
    // DOMParser 不解析 markdown，壳里是字面字符；修复后步骤 2.5 嗅探到 text/plain
    // 含通用 markdown 语法 → 走 markdown 解析，无视 HTML 壳。
    const v = mountEmpty();
    const mdText = '# 标题\n\n**加粗**\n\n> 引用\n\n- 列表项';
    const htmlShell = `<pre>${mdText}</pre>`;
    const handled = firePaste(v, pasteEvent({
      'text/plain': mdText,
      'text/html': htmlShell,
    }));

    expect(handled).toBe(true);

    let hasHeading = false;
    let hasBold = false;
    let hasBlockquote = false;
    v.state.doc.descendants((node) => {
      if (node.type.name === 'heading') hasHeading = true;
      if (node.isText && node.marks.some((m) => m.type.name === 'bold')) hasBold = true;
      if (node.type.name === 'blockquote') hasBlockquote = true;
      return true;
    });
    expect(hasHeading).toBe(true);
    expect(hasBold).toBe(true);
    expect(hasBlockquote).toBe(true);
  });

  it('P0 质量兜底：系统剪贴板是装饰性 HTML（千问/豆包文档）+ 纯文本是 markdown 源 → 救回 markdown 格式', async () => {
    // 复现千问/豆包文档场景：WebView2 粘贴事件不带 text/html，从系统剪贴板读到的是
    // 装饰性 HTML（span+inline style，无语义标签），DOMParser 解析后只剩纯段落、格式全丢。
    // 纯文本其实是 markdown 源。期望：P0 检测到解析塌方 → 改用 markdown 解析，救回格式。
    clipboardMocks.readClipboardHtml.mockResolvedValue(
      '<p><span style="font-weight:700">标题</span></p><p><span style="font-size:16px">正文内容</span></p>',
    );
    const v = mountEmpty();
    const mdText = '# 标题\n\n**重点内容**\n\n- 项目一\n- 项目二';
    const handled = firePaste(v, pasteEvent({ 'text/plain': mdText }));

    expect(handled).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    let hasHeading = false;
    let hasBold = false;
    let hasListItem = false;
    v.state.doc.descendants((node) => {
      if (node.type.name === 'heading') hasHeading = true;
      if (node.type.name === 'listItem') hasListItem = true;
      if (node.isText && node.marks.some((m) => m.type.name === 'bold')) hasBold = true;
      return true;
    });
    expect(hasHeading).toBe(true);
    expect(hasBold).toBe(true);
    expect(hasListItem).toBe(true);
    clipboardMocks.readClipboardHtml.mockResolvedValue(null);
  });

  it('P0 回归守卫：系统剪贴板是规范富文本 HTML（含标题/加粗）→ 不被误救，保留原格式', async () => {
    // 守卫「不朝坏的方向发展」：当系统剪贴板 HTML 本身规范（h2+strong，解析后含结构），
    // 即使纯文本也是 markdown 源，isLowQualityParse 返回 false → 沿用 HTML 解析，不被误改。
    clipboardMocks.readClipboardHtml.mockResolvedValue(
      '<h2>章节标题</h2><p>这是 <strong>加粗</strong> 正文</p>',
    );
    const v = mountEmpty();
    const mdText = '# 不同的标题\n\n- 列表项';
    const handled = firePaste(v, pasteEvent({ 'text/plain': mdText }));

    expect(handled).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    // 应保留 HTML 的 h2（level 2），而非被 markdown 的 h1 覆盖
    let hasH2 = false;
    let hasBold = false;
    let hasListItem = false;
    v.state.doc.descendants((node) => {
      if (node.type.name === 'heading' && node.attrs.level === 2) hasH2 = true;
      if (node.isText && node.marks.some((m) => m.type.name === 'bold')) hasBold = true;
      if (node.type.name === 'listItem') hasListItem = true;
      return true;
    });
    expect(hasH2).toBe(true);
    expect(hasBold).toBe(true);
    // 不应出现 markdown 源的列表（证明没走 markdown 解析）
    expect(hasListItem).toBe(false);
    clipboardMocks.readClipboardHtml.mockResolvedValue(null);
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

describe('isLowQualityParse（P0 质量兜底判定）', () => {
  const schema = createMarkdownCompatSchema();

  function sliceOf(html: string) {
    return parseHtmlSlice(schema, html);
  }

  it('多个无格式纯段落 → 判为塌方（装饰性 HTML 的典型后果）', () => {
    const slice = sliceOf('<p><span style="font-weight:700">一</span></p><p><span>二</span></p>');
    expect(slice).not.toBeNull();
    expect(isLowQualityParse(slice!)).toBe(true);
  });

  it('段落含加粗 mark → 不塌方（保住了行内格式）', () => {
    const slice = sliceOf('<p>Hello <strong>world</strong></p><p>plain</p>');
    expect(isLowQualityParse(slice!)).toBe(false);
  });

  it('含标题块 → 不塌方（保住了块级结构）', () => {
    const slice = sliceOf('<h2>标题</h2><p>正文</p>');
    expect(isLowQualityParse(slice!)).toBe(false);
  });

  it('单个纯段落 → 不塌方（避免对 legitimately 纯文本误救）', () => {
    const slice = sliceOf('<p>just one paragraph</p>');
    expect(isLowQualityParse(slice!)).toBe(false);
  });
});
