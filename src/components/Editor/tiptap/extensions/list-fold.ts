import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { isHeavyDocument } from '../../document-scale';
import { createCompositionTracker, mapFrozenDecorations } from '../composition-freeze';
import { isWholeDocReplace } from '../transaction-shape';
import { ITEM_NODE_TYPES, LIST_NODE_TYPES } from '../list-move';

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
 * 3. widget 用 getPos() 动态取位、装饰用 map 增量平移——不每次按键重建全部箭头，
 *    把「重建」交给 rAF 合并触发（避免 DOM 抖动，见 view().update）。
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
}

interface ListFoldMeta {
  /** 切换某项的折叠态（箭头点击） */
  toggle?: number;
  /** 强制重扫重建（rAF 合并触发 / 结构变化后） */
  rebuild?: boolean;
}

const CHEVRON_SVG =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.6 4.4L6 7.8l3.4-3.4"/></svg>';

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
 * 项内第一个子块（段落）的正文起点——箭头挂这里，紧贴项首。
 *
 * `listItem` 与 `taskItem` 的内容都**以段落开头**（`paragraph block*`），所以同一个
 * `+2` 对两种项都成立。两者的差别只在 DOM 包装（待办项多一层 `div`，见 editor.css
 * 里 `li p` 锚点为何必须用后代选择器），不影响文档坐标。
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

/** 全量构建折叠装饰（init / 整文档替换 / 折叠态变化 / rAF 重建时用） */
function buildDecorations(doc: PMNode, folded: Set<number>): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
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
  });
  return DecorationSet.create(doc, decorations);
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

/** 插件工厂：测试可直接调用。`getPath` 返回当前文档路径（null = 无身份文档，不记忆） */
export function createListFoldPlugin(getPath: () => string | null = () => null): Plugin<ListFoldState> {
  const tracker = createCompositionTracker();

  /** 空态（大文档降级 / 无折叠项共用），path 一并带上以免记忆归属丢失 */
  const emptyState = (path: string | null): ListFoldState => ({
    folded: new Set<number>(),
    decorations: DecorationSet.empty,
    path,
  });

  return new Plugin<ListFoldState>({
    key: listFoldKey,
    view(editorView) {
      const untrack = tracker.track(editorView);
      let rafId: number | null = null;
      const scheduleRebuild = () => {
        if (rafId != null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (editorView.isDestroyed) return;
          // 组字期不重建（会把正在组字的 DOM 换掉）——继续等，组字结束后重建
          if (editorView.composing) {
            scheduleRebuild();
            return;
          }
          editorView.dispatch(editorView.state.tr.setMeta(listFoldKey, { rebuild: true }));
        });
      };
      return {
        // 文档变化后合并到下一帧重建一次（期间装饰走 map 平移、不抖动）；
        // 大文档不建装饰，也无需排重建任务
        update(view, prevState) {
          if (!isHeavyDocument() && view.state.doc !== prevState.doc) scheduleRebuild();
        },
        destroy() {
          if (rafId != null) cancelAnimationFrame(rafId);
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
        return { folded: restored, decorations: buildDecorations(state.doc, restored), path };
      },
      apply(tr, value) {
        // 大文档：不建装饰（与段落聚焦同款降级）
        if (isHeavyDocument()) {
          return value.decorations === DecorationSet.empty && value.folded.size === 0
            ? value
            : emptyState(value.path);
        }

        const meta = tr.getMeta(listFoldKey) as ListFoldMeta | undefined;

        // 组字期：只平移，不重建（rebuild 也一并推迟到组字结束）
        if (tracker.isFrozen() && !meta?.toggle) {
          return {
            folded: value.folded,
            decorations: mapFrozenDecorations(value.decorations, tr),
            path: value.path,
          };
        }

        let folded = value.folded;
        let decorations = value.decorations;

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
              };
            }
            // 同路径整体替换（外部修改重载 / 另存为落盘）：位置大概率已漂移，
            // 清空重来，不拿旧位置硬套新内容。
            return {
              folded: new Set<number>(),
              decorations: buildDecorations(tr.doc, new Set()),
              path: value.path,
            };
          }
          folded = mapFolded(folded, tr);
          // 只平移装饰（复用 widget DOM，避免每次按键重建箭头）
          decorations = decorations.map(tr.mapping, tr.doc);
        }

        // 需要按最新结构重扫的情形：点击折叠、rAF 合并重建、光标落进隐藏子树
        let rebuild = false;

        if (meta?.toggle != null) {
          const next = new Set(folded);
          if (next.has(meta.toggle)) next.delete(meta.toggle);
          else next.add(meta.toggle);
          folded = next;
          rebuild = true;
        } else if (meta?.rebuild) {
          folded = pruneFolded(folded, tr.doc);
          rebuild = true;
        }

        const revealed = revealFoldedAtCursor(folded, tr.doc, tr.selection.from);
        if (revealed !== folded) {
          folded = revealed;
          rebuild = true;
        }

        if (rebuild) {
          // 折叠态即用户当下的「阅读姿势」——每次变更顺手同步进记忆，
          // 保证切文件那一刻取到的是最新的一份（无需在切换时另存）。
          saveFolded(value.path, folded);
          return { folded, decorations: buildDecorations(tr.doc, folded), path: value.path };
        }
        // 无事发生（绝大多数纯光标移动走这条）→ 原样返回，保持 state 引用不变
        return folded === value.folded && decorations === value.decorations
          ? value
          : { folded, decorations, path: value.path };
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
