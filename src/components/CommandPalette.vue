<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  COMMANDS,
  GROUP_LABELS,
  formatShortcutDisplay,
  getShortcut,
  type CommandDefinition,
  type CommandGroup,
} from '../commands/registry';

const props = defineProps<{
  open: boolean;
  executeCommand: (commandId: string, source: 'palette') => Promise<boolean> | boolean;
  customShortcuts: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

// 仅取可在面板触发的命令
const paletteCommands = COMMANDS.filter((c) => c.palette !== false);

const query = ref('');
const activeIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

interface GroupedEntry {
  group: CommandGroup;
  label: string;
  items: { cmd: CommandDefinition; index: number }[];
}

const filtered = computed<CommandDefinition[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return paletteCommands;
  return paletteCommands.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q),
  );
});

const grouped = computed<GroupedEntry[]>(() => {
  const result: GroupedEntry[] = [];
  filtered.value.forEach((cmd, index) => {
    let entry = result.find((g) => g.group === cmd.group);
    if (!entry) {
      entry = { group: cmd.group, label: GROUP_LABELS[cmd.group], items: [] };
      result.push(entry);
    }
    entry.items.push({ cmd, index });
  });
  return result;
});

watch(query, () => {
  activeIndex.value = 0;
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      query.value = '';
      activeIndex.value = 0;
      nextTick(() => inputRef.value?.focus());
    }
  },
);

function shortcutOf(cmd: CommandDefinition): string | null {
  const s = getShortcut(cmd, props.customShortcuts);
  return s ? formatShortcutDisplay(s) : null;
}

function scrollActiveIntoView() {
  nextTick(() => {
    const el = listRef.value?.querySelector<HTMLElement>(
      `[data-cmd-index="${activeIndex.value}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  });
}

function onMove(delta: number) {
  const len = filtered.value.length;
  if (len === 0) return;
  activeIndex.value = (activeIndex.value + delta + len) % len;
  scrollActiveIntoView();
}

async function onEnter() {
  const cmd = filtered.value[activeIndex.value];
  if (!cmd) return;
  const ok = await props.executeCommand(cmd.id, 'palette');
  if (ok) emit('close');
}

function onClickItem(index: number) {
  activeIndex.value = index;
  void onEnter();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    onMove(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    onMove(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    void onEnter();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="palette">
      <div v-if="open" class="palette-overlay" @click.self="emit('close')">
        <div class="palette-dialog" @keydown="onKeydown">
          <div class="palette-search">
            <svg class="palette-search-icon" width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="6" cy="6" r="4.5" />
              <line x1="9.5" y1="9.5" x2="14" y2="14" />
            </svg>
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              class="palette-input"
              placeholder="搜索命令…"
              spellcheck="false"
            />
            <span class="palette-hint">Esc 关闭</span>
          </div>

          <div class="palette-list" ref="listRef">
            <template v-if="filtered.length > 0">
              <div v-for="g in grouped" :key="g.group" class="palette-group">
                <div class="palette-group-label">{{ g.label }}</div>
                <button
                  v-for="item in g.items"
                  :key="item.cmd.id"
                  class="palette-item"
                  :class="{ 'is-active': item.index === activeIndex }"
                  :data-cmd-index="item.index"
                  @mousemove="activeIndex = item.index"
                  @click="onClickItem(item.index)"
                >
                  <span class="palette-item-title">{{ item.cmd.title }}</span>
                  <span class="palette-item-desc">{{ item.cmd.description }}</span>
                  <span v-if="shortcutOf(item.cmd)" class="palette-item-kbd">{{
                    shortcutOf(item.cmd)
                  }}</span>
                </button>
              </div>
            </template>
            <div v-else class="palette-empty">无匹配命令</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 600;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 14vh;
  background: var(--modal-overlay);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.palette-dialog {
  width: 560px;
  max-width: calc(100vw - 32px);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--popover-bg);
  border: 1px solid var(--popover-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--popover-shadow);
  overflow: hidden;
}

.palette-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-light);
}

.palette-search-icon {
  flex-shrink: 0;
  color: var(--muted-color);
  opacity: 0.7;
}

.palette-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-color);
  font-size: 15px;
  font-family: inherit;
  outline: none;
  caret-color: var(--accent-color);
}

.palette-input::placeholder {
  color: var(--muted-color);
  opacity: 0.6;
}

.palette-hint {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted-color);
  opacity: 0.7;
}

.palette-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.palette-group {
  margin-bottom: 4px;
}

.palette-group-label {
  padding: 8px 10px 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-color);
  opacity: 0.8;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: background-color var(--motion-fast), color var(--motion-fast);
}

.palette-item.is-active {
  background-color: var(--active-bg);
  color: var(--text-color);
}

.palette-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  flex-shrink: 0;
}

.palette-item-desc {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-item-kbd {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 4px;
  padding: 2px 6px;
  white-space: nowrap;
}

.palette-empty {
  padding: 28px 10px;
  text-align: center;
  font-size: 13px;
  color: var(--muted-color);
}

/* ── 进出场动画 ── */
.palette-enter-active,
.palette-leave-active {
  transition: opacity var(--motion-base) var(--ease-out);
}
.palette-enter-active .palette-dialog,
.palette-leave-active .palette-dialog {
  transition: transform var(--motion-base) var(--ease-out), opacity var(--motion-base) var(--ease-out);
}
.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}
.palette-enter-from .palette-dialog,
.palette-leave-to .palette-dialog {
  transform: translateY(-8px) scale(0.98);
  opacity: 0;
}
</style>
