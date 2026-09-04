<template>
  <div
    class="editor-shell relative h-full w-full cursor-text transition-colors"
    @click="lazyInitEditor"
  >
    <div
      ref="editorWrapRef"
      class="mk-editor h-full overflow-y-auto outline-none"
      @contextmenu="onEditorContextMenu"
    >
      <div class="mk-editor-inner">
        <EditorContent v-if="editor" :editor="editor" />
      </div>
    </div>

    <BubbleMenuComponent ref="bubbleMenuRef" @action="onBubbleMenuAction" />
    <ContextMenuComponent
      ref="contextMenuRef"
      :items="contextMenuItems"
      @select="onContextMenuSelect"
    />
    <SlashMenu ref="slashMenuRef" :items="slashMenuItems" :command="slashMenuCommand" />
    <EmojiMenu ref="emojiMenuRef" :items="emojiMenuItems" :command="emojiMenuCommand" />

    <!-- 搜索替换面板 -->
    <SearchPanel
      :visible="isSearchVisible"
      :match-count="searchMatchCount"
      :current-index="searchCurrentIndex"
      :show-replace-on-open="searchShowReplace"
      @query="onSearchQuery"
      @next="onSearchNext"
      @prev="onSearchPrev"
      @replace="onSearchReplace"
      @replace-all="onSearchReplaceAll"
      @case-sensitive="onSearchCaseSensitive"
      @close="closeSearch"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, shallowRef, onBeforeUnmount, watch } from 'vue';
import { Editor as TiptapEditor, EditorContent } from '@tiptap/vue-3';

import { useFileStore } from '../../stores/file';
import { useSettingsStore } from '../../stores/settings';
import { useEditorSync } from '../../composables/useEditorSync';
import { parseMarkdown } from './tiptap/markdown/parser';
import { serializeMarkdown, serializeClipboardSlice } from './tiptap/markdown/serializer';
import type { Node as PMNode, Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { SlashCommandItem } from './tiptap/extensions/slash-commands';
import type { EmojiItem } from './tiptap/extensions/emoji-suggest';
import {
  executeEditorCommand,
  runBubbleMenuAction,
  type BubbleMenuActionData,
} from './tiptap/editor-commands';
import {
  createEditorExtensions,
  type SlashMenuController,
  type EmojiMenuController,
} from './tiptap/editor-extensions';
import type { EditorSyncPayload } from '../../composables/useEditorSync';
import { setupEditorImageDrop } from './tiptap/editor-image-drop';
import {
  resetLocalSrcResolver,
  setLocalSrcResolver,
  releaseRemoteImageBlobs,
} from './tiptap/extensions/image';
import { resolveWikilinkTarget } from './tiptap/extensions/wikilink';
import { useEditorAppearance } from './tiptap/useEditorAppearance';
import { useEditorSearch, pulseJumpTarget } from './tiptap/useEditorSearch';
import { getBlockElFromPos, scrollElementIntoView } from './tiptap/editor-dom';
import { resolveImageDisplay } from '../../services/tauri/document';
import { message } from '../../services/tauri/dialog';
import { toAssetUrl } from '../../services/tauri/asset';
import { listenEditorFocus } from '../../services/tauri/events';
import { refreshParagraphFocus } from './tiptap/extensions/paragraph-focus';
import BubbleMenuComponent from './views/BubbleMenu.vue';
import ContextMenuComponent, { type ContextMenuItem } from './views/ContextMenu.vue';
import SlashMenu from './views/SlashMenu.vue';
import EmojiMenu from './views/EmojiMenu.vue';
import SearchPanel from './views/SearchPanel.vue';
import './tiptap/editor.css';

type EditorUpdatePayload = EditorSyncPayload;

const props = defineProps<{ initialContent?: string; outlineOpen?: boolean }>();
const emit = defineEmits<{
  (e: 'update', data: EditorUpdatePayload): void;
  (e: 'image-dblclick', src: string): void;
  (e: 'navigate-wikilink', path: string): void;
}>();

// 图片双击事件处理（用于冒泡监听器移除）
function handleImageDblClick(event: Event) {
  const detail = (event as CustomEvent).detail;
  if (detail?.src) {
    emit('image-dblclick', detail.src);
  }
}

const fileStore = useFileStore();
const settingsStore = useSettingsStore();
const editorWrapRef = ref<HTMLElement | null>(null);
const bubbleMenuRef = ref<InstanceType<typeof BubbleMenuComponent> | null>(null);
const contextMenuRef = ref<InstanceType<typeof ContextMenuComponent> | null>(null);
const contextMenuItems = ref<ContextMenuItem[]>([]);
const slashMenuRef = ref<SlashMenuController | null>(null);
const slashMenuItems = ref<SlashCommandItem[]>([]);
const slashMenuCommand = ref<(item: SlashCommandItem) => void>(() => {});
const emojiMenuRef = ref<EmojiMenuController | null>(null);
const emojiMenuItems = ref<EmojiItem[]>([]);
const emojiMenuCommand = ref<(item: EmojiItem) => void>(() => {});
const editor = shallowRef<TiptapEditor | null>(null);
useEditorAppearance(editor);

// 序列化缓存：doc 引用未变时复用上次结果，避免自动保存重复序列化。
// useEditorSync 的空闲序列化回调会通过 updateSerializeCache 复用结果。
let cachedSerialize: { doc: PMNode; content: string } | null = null;

// ── 编辑器 → 下层状态同步中枢（字数 / 大纲 / 光标 / 序列化，防抖后单出口）──
const {
  handleDocChange,
  handleSelectionChange,
  emitImmediateStats,
  emitOutlineNow,
  isSyncedWithStore,
  markSynced,
  cancelPending,
} = useEditorSync({
  onUpdate: (data) => emit('update', data),
  onSerialize: (content, doc) => {
    cachedSerialize = { doc, content };
  },
  // 未传 outlineOpen 视为常开（保守，保持旧行为）
  isOutlineOpen: () => props.outlineOpen ?? true,
});

// ── 创建 TipTap Editor ────────────────────────────────────────

const {
  isSearchVisible,
  searchMatchCount,
  searchCurrentIndex,
  onSearchQuery,
  onSearchNext,
  onSearchPrev,
  onSearchReplace,
  onSearchReplaceAll,
  onSearchCaseSensitive,
  currentMatches,
  openSearch,
  closeSearch,
  onEditorDocChange,
  onDocumentSwitch,
} = useEditorSearch(editor);

// 查找（false）/ 查找替换（true）两种入口，传给 SearchPanel 决定是否预展开替换行
const searchShowReplace = ref(false);

/** 互链点击：解析目标路径并请求父组件打开；未保存文档时提示先保存。 */
async function handleWikilinkNavigate(target: string) {
  const resolved = resolveWikilinkTarget(fileStore.currentFile.path, target);
  if (!resolved) {
    await message('请先保存当前文档，才能跳转到互链的目标文档。', {
      title: '互链跳转',
      kind: 'info',
    });
    return;
  }
  emit('navigate-wikilink', resolved);
}

// ── 图片路径解析缓存：同一 src + docPath + storagePath 的解析结果不会变，缓存避免重复 IPC ──
const resolvedImageCache = new Map<string, string>();

/**
 * 整体替换文档内容，但不进撤销栈、不触发 onUpdate。
 * 「载入 / 切换文档」在语义上是全新文档——Ctrl+Z 不应跨过文档边界回退到上一篇内容，
 * 否则撤销后触发自动保存会把旧文档内容写进当前文件（静默数据损坏）。
 * TipTap 的 setContent 只设 preventUpdate（core/dist index.js:1218），不处理 history；
 * PM history 插件尊重 addToHistory: false 事务 meta（prosemirror-history/dist index.js:274）。
 */
function replaceDocumentWithoutHistory(ed: TiptapEditor, doc: PMNode) {
  const tr = ed.state.tr.replaceWith(0, ed.state.doc.content.size, doc);
  tr.setMeta('addToHistory', false);
  tr.setMeta('preventUpdate', true);
  ed.view.dispatch(tr);
}

function createEditor(content: string) {
  if (editor.value) {
    editor.value.destroy();
  }

  const e = new TiptapEditor({
    extensions: createEditorExtensions({
      slashMenuRef,
      slashMenuItems,
      slashMenuCommand,
      emojiMenuRef,
      emojiMenuItems,
      emojiMenuCommand,
      searchHighlightOptions: {
        getMatches: () => currentMatches.value,
        getActiveIndex: () => searchCurrentIndex.value - 1,
      },
      getDocumentPath: () => fileStore.currentFile.path,
      getStoragePath: () => settingsStore.settings.imageStoragePath || null,
      onWikilinkNavigate: handleWikilinkNavigate,
    }),
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        spellcheck: settingsStore.settings.spellCheck ? 'true' : 'false',
      },
      // 出站修复：选区复制时产出 Markdown 纯文本，确保 callout / 数学公式 /
      // mermaid / wikilink / frontmatter / 脚注等扩展语法粘到外部 MD 编辑器不丢。
      // text/html 仍由 ProseMirror 默认生成（标准格式走 HTML 还原，不受影响）。
      clipboardTextSerializer: (slice: Slice, view: EditorView) => {
        return serializeClipboardSlice(view.state.doc, slice);
      },
    },
    onUpdate: ({ editor: ed }) => {
      const t = ed as unknown as TiptapEditor;
      // 脏标记由 useEditorSync → syncEditedContent 按「内容是否变化」判定，不再依赖交互门控
      handleDocChange(t);
      // 搜索高亮：编辑后防抖重新扫描，保持当前 activeIndex 上下文
      onEditorDocChange();
    },
    onSelectionUpdate: ({ editor: ed }) => {
      rafUpdateBubbleMenu(ed as unknown as TiptapEditor);
      handleSelectionChange(ed as unknown as TiptapEditor);
    },
  });

  // 解析 markdown 并设置文档（不进撤销栈：初始载入不是用户编辑，Ctrl+Z 不应清回空文档）
  if (content) {
    const doc = parseMarkdown(e.schema, content);
    replaceDocumentWithoutHistory(e, doc);
  }

  editor.value = e;

  // 自动聚集，打开即写（注意：需在 editor.value 赋值之后调用，否则 isFocused 为 false）
  e.commands.focus('start');

  // 基线存「编辑器序列化产物」而非磁盘原文：parse→serialize 不是字节等价往返
  // （markdown-it 把 CRLF/CR 归一成 LF，扩展 marks 顺序也会被重排）。基线存原文
  // 会让零编辑文档的语义比对永远不等 → 关窗误提示保存（Windows 下 CRLF 必现）。
  const initialDoc = e.state.doc;
  const baseline = serializeMarkdown(initialDoc);
  // 预热序列化缓存：未编辑就关闭时，getContent() 直接命中，不再全量重扫
  cachedSerialize = { doc: initialDoc, content: baseline };
  fileStore.setContent(baseline);
  // 基线即当前 doc 的序列化产物 → 锚定同步代际，关窗闸口据此跳过全量序列化
  markSynced();

  // 触发初始字数统计
  emitImmediateStats(e);
}

// ── 文件切换：复用 editor 实例替换文档（避免全量重建） ─────────
watch(
  // watch [path, reloadToken]：reloadToken 仅由 fileStore.setFile（磁盘载入）递增，
  // 覆盖「外部修改后点击重新加载」这种 path 不变、只有内容变的场景——
  // 只监 path 时编辑器不刷新，旧 doc 的延迟序列化还会把旧内容写回 store
  // 误标脏，用户一保存就把外部修改覆盖掉（静默数据损坏）。
  // 不直接 watch content：编辑期 syncEditedContent 也写 content，
  // 会在 store 滞后于编辑器时把正在编辑的内容回退成旧基线。
  () => [fileStore.currentFile.path, fileStore.reloadToken] as const,
  () => {
    resolvedImageCache.clear();
    if (!editor.value || editor.value.isDestroyed) return;
    const content = fileStore.currentFile.content;
    // 比较当前 editor 序列化结果与目标内容，相同则跳过（如另存为场景）。
    // 优先命中序列化缓存：大文档全量序列化要 100-300ms，缓存未命中才真跑。
    const currentDoc = editor.value.state.doc;
    const currentMarkdown = (
      cachedSerialize?.doc === currentDoc ? cachedSerialize.content : serializeMarkdown(currentDoc)
    ).replace(/\n+$/, '');
    const targetMarkdown = content.replace(/\n+$/, '');
    if (currentMarkdown === targetMarkdown) return;

    cancelPending();
    // 切文档时清除搜索高亮（旧文档的 matches pos 对新文档无意义）
    onDocumentSwitch();
    const doc = parseMarkdown(editor.value.schema, content);
    // 不进撤销栈、不触发 onUpdate（避免撤销跨文档 + 误判 dirty）
    replaceDocumentWithoutHistory(editor.value, doc);
    // 重置基线：与载入路径同语义——存序列化产物，不存目标原文
    const newDoc = editor.value.state.doc;
    const baseline = serializeMarkdown(newDoc);
    cachedSerialize = { doc: newDoc, content: baseline };
    fileStore.setContent(baseline);
    // preventUpdate 事务不触发 onUpdate → editGeneration 不会自己跟上，必须显式锚定
    markSynced();
    // preventUpdate 事务不触发 onUpdate → 手动补发字数和大纲
    emitImmediateStats(editor.value);
    editor.value.commands.focus('start');
  },
);

// ── BubbleMenu ────────────────────────────────────────────────

let _bubbleMenuRafId: number | null = null;
let _bubbleMenuPendingEd: TiptapEditor | null = null;

function rafUpdateBubbleMenu(ed: TiptapEditor) {
  _bubbleMenuPendingEd = ed;
  if (_bubbleMenuRafId != null) return;
  _bubbleMenuRafId = requestAnimationFrame(() => {
    _bubbleMenuRafId = null;
    const e = _bubbleMenuPendingEd;
    _bubbleMenuPendingEd = null;
    if (e && !e.isDestroyed) updateBubbleMenu(e);
  });
}

function updateBubbleMenu(ed: TiptapEditor) {
  const { from, to, empty } = ed.state.selection;
  // IME 输入法组合输入期间抑制 BubbleMenu，避免中文标点输入时闪烁
  if (empty || (ed.view as unknown as { composing?: boolean }).composing) {
    bubbleMenuRef.value?.update(false, 0, 0, {});
    return;
  }

  // 获取选区坐标
  const coords = ed.view.coordsAtPos(from);
  const endCoords = ed.view.coordsAtPos(to);
  // 定位到选区右端，格式栏显示在右侧，避免行首时溢出左边界
  // 视口边界钳位：防止 BubbleMenu 溢出右边界
  const BUBBLE_MENU_ESTIMATED_WIDTH = 360;
  const BUBBLE_MENU_OFFSET_X = 8;
  const viewportWidth = window.innerWidth;
  const maxLeft = viewportWidth - BUBBLE_MENU_ESTIMATED_WIDTH - BUBBLE_MENU_OFFSET_X - 8;
  const left = Math.max(8, Math.min(endCoords.right, maxLeft));
  const top = coords.top;

  // 检测当前 marks
  const marks = {
    bold: ed.isActive('bold'),
    italic: ed.isActive('italic'),
    code: ed.isActive('code'),
    link: ed.isActive('link'),
    bulletList: ed.isActive('bulletList'),
    dim: ed.isActive('dim'),
  };

  const linkAttributes = ed.getAttributes('link') as { href?: unknown };
  const linkHref = typeof linkAttributes.href === 'string' ? linkAttributes.href : undefined;

  bubbleMenuRef.value?.update(true, left, top, marks, linkHref);
}

function onBubbleMenuAction(type: string, data?: BubbleMenuActionData) {
  runBubbleMenuAction(editor.value, type, data);
}

// ── ContextMenu（右键菜单）──────────────────────────────────────

function buildTableContextMenuItems(ed: TiptapEditor): ContextMenuItem[] {
  const can = ed.can();
  return [
    { id: 'editor.tableAddRowBefore', label: '在上方插入行', disabled: !can.addRowBefore() },
    { id: 'editor.tableAddRowAfter', label: '在下方插入行', disabled: !can.addRowAfter() },
    { id: 'editor.tableDeleteRow', label: '删除当前行', disabled: !can.deleteRow() },
    { id: 'editor.tableAddColBefore', label: '在左侧插入列', disabled: !can.addColumnBefore() },
    { id: 'editor.tableAddColAfter', label: '在右侧插入列', disabled: !can.addColumnAfter() },
    { id: 'editor.tableDeleteCol', label: '删除当前列', disabled: !can.deleteColumn() },
    { id: 'editor.tableToggleHeaderRow', label: '切换表头行', disabled: !can.toggleHeaderRow() },
  ];
}

function onEditorContextMenu(event: MouseEvent) {
  const ed = editor.value;
  if (!ed || ed.isDestroyed) return;
  if (!ed.isActive('table')) return; // 非表格区域：让浏览器默认菜单出现
  contextMenuItems.value = buildTableContextMenuItems(ed);
  contextMenuRef.value?.open(event);
}

function onContextMenuSelect(item: ContextMenuItem) {
  executeEditorCommand(editor.value, item.id);
}

// ── 图片拖拽上传 ──────────────────────────────────────────────

let unlistenDragDrop: (() => void) | null = null;
// 卸载竞态守卫：setupDragDrop / setupWindowFocusHandlers 都是异步的，
// 组件可能在 await 期间被卸载（编辑器/图片预览模式切换），此时返回的
// unlisten 不会再被 onBeforeUnmount 调用，必须在赋值时自查补拆。
let isUnmounted = false;

async function setupDragDrop() {
  const unlisten = await setupEditorImageDrop({
    editor,
    getDocumentPath: () => fileStore.currentFile.path,
    getStoragePath: () => settingsStore.settings.imageStoragePath || null,
  });
  if (isUnmounted) {
    unlisten?.();
    return;
  }
  unlistenDragDrop = unlisten;
}

// ── 编辑器懒初始化 ────────────────────────────────────────────────
// 新窗口打开时不立即创建编辑器，首次聚焦或点击时才初始化。
// 注意：不活跃窗口不销毁编辑器——保留内容可见，仅由 Rust 侧
// MemoryUsageTargetLevel=Low 降低 WebView2 内存占用。

function lazyInitEditor() {
  if (editor.value && !editor.value.isDestroyed) return;
  createEditor(fileStore.currentFile.content || props.initialContent || '');
}

let unlistenFocus: (() => void) | null = null;

async function setupWindowFocusHandlers() {
  try {
    const unlisten = await listenEditorFocus(() => {
      if (editor.value && !editor.value.isDestroyed) return;
      lazyInitEditor();
    });
    if (isUnmounted) {
      unlisten();
      return;
    }
    unlistenFocus = unlisten;
  } catch {
    // 事件系统初始化失败，跳过懒初始化
  }
}

// ── 生命周期 ──────────────────────────────────────────────────

onMounted(async () => {
  setupDragDrop();
  await setupWindowFocusHandlers();

  // 先设图片路径解析器，再建编辑器——确保 Node View 初始化时能用上
  setLocalSrcResolver(async (src: string) => {
    const storagePath = settingsStore.settings.imageStoragePath;
    const docPath = fileStore.currentFile.path;
    const cacheKey = `${src}|${docPath ?? ''}|${storagePath ?? ''}`;
    const hit = resolvedImageCache.get(cacheKey);
    if (hit) return hit;
    try {
      const resolved = await resolveImageDisplay(src, docPath, storagePath);
      const url = toAssetUrl(resolved.path);
      resolvedImageCache.set(cacheKey, url);
      return url;
    } catch {
      return null;
    }
  });

  // 编辑器懒初始化——用 requestAnimationFrame 延迟到首帧绘制后创建，
  // 避免编辑器构建（schema 注册、高亮语言注册等）阻塞窗口首次绘制。
  // 后台不可见窗口的 RAF 不会触发，编辑器留待 solo:editor-focus 事件创建。
  requestAnimationFrame(() => {
    if (editor.value && !editor.value.isDestroyed) return;
    lazyInitEditor();
  });

  // 图片双击 → 全屏预览（从 CustomImage NodeView 冒泡上来的自定义事件）
  editorWrapRef.value?.addEventListener('editor:image-dblclick', handleImageDblClick);
});

onBeforeUnmount(() => {
  isUnmounted = true;

  // 1. 先断开 focus 事件，防止销毁期间回调触发
  unlistenFocus?.();
  unlistenFocus = null;

  // 2. 清理图片路径解析器
  resetLocalSrcResolver();

  // 3. 清理拖拽监听
  if (unlistenDragDrop) {
    unlistenDragDrop();
    unlistenDragDrop = null;
  }

  // 4. 销毁 TipTap editor（释放 ProseMirror DOM + 内部事件监听）
  if (editor.value && !editor.value.isDestroyed) {
    editor.value.destroy();
  }
  editor.value = null;

  // 5. 清理 DOM 级事件监听
  const gateEl = editorWrapRef.value;
  if (gateEl) {
    gateEl.removeEventListener('editor:image-dblclick', handleImageDblClick);
  }

  // 6. 释放远程图片 Blob 缓存
  releaseRemoteImageBlobs();
});

// 拼写检查：编辑器创建后 settings 变更时动态更新 DOM 属性
watch(
  () => settingsStore.settings.spellCheck,
  (enabled) => {
    editor.value?.view.dom.setAttribute('spellcheck', enabled ? 'true' : 'false');
  },
);

// 图片存储路径变化时清空路径解析缓存（基目录变了，旧缓存失效）
watch(
  () => settingsStore.settings.imageStoragePath,
  () => resolvedImageCache.clear(),
);

// 焦点模式：切换时强制刷新段落聚焦装饰层
watch(
  () => settingsStore.isFocusMode,
  () => {
    if (editor.value?.view) {
      refreshParagraphFocus(editor.value.view);
    }
  },
);

// 大纲面板打开时补算一次：大文档面板关闭期间跳过了提取，打开瞬间要给面板数据
watch(
  () => props.outlineOpen,
  (open, wasOpen) => {
    if (open && !wasOpen && editor.value && !editor.value.isDestroyed) {
      emitOutlineNow(editor.value);
    }
  },
);

// ── Expose ────────────────────────────────────────────────────

defineExpose({
  scrollToPos: (pos: number) => {
    if (!editor.value) return;
    const docSize = editor.value.state.doc.content.size;
    const target = Math.max(0, Math.min(pos, docSize));
    // 关掉 focus 附带的「最小滚动」，只保留下面唯一一次平滑滚动，避免两次滚动抢跑
    editor.value.commands.focus(target, { scrollIntoView: false });
    // 用块节点 DOM 定位：domAtPos 在块边界会拿到编辑根，导致 scrollIntoView 静默失效
    const el = getBlockElFromPos(editor.value.view, target);
    if (!el) return;
    // 标题平滑停到视口上方约 1/4 处（Obsidian/Typora 风格），见 editor-dom.ts
    scrollElementIntoView(editor.value.view, el);
    // 大纲跳转也给一次命中脉冲，体感和搜索「下一个」一致
    pulseJumpTarget(el);
  },
  getContent: () => {
    if (!editor.value) return null;
    const doc = editor.value.state.doc;
    // 序列化缓存：doc 引用未变时复用上次结果，避免自动保存重复序列化。
    // useEditorSync 的空闲序列化回调也会更新此缓存（复用结果）。
    if (cachedSerialize && cachedSerialize.doc === doc) {
      return cachedSerialize.content;
    }
    const content = serializeMarkdown(doc);
    cachedSerialize = { doc, content };
    return content;
  },
  getDoc: () => editor.value?.state.doc ?? null,
  /** 关窗 / 切文档闸口：store 基线是否已是当前 doc 的序列化产物（true 时无需再序列化兜底） */
  isSyncedWithStore: () => (editor.value ? isSyncedWithStore() : false),
  getEditorView: () => editor.value?.view ?? null,
  hasFocus: () => editor.value?.isFocused ?? false,
  executeCommand: (commandId: string) => executeEditorCommand(editor.value, commandId),
  undo: () => editor.value?.commands.undo(),
  redo: () => editor.value?.commands.redo(),
  openSearch: (showReplace = false) => {
    searchShowReplace.value = showReplace;
    openSearch();
  },
  closeSearch,
});
</script>

<style scoped>
.editor-shell {
  background-color: var(--bg-color);
}
</style>

<style>
/* 搜索匹配高亮（ProseMirror decorations 添加，须全局生效） */
.search-match {
  background-color: color-mix(in srgb, var(--primary-color) 18%, transparent);
  border-radius: 2px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

.search-match-active {
  background-color: color-mix(in srgb, var(--primary-color) 32%, transparent);
}
</style>
