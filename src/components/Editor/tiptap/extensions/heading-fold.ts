import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { isHeavyDocument } from '../../document-scale';
import { createCompositionTracker, mapFrozenDecorations } from '../composition-freeze';
import { isWholeDocReplace } from '../transaction-shape';

/**
 * 标题折叠 / 展开 —— 对标 Obsidian「Fold heading」。
 *
 * 折叠语义：折叠某个标题 = 隐藏它**之后**的顶层块，直到下一个**同级或更高级**
 * 标题（或文档结尾）；更低的子标题连同内容一起藏。与列表折叠（list-fold.ts）
 * 同一套铁律，全部照抄其成熟范式，勿违：
 *
 * - 折叠态**只在视图层**（插件 state 的位置集合），**绝不写进文档**。
 *   折叠只是「显示 / 隐藏」，文件格式一字未改，零保真风险。
 * - 组字期只 mapFrozenDecorations 平移，绝不重建（重建会换掉正在组字的 DOM →
 *   WebView2 IME 候选窗失锚）。
 * - 大文档（isHeavyDocument）直接不建装饰——与段落聚焦 / 列表折叠同款降级。
 * - widget 用稳定 key（否则每次重建都换 DOM，箭头紧贴光标是 IME 高危动作，
 *   见 list-fold.ts 的 TOGGLE_KEY 注释）。
 *
 * 与列表折叠的有意差异：
 * - 只支持 **doc 顶层** 的标题（容器内的标题折叠语义复杂，Obsidian 同样不做）；
 * - 隐藏的是「连续顶层块区间」，装饰逐块挂（node 装饰必须精确对齐单节点边界）；
 * - 扫描只走顶层（doc.forEach），比 descendants 便宜一个量级。
 */

export const headingFoldKey = new PluginKey<HeadingFoldState>('headingFold');

/**
 * 折叠态的跨文档记忆（进程内存，不落盘）——与 list-fold.ts 的 foldedByPath
 * 同款设计（值语义不同：这里记的是**标题**起始位置）。三条边界一致：
 * 不落盘 / 按文档路径隔离 / 无路径文档不记忆。恢复时按「位置处仍是可折叠标题」
 * 校验（见 pruneFolded），失效条目自然丢弃。
 */
const foldedByPath = new Map<string, Set<number>>();

/** 记忆文档数上限（防无界增长，同 list-fold.ts） */
const FOLDED_MEMORY_LIMIT = 50;

/** 供测试复位；生产代码不需要调用（Map 生命周期即进程） */
export function clearHeadingFoldedMemory(): void {
  foldedByPath.clear();
}

interface HeadingFoldState {
  /** 被折叠的标题起始位置集合（纯视图态，随事务 map 平移） */
  folded: Set<number>;
  decorations: DecorationSet;
  /** 当前折叠态归属的文档路径（null = 无身份文档，不参与记忆） */
  path: string | null;
}

interface HeadingFoldMeta {
  /** 切换某标题的折叠态（箭头点击） */
  toggle?: number;
  /** 强制重扫重建（rAF 合并触发 / 结构变化后） */
  rebuild?: boolean;
}

const CHEVRON_SVG =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.6 4.4L6 7.8l3.4-3.4"/></svg>';

/**
 * 箭头 widget 的稳定 key（理由同 list-fold.ts 的 TOGGLE_KEY，勿删）。
 * 折叠态参与 key：折叠时箭头要转向，必须换 DOM 才能换 class。
 */
const TOGGLE_KEY_OPEN = 'heading-fold-toggle:open';
const TOGGLE_KEY_FOLDED = 'heading-fold-toggle:folded';

interface BlockRef {
  pos: number;
  node: PMNode;
}

/** 顶层块清单（heading 折叠只在顶层做，一次 forEach 够用） */
function topLevelBlocks(doc: PMNode): BlockRef[] {
  const blocks: BlockRef[] = [];
  doc.forEach((node, offset) => blocks.push({ pos: offset, node }));
  return blocks;
}

function isHeading(node: PMNode): boolean {
  return node.type.name === 'heading';
}

function headingLevel(node: PMNode): number {
  return node.attrs.level as number;
}

/**
 * 某标题的可折叠区间：`(pos + nodeSize, stop)`。
 * stop = 下一个「同级或更高级标题」的位置；没有则到文档尾。
 * 区间为空（stop <= 标题末尾，即后面没有内容）⇒ 返回 null，不可折叠。
 */
function foldRange(doc: PMNode, headingPos: number): { end: number; stop: number } | null {
  const heading = doc.nodeAt(headingPos);
  if (!heading || !isHeading(heading)) return null;
  const level = headingLevel(heading);
  const end = headingPos + heading.nodeSize;
  let stop = doc.content.size;
  const blocks = topLevelBlocks(doc);
  const index = blocks.findIndex((b) => b.pos === headingPos);
  if (index < 0) return null; // 非顶层（容器内标题不支持折叠）
  for (let j = index + 1; j < blocks.length; j++) {
    const b = blocks[j];
    if (isHeading(b.node) && headingLevel(b.node) <= level) {
      stop = b.pos;
      break;
    }
  }
  return stop > end ? { end, stop } : null;
}

/** 折叠区间内的顶层块（逐块挂隐藏装饰用；node 装饰必须对齐单节点边界） */
function blocksIn(doc: PMNode, range: { end: number; stop: number }): BlockRef[] {
  return topLevelBlocks(doc).filter((b) => b.pos >= range.end && b.pos + b.node.nodeSize <= range.stop);
}

/** 从任意位置解析出所属顶层标题的起点；不在标题内返回 null */
function headingStartAt(doc: PMNode, pos: number): number | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  if ($pos.depth === 1 && isHeading($pos.node(1))) return $pos.before(1);
  return null;
}

/** 光标是否落在「该标题即将被隐藏的区间」内（折叠前需把光标挪出去） */
function isInsideFoldRange(doc: PMNode, headingPos: number, selPos: number): boolean {
  const range = foldRange(doc, headingPos);
  if (!range) return false;
  return selPos >= range.end && selPos <= range.stop;
}

/** 折叠箭头 DOM：点击切换该标题折叠态（同 list-fold.ts 的 createToggleDOM） */
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
    const headingPos = headingStartAt(view.state.doc, domPos);
    if (headingPos == null) return;
    const tr = view.state.tr.setMeta(headingFoldKey, { toggle: headingPos });
    // 即将折叠且光标藏在该标题的隐藏区间里 → 先把光标挪进标题内，避免落进不可见区
    if (!folded && isInsideFoldRange(view.state.doc, headingPos, view.state.selection.from)) {
      const heading = view.state.doc.nodeAt(headingPos)!;
      tr.setSelection(TextSelection.near(view.state.doc.resolve(headingPos + heading.nodeSize - 1), -1));
    }
    view.dispatch(tr);
  });
  return dom;
}

/** 全量构建折叠装饰（init / 整文档替换 / 折叠态变化 / rAF 重建时用） */
function buildDecorations(doc: PMNode, folded: Set<number>): DecorationSet {
  const decorations: Decoration[] = [];
  // 嵌套折叠去重：H1 折叠已藏了 H2 的内容块，H2 再折叠时同一块不能重复挂装饰
  const hiddenSeen = new Set<number>();
  const blocks = topLevelBlocks(doc);
  for (let i = 0; i < blocks.length; i++) {
    const { pos, node } = blocks[i];
    if (!isHeading(node)) continue;
    const range = foldRange(doc, pos);
    if (!range) continue;
    const isFolded = folded.has(pos);
    decorations.push(
      Decoration.widget(
        pos + 1,
        (view, getPos) => createToggleDOM(view, getPos, isFolded),
        { side: -1, key: isFolded ? TOGGLE_KEY_FOLDED : TOGGLE_KEY_OPEN },
      ),
    );
    if (isFolded) {
      // 折叠：隐藏标题之后的全部顶层块（直到下一个同级/更高级标题或文档尾）
      for (const b of blocksIn(doc, range)) {
        if (hiddenSeen.has(b.pos)) continue;
        hiddenSeen.add(b.pos);
        decorations.push(
          Decoration.node(b.pos, b.pos + b.node.nodeSize, { class: 'outline-folded-hidden' }),
        );
      }
    }
  }
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

/** 剔除已失效的折叠位置（节点已不是「可折叠的顶层标题」） */
function pruneFolded(folded: Set<number>, doc: PMNode): Set<number> {
  const next = new Set<number>();
  folded.forEach((pos) => {
    if (foldRange(doc, pos)) next.add(pos);
  });
  return next;
}

/**
 * 光标若落在某个已折叠标题的隐藏区间内，就把该标题从折叠态移除（返回新集合）。
 *
 * 触发场景：方向键下移、大纲面板跳转、查找命中——它们都不知道那一段已被
 * `display: none`。折叠态是纯视图态，这里展开不回写文档。
 * 未命中时原样返回**同一引用**，调用方据此跳过重建。
 */
function revealFoldedAtCursor(folded: Set<number>, doc: PMNode, selPos: number): Set<number> {
  if (folded.size === 0) return folded;
  let next: Set<number> | null = null;
  folded.forEach((pos) => {
    if (!isInsideFoldRange(doc, pos, selPos)) return;
    if (!next) next = new Set(folded);
    next.delete(pos);
  });
  return next ?? folded;
}

/** 空集合视为「没有折叠」，从记忆里删掉（同 list-fold.ts 的 saveFolded） */
function saveFolded(path: string | null, folded: Set<number>): void {
  if (!path) return;
  if (folded.size === 0) {
    foldedByPath.delete(path);
    return;
  }
  if (!foldedByPath.has(path) && foldedByPath.size >= FOLDED_MEMORY_LIMIT) {
    const oldest = foldedByPath.keys().next().value;
    if (oldest !== undefined) foldedByPath.delete(oldest);
  }
  foldedByPath.set(path, new Set(folded));
}

/**
 * 取出某路径的记忆折叠态——记忆里的「位置」是上次那份文档的坐标，文档可能已被
 * 外部修改，恢复时逐条校验（pruneFolded）：仍是可折叠标题才保留。
 */
function restoreFolded(path: string | null, doc: PMNode): Set<number> {
  if (!path) return new Set<number>();
  const remembered = foldedByPath.get(path);
  if (!remembered || remembered.size === 0) return new Set<number>();
  return pruneFolded(remembered, doc);
}

/** 插件工厂：测试可直接调用。`getPath` 返回当前文档路径（null = 无身份文档，不记忆） */
export function createHeadingFoldPlugin(
  getPath: () => string | null = () => null,
): Plugin<HeadingFoldState> {
  const tracker = createCompositionTracker();

  const emptyState = (path: string | null): HeadingFoldState => ({
    folded: new Set<number>(),
    decorations: DecorationSet.empty,
    path,
  });

  return new Plugin<HeadingFoldState>({
    key: headingFoldKey,
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
          editorView.dispatch(editorView.state.tr.setMeta(headingFoldKey, { rebuild: true }));
        });
      };
      return {
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
        const restored = restoreFolded(path, state.doc);
        return { folded: restored, decorations: buildDecorations(state.doc, restored), path };
      },
      apply(tr, value) {
        // 大文档：不建装饰（与段落聚焦 / 列表折叠同款降级）
        if (isHeavyDocument()) {
          return value.decorations === DecorationSet.empty && value.folded.size === 0
            ? value
            : emptyState(value.path);
        }

        const meta = tr.getMeta(headingFoldKey) as HeadingFoldMeta | undefined;

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
          // 「切走再切回」要能恢复 ⇒ 与 state 里记的 path 比对：换了文档就先存旧、再取新。
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
            // 同路径整体替换（外部修改重载 / 另存为落盘）：清空重来，不硬套旧位置。
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

        // 需要按最新结构重扫的情形：点击折叠、rAF 合并重建、光标落进隐藏区间
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
          // 折叠态即用户当下的「阅读姿势」——每次变更顺手同步进记忆
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
        return headingFoldKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

export const HeadingFold = Extension.create<{ getPath: () => string | null }>({
  name: 'headingFold',
  addOptions() {
    return { getPath: () => null };
  },
  addProseMirrorPlugins() {
    return [createHeadingFoldPlugin(this.options.getPath)];
  },
});
