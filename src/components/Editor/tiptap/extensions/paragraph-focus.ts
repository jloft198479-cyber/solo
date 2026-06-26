import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

const key = new PluginKey('paragraphFocus');

function isFocusModeActive(): boolean {
  return document.documentElement.classList.contains('focus-mode');
}

// ── 模块级缓存（单编辑器实例，编辑器销毁/失焦时清理） ────────
let cachedActiveBlock = -1;
let cachedDecorations = DecorationSet.empty;
let cachedDocSize = 0;

function invalidateCache() {
  cachedActiveBlock = -1;
  cachedDecorations = DecorationSet.empty;
  cachedDocSize = 0;
}

export const ParagraphFocus = Extension.create({
  name: 'paragraphFocus',

  onCreate() {
    // 监听 <html> class 变化（focus-mode 开关），自动刷新 decorations
    const editor = this.editor;
    const observer = new MutationObserver(() => {
      if (editor.isDestroyed || !editor.view) return;
      // class 变化（如 focus-mode 切换）使缓存失效，强制重算
      invalidateCache();
      editor.view.dispatch(editor.state.tr);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    (this as unknown as Record<string, unknown>)._focusObserver = observer;
  },

  onDestroy() {
    const obs = (this as unknown as Record<string, unknown>)._focusObserver;
    if (obs instanceof MutationObserver) obs.disconnect();
    invalidateCache();
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            if (!isFocusModeActive()) return DecorationSet.empty;

            const activeBlock = state.selection.$head.before(1);
            const docSize = state.doc.content.size;

            // 缓存命中：active block 和文档大小均未变 → 直接返回
            // 覆盖场景：光标在同块内移动（方向键、鼠标点击）
            if (
              cachedActiveBlock === activeBlock &&
              cachedDocSize === docSize &&
              cachedDecorations !== DecorationSet.empty
            ) {
              return cachedDecorations;
            }

            // 缓存未命中（首次、块切换、或文档编辑）→ 遍历顶层块重建
            const decorations: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (!node.isBlock) return;
              decorations.push(
                Decoration.node(offset, offset + node.nodeSize, {
                  class:
                    offset === activeBlock
                      ? 'paragraph-active'
                      : 'paragraph-dimmed',
                }),
              );
            });

            cachedDecorations = DecorationSet.create(state.doc, decorations);
            cachedActiveBlock = activeBlock;
            cachedDocSize = docSize;
            return cachedDecorations;
          },
        },
      }),
    ];
  },
});

/** 强制编辑器重绘装饰层（焦点模式切换后调用） */
export function refreshParagraphFocus(view: EditorView) {
  invalidateCache();
  view.dispatch(view.state.tr);
}
