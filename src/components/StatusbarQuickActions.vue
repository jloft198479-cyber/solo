<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import ThemePopover from './ThemePopover.vue';
import FontPopover from './FontPopover.vue';
import { useClickOutside } from '../composables/useClickOutside';
import { useFileStore } from '../stores/file';
import { renderMarkdown } from '../utils/markdown-to-html';

type PopoverType = 'theme' | 'font' | null;
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
  const content = useFileStore().currentFile.content;
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
      <svg v-if="!copied" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="4" width="8.5" height="8.5" rx="1" opacity="0.35"/>
        <rect x="6.5" y="6.5" width="8.5" height="8.5" rx="1"/>
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
