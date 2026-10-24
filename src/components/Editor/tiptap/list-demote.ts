import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { ITEM_NODE_TYPES, LIST_NODE_TYPES } from './list-move';
import { dissolveShell } from './list-shell';
import { isFrozen } from './composition-freeze';

/**
 * 「列表项降级为块」时的**子列表托孤** —— 幕布式大纲该行为的唯一实现。
 *
 * 背景（台账 §一 #50，2026-10-11）：父主题「甲」被清成普通段落时，TipTap 上游
 * `clearNodes` / `setParagraph` 会把甲的子列表**塞进一个空壳列表项**里，
 * 落盘出 `- - 乙` 这种既非原意、又看不见的怪结构。用户的期待（也是业界共识）
 * 是：**老子退休，儿子们上位** —— 甲变段落，乙丙提升为平级顶层项，彼此层级差不变。
 *
 * 三条设计约束（勿违）：
 * 1. **只接管病态路径**：仅当「选区落在含子列表的列表项里」才动手；其余一切
 *    （普通段落、无子列表的列表项）原封不动交给原来的 TipTap 命令 —— 改动面最小，
 *    与既有用例零交叉，出问题也好回滚。
 * 2. **单事务**：托孤 + 转段落 + 去 mark 全在同一个 tr 里 ⇒ 一次 Ctrl+Z 还原
 *    （同级 `list-move.ts::moveListItem` 的同款要求）。
 * 3. **组字期不响应**（`view.composing`）：改结构会打断正在上屏的文字，
 *    与 `composition-freeze.ts` 同一条铁律（AGENTS 禁令 #8）。
 *
 * 为什么结构部分自己写、不去指挥 TipTap 命令：TipTap 的 `chain` 里每个命令看到的
 * 都是**同一份初始 state**（累积的 tr 不回写 state），连续 lift 会基于旧坐标算错。
 * 故这里直接用 PM 原语（`replaceWith` / `Fragment`）自己重组，不指挥命令层。
 */

/**
 * 光标**直接所在**的那个列表项的起点（不在列表项内返回 null）。
 *
 * 必须取最内层：按「范围内所有候选」那套会认错对象 —— 光标在子项 C 里时，
 * 它的父项 B 也在范围内，于是被当成目标处理（表现为父项被误降级、内容重复）。
 */
function innermostItemAt(doc: PMNode, pos: number): number | null {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (ITEM_NODE_TYPES.has($pos.node(depth).type.name)) return $pos.before(depth);
  }
  return null;
}

/** 托孤出去的内容：同类型子列表展开成项（并入父列表），异类型整块保留（保住自己的符号） */
type Carried =
  | { kind: 'items'; nodes: PMNode[] }
  | { kind: 'list'; node: PMNode };

/**
 * 拆开目标项：普通块留下（它们将变成段落），子列表托孤出去。
 *
 * **只拆不改** —— 落点由 `demoteItemStructure` 一处决定。
 * 早先这里（搬）和那里（切父列表）各有一套落点假设，混排双子列表时顺序就会错乱。
 */
function splitItem(item: PMNode, parentList: PMNode): { blocks: PMNode[]; carried: Carried[] } {
  const blocks: PMNode[] = [];
  const carried: Carried[] = [];
  // ⚠️ 判「同类」要下沉到**项**这一层，不能比列表节点：
  // 待办列表解析出来是 `bulletList > taskItem`（父容器仍是 bulletList），
  // 拿列表节点比会判成同类 ⇒ 把子项塞进混编容器 ⇒ PM 补齐出 `- [ ] - 乙`。
  // 取「首项类型」比较；父容器本身混编（taskItem + listItem）时按异类处理（保守、可逆）。
  const itemTypeOf = (list: PMNode) => (list.childCount > 0 ? list.child(0).type.name : null);
  const parentItemType = itemTypeOf(parentList);
  item.forEach((child) => {
    if (!LIST_NODE_TYPES.has(child.type.name)) {
      blocks.push(child);
      return;
    }
    if (parentItemType && itemTypeOf(child) === parentItemType) {
      // 同类型：展开成项并入父列表（列表不断开）。父列表 schema 只容纳列表项，
      // 塞一个列表进去会被 PM 补齐成畸形（`- [ ] - 乙` 就是这么来的）。
      const nodes: PMNode[] = [];
      child.forEach((grandchild) => nodes.push(grandchild));
      carried.push({ kind: 'items', nodes });
    } else {
      // 异类型（如无序项挂在有序/待办项下）：整块提升，保住它自己的列表符号
      carried.push({ kind: 'list', node: child });
    }
  });
  return { blocks, carried };
}

/**
 * 列出「光标所在列表项」向上的所有祖先列表项（从最内层到最外层）。
 *
 * 每个条目给出：该项起点 `itemPos`、它所在的父列表起点 `listPos`、父列表节点。
 * 顶层项也会被计入（它的父列表在文档级）；只有「父列表还被某个 listItem 包着」
 * 才说明存在更外层的祖先 —— 用数组长度 > 1 判断。
 */
function findAncestors(doc: PMNode, itemPos: number) {
  const $pos = doc.resolve(itemPos + 1);
  const ancestors: { itemPos: number; listPos: number; listNode: PMNode }[] = [];
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    const parent = d > 1 ? $pos.node(d - 1) : null;
    if (ITEM_NODE_TYPES.has(node.type.name) && parent && LIST_NODE_TYPES.has(parent.type.name)) {
      ancestors.push({ itemPos: $pos.before(d), listPos: $pos.before(d - 1), listNode: parent });
    }
  }
  return ancestors;
}

/** 用 `from` 的类型 / attrs / marks 重建一张列表 */
function rebuildList(from: PMNode, parts: PMNode[]): PMNode {
  return from.type.create(from.attrs, Fragment.from(parts), from.marks);
}

/**
 * 装配序列：把「项组 / 整块列表」交替的序列里**相邻的项组合并成一张列表**，
 * 遇到整块列表（异类型）才断开。顶层路径与嵌套路径**共用这一条装配规则**。
 *
 * - 嵌套路径：目标项从父列表里被摘除，before / 托孤 / after 应当并回同一张列表。
 * - 顶层路径：before 与托孤之间隔着让位的段落块，各自独立成表；
 *   只有「托孤 + after」相邻，需要合并。
 */
function assembleRuns(parentList: PMNode, runs: Array<PMNode[] | PMNode>): PMNode[] {
  const seq: PMNode[] = [];
  let pending: PMNode[] = [];
  const flush = () => {
    if (pending.length > 0) {
      seq.push(rebuildList(parentList, pending));
      pending = [];
    }
  };
  for (const run of runs) {
    if (Array.isArray(run)) pending.push(...run);
    else {
      flush();
      seq.push(run);
    }
  }
  flush();
  return seq;
}

/** Carried[] → 装配序列：同类型展开成项组（并入父列表），异类型整块保留 */
function carriedRuns(carried: Carried[]): Array<PMNode[] | PMNode> {
  return carried.map((c) => (c.kind === 'items' ? c.nodes : c.node));
}

/**
 * 「托孤 + 换段落」的落点决策 —— 本模块唯一改写结构的地方。
 *
 * 为什么不用官方 `liftListItem`：它一路把内容提到**最外层**列表之外，给中间的子项
 * 转段落时会把它后面的兄弟一起带出去（层级跟着变）—— 违反「操作不外溢」。
 *
 * 两条路径（都是为了「这一目标项转成纯段落，子列表整体减一级」）：
 *
 * 1. **顶层项**（父列表直接在文档级）：块落在父列表原位，前后拆成两张列表。
 *    这是 markdown 表达「列表中间夹段落」的唯一方式 —— 格式限制，非取舍。
 *
 * 2. **嵌套项**（父列表被某个 listItem 包着）：分两步、同一事务 ——
 *    - 先在父列表内摘除目标项并把子列表托孤（before / 托孤 / after 并回一张表）；
 *    - 再把目标的**正文块真正提升到文档级**，插在最外层祖先项之后。
 *    这样块彻底脱离所有 listItem、零缩进，与顶层项行为一致，兑现契约「退出列表」。
 *
 * @returns 段落块的区间 [from, to]（文档级）供调用方统一转类型；空壳项返回 null。
 */
function demoteItemStructure(tr: Transaction, itemPos: number): [number, number] | null {
  const item = tr.doc.nodeAt(itemPos);
  if (!item) return null;

  const ancestors = findAncestors(tr.doc, itemPos);
  if (ancestors.length === 0) return null;
  const innermost = ancestors[0];
  const parentList = innermost.listNode;
  const listStart = innermost.listPos;
  if (!LIST_NODE_TYPES.has(parentList.type.name)) return null;

  // 下标：按宽度累加定位（宁可算，也不用 `$pos.index()` 那种边界取值不直观的）
  let index = -1;
  let walked = 0;
  for (let i = 0; i < parentList.childCount; i++) {
    if (listStart + 1 + walked === itemPos) {
      index = i;
      break;
    }
    walked += parentList.child(i).nodeSize;
  }
  if (index < 0) return null;

  const before: PMNode[] = [];
  const after: PMNode[] = [];
  // ⚠️ `forEach` 的第二个参数是**字节偏移**、第三个才是**子节点下标**。
  //    拿偏移跟下标比大小 ⇒ 切错位置 ⇒ 内容重复 / 顺序错乱（实测踩过）。
  parentList.forEach((child, _offset, i) => {
    if (i < index) before.push(child);
    else if (i > index) after.push(child);
  });

  const { blocks, carried } = splitItem(item, parentList);
  const hasOuter = ancestors.length > 1;

  // ---- 嵌套项：父列表内只摘除目标 + 托孤，正文块留到顶层再插 ----
  if (hasOuter) {
    const inner = assembleRuns(parentList, [before, ...carriedRuns(carried), after]);
    if (inner.length === 0) tr.delete(listStart, listStart + parentList.nodeSize);
    else tr.replaceWith(listStart, listStart + parentList.nodeSize, Fragment.from(inner));

    // 没有要提升到顶层的块（目标只有子列表、自身无正文）⇒ 托孤完即收工
    if (blocks.length === 0) return null;

    // Edit 2：在最外层祖先项之后、文档级插入块 —— 真正脱离所有 listItem
    const outermost = ancestors[ancestors.length - 1];
    const LtopStart = outermost.listPos;
    const Ltop = tr.doc.nodeAt(LtopStart);
    if (!Ltop || !LIST_NODE_TYPES.has(Ltop.type.name)) return null;
    let outerIdx = -1;
    let off = 0;
    Ltop.forEach((child, _o, i) => {
      if (LtopStart + 1 + off === outermost.itemPos) outerIdx = i;
      off += child.nodeSize;
    });
    if (outerIdx < 0) return null;
    const seg1: PMNode[] = [];
    const seg2: PMNode[] = [];
    Ltop.forEach((child, _o, i) => {
      if (i <= outerIdx) seg1.push(child);
      else seg2.push(child);
    });
    // seg1List 构建一次，插入与「块落点测量」共用同一节点（不造一次性节点量尺寸）
    const seg1List = seg1.length > 0 ? rebuildList(Ltop, seg1) : null;
    const replacement: PMNode[] = [];
    if (seg1List) replacement.push(seg1List);
    replacement.push(...blocks);
    if (seg2.length > 0) replacement.push(rebuildList(Ltop, seg2));
    tr.replaceWith(LtopStart, LtopStart + Ltop.nodeSize, Fragment.from(replacement));

    // 最外层祖先若因托孤变成了纯空壳（没有文字、只剩子列表），溶解它，
    // 否则落盘会留下 `- - 丙` 这种畸形（退化输入才会触发，正常大纲不会）。
    // ⚠️ outermost.itemPos 是改动前算的坐标，跨上面两次 replaceWith 仍然有效，
    // 靠两条几何事实（破坏任一条 ⇒ isPureShell 判空 ⇒ 静默 no-op，空壳残留）：
    // ① Edit 1 只重写 parentList —— 它在祖先项内部，不影响 itemPos；
    // ② Edit 2 里祖先项落在 seg1 前缀，前缀子节点原样保留 ⇒ 前缀字节布局不变。
    dissolveShell(tr, outermost.itemPos);

    // 块落点（文档级）：seg1 列表之后
    const start = LtopStart + (seg1List ? seg1List.nodeSize : 0);
    let end = start;
    blocks.forEach((b) => {
      end += b.nodeSize;
    });
    return [start, end];
  }

  // ---- 顶层项：块落在父列表原位（文档级），前后拆成两张列表 ----
  // 空壳项（子列表搬走后什么都不剩 —— 旧 bug 留下的畸形结构）：
  // 前后两段并回一张列表，不留「没有正文的列表项」这种 markdown 讲不清的东西。
  if (blocks.length === 0 && carried.length === 0) {
    const merged = [...before, ...after];
    if (merged.length > 0) tr.replaceWith(listStart, listStart + parentList.nodeSize, rebuildList(parentList, merged));
    else tr.delete(listStart, listStart + parentList.nodeSize);
    return null;
  }

  // 尾部序列：托孤内容（按原次序）+ 后段兄弟，合并进同一张列表（与嵌套路径共用装配规则）
  const tail = assembleRuns(parentList, [...carriedRuns(carried), after]);

  // beforeList 构建一次，插入与「块落点测量」共用同一节点（不造一次性节点量尺寸）
  const beforeList = before.length > 0 ? rebuildList(parentList, before) : null;
  const parts: PMNode[] = [];
  if (beforeList) parts.push(beforeList);
  parts.push(...blocks);
  parts.push(...tail);
  tr.replaceWith(listStart, listStart + parentList.nodeSize, Fragment.from(parts));

  // 段落块的落点：前段之后（前段是列表节点时占它整段宽度）
  const start = listStart + (beforeList ? beforeList.nodeSize : 0);
  let end = start;
  blocks.forEach((b) => {
    end += b.nodeSize;
  });
  return [start, end];
}

/**
 * 光标所在的列表项**是不是指定项类型**（`taskItem` / `listItem`）。
 *
 * ⚠️ 必须比**项**而不是比**列表容器**：待办列表解析出来的父容器常常是
 * `bulletList`（里面 `taskItem` 与 `listItem` 混编），拿容器名判 `taskList` 会落空 ⇒
 * toggle 路径不接管 ⇒ 畸形 `- [ ] - 乙` 原样复现。
 */
export function isInsideListOf(view: EditorView, itemType: string): boolean {
  if (isFrozen(view)) return false;
  const { doc, selection } = view.state;
  const itemPos = innermostItemAt(doc, selection.from);
  if (itemPos == null) return false;
  const item = doc.nodeAt(itemPos);
  return item?.type.name === itemType;
}

/**
 * toggle 家族「第二次按 = 退出」是否应由托孤路径接管（审计 2026-10-25 P2-2 升 P1）。
 *
 * 三条判据全过才接管：
 *  ① 选区两端（from/to）在**同一个**列表项内——跨项选区只托孤 from 那一项，
 *     B/C 原地不动（简乐真机报「选中 A/B/C 点列表按钮只退了 A」，实测产物还是
 *     `- - A` 空壳嵌套）；原生 toggleList 本来就能整块退出，交回它。
 *  ② 光标所在项类型与目标一致（listItem / taskItem）。
 *  ③ 该项所在**列表容器**与目标一致——有序/无序的项同为 listItem，只比项类型
 *     会把「有序切无序」误判成同型二次按，整项被脱出成正文（原生本可原地换标记）。
 *     taskItem 刻意**不比容器**：待办项混编在 bulletList 里是常态（见上方
 *     isInsideListOf 的注释），比了会让任务列表的二次按失去托孤保护。
 * 交回原生 ≠ 放弃 #50：单项内的二次按（含子列表托孤）仍由 demoteListItemToBlock 接管。
 */
export function shouldDemoteOnListToggle(
  view: EditorView,
  itemType: string,
  containerType: string | null,
): boolean {
  if (isFrozen(view)) return false;
  const { doc, selection } = view.state;
  const itemPos = innermostItemAt(doc, selection.from);
  if (itemPos == null) return false;
  if (doc.nodeAt(itemPos)?.type.name !== itemType) return false;
  if (innermostItemAt(doc, selection.to) !== itemPos) return false;
  if (containerType && doc.resolve(itemPos).parent.type.name !== containerType) return false;
  return true;
}

/**
 * 光标是否落在需要接管的列表项上（任意列表项：listItem / taskItem）——
 * 「该不该接管」的闸门。斜杠命令「正文 / 各类列表」用它决定要不要走托孤路径。
 *
 * 早先只接管「含子列表」的项，那是给「清除格式」划的、没有原理支撑的条件；
 * 现在「清除格式」已不动结构，本模块只服务「转普通段落」这族动词 ——
 * 有没有子列表只影响「要不要托孤」，不影响「该不该接管」。
 */
export function hasListItemToDemote(view: EditorView): boolean {
  if (isFrozen(view)) return false;
  const { doc, selection } = view.state;
  return innermostItemAt(doc, selection.from) != null;
}

/**
 * 列表项托孤式降级 —— 即「转普通段落」在列表里的那一半实现。
 *
 * 职责只有一件：把列表项换成段落，并把它直属的下级**整体减一级**（缩进语义要求，
 * 见 docs/PROPOSAL-list-semantics.md）。**装饰一律不去** —— 去装饰是「清除格式」的事，
 * 那个动词现在根本不碰结构。
 *
 * @returns 是否**接管**了这次操作。false = 不该我管（调用方照旧走 TipTap 命令）。
 */
export function demoteListItemToBlock(view: EditorView): boolean {
  if (isFrozen(view)) return false;

  const { state } = view;
  const { schema } = state;
  const from = state.selection.from;

  const itemPos = innermostItemAt(state.doc, from);
  if (itemPos == null) return false;

  const tr = state.tr;
  const blocks: Array<[number, number]> = [];

  // **只处理光标所在的那一项目，且只做一次**。
  //
  // 不做循环重扫的原因（踩过）：`demoteItemStructure` 会重写整个父列表，
  // 前后两段是**重建出来的新节点**；再扫一遍会把它们当成新的目标继续处理，
  // 于是整张表被逐层打散（`B → D/1/3/2/...` 这种鬼东西就是这么来的）。
  // 多选区跨多个列表项目前只转光标所在的第一项 —— 已知边界（PROPOSAL §6），
  // 宁可少做，不可做坏。
  const range = demoteItemStructure(tr, itemPos);
  if (range) blocks.push(range);

  // 有没有真的改动才算数：清理空壳项时不产出块，但文档确实变了，仍要落盘
  if (tr.steps.length === 0) return false;

  const paragraphType = schema.nodes.paragraph;
  for (const [start, end] of blocks) {
    const from2 = Math.max(start, 0);
    const to2 = Math.min(end, tr.doc.content.size);
    if (to2 <= from2) continue;
    if (paragraphType) tr.setBlockType(from2, to2, paragraphType);
  }

  // 光标跟到新落成的段落上（用 mapping 平移原位置，比硬猜可靠）
  const mappedFrom = tr.mapping.map(from, -1);
  const safePos = Math.min(Math.max(mappedFrom, 0), tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(safePos), 1));
  tr.setMeta('addToHistory', true);

  if (!view.hasFocus()) view.focus();
  view.dispatch(tr.scrollIntoView());
  return true;
}
