<template>
    <div
      class="editor-shell relative h-full w-full cursor-text transition-colors"
      @click="lazyInitEditor"
    >
    <div ref="editorWrapRef" class="mk-editor h-full overflow-y-auto outline-none">
      <div class="mk-editor-inner">
        <EditorContent v-if="editor" :editor="editor" />
      </div>
    </div>

    <BubbleMenuComponent ref="bubbleMenuRef" :on-action="onBubbleMenuAction" />
    <SlashMenu ref="slashMenuRef" :items="slashMenuItems" :command="slashMenuCommand" />
    <EmojiMenu ref="emojiMenuRef" :items="emojiMenuItems" :command="emojiMenuCommand" />

    <!-- 搜索替换面板 -->
    <Transition name="search-panel" :appear="true">
    <div v-show="isSearchVisible" class="search-panel" @keydown.escape.stop="handleSearchEscape">
      <div class="search-row">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="6" r="4.5" />
          <line x1="9.5" y1="9.5" x2="14" y2="14" />
        </svg>
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          placeholder="搜索…"
          class="search-input"
          spellcheck="false"
          @input="onSearchQuery(searchQuery)"
          @keydown.enter.exact.prevent="onSearchNext()"
          @keydown.shift.enter.prevent="onSearchPrev()"
        />
        <div class="search-meta">
          <button
            class="search-btn-meta"
            :class="{ active: caseSensitive }"
            title="区分大小写"
            @click="toggleCaseSensitive"
          >
            Aa
          </button>
          <span v-if="searchMatchCount > 0" class="search-count">{{ searchCurrentIndex }}/{{ searchMatchCount }}</span>
        </div>
        <button class="search-btn-nav" title="上一个 (Shift+Enter)" @click="onSearchPrev()">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 2l4 6H1z" /></svg>
        </button>
        <button class="search-btn-nav" title="下一个 (Enter)" @click="onSearchNext()">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M1 2h8l-4 6z" /></svg>
        </button>
        <button class="search-btn-close" title="关闭 (Esc)" @click="closeSearch()">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" /></svg>
        </button>
      </div>

      <div v-if="showReplace" class="search-row search-replace-row">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4.5 2v10M2.5 9.5l2 2 2-2M10.5 13V3M8.5 5.5l2-2 2 2" />
        </svg>
        <input
          v-model="replaceText"
          type="text"
          placeholder="替换为…"
          class="search-input"
          spellcheck="false"
          @keydown.enter.prevent="onSearchReplace(replaceText)"
        />
        <div class="search-actions">
          <button class="search-action-btn" :disabled="searchMatchCount === 0" @click="onSearchReplace(replaceText)">替换</button>
          <button class="search-action-btn" :disabled="searchMatchCount === 0" @click="onSearchReplaceAll(replaceText)">全部替换</button>
        </div>
      </div>
    </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, shallowRef, onBeforeUnmount, watch } from 'vue';
import { debounce } from 'lodash-es';
import { Editor as TiptapEditor, EditorContent } from '@tiptap/vue-3';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { useFileStore } from '../../stores/file';
import { useSettingsStore } from '../../stores/settings';
import { parseMarkdown } from './tiptap/markdown/parser';
import { serializeMarkdown } from './tiptap/markdown/serializer';
import type { SlashCommandItem } from './tiptap/extensions/slash-commands';
import type { EmojiItem } from './tiptap/extensions/emoji-suggest';
import {
  executeEditorCommand,
  runBubbleMenuAction,
  type BubbleMenuActionData,
} from './tiptap/editor-commands';
import { createEditorExtensions, type SlashMenuController, type EmojiMenuController } from './tiptap/editor-extensions';
import {
  extractEditorOutline,
  getEditorCursorInfo,
  getEditorWordCount,
  type EditorOutlineItem,
} from './tiptap/editor-metadata';
import { setupEditorImageDrop } from './tiptap/editor-image-drop';
import { resetLocalSrcResolver, setLocalSrcResolver } from './tiptap/extensions/image';
import { useEditorAppearance } from './tiptap/useEditorAppearance';
import { useEditorSearch } from './tiptap/useEditorSearch';
import {
  resolveDocumentImagePath,
  authorizeImageAsset,
} from '../../services/tauri/document';
import { toAssetUrl } from '../../services/tauri/asset';
import { refreshParagraphFocus } from './tiptap/extensions/paragraph-focus';
import BubbleMenuComponent from './views/BubbleMenu.vue';
import SlashMenu from './views/SlashMenu.vue';
import EmojiMenu from './views/EmojiMenu.vue';
import './tiptap/editor.css';

type EditorUpdatePayload = {
  wordCount?: number;
  cursor?: { line: number; col: number };
  selectionText?: string;
  outline?: EditorOutlineItem[];
};

// 字数统计轻量（读 doc.textContent），150ms 均衡响应与开销
const WORD_COUNT_DEBOUNCE_MS = 150;
// 大纲提取需遍历 headings，500ms 避免高频编辑时频繁重建
const OUTLINE_DEBOUNCE_MS = 500;
// 序列化防抖：500ms 停顿后再序列化 markdown 并同步 store，避免连续击键时频繁序列化
const SERIALIZE_DEBOUNCE_MS = 500;
// 光标信息防抖：拖选时频繁触发 selection 更新，100ms 节流避免全量遍历 doc 计算行号
const CURSOR_INFO_DEBOUNCE_MS = 100;

const props = defineProps<{ initialContent?: string }>();
const emit = defineEmits<{
  (e: 'update', data: EditorUpdatePayload): void;
  (e: 'image-dblclick', src: string): void;
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
const slashMenuRef = ref<SlashMenuController | null>(null);
const slashMenuItems = ref<SlashCommandItem[]>([]);
const slashMenuCommand = ref<(item: SlashCommandItem) => void>(() => {});
const emojiMenuRef = ref<EmojiMenuController | null>(null);
const emojiMenuItems = ref<EmojiItem[]>([]);
const emojiMenuCommand = ref<(item: EmojiItem) => void>(() => {});
const editor = shallowRef<TiptapEditor | null>(null);
useEditorAppearance(editor);

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
} = useEditorSearch(editor);

const searchQuery = ref('');
const replaceText = ref('');
const showReplace = ref(false);
const caseSensitive = ref(false);
const searchInputRef = ref<HTMLInputElement | null>(null);

watch(isSearchVisible, (visible) => {
  if (visible) {
    nextTick(() => searchInputRef.value?.focus());
  } else {
    // 关闭时重置状态
    searchQuery.value = '';
    replaceText.value = '';
    showReplace.value = false;
  }
});

function toggleCaseSensitive() {
  caseSensitive.value = !caseSensitive.value;
  onSearchCaseSensitive(caseSensitive.value);
  if (searchQuery.value) onSearchQuery(searchQuery.value);
}

function handleSearchEscape() {
  if (showReplace.value) {
    showReplace.value = false;
  } else {
    closeSearch();
  }
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
    }),
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        spellcheck: settingsStore.settings.spellCheck ? 'true' : 'false',
      },
    },
    onUpdate: ({ editor: ed }) => {
      const t = ed as unknown as TiptapEditor;
      debouncedWordCount(t);
      debouncedOutline(t);
      debouncedSerialize(t);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      rafUpdateBubbleMenu(ed as unknown as TiptapEditor);
      debouncedEmitCursorInfo(ed as unknown as TiptapEditor);
    },
  });

  // 解析 markdown 并设置文档
  if (content) {
    const doc = parseMarkdown(e.schema, content);
    e.commands.setContent(doc.toJSON(), { emitUpdate: false });
  }

  editor.value = e;

  // 自动聚集，打开即写（注意：需在 editor.value 赋值之后调用，否则 isFocused 为 false）
  e.commands.focus('start');

  // 同步基线 — 直接用原始内容建立，避免无意义的解析→序列化轮转
  fileStore.setContent(content || '');

  // 触发初始字数统计
  const wc = getEditorWordCount(e);
  const ol = extractEditorOutline(e);
  emit('update', { wordCount: wc, outline: ol });
}

// ── 更新回调 ──────────────────────────────────────────────────

// 字数统计：轻量操作，150ms 快速响应
const debouncedWordCount = debounce((ed: TiptapEditor) => {
  if (ed.isDestroyed) return;
  emit('update', { wordCount: getEditorWordCount(ed) });
}, WORD_COUNT_DEBOUNCE_MS);

// 大纲提取：需遍历 headings，500ms 低频率刷新
const debouncedOutline = debounce((ed: TiptapEditor) => {
  if (ed.isDestroyed) return;
  emit('update', { outline: extractEditorOutline(ed) });
}, OUTLINE_DEBOUNCE_MS);

// 序列化 + store 同步：重量操作，500ms 防抖减少频繁序列化开销
const debouncedSerialize = debounce((ed: TiptapEditor) => {
  // 防止 debounce 延迟期间切换文件导致旧内容写入新文件
  if (ed.isDestroyed) return;

  const markdown = serializeMarkdown(ed.state.doc);
  // 规范化比较：序列化器总是追加 \n，store 初始值可能是 ''
  const normalizedStored = fileStore.currentFile.content.replace(/\n+$/, '');
  const normalizedNew = markdown.replace(/\n+$/, '');
  if (normalizedNew !== normalizedStored) {
    fileStore.markUserEdit();
    fileStore.setContent(markdown);
  }
}, SERIALIZE_DEBOUNCE_MS);

// 选区信息更新做节流，避免拖选时频繁全量遍历 doc 计算行号
const debouncedEmitCursorInfo = debounce((ed: TiptapEditor) => {
  if (ed.isDestroyed) return;
  emit('update', getEditorCursorInfo(ed));
}, CURSOR_INFO_DEBOUNCE_MS);

// ── 文件切换：复用 editor 实例替换文档（避免全量重建） ─────────
watch(
  () => fileStore.currentFile.path,
  () => {
    if (!editor.value || editor.value.isDestroyed) return;
    const content = fileStore.currentFile.content;
    // 比较当前 editor 序列化结果与目标内容，相同则跳过（如另存为场景）
    const currentMarkdown = serializeMarkdown(editor.value.state.doc).replace(/\n+$/, '');
    const targetMarkdown = content.replace(/\n+$/, '');
    if (currentMarkdown === targetMarkdown) return;

    debouncedWordCount.cancel();
    debouncedOutline.cancel();
    debouncedSerialize.cancel();
    debouncedEmitCursorInfo.cancel();
    const doc = parseMarkdown(editor.value.schema, content);
    // emitUpdate: false 避免触发 onUpdate 导致误判 dirty
    editor.value.commands.setContent(doc.toJSON(), { emitUpdate: false });
    // 重置基线：直接用目标内容，避免一次序列化
    fileStore.setContent(targetMarkdown);
    // setContent({ emitUpdate:false }) 不触发 onUpdate → 手动补发字数和大纲
    const wc = getEditorWordCount(editor.value);
    const ol = extractEditorOutline(editor.value);
    emit('update', { wordCount: wc, outline: ol });
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
  };

  const linkAttributes = ed.getAttributes('link') as { href?: unknown };
  const linkHref = typeof linkAttributes.href === 'string' ? linkAttributes.href : undefined;

  bubbleMenuRef.value?.update(true, left, top, marks, linkHref);
}

function onBubbleMenuAction(type: string, data?: BubbleMenuActionData) {
  runBubbleMenuAction(editor.value, type, data);
}

// ── 图片拖拽上传 ──────────────────────────────────────────────

let unlistenDragDrop: (() => void) | null = null;

async function setupDragDrop() {
  unlistenDragDrop = await setupEditorImageDrop({
    editor,
    getDocumentPath: () => fileStore.currentFile.path,
    getStoragePath: () => settingsStore.settings.imageStoragePath || null,
  });
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
    const appWindow = getCurrentWindow();
    unlistenFocus = await appWindow.listen('solo:editor-focus', () => {
      if (editor.value && !editor.value.isDestroyed) return;
      lazyInitEditor();
    });
  } catch {
    // 事件系统初始化失败，跳过懒初始化
  }
}

// ── 生命周期 ──────────────────────────────────────────────────

onMounted(async () => {
  setupDragDrop();
  await setupWindowFocusHandlers();

  // 编辑器懒初始化
  if (document.hasFocus()) {
    // 快速路径：窗口已有焦点，直接创建
    createEditor(props.initialContent || '');
  } else {
    // 延迟兜底：Focused(true) 事件可能早于 listener 注册到达而被丢弃。
    // 短延迟给事件队列一次额外处理机会，之后仍无焦点则强行创建编辑器
    // （失去的只是懒加载优化，窗口正确可用更重要）
    setTimeout(() => {
      if (editor.value && !editor.value.isDestroyed) return;
      lazyInitEditor();
    }, 50);
  }

  // 图片双击 → 全屏预览（从 CustomImage NodeView 冒泡上来的自定义事件）
  editorWrapRef.value?.addEventListener('editor:image-dblclick', handleImageDblClick);

  // 设置本地图片路径解析器（相对路径 → asset:// URL）
  setLocalSrcResolver(async (src: string) => {
    const docPath = fileStore.currentFile.path;
    if (!docPath) return null;
    try {
      const resolved = await resolveDocumentImagePath(docPath, src);
      const authorized = await authorizeImageAsset(resolved.absolutePath);
      return toAssetUrl(authorized.path);
    } catch {
      return null;
    }
  });
});

onBeforeUnmount(() => {
  // 1. 先断开 focus 事件，防止销毁期间回调触发
  unlistenFocus?.();
  unlistenFocus = null;

  // 2. 清理图片路径解析器
  resetLocalSrcResolver();

  // 3. 取消所有防抖操作，防止回调中操作已销毁的 editor
  debouncedWordCount.cancel();
  debouncedOutline.cancel();
  debouncedSerialize.cancel();
  debouncedEmitCursorInfo.cancel();

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
  editorWrapRef.value?.removeEventListener('editor:image-dblclick', handleImageDblClick);
});

// 拼写检查：编辑器创建后 settings 变更时动态更新 DOM 属性
watch(
  () => settingsStore.settings.spellCheck,
  (enabled) => {
    editor.value?.view.dom.setAttribute('spellcheck', enabled ? 'true' : 'false');
  },
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

// ── Expose ────────────────────────────────────────────────────

defineExpose({
  scrollToPos: (pos: number) => {
    if (!editor.value) return;
    const docSize = editor.value.state.doc.content.size;
    const target = Math.max(0, Math.min(pos, docSize));
    editor.value.commands.focus(target);
    // 滚动到视图
    const dom = editor.value.view.domAtPos(target);
    if (dom.node instanceof HTMLElement) {
      dom.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (dom.node.parentElement) {
      dom.node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },
  getContent: () => {
    if (!editor.value) return '';
    return serializeMarkdown(editor.value.state.doc);
  },
  getDoc: () => editor.value?.state.doc ?? null,
  getEditorView: () => editor.value?.view ?? null,
  hasFocus: () => editor.value?.isFocused ?? false,
  executeCommand: (commandId: string) => executeEditorCommand(editor.value, commandId),
  undo: () => editor.value?.commands.undo(),
  redo: () => editor.value?.commands.redo(),
  openSearch: (_showReplace = false) => {
    showReplace.value = _showReplace;
    openSearch();
  },
  closeSearch,
});
</script>

<style scoped>
.editor-shell {
  background-color: var(--bg-color);
}

/* ── 搜索面板 ──────────────────────────────────────────── */
.search-panel {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 300;
  min-width: 420px;
  max-width: 520px;
  background: color-mix(in srgb, var(--bg-color) 92%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--border-color);
  border-top: none;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  box-shadow: var(--popover-shadow);
  overflow: hidden;
}

/* search-panel 进出场动画：仅用 opacity，避免覆盖 translateX(-50%) 居中 */
.search-panel-enter-active,
.search-panel-leave-active {
  transition: opacity 0.15s ease;
}
.search-panel-enter-from,
.search-panel-leave-to {
  opacity: 0;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}

.search-replace-row {
  border-top: 1px solid var(--border-color);
  padding-top: 6px;
}

.search-icon {
  flex-shrink: 0;
  color: var(--muted-color);
  opacity: 0.6;
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-color);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  caret-color: var(--primary-color);
}

.search-input::placeholder {
  color: var(--muted-color);
  opacity: 0.5;
}

.search-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.search-btn-meta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted-color);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.search-btn-meta:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.search-btn-meta.active {
  color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
}

.search-count {
  color: var(--muted-color);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  min-width: 2.8em;
  text-align: right;
  white-space: nowrap;
}

.search-btn-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.search-btn-nav:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.search-btn-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted-color);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.search-btn-close:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.search-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.search-action-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
  white-space: nowrap;
}

.search-action-btn:hover:not(:disabled) {
  background: var(--hover-bg);
  border-color: var(--primary-color);
  color: var(--text-color);
}

.search-action-btn:disabled {
  opacity: 0.35;
  cursor: default;
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
