<template>
  <Transition name="mk-menu" :appear="true">
    <div
      v-show="visible"
      class="context-menu"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      @mousedown.prevent
      @click.stop
      @contextmenu.prevent
    >
      <button
        v-for="item in items"
        :key="item.id"
        class="context-menu-item"
        :class="{ 'context-menu-item--disabled': item.disabled }"
        :disabled="item.disabled"
        type="button"
        @click="onSelect(item)"
      >
        <span class="context-menu-item-label">{{ item.label }}</span>
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { reactive, ref, onBeforeUnmount, nextTick } from 'vue';

export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
}

const props = defineProps<{ items: ContextMenuItem[] }>();
const emit = defineEmits<{ (e: 'select', item: ContextMenuItem): void }>();

const visible = ref(false);
const pos = reactive({ left: 0, top: 0 });

let dismissController: AbortController | null = null;

const MENU_ESTIMATED_WIDTH = 200;
const MENU_ESTIMATED_HEIGHT_PER_ITEM = 32;
const MENU_PADDING = 8;

function open(event: MouseEvent) {
  event.preventDefault();
  close();

  const itemCount = Math.max(props.items.length, 1);
  const estimatedHeight = itemCount * MENU_ESTIMATED_HEIGHT_PER_ITEM + MENU_PADDING * 2;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = event.clientX;
  let top = event.clientY;

  if (left + MENU_ESTIMATED_WIDTH > viewportWidth - 8) {
    left = Math.max(8, viewportWidth - MENU_ESTIMATED_WIDTH - 8);
  }
  if (top + estimatedHeight > viewportHeight - 8) {
    top = Math.max(8, viewportHeight - estimatedHeight - 8);
  }

  pos.left = left;
  pos.top = top;
  visible.value = true;

  nextTick(() => bindDismiss());
}

function close() {
  visible.value = false;
  unbindDismiss();
}

function bindDismiss() {
  if (dismissController) dismissController.abort();
  dismissController = new AbortController();
  const { signal } = dismissController;

  document.addEventListener('click', onDismiss, { capture: true, signal });
  document.addEventListener('contextmenu', onDismiss, { capture: true, signal });
  document.addEventListener('keydown', onKeyDown, { signal });
  window.addEventListener('blur', onDismiss, { signal });
}

function unbindDismiss() {
  if (dismissController) {
    dismissController.abort();
    dismissController = null;
  }
}

function onDismiss() {
  close();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
}

function onSelect(item: ContextMenuItem) {
  if (item.disabled) return;
  emit('select', item);
  close();
}

onBeforeUnmount(() => unbindDismiss());

defineExpose({ open, close });
</script>

<style scoped>
.context-menu {
  position: fixed;
  /* 高于 BubbleMenu(z-index:300)，右键菜单应盖住选区浮层 */
  z-index: 400;
  display: flex;
  flex-direction: column;
  min-width: 160px;
  padding: 4px;
  background-color: var(--popover-bg);
  border: 1px solid var(--popover-border);
  border-radius: var(--radius-md);
  box-shadow: var(--popover-shadow);
  transition:
    opacity var(--motion-fast) ease,
    transform var(--motion-fast) ease;
}

.context-menu-item {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-sm);
  background-color: transparent;
  color: var(--text-color);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--motion-fast);
}

.context-menu-item:hover:not(:disabled) {
  background-color: var(--hover-bg);
}

.context-menu-item--disabled {
  color: var(--muted-color);
  cursor: not-allowed;
  opacity: 0.6;
}

.context-menu-item-label {
  white-space: nowrap;
}
</style>
