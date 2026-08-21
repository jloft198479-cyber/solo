import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

export const paragraphFocusKey = new PluginKey<ParagraphFocusState>('paragraphFocus');

type ParagraphFocusState = {
  /** 全量块装饰集（每块一条 active/dimmed），随事务增量维护（P4-03） */
  decorations: DecorationSet;
  /** 当前聚焦块（光标所在顶层块）起点 */
  activeBlock: number;
};

function isFocusModeActive(): boolean {
  return document.documentElement.classList.contains('focus-mode');
}

/** 光标所在顶层块起点；无有效光标（空 doc / 顶层 selection）返回 -1 */
function activeBlockOf(state: EditorState | Transaction): number {
  const $head = state.selection.$head;
  if (!$head || $head.depth < 1) return -1;
  return $head.before(1);
}

/** 全量构建：为每个顶层块建一条 active/dimmed 装饰（init / 整体替换 / 强制重建时用） */
function buildAllBlockDecorations(doc: PMNode, activeBlock: number): DecorationSet {
  const decorations: Decoration[] = [];
  doc.forEach((node, offset) => {
    if (!node.isBlock) return;
    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, {
        class: offset === activeBlock ? 'paragraph-active' : 'paragraph-dimmed',
      }),
    );
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * 跨块移动：只把旧聚焦块改回 dimmed、新聚焦块改为 active（O(1) remove/add）。
 * 原实现每次全量遍历顶层块重建（P4-03）。
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

/** 单 step 覆盖整个旧文档 = 整体替换（文件切换 / 全选替换），旧装饰对新 doc 无效，需全量重建 */
function isWholeDocReplace(tr: Transaction): boolean {
  if (tr.steps.length !== 1) return false;
  let whole = false;
  tr.steps[0].getMap().forEach((from, to) => {
    if (from === 0 && to === tr.before.content.size) whole = true;
  });
  return whole;
}

/** 插件工厂：测试直接调用（先例同 markdown-input 导出插件工厂） */
export function createParagraphFocusPlugin(): Plugin<ParagraphFocusState> {
  return new Plugin<ParagraphFocusState>({
    key: paragraphFocusKey,
    state: {
      init(_, state) {
        const activeBlock = activeBlockOf(state);
        return { decorations: buildAllBlockDecorations(state.doc, activeBlock), activeBlock };
      },
      apply(tr, value) {
        if (!isFocusModeActive()) return value;
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
