<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
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
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function togglePopover(type: PopoverType) {
  activePopover.value = activePopover.value === type ? null : type;
}

function closePopover() {
  activePopover.value = null;
}

async function copyMarkdown() {
  // 优先编辑器实时内容（绕过 store 500ms 防抖），编辑器不可用时回退到 store 内容
  const content = props.editorRef?.getContent?.() ?? useFileStore().currentFile.content;
  try {
    const html = renderMarkdown(content);
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([content], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    copied.value = true;
    copyTimer = setTimeout(() => { copied.value = false; }, 1500);
  } catch {
    // 静默失败，clipboard API 在部分环境可能不可用
  }
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
      :class="{ 'is-copied': copied }"
      :title="copied ? '已复制' : '复制 Markdown'"
      @click="copyMarkdown"
    >
      <svg v-if="!copied" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
      </svg>
      <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 8.5l3 3 7-7" />
      </svg>
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
  transition: background-color 0.15s, color 0.15s, opacity 0.15s;
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
</style>
