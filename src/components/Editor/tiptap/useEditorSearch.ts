import { ref, type Ref } from 'vue';
import { debounce } from 'lodash-es';
import type { Editor as TiptapEditor } from '@tiptap/vue-3';

interface SearchMatch {
  from: number;
  to: number;
}

export function useEditorSearch(editor: Ref<TiptapEditor | null>) {
  const isSearchVisible = ref(false);
  const searchMatchCount = ref(0);
  const searchCurrentIndex = ref(0);

  let searchQuery = '';
  let caseSensitive = false;
  const currentMatches = ref<SearchMatch[]>([]);

  // 120ms 防抖：避免长文档下每个按键都触发全文扫描
  const doSearch = debounce((query: string) => {
    const matches = findMatches(query);
    currentMatches.value = matches;
    searchMatchCount.value = matches.length;
    searchCurrentIndex.value = matches.length > 0 ? 1 : 0;
    if (matches.length > 0) scrollToMatch(0);
  }, 120);

  function findMatches(query: string): SearchMatch[] {
    if (!editor.value || !query) return [];
    const doc = editor.value.state.doc;
    const results: SearchMatch[] = [];
    const searchText = caseSensitive ? query : query.toLowerCase();

    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      const text = caseSensitive ? node.text : node.text.toLowerCase();
      let index = 0;
      while ((index = text.indexOf(searchText, index)) !== -1) {
        results.push({ from: pos + index, to: pos + index + query.length });
        index += 1;
      }
    });
    return results;
  }

  function scrollToMatch(index: number) {
    if (!editor.value || index < 0 || index >= currentMatches.value.length) return;
    const match = currentMatches.value[index];
    editor.value.commands.setTextSelection(match);
    const dom = editor.value.view.domAtPos(match.from);
    const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function onSearchQuery(query: string) {
    searchQuery = query;
    if (!query) {
      currentMatches.value = [];
      searchMatchCount.value = 0;
      searchCurrentIndex.value = 0;
      doSearch.cancel();
      return;
    }
    doSearch(query);
  }

  function onSearchCaseSensitive(sensitive: boolean) {
    caseSensitive = sensitive;
    onSearchQuery(searchQuery);
  }

  function onSearchNext() {
    if (searchMatchCount.value === 0) return;
    searchCurrentIndex.value =
      searchCurrentIndex.value >= searchMatchCount.value ? 1 : searchCurrentIndex.value + 1;
    scrollToMatch(searchCurrentIndex.value - 1);
  }

  function onSearchPrev() {
    if (searchMatchCount.value === 0) return;
    searchCurrentIndex.value =
      searchCurrentIndex.value <= 1 ? searchMatchCount.value : searchCurrentIndex.value - 1;
    scrollToMatch(searchCurrentIndex.value - 1);
  }

  function onSearchReplace(replacement: string) {
    if (!editor.value || currentMatches.value.length === 0) return;
    const idx = searchCurrentIndex.value - 1;
    if (idx < 0 || idx >= currentMatches.value.length) return;
    const match = currentMatches.value[idx];
    const replaceFrom = match.from;

    editor.value
      .chain()
      .focus()
      .setTextSelection(match)
      .deleteSelection()
      .insertContent(replacement)
      .run();

    currentMatches.value = findMatches(searchQuery);
    searchMatchCount.value = currentMatches.value.length;

    if (currentMatches.value.length === 0) {
      searchCurrentIndex.value = 0;
      return;
    }

    // 定位到替换位置之后最近的匹配
    let nextIdx = currentMatches.value.findIndex((m) => m.from >= replaceFrom);
    if (nextIdx === -1) nextIdx = 0;
    searchCurrentIndex.value = nextIdx + 1;
    scrollToMatch(nextIdx);
  }

  function onSearchReplaceAll(replacement: string) {
    if (!editor.value || currentMatches.value.length === 0) return;
    const matches = [...currentMatches.value].reverse();
    const chain = editor.value.chain();
    for (const match of matches) {
      chain.setTextSelection(match).deleteSelection().insertContent(replacement);
    }
    chain.run();

    currentMatches.value = findMatches(searchQuery);
    searchMatchCount.value = currentMatches.value.length;
    searchCurrentIndex.value = currentMatches.value.length > 0 ? 1 : 0;
    if (currentMatches.value.length > 0) scrollToMatch(0);
  }

  function openSearch() {
    isSearchVisible.value = true;
  }

  function closeSearch() {
    isSearchVisible.value = false;
    searchMatchCount.value = 0;
    searchCurrentIndex.value = 0;
    currentMatches.value = [];
    searchQuery = '';
    doSearch.cancel();

    // 触发事务清除 ProseMirror 搜索高亮装饰
    if (editor.value) {
      editor.value.view.dispatch(editor.value.state.tr);
    }
  }

  return {
    isSearchVisible,
    searchMatchCount,
    searchCurrentIndex,
    currentMatches,
    onSearchQuery,
    onSearchCaseSensitive,
    onSearchNext,
    onSearchPrev,
    onSearchReplace,
    onSearchReplaceAll,
    openSearch,
    closeSearch,
  };
}
