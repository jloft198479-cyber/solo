import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { ITEM_NODE_TYPES, LIST_NODE_TYPES } from '../list-move';
import { isFrozen } from '../composition-freeze';

/**
 * 列表「回车＝新建同级项」守卫（2026-10-19 用户报：父项行尾回车，子项被新项吃掉）。
 *
 * 病（实测复现）：`- A` 下挂 `- A1`，光标停在 A 末尾按 Enter，上游 `ListItem` 的
 * `Enter` 走 `splitListItem`（`@tiptap/extension-list:490`，待办项同款 `:1252`），
 * 后者用 `prosemirror-schema-list:177-183` 的 `tr.split($from.pos, 2, types)` 在
 * **段落末尾**切整项 —— 切点之后的一切（包括子列表）都归新项 ⇒ 得到
 * `- A / - (空) /   - A1`。新项凭空多了一群孩子，A 反而失去了 A1；
 * 用户看到的就是「回车建了个父项」。
 * 这也违反本项目自己的契约「Enter＝新建同级项」
 * （`docs/archive/PROPOSAL-list-outline-experience.md:135`）。
 *
 * 药：在 ListItem / TaskItem（priority 100）之前接管 Enter（本扩展 101），
 * **只在标准大纲项上动手**：光标位于项内首块末尾，且首块之后的块**全是子列表**。
 * 此时在**整项之后**（含子列表）插入同类型空项 —— 子列表留在原项名下，
 * 新项是干净的同级空项，与幕布 / Workflowy 一致。
 *
 * 为什么新项落在「整项之后」而不是紧贴 A 之后：树结构里父项与它的第一个孩子之间
 * 塞不进兄弟节点。要让 A1 留在 A 名下，新兄弟只能排在整棵子树后面。
 *
 * 边界（有意不接管，原样走上游）：
 * - 光标不在项内首块（项内第三段、子项里）⇒ 上游 split 本来就是对的；
 * - 光标不在首块末尾（行中回车）⇒ 行中切分的归属是独立议题，本次不碰；
 * - 首块之后混有普通块（项内续行 / 多段落项）⇒ 那是在项内续行，不是大纲换项；
 * - 单块项（没有子列表）⇒ 上游行为已正确，不必绕路。
 *
 * 例外（**会接管**）：列表项内的**代码块** —— 上游 keymap 顺序让 ListItem 抢走回车
 * （见 `handleListEnter` 内注释），本扩展按 `newlineInCode` 语义补一个换行，
 * 保证「代码块在列表项里也能正常换行」。
 *
 * 契约锁 `__tests__/list-enter.spec.ts`；⚠️ 跑在 happy-dom，真机手感另按 AGENTS §4。
 */

/** 从光标位置向上找最近的项容器深度；不在任何项内返回 -1 */
function itemDepthAt($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) {
    if (ITEM_NODE_TYPES.has($pos.node(d).type.name)) return d;
  }
  return -1;
}

/** 首块之后是否**全是子列表**（＝一条标准大纲项；混入普通块则是在项内续行） */
function restAreChildLists(item: PMNode): boolean {
  if (item.childCount < 2) return false;
  for (let i = 1; i < item.childCount; i++) {
    if (!LIST_NODE_TYPES.has(item.child(i).type.name)) return false;
  }
  return true;
}

function handleListEnter(editor: Editor): boolean {
  const { state } = editor;
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;

  // 列表项内的代码块：Enter = 在代码里换行（与文档级代码块一致）。
  // 上游顺序坑（2026-10-20 复审，实测）：tiptap 按「反转后的扩展表」收集 keymap
  // （`core/dist:5225` `sortExtensions([...extensions].reverse())`），同 priority 时
  // ListItem 的 Enter 排在 core Keymap 的 `newlineInCode` 之前 ⇒ 列表项里代码块的回车
  // 会**拆项**，子列表还会被新项带走。这里按 `newlineInCode` 的语义补回换行。
  if ($from.parent.type.spec.code && itemDepthAt($from) > 0) {
    // 组字期绝不做事务（AGENTS 禁令 #8），直接吞掉；PM 本身也会在合成态忽略 keydown，
    // 这条分支与下方同款，属意图哨兵
    if (isFrozen(editor.view)) return true;
    editor.view.dispatch(state.tr.insertText('\n'));
    return true;
  }

  const itemDepth = itemDepthAt($from);
  if (itemDepth < 0) return false;
  const item = $from.node(itemDepth);
  // 只认「项内首块 + 光标在该块末尾」：项内续行的回车保持上游行为
  if ($from.depth !== itemDepth + 1 || item.firstChild !== $from.parent) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;
  if (!restAreChildLists(item)) return false;
  // 组字门控（AGENTS 禁令 #8）：组字期绝不做结构事务。
  // ⚠️ 上游 PM 在合成态直接忽略 keydown（`prosemirror-view:3189-3193`），这条
  // 分支实测走不到 —— 保留它作**意图哨兵**（同 list-backspace-guard 的 Shift-Tab
  // 组字条），防未来上游行为变化，不当承重逻辑。
  if (isFrozen(editor.view)) return true;

  const newItem = item.type.createAndFill();
  if (!newItem) return false;

  // 整项之后：子列表仍在原项名下，新项是同级的干净空项
  const insertPos = $from.after(itemDepth);
  const tr = state.tr.insert(insertPos, newItem);
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1), 1));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export const ListEnterGuard = Extension.create({
  name: 'listEnterGuard',
  // 必须 ≥101 才压得过 ListItem / TaskItem 的 Enter（StarterKit 默认 100；
  // 与 list-backspace-guard 同款理由，见该文件复审 F-2）
  priority: 101,
  addKeyboardShortcuts() {
    return {
      Enter: () => handleListEnter(this.editor),
    };
  },
});
