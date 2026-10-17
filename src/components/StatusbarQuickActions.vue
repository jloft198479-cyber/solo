<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import Icon from './icons/Icon';
import ThemePopover from './ThemePopover.vue';
import FontPopover from './FontPopover.vue';
import { useClickOutside } from '../composables/useClickOutside';
import { useFileStore } from '../stores/file';
import { renderMarkdown } from '../utils/markdown-to-html';
import type { AppEditorExpose } from '../composables/useAppEditorState';

type PopoverType = 'theme' | 'font' | null;

// 复制按钮需要编辑器「实时内容」：store 的 currentFile.content 是 500ms 防抖后才落库的旧快照，
// 用户刚编辑完立刻点复制会得到缺最后几次击键的过期内容。故依赖编辑器引用实时序列化。
const props = withDefaults(defineProps<{ editorRef?: AppEditorExpose | null }>(), {
  editorRef: null,
});
const activePopover = ref<PopoverType>(null);
const wrapRef = ref<HTMLElement | null>(null);
const copied = ref(false);
const copyFailed = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function togglePopover(type: PopoverType) {
  activePopover.value = activePopover.value === type ? null : type;
}

function closePopover() {
  activePopover.value = null;
}

/**
 * 复制**整篇**文档（双槽：text/plain 源码 + text/html 富文本）。
 * 注意与命令面板的「复制为 Markdown」区分：那条复制的是**选区源码**，同名不同事（M-35）。
 */
async function copyMarkdown() {
  try {
    // 取数必须在 try 内：getContent() 内部会调 serializeMarkdown，抛在 try 外就绕过了
    // 下面的失败反馈（M-22 的原始抱怨正是「按钮不变样」）
    // 优先编辑器实时内容（绕过 store 500ms 防抖），编辑器不可用时回退到 store 内容
    const content = props.editorRef?.getContent?.() ?? useFileStore().currentFile.content;
    const html = await buildExternalHtml(props.editorRef, content);
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([content], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    copyFailed.value = false;
    copied.value = true;
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // 失败必须给反馈：此前静默吞掉，用户会以为「已经复制成功」而丢掉内容（M-22）
    copied.value = false;
    copyFailed.value = true;
    copyTimer = setTimeout(() => {
      copyFailed.value = false;
    }, 1500);
  }
}

/**
 * 对外 HTML：正统出口是**编辑器自己的** DOMSerializer + 出站归一（与 Ctrl+C 同源，单一生产者）。
 *
 * 两种情况回落到旧的 markdown-it 管道，回落产出仍带 P1-4a~e 那些失真（已知降级，
 * 见 CP-20261011-002「不改什么」）：① 拿不到 doc——编辑器被卸载（图片预览模式），只能吃
 * store 里的 markdown；② 归一链抛错。AGENTS §4「任何优化必有 fallback」，这里不为新链路
 * 制造「一抛就没得复制」的新失败面。
 *
 * `clipboard-html` 用 dynamic import：本组件是 App 的**静态**依赖（`App.vue:18`），静态引入它
 * 会把 `@tiptap/*` 与全部扩展拖进入站 chunk（编辑器本体才是异步的，`App.vue:37`）。
 */
async function buildExternalHtml(
  editor: AppEditorExpose | null,
  markdown: string,
): Promise<string> {
  try {
    const { serializeDocumentHtml } = await import('./Editor/tiptap/clipboard-html');
    const html = serializeDocumentHtml(editor?.getDoc?.() ?? null);
    if (html !== null) return html;
  } catch {
    // 落回旧管道，不额外报错过（外层 catch 只兜真正的写入失败）
  }
  return renderMarkdown(markdown);
}

onUnmounted(() => {
  if (copyTimer) clearTimeout(copyTimer);
});

useClickOutside(wrapRef, closePopover);
</script>

<template>
  <div ref="wrapRef" class="quick-action-wrap quick-actions">
    <ThemePopover
      :is-active="activePopover === 'theme'"
      @toggle="togglePopover('theme')"
      @select="closePopover"
    />
    <FontPopover
      :is-active="activePopover === 'font'"
      @toggle="togglePopover('font')"
      @select="closePopover"
    />
    <button
      class="quick-action-btn"
      :class="{ 'is-copied': copied, 'is-failed': copyFailed }"
      :title="copied ? '已复制全文' : copyFailed ? '复制失败' : '复制全文为 Markdown'"
      @click="copyMarkdown"
    >
      <Icon v-if="!copied" name="copy" :size="16" />
      <Icon v-else name="check" :size="16" />
    </button>
  </div>
</template>

<style scoped>
.quick-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.quick-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-lg);
  transition:
    background-color var(--motion-fast),
    color var(--motion-fast),
    opacity var(--motion-fast);
  opacity: 0.6;
}

.quick-action-btn:hover {
  background-color: var(--hover-bg);
  color: var(--text-color);
  opacity: 1;
}

.quick-action-btn.is-copied {
  color: var(--success-color);
  opacity: 1;
}

/* 失败态必须有视觉：只改 tooltip 的话，用户不悬停就看不到（M-22 的原始抱怨正是「按钮不变样」） */
.quick-action-btn.is-failed {
  color: var(--error-color);
  opacity: 1;
}
</style>
