// @vitest-environment happy-dom
/**
 * 第三方审查 · 批 3 探针：列表换位事务会不会弄丢折叠态
 *
 * 运行：npx vitest run --config docs/review-artifacts/vitest.probe.config.ts
 *
 * 命题：折叠态按 PM 文档坐标存（`list-fold.ts:45` `foldedByPath: Map<path, Set<pos>>`），
 * 跨事务靠 `mapFolded`（`:213-221`）用 `tr.mapping.mapResult(pos)` 平移，
 * 且**只保留 `deleted === false` 的位置**。而 `list-move.ts:83-86` 的换位是
 * 单事务 `tr.delete(itemStart, itemEnd)` → `tr.insert(...)`，
 * 被移动项的起点在第一步即进入 deleted 状态。
 *
 * ⇒ 怀疑：对一个**已折叠**的列表项按 Alt+↑/↓，它的折叠位会被判 deleted 并丢弃，
 *    表现为「移动后该项自己展开了」。
 *
 * 本探针调用**生产函数** `moveListItem`（非复刻），通过包裹 `view.dispatch` 截获真实事务。
 */
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestSchema } from '../../src/components/Editor/tiptap/markdown/__tests__/test-utils';
import { parseMarkdown } from '../../src/components/Editor/tiptap/markdown/parser';
import { moveListItem } from '../../src/components/Editor/tiptap/list-move';

const schema = createTestSchema();
const MD = `- 甲
  - 子甲1
  - 子甲2
- 乙
- 丙
`;

/** 复刻生产 mapFolded 的判据（list-fold.ts:213-221），逐行等价 */
function mapFoldedLikeProduction(folded: Set<number>, tr: any): Set<number> {
  if (folded.size === 0) return folded;
  const next = new Set<number>();
  folded.forEach((pos) => {
    const mapped = tr.mapping.mapResult(pos);
    if (!mapped.deleted) next.add(mapped.pos);
  });
  return next;
}

let mount: HTMLElement;
let view: EditorView | null = null;

beforeEach(() => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
});

afterEach(() => {
  if (view && !view.isDestroyed) view.destroy();
  view = null;
});

describe('折叠态 × 列表换位', () => {
  it('截获真实换位事务，看折叠位是否被判 deleted', () => {
    const doc = parseMarkdown(schema, MD);
    let state = EditorState.create({ schema, doc });
    view = new EditorView(mount, { state });

    // 折叠目标 = 顶层第一个 listItem（「甲」），其文档坐标为 1
    const foldedPos = 1;
    const target = state.doc.nodeAt(foldedPos);
    console.log(`折叠目标 pos=${foldedPos} 节点=${target?.type.name} 子节点=${target?.childCount}`);
    expect(target?.type.name).toBe('listItem');

    // 光标放进「甲」内
    // 光标放进「甲」**自己的段落**里（不是它的嵌套子列表）。
    // pos 结构：bulletList@0 → listItem(甲)@1 → paragraph@2 → text「甲」@3
    // 若放到 +4/+5 会落进嵌套子列表，moveListItem 取的是「最内层」列表项，
    // 于是动的是子项而不是被折叠的父项 —— 那会得到一个假的「没事」结论。
    const tr0 = state.tr;
    tr0.setSelection(TextSelection.near(tr0.doc.resolve(foldedPos + 2)));
    view.dispatch(tr0);
    state = view.state;
    console.log('光标实际落在项 =', JSON.stringify(state.selection.$from.parent.textContent));

    // 截获生产函数 dispatch 的事务
    let captured: any = null;
    const original = view.dispatch.bind(view);
    (view as any).dispatch = (tr: any) => {
      captured = tr;
      original(tr);
    };

    const claimed = moveListItem(view, 1); // 下移
    (view as any).dispatch = original;

    console.log('moveListItem 认领 =', claimed, '| 截获到事务 =', !!captured);
    expect(claimed).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured.docChanged).toBe(true);

    const foldedBefore = new Set([foldedPos]);
    const foldedAfter = mapFoldedLikeProduction(foldedBefore, captured);
    const mapResult = captured.mapping.mapResult(foldedPos);

    console.log('=== 关键判据 ===');
    console.log(`mapResult(${foldedPos}) → pos=${mapResult.pos} deleted=${mapResult.deleted}`);
    console.log(`折叠集合 ${[...foldedBefore]} → ${[...foldedAfter]}`);
    const nodeAtNew = captured.doc.nodeAt(mapResult.pos);
    console.log(
      `平移后 pos=${mapResult.pos} 上的节点 = ${nodeAtNew?.type.name}（子节点 ${nodeAtNew?.childCount}）`,
    );
    console.log('换位后首项文本 =', JSON.stringify(captured.doc.child(0).child(0).textContent));

    // 断言「观察到的事实」，不预设结论：把结果打印出来由人判读
    expect(typeof mapResult.deleted).toBe('boolean');
  });
});
