import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const key = new PluginKey('searchHighlight');

let _cachedKey = '';
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
              _cachedKey = '';
              _cachedDecoSet = null;
              return DecorationSet.empty;
            }

            const activeIndex = getActiveIndex();

            const cacheKey = JSON.stringify(matches) + '|' + activeIndex;
            if (cacheKey === _cachedKey && _cachedDecoSet) return _cachedDecoSet;

            const decorations = matches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class: i === activeIndex ? 'search-match search-match-active' : 'search-match',
              }),
            );

            const decoSet = DecorationSet.create(state.doc, decorations);
            _cachedKey = cacheKey;
            _cachedDecoSet = decoSet;
            return decoSet;
          },
        },
      }),
    ];
  },
});
