import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { isFrozen } from '../composition-freeze';

/**
 * 列表「行首退格永不劈开列表」守卫（方案 `docs/PROPOSAL-list-structure-fix.md` §四 方案 A）。
 *
 * 病（§2.1，实测复现）：`- 甲 / - 乙 / - 丙` 中间项行首按 Backspace，上游 ListKeymap
 * 走 `liftListItem → liftOutOfList`，该函数在内容两侧塞空 list 壳且**不做 join** ⇒
 * 列表被切成两个独立容器、中间夹一个 doc 层孤立段落，且原样落盘、重开结构不变。
 * 这正是用户报「列表里母主题 Alt+↑ 挪不动」的真因（`list-move.ts` 只挪同容器兄弟）。
 *
 * 药（§七 九条决定 + §十复审 F-1/F-2/F-3/F-4 修订）：新增本扩展在 ListKeymap
 * **之前**接管相关按键（`priority: 101` > StarterKit 扩展默认 100，复审 F-2）：
 *
 * | 光标所在（顶层多项列表） | 行首 Backspace 行为 |
 * |---|---|
 * | 非首项 | 与上一项合并（**并成一段**，复审 F-1：一次 joinBackward 会留项内第二段，故连跑两次；第二次不成则退一步只做项级合并，仍不劈） |
 * | 首项，前面是顶层块 | 把首项 lift 出来再并进前一块；join 不成则只 lift（不劈） |
 * | 首项，列表是文档第一块 | 不动（够不着就不动，§七 决定 1） |
 * | 首块是空 textblock | 只删这个空块（项结构不动；单项空列表除外 ⇒ 放行上游 = 退出列表 / 撤输入规则出口，§七 决定 2） |
 * | 单项列表 | 放行上游 lift（退出列表，保持现状） |
 * | 嵌套子项 | 放行上游 lift（`liftToOuterList` 本来就收尾 join，安全） |
 *
 * Mod-Backspace 与 Backspace 同罪同治（复审 F-4：上游 `:716` 接的同一个 handler）；
 * 本守卫判定不成立时一律 `return false` 放行，特殊块（mermaid/math 等）的
 * Mod-Backspace 整块删除语义不受影响。
 *
 * Shift-Tab 只锁「不许劈」（复审 F-3：上游 `:492` 绑的就是 liftListItem，顶层必劈）：
 * 顶层项吞掉不做事；嵌套项放行上游正常反缩进。契约锁 `__tests__/list-backspace.spec.ts`。
 *
 * ⚠️ 跑在 happy-dom，不是 WebView2 真机（AGENTS §4）：发版前必须真机复核
 * ——特别是「打完 `- ` / `# ` 立刻退格」的输入规则撤回出口（复审 F-2：
 * 合成 insertText 不触发 InputRule，此路单测盖不住）。
 */

/** 项容器类型（普通项 + 待办项）；列表容器判定见 sensitive-areas #15 */
const ITEM_TYPES = new Set(['listItem', 'taskItem']);

/** 从光标位置向上找最近的项容器深度；不在任何项内返回 -1 */
function itemDepthAt($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) {
    if (ITEM_TYPES.has($pos.node(d).type.name)) return d;
  }
  return -1;
}

/** 光标所在项是否嵌套（项容器之上还有另一层项容器） */
function isNestedItem($from: ResolvedPos, itemDepth: number): boolean {
  for (let d = itemDepth - 2; d > 0; d--) {
    if (ITEM_TYPES.has($from.node(d).type.name)) return true;
  }
  return false;
}

interface ItemContext {
  item: PMNode;
  itemDepth: number;
  /** 项在所属列表容器里的序号 */
  index: number;
}

/** 判定光标是否处于「项的第一个子块的开头」，是则返回项上下文 */
function resolveGuardContext(editor: Editor): ItemContext | null {
  const { selection } = editor.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  if ($from.parentOffset !== 0) return null;
  const itemDepth = itemDepthAt($from);
  if (itemDepth < 0) return null;
  const item = $from.node(itemDepth);
  // 只接管「第一个子块」的开头；项内第二段开头的默认段落合并本来安全（§2.3）
  if ($from.depth !== itemDepth + 1 || item.firstChild !== $from.parent) return null;
  // 项在列表容器里的序号：从容器首项逐项累加 nodeSize
  const itemStart = $from.before(itemDepth);
  let cursor = $from.before(itemDepth - 1) + 1;
  let index = 0;
  const list = $from.node(itemDepth - 1);
  while (cursor < itemStart) {
    cursor += list.child(index).nodeSize;
    index++;
  }
  return { item, itemDepth, index };
}

function handleListBackspace(editor: Editor): boolean {
  const context = resolveGuardContext(editor);
  if (!context) return false;
  const { view } = editor;
  // 组字门控（AGENTS 禁令 #8）：只在「本守卫即将接管结构变更」的键位上吞掉，
  // 组字期绝不做结构事务；不满足接管条件的键照常穿透（保持上游既有行为）
  if (isFrozen(view)) return true;
  const { item, itemDepth, index } = context;
  const { state } = editor;
  const list = state.selection.$from.node(itemDepth - 1);
  const firstBlock = item.firstChild as PMNode;

  // 首块是空 textblock（如 F-8 修复后列表项里的补位空段）：只删这个空块，
  // 项结构不动。单项空列表除外——那是「退出列表」+「撤销 - 输入规则」的
  // 上游出口（undoInputRule 在上游 handleBackspace 第一行，复审 F-2），必须放行
  if (firstBlock.isTextblock && firstBlock.content.size === 0) {
    if (list.childCount === 1) return false;
    const tr = state.tr;
    const from = state.selection.$from.before(itemDepth + 1);
    const to = state.selection.$from.after(itemDepth + 1);
    tr.delete(from, to);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from), -1));
    view.dispatch(tr);
    return true;
  }

  // 单项列表：行首退格 = 退出列表（上游 lift 行为正确，§七 决定 2 保持现状）
  if (list.childCount === 1) return false;

  if (index > 0) {
    // 非首项：并进上一项（同容器兄弟），永不劈开（契约「禁止劈开」组）
    // F-1：一次 joinBackward 得项内第二段（肉眼无法分辨的隐藏段落），
    // 连跑两次才并成一段；第二步不成（末块类型不同等）退一步只做项级
    // 合并——留两块好过劈成两段
    if (editor.chain().joinBackward().joinBackward().run()) return true;
    return editor.chain().joinBackward().run();
  }

  // 首项 + 多项：列表是文档第一块 ⇒ 不动（§七 决定 1「够不着就不动」）
  const listStart = state.selection.$from.before(itemDepth - 1);
  if (listStart === 0) return true;

  // 前面有顶层块：把首项 lift 出来并进前一块（契约：正文 + 甲 ⇒ 正文甲）；
  // join 不成（前块是 heading 等类型不兼容）则只 lift——首项 lift 实测不劈（§2.1 表）
  const name = item.type.name;
  if (editor.chain().liftListItem(name).joinBackward().run()) return true;
  return editor.chain().liftListItem(name).run();
}

function handleListShiftTab(editor: Editor): boolean {
  const context = resolveGuardContext(editor);
  if (!context) return false;
  // 组字门控：同 Backspace，只在接管范围吞
  if (isFrozen(editor.view)) return true;
  const { itemDepth } = context;
  // 嵌套子项放行上游（正常反缩进，安全）；顶层项吞掉——上游 Shift-Tab 绑
  // liftListItem，顶层必劈（复审 F-3），「只锁不许劈、不锁具体行为」
  if (isNestedItem(editor.state.selection.$from, itemDepth)) return false;
  return true;
}

export const ListBackspaceGuard = Extension.create({
  name: 'listBackspaceGuard',
  // 必须 ≥101 才压得过 StarterKit 里 ListKeymap 的默认 100（复审 F-2：
  // tiptap 每扩展各成一个 keymap 插件，按 priority 降序询问）
  priority: 101,
  addKeyboardShortcuts() {
    return {
      Backspace: () => handleListBackspace(this.editor),
      // Mod-Backspace 与 Backspace 同罪同治（复审 F-4）；本守卫判定不成立时
      // 返回 false 放行，mermaid / math 等特殊块的 Mod-Backspace 整块删除不受影响
      'Mod-Backspace': () => handleListBackspace(this.editor),
      'Shift-Tab': () => handleListShiftTab(this.editor),
    };
  },
});
