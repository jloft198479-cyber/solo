// @vitest-environment happy-dom
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { DOMSerializer } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorView } from '@tiptap/pm/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';
import { setDocumentTier } from '../../../document-scale';
import { createListFoldPlugin, listFoldKey } from '../list-fold';

const schema = createTestSchema();

function docOf(md: string): PMNode {
  return parseMarkdown(schema, md);
}

/** 装饰层里 from === to 的就是折叠箭头（widget），有长度的就是被隐藏的子列表 */
function foldState(state: EditorState) {
  const set = listFoldKey.getState(state)!.decorations;
  const all = set.find();
  return {
    folded: [...listFoldKey.getState(state)!.folded].sort((a, b) => a - b),
    arrowPos: all.filter((d) => d.from === d.to).map((d) => d.from),
    hidden: all
      .filter((d) => d.from !== d.to)
      .map((d) => ({ from: d.from, to: d.to }))
      .sort((a, b) => a.from - b.from),
  };
}

/** 默认光标放在首项正文起点（必须是段落内的位置，放 listItem 上 PM 会告警） */
function stateOf(doc: PMNode, cursor = 3): EditorState {
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, cursor),
    plugins: [createListFoldPlugin()],
  });
}

/**
 * 基准文档（`- A` 下挂一个子项）的坐标：
 *   listItem#1 @1 → 段落 "A" 正文 @3 → 子列表 @5..13 → 子项 "A1" 正文 @8
 *   listItem#2 @14（无子列表）
 * 折叠项 @1 时被隐藏的正是那段子列表 @5..13。
 */
const NESTED = '- A\n  - A1\n- B\n';
const ITEM = 1;
const ARROW = 3;
const HIDDEN_FROM = 5;
const HIDDEN_TO = 13;

/** 光标能落进隐藏区的合法文本位置 */
const INSIDE_HIDDEN = 8;

describe('list-fold 折叠装饰', () => {
  beforeEach(() => {
    setDocumentTier('normal');
  });
  afterEach(() => {
    setDocumentTier('normal');
  });

  it('基准文档结构（后面的坐标断言都依赖它）', () => {
    const doc = docOf(NESTED);
    expect(doc.textContent).toBe('AA1B');
    expect(doc.content.size).toBe(20);
  });

  it('init：只有「含子列表的项」长箭头，其余项与纯段落不长', () => {
    const state = stateOf(docOf(NESTED));
    expect(foldState(state).arrowPos).toEqual([ARROW]);
    expect(foldState(state).hidden).toEqual([]);
  });

  it('无列表的文档完全不建装饰', () => {
    const state = stateOf(docOf('普通段落\n\n## 标题\n'), 1);
    expect(foldState(state).arrowPos).toEqual([]);
    expect(foldState(state).hidden).toEqual([]);
  });

  it('toggle：折叠给子列表挂隐藏装饰，再 toggle 复原', () => {
    const doc = docOf(NESTED);
    let state = stateOf(doc);

    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));
    expect(foldState(state).folded).toEqual([ITEM]);
    expect(foldState(state).hidden).toEqual([{ from: HIDDEN_FROM, to: HIDDEN_TO }]);
    expect(foldState(state).arrowPos).toEqual([ARROW]);

    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));
    expect(foldState(state).folded).toEqual([]);
    expect(foldState(state).hidden).toEqual([]);
  });

  it('折叠态随事务 map 平移：上方插入内容后仍指向同一项', () => {
    const doc = docOf(NESTED);
    let state = stateOf(doc);
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));

    // 在文档开头插入一个段落（nodeSize 3），整体下移
    state = state.apply(state.tr.insert(0, schema.nodes.paragraph.create(null, schema.text('新'))));

    expect(foldState(state).folded).toEqual([ITEM + 3]);
    expect(foldState(state).hidden).toEqual([
      { from: HIDDEN_FROM + 3, to: HIDDEN_TO + 3 },
    ]);
  });

  it('整体替换文档：折叠态清空，装饰按新文档重建', () => {
    let state = stateOf(docOf(NESTED));
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));
    expect(foldState(state).folded).toEqual([ITEM]);

    const next = docOf('- X\n  - X1\n');
    state = state.apply(state.tr.replaceWith(0, state.doc.content.size, next));

    expect(foldState(state).folded).toEqual([]);
    expect(foldState(state).hidden).toEqual([]);
    expect(foldState(state).arrowPos).toEqual([3]);
  });

  it('光标落进已折叠的隐藏区：自动展开该项（方向键/大纲跳转/查找的兜底）', () => {
    let state = stateOf(docOf(NESTED));
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));
    expect(foldState(state).folded).toEqual([ITEM]);

    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, INSIDE_HIDDEN)),
    );

    expect(foldState(state).folded).toEqual([]);
    expect(foldState(state).hidden).toEqual([]);
    expect(foldState(state).arrowPos).toEqual([ARROW]);
  });

  it('光标停在折叠项自己那一行：不误展开（边界不算隐藏区）', () => {
    let state = stateOf(docOf(NESTED));
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));

    // ARROW 是该项首段正文起点，紧邻隐藏区左边界
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, ARROW)));
    expect(foldState(state).folded).toEqual([ITEM]);

    // 段落末尾（隐藏区左边界 -1）同样不该展开
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, HIDDEN_FROM - 1)));
    expect(foldState(state).folded).toEqual([ITEM]);
  });

  it('待办列表同样支持折叠（taskItem 也在可折叠项集合内）', () => {
    const state = stateOf(docOf('- [ ] 待办\n  - 子项\n'));
    expect(foldState(state).arrowPos).toHaveLength(1);
  });

  it('大文档降级：不建任何装饰', () => {
    setDocumentTier('heavy');
    const state = stateOf(docOf(NESTED));
    expect(foldState(state).arrowPos).toEqual([]);
    expect(foldState(state).hidden).toEqual([]);
  });
});

describe('list-fold 待办项的 DOM 契约（CSS 为何必须用后代选择器）', () => {
  it('TaskItem 把正文包在 li > div 里，不出现在 li 的直接子级', () => {
    const doc = docOf('- [ ] 待办\n  - 子项\n');
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
    const wrap = document.createElement('div');
    wrap.appendChild(fragment);

    const item = wrap.querySelector('li[data-type="taskItem"]');
    expect(item).not.toBeNull();
    // 正文段落不在 li 的直接子级 —— `li > p` 会匹配失败（箭头因此丢锚点）
    expect(item!.querySelector(':scope > p')).toBeNull();
    expect(item!.querySelector(':scope > div > p')).not.toBeNull();
    // 嵌套列表同样在 div 里 —— `li > ul` 会漏画引导线
    expect(item!.querySelector(':scope > div > ul, :scope > div > ol')).not.toBeNull();
  });
});

describe('list-fold 装饰 DOM 与组字冻结（IME 防御）', () => {
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
        plugins: [createListFoldPlugin()],
      }),
    });
    return view;
  }

  /** EditorView.composing 是原型 getter，装实例 getter 覆盖（同 paragraph-focus.spec） */
  function setComposing(v: EditorView, value: boolean) {
    Object.defineProperty(v, 'composing', { configurable: true, get: () => value });
  }

  it('rAF 重建后箭头 DOM 复用同一节点（不给 widget 稳定 key 就会被换掉）', () => {
    const v = mountView(NESTED);
    const before = v.dom.querySelector('.list-fold-toggle');
    expect(before).not.toBeNull();

    // 打字（map 平移）→ 再走一次 rAF 那次重建
    v.dispatch(v.state.tr.insertText('，', ARROW));
    v.dispatch(v.state.tr.setMeta(listFoldKey, { rebuild: true }));

    // 箭头落在段落文字流里、紧贴光标：一旦每次重建都换 DOM，就是输入期的高危扰动
    expect(v.dom.querySelector('.list-fold-toggle')).toBe(before);
  });

  it('折叠态变化时箭头要换新节点（class 变 is-folded，箭头才能转向）', () => {
    const v = mountView(NESTED);
    const before = v.dom.querySelector('.list-fold-toggle');

    v.dispatch(v.state.tr.setMeta(listFoldKey, { toggle: ITEM }));

    const after = v.dom.querySelector('.list-fold-toggle');
    expect(after).not.toBe(before);
    expect(after!.classList.contains('is-folded')).toBe(true);
  });

  it('DOM 复用后箭头点击仍指向正确的项（getPos 未随重建失效）', () => {
    const v = mountView(NESTED);
    // 在文档最前面插入一个段落，整个列表被推后 3 位
    v.dispatch(v.state.tr.insert(0, schema.nodes.paragraph.create(null, schema.text('前'))));
    v.dispatch(v.state.tr.setMeta(listFoldKey, { rebuild: true }));

    v.dom.querySelector('.list-fold-toggle')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    // getPos 若停留在重建前的坐标，itemStartAt 会解析到「前」段落里而返回 null，折叠态为空
    expect(foldState(v.state).folded).toEqual([ITEM + 3]);
  });

  it('组字期间 doc 变化：箭头 widget DOM 原样保留（不重建）', () => {
    const v = mountView(NESTED);
    v.dispatch(v.state.tr.setMeta(listFoldKey, { toggle: ITEM }));
    const before = v.dom.querySelector('.list-fold-toggle');
    expect(before).not.toBeNull();

    setComposing(v, true);
    v.dispatch(v.state.tr.insertText('你', ARROW));

    // 组字期只 map 平移：widget 类型未变 → PM 复用同一个 DOM 元素
    expect(v.dom.querySelector('.list-fold-toggle')).toBe(before);
    expect(foldState(v.state).folded).toEqual([ITEM]);
  });

  it('组字期间光标进隐藏区：不触发自动展开（组字期不重建装饰）', () => {
    const v = mountView(NESTED);
    v.dispatch(v.state.tr.setMeta(listFoldKey, { toggle: ITEM }));

    setComposing(v, true);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, INSIDE_HIDDEN)));
    expect(foldState(v.state).folded).toEqual([ITEM]);

    // 组字结束、光标再次落定 → 兜底展开生效
    setComposing(v, false);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, INSIDE_HIDDEN)));
    expect(foldState(v.state).folded).toEqual([]);
  });
});
