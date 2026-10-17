import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { isHeavyDocument } from '../../document-scale';
import { createCompositionTracker, mapFrozenDecorations } from '../composition-freeze';
import { isWholeDocReplace } from '../transaction-shape';

export const paragraphFocusKey = new PluginKey<ParagraphFocusState>('paragraphFocus');

type ParagraphFocusState = {
  /** 全量块装饰集（每块一条 active/dimmed），随事务增量维护（P4-03） */
  decorations: DecorationSet;
  /** 当前聚焦块（光标所在的最小块）起点 */
  activeBlock: number;
};

function isFocusModeActive(): boolean {
  return document.documentElement.classList.contains('focus-mode');
}

/**
 * 光标所在**最小块**起点（等价 Typora 的 `md-end-block`：不能再包含子块的最内层块）。
 *
 * 改前取顶层块（`$head.before(1)`）⇒ 整个列表/引用块/callout 同亮，列表里无法只突出
 * 当前那一行。现在取最内层 textblock ⇒ 列表的每一项、引用与 callout 内的每一段各自
 * 独立聚焦（Typora 官方 support 页对 Focus Mode 的描述即此粒度）。
 *
 * 只影响装饰落点：不进 doc、不进 schema、不进序列化，DOM 结构一个字节不动。
 * 无有效光标（空 doc / 顶层 selection）返回 -1。
 */
function activeBlockOf(state: EditorState | Transaction): number {
  const $head = state.selection.$head;
  if (!$head || $head.depth < 1) return -1;
  // 常态：光标落在 textblock 的内容里
  for (let depth = $head.depth; depth >= 1; depth--) {
    if ($head.node(depth).isTextblock) return $head.before(depth);
  }
  // 边界态：光标停在容器内、某个块**之前**（实测 `- [ ] A` 的第二项，
  // pos 落在 taskItem 内而 paragraph 尚未开始，resolve 的 parent 是 taskItem）
  // ⇒ 向后取最近的 textblock，找不到再向前取。
  if ($head.nodeAfter?.isTextblock) return $head.pos;
  const before = $head.nodeBefore;
  if (before?.isTextblock) return $head.pos - before.nodeSize;
  return -1;
}

/**
 * 递归收集**叶块**装饰：只给 `isTextblock`（段落 / 标题 / 代码块）打标记，容器本身不打。
 * `base` 传该节点**内容起点**的绝对位置（doc 为 0，其他节点为自身起点 + 1）。
 */
function collectLeafDecorations(
  node: PMNode,
  base: number,
  activeBlock: number,
  out: Decoration[],
): void {
  node.forEach((child, offset) => {
    const from = base + offset;
    if (child.isTextblock) {
      out.push(
        Decoration.node(from, from + child.nodeSize, {
          class: from === activeBlock ? 'paragraph-active' : 'paragraph-dimmed',
        }),
      );
    } else if (child.isBlock) {
      collectLeafDecorations(child, from + 1, activeBlock, out);
    }
  });
}

/** 全量构建：为每个叶块建一条 active/dimmed 装饰（init / 整体替换 / 强制重建时用） */
function buildAllBlockDecorations(doc: PMNode, activeBlock: number): DecorationSet {
  const decorations: Decoration[] = [];
  collectLeafDecorations(doc, 0, activeBlock, decorations);
  return DecorationSet.create(doc, decorations);
}

/**
 * 跨块移动：只把旧聚焦块改回 dimmed、新聚焦块改为 active（O(1) remove/add）。
 * 原实现每次全量遍历块重建（P4-03）。
 * find 的相交判定是闭区间，会误捞相邻块装饰，须过滤 d.from === 块起点。
 */
function swapActiveBlock(
  decorations: DecorationSet,
  oldBlock: number,
  newBlock: number,
  doc: PMNode,
): DecorationSet {
  let result = decorations;

  if (oldBlock >= 0 && oldBlock !== newBlock) {
    const oldDecos = decorations.find(oldBlock, oldBlock + 1).filter((d) => d.from === oldBlock);
    if (oldDecos.length) result = result.remove(oldDecos);
    const oldNode = doc.nodeAt(oldBlock);
    if (oldNode) {
      result = result.add(doc, [
        Decoration.node(oldBlock, oldBlock + oldNode.nodeSize, { class: 'paragraph-dimmed' }),
      ]);
    }
  }

  if (newBlock >= 0) {
    const newDecos = result.find(newBlock, newBlock + 1).filter((d) => d.from === newBlock);
    if (newDecos.length) result = result.remove(newDecos);
    const newNode = doc.nodeAt(newBlock);
    if (newNode) {
      result = result.add(doc, [
        Decoration.node(newBlock, newBlock + newNode.nodeSize, { class: 'paragraph-active' }),
      ]);
    }
  }

  return result;
}

/** 插件工厂：测试直接调用（先例同 markdown-input 导出插件工厂） */
export function createParagraphFocusPlugin(): Plugin<ParagraphFocusState> {
  // 组字权威信号：apply 拿不到 view，用共享登记器挂住本实例（composition-freeze）。
  // 组字期间冻结 active/dimmed 装饰的 class swap，避免改动正在组字的 DOM。
  const tracker = createCompositionTracker();
  return new Plugin<ParagraphFocusState>({
    key: paragraphFocusKey,
    view(editorView) {
      const untrack = tracker.track(editorView);
      return {
        destroy() {
          untrack();
        },
      };
    },
    state: {
      init(_, state) {
        // 焦点模式未开时不预建装饰——props.decorations 此时返回 empty，建了也用不上。
        // 原实现在编辑器创建时无条件遍历全部顶层块，是超大文档「打开即卡」的实测热点之一；
        // 开启焦点模式时 refreshParagraphFocus 会发 meta reset 事务补建，不会丢效果。
        if (!isFocusModeActive() || isHeavyDocument()) {
          return { decorations: DecorationSet.empty, activeBlock: -1 };
        }
        const activeBlock = activeBlockOf(state);
        return { decorations: buildAllBlockDecorations(state.doc, activeBlock), activeBlock };
      },
      apply(tr, value) {
        // 档位只在打开 / 新建文档时变化，随后必然跟着整文档替换事务；这里无条件归零，不残留上一档装饰
        if (isHeavyDocument()) return { decorations: DecorationSet.empty, activeBlock: -1 };
        if (!isFocusModeActive()) return value;
        // 组字期间：只 map 平移装饰跟随 doc 变化，不 swap active/dimmed class
        // （swap 会改动正在组字段落的 class → WebView2 IME 候选窗失锚变形，横条塌成小方块）。
        // activeBlock 保持旧值，组字结束后光标落定的事务会重新 swap。
        // meta reset（切焦点模式）不在组字期发生，放行重建。
        if (tracker.isFrozen() && !tr.getMeta(paragraphFocusKey)) {
          return {
            decorations: mapFrozenDecorations(value.decorations, tr),
            activeBlock: value.activeBlock,
          };
        }
        // 焦点模式切换后的强制重建
        if (tr.getMeta(paragraphFocusKey)) {
          const activeBlock = activeBlockOf(tr);
          return { decorations: buildAllBlockDecorations(tr.doc, activeBlock), activeBlock };
        }

        let decorations = value.decorations;
        if (tr.docChanged) {
          if (isWholeDocReplace(tr)) {
            const activeBlock = activeBlockOf(tr);
            return { decorations: buildAllBlockDecorations(tr.doc, activeBlock), activeBlock };
          }
          // 块内编辑：mapped 平移坐标，class 集合不变（active 块起点不变）
          decorations = value.decorations.map(tr.mapping, tr.doc);
        }

        const newActiveBlock = activeBlockOf(tr);
        if (newActiveBlock === value.activeBlock) {
          return { decorations, activeBlock: value.activeBlock };
        }
        return {
          decorations: swapActiveBlock(decorations, value.activeBlock, newActiveBlock, tr.doc),
          activeBlock: newActiveBlock,
        };
      },
    },
    props: {
      decorations(state) {
        if (!isFocusModeActive()) return DecorationSet.empty;
        return paragraphFocusKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

export const ParagraphFocus = Extension.create({
  name: 'paragraphFocus',

  addProseMirrorPlugins() {
    return [createParagraphFocusPlugin()];
  },
});

/** 强制编辑器重绘装饰层（焦点模式切换后调用） */
export function refreshParagraphFocus(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(paragraphFocusKey, { reset: true }));
}
