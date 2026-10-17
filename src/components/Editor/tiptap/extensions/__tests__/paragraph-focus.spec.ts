// @vitest-environment happy-dom
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { DecorationSet, EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';
import { setDocumentTier } from '../../../document-scale';
import { createParagraphFocusPlugin, paragraphFocusKey } from '../paragraph-focus';

const schema = createTestSchema();

function paragraph(text = ''): PMNode {
  return schema.nodes.paragraph.create(null, text ? [schema.text(text)] : []);
}
function heading(level: number, text = ''): PMNode {
  return schema.nodes.heading.create({ level }, text ? [schema.text(text)] : []);
}
function docOf(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}
function stateOf(doc: PMNode, cursor: number): EditorState {
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, cursor),
    plugins: [createParagraphFocusPlugin()],
  });
}

interface DecoSummary {
  from: number;
  to: number;
  cls: string;
}
function summaries(state: EditorState): DecoSummary[] {
  const set = paragraphFocusKey.getState(state)!.decorations;
  return set
    .find()
    .map((d) => ({ from: d.from, to: d.to, cls: (d.type.attrs.class as string | undefined) ?? '' }))
    .sort((a, b) => a.from - b.from);
}

describe('paragraph-focus 增量聚焦装饰（P4-03）', () => {
  beforeEach(() => {
    vi.spyOn(DecorationSet, 'create');
    document.documentElement.classList.add('focus-mode');
  });
  afterEach(() => {
    document.documentElement.classList.remove('focus-mode');
    setDocumentTier('normal');
    vi.restoreAllMocks();
  });

  function createCallCount(): number {
    return vi.mocked(DecorationSet.create).mock.calls.length;
  }

  it('init：每块一条装饰，聚焦块 active、其余 dimmed', () => {
    const state = stateOf(docOf(paragraph('hello'), heading(1, 'world')), 1);
    expect(summaries(state)).toEqual([
      { from: 0, to: 7, cls: 'paragraph-active' },
      { from: 7, to: 14, cls: 'paragraph-dimmed' },
    ]);
  });

  it('同块打字：不触发全量重建（create 计数不变），装饰坐标随映射平移', () => {
    let state = stateOf(docOf(paragraph('hello'), heading(1, 'world')), 1);
    const calls = createCallCount();

    state = state.apply(state.tr.insertText('X', 1));

    expect(createCallCount()).toBe(calls);
    expect(summaries(state)).toEqual([
      { from: 0, to: 8, cls: 'paragraph-active' }, // 'Xhello' [0,8)
      { from: 8, to: 15, cls: 'paragraph-dimmed' }, // heading 平移 +1
    ]);
  });

  it('跨块移动：不触发全量重建，仅旧块改 dimmed、新块改 active', () => {
    let state = stateOf(docOf(paragraph('hello'), heading(1, 'world')), 1);
    const calls = createCallCount();

    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 8)));

    expect(createCallCount()).toBe(calls);
    expect(summaries(state)).toEqual([
      { from: 0, to: 7, cls: 'paragraph-dimmed' },
      { from: 7, to: 14, cls: 'paragraph-active' },
    ]);
  });

  it('整体替换 doc：识别 whole-doc replace 触发全量重建，装饰对应新 doc', () => {
    let state = stateOf(docOf(paragraph('hello'), heading(1, 'world')), 1);
    const calls = createCallCount();

    const newDoc = docOf(paragraph('a'), paragraph('b'), paragraph('c'));
    state = state.apply(state.tr.replaceWith(0, state.doc.content.size, newDoc));

    expect(createCallCount()).toBe(calls + 1);
    // replaceWith 整体替换：selection 映射 assoc=1 贴右 → 光标落到新 doc 末尾（最后一块）
    expect(summaries(state)).toEqual([
      { from: 0, to: 3, cls: 'paragraph-dimmed' },
      { from: 3, to: 6, cls: 'paragraph-dimmed' },
      { from: 6, to: 9, cls: 'paragraph-active' },
    ]);
  });

  it('refreshParagraphFocus（meta reset）强制全量重建', () => {
    let state = stateOf(docOf(paragraph('hello'), heading(1, 'world')), 1);
    const calls = createCallCount();

    state = state.apply(state.tr.setMeta(paragraphFocusKey, { reset: true }));

    expect(createCallCount()).toBe(calls + 1);
    expect(summaries(state)).toEqual([
      { from: 0, to: 7, cls: 'paragraph-active' },
      { from: 7, to: 14, cls: 'paragraph-dimmed' },
    ]);
  });

  it('focus mode 关闭时：init 不预建装饰（H4 空转修复），事务也不重建', () => {
    document.documentElement.classList.remove('focus-mode');
    const calls = createCallCount();
    const state = stateOf(docOf(paragraph('hello')), 1);

    expect(createCallCount()).toBe(calls); // 创建编辑器时一次都不建
    expect(summaries(state)).toEqual([]);

    state.apply(state.tr.insertText('X', 1));

    expect(createCallCount()).toBe(calls); // 关闭状态下不重建
  });

  it('大文档降级（heavy）：init 不建装饰，每块一条正是超大文档的卡死来源', () => {
    setDocumentTier('heavy');
    const state = stateOf(docOf(paragraph('hello'), heading(1, 'world')), 1);

    expect(summaries(state)).toEqual([]);
    expect(createCallCount()).toBe(0);
  });

  it('大文档降级（extreme）：焦点模式开着，渲染边界仍拿不到任何装饰', () => {
    setDocumentTier('extreme');
    const plugin = createParagraphFocusPlugin();
    const doc = docOf(paragraph('hello'), heading(1, 'world'));
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1),
      plugins: [plugin],
    });

    expect(plugin.props.decorations?.(state)?.find()).toEqual([]);
  });
});

// 组字冻结回归锁（IME 候选窗失锚防御）：真 EditorView + 覆盖 view.composing，
// 复用 markdown-input-ime.spec 的 ime-anchor 同款套路。锁住「组字期间只平移装饰
// 不 swap active/dimmed class」这一行为契约——swap 会改动正在组字段落的 DOM class，
// 是 WebView2 下 IME 候选窗变形（横条塌成小方块）的诱因之一。
describe('paragraph-focus 组字冻结（IME 防御）', () => {
  let view: EditorView | null = null;
  let mount: HTMLElement | null = null;

  beforeEach(() => {
    document.documentElement.classList.add('focus-mode');
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });
  afterEach(() => {
    if (view && !view.isDestroyed) view.destroy();
    view = null;
    if (mount) mount.remove();
    mount = null;
    document.documentElement.classList.remove('focus-mode');
    setDocumentTier('normal');
  });

  function mountView(doc: PMNode, cursor: number): EditorView {
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, cursor),
      plugins: [createParagraphFocusPlugin()],
    });
    view = new EditorView(mount!, { state });
    return view;
  }

  it('组字期间跨块移动光标：装饰只平移不 swap（active 保持原块），组字结束后照常 swap', () => {
    const v = mountView(docOf(paragraph('hello'), heading(1, 'world')), 1);
    // 初始：块0 active、块1 dimmed
    expect(summaries(v.state)).toEqual([
      { from: 0, to: 7, cls: 'paragraph-active' },
      { from: 7, to: 14, cls: 'paragraph-dimmed' },
    ]);

    // 模拟浏览器组字中（EditorView.composing 是原型 getter，装实例 getter 覆盖）
    let browserComposing = true;
    Object.defineProperty(v, 'composing', {
      configurable: true,
      get: () => browserComposing,
    });

    // 组字期间把光标移到块1：绝不 swap（否则改动正在组字的 DOM class → IME 失锚）
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 8)));
    expect(summaries(v.state)).toEqual([
      { from: 0, to: 7, cls: 'paragraph-active' },
      { from: 7, to: 14, cls: 'paragraph-dimmed' },
    ]);

    // 组字结束后同样移动：正常 swap 到块1（冻结只作用于组字期间，不漏最终聚焦）
    browserComposing = false;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 8)));
    expect(summaries(v.state)).toEqual([
      { from: 0, to: 7, cls: 'paragraph-dimmed' },
      { from: 7, to: 14, cls: 'paragraph-active' },
    ]);
  });

  it('组字期间块内打字：装饰坐标随映射平移，class 不变', () => {
    const v = mountView(docOf(paragraph('hello'), heading(1, 'world')), 1);
    const browserComposing = true;
    Object.defineProperty(v, 'composing', {
      configurable: true,
      get: () => browserComposing,
    });

    // 组字上屏临时文本：块0 变长，装饰 map 平移跟随，active/dimmed 归属不变
    v.dispatch(v.state.tr.insertText('你好', 1));
    expect(summaries(v.state)).toEqual([
      { from: 0, to: 9, cls: 'paragraph-active' }, // '你好hello' [0,9)
      { from: 9, to: 16, cls: 'paragraph-dimmed' }, // heading 平移 +2
    ]);
  });
});

/**
 * 粒度锁：聚焦单位是「最小块」（Typora 的 md-end-block），不是顶层块。
 *
 * 改前 `$head.before(1)` 取顶层块 ⇒ 整个列表一条装饰、整块同亮，长列表里
 * 无法只突出当前那一行。这里的判据不是「有几条装饰」这么表面，而是
 * **装饰的范围必须等于一个段落的 nodeSize** —— 覆盖整个列表就会超出。
 */
describe('paragraph-focus 粒度：最小块（沿 Typora Focus Mode）', () => {
  beforeEach(() => {
    document.documentElement.classList.add('focus-mode');
  });
  afterEach(() => {
    document.documentElement.classList.remove('focus-mode');
    setDocumentTier('normal');
  });

  function mdState(md: string, cursor: number): EditorState {
    const doc = parseMarkdown(schema, md);
    return EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, cursor),
      plugins: [createParagraphFocusPlugin()],
    });
  }

  it('列表：每项单独一条（3 项 3 条），active 只覆盖当前项那个段落', () => {
    const state = mdState('- A\n- B\n- C\n', 3);
    const list = summaries(state);

    expect(list.map((d) => d.cls)).toEqual([
      'paragraph-active',
      'paragraph-dimmed',
      'paragraph-dimmed',
    ]);
    // 段落 nodeSize = 2 + 文本长度 1 = 3；整个列表是 15。范围小于列表即「没打整块」。
    for (const d of list) expect(d.to - d.from).toBe(3);
    expect(list[0]).toEqual({ from: 2, to: 5, cls: 'paragraph-active' });
  });

  it('引用块：装饰落在块内两个段落上，容器本身不带装饰', () => {
    const list = summaries(mdState('> A\n>\n> B\n', 3));
    expect(list.map((d) => d.cls)).toEqual(['paragraph-active', 'paragraph-dimmed']);
    // 顶层只有一个 blockquote，却有 2 条装饰 ⇒ 落点只能是段落
    expect(list.every((d) => d.to - d.from === 3)).toBe(true);
  });

  it('待办项：TaskItem 的正文包在 div 里，装饰仍落在段落上', () => {
    const list = summaries(mdState('- [ ] A\n- [x] B\n', 8));
    expect(list).toHaveLength(2);
    expect(list.filter((d) => d.cls === 'paragraph-active')).toHaveLength(1);
  });

  it('光标停在段落之前的容器边界（点列表项左侧/空项）：仍能定位到该段落', () => {
    // 这条覆盖 ProseMirror 的边界解析：pos 落在 taskItem 内、paragraph 尚未开始，
    // `$head.parent` 是 taskItem 而不是段落（PM 会打一条「endpoint not pointing into
    // inline content」警告，属构造方式使然，不是缺陷）。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const list = summaries(mdState('- [ ] A\n- [x] B\n', 7));
    warn.mockRestore();

    expect(list.filter((d) => d.cls === 'paragraph-active')).toEqual([
      { from: 7, to: 10, cls: 'paragraph-active' },
    ]);
  });

  it('嵌套列表：外层无正文的父项不产生装饰，子项逐条独立', () => {
    // `- A` 下挂两个子项：段落只有 A / A1 / A2 三段（父项首段是 A）
    const list = summaries(mdState('- A\n  - A1\n  - A2\n', 3));
    expect(list).toHaveLength(3);
    expect(list.filter((d) => d.cls === 'paragraph-active')).toHaveLength(1);
  });

  it('项内标题（`- ## 标题`）：标题本身就是叶块，整体作为聚焦单位', () => {
    const list = summaries(mdState('- ## 标题\n- 正文\n', 4));
    expect(list).toHaveLength(2);
    expect(list.filter((d) => d.cls === 'paragraph-active')).toHaveLength(1);
  });
});
