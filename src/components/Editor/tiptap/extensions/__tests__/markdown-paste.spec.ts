// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import * as pmViewLib from '@tiptap/pm/view';
import { Slice } from '@tiptap/pm/model';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';

import { createMarkdownCompatSchema } from '../../markdown/compat-schema';
import {
  hasInlineMarkdownSyntax,
  hasMarkdownOnlySyntax,
  hasMsoHtml,
  isLowQualityParse,
  looksLikeMarkdownTable,
  markdownPastePlugin,
  parseGeneralMarkdownPaste,
  parseHtmlSlice,
  parseMarkdownTablePaste,
  parseProprietaryMarkdownPaste,
  parseUrlPaste,
} from '../markdown-paste';

// 图片落盘依赖 Tauri runtime，测试环境整体 mock。
const imageMocks = vi.hoisted(() => ({
  saveClipboardImage: vi.fn().mockResolvedValue({ absolutePath: '/tmp/x.png', relativePath: 'x.png' }),
  authorizeImageAsset: vi.fn().mockResolvedValue(undefined),
}));

// 系统剪贴板 HTML 读取依赖 Tauri runtime（Layer 4 异步升级），默认无 HTML。
const clipboardMocks = vi.hoisted(() => ({
  readClipboardHtml: vi.fn().mockResolvedValue(null),
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

vi.mock('../../../../../services/tauri/clipboard', () => ({
  readClipboardHtml: clipboardMocks.readClipboardHtml,
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

describe('hasInlineMarkdownSyntax（单段落行内标记识别 + 误判防护）', () => {
  it('识别 **加粗**', () => {
    expect(hasInlineMarkdownSyntax('这是 **加粗** 文本')).toBe(true);
  });

  it('识别 `代码`', () => {
    expect(hasInlineMarkdownSyntax('跑 `npm run test` 即可')).toBe(true);
  });

  it('识别 ~~删除线~~', () => {
    expect(hasInlineMarkdownSyntax('这段 ~~已废弃~~ 了')).toBe(true);
  });

  it('单星号 *斜体* 不触发（避免 a*b*c / 5 * 3 误判）', () => {
    expect(hasInlineMarkdownSyntax('用 a*b*c 计算')).toBe(false);
    expect(hasInlineMarkdownSyntax('5 * 3 = 15')).toBe(false);
  });

  it('未闭合的 ** 不触发', () => {
    expect(hasInlineMarkdownSyntax('这是 **未闭合')).toBe(false);
  });

  it('普通中文文本不触发', () => {
    expect(hasInlineMarkdownSyntax('今天天气很好，适合写文档。')).toBe(false);
  });
});

describe('parseUrlPaste（整段 URL 转链接）', () => {
  const schema = createMarkdownCompatSchema();

  it('整段 https URL → 返回含 link mark 的 Slice', () => {
    const slice = parseUrlPaste(schema, 'https://example.com/page');
    expect(slice).not.toBeNull();

    let hasLink = false;
    let href = '';
    slice!.content.descendants((node) => {
      if (node.isText) {
        node.marks.forEach((m) => {
          if (m.type.name === 'link') {
            hasLink = true;
            href = m.attrs.href as string;
          }
        });
      }
      return true;
    });
    expect(hasLink).toBe(true);
    expect(href).toBe('https://example.com/page');
  });

  it('URL 带中文句末标点 → 标点剥离、链接保留', () => {
    const slice = parseUrlPaste(schema, 'https://example.com，');
    expect(slice).not.toBeNull();
    // 链接文本不含标点（Fragment 用 textBetween 取全量文本）
    expect(slice!.content.textBetween(0, slice!.content.size)).toBe('https://example.com');
  });

  it('非 URL 纯文本 → null', () => {
    expect(parseUrlPaste(schema, 'just a sentence')).toBeNull();
  });

  it('含 URL 的整段句子（非整段 URL）→ null（不做全文 linkify）', () => {
    expect(parseUrlPaste(schema, '去 https://example.com 看看')).toBeNull();
  });

  it('http URL 同样识别', () => {
    expect(parseUrlPaste(schema, 'http://localhost:1420')).not.toBeNull();
  });
});

describe('parseProprietaryMarkdownPaste（专有语法解析，handlePaste 嗅探用）', () => {
  const schema = createMarkdownCompatSchema();

  it('wikilink 单行（无块级语法）→ 解析出 wikilink 节点', () => {
    const slice = parseProprietaryMarkdownPaste(schema, '[[Obsidian]]');
    expect(slice).not.toBeNull();

    let hasWikilink = false;
    slice!.content.descendants((node) => {
      if (node.type.name === 'wikilink') hasWikilink = true;
      return true;
    });
    expect(hasWikilink).toBe(true);
  });

  it('callout 内容 → 解析出 callout 块', () => {
    const slice = parseProprietaryMarkdownPaste(schema, '> [!NOTE]\n> 注意这里');
    expect(slice).not.toBeNull();

    let hasCallout = false;
    slice!.content.descendants((node) => {
      if (node.type.name === 'callout') hasCallout = true;
      return true;
    });
    expect(hasCallout).toBe(true);
  });

  it('行内数学 $x^2$ → 解析出 mathInline 节点', () => {
    const slice = parseProprietaryMarkdownPaste(schema, '公式是 $x^2$');
    expect(slice).not.toBeNull();

    let hasMath = false;
    slice!.content.descendants((node) => {
      if (node.type.name === 'mathInline') hasMath = true;
      return true;
    });
    expect(hasMath).toBe(true);
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

  it('含 markdown 专有语法（wikilink 单行）→ 返回含 wikilink 节点的 Slice', () => {
    const slice = callHook('[[wikilink]]');
    expect(slice).not.toBeNull();

    let hasWikilink = false;
    slice!.content.descendants((node) => {
      if (node.type.name === 'wikilink') hasWikilink = true;
      return true;
    });
    expect(hasWikilink).toBe(true);
  });

  it('整段 URL → 返回含 link mark 的 Slice', () => {
    const slice = callHook('https://example.com/page');
    expect(slice).not.toBeNull();

    let hasLink = false;
    slice!.content.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'link')) hasLink = true;
      return true;
    });
    expect(hasLink).toBe(true);
  });

  it('单段落行内标记 **加粗** → 返回含 bold mark 的 Slice', () => {
    const slice = callHook('这是 **加粗** 文本');
    expect(slice).not.toBeNull();

    let hasBold = false;
    slice!.content.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'bold')) hasBold = true;
      return true;
    });
    expect(hasBold).toBe(true);
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

  function mountCodeBlock(): EditorView {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.codeBlock.create(null, schema.text('// code')),
    ]);
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 2),
      plugins: [markdownPastePlugin()],
    });
    view = new EditorView(mount!, { state });
    return view;
  }

  function pasteEvent(parts: Record<string, string>, files: File[] = []): ClipboardEvent {
    return {
      clipboardData: {
        getData: (type: string) => parts[type] ?? '',
        types: Object.keys(parts),
        files,
      } as unknown as DataTransfer,
    } as unknown as ClipboardEvent;
  }

  /**
   * 复刻 PM 真实粘贴管线（prosemirror-view doPaste）：
   * parseFromClipboard（先跑 clipboardTextParser）→ handlePaste（拿到预解析 slice）。
   * 直接用 PM 内部的 __parseFromClipboard 保证 slice 与生产环境一致。
   */
  function firePaste(v: EditorView, event: ClipboardEvent): boolean {
    const clipboard = event.clipboardData;
    const text = clipboard ? clipboard.getData('text/plain') : '';
    const html = clipboard ? clipboard.getData('text/html') || null : null;
    const parse = (
      pmViewLib as unknown as {
        __parseFromClipboard(
          view: EditorView,
          text: string,
          html: string | null,
          plainText: boolean,
          $context: ResolvedPos,
        ): Slice | null;
      }
    ).__parseFromClipboard;
    const slice = parse(v, text, html, false, v.state.selection.$from);
    return Boolean(
      v.someProp('handlePaste', (handler) => handler(v, event, slice || Slice.empty)),
    );
  }

  /** flush 微任务队列（Layer 4 异步升级在 readClipboardHtml 的 .then 里） */
  const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    clipboardMocks.readClipboardHtml.mockReset().mockResolvedValue(null);
  });

  it('无图片（纯文字，无 text/html）→ 接管并复刻默认插入（占位）', () => {
    const v = mountEmpty();
    const handled = firePaste(v, pasteEvent({ 'text/plain': 'just text' }));
    // Layer 4 接管：占位=默认插入内容（单行并入当前段落）
    expect(handled).toBe(true);
    expect(v.state.doc.textContent).toBe('just text');
  });

  it('多行纯文本（无 text/html）→ 占位为多个段落（复刻默认逐行成段）', () => {
    const v = mountEmpty();
    const handled = firePaste(v, pasteEvent({ 'text/plain': 'line one\nline two' }));
    expect(handled).toBe(true);
    // 结构守卫：默认流程把多行拆成多段落；旧实现 insertText 会压成
    // 单个含 \n 的文本节点（无法逐行编辑）——此测试防回归
    const paragraphs: string[] = [];
    v.state.doc.forEach((block) => {
      if (block.type.name === 'paragraph') paragraphs.push(block.textContent);
    });
    expect(paragraphs).toEqual(['line one', 'line two']);
    let sawNewlineInText = false;
    v.state.doc.descendants((node) => {
      if (node.isText && node.text?.includes('\n')) sawNewlineInText = true;
      return true;
    });
    expect(sawNewlineInText).toBe(false);
  });

  it('GFM 表格文本（无 text/html）→ 放行默认流程（不吞 Layer 1 表格转换）', () => {
    const v = mountEmpty();
    const handled = firePaste(
      v,
      pasteEvent({ 'text/plain': '| A | B |\n| --- | --- |\n| 1 | 2 |' }),
    );
    // 表格文本由 clipboardTextParser（Layer 1）转成 table slice，
    // Layer 4 不得拦截覆盖——否则粘贴结果退化为原始文本
    expect(handled).toBe(false);
  });

  it('整段 URL（无 text/html）→ 放行默认流程（不吞 URL 转链接）', () => {
    const v = mountEmpty();
    const handled = firePaste(v, pasteEvent({ 'text/plain': 'https://example.com' }));
    expect(handled).toBe(false);
  });

  it('行内标记文本（无 text/html）→ 放行默认流程（不吞行内格式转换）', () => {
    const v = mountEmpty();
    const handled = firePaste(v, pasteEvent({ 'text/plain': '**bold** and `code`' }));
    expect(handled).toBe(false);
  });

  it('代码块内粘贴纯文本（无 text/html）→ 放行默认流程（不接管不升级）', () => {
    const v = mountCodeBlock();
    const handled = firePaste(v, pasteEvent({ 'text/plain': 'plain code line' }));
    // code 上下文默认流程按原始文本插入；Layer 4 接管反而会破坏代码块
    expect(handled).toBe(false);
  });

  it('占位升级：系统剪贴板有 HTML → 异步原地升级为富格式', async () => {
    clipboardMocks.readClipboardHtml.mockResolvedValue('<p>rich <strong>bold</strong> text</p>');
    const v = mountEmpty();
    const handled = firePaste(v, pasteEvent({ 'text/plain': 'rich bold text' }));
    expect(handled).toBe(true);
    // 占位先同步出现
    expect(v.state.doc.textContent).toBe('rich bold text');

    await flushAsync();

    // 异步升级后带 bold mark
    let hasBold = false;
    v.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'bold')) hasBold = true;
      return true;
    });
    expect(hasBold).toBe(true);
  });

  it('占位升级：系统剪贴板无 HTML → 保留占位（默认粘贴结果，不降级）', async () => {
    const v = mountEmpty();
    const handled = firePaste(v, pasteEvent({ 'text/plain': 'just text' }));
    expect(handled).toBe(true);

    await flushAsync();

    expect(v.state.doc.textContent).toBe('just text');
  });

  it('占位后占位范围被编辑 → 放弃升级（防覆盖用户输入）', async () => {
    clipboardMocks.readClipboardHtml.mockResolvedValue('<p>rich <strong>bold</strong></p>');
    const v = mountEmpty();
    const handled = firePaste(v, pasteEvent({ 'text/plain': 'plain' }));
    expect(handled).toBe(true);

    // 用户在占位范围内插入字符 → 内容已变，升级应放弃
    // 占位 'plain' 占位置 1-6，位置 2 = 'p' 之后（占位中间）
    v.dispatch(v.state.tr.insertText('!', 2));

    await flushAsync();

    let hasBold = false;
    v.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'bold')) hasBold = true;
      return true;
    });
    expect(hasBold).toBe(false);
    expect(v.state.doc.textContent).toBe('p!lain');
  });

  it('连续两次粘贴 → 前一次请求作废（请求序号防乱序）', async () => {
    clipboardMocks.readClipboardHtml.mockResolvedValue('<p>x <strong>bold</strong></p>');
    const v = mountEmpty();
    firePaste(v, pasteEvent({ 'text/plain': 'aaa' }));
    firePaste(v, pasteEvent({ 'text/plain': 'bbb' }));

    await flushAsync();

    // 第一次粘贴（aaa）的升级请求已过期：不被升级
    let aaaMarked = false;
    v.state.doc.descendants((node) => {
      if (node.isText && node.text?.includes('aaa') && node.marks.length > 0) aaaMarked = true;
      return true;
    });
    expect(aaaMarked).toBe(false);
    // 第二次粘贴（bbb）的升级请求有效：被升级
    let hasBold = false;
    v.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'bold')) hasBold = true;
      return true;
    });
    expect(hasBold).toBe(true);
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

  // ── 来源嗅探（text/plain + text/html 同时存在，text/plain 含专有语法）──
  it('text/plain 含 callout + text/html 同时存在 → 接管走 markdown 管道', () => {
    const v = mountEmpty();
    const handled = firePaste(
      v,
      pasteEvent({
        'text/plain': '> [!NOTE]\n> 注意这里',
        'text/html': '<p>注意这里</p>',
      }),
    );
    expect(handled).toBe(true);
    // doc 应包含 callout 节点（HTML 路径会丢 callout，嗅探救回）
    let hasCallout = false;
    v.state.doc.descendants((node) => {
      if (node.type.name === 'callout') hasCallout = true;
      return true;
    });
    expect(hasCallout).toBe(true);
  });

  it('text/plain 含 wikilink + text/html 同时存在 → 接管走 markdown 管道', () => {
    const v = mountEmpty();
    const handled = firePaste(
      v,
      pasteEvent({
        'text/plain': '链接 [[Obsidian]]',
        'text/html': '<p>链接 Obsidian</p>',
      }),
    );
    expect(handled).toBe(true);
    let hasWikilink = false;
    v.state.doc.descendants((node) => {
      if (node.type.name === 'wikilink') hasWikilink = true;
      return true;
    });
    expect(hasWikilink).toBe(true);
  });

  it('text/plain + text/html 同时存在但无专有语法 → 放行默认流程', () => {
    const v = mountEmpty();
    const handled = firePaste(
      v,
      pasteEvent({
        'text/plain': '普通文字',
        'text/html': '<p>普通文字</p>',
      }),
    );
    expect(handled).toBe(false);
  });

  it('仅 text/plain 含专有语法（无 text/html）→ 不接管（走 clipboardTextParser）', () => {
    const v = mountEmpty();
    const handled = firePaste(
      v,
      pasteEvent({ 'text/plain': '> [!NOTE]\n> 注意这里' }),
    );
    // handlePaste 不嗅探（无 text/html），放行给默认流程 → clipboardTextParser 兜底
    expect(handled).toBe(false);
  });
});

// ── Word HTML 清理 + 体积熔断 ────────────────────────────────────

describe('hasMsoHtml（Word HTML 嗅探）', () => {
  it('含 mso- 样式 → 命', () => {
    expect(hasMsoHtml('<p style="mso-spacerun: yes">x</p>')).toBe(true);
  });
  it('含 MsoNormal → 命中', () => {
    expect(hasMsoHtml('<p class="MsoNormal">x</p>')).toBe(true);
  });
  it('含 <o:p> 标签 → 命中', () => {
    expect(hasMsoHtml('<p>文本<o:p></o:p></p>')).toBe(true);
  });
  it('普通 HTML → 不命中', () => {
    expect(hasMsoHtml('<p>Hello</p><strong>bold</strong>')).toBe(false);
  });
});

describe('parseHtmlSlice 体积熔断', () => {
  it('>2MB HTML → 返回 null', () => {
    const schema = createMarkdownCompatSchema();
    const big = 'x'.repeat(2_000_001);
    expect(parseHtmlSlice(schema, big)).toBeNull();
  });

  it('Word HTML 经清理后能正常解析', () => {
    const schema = createMarkdownCompatSchema();
    const wordHtml = '<p class="MsoNormal" style="mso-spacerun: yes">Hello <o:p></o:p></p>';
    const slice = parseHtmlSlice(schema, wordHtml);
    expect(slice).not.toBeNull();
    expect(slice!.content.textBetween(0, slice!.content.size)).toBe('Hello');
  });

  it('正文文字含 mso- 属性名（非 style 属性）→ 清理不吞正文', () => {
    const schema = createMarkdownCompatSchema();
    // 文档正文讨论 Word CSS 属性：文字里的 "mso-xxx: 1" 不是垃圾，必须保留
    const html = '<p>配置 mso-line-height: 12pt 即可生效</p>';
    expect(hasMsoHtml(html)).toBe(true); // 嗅探命中（含 mso-），会走清理
    const slice = parseHtmlSlice(schema, html);
    expect(slice).not.toBeNull();
    expect(slice!.content.textBetween(0, slice!.content.size)).toContain('mso-line-height: 12pt');
  });

  it('style 属性以 mso- 开头 → 正常移除该声明', () => {
    const schema = createMarkdownCompatSchema();
    const wordHtml = '<p style="mso-spacerun: yes; color: red">Colored</p>';
    const slice = parseHtmlSlice(schema, wordHtml);
    expect(slice).not.toBeNull();
    expect(slice!.content.textBetween(0, slice!.content.size)).toBe('Colored');
  });

  it('普通 HTML 不受影响', () => {
    const schema = createMarkdownCompatSchema();
    const html = '<p>Hello <strong>World</strong></p>';
    const slice = parseHtmlSlice(schema, html);
    expect(slice).not.toBeNull();
    expect(slice!.content.textBetween(0, slice!.content.size)).toBe('Hello World');
  });
});
