<template>
  <div
    class="editor-shell h-full w-full cursor-text transition-colors"
    @click="handleContainerClick"
  >
    <div ref="editorWrapRef" class="mk-editor h-full overflow-y-auto outline-none" :style="settingsStore.isFocusMode ? { paddingTop: '48px' } : {}">
      <div class="mk-editor-inner">
        <EditorContent v-if="editor" :editor="editor" />
      </div>
    </div>

    <BubbleMenuComponent ref="bubbleMenuRef" :on-action="onBubbleMenuAction" />
    <SlashMenu ref="slashMenuRef" :items="slashMenuItems" :command="slashMenuCommand" />
    <EmojiMenu ref="emojiMenuRef" :items="emojiMenuItems" :command="emojiMenuCommand" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, shallowRef, onBeforeUnmount, watch } from 'vue';
import { debounce } from 'lodash-es';
import { Editor as TiptapEditor, EditorContent } from '@tiptap/vue-3';

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
import { useEditorAppearance } from './tiptap/useEditorAppearance';
import { useEditorSearch } from './tiptap/useEditorSearch';
import BubbleMenuComponent from './views/BubbleMenu.vue';
import SlashMenu from './views/SlashMenu.vue';
import EmojiMenu from './views/EmojiMenu.vue';
import './tiptap/editor.css';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.min.css';

type EditorUpdatePayload = {
  wordCount?: number;
  cursor?: { line: number; col: number };
  selectionText?: string;
  outline?: EditorOutlineItem[];
};

// 字数/大纲统计防抖：50ms 快速响应，用户输入时几乎实时更新字数显示
const STATS_UPDATE_DEBOUNCE_MS = 50;
// 序列化防抖：500ms 停顿后再序列化 markdown 并同步 store，避免连续击键时频繁序列化
const SERIALIZE_DEBOUNCE_MS = 500;
// 光标信息防抖：拖选时频繁触发 selection 更新，100ms 节流避免全量遍历 doc 计算行号
const CURSOR_INFO_DEBOUNCE_MS = 100;

const props = defineProps<{ initialContent?: string }>();
const emit = defineEmits<{ (e: 'update', data: EditorUpdatePayload): void }>();

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
useEditorAppearance();

// ── 创建 TipTap Editor ────────────────────────────────────────

const editor = shallowRef<TiptapEditor | null>(null);
const {
  openSearch,
  closeSearch,
} = useEditorSearch(editor);

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
    }),
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        spellcheck: settingsStore.settings.spellCheck ? 'true' : 'false',
      },
    },
    onUpdate: ({ editor: ed }) => {
      debouncedStatsUpdate(ed as unknown as TiptapEditor);
      debouncedSerialize(ed as unknown as TiptapEditor);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      updateBubbleMenu(ed as unknown as TiptapEditor);
      debouncedEmitCursorInfo(ed as unknown as TiptapEditor);
    },
  });

  // 解析 markdown 并设置文档
  if (content) {
    const doc = parseMarkdown(e.schema, content);
    e.commands.setContent(doc.toJSON());
  }

  editor.value = e;

  // 同步基线：setContent + appendTransaction 完成后，序列化结果作为 store 基准
  // 避免 parser/serializer round-trip 差异导致误判 dirty
  const baseline = serializeMarkdown(e.state.doc);
  fileStore.setContent(baseline);
}

// ── 更新回调 ──────────────────────────────────────────────────

// 字数/大纲统计：轻量操作，50ms 快速响应
const debouncedStatsUpdate = debounce((ed: TiptapEditor) => {
  if (ed.isDestroyed) return;
  const wordCount = getEditorWordCount(ed);
  const outline = extractEditorOutline(ed);
  emit('update', { wordCount, outline });
}, STATS_UPDATE_DEBOUNCE_MS);

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

    debouncedStatsUpdate.cancel();
    debouncedSerialize.cancel();
    debouncedEmitCursorInfo.cancel();
    const doc = parseMarkdown(editor.value.schema, content);
    // emitUpdate: false 避免触发 onUpdate 导致误判 dirty
    editor.value.commands.setContent(doc.toJSON(), { emitUpdate: false });
    // 重置基线，避免 parser/serializer round-trip 差异导致误判
    const baseline = serializeMarkdown(editor.value.state.doc);
    fileStore.setContent(baseline);
    editor.value.commands.focus('start');
  },
);

// ── BubbleMenu ────────────────────────────────────────────────

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

// ── 容器点击 ──────────────────────────────────────────────────

function handleContainerClick(event: MouseEvent) {
  // 点击编辑器空白区域时聚焦到编辑器末尾
  const target = event.target as HTMLElement;
  if (target === editorWrapRef.value) {
    editor.value?.commands.focus('end');
  }
}

// ── 图片拖拽上传 ──────────────────────────────────────────────

let unlistenDragDrop: (() => void) | null = null;

async function setupDragDrop() {
  unlistenDragDrop = await setupEditorImageDrop({
    editor,
    getDocumentPath: () => fileStore.currentFile.path,
  });
}

// ── 生命周期 ──────────────────────────────────────────────────

onMounted(() => {
  createEditor(props.initialContent || '');
  setupDragDrop();
});

onBeforeUnmount(() => {
  debouncedStatsUpdate.cancel();
  debouncedSerialize.cancel();
  debouncedEmitCursorInfo.cancel();
  editor.value?.destroy();
  editor.value = null;
  if (unlistenDragDrop) {
    unlistenDragDrop();
    unlistenDragDrop = null;
  }
});

// 拼写检查：编辑器创建后 settings 变更时动态更新 DOM 属性
watch(
  () => settingsStore.settings.spellCheck,
  (enabled) => {
    editor.value?.view.dom.setAttribute('spellcheck', enabled ? 'true' : 'false');
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
  getSelectionMarkdown: () => {
    if (!editor.value) return '';
    const { from, to, empty } = editor.value.state.selection;
    if (empty) return '';
    return editor.value.state.doc.textBetween(from, to, '\n');
  },
  getEditorView: () => editor.value?.view ?? null,
  hasFocus: () => editor.value?.isFocused ?? false,
  executeCommand: (commandId: string) => executeEditorCommand(editor.value, commandId),
  undo: () => editor.value?.commands.undo(),
  redo: () => editor.value?.commands.redo(),
  openSearch: (_showReplace = false) => {
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
