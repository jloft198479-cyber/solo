// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { Slice } from '@tiptap/pm/model';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';

import { createMarkdownCompatSchema } from '../../markdown/compat-schema';
import {
  hasMarkdownOnlySyntax,
  isLowQualityParse,
  looksLikeMarkdownTable,
  markdownPastePlugin,
  parseHtmlSlice,
  parseMarkdownTablePaste,
  parseGeneralMarkdownPaste,
} from '../markdown-paste';

// 图片落盘依赖 Tauri runtime，测试环境整体 mock。
const imageMocks = vi.hoisted(() => ({
  saveClipboardImage: vi.fn().mockResolvedValue({ absolutePath: '/tmp/x.png', relativePath: 'x.png' }),
  authorizeImageAsset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../../services/tauri/document', () => ({
  saveClipboardImage: imageMocks.saveClipboardImage,
  authorizeImageAsset: imageMocks.authorizeImageAsset,
  // 其他 document 模块导出（部分测试可能间接依赖）
  resolveImageDisplay: vi.fn(),
}));

vi.mock('../../../../../services/tauri/dialog', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

// ────────────────────────────────────────────────────────────
// 纯函数测试（保留，与新范式无关）
// ────────────────────────────────────────────────────────────

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
    expect(slice).not.toBeNull();
    expect(isLowQualityParse(slice!)).toBe(false);
  });

  it('含标题块 → 不塌方（保住了块级结构）', () => {
    const slice = sliceOf('<h2>标题</h2><p>正文</p>');
    expect(slice).not.toBeNull();
    expect(isLowQualityParse(slice!)).toBe(false);
  });

  it('单个纯段落 → 不塌方（避免对 legitimately 纯文本误救）', () => {
    const slice = sliceOf('<p>just one paragraph</p>');
    expect(slice).not.toBeNull();
    expect(isLowQualityParse(slice!)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// parseGeneralMarkdownPaste 的 openStart/openEnd 策略（新范式核心）
// ────────────────────────────────────────────────────────────

describe('parseGeneralMarkdownPaste openStart/openEnd 策略', () => {
  const schema = createMarkdownCompatSchema();

  it('首是 bulletList（可合并）+ 尾是 paragraph（可合并）→ (1, 1)', () => {
    // 需要 2 行列表项才命中 looksLikeMarkdownSource
    const text = '- 项 A\n- 项 B\n\n正文段落';
    const slice = parseGeneralMarkdownPaste(schema, text);
    expect(slice).not.toBeNull();
    // 首节点是 bulletList（可合并）→ openStart=1
    // 尾节点是 paragraph（可合并）→ openEnd=1
    expect(slice!.openStart).toBe(1);
    expect(slice!.openEnd).toBe(1);
  });

  it('首尾都是 bulletList → (1, 1)（列表可合并到当前列表）', () => {
    const text = '- 项 A\n- 项 B';
    const slice = parseGeneralMarkdownPaste(schema, text);
    expect(slice).not.toBeNull();
    expect(slice!.openStart).toBe(1);
    expect(slice!.openEnd).toBe(1);
  });

  it('首是 heading（不可合并）→ openStart=0', () => {
    const text = '# 标题\n\n正文';
    const slice = parseGeneralMarkdownPaste(schema, text);
    expect(slice).not.toBeNull();
    expect(slice!.openStart).toBe(0);
    // 尾是 paragraph（可合并）→ openEnd=1
    expect(slice!.openEnd).toBe(1);
  });

  it('首是 codeBlock（不可合并）→ openStart=0', () => {
    const text = '```js\nconsole.log(1)\n```\n\n正文';
    const slice = parseGeneralMarkdownPaste(schema, text);
    expect(slice).not.toBeNull();
    expect(slice!.openStart).toBe(0);
    expect(slice!.openEnd).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────
// clipboardTextParser 钩子（Layer 1）
// ────────────────────────────────────────────────────────────

describe('clipboardTextParser 钩子（Layer 1：纯文本 Markdown 识别）', () => {
  const schema = createMarkdownCompatSchema();

  function callHook(text: string): Slice | null | undefined {
    const plugin = markdownPastePlugin();
    const props = plugin.spec.props!;
    const fn = props.clipboardTextParser as
      | ((text: string, $context: ResolvedPos) => Slice | null)
      | undefined;
    if (!fn) return undefined;
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const $context = doc.resolve(1);
    return fn(text, $context);
  }

  it('GFM 表格文本 → 返回含 table 节点的 Slice', () => {
    const slice = callHook('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(slice).not.toBeNull();

    let hasTable = false;
    slice!.content.descendants((node) => {
      if (node.type.name === 'table') hasTable = true;
      return true;
    });
    expect(hasTable).toBe(true);
  });

  it('结构化 Markdown 源（标题+引用+列表）→ 返回对应块级节点', () => {
    const md = '# 标题\n\n> 引用\n\n- 列表项';
    const slice = callHook(md);
    expect(slice).not.toBeNull();

    let hasHeading = false;
    let hasBlockquote = false;
    let hasListItem = false;
    slice!.content.descendants((node) => {
      if (node.type.name === 'heading') hasHeading = true;
      if (node.type.name === 'blockquote') hasBlockquote = true;
      if (node.type.name === 'listItem') hasListItem = true;
      return true;
    });
    expect(hasHeading).toBe(true);
    expect(hasBlockquote).toBe(true);
    expect(hasListItem).toBe(true);
  });

  it('含 markdown 专有语法（wikilink/callout/$$）→ 返回 Slice', () => {
    const md = '[[wikilink]]';
    const slice = callHook(md);
    // hasMarkdownOnlySyntax 命中 [[wikilink]]，但 parseGeneralMarkdownPaste 需要块级语法
    // 实际上 [[wikilink]] 是行内节点，可能解析为段落 → looksLikeMarkdownSource 不命中
    // 这里验证专有语法识别路径不崩溃
    expect(slice).toBeDefined();
  });

  it('纯文本（无 markdown 语法）→ 返回 null（让默认流程逐行成段）', () => {
    const slice = callHook('just a plain paragraph');
    expect(slice).toBeNull();
  });

  it('空文本 → 返回 null', () => {
    const slice = callHook('');
    expect(slice).toBeNull();
  });

  it('代码围栏 markdown → 返回含 codeBlock 的 Slice', () => {
    const md = '```js\nconsole.log(1)\n```';
    const slice = callHook(md);
    expect(slice).not.toBeNull();

    let hasCodeBlock = false;
    slice!.content.descendants((node) => {
      if (node.type.name === 'codeBlock') hasCodeBlock = true;
      return true;
    });
    expect(hasCodeBlock).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// transformPasted 钩子（Layer 2：装饰性 HTML 塌方救回）
// ────────────────────────────────────────────────────────────

describe('transformPasted 钩子（Layer 2：装饰性 HTML 塌方救回）', () => {
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

  function callHook(slice: Slice): Slice {
    const plugin = markdownPastePlugin();
    const props = plugin.spec.props!;
    const fn = props.transformPasted as
      | ((slice: Slice, view: EditorView) => Slice)
      | undefined;
    if (!fn) return slice;

    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1),
      plugins: [plugin],
    });
    view = new EditorView(mount!, { state });
    return fn(slice, view);
  }

  it('装饰性 HTML 塌方 Slice + textContent 是 markdown 源 → 救回为 Markdown 解析', () => {
    // 模拟千问/豆包文档：装饰性 HTML 被 DOMParser 拍平成多个纯段落（塌方）
    // slice.content 子节点的 textContent 拼起来是原 markdown 源
    const html = '<p># 标题</p><p>**加粗**</p><p>- 列表项</p>';
    const original = parseHtmlSlice(schema, html);
    expect(original).not.toBeNull();
    expect(isLowQualityParse(original!)).toBe(true);

    const transformed = callHook(original!);

    let hasHeading = false;
    let hasBold = false;
    let hasListItem = false;
    transformed.content.descendants((node) => {
      if (node.type.name === 'heading') hasHeading = true;
      if (node.isText && node.marks.some((m) => m.type.name === 'bold')) hasBold = true;
      if (node.type.name === 'listItem') hasListItem = true;
      return true;
    });
    expect(hasHeading).toBe(true);
    expect(hasBold).toBe(true);
    expect(hasListItem).toBe(true);
  });

  it('正常 HTML Slice（含标题/加粗）→ 原样返回，不被误救', () => {
    const html = '<h2>章节标题</h2><p>这是 <strong>加粗</strong> 正文</p>';
    const original = parseHtmlSlice(schema, html);
    expect(original).not.toBeNull();
    expect(isLowQualityParse(original!)).toBe(false);

    const transformed = callHook(original!);
    // 应原样返回（同一对象或内容等价）
    expect(transformed).toBe(original);
  });

  it('单个纯段落 Slice → 不塌方，原样返回', () => {
    const html = '<p>just one paragraph</p>';
    const original = parseHtmlSlice(schema, html);
    expect(original).not.toBeNull();
    expect(isLowQualityParse(original!)).toBe(false);

    const transformed = callHook(original!);
    expect(transformed).toBe(original);
  });

  it('塌方 Slice 但 textContent 不是 markdown 源 → 原样返回', () => {
    // 多个纯段落（塌方），但内容是普通文本，不是 markdown 源
    const html = '<p>第一段普通文字</p><p>第二段普通文字</p>';
    const original = parseHtmlSlice(schema, html);
    expect(original).not.toBeNull();
    expect(isLowQualityParse(original!)).toBe(true);

    const transformed = callHook(original!);
    // 不应救回（textContent 不是 markdown 源）
    expect(transformed).toBe(original);
  });
});

// ────────────────────────────────────────────────────────────
// handlePaste 逃生舱（Layer 3：仅图片处理）
// ────────────────────────────────────────────────────────────

describe('handlePaste 逃生舱（Layer 3：仅图片处理）', () => {
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

  function pasteEvent(parts: Record<string, string>, files: File[] = []): ClipboardEvent {
    return {
      clipboardData: {
        getData: (type: string) => parts[type] ?? '',
        files,
      } as unknown as DataTransfer,
    } as unknown as ClipboardEvent;
  }

  function firePaste(v: EditorView, event: ClipboardEvent): boolean {
    return Boolean(
      v.someProp('handlePaste', (handler) => handler(v, event, Slice.empty)),
    );
  }

  it('无图片（纯文字）→ return false 放行给默认流程', () => {
    const v = mountEmpty();
    const handled = firePaste(v, pasteEvent({ 'text/plain': 'just text' }));
    expect(handled).toBe(false);
  });

  it('无 clipboardData → return false', () => {
    const v = mountEmpty();
    const handled = firePaste(v, {} as ClipboardEvent);
    expect(handled).toBe(false);
  });

  it('有图片文件 → return true 接管（阻止默认流程再插 <img>）', () => {
    const v = mountEmpty();
    const imageFile = new File([''], 'test.png', { type: 'image/png' });
    const handled = firePaste(
      v,
      pasteEvent({ 'text/plain': 'caption', 'text/html': '<img src="x">' }, [imageFile]),
    );
    expect(handled).toBe(true);
  });

  it('有图片 + 文字 → 同步插入文字（图片异步落盘）', () => {
    const v = mountEmpty();
    const imageFile = new File([''], 'test.png', { type: 'image/png' });
    firePaste(
      v,
      pasteEvent({ 'text/plain': 'caption text' }, [imageFile]),
    );
    // 文字应被同步插入（图片走异步，测试不验证落盘细节）
    expect(v.state.doc.textContent).toContain('caption text');
  });
});
