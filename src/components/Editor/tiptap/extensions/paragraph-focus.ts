import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

const key = new PluginKey('paragraphFocus');

function isFocusModeActive(): boolean {
  return document.documentElement.classList.contains('focus-mode');
}

export const ParagraphFocus = Extension.create({
  name: 'paragraphFocus',

  onCreate() {
    // 监听 <html> class 变化（focus-mode 开关），自动刷新 decorations
    const editor = this.editor;
    const observer = new MutationObserver(() => {
      if (editor.isDestroyed || !editor.view) return;
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
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            if (!isFocusModeActive()) return DecorationSet.empty;

            const currentBlockStart = state.selection.$head.before(1);
            const decorations: Decoration[] = [];

            state.doc.forEach((node, offset) => {
              if (!node.isBlock) return;
              decorations.push(
                Decoration.node(offset, offset + node.nodeSize, {
                  class: offset === currentBlockStart ? 'paragraph-active' : 'paragraph-dimmed',
                }),
              );
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

/** 强制编辑器重绘装饰层（焦点模式切换后调用） */
export function refreshParagraphFocus(view: EditorView) {
  view.dispatch(view.state.tr);
}
