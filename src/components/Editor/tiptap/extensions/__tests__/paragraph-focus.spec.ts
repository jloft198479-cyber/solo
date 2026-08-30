// @vitest-environment happy-dom
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMarkdownCompatSchema } from '../../markdown/compat-schema';
import { setDocumentTier } from '../../../document-scale';
import { createParagraphFocusPlugin, paragraphFocusKey } from '../paragraph-focus';

const schema = createMarkdownCompatSchema();

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
