<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { EditorOutlineItem } from '../Editor/tiptap/editor-metadata';
import type { AppEditorExpose } from '../../composables/useAppEditorState';
import { getBlockElFromPos, OUTLINE_SCROLL_RATIO } from '../Editor/tiptap/editor-dom';

const props = defineProps<{
  items: EditorOutlineItem[];
  editorRef: AppEditorExpose | null;
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

// ── 当前激活项（scroll-spy）────────────────────────────
// 监听编辑器滚动容器，取「视口顶部往下 25% 阈值线之上、最后一个标题」作为激活项。
// 阈值与跳转目标（scrollToPos 的 OUTLINE_SCROLL_RATIO）一致，保证跳转后高亮不跳回。
//
// P5-03 优化：缓存 scrollContainer 的视口 top 位置（cachedContainerRect），
// 避免每帧滚动调 getBoundingClientRect() 强制布局。该 top 在滚动中不变，
// 只在 resize / 窗口布局变化时需更新——用 ResizeObserver 监听。
const activePos = ref<number | null>(null);
let scrollContainer: HTMLElement | null = null;
let rafId: number | null = null;
let cachedContainerRect: number | null = null;
let containerResizeObserver: ResizeObserver | null = null;

function invalidateContainerRect() {
  cachedContainerRect = null;
}

function updateActive() {
  // 面板关闭时不跑 scroll-spy：每帧二分查找 + getBoundingClientRect 是纯浪费，
  // 关闭期间 activePos 冻结，重开时由 isOpen watch 补算一次。
  if (!props.isOpen) {
    activePos.value = null;
    return;
  }
  const view = props.editorRef?.getEditorView?.();
  if (!view || !scrollContainer || props.items.length === 0) {
    activePos.value = null;
    return;
  }
  // 优化（P5-03）：避免每帧调 scrollContainer.getBoundingClientRect() 强制布局。
  // 原实现每次滚动帧调 scrollContainer.getBoundingClientRect()，与滚动事件同步触发强制布局。
  // 新实现：缓存 scrollContainer 的 rect（top 位置在滚动中不变，只在 resize / 布局变化时更新），
  // 滚动帧中只读 scrollTop（浏览器缓存的布局属性，不触发强制布局）。
  const containerTop = cachedContainerRect ?? scrollContainer.getBoundingClientRect().top;
  if (cachedContainerRect == null) {
    cachedContainerRect = containerTop;
  }
  const threshold = containerTop + scrollContainer.clientHeight * OUTLINE_SCROLL_RATIO;

  // 二分查找：标题按文档序排列，top 单调递增
  // 找「top <= 阈值」的最后一个标题
  let lo = 0;
  let hi = props.items.length - 1;
  let current: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    // domAtPos 在块边界会拿到编辑根，须走块节点定位
    const el = getBlockElFromPos(view, props.items[mid].pos);
    if (!el) {
      lo = mid + 1;
      continue;
    }
    if (el.getBoundingClientRect().top <= threshold) {
      current = props.items[mid].pos;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  activePos.value = current;
}

function onScroll() {
  // 面板关闭时连 rAF 都不排（滚动事件本身仍会触发，但零调度零计算）
  if (!props.isOpen || rafId != null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    updateActive();
  });
}

function detachScroll() {
  scrollContainer?.removeEventListener('scroll', onScroll);
  containerResizeObserver?.disconnect();
  containerResizeObserver = null;
  window.removeEventListener('resize', invalidateContainerRect);
  scrollContainer = null;
  cachedContainerRect = null;
}

function attachScroll() {
  const view = props.editorRef?.getEditorView?.();
  if (!view) return;
  const container = (view.dom as HTMLElement).closest('.mk-editor') as HTMLElement | null;
  if (!container || container === scrollContainer) return;
  // 编辑器会被重建（懒初始化 / 视图切换），旧容器须先解绑再挂新的，避免重复监听
  detachScroll();
  scrollContainer = container;
  scrollContainer.addEventListener('scroll', onScroll, { passive: true });
  // P5-03：用 ResizeObserver 监听滚动容器布局变化，失效缓存。
  // 滚动中 top 不变，但 resize / 窗口移动 / 侧栏开合会改 top。
  containerResizeObserver = new ResizeObserver(() => invalidateContainerRect());
  containerResizeObserver.observe(scrollContainer);
  // 窗口 resize 也会影响（ResizeObserver 监听元素自身尺寸变化，不包含窗口移动）
  window.addEventListener('resize', invalidateContainerRect, { passive: true });
  updateActive();
}

onMounted(() => {
  // 编辑器是 rAF 懒建的：这里的 nextTick 早于它，取 view 只会拿到 null 且此后不再重试，
  // 会导致「刚打开文档时大纲高亮永不跟随滚动」。故补一个就绪信号（编辑器建好即派发）。
  window.addEventListener('solo:editor-ready', attachScroll);
  if (props.editorRef) nextTick(attachScroll);
});

watch(
  () => props.editorRef,
  (val) => {
    if (val) nextTick(attachScroll);
  },
);

// 重开面板时补算 scroll-spy：关闭期间 updateActive 早退，activePos 已冻结/清空
watch(
  () => props.isOpen,
  (open) => {
    if (open) nextTick(updateActive);
  },
);

onBeforeUnmount(() => {
  if (rafId != null) cancelAnimationFrame(rafId);
  window.removeEventListener('solo:editor-ready', attachScroll);
  detachScroll();
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
        <button class="outline-close" title="收起大纲 (Ctrl+/)" @click="emit('close')">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          >
            <path d="M8 2L4 6l4 4" />
          </svg>
        </button>
      </div>

      <nav class="outline-list" v-if="hasItems">
        <button
          v-for="item in items"
          :key="item.pos"
          class="outline-item"
          :class="[`outline-level-${item.level}`, { 'is-active': activePos === item.pos }]"
          :style="{ '--level': item.level }"
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
  transition:
    width var(--motion-base) var(--ease-out),
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
  transition:
    background-color var(--motion-fast),
    color var(--motion-fast),
    opacity var(--motion-fast);
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
  /* 按层级缩进，层级越深越往右：10 + (level-1)*12，公式化免硬编码 */
  padding-left: calc(10px + (var(--level, 1) - 1) * 12px);
  border-radius: var(--radius-md);
  border-right: 2px solid transparent;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.4;
  transition:
    background-color var(--motion-fast),
    color var(--motion-fast),
    border-color var(--motion-fast);
}

.outline-level-1 {
  font-weight: 600;
  color: var(--text-color);
}
.outline-level-2 {
  font-weight: 500;
}

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
