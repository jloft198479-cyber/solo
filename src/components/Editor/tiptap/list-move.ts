import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/**
 * 列表项「同层换位」—— 整项上移 / 下移的唯一实现。
 *
 * 由键盘 `Alt+↑/↓` 触发（`registry.ts` 的 `list.moveItemUp/Down`）；将来若接鼠标拖拽，
 * 复用同一份换位逻辑，只换触发器（见 docs/PROPOSAL-list-row-drag.md）。
 *
 * **「同层」是硬约束**：只在**同一个父列表节点**的兄弟之间挪动，绝不改变缩进层级。
 * 跨层（左右拖改变层级）是另一个功能，本模块不涉及。
 *
 * 三条设计约束（勿违）：
 * 1. **单事务**：删除 + 插入合进一个 transaction ⇒ 一次 Ctrl+Z 即还原。拆成两个事务
 *    会让用户按两次撤销，属体验缺陷（单测锁住）。
 * 2. **格式零改动**：只重排节点顺序，不新增语法、不碰 parser / serializer / schema
 *    ⇒ 保真三道防线不受影响（重排后的往返保真由单测兜底）。
 * 3. **组字期不响应**：`view.composing` 为真时直接拒绝 —— 挪动节点会打断正在上屏的
 *    文字（与 `composition-freeze.ts` 同一条铁律，见 AGENTS 禁令 #8）。
 *
 * 与 `list-fold.ts` 的关系：两者都要判「这是不是一个列表项 / 列表容器」，判定必须
 * 只有一份（先例见 `transaction-shape.ts` 的提取说明：各自复制会漂移）。故节点类型
 * 集合在此定义，`list-fold.ts` 直接引用。
 */

/** 列表容器节点类型（可容纳可移动列表项的父节点） */
export const LIST_NODE_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
/** 列表项节点类型（无序项 / 待办项） */
export const ITEM_NODE_TYPES = new Set(['listItem', 'taskItem']);

/** -1 = 上移，1 = 下移（与「兄弟索引增量」同向，便于 `index + direction` 直接运算） */
export type ListMoveDirection = -1 | 1;

/**
 * 把光标所在列表项在同层内移动一格。
 *
 * @returns 是否「认领」了这次操作——
 * - `true`：在列表项内（含已到首 / 末位的空操作）⇒ 调用方应阻止按键默认行为；
 * - `false`：光标不在列表项内 / 组字中 ⇒ 调用方应放行，交给别的处理者。
 */
export function moveListItem(view: EditorView, direction: ListMoveDirection): boolean {
  if (view.composing) return false;

  const { state } = view;
  const $from = state.selection.$from;

  // 向上找**最内层**的列表项：取最内层即天然得到「同层」的判定基准
  // （光标在嵌套子列表里时，动的是子列表里的那一项，而不是外层父项）
  let itemDepth = -1;
  for (let depth = $from.depth; depth > 0; depth--) {
    if (ITEM_NODE_TYPES.has($from.node(depth).type.name)) {
      itemDepth = depth;
      break;
    }
  }
  if (itemDepth < 1) return false;

  const listDepth = itemDepth - 1;
  const listNode = $from.node(listDepth);
  // 父节点必须真是列表容器：itemDepth 为 1 时 listDepth 为 0（doc），在此挡掉
  if (!LIST_NODE_TYPES.has(listNode.type.name)) return false;

  const index = $from.index(listDepth);
  const targetIndex = index + direction;

  // 已在首 / 末位：认领按键但不动文档（返回 false 会让按键继续往下传）
  if (targetIndex < 0 || targetIndex >= listNode.childCount) return true;

  const itemNode = $from.node(itemDepth);
  const itemStart = $from.before(itemDepth);
  const itemEnd = itemStart + itemNode.nodeSize;

  // 目标兄弟的文档起点 = 列表内容起点 + 它前面所有兄弟的宽度。
  // 不用 nodeAt 反查，避免依赖同名节点的位置巧合。
  let targetStart = $from.start(listDepth);
  for (let i = 0; i < targetIndex; i++) targetStart += listNode.child(i).nodeSize;
  const targetEnd = targetStart + listNode.child(targetIndex).nodeSize;

  // 插入点（**旧文档**坐标）：上移插到目标项之前，下移插到目标项之后
  const insertAtOld = direction < 0 ? targetStart : targetEnd;

  const tr = state.tr;
  tr.delete(itemStart, itemEnd);
  // 删除后坐标已平移，插入点须经 mapping 换算到新坐标
  const insertAt = tr.mapping.map(insertAtOld);
  tr.insert(insertAt, itemNode);

  // 光标跟着走：保持「项内相对偏移」不变（整项搬走，字符位置自然对得上）
  const offsetInItem = state.selection.from - itemStart;
  const minPos = insertAt + 1;
  const maxPos = insertAt + itemNode.nodeSize - 1;
  const nextPos = Math.min(Math.max(insertAt + offsetInItem, minPos), maxPos);
  tr.setSelection(TextSelection.near(tr.doc.resolve(nextPos), 1));

  // 快捷路径下编辑器必然已有焦点（调用方门控）；命令面板路径需要先把焦点交回编辑器，
  // 否则用户看不到结果。此处 focus 由用户显式动作触发，与 IME 无关。
  if (!view.hasFocus()) view.focus();
  view.dispatch(tr.scrollIntoView());
  return true;
}
