// @vitest-environment happy-dom
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { DOMSerializer } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorView, Decoration, DecorationSet } from '@tiptap/pm/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';
import { setDocumentTier } from '../../../document-scale';
import {
  createListFoldPlugin,
  clearFoldedMemory,
  listFoldKey,
  rebuildDecorationsInRange,
} from '../list-fold';

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

describe('list-fold 跨文档记忆（切走再切回）', () => {
  beforeEach(() => {
    setDocumentTier('normal');
    clearFoldedMemory();
  });
  afterEach(() => {
    setDocumentTier('normal');
    clearFoldedMemory();
  });

  /** 用一个可变的「当前路径」模拟 fileStore —— 与生产同构：路径先变，事务后到 */
  function mountedWithPath(md: string, pathRef: { current: string | null }, cursor = 3) {
    const doc = docOf(md);
    return EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, cursor),
      plugins: [createListFoldPlugin(() => pathRef.current)],
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
    let state = mountedWithPath(NESTED, pathRef);
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));
    expect(foldState(state).folded).toEqual([ITEM]);

    // 切到 b.md —— 折叠态不该带过去
    state = switchTo(state, '- X\n  - X1\n', pathRef, 'b.md');
    expect(foldState(state).folded).toEqual([]);

    // 切回 a.md —— 折叠态应恢复
    state = switchTo(state, NESTED, pathRef, 'a.md');
    expect(foldState(state).folded).toEqual([ITEM]);
    expect(foldState(state).hidden).toEqual([{ from: HIDDEN_FROM, to: HIDDEN_TO }]);
  });

  it('不同路径互不串台：各自的折叠态各归各', () => {
    const pathRef = { current: 'a.md' };
    let state = mountedWithPath(NESTED, pathRef);
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));

    state = switchTo(state, NESTED, pathRef, 'b.md');
    expect(foldState(state).folded).toEqual([]);

    // 在 b.md 里折叠它的首项（坐标同为 1）
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));
    expect(foldState(state).folded).toEqual([ITEM]);

    // 回 a.md：拿到的是 a 自己的记忆，不是 b 的
    state = switchTo(state, NESTED, pathRef, 'a.md');
    expect(foldState(state).folded).toEqual([ITEM]);
  });

  it('无路径文档（未命名/新建）不记忆：切走即不恢复', () => {
    const pathRef: { current: string | null } = { current: null };
    let state = mountedWithPath(NESTED, pathRef);
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));

    // 切走再切回「仍无路径」→ 等同同路径整体替换，清空，不恢复
    state = switchTo(state, '- X\n  - X1\n', pathRef, null);
    expect(foldState(state).folded).toEqual([]);
    state = switchTo(state, NESTED, pathRef, null);
    expect(foldState(state).folded).toEqual([]);
  });

  it('恢复时校验位置有效性：文档结构变了，失效的折叠被丢弃而非硬套', () => {
    const pathRef = { current: 'a.md' };
    let state = mountedWithPath(NESTED, pathRef);
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));

    // 切走⋯
    state = switchTo(state, '- X\n  - X1\n', pathRef, 'b.md');
    // ⋯再切回：同路径但内容已被外部改成「首项不再有子列表」
    state = switchTo(state, '- A\n- B\n', pathRef, 'a.md');

    // 位置 1 处已是「无子列表的项」→ 记忆失效被丢弃，不会给不可折叠的项挂折叠
    expect(foldState(state).folded).toEqual([]);
    expect(foldState(state).hidden).toEqual([]);
  });

  it('展开（取消折叠）后切走再切回：不会恢复出已取消的折叠', () => {
    const pathRef = { current: 'a.md' };
    let state = mountedWithPath(NESTED, pathRef);
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));
    // 再点一次 = 展开
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));
    expect(foldState(state).folded).toEqual([]);

    state = switchTo(state, '- X\n  - X1\n', pathRef, 'b.md');
    state = switchTo(state, NESTED, pathRef, 'a.md');
    expect(foldState(state).folded).toEqual([]);
  });

  it('折叠后编辑（位置平移）再切走：不错误折叠，安全降级为「全展开」', () => {
    const pathRef = { current: 'a.md' };
    let state = mountedWithPath(NESTED, pathRef);
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));

    // 顶部插入段落：位置随事务平移；插入块属结构变化会触发重建，但折叠项本身仍合法
    // ⇒ 折叠态不该丢（重建不等于失忆）
    state = state.apply(state.tr.insert(0, schema.nodes.paragraph.create(null, schema.text('新'))));
    expect(foldState(state).folded).toEqual([ITEM + 3]);

    // 切走（此刻记忆存的是平移后的坐标 4）
    state = switchTo(state, '- X\n  - X1\n', pathRef, 'b.md');
    // 切回 a.md：磁盘内容若仍是编辑前的原始 NESTED，坐标 4 处的项无子列表
    // ⇒ 校验不过被丢弃。**这是有意的安全降级**：宁可全展开，也不折叠错的项。
    // （真实场景里磁盘内容与离开时一致时，坐标吻合、恢复成功，见上一条用例）
    state = switchTo(state, NESTED, pathRef, 'a.md');
    expect(foldState(state).folded).toEqual([]);
    expect(foldState(state).hidden).toEqual([]);
  });

  it('折叠态已恢复后再编辑：位置随事务平移，不被记忆里旧坐标覆盖', () => {
    const pathRef = { current: 'a.md' };
    let state = mountedWithPath(NESTED, pathRef);
    state = state.apply(state.tr.setMeta(listFoldKey, { toggle: ITEM }));

    state = switchTo(state, '- X\n  - X1\n', pathRef, 'b.md');
    state = switchTo(state, NESTED, pathRef, 'a.md');
    expect(foldState(state).folded).toEqual([ITEM]);

    // 文档顶部插入段落，整体下移 3；折叠位置应跟着平移，而不是回到记忆里的 1
    state = state.apply(state.tr.insert(0, schema.nodes.paragraph.create(null, schema.text('新'))));
    expect(foldState(state).folded).toEqual([ITEM + 3]);
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

  it('全量重建后箭头 DOM 复用同一节点（不给 widget 稳定 key 就会被换掉）', () => {
    const v = mountView(NESTED);
    const before = v.dom.querySelector('.list-fold-toggle');
    expect(before).not.toBeNull();

    // 打字（map 平移）→ 再手动触发一次全量重建（等价于块结构变化后的同步重建）
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

/**
 * 2026-10-19 性能修复：折叠装饰只在「块结构变化」时重建。
 *
 * 旧行为：每个按键都排一次 rAF、派发一个 rebuild 事务、全文档重扫（3000 项约 27ms/键）。
 * 新行为：纯文字 step 只 map；结构变化在当前事务内同步重建；组字期记账、解冻后补建。
 *
 * 判据用 `DecorationSet.create` 的调用次数：`map` 走内部构造、不经过 `create`，
 * 所以「create 被调用」= 真的发生了全量重建（本测试只挂折叠插件，不受别的插件干扰）。
 */
describe('list-fold 只在块结构变化时重建（性能修复）', () => {
  let view: EditorView | null = null;
  let mount: HTMLElement | null = null;
  let restoreSpy: (() => void) | null = null;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });
  afterEach(() => {
    restoreSpy?.();
    restoreSpy = null;
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

  function setComposing(v: EditorView, value: boolean) {
    Object.defineProperty(v, 'composing', { configurable: true, get: () => value });
  }

  /** 监听「全量重建」：create 被调用即重建（map 不会走这里） */
  function watchRebuild() {
    const spy = vi.spyOn(DecorationSet, 'create');
    restoreSpy = () => spy.mockRestore();
    return spy;
  }

  /** 造一个「父项 + 子列表」的顶层列表，用于模拟回车 / 粘贴产生的新结构 */
  function nestedListOf(text: string): PMNode {
    const child = schema.nodes.bulletList.create(
      null,
      schema.nodes.listItem.create(
        null,
        schema.nodes.paragraph.create(null, schema.text(`${text}1`)),
      ),
    );
    const item = schema.nodes.listItem.create(null, [
      schema.nodes.paragraph.create(null, schema.text(text)),
      child,
    ]);
    return schema.nodes.bulletList.create(null, item);
  }

  it('项内打字：不触发全量重建（create 一次都不调）', () => {
    const v = mountView(NESTED);
    const spy = watchRebuild();
    v.dispatch(v.state.tr.insertText('，', ARROW + 1));
    expect(spy).not.toHaveBeenCalled();
    expect(foldState(v.state).arrowPos).toEqual([ARROW]);
  });

  it('打字不改变折叠态；隐藏装饰随事务平移', () => {
    const v = mountView(NESTED);
    v.dispatch(v.state.tr.setMeta(listFoldKey, { toggle: ITEM }));
    const spy = watchRebuild();
    v.dispatch(v.state.tr.insertText('，', ARROW + 1));
    expect(spy).not.toHaveBeenCalled();
    expect(foldState(v.state).folded).toEqual([ITEM]);
    expect(foldState(v.state).hidden.length).toBe(1);
  });

  it('删除唯一子项（块级删除）→ 重建，父项箭头消失', () => {
    const v = mountView(NESTED);
    expect(foldState(v.state).arrowPos).toEqual([ARROW]);
    v.dispatch(v.state.tr.delete(HIDDEN_FROM, HIDDEN_TO));
    expect(foldState(v.state).arrowPos).toEqual([]);
  });

  it('插入新的「父项 + 子列表」→ 重建，新项立刻有箭头', () => {
    const v = mountView(NESTED);
    v.dispatch(v.state.tr.insert(v.state.doc.content.size, nestedListOf('C')));
    expect(foldState(v.state).arrowPos.length).toBe(2);
  });

  it('组字期结构变化：先记账，解冻后补建一次', () => {
    const v = mountView(NESTED);
    setComposing(v, true);
    const spy = watchRebuild();
    v.dispatch(v.state.tr.delete(HIDDEN_FROM, HIDDEN_TO));

    // 冻结期只 map：不能动 DOM（箭头暂时还在是预期的），但欠账已记下
    expect(spy).not.toHaveBeenCalled();
    expect(foldState(v.state).arrowPos).toEqual([ARROW]);
    expect(listFoldKey.getState(v.state)!.pendingRebuild).toBe(true);

    // 解冻后的第一个事务补建 → 坏箭头被清掉
    setComposing(v, false);
    v.dispatch(v.state.tr.insertText('x', ARROW + 1));
    expect(foldState(v.state).arrowPos).toEqual([]);
    expect(listFoldKey.getState(v.state)!.pendingRebuild).toBe(false);
  });

  it('折叠项失去子列表后，折叠位置被剪掉（不留幽灵折叠）', () => {
    const v = mountView(NESTED);
    v.dispatch(v.state.tr.setMeta(listFoldKey, { toggle: ITEM }));
    expect(foldState(v.state).folded).toEqual([ITEM]);

    v.dispatch(v.state.tr.delete(HIDDEN_FROM, HIDDEN_TO));
    expect(foldState(v.state).folded).toEqual([]);
  });

  it('局部重建只重算窗口内的装饰（窗口外那道不重新创建）', () => {
    const doc = docOf('- A\n  - A1\n- B\n\n分隔\n\n- C\n  - C1\n');
    const v = new EditorView(mount!, {
      state: EditorState.create({
        schema,
        doc,
        selection: TextSelection.create(doc, 3),
        plugins: [createListFoldPlugin()],
      }),
    });

    const base = listFoldKey.getState(v.state)!.decorations;
    const positions = base.find().map((d) => d.from);
    expect(positions.length, '前置条件：两张列表各有一个箭头').toBe(2);

    // 只重建第一张列表；全量重建会把两条都重造，局部重建只造窗口内那一条
    const spy = vi.spyOn(Decoration, 'widget');
    restoreSpy = () => spy.mockRestore();
    const next = rebuildDecorationsInRange(doc, new Set(), base, 0, doc.child(0).nodeSize);
    expect(next.find().map((d) => d.from)).toEqual(positions);
    expect(spy).toHaveBeenCalledTimes(1);
    v.destroy();
  });
});
