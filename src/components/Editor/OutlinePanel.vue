<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { EditorOutlineItem } from '../Editor/tiptap/editor-metadata';
import type { AppEditorExpose } from '../../composables/useAppEditorState';

const props = defineProps<{
  items: EditorOutlineItem[];
  editorRef: AppEditorExpose | null;
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

// ── 当前激活项（scroll-spy）────────────────────────────
// 监听编辑器滚动容器，取视口顶部阈值之上、最后一个标题作为激活项。
const activePos = ref<number | null>(null);
let scrollContainer: HTMLElement | null = null;
let rafId: number | null = null;

function updateActive() {
  const view = props.editorRef?.getEditorView?.();
  if (!view || !scrollContainer) return;
  const top = scrollContainer.getBoundingClientRect().top + 88;
  let current: number | null = null;
  for (const item of props.items) {
    const dom = view.domAtPos(item.pos);
    const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
    if (!el) continue;
    if (el.getBoundingClientRect().top <= top) {
      current = item.pos;
    } else {
      break;
    }
  }
  activePos.value = current;
}

function onScroll() {
  if (rafId != null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    updateActive();
  });
}

function attachScroll() {
  const view = props.editorRef?.getEditorView?.();
  if (!view) return;
  scrollContainer = (view.dom as HTMLElement).closest('.mk-editor') as HTMLElement | null;
  if (scrollContainer) {
    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    updateActive();
  }
}

onMounted(() => {
  if (props.editorRef) nextTick(attachScroll);
});

watch(
  () => props.editorRef,
  (val) => {
    if (val) nextTick(attachScroll);
  },
);

onBeforeUnmount(() => {
  if (rafId != null) cancelAnimationFrame(rafId);
  scrollContainer?.removeEventListener('scroll', onScroll);
  scrollContainer = null;
});

// ── 交互 ─────────────────────────────────────────────
function onClickItem(item: EditorOutlineItem) {
  props.editorRef?.scrollToPos(item.pos);
  activePos.value = item.pos;
}

const hasItems = computed(() => props.items.length > 0);
</script>

<template>
  <aside class="outline-panel" :class="{ 'is-open': isOpen }" aria-label="文档大纲">
    <div class="outline-inner">
      <div class="outline-header">
        <span class="outline-title">大纲</span>
        <button
          class="outline-close"
          title="收起大纲 (Ctrl+/)"
          @click="emit('close')"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <path d="M8 2L4 6l4 4" />
          </svg>
        </button>
      </div>

      <nav class="outline-list" v-if="hasItems">
        <button
          v-for="item in items"
          :key="item.pos"
          class="outline-item"
          :class="[
            `outline-level-${item.level}`,
            { 'is-active': activePos === item.pos },
          ]"
          :title="item.text"
          @click="onClickItem(item)"
        >
          <span class="outline-item-text">{{ item.text || '（空标题）' }}</span>
        </button>
      </nav>

      <div class="outline-empty" v-else>暂无标题</div>
    </div>
  </aside>
</template>

<style scoped>
.outline-panel {
  width: 0;
  flex-shrink: 0;
  overflow: hidden;
  background-color: var(--sidebar-bg);
  border-left: 1px solid transparent;
  transition: width var(--motion-base) var(--ease-out),
    border-color var(--motion-base) var(--ease-out);
}

.outline-panel.is-open {
  width: 236px;
  border-left-color: var(--border-color);
}

.outline-inner {
  width: 236px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-light);
}

.outline-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  text-transform: uppercase;
  opacity: 0.75;
}

.outline-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-md);
  opacity: 0.55;
  transition: background-color var(--motion-fast), color var(--motion-fast), opacity var(--motion-fast);
}

.outline-close:hover {
  background-color: var(--sidebar-hover);
  color: var(--text-color);
  opacity: 1;
}

.outline-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.outline-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 5px 10px;
  border-radius: var(--radius-md);
  border-right: 2px solid transparent;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.4;
  transition: background-color var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
}

/* 按层级缩进，层级越深越往右 */
.outline-level-1 { padding-left: 10px; }
.outline-level-2 { padding-left: 22px; }
.outline-level-3 { padding-left: 34px; }
.outline-level-4 { padding-left: 46px; }
.outline-level-5 { padding-left: 58px; }
.outline-level-6 { padding-left: 70px; }

.outline-level-1 { font-weight: 600; color: var(--text-color); }
.outline-level-2 { font-weight: 500; }

.outline-item:hover {
  background-color: var(--sidebar-hover);
  color: var(--text-color);
}

.outline-item.is-active {
  background-color: var(--active-bg);
  border-right-color: var(--accent-color);
  color: var(--text-color);
}

.outline-item-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outline-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--muted-color);
  opacity: 0.7;
}
</style>
