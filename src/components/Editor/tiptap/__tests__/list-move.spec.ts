// @vitest-environment happy-dom
/**
 * 列表项「同层换位」的契约锁。
 *
 * 本模块是键盘 `Alt+↑/↓`（命令 `list.moveItemUp/Down`）的唯一实现，将来鼠标拖拽也复用它。
 * 本文件锁住五类契约：① 同层互换且**整棵子树一起走**；② 嵌套里动的是内层那一项；
 * ③ 首/末位「认领按键但不动文档」；④ 非列表 / 组字中一律不认领；⑤ 单事务（一次撤销即还原）。
 *
 * 另锁「格式零改动」：换位后的文档序列化出来仍是标准 Markdown（否则就是动了用户文件）。
 */
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestSchema, normalize } from '../markdown/__tests__/test-utils';
import { parseMarkdown } from '../markdown/parser';
import { serializeMarkdown } from '../markdown/serializer';
import { moveListItem } from '../list-move';

const schema = createTestSchema();

let mount: HTMLElement;
let view: EditorView | null = null;

beforeEach(() => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
});

afterEach(() => {
  if (view && !view.isDestroyed) view.destroy();
  view = null;
  document.body.innerHTML = '';
});

/** 定位文档里某段文字的**起始光标位置**（用于把光标放进指定的列表项） */
function posOfText(doc: PMNode, text: string): number {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isText) {
      const index = node.text!.indexOf(text);
      if (index >= 0) {
        found = pos + index;
        return false;
      }
    }
    return true;
  });
  if (found === null) throw new Error(`用例定位失败：文档里没有「${text}」`);
  return found;
}

function mountView(md: string, cursorText: string): EditorView {
  const doc = parseMarkdown(schema, md);
  view = new EditorView(mount, {
    state: EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, posOfText(doc, cursorText)),
      plugins: [history()],
    }),
  });
  return view;
}

/** 两侧都过同一序列化器 ⇒ 只比内容与顺序，不受序列化格式约定（如有序列表编号起点）影响 */
function expectSameDoc(v: EditorView, expectedMd: string) {
  expect(normalize(serializeMarkdown(v.state.doc))).toBe(
    normalize(serializeMarkdown(parseMarkdown(schema, expectedMd))),
  );
}

/** `EditorView.composing` 是原型 getter，装实例 getter 覆盖（同 list-fold.spec） */
function setComposing(v: EditorView, value: boolean) {
  Object.defineProperty(v, 'composing', { configurable: true, get: () => value });
}

const THREE = '- A\n- B\n- C\n';

describe('moveListItem 同层换位', () => {
  it('上移一位：与上一个兄弟互换，且序列化仍是标准 Markdown', () => {
    const v = mountView(THREE, 'B');
    expect(moveListItem(v, -1)).toBe(true);
    expect(normalize(serializeMarkdown(v.state.doc))).toBe('- B\n- A\n- C\n');
  });

  it('下移一位：与下一个兄弟互换', () => {
    const v = mountView(THREE, 'B');
    expect(moveListItem(v, 1)).toBe(true);
    expect(normalize(serializeMarkdown(v.state.doc))).toBe('- A\n- C\n- B\n');
  });

  it('带子项的整棵搬走（子列表跟着父项一起走）', () => {
    const v = mountView('- A\n  - A1\n- B\n', 'A');
    expect(moveListItem(v, 1)).toBe(true);
    expectSameDoc(v, '- B\n- A\n  - A1\n');
  });

  it('嵌套列表里动的是**内层**那一项，外层父项不动', () => {
    const v = mountView('- A\n  - A1\n  - A2\n- B\n', 'A2');
    expect(moveListItem(v, -1)).toBe(true);
    expectSameDoc(v, '- A\n  - A2\n  - A1\n- B\n');
  });

  it('待办列表同样支持', () => {
    const v = mountView('- [ ] x\n- [ ] y\n', 'y');
    expect(moveListItem(v, -1)).toBe(true);
    expectSameDoc(v, '- [ ] y\n- [ ] x\n');
  });

  it('有序列表：序号按新顺序重排', () => {
    const v = mountView('1. a\n2. b\n', 'b');
    expect(moveListItem(v, -1)).toBe(true);
    expectSameDoc(v, '1. b\n2. a\n');
  });

  it('混合列表（普通项与待办项同层）也能换位', () => {
    const v = mountView('- [ ] x\n- y\n', 'y');
    expect(moveListItem(v, -1)).toBe(true);
    expectSameDoc(v, '- y\n- [ ] x\n');
  });
});

describe('moveListItem 的边界与拒绝', () => {
  it('首项上移：认领按键但不动文档（返回 true，避免按键继续下传）', () => {
    const v = mountView(THREE, 'A');
    const before = serializeMarkdown(v.state.doc);
    expect(moveListItem(v, -1)).toBe(true);
    expect(serializeMarkdown(v.state.doc)).toBe(before);
  });

  it('末项下移：认领按键但不动文档', () => {
    const v = mountView(THREE, 'C');
    const before = serializeMarkdown(v.state.doc);
    expect(moveListItem(v, 1)).toBe(true);
    expect(serializeMarkdown(v.state.doc)).toBe(before);
  });

  it('单项列表：认领按键但不动文档', () => {
    const v = mountView('- 独苗\n', '独苗');
    const before = serializeMarkdown(v.state.doc);
    expect(moveListItem(v, 1)).toBe(true);
    expect(serializeMarkdown(v.state.doc)).toBe(before);
  });

  it('光标不在列表项内（普通段落）：不认领、不动文档', () => {
    const v = mountView('普通段落\n\n- A\n- B\n', '普通段落');
    const before = serializeMarkdown(v.state.doc);
    expect(moveListItem(v, -1)).toBe(false);
    expect(serializeMarkdown(v.state.doc)).toBe(before);
  });

  it('组字中：不认领、不动文档（挪节点会打断正在上屏的文字）', () => {
    const v = mountView(THREE, 'B');
    setComposing(v, true);
    const before = serializeMarkdown(v.state.doc);
    expect(moveListItem(v, -1)).toBe(false);
    expect(serializeMarkdown(v.state.doc)).toBe(before);
  });
});

describe('moveListItem 的事务形态', () => {
  it('单事务：只 dispatch 一次', () => {
    const v = mountView(THREE, 'B');
    const spy = vi.spyOn(v, 'dispatch');
    expect(moveListItem(v, -1)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('一次撤销即回到原顺序（单事务的直接后果）', () => {
    const v = mountView(THREE, 'B');
    const before = serializeMarkdown(v.state.doc);

    expect(moveListItem(v, -1)).toBe(true);
    expect(normalize(serializeMarkdown(v.state.doc))).toBe('- B\n- A\n- C\n');

    // 注意：prosemirror-history 的 buildCommand 只在**传了 dispatch 回调**时才产出事务；
    // 单传 state 只返回布尔（写成 `v.dispatch(undo(v.state))` 会 dispatch 一个 true）。
    expect(undo(v.state, (tr) => v.dispatch(tr))).toBe(true);
    expect(normalize(serializeMarkdown(v.state.doc))).toBe(normalize(before));
  });

  it('光标跟着被移动的那一项走（项内相对偏移不变）', () => {
    const v = mountView(THREE, 'B');
    expect(moveListItem(v, -1)).toBe(true);
    const { from } = v.state.selection;
    // 光标原本在「B」的起始处，换位后应仍在「B」的起始处
    expect(v.state.doc.textBetween(from, from + 1)).toBe('B');
  });
});
