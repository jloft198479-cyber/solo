import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { isFrozen } from '../composition-freeze';
import { dissolveShell, isPureShell } from '../list-shell';

/**
 * 列表「行首退格永不劈开列表」守卫（方案 `docs/PROPOSAL-list-structure-fix.md` §四 方案 A）。
 *
 * 病（§2.1，实测复现）：`- 甲 / - 乙 / - 丙` 中间项行首按 Backspace，上游 ListKeymap
 * 走 `liftListItem → liftOutOfList`，该函数在内容两侧塞空 list 壳且**不做 join** ⇒
 * 列表被切成两个独立容器、中间夹一个 doc 层孤立段落，且原样落盘、重开结构不变。
 * 这正是用户报「列表里母主题 Alt+↑ 挪不动」的真因（`list-move.ts` 只挪同容器兄弟）。
 * ⚠️ 注意别把这话推广：**同一个形状若由「转普通段落」主动产生，则是契约批准的正确产物**
 * （`PROPOSAL-list-semantics.md` §8，2026-10-11 拍板 A）——缺陷只指「误操作产生的那一支」。
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
 * Shift-Tab：**顶层项内一律吞掉、不改文档**（＝ no-op）。顶层项缩进已经是 0，
 * 「−1」越界 ⇒ 按 `PROPOSAL-list-semantics.md` §2 动词表（`Shift+Tab` ＝ 缩进 ±1 的
 * 唯一微调动词）此处没有合法动作可做；嵌套项放行上游正常反缩进（实测安全）。
 * 要退出列表请走「转普通段落」那族动词（Ctrl+0 / 命令面板 / 斜杠「正文」）。
 *
 * ⚠️ **本分支的门槛必须只看「在不在项内」，不能要求光标停在项首块 offset 0**
 * （2026-10-11，台账 §二 #55）：Shift-Tab 是随手按的，光标多半停在字中间；旧门槛
 * 只覆盖行首那一格，其余位置一律落到上游 `liftOutOfList` 把容器拆掉 —— 中间项＝
 * 劈成两段 + 中间夹 doc 层孤立段落、首/末项＝把该项甩成 doc 层段落、有选区时
 * 甚至**整张列表解散**（`prosemirror-schema-list/dist/index.js:238-260`）。
 * Backspace 正相反：它天生只在行首发生，故仍用 `resolveGuardContext` 的严格门槛。
 *
 * 契约锁 `__tests__/list-backspace.spec.ts`（offset>0 四格 + 公理 3 + 有选区两格现状）。
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

  // 首块是空 textblock（如 F-8 修复后列表项里的补位空段）：
  // ① 空段 + 其余**全是子列表**（纯空壳）⇒ 只删空段会留下一个没有正文的圆点壳：
  //    壳的 li::marker 与子项 marker 会挤在同一行（2026-10-19 用户看到「两个点」），
  //    落盘还是 `- - A1` 这种怪结构。按 list-demote 的托孤契约整壳溶解、子项升一级。
  // ② 项里还有普通块 ⇒ 只删这个空块，项结构不动（产物合法）。
  // ③ 空段是唯一子块 ⇒ 绝不能只删块——会留下**零子块 listItem**（违反 schema
  //    `block+`），圆点壳残留且上游命令对非法结构全部失效 = 「列表删不掉」
  //    （2026-10-10 用户报告，回归锁 list-backspace.spec.ts「圆点不留壳」组）。
  //    此时删掉**整个空项**；单项空列表仍放行上游——那是「退出列表」+
  //    「撤销 - 输入规则」的出口（undoInputRule 在上游 handleBackspace 第一行，
  //    复审 F-2），必须保持。
  if (firstBlock.isTextblock && firstBlock.content.size === 0) {
    const tr = state.tr;
    // ① 的前置 childCount > 1 不能省：单项空列表（只有空段、没有子列表）也满足
    // isPureShell，若走溶解会把它整项删掉 —— 那条路必须留给「退出列表」的上游 lift。
    if (item.childCount > 1 && isPureShell(item)) {
      const itemStart = state.selection.$from.before(itemDepth);
      dissolveShell(tr, itemStart);
      if (tr.steps.length > 0) {
        // 光标跟到前一项末尾（壳是首项时落到提升上来的首项开头）
        tr.setSelection(
          index > 0
            ? TextSelection.near(tr.doc.resolve(itemStart - 1), -1)
            : TextSelection.near(tr.doc.resolve(itemStart), 1),
        );
        view.dispatch(tr);
        return true;
      }
      // 溶解不成立（子列表塞不进父容器）⇒ 退一步仍按「只删空块」处理
    }
    if (item.childCount > 1) {
      const from = state.selection.$from.before(itemDepth + 1);
      const to = state.selection.$from.after(itemDepth + 1);
      tr.delete(from, to);
      tr.setSelection(TextSelection.near(tr.doc.resolve(from), -1));
      view.dispatch(tr);
      return true;
    }
    if (list.childCount === 1) return false;
    const from = state.selection.$from.before(itemDepth);
    const to = state.selection.$from.after(itemDepth);
    tr.delete(from, to);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from), -1));
    view.dispatch(tr);
    return true;
  }

  // 单项列表：行首退格 = 退出列表（上游 lift 行为正确，§七 决定 2 保持现状）
  if (list.childCount === 1) return false;

  // 嵌套项的**首项**：放行上游 lift —— 与头注释契约表「嵌套子项｜放行上游 lift」一致。
  // 不能走下面的 lift + joinBackward：实测它把「列表与列表」合并，这一行会降级成
  // 父项里的第二段（圆点消失、子树与后续兄弟改挂到父项）；上游 lift 则是整体提升
  // 一级、圆点与子树都在（2026-10-19 体检 P2）。嵌套**非首项**不受影响，仍并进上一项。
  if (index === 0 && isNestedItem(state.selection.$from, itemDepth)) return false;

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

/**
 * 顶层项内 Shift-Tab：一律吞掉、不改文档（顶层项「−1」越界 ⇒ no-op）。
 *
 * 与 Backspace 分支的关键差异：这里**不能**用 `resolveGuardContext` —— 它要求光标
 * 停在项首块 offset 0，而 Shift-Tab 是随手按的，光标多半在字中间；旧门槛只覆盖
 * 行首那一刻，其余位置会落到上游 `liftOutOfList` 拆掉容器（台账 §二 #55）。
 */
function handleListShiftTab(editor: Editor): boolean {
  const { selection } = editor.state;
  // 有选区：保持现状放行上游（是否收编是独立议题，见 PROPOSAL-list-shifttab.md §6 D2）
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  const itemDepth = itemDepthAt($from);
  if (itemDepth < 0) return false; // 不在任何列表项内：放行
  // 组字门控（同 Backspace 分支）：组字期绝不做结构事务，直接吞掉
  if (isFrozen(editor.view)) return true;
  // 嵌套子项放行上游（正常反缩进，安全）；顶层项一律吞掉、不改文档
  if (isNestedItem($from, itemDepth)) return false;
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
