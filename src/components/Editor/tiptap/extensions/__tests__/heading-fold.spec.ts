// @vitest-environment happy-dom
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorView } from '@tiptap/pm/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';
import { setDocumentTier } from '../../../document-scale';
import { createHeadingFoldPlugin, clearHeadingFoldedMemory, headingFoldKey } from '../heading-fold';

const schema = createTestSchema();

function docOf(md: string): PMNode {
  return parseMarkdown(schema, md);
}

/** 装饰层里 from === to 的就是折叠箭头（widget），有长度的就是被隐藏的块 */
function foldState(state: EditorState) {
  const set = headingFoldKey.getState(state)!.decorations;
  const all = set.find();
  return {
    folded: [...headingFoldKey.getState(state)!.folded].sort((a, b) => a - b),
    arrowPos: all.filter((d) => d.from === d.to).map((d) => d.from),
    hidden: all
      .filter((d) => d.from !== d.to)
      .map((d) => ({ from: d.from, to: d.to }))
      .sort((a, b) => a.from - b.from),
  };
}

/** 默认光标放在标题正文起点（必须落在折叠区间之外——默认落隐藏区会让
 *  toggle 刚折上就被 revealFoldedAtCursor 撤销） */
function stateOf(doc: PMNode, cursor = 1): EditorState {
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, cursor),
    plugins: [createHeadingFoldPlugin()],
  });
}

/**
 * 基准文档（H1 + 两个段落，块间**空行**分隔——markdown 单换行只是段内软换行，
 * 不产生新块，所有坐标断言都建立在空行分隔上）：
 *   heading "甲" @0..3 → 段落 "正文一" @3..8 → 段落 "正文二" @8..13
 * 折叠标题 @0 时被隐藏的是 @3..8 与 @8..13 两个块。
 */
const BASE = '# 甲\n\n正文一\n\n正文二\n';
const HEADING = 0;
const ARROW = 1;
const INSIDE_HIDDEN = 4; // 正文一 内部

/**
 * 多级文档的坐标与折叠区间：
 *   甲(H1)@0..3  子一(H2)@3..7  内容@7..11  子二(H2)@11..15  正文@15..19  乙(H1)@19..22
 *   foldRange(甲)   = (3, 19)   —— 藏到下一个 H1 之前（子标题连带内容一起藏）
 *   foldRange(子一) = (7, 11)   —— 只藏到下一个 H2 之前
 *   foldRange(子二) = (15, 22)  —— 无下一个 H2，藏到文档尾
 *   foldRange(乙)   = null      —— 后面没有内容，不可折叠
 */
const MULTI = '# 甲\n\n## 子一\n\n内容\n\n## 子二\n\n正文\n\n# 乙\n';

describe('heading-fold 折叠装饰', () => {
  beforeEach(() => {
    setDocumentTier('normal');
  });
  afterEach(() => {
    setDocumentTier('normal');
  });

  it('基准文档结构（后面的坐标断言都依赖它）', () => {
    const doc = docOf(BASE);
    expect(doc.textContent).toBe('甲正文一正文二');
    expect(doc.content.size).toBe(13);
  });

  it('init：有后续内容的标题长箭头；末尾标题与纯段落不长', () => {
    const state = stateOf(docOf(BASE));
    expect(foldState(state).arrowPos).toEqual([ARROW]);
    expect(foldState(state).hidden).toEqual([]);

    // 末尾标题（后面没有内容）不可折叠
    const end = stateOf(docOf('正文\n# 尾标题\n'), 1);
    expect(foldState(end).arrowPos).toEqual([]);

    // 无标题的文档完全不建装饰
    const plain = stateOf(docOf('段落一\n\n段落二\n'), 1);
    expect(foldState(plain).arrowPos).toEqual([]);
  });

  it('toggle：折叠给后续块挂隐藏装饰，再 toggle 复原', () => {
    let state = stateOf(docOf(BASE));

    state = state.apply(state.tr.setMeta(headingFoldKey, { toggle: HEADING }));
    expect(foldState(state).folded).toEqual([HEADING]);
    expect(foldState(state).hidden).toEqual([
      { from: 3, to: 8 },
      { from: 8, to: 13 },
    ]);
    expect(foldState(state).arrowPos).toEqual([ARROW]);

    state = state.apply(state.tr.setMeta(headingFoldKey, { toggle: HEADING }));
    expect(foldState(state).folded).toEqual([]);
    expect(foldState(state).hidden).toEqual([]);
  });

  it('多级折叠范围：H1 藏到下一个 H1；H2 只藏到下一个 H2；末尾标题不可折叠', () => {
    const state = stateOf(docOf(MULTI));
    // 三个可折叠标题各长一个箭头（甲@0→1、子一@3→4、子二@11→12）；乙@19 不长
    expect(foldState(state).arrowPos).toEqual([1, 4, 12]);

    let s = state.apply(state.tr.setMeta(headingFoldKey, { toggle: 0 }));
    expect(foldState(s).hidden).toEqual([
      { from: 3, to: 7 },
      { from: 7, to: 11 },
      { from: 11, to: 15 },
      { from: 15, to: 19 },
    ]);

    s = state.apply(state.tr.setMeta(headingFoldKey, { toggle: 3 }));
    expect(foldState(s).hidden).toEqual([{ from: 7, to: 11 }]);
  });

  it('嵌套折叠：H1 与其后面的 H2 同时折叠，隐藏区取并集且不重复挂装饰', () => {
    let state = stateOf(docOf(MULTI));
    state = state.apply(state.tr.setMeta(headingFoldKey, { toggle: 0 }));
    state = state.apply(state.tr.setMeta(headingFoldKey, { toggle: 3 }));
    expect(foldState(state).hidden).toEqual([
      { from: 3, to: 7 },
      { from: 7, to: 11 },
      { from: 11, to: 15 },
      { from: 15, to: 19 },
    ]);
  });

  it('折叠态随事务 map 平移：上方插入内容后仍指向同一标题', () => {
    let state = stateOf(docOf(BASE));
    state = state.apply(state.tr.setMeta(headingFoldKey, { toggle: HEADING }));

    state = state.apply(state.tr.insert(0, schema.nodes.paragraph.create(null, schema.text('新'))));

    expect(foldState(state).folded).toEqual([HEADING + 3]);
    expect(foldState(state).hidden).toEqual([
      { from: 6, to: 11 },
      { from: 11, to: 16 },
    ]);
  });

  it('光标落进已折叠的隐藏区：自动展开该标题（方向键/大纲跳转/查找的兜底）', () => {
    let state = stateOf(docOf(BASE));
    state = state.apply(state.tr.setMeta(headingFoldKey, { toggle: HEADING }));
    expect(foldState(state).folded).toEqual([HEADING]);

    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, INSIDE_HIDDEN)));

    expect(foldState(state).folded).toEqual([]);
    expect(foldState(state).hidden).toEqual([]);
  });

  it('光标停在标题自己身上：不误展开', () => {
    let state = stateOf(docOf(BASE));
    state = state.apply(state.tr.setMeta(headingFoldKey, { toggle: HEADING }));

    // ARROW 是标题正文起点（隐藏区左边界之前）
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, ARROW)));
    expect(foldState(state).folded).toEqual([HEADING]);
  });

  it('大文档降级：不建任何装饰', () => {
    setDocumentTier('heavy');
    const state = stateOf(docOf(BASE));
    expect(foldState(state).arrowPos).toEqual([]);
    expect(foldState(state).hidden).toEqual([]);
  });
});

describe('heading-fold 跨文档记忆（切走再切回）', () => {
  beforeEach(() => {
    setDocumentTier('normal');
    clearHeadingFoldedMemory();
  });
  afterEach(() => {
    setDocumentTier('normal');
    clearHeadingFoldedMemory();
  });

  /** 用一个可变的「当前路径」模拟 fileStore —— 与生产同构：路径先变，事务后到 */
  function mountedWithPath(md: string, pathRef: { current: string | null }, cursor = 1) {
    const doc = docOf(md);
    return EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, cursor),
      plugins: [createHeadingFoldPlugin(() => pathRef.current)],
    });
  }

  /** 整体替换成另一份文档（模拟切文件：路径已在事务前变更） */
  function switchTo(
    state: EditorState,
    md: string,
    pathRef: { current: string | null },
    nextPath: string | null,
  ): EditorState {
    pathRef.current = nextPath;
    const next = docOf(md);
    return state.apply(state.tr.replaceWith(0, state.doc.content.size, next));
  }

  it('切走再切回同一路径：折叠态恢复', () => {
    const pathRef = { current: 'a.md' };
    let state = mountedWithPath(BASE, pathRef);
    state = state.apply(state.tr.setMeta(headingFoldKey, { toggle: HEADING }));
    expect(foldState(state).folded).toEqual([HEADING]);

    state = switchTo(state, '段落\n', pathRef, 'b.md');
    expect(foldState(state).folded).toEqual([]);

    state = switchTo(state, BASE, pathRef, 'a.md');
    expect(foldState(state).folded).toEqual([HEADING]);
    expect(foldState(state).hidden).toEqual([
      { from: 3, to: 8 },
      { from: 8, to: 13 },
    ]);
  });

  it('恢复时校验位置有效性：位置处不再是可折叠标题 ⇒ 记忆丢弃而非硬套', () => {
    const pathRef = { current: 'a.md' };
    let state = mountedWithPath(BASE, pathRef);
    state = state.apply(state.tr.setMeta(headingFoldKey, { toggle: HEADING }));

    state = switchTo(state, '段落\n', pathRef, 'b.md');
    // 切回：同路径但内容已被外部改成「该位置是段落」
    state = switchTo(state, '正文一\n正文二\n', pathRef, 'a.md');

    expect(foldState(state).folded).toEqual([]);
    expect(foldState(state).hidden).toEqual([]);
  });

  it('无路径文档（未命名/新建）不记忆：切走即不恢复', () => {
    const pathRef: { current: string | null } = { current: null };
    let state = mountedWithPath(BASE, pathRef);
    state = state.apply(state.tr.setMeta(headingFoldKey, { toggle: HEADING }));

    state = switchTo(state, '段落\n', pathRef, null);
    state = switchTo(state, BASE, pathRef, null);
    expect(foldState(state).folded).toEqual([]);
  });
});

describe('heading-fold 装饰 DOM 与组字冻结（IME 防御）', () => {
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
    setDocumentTier('normal');
  });

  function mountView(md: string): EditorView {
    const doc = docOf(md);
    view = new EditorView(mount!, {
      state: EditorState.create({
        schema,
        doc,
        selection: TextSelection.create(doc, ARROW),
        plugins: [createHeadingFoldPlugin()],
      }),
    });
    return view;
  }

  /** EditorView.composing 是原型 getter，装实例 getter 覆盖（同 list-fold.spec） */
  function setComposing(v: EditorView, value: boolean) {
    Object.defineProperty(v, 'composing', { configurable: true, get: () => value });
  }

  it('rAF 重建后箭头 DOM 复用同一节点（不给 widget 稳定 key 就会被换掉）', () => {
    const v = mountView(BASE);
    const before = v.dom.querySelector('.list-fold-toggle');
    expect(before).not.toBeNull();

    v.dispatch(v.state.tr.insertText('，', ARROW));
    v.dispatch(v.state.tr.setMeta(headingFoldKey, { rebuild: true }));

    expect(v.dom.querySelector('.list-fold-toggle')).toBe(before);
  });

  it('折叠态变化时箭头要换新节点（class 变 is-folded，箭头才能转向）', () => {
    const v = mountView(BASE);
    const before = v.dom.querySelector('.list-fold-toggle');

    v.dispatch(v.state.tr.setMeta(headingFoldKey, { toggle: HEADING }));

    const after = v.dom.querySelector('.list-fold-toggle');
    expect(after).not.toBe(before);
    expect(after!.classList.contains('is-folded')).toBe(true);
  });

  it('点击箭头折叠：光标落在隐藏区内会被挪进标题（不落进不可见区）', () => {
    const v = mountView(BASE);
    // 光标先挪到隐藏区里（正文二文字内部 @9，避开块边界）
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 9)));
    expect(v.state.selection.from).toBe(9);

    v.dom.querySelector('.list-fold-toggle')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(foldState(v.state).folded).toEqual([HEADING]);
    // 光标被挪进标题内部末位（heading @0..3 的内部位置 2 = 「甲」之后）
    expect(v.state.selection.from).toBe(2);
  });

  it('组字期间 doc 变化：箭头 widget DOM 原样保留（不重建）', () => {
    const v = mountView(BASE);
    v.dispatch(v.state.tr.setMeta(headingFoldKey, { toggle: HEADING }));
    const before = v.dom.querySelector('.list-fold-toggle');
    expect(before).not.toBeNull();

    setComposing(v, true);
    v.dispatch(v.state.tr.insertText('你', ARROW));

    expect(v.dom.querySelector('.list-fold-toggle')).toBe(before);
    expect(foldState(v.state).folded).toEqual([HEADING]);
  });

  it('组字期间光标进隐藏区：不触发自动展开（组字期不重建装饰）', () => {
    const v = mountView(BASE);
    v.dispatch(v.state.tr.setMeta(headingFoldKey, { toggle: HEADING }));

    setComposing(v, true);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, INSIDE_HIDDEN)));
    expect(foldState(v.state).folded).toEqual([HEADING]);

    // 组字结束、光标再次落定 → 兜底展开生效
    setComposing(v, false);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, INSIDE_HIDDEN)));
    expect(foldState(v.state).folded).toEqual([]);
  });
});
