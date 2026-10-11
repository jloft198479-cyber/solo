import { InputRule } from '@tiptap/core';

import { ITEM_NODE_TYPES } from '../list-move';

/**
 * 列表标记输入规则的「项内不嵌套」早退守卫（交互内核线审核 F3 / 台账 §二 #59）。
 *
 * 病：在列表项里敲 `- ` / `* ` / `1. ` / `[ ] `，上游 `wrappingInputRule`（工厂在
 * `@tiptap/core/dist/index.js:6995-7024`，注册位在 `@tiptap/extension-list:64-80`）用
 * `findWrapping` 找包装位置——本仓 `listItem.content = 'block+'`（台账 §二 #30）⇒ 项内
 * 直接收得下一个新列表，`findWrapping` 于是返回 `bulletList > listItem` **两级**包装，
 * 当前行被塞进一个新的子列表。实测产物
 * `bulletList(listItem(甲), listItem(bulletList(listItem(乙))))`、落盘 `- 甲\n- - `：
 * 用户想要「同级再来一行」，拿到的是「缩进一层」。
 *
 * 判据不是「感觉不对」，是契约公理 2（`docs/PROPOSAL-list-semantics.md` §1 第 2 条）：
 * **只有层级动词（Tab / Shift+Tab / 拖曳 / 转普通段落）能改缩进，其它命令一律不得改变
 * 任何一行的缩进**。敲列表标记不是层级动词 ⇒ 它不许把这一行往里推。
 * 该判据与深度无关，故嵌套项内同样早退（要更深一层请用 Tab）。
 *
 * 药：**不复刻上游那套包装逻辑**（AGENTS 禁令 #12：不许手抄库函数重写）。给上游每条
 * 列表输入规则配一条**同 `find` 的早退规则**排在前面：
 * - 待包装块的父节点是列表项 ⇒ 只把刚敲的标记删掉、不 wrap（人已经在列表里，那个
 *   标记是多余输入）；
 * - 否则返回 `null` ⇒ 上游 runner（`@tiptap/core` 的 `run$1`，`:4768-4810`）继续问下一条
 *   规则。非列表项路径因此**逐字节等价**：跑的是同一个 handler 对象、同一份 `find`。
 *
 * `find` 取自上游规则实例（不抄正则字面量）⇒ 上游改触发串，这里自动跟随。
 *
 * 有意不管的边界：`listItem > blockquote > paragraph` 里敲标记，待包装块的父节点是
 * **引用块**不是列表项 ⇒ 放行上游（在引用块里建列表是合法排版，且不改任何一行的列表
 * 缩进）。回归锁把这条边界也钉住了。
 *
 * ⚠️ 回归锁 `__tests__/list-input-guard.spec.ts`：直接调 PM 的 `handleTextInput` prop
 * （＝生产同一条路，只是不经浏览器），故 happy-dom 下可测；真机手感另按 AGENTS §4。
 */

/**
 * 给上游列表输入规则加「项内早退」护航。
 *
 * @param parentRules 上游 `addInputRules()` 的原样产物（`this.parent?.()`）
 * @returns 早退规则在前、上游规则在后的新数组（不改上游规则对象本身）
 */
export function guardListInputRules(parentRules: InputRule[]): InputRule[] {
  const earlyExit = parentRules.map(
    (rule) =>
      new InputRule({
        find: rule.find,
        undoable: rule.undoable,
        handler: ({ state, range }) => {
          // `range.from` 指向文档里那个标记字符（runner 已把「刚敲的字符」算进 match），
          // 故它必然落在待包装的块内 —— 用它的祖先判，比读选区更贴 runner 的口径。
          const $from = state.doc.resolve(range.from);
          if ($from.depth < 1) return null;
          if (!ITEM_NODE_TYPES.has($from.node($from.depth - 1).type.name)) return null;
          // 只删标记、不 wrap：`state.tr` 是 runner 传进来的那条链式事务，写它即生效
          // （runner 随后统一 dispatch，并按 `undoable` 记入输入规则撤销链）。
          state.tr.delete(range.from, range.to);
        },
      }),
  );
  return [...earlyExit, ...parentRules];
}
