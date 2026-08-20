import { onBeforeUnmount } from 'vue';
import { debounce } from 'lodash-es';
import type { Editor as TiptapEditor } from '@tiptap/vue-3';
import {
  extractEditorOutline,
  getEditorCursorInfo,
  getEditorWordCount,
  type EditorOutlineItem,
} from '../components/Editor/tiptap/editor-metadata';
import { serializeMarkdown } from '../components/Editor/tiptap/markdown/serializer';
import { useFileStore } from '../stores/file';

export interface EditorSyncPayload {
  wordCount?: number;
  cursor?: { line: number; col: number };
  selectionText?: string;
  outline?: EditorOutlineItem[];
}

export interface EditorSyncOptions {
  /** 内容变化后的统一出口（防抖后）。替代原先 4 路独立 emit('update')。 */
  onUpdate: (data: EditorSyncPayload) => void;
}

// 字数统计轻量（读 doc.textContent），150ms 均衡响应与开销
const WORD_COUNT_DEBOUNCE_MS = 150;
// 大纲提取需遍历 headings，500ms 避免高频编辑时频繁重建
const OUTLINE_DEBOUNCE_MS = 500;
// 序列化防抖：500ms 停顿后再序列化 markdown 并同步 store，避免连续击键时频繁序列化
const SERIALIZE_DEBOUNCE_MS = 500;
// 光标信息防抖：拖选时频繁触发 selection 更新，100ms 节流避免全量遍历 doc 计算行号
const CURSOR_INFO_DEBOUNCE_MS = 100;

/**
 * 编辑器 → 下层状态的同步中枢。
 *
 * 职责单一：编辑器 doc/selection 变化后，统一计算字数 / 大纲 / 光标信息，
 * 防抖后经 onUpdate 单出口抛出；序列化结果同步 file store。
 * 组件层只负责创建编辑器和渲染，不再各自编排同步细节。
 */
export function useEditorSync(options: EditorSyncOptions) {
  const fileStore = useFileStore();

  const debouncedWordCount = debounce((ed: TiptapEditor) => {
    if (ed.isDestroyed) return;
    options.onUpdate({ wordCount: getEditorWordCount(ed) });
  }, WORD_COUNT_DEBOUNCE_MS);

  const debouncedOutline = debounce((ed: TiptapEditor) => {
    if (ed.isDestroyed) return;
    options.onUpdate({ outline: extractEditorOutline(ed) });
  }, OUTLINE_DEBOUNCE_MS);

  const debouncedSerialize = debounce((ed: TiptapEditor) => {
    // 防止 debounce 延迟期间切换文件导致旧内容写入新文件
    if (ed.isDestroyed) return;

    const markdown = serializeMarkdown(ed.state.doc);
    // A1：脏标记唯一真相源 = 编辑序列化结果与基线是否语义变化（比较逻辑在 store 收敛）
    fileStore.syncEditedContent(markdown);
  }, SERIALIZE_DEBOUNCE_MS);

  const debouncedEmitCursorInfo = debounce((ed: TiptapEditor) => {
    if (ed.isDestroyed) return;
    options.onUpdate(getEditorCursorInfo(ed));
  }, CURSOR_INFO_DEBOUNCE_MS);

  /** 编辑器 doc 变化（onUpdate 回调）入口 */
  function handleDocChange(ed: TiptapEditor) {
    debouncedWordCount(ed);
    debouncedOutline(ed);
    debouncedSerialize(ed);
  }

  /** 编辑器选区变化（onSelectionUpdate 回调）入口 */
  function handleSelectionChange(ed: TiptapEditor) {
    debouncedEmitCursorInfo(ed);
  }

  /** 立即补发全量统计（setContent 后手动调用，避免跳过防抖窗口） */
  function emitImmediateStats(ed: TiptapEditor) {
    options.onUpdate({
      wordCount: getEditorWordCount(ed),
      outline: extractEditorOutline(ed),
    });
  }

  function cancelPending() {
    debouncedWordCount.cancel();
    debouncedOutline.cancel();
    debouncedSerialize.cancel();
    debouncedEmitCursorInfo.cancel();
  }

  onBeforeUnmount(cancelPending);

  return {
    handleDocChange,
    handleSelectionChange,
    emitImmediateStats,
    cancelPending,
  };
}
