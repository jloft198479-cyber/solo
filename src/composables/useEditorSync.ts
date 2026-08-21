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
// 序列化交空闲调度器执行后的兜底超时：rIC 长期无空闲（用户持续打字）时也必须在
// 该时长内执行，保证 store 数据不滞后（P4-05）
const SERIALIZE_IDLE_TIMEOUT_MS = 2000;
// 光标信息防抖：拖选时频繁触发 selection 更新，100ms 节流避免全量遍历 doc 计算行号
const CURSOR_INFO_DEBOUNCE_MS = 100;

// P4-05：requestIdleCallback 让「停顿后」的序列化落到浏览器空闲时段，不阻塞
// 下一次按键的主线程；非支持环境（测试 / 老 WebView）退化 setTimeout(0)，
// 仍在当前任务之后执行，不阻塞同步路径。
const requestIdle =
  typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
    ? (cb: IdleRequestCallback, options?: IdleRequestOptions) =>
        window.requestIdleCallback(cb, options)
    : (cb: IdleRequestCallback) =>
        setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 0 }), 0);

const cancelIdle =
  typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function'
    ? window.cancelIdleCallback.bind(window)
    : clearTimeout.bind(globalThis);

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

  // P4-05：防抖到点后不立即同步序列化，交空闲调度器执行——
  // 慢节奏打字（停顿结束的瞬间）不会把全文档序列化塞进下一次按键前的主线程。
  // 合并调度：空闲期若再次编辑并再次到点，只保留最新编辑器引用，一次空闲回调内完成。
  let pendingSerializeEditor: TiptapEditor | null = null;
  let serializeIdleId: number | null = null;

  function scheduleSerialize(ed: TiptapEditor) {
    pendingSerializeEditor = ed;
    if (serializeIdleId !== null) return;
    serializeIdleId = requestIdle(
      () => {
        serializeIdleId = null;
        const target = pendingSerializeEditor;
        pendingSerializeEditor = null;
        if (!target || target.isDestroyed) return;
        const markdown = serializeMarkdown(target.state.doc);
        fileStore.syncEditedContent(markdown);
      },
      { timeout: SERIALIZE_IDLE_TIMEOUT_MS },
    );
  }

  const debouncedSerialize = debounce((ed: TiptapEditor) => {
    scheduleSerialize(ed);
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
    if (serializeIdleId !== null) {
      cancelIdle(serializeIdleId);
      serializeIdleId = null;
      pendingSerializeEditor = null;
    }
  }

  onBeforeUnmount(cancelPending);

  return {
    handleDocChange,
    handleSelectionChange,
    emitImmediateStats,
    cancelPending,
  };
}
