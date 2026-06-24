<template>
  <!-- 悬停触发区域：顶部 12px 透明条（仅在自动隐藏模式下生效） -->
  <div
    v-if="autoHide"
    class="titlebar-trigger"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  />

  <!-- 自定义标题栏：自动隐藏模式下悬停淡入，否则始终显示 -->
  <div
    class="custom-titlebar"
    :class="{ 'custom-titlebar--visible': titlebarVisible }"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <div data-tauri-drag-region class="titlebar-title-area">
      <input
        v-if="isEditingTitle"
        ref="titleInputRef"
        v-model="titleInputValue"
        class="titlebar-title-input"
        type="text"
        maxlength="100"
        @keydown.enter="commitEditTitle"
        @keydown.escape="cancelEditTitle"
        @blur="commitEditTitle"
      />
      <span
        v-else
        class="titlebar-title-text"
        data-tauri-drag-region
        :title="filePath || '点击重命名'"
        @click="startEditTitle"
      >
        {{ title }}
      </span>
    </div>
    <div class="titlebar-buttons">
      <button
        class="titlebar-btn"
        :class="{ 'titlebar-btn--active': props.alwaysOnTop }"
        title="置顶"
        @click="emit('toggleAlwaysOnTop')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 17v5" />
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </svg>
      </button>
      <button class="titlebar-btn" title="最小化" @click="emit('minimize')">
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
      </button>
      <button class="titlebar-btn" title="最大化" @click="emit('maximize')">
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>
      </button>
      <button class="titlebar-btn titlebar-btn--close" title="关闭" @click="emit('close')">
        <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue';

const props = defineProps<{
  title: string;
  filePath: string | null;
  displayName: string;
  autoHide: boolean;
  alwaysOnTop: boolean;
}>();

const emit = defineEmits<{
  (e: 'rename', name: string): void;
  (e: 'minimize'): void;
  (e: 'maximize'): void;
  (e: 'close'): void;
  (e: 'toggleAlwaysOnTop'): void;
}>();

const titlebarHovered = ref(false);
const isEditingTitle = ref(false);
const titleInputRef = ref<HTMLInputElement | null>(null);
const titleInputValue = ref('');
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

// 鼠标离开后延迟隐藏标题栏，避免边缘抖动导致频繁显隐
const TITLEBAR_HIDE_DELAY_MS = 300;

const titlebarVisible = computed(() =>
  props.autoHide ? titlebarHovered.value : true,
);

function onMouseEnter() {
  if (hoverTimer) clearTimeout(hoverTimer);
  titlebarHovered.value = true;
}

function onMouseLeave() {
  hoverTimer = setTimeout(() => {
    titlebarHovered.value = false;
  }, TITLEBAR_HIDE_DELAY_MS);
}

function startEditTitle() {
  titleInputValue.value = props.displayName;
  isEditingTitle.value = true;
  nextTick(() => {
    titleInputRef.value?.focus();
    titleInputRef.value?.select();
  });
}

function commitEditTitle() {
  if (isEditingTitle.value) {
    emit('rename', titleInputValue.value);
    isEditingTitle.value = false;
  }
}

function cancelEditTitle() {
  isEditingTitle.value = false;
}

onUnmounted(() => {
  if (hoverTimer) clearTimeout(hoverTimer);
});
</script>

<style scoped>
.custom-titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 36px;
  display: flex;
  align-items: center;
  z-index: 200;
  background-color: var(--bg-color);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  border-bottom: 1px solid transparent;
}

.custom-titlebar--visible {
  opacity: 1;
  pointer-events: auto;
  border-bottom-color: var(--border-color);
}

.titlebar-title-area {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 16px;
  min-width: 0;
}

.titlebar-title-text {
  font-size: 12px;
  color: var(--text-color);
  opacity: 0.45;
  cursor: text;
  padding: 2px 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity 0.15s;
  user-select: none;
}

.titlebar-title-text:hover {
  opacity: 0.75;
}

.titlebar-title-input {
  font-size: 12px;
  color: var(--text-color);
  opacity: 0.45;
  background: transparent;
  border: none;
  padding: 0;
  outline: none;
  max-width: 320px;
  caret-color: var(--primary-color);
  -webkit-app-region: no-drag;
}

.titlebar-title-input::selection {
  background-color: color-mix(in srgb, var(--primary-color) 25%, transparent);
}

.titlebar-buttons {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}

.titlebar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 0.15s;
}

.titlebar-btn:hover {
  background-color: var(--hover-bg);
}

.titlebar-btn--close:hover {
  background-color: var(--error-color);
  color: #ffffff;
}

.titlebar-btn--active {
  color: var(--primary-color);
  opacity: 1;
}

.titlebar-trigger {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 12px;
  z-index: 201;
  -webkit-app-region: no-drag;
  cursor: default;
}
</style>
