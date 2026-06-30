import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const key = new PluginKey('searchHighlight');

// 装饰集缓存：用引用相等判断是否需要重建，避免每次 applyState 都 JSON.stringify
// getMatches() 返回的是 useEditorSearch 的 currentMatches.value，引用在搜索查询变化时才换新
let _cachedMatchesRef: Array<{ from: number; to: number }> | null = null;
let _cachedActiveIndex = -1;
let _cachedDecoSet: DecorationSet | null = null;

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
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const matches = getMatches();
            if (!matches.length) {
              _cachedMatchesRef = null;
              _cachedActiveIndex = -1;
              _cachedDecoSet = null;
              return DecorationSet.empty;
            }

            const activeIndex = getActiveIndex();

            // 引用比较：matches 引用稳定时（编辑期间不换新），仅 activeIndex 变化才重建
            if (
              matches === _cachedMatchesRef
              && activeIndex === _cachedActiveIndex
              && _cachedDecoSet
            ) {
              return _cachedDecoSet;
            }

            const decorations = matches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class: i === activeIndex ? 'search-match search-match-active' : 'search-match',
              }),
            );

            const decoSet = DecorationSet.create(state.doc, decorations);
            _cachedMatchesRef = matches;
            _cachedActiveIndex = activeIndex;
            _cachedDecoSet = decoSet;
            return decoSet;
          },
        },
      }),
    ];
  },
});
