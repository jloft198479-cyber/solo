import { ref, type Ref } from 'vue';
import { debounce } from 'lodash-es';
import type { Editor as TiptapEditor } from '@tiptap/vue-3';
import { isHeavyDocument } from '../document-scale';
import { smoothScrollBehavior } from './editor-dom';

interface SearchMatch {
  from: number;
  to: number;
}

/**
 * 跳转命中后给目标元素加一次 300ms 高亮脉冲。
 * 视觉反馈比静默滚动更明确——UX 研究结论。
 * 元素不存在或已在动画中时安全跳过，不抛错。
 */
const PULSE_CLASS = 'mk-jump-target';
let pulseTimer: ReturnType<typeof setTimeout> | null = null;

export function pulseJumpTarget(el: HTMLElement | null | undefined) {
  if (!el) return;
  // 清掉上一次未结束的脉冲（连续跳转时）
  if (pulseTimer) {
    clearTimeout(pulseTimer);
    const prev = document.querySelector('.' + PULSE_CLASS);
    prev?.classList.remove(PULSE_CLASS);
  }
  // 强制重排让动画能再次触发（同一元素连续跳转的情况）
  el.classList.remove(PULSE_CLASS);
  void el.offsetWidth;
  el.classList.add(PULSE_CLASS);
  pulseTimer = setTimeout(() => {
    el.classList.remove(PULSE_CLASS);
    pulseTimer = null;
  }, 320);
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
    if (matches.length > 0) {
      scrollToMatch(0);
    } else if (editor.value && !editor.value.isDestroyed) {
      // 从有匹配变成 0 匹配时，dispatch 空 tr 触发 apply 清除残留高亮
      editor.value.view.dispatch(editor.value.state.tr);
    }
  }, 120);

  // 编辑后重新扫描：保持当前 activeIndex 上下文（不重置到 1）
  // 搜索框输入（doSearch）固定 120ms；编辑触发的重扫按档位分流——
  // heavy/extreme 档全文扫描 + 全量装饰重建开销大，防抖放到 500ms 降频。
  // 档位在切文档时变化，路由必须在触发时判断，故用两个 debounce 实例。
  const refreshAfterEditFast = debounce(() => refreshMatches(), 120);
  const refreshAfterEditSlow = debounce(() => refreshMatches(), 500);

  function refreshMatches() {
    if (!searchQuery || !editor.value) return;
    // 组字期间不 dispatch：空事务会触发 search-highlight 重建 inline 装饰，
    // 改动正在组字的 DOM → WebView2 下 IME 候选窗失锚变形（横条塌成小方块）。
    // 组字结束后最终上屏的 doc change 会再触发一次刷新，高亮不会漏。
    if (editor.value.view.composing) return;
    const matches = findMatches(searchQuery);
    // 匹配集合未变（数量与位置都相同）：无需 dispatch。已有装饰在用户编辑的
    // doc change 事务里被 search-highlight 的 map 平移到新位置，仍然正确；
    // 空 dispatch 只为换 currentMatches 引用触发重建——引用不换就不必发。
    if (matchesEqual(matches, currentMatches.value)) return;
    currentMatches.value = matches;
    searchMatchCount.value = matches.length;
    // clamp 当前索引到有效范围，保持用户的高亮位置上下文
    if (matches.length === 0) {
      searchCurrentIndex.value = 0;
    } else if (searchCurrentIndex.value > matches.length) {
      searchCurrentIndex.value = 1;
    }
    // 触发事务让 decorations 回调重建（currentMatches 引用已变）
    if (editor.value && !editor.value.isDestroyed) {
      editor.value.view.dispatch(editor.value.state.tr);
    }
  }

  function matchesEqual(a: SearchMatch[], b: SearchMatch[]): boolean {
    return a.length === b.length && a.every((m, i) => m.from === b[i].from && m.to === b[i].to);
  }

  function findMatches(query: string): SearchMatch[] {
    if (!editor.value || !query) return [];
    const doc = editor.value.state.doc;
    const results: SearchMatch[] = [];
    const searchText = caseSensitive ? query : query.toLowerCase();

    doc.descendants((node, pos) => {
      // wikilink 是 atom 节点，display 文本（alias||target）不在 doc 文本里——
      // 单独匹配，命中则高亮整节点（A10：显示文本可搜索）。替换语义顺延：
      // 命中 wikilink 的替换 = 整节点换成替换文本，与所见即所得一致。
      if (node.type.name === 'wikilink') {
        const display = String(node.attrs.alias || node.attrs.target || '');
        const text = caseSensitive ? display : display.toLowerCase();
        if (text.includes(searchText)) {
          results.push({ from: pos, to: pos + node.nodeSize });
        }
        return;
      }
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
    el?.scrollIntoView({ behavior: smoothScrollBehavior(), block: 'center' });
    pulseJumpTarget(el);
  }

  function onSearchQuery(query: string) {
    searchQuery = query;
    if (!query) {
      currentMatches.value = [];
      searchMatchCount.value = 0;
      searchCurrentIndex.value = 0;
      doSearch.cancel();
      // 触发事务清除 ProseMirror 搜索高亮装饰（与 closeSearch 一致）
      if (editor.value) {
        editor.value.view.dispatch(editor.value.state.tr);
      }
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
    refreshAfterEditFast.cancel();
    refreshAfterEditSlow.cancel();

    // 触发事务清除 ProseMirror 搜索高亮装饰
    if (editor.value) {
      editor.value.view.dispatch(editor.value.state.tr);
    }
  }

  /** 编辑器内容变化时调用（由 MarkdownEditor onUpdate 接线） */
  function onEditorDocChange() {
    // heavy/extreme 档降频：全文重扫 + 装饰全量重建是大开销，500ms 防抖够用
    if (isHeavyDocument()) {
      refreshAfterEditSlow();
    } else {
      refreshAfterEditFast();
    }
  }

  /** 切换文档时调用：清除搜索状态并通知 PM 插件 */
  function onDocumentSwitch() {
    refreshAfterEditFast.cancel();
    refreshAfterEditSlow.cancel();
    doSearch.cancel();
    searchQuery = '';
    currentMatches.value = [];
    searchMatchCount.value = 0;
    searchCurrentIndex.value = 0;
    // 通知 search-highlight 插件清空（通过 clearSearch meta）
    if (editor.value && !editor.value.isDestroyed) {
      editor.value.view.dispatch(editor.value.state.tr.setMeta('clearSearch', true));
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
    onEditorDocChange,
    onDocumentSwitch,
  };
}
