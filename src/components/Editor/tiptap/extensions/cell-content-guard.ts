import { Extension } from '@tiptap/core';
import { Fragment, Node as PMNode, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Step } from '@tiptap/pm/transform';

/**
 * 单元格内容守卫（2026-10-12，台账 §二 #60 / `PROPOSAL-cell-fidelity.md` §10）。
 *
 * 背景：单元格内容已按 GFM 收紧为 `paragraph`（见 `extensions/table.ts` 头注释）——
 * **格内只有行内语法**。但收紧 schema 本身不够：**入站路径会绕过它并造成结构破坏**。
 * 实测（收紧 schema 之后）：
 *  · 格内 `insertContent({ type: 'mathBlock' })` ⇒ 格子被顶出去、表格**多出一格**；
 *  · 格内粘贴 `<ul><li>一</li><li>二</li></ul>` ⇒ **表格被切开**，两个列表项跑到表格**外面**。
 * 这比「内容存不住」更糟（结构破坏 + 内容跑位），所以必须有一道中枢拦截。
 *
 * 两道防线，各管一件事：
 *  ① `filterTransaction` —— **硬不变量**：任何会让「格内出现非段落子节点」的事务一律拒绝。
 *     跑在提交前，因此**不存在**「先破坏、再修复」的中间态（solo 的保真红线不允许
 *     『先改坏再说』）。拦截面覆盖一切入口：命令、粘贴、拖拽、别的插件。
 *  ② `handlePaste` —— **不丢内容**：①只会让粘贴"什么也没发生"，那对用户是丢东西。
 *     故当落点在单元格内、且剪贴板里**带块级结构**（列表 / 引用 / 代码块 / 表格…）时，
 *     改走「拍平成文本、行间用 `<br>` 连」—— `<br>` 是 GFM 单元格里唯一被各家渲染器
 *     认可的换行写法（Typora / GitHub / VS Code 一致），且读侧已能认回（`parser.ts`）。
 *     剪贴板是**纯行内内容**时返回 false，走默认粘贴 ⇒ 加粗等行内格式一个不丢。
 *
 * ⚠️ 反过来的边界（有意不做）：本守卫**不**去"告诉用户为什么没反应"。格内点斜杠菜单里
 * 那些块级项会变成静默无效 —— 彻底的做法是在菜单层按 `can()` 置灰，属独立议题
 * （见 PROPOSAL §10.5 的 B2 后续问题）。
 */
const CELL_NODE_TYPES = new Set(['tableCell', 'tableHeader']);

export const cellContentGuardKey = new PluginKey('cellContentGuard');

/** 该节点树里是否有「块级但非 textblock」的内容（列表 / 引用 / 代码块 / 表格…） */
function fragmentHasBlockStructure(frag: Fragment): boolean {
  let has = false;
  frag.descendants((node) => {
    if (has) return false;
    if (node.isBlock && !node.isTextblock) has = true;
    return !has;
  });
  return has;
}

/** `[from, to)` 区间内是否出现「格内非段落」的非法内容 */
function rangeHasBlockInCell(doc: PMNode, from: number, to: number): boolean {
  let bad = false;
  doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (bad) return false;
    if (!parent || !CELL_NODE_TYPES.has(parent.type.name)) return true;
    // 单元格的直接子节点必须是段落
    if (node.type.name !== 'paragraph') {
      bad = true;
      return false;
    }
    return true;
  });
  return bad;
}

/**
 * 某个事务步骤是否「**往单元格里塞块级结构**」——这是本守卫的**主判据**。
 *
 * 为什么不能只看终态（试过、不行）：塞不进去时 PM 会把单元格/行**撑开**（实测
 * `insertContent({type:'mathBlock'})` ⇒ 多出一个空格子、后面的内容整体挪位），
 * 而**终态本身是合法的**（空格子 + 段落）⇒ 「格内出现非段落」这种终态判据抓不到。
 * ⇒ 改判**步骤意图**：该步携带的内容里有「块级但非 textblock」的节点，且**插入点在单元格内**，
 * 就拒绝。判据精确、不误伤（格外插入块结构照常放行）。
 */
function stepInsertsBlockIntoCell(steps: readonly Step[], oldDoc: PMNode): boolean {
  for (const step of steps) {
    // `Step` 基类没有 `from` / `slice`（只有 ReplaceStep / ReplaceAroundStep 有）⇒ 结构化窄化
    const { from, slice } = step as { from?: number; slice?: Slice };
    if (from === undefined || !slice || !fragmentHasBlockStructure(slice.content)) continue;
    const $from = oldDoc.resolve(Math.min(Math.max(from, 0), oldDoc.content.size));
    for (let d = $from.depth; d > 0; d--) {
      if (CELL_NODE_TYPES.has($from.node(d).type.name)) return true;
    }
  }
  return false;
}

/** 光标是否在表格单元格内 */
function selectionInCell(view: EditorView): boolean {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if (CELL_NODE_TYPES.has($from.node(d).type.name)) return true;
  }
  return false;
}

export const CellContentGuard = Extension.create({
  name: 'cellContentGuard',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: cellContentGuardKey,

        filterTransaction(tr, state) {
          if (!tr.docChanged) return true;
          // 主判据：有步骤往单元格里塞块级结构 ⇒ 拒绝（终态判据抓不到，见函数注释）
          if (stepInsertsBlockIntoCell(tr.steps, state.doc)) return false;
          // 兜底判据：终态里真的出现了「格内非段落」（别的路径漏进来的）⇒ 拒绝
          let from = Infinity;
          let to = -1;
          tr.steps.forEach((step) => {
            step.getMap().forEach((_oldFrom, _oldTo, newFrom, newTo) => {
              if (newFrom < from) from = newFrom;
              if (newTo > to) to = newTo;
            });
          });
          if (from === Infinity || to <= from) return true;
          // ⚠️ 多步事务里各步的映射位置只在**中间态**成立，直接拿去查终态会越界
          // （实测 `nodesBetween` 抛 `Cannot read properties of undefined`）⇒ 必须夹取到终态尺寸
          const size = tr.doc.content.size;
          const lo = Math.max(0, Math.min(from, size));
          const hi = Math.max(0, Math.min(to, size));
          if (lo >= hi) return true;
          return !rangeHasBlockInCell(tr.doc, lo, hi);
        },

        handlePaste(view: EditorView, _event: ClipboardEvent, slice: Slice) {
          if (!selectionInCell(view)) return false;
          if (!fragmentHasBlockStructure(slice.content)) return false; // 纯行内内容走默认路径
          const schema = view.state.schema;
          const lines = slice.content
            .textBetween(0, slice.content.size, '\n')
            .split('\n');
          const nodes: PMNode[] = [];
          lines.forEach((line, i) => {
            if (i > 0) nodes.push(schema.nodes.hardBreak.create());
            if (line) nodes.push(schema.text(line));
          });
          if (!nodes.length) return false;
          view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0)));
          return true;
        },
      }),
    ];
  },
});
