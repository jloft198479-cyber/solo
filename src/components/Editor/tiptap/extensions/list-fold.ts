import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { Fragment, Node as PMNode } from '@tiptap/pm/model';
import {
  AddMarkStep,
  AttrStep,
  RemoveMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  type Step,
} from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { isHeavyDocument } from '../../document-scale';
import { createCompositionTracker, mapFrozenDecorations } from '../composition-freeze';
import { isWholeDocReplace } from '../transaction-shape';
import { ITEM_NODE_TYPES, LIST_NODE_TYPES } from '../list-move';
import { iconSvg } from '../../../icons/svg';

/**
 * 列表折叠 / 展开 —— 幕布式大纲体验的核心。
 *
 * 关键设计（决定了本功能「零保真风险」）：
 * - 折叠态**只在视图层**（插件 state 的位置集合），**绝不写进文档**。
 *   列表嵌套本就是标准 Markdown，我们只控制「显示 / 隐藏」，文件格式一字未改。
 * - 折叠箭头是装饰层 widget，隐藏子孙是装饰层 class —— 不新增节点、不改 schema。
 *
 * 铁律（照抄 paragraph-focus.ts 的成熟范式，勿违）：
 * 1. 组字期只 mapFrozenDecorations 平移，绝不重建（重建会换掉正在组字的 DOM →
 *    WebView2 IME 候选窗失锚）。
 * 2. 大文档（isHeavyDocument）直接不建装饰——与段落聚焦同款降级，避免大文档卡顿。
 * 3. widget 用 getPos() 动态取位、装饰用 map 增量平移；**只有块结构真的变了才重扫**。
 *    2026-10-19 起：触发判据从「doc 变了」收紧为「块结构变了」（`touchesBlockStructure`
 *    保守判定，见下方注释）——纯打字零全文扫描；结构变化在**当前事务内**同步重建，
 *    组字期则记账到 `pendingRebuild`，解冻后补建。widget 稳定 key 保证重建不换 DOM。
 */

export const listFoldKey = new PluginKey<ListFoldState>('listFold');

/**
 * 折叠态的跨文档记忆（进程内存，不落盘）。
 *
 * 为什么需要：折叠是「阅读姿势」而非一次性动作——读长文档折起中间几段，切走再切回来
 * 全展开了，得重折一遍。记住它 + 按需恢复，是把这个功能从「能用」拉到「顺手」的关键。
 *
 * 三条边界（有意为之，勿扩）：
 * - **不落盘**：进程退出即清空。折叠是临时视图态，写进磁盘要处理版本/清理/失效，
 *   为一个「下次打开还能记得」的锦上添花背这堆复杂度不值。
 * - **按文档路径隔离**：同一路径（含外部修改重载）恢复；不同文档互不串台。
 * - **无路径文档（未命名/新建）不记忆**：没有稳定身份，记了也恢复不到同一份内容。
 *
 * 值为「折叠项起始位置」集合——**位置会随文档结构变化漂移**，故恢复时按
 * 「位置处仍是含子列表的列表项」校验（复用 pruneFolded），失效的条目自然丢弃。
 */
const foldedByPath = new Map<string, Set<number>>();

/** 记忆文档数上限（防无界增长，见 saveFolded） */
const FOLDED_MEMORY_LIMIT = 50;

/** 供测试复位；生产代码不需要调用（Map 生命周期即进程） */
export function clearFoldedMemory(): void {
  foldedByPath.clear();
}

// 「列表容器 / 列表项」的节点类型集合由 `../list-move` 一处定义（列表折叠与列表换位
// 都要判，复制两份必然漂移——同 `transaction-shape.ts` 的提取理由）。
/**
 * 扫描时整棵跳过的子树：折叠只关心「列表项有没有子列表」，
 * 段落 / 代码 / 表格 / 公式 / 图片内部不可能再嵌套列表，跳过可省大量遍历。
 */
const SKIP_SUBTREE = new Set([
  'paragraph',
  'heading',
  'codeBlock',
  'table',
  'image',
  'mathBlock',
  'mathInline',
  'mermaidBlock',
  'frontmatter',
]);

interface ListFoldState {
  /** 被折叠的列表项起始位置集合（纯视图态，随事务 map 平移） */
  folded: Set<number>;
  decorations: DecorationSet;
  /** 当前折叠态归属的文档路径（null = 无身份文档，不参与记忆） */
  path: string | null;
  /**
   * 组字期欠下的「结构变化重建」。
   * 组字期不能重建 DOM（会换掉正在组字的节点、导致候选窗失锚），
   * 只能先记账；解冻后的第一个事务补建并清位。
   */
  pendingRebuild: boolean;
}

interface ListFoldMeta {
  /** 切换某项的折叠态（箭头点击） */
  toggle?: number;
  /** 强制重扫重建（结构变化 / 测试显式触发） */
  rebuild?: boolean;
}

/** 折叠箭头：与全站同一份图源；显示尺寸由 `.list-fold-toggle svg` 的 CSS 定为 11px */
const CHEVRON_SVG = iconSvg('chevronDown', 12);

/**
 * 箭头 widget 的稳定 key（探针实测得来，勿删）。
 *
 * 不给 key 时，`WidgetType.eq` 只能比较 toDOM —— 而重建时 toDOM 每次都是新闭包，
 * 于是恒判「不等」，**每次重建都会销毁并重建箭头 DOM**。这个箭头就落在段落文字流里、
 * 紧贴光标，等于每敲一个字就在光标旁边换一次 DOM；而重建恰好发生在组字刚结束
 * （打完中文紧接着敲标点）那一帧，是输入法/选区异常的高危动作。
 *
 * 带上 key 后 PM 判等价 → **复用同一个 DOM 节点**，重建退化成纯记账。
 * 折叠态参与 key：折叠时箭头要转 90°，必须换 DOM 才能换 class。
 */
const TOGGLE_KEY_OPEN = 'list-fold-toggle:open';
const TOGGLE_KEY_FOLDED = 'list-fold-toggle:folded';

/**
 * 项内第一个子块的正文起点——箭头挂这里，紧贴项首。
 *
 * 首块可以是段落也可以是标题（schema 首格 `block+`，台账 §二 #30），但任意块的
 * 开放 token 恒为 1，同一个 `+2` 对所有形态都成立。widget 渲染进首块**内部**开头，
 * 定位锚点即首块自身的 `position: relative`（`li p` 与 `li > :is(h1..h6)` 都有，
 * 见 editor.css）。待办项的差别只在 DOM 包装（多一层 `div`），不影响文档坐标。
 */
function widgetPosOf(itemPos: number): number {
  return itemPos + 2; // itemPos+1 → 进入项内；再 +1 → 进入首个子块的正文
}

/** 该项是否含子列表（= 是否可折叠）。下标循环以便命中即返回（`forEach` 无法提前退出）。 */
function hasChildList(node: PMNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (LIST_NODE_TYPES.has(node.child(i).type.name)) return true;
  }
  return false;
}

/** 从任意位置解析出所属列表项的起点；不在列表项内返回 null */
function itemStartAt(doc: PMNode, pos: number): number | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (ITEM_NODE_TYPES.has($pos.node(depth).type.name)) return $pos.before(depth);
  }
  return null;
}

/** 光标是否落在「该项即将被隐藏的子列表」范围内（折叠前需把光标挪出去） */
function isInsideHiddenChild(doc: PMNode, itemPos: number, selPos: number): boolean {
  const item = doc.nodeAt(itemPos);
  if (!item) return false;
  let inside = false;
  item.forEach((child, offset) => {
    if (!LIST_NODE_TYPES.has(child.type.name)) return;
    const start = itemPos + 1 + offset;
    if (selPos >= start && selPos <= start + child.nodeSize) inside = true;
  });
  return inside;
}

/** 折叠箭头 DOM：点击切换该项折叠态 */
function createToggleDOM(
  view: EditorView,
  getPos: () => number | undefined,
  folded: boolean,
): HTMLElement {
  const dom = document.createElement('span');
  dom.className = folded ? 'list-fold-toggle is-folded' : 'list-fold-toggle';
  dom.setAttribute('contenteditable', 'false');
  dom.setAttribute('aria-hidden', 'true');
  dom.innerHTML = CHEVRON_SVG;
  // 按下即阻止默认：不抢焦点、不移动光标；click 仍会正常触发
  dom.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  dom.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const domPos = getPos();
    if (domPos == null) return;
    const itemPos = itemStartAt(view.state.doc, domPos);
    if (itemPos == null) return;
    const tr = view.state.tr.setMeta(listFoldKey, { toggle: itemPos });
    // 即将折叠且光标藏在该项的子树里 → 先把光标移到项首，避免光标落进不可见区
    if (!folded && isInsideHiddenChild(view.state.doc, itemPos, view.state.selection.from)) {
      tr.setSelection(TextSelection.near(view.state.doc.resolve(itemPos + 1), 1));
    }
    view.dispatch(tr);
  });
  return dom;
}

/**
 * 收集折叠装饰：给了 range 就只扫这个窗口（结构变化的局部重建），否则扫全文档。
 *
 * 每条装饰都挂在「项」上（箭头 widget / 折叠隐藏的 class），所以窗口必须**包含完整的项**
 * ——调用方负责把窗口扩到最近的外层项（见 `computeRebuildWindow`）。
 */
function collectDecorations(
  doc: PMNode,
  folded: Set<number>,
  range?: { from: number; to: number },
): Decoration[] {
  const decorations: Decoration[] = [];
  const visit = (node: PMNode, pos: number): boolean => {
    const name = node.type.name;
    if (SKIP_SUBTREE.has(name)) return false;

    if (ITEM_NODE_TYPES.has(name) && hasChildList(node)) {
      const isFolded = folded.has(pos);
      const widgetPos = widgetPosOf(pos);
      if (widgetPos <= doc.content.size) {
        decorations.push(
          Decoration.widget(widgetPos, (view, getPos) => createToggleDOM(view, getPos, isFolded), {
            side: -1,
            key: isFolded ? TOGGLE_KEY_FOLDED : TOGGLE_KEY_OPEN,
          }),
        );
      }
      if (isFolded) {
        // 折叠：隐藏该项目的全部子列表（含其子孙）
        node.forEach((child, offset) => {
          if (!LIST_NODE_TYPES.has(child.type.name)) return;
          const start = pos + 1 + offset;
          decorations.push(
            Decoration.node(start, start + child.nodeSize, { class: 'outline-folded-hidden' }),
          );
        });
      }
    }
    return true;
  };

  if (range) {
    doc.nodesBetween(range.from, range.to, visit);
    // `nodesBetween` 会把**祖先项**也访问进来（窗口起点在项内部时）；
    // 只保留装饰范围完整落在窗口内的，避免把窗口外的旧箭头又加一遍（重复箭头）。
    return decorations.filter((d) => d.from >= range.from && d.to <= range.to);
  }
  doc.descendants(visit); // perf-allow: 全量分支——仅 init/整文档替换/窗口无法界定的兜底（打字/结构操作走上方 range 分支）
  return decorations;
}

/** 全量构建折叠装饰（init / 整文档替换 / 折叠态变化 / 窗口无法界定时的兜底） */
function buildDecorations(doc: PMNode, folded: Set<number>): DecorationSet {

  return DecorationSet.create(doc, collectDecorations(doc, folded));
}

/**
 * 局部重建：只重算 `[from, to]` 窗口内的装饰，窗口外的装饰原样保留
 * （保留 = 不重新创建，widget 的稳定 key 与 DOM 都不动）。
 *
 * 调用方必须保证窗口覆盖所有受影响项的**完整范围**（含直接父项与新兄弟项），
 * 否则会漏箭头；窗口算不准时一律退回 `buildDecorations` 全量重建。
 */
export function rebuildDecorationsInRange(
  doc: PMNode,
  folded: Set<number>,
  base: DecorationSet,
  from: number,
  to: number,
): DecorationSet {
  if (to <= from) return base;
  const stale = base.find(from, to).filter((d) => d.from <= to && d.to >= from);
  let next = stale.length > 0 ? base.remove(stale) : base;
  const added = collectDecorations(doc, folded, { from, to });
  if (added.length > 0) next = next.add(doc, added);
  return next;
}

/** 折叠位置随事务平移；被删除的条目丢弃 */
function mapFolded(folded: Set<number>, tr: Transaction): Set<number> {
  if (folded.size === 0) return folded;
  const next = new Set<number>();
  folded.forEach((pos) => {
    const mapped = tr.mapping.mapResult(pos);
    if (!mapped.deleted) next.add(mapped.pos);
  });
  return next;
}

/** 剔除已失效的折叠位置（节点已不是「含子列表的列表项」） */
function pruneFolded(folded: Set<number>, doc: PMNode): Set<number> {
  const next = new Set<number>();
  folded.forEach((pos) => {
    const node = doc.nodeAt(pos);
    if (node && ITEM_NODE_TYPES.has(node.type.name) && hasChildList(node)) next.add(pos);
  });
  return next;
}

/**
 * 光标若落在某个已折叠项的隐藏子树内，就把该项从折叠态移除（返回新集合）。
 *
 * 触发场景：方向键下移、大纲面板跳转、查找命中——它们都不知道那一段已被
 * `display: none`，不拦就会出现「光标在哪看不见」。折叠态是纯视图态，这里展开
 * 不回写文档，代价只是那次跳转顺带展开一层。
 *
 * 未命中时原样返回**同一引用**，调用方据此跳过重建。
 */
function revealFoldedAtCursor(folded: Set<number>, doc: PMNode, selPos: number): Set<number> {
  if (folded.size === 0) return folded;
  let next: Set<number> | null = null;
  folded.forEach((pos) => {
    if (!isInsideHiddenChild(doc, pos, selPos)) return;
    if (!next) next = new Set(folded);
    next.delete(pos);
  });
  return next ?? folded;
}

/** 空集合视为「没有折叠」，从记忆里删掉，避免 Map 无限堆积无意义条目 */
function saveFolded(path: string | null, folded: Set<number>): void {
  if (!path) return;
  if (folded.size === 0) {
    foldedByPath.delete(path);
    return;
  }
  // 有上限：键是文档路径，长时间运行下会随「开过的文档数」单调累积。
  // 超限按插入序淘汰最旧的一条（Map 保持插入序）——折叠态是纯阅读姿势，
  // 丢最旧的记忆最多让老文档回来时全展开，无副作用（M-26）。
  if (!foldedByPath.has(path) && foldedByPath.size >= FOLDED_MEMORY_LIMIT) {
    const oldest = foldedByPath.keys().next().value;
    if (oldest !== undefined) foldedByPath.delete(oldest);
  }
  foldedByPath.set(path, new Set(folded));
}

/**
 * 取出某路径的记忆折叠态 —— 但记忆里的「位置」是上次那份文档的坐标，
 * 而文档可能已被外部修改。故恢复时逐条校验：位置处**仍**是含子列表的列表项
 * 才保留（复用 pruneFolded 的判据）。校验不过的静默丢弃，绝不硬套漂移位置
 * （硬套会折叠错误的项，比不折叠更糟）。
 */
function restoreFolded(path: string | null, doc: PMNode): Set<number> {
  if (!path) return new Set<number>();
  const remembered = foldedByPath.get(path);
  if (!remembered || remembered.size === 0) return new Set<number>();
  return pruneFolded(remembered, doc);
}

/** Fragment 是否只含行内节点（文字 / 行内图片 / 硬换行等）。出现块节点即视为结构变化 */
function isInlineOnly(fragment: Fragment): boolean {
  let inline = true;
  fragment.forEach((node) => {
    if (!node.isInline) inline = false;
  });
  return inline;
}

/**
 * 单个 step 是否「确认安全」（不会改变块结构）：
 * - `ReplaceStep` 且插入内容全是 inline、被删内容也全是 inline（打字 / 删字）；
 * - `AddMarkStep` / `RemoveMarkStep`（加粗、链接等）；
 * - `AttrStep`（节点属性，如任务勾选）。
 *
 * 其余（`ReplaceAroundStep` 切项 / 缩进 / 包裹、含块节点的替换、未知 step）一律不安全。
 * `docBefore` 是该 step **之前**的文档（`tr.docs[i]`），用来检查被删区间的内容。
 */
function stepIsSafe(step: Step, docBefore: PMNode): boolean {
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep || step instanceof AttrStep) {
    return true;
  }
  if (!(step instanceof ReplaceStep)) return false;
  if (!isInlineOnly(step.slice.content)) return false;
  return !(step.from < step.to && !isInlineOnly(docBefore.slice(step.from, step.to).content));
}

/**
 * 这次事务有没有动「块结构」——**保守判定，只放行确认安全的 step**。
 *
 * 折叠箭头只依赖一个结构事实：某个列表项有没有子列表。纯文字编辑（打字 / 删字 /
 * 行内粘贴）不会改变它，只需要 `decorations.map` 平移；切项、缩进、包裹、粘贴块、
 * 删除块则会。
 *
 * 为什么不反过来「找插入内容里的列表节点」：漏掉任何一种形态（或上游将来新增
 * step 类型）都会留下**坏箭头**——静默、难测。反过来只放行确认安全的，未知情况
 * 一律重扫：最坏是多扫一次（有界），不会漏判。
 */
function touchesBlockStructure(tr: Transaction): boolean {
  for (let i = 0; i < tr.steps.length; i++) {
    if (!stepIsSafe(tr.steps[i], tr.docs[i])) return true;
  }
  return false;
}

/**
 * 位置 `pos` 处的「项覆盖范围」。
 *
 * - 落在某个项内部：取**最内层**那个项（改动动的是它）；
 * - 落在项与项之间（split 会把新项插在边界旁 / 整项被删后落在邻项旁）：取前后相邻项；
 * - 列表嵌在项里时，再把**父项**一并纳入 —— 缩进 / 反缩进 / 删除子项都会让父项的
 *   「有没有子列表」变化，箭头要跟着增删。父项只在**边界态**扩展：改动落在子项内部时
 *   父项的子列表必然还在，不需要它（2026-10-19 用 11 个定点形状 + 211 步种子化随机按键
 *   验证过：去掉内部态的父项扩展不影响任何一条；留着只会白白把窗口放大到父项整棵子树）。
 *
 * 返回 null = 位置落在顶层块之间（如整段列表被替换），调用方退回全量重建。
 */
function itemCoverRange(doc: PMNode, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));

  // ① 在某个项内：最内层的那个项
  for (let d = $pos.depth; d > 0; d--) {
    if (!ITEM_NODE_TYPES.has($pos.node(d).type.name)) continue;
    const from = $pos.before(d);
    return { from, to: from + $pos.node(d).nodeSize };
  }

  // ② 边界态：前后相邻项都算
  let out: { from: number; to: number } | null = null;
  const prev = $pos.nodeBefore;
  const next = $pos.nodeAfter;
  if (prev && ITEM_NODE_TYPES.has(prev.type.name)) {
    out = { from: $pos.pos - prev.nodeSize, to: $pos.pos };
  }
  if (next && ITEM_NODE_TYPES.has(next.type.name)) {
    const to = $pos.pos + next.nodeSize;
    out = out
      ? { from: Math.min(out.from, $pos.pos), to: Math.max(out.to, to) }
      : { from: $pos.pos, to };
  }
  if (!out) return null;

  // 相邻项的父项（列表若嵌在某个项里）
  const pd = $pos.depth - 1;
  if (pd >= 1 && ITEM_NODE_TYPES.has($pos.node(pd).type.name)) {
    const pFrom = $pos.before(pd);
    out.from = Math.min(out.from, pFrom);
    out.to = Math.max(out.to, pFrom + $pos.node(pd).nodeSize);
  }
  return out;
}

/**
 * 结构变化的受影响窗口（**新文档坐标**）：扩到最近的外层项，
 * 覆盖「被改到的项 + 直接父项（可能失去/获得子列表）+ 新建的兄弟项」。
 *
 * 任何一步算不出安全边界（例如变化落在顶层块之间、或整段列表被整体替换）→ 返回 null，
 * 调用方退回全量重建。宁可多扫，不可漏箭头。
 */
function computeRebuildWindow(tr: Transaction): { from: number; to: number } | null {
  let from = Number.POSITIVE_INFINITY;
  let to = -1;
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    if (stepIsSafe(step, tr.docs[i])) continue;
    // 只有这两种 step 有 from/to；其它未知 step 无法算窗口 → 全量兜底
    if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) return null;
    // 用「从第 i 步到末尾」的映射把旧坐标换算到最终文档（多步事务也成立）
    const slice = tr.mapping.slice(i);
    const a = slice.mapResult(step.from, -1).pos;
    const b = slice.mapResult(step.to, 1).pos;
    if (a < from) from = a;
    if (b > to) to = b;
  }
  if (!Number.isFinite(from) || to < 0) return null;
  // 端点常落在「列表容器的开/闭 token」上（例：文档**以列表开头**时的缩进，step 的
  // from 恰好是位置 0）——那里前后都是容器而不是项，`itemCoverRange` 只能返回 null。
  // 向内挪一格即可落进相邻项的正文区，窗口照旧扩到整个项；挪了还不行才判「界定不了」。
  const head = itemCoverRange(tr.doc, from) ?? itemCoverRange(tr.doc, from + 1);
  const tail = itemCoverRange(tr.doc, to) ?? itemCoverRange(tr.doc, to - 1);
  if (!head || !tail) return null;
  const start = Math.min(head.from, tail.from);
  const end = Math.max(head.to, tail.to);
  return end > start ? { from: start, to: end } : null;
}

/** 插件工厂：测试可直接调用。`getPath` 返回当前文档路径（null = 无身份文档，不记忆） */
export function createListFoldPlugin(getPath: () => string | null = () => null): Plugin<ListFoldState> {
  const tracker = createCompositionTracker();

  /** 空态（大文档降级 / 无折叠项共用），path 一并带上以免记忆归属丢失 */
  const emptyState = (path: string | null): ListFoldState => ({
    folded: new Set<number>(),
    decorations: DecorationSet.empty,
    path,
    pendingRebuild: false,
  });

  return new Plugin<ListFoldState>({
    key: listFoldKey,
    view(editorView) {
      // 只做组字信号登记；重建由 apply 内的结构判定同步完成（不再走 rAF 事务）
      const untrack = tracker.track(editorView);
      return {
        destroy() {
          untrack();
        },
      };
    },
    state: {
      init(_config, state) {
        const path = getPath();
        if (isHeavyDocument()) return emptyState(path);
        // 首次载入：若路径已有记忆则恢复（编辑器实例可能晚于文档切换创建）
        const restored = restoreFolded(path, state.doc);
        return {
          folded: restored,
          decorations: buildDecorations(state.doc, restored),
          path,
          pendingRebuild: false,
        };
      },
      apply(tr, value) {
        // 大文档：不建装饰（与段落聚焦同款降级）
        if (isHeavyDocument()) {
          return value.decorations === DecorationSet.empty &&
            value.folded.size === 0 &&
            !value.pendingRebuild
            ? value
            : emptyState(value.path);
        }

        const meta = tr.getMeta(listFoldKey) as ListFoldMeta | undefined;

        // 组字期：只平移、不重建（重建会换掉正在组字的 DOM → 候选窗失锚）。
        // 结构变化先记账，解冻后的第一个事务补建（见下方 pendingRebuild）。
        if (tracker.isFrozen() && !meta?.toggle) {
          return {
            folded: value.folded,
            decorations: mapFrozenDecorations(value.decorations, tr),
            path: value.path,
            pendingRebuild:
              value.pendingRebuild ||
              meta?.rebuild === true ||
              (tr.docChanged && touchesBlockStructure(tr)),
          };
        }

        let folded = value.folded;
        let decorations = value.decorations;
        let pendingRebuild = value.pendingRebuild;
        /** 本次结构变化的局部重建窗口；null = 全量重建（兜底） */
        let rebuildWindow: { from: number; to: number } | null = null;

        if (tr.docChanged) {
          // 整体替换（切文件 / 载入）：旧折叠态位置对新文档无意义。
          // 但「切走再切回」要能恢复 ⇒ 事务里读不到旧路径（store 已更新），
          // 故与 state 里记的 path 比对：换了文档就先存旧、再取新。
          if (isWholeDocReplace(tr)) {
            const nextPath = getPath();
            if (nextPath !== value.path) {
              saveFolded(value.path, value.folded);
              const restored = restoreFolded(nextPath, tr.doc);
              return {
                folded: restored,
                decorations: buildDecorations(tr.doc, restored),
                path: nextPath,
                pendingRebuild: false,
              };
            }
            // 同路径整体替换（外部修改重载 / 另存为落盘）：位置大概率已漂移，
            // 清空重来，不拿旧位置硬套新内容。
            return {
              folded: new Set<number>(),
              decorations: buildDecorations(tr.doc, new Set()),
              path: value.path,
              pendingRebuild: false,
            };
          }
          folded = mapFolded(folded, tr);
          // 纯文字编辑只平移装饰（widget 复用 DOM，不重建）；块结构变了才记账重扫。
          // 判据是**保守黑名单**：只有确认安全的 step 才跳过，未知一律重扫（见函数注释）。
          decorations = decorations.map(tr.mapping, tr.doc);
          if (touchesBlockStructure(tr)) {
            pendingRebuild = true;
            // 只有「本次事务独立产生的结构变化」才能算窗口；若之前组字期还欠着一次
            // 重建（value.pendingRebuild），旧坐标已不可信 ⇒ 退回全量。
            if (!value.pendingRebuild) rebuildWindow = computeRebuildWindow(tr);
          }
        }

        // 需要按最新结构重扫的情形：点击折叠、显式 rebuild、块结构变化、
        // 解冻后补建、光标落进隐藏子树
        let rebuild = pendingRebuild;

        if (meta?.toggle != null) {
          const next = new Set(folded);
          if (next.has(meta.toggle)) next.delete(meta.toggle);
          else next.add(meta.toggle);
          folded = next;
          rebuild = true;
          rebuildWindow = null;
        } else if (meta?.rebuild) {
          rebuild = true;
          rebuildWindow = null;
        }

        const revealed = revealFoldedAtCursor(folded, tr.doc, tr.selection.from);
        if (revealed !== folded) {
          folded = revealed;
          rebuild = true;
          rebuildWindow = null;
        }

        if (rebuild) {
          // 结构变化可能让某个折叠项失去子列表 ⇒ 顺手剪掉失效的折叠位置
          // （纯文字编辑进不到这里；剪枝只随结构变化发生）。
          folded = pruneFolded(folded, tr.doc);
          // 折叠态即用户当下的「阅读姿势」——每次变更顺手同步进记忆，
          // 保证切文件那一刻取到的是最新的一份（无需在切换时另存）。
          saveFolded(value.path, folded);
          return {
            folded,
            decorations: rebuildWindow
              ? rebuildDecorationsInRange(
                  tr.doc,
                  folded,
                  decorations,
                  rebuildWindow.from,
                  rebuildWindow.to,
                )
              : buildDecorations(tr.doc, folded),
            path: value.path,
            pendingRebuild: false,
          };
        }
        // 无事发生（绝大多数纯光标移动 / 纯打字走这条）→ 原样返回，保持 state 引用不变
        return folded === value.folded && decorations === value.decorations
          ? value
          : { folded, decorations, path: value.path, pendingRebuild: false };
      },
    },
    props: {
      decorations(state) {
        return listFoldKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

export const ListFold = Extension.create<{ getPath: () => string | null }>({
  name: 'listFold',
  addOptions() {
    return { getPath: () => null };
  },
  addProseMirrorPlugins() {
    return [createListFoldPlugin(this.options.getPath)];
  },
});
