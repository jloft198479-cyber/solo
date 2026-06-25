import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const key = new PluginKey('searchHighlight');

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
            if (!matches.length) return DecorationSet.empty;

            const decorations = matches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class: i === getActiveIndex() ? 'search-match search-match-active' : 'search-match',
              }),
            );

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
