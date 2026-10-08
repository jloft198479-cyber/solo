import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { isHeavyDocument } from '../../document-scale';
import { createCompositionTracker, mapFrozenDecorations } from '../composition-freeze';

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

/** 能作为「可折叠容器」的列表节点类型（无序 / 有序 / 待办） */
const LIST_NODE_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
/** 列表项节点类型（无序项 / 待办项） */
const ITEM_NODE_TYPES = new Set(['listItem', 'taskItem']);
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

/** 项内第一个子块（段落）的正文起点——箭头挂这里，紧贴项首 */
function widgetPosOf(itemPos: number): number {
  return itemPos + 2; // itemPos+1 → 进入项内；再 +1 → 进入首个子块的正文
}

/** 该项是否含子列表（= 是否可折叠） */
function hasChildList(node: PMNode): boolean {
  let found = false;
  node.forEach((child) => {
    if (LIST_NODE_TYPES.has(child.type.name)) found = true;
  });
  return found;
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

/** 单 step 覆盖整个旧文档 = 整体替换（切文件 / 载入），折叠态对新文档无意义需清空 */
function isWholeDocReplace(tr: Transaction): boolean {
  if (tr.steps.length !== 1) return false;
  let whole = false;
  tr.steps[0].getMap().forEach((from, to) => {
    if (from === 0 && to === tr.before.content.size) whole = true;
  });
  return whole;
}

/** 插件工厂：测试可直接调用 */
export function createListFoldPlugin(): Plugin<ListFoldState> {
  const tracker = createCompositionTracker();
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
        if (isHeavyDocument()) return { folded: new Set<number>(), decorations: DecorationSet.empty };
        return { folded: new Set<number>(), decorations: buildDecorations(state.doc, new Set()) };
      },
      apply(tr, value) {
        // 大文档：不建装饰（与段落聚焦同款降级）
        if (isHeavyDocument()) {
          return value.decorations === DecorationSet.empty
            ? value
            : { folded: new Set<number>(), decorations: DecorationSet.empty };
        }

        const meta = tr.getMeta(listFoldKey) as ListFoldMeta | undefined;

        // 组字期：只平移，不重建（rebuild 也一并推迟到组字结束）
        if (tracker.isFrozen() && !meta?.toggle) {
          return {
            folded: value.folded,
            decorations: mapFrozenDecorations(value.decorations, tr),
          };
        }

        if (!tr.docChanged && !meta) return value;

        // 整体替换（切文件 / 载入）：清空折叠态重建
        if (tr.docChanged && isWholeDocReplace(tr)) {
          const folded = new Set<number>();
          return { folded, decorations: buildDecorations(tr.doc, folded) };
        }

        let folded = value.folded;
        let decorations = value.decorations;

        if (tr.docChanged) {
          folded = mapFolded(folded, tr);
          // 只平移装饰（复用 widget DOM，避免每次按键重建箭头）
          decorations = decorations.map(tr.mapping, tr.doc);
        }

        if (meta?.toggle != null) {
          const next = new Set(folded);
          if (next.has(meta.toggle)) next.delete(meta.toggle);
          else next.add(meta.toggle);
          folded = next;
          decorations = buildDecorations(tr.doc, folded);
        } else if (meta?.rebuild) {
          folded = pruneFolded(folded, tr.doc);
          decorations = buildDecorations(tr.doc, folded);
        }

        return { folded, decorations };
      },
    },
    props: {
      decorations(state) {
        return listFoldKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

export const ListFold = Extension.create({
  name: 'listFold',
  addProseMirrorPlugins() {
    return [createListFoldPlugin()];
  },
});
