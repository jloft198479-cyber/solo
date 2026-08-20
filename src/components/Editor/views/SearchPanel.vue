<template>
  <!-- 搜索替换面板（从 MarkdownEditor 迁出，纯展示 + 输入状态，搜索引擎在 useEditorSearch） -->
  <Transition name="search-panel" :appear="true">
    <div v-show="visible" class="search-panel" @keydown.escape.stop="handleEscape">
      <div class="search-row">
        <svg
          class="search-icon"
          width="14"
          height="14"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
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
          @input="emitQuery()"
          @keydown.enter.exact.prevent="emitNext()"
          @keydown.shift.enter.prevent="emitPrev()"
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
          <span v-if="matchCount > 0" class="search-count">{{ currentIndex }}/{{ matchCount }}</span>
        </div>
        <button class="search-btn-nav" title="上一个 (Shift+Enter)" @click="emitPrev()">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M5 2l4 6H1z" />
          </svg>
        </button>
        <button class="search-btn-nav" title="下一个 (Enter)" @click="emitNext()">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M1 2h8l-4 6z" />
          </svg>
        </button>
        <button class="search-btn-close" title="关闭 (Esc)" @click="emitClose()">
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          >
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>

      <div v-if="showReplace" class="search-row search-replace-row">
        <svg
          class="search-icon"
          width="14"
          height="14"
          viewBox="0 0 15 15"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4.5 2v10M2.5 9.5l2 2 2-2M10.5 13V3M8.5 5.5l2-2 2 2" />
        </svg>
        <input
          v-model="replaceText"
          type="text"
          placeholder="替换为…"
          class="search-input"
          spellcheck="false"
          @keydown.enter.prevent="emitReplace()"
        />
        <div class="search-actions">
          <button class="search-action-btn" :disabled="matchCount === 0" @click="emitReplace()">
            替换
          </button>
          <button class="search-action-btn" :disabled="matchCount === 0" @click="emitReplaceAll()">
            全部替换
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

const props = defineProps<{
  visible: boolean;
  matchCount: number;
  currentIndex: number;
  /** 打开时预展开替换行（查找 vs 查找替换两种入口） */
  showReplaceOnOpen?: boolean;
}>();

const emit = defineEmits<{
  (e: 'query', query: string): void;
  (e: 'next'): void;
  (e: 'prev'): void;
  (e: 'replace', replacement: string): void;
  (e: 'replaceAll', replacement: string): void;
  (e: 'caseSensitive', sensitive: boolean): void;
  (e: 'close'): void;
}>();

const searchQuery = ref('');
const replaceText = ref('');
const showReplace = ref(false);
const caseSensitive = ref(false);
const searchInputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      showReplace.value = props.showReplaceOnOpen ?? false;
      nextTick(() => searchInputRef.value?.focus());
    } else {
      // 关闭时重置状态
      searchQuery.value = '';
      replaceText.value = '';
      showReplace.value = false;
    }
  },
);

// 面板已打开时入口模式变化（Mod+F 后再按 Mod+H）：同步展开/收起替换行
watch(
  () => props.showReplaceOnOpen,
  (val) => {
    if (props.visible) showReplace.value = val ?? false;
  },
);

function emitQuery() {
  emit('query', searchQuery.value);
}

function emitNext() {
  emit('next');
}

function emitPrev() {
  emit('prev');
}

function emitReplace() {
  emit('replace', replaceText.value);
}

function emitReplaceAll() {
  emit('replaceAll', replaceText.value);
}

function emitClose() {
  emit('close');
}

function toggleCaseSensitive() {
  caseSensitive.value = !caseSensitive.value;
  emit('caseSensitive', caseSensitive.value);
  if (searchQuery.value) emit('query', searchQuery.value);
}

function handleEscape() {
  if (showReplace.value) {
    showReplace.value = false;
  } else {
    emit('close');
  }
}

defineExpose({
  focus: () => searchInputRef.value?.focus(),
});
</script>

<style scoped>
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
  transition:
    background-color 0.15s,
    color 0.15s;
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
  transition:
    background-color 0.15s,
    color 0.15s;
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
  transition:
    background-color 0.15s,
    color 0.15s;
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
  transition:
    background-color 0.15s,
    border-color 0.15s,
    color 0.15s;
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
