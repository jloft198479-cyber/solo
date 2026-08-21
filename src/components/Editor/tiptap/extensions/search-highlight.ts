import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Transaction, EditorState } from '@tiptap/pm/state';

const key = new PluginKey<DecorationSet>('searchHighlight');

export interface SearchHighlightOptions {
  getMatches: () => Array<{ from: number; to: number }>;
  getActiveIndex: () => number;
}

export const SearchHighlight = Extension.create<SearchHighlightOptions>({
  name: 'searchHighlight',

  addOptions() {
    return {
      getMatches: () => [] as Array<{ from: number; to: number }>,
      getActiveIndex: () => 0,
    };
  },

  addProseMirrorPlugins() {
    const { getMatches, getActiveIndex } = this.options;
    // 引用比较缓存：放在闭包里而非模块级，确保多编辑器实例不串台
    let cachedMatchesRef: Array<{ from: number; to: number }> | null = null;
    let cachedActiveIndex = -1;
    return [
      new Plugin({
        key,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(
            tr: Transaction,
            oldSet: DecorationSet,
            _oldState: EditorState,
            newState: EditorState,
          ): DecorationSet {
            // 场景 1：切文档 → 显式清空
            if (tr.getMeta('clearSearch')) {
              cachedMatchesRef = null;
              cachedActiveIndex = -1;
              return DecorationSet.empty;
            }

            const matches = getMatches();
            if (!matches.length) {
              cachedMatchesRef = null;
              cachedActiveIndex = -1;
              return DecorationSet.empty;
            }

            const activeIndex = getActiveIndex();

            // 场景 2：用户编辑（docChanged）→ 先 map 旧装饰到新位置
            if (tr.docChanged) {
              oldSet = oldSet.map(tr.mapping, newState.doc);
            }

            // 引用比较：matches 引用稳定（编辑期间不换新）且 activeIndex 未变 → 用 mapped 后的 oldSet
            if (matches === cachedMatchesRef && activeIndex === cachedActiveIndex) {
              return oldSet;
            }

            // 场景 3：matches 引用或 activeIndex 变化 → 重建装饰
            const decorations = matches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class: i === activeIndex ? 'search-match search-match-active' : 'search-match',
              }),
            );

            cachedMatchesRef = matches;
            cachedActiveIndex = activeIndex;
            return DecorationSet.create(newState.doc, decorations);
          },
        },
        props: {
          decorations(state: EditorState) {
            return key.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
