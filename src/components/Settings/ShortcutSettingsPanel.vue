<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import type { ShortcutDef } from '../../utils/shortcuts';
import './settings-shared.css';

interface ShortcutGroup {
  name: string;
  items: ShortcutDef[];
}

defineProps<{
  conflictWarning: string | null;
  editingId: string | null;
  editingKey: string;
  formatShortcutDisplay: (shortcut: string) => string;
  isDefaultShortcut: (item: ShortcutDef) => boolean;
  isMac: boolean;
  setCaptureInputRef: (el: Element | ComponentPublicInstance | null) => void;
  shortcutGroups: ShortcutGroup[];
}>();

defineEmits<{
  resetAll: [];
  resetShortcut: [item: ShortcutDef];
  startEdit: [item: ShortcutDef];
  cancelEdit: [];
  captureKeydown: [event: KeyboardEvent, item: ShortcutDef];
}>();
</script>

<template>
  <div class="shortcut-settings-panel">
    <section class="settings-section-card settings-section-card--hero">
      <div class="shortcut-settings-panel__hint">
        {{ isMac ? 'Mac 使用 ⌘ 键' : 'Windows/Linux 使用 Ctrl 键' }} · 点击行可修改快捷键
      </div>
      <button
        class="shortcut-settings-panel__reset"
        @click="$emit('resetAll')"
      >
        重置全部
      </button>
    </section>

    <section v-if="conflictWarning" class="settings-section-card settings-warning-card">
      <div class="settings-warning-text">⚠️ {{ conflictWarning }}</div>
    </section>

    <section v-for="group in shortcutGroups" :key="group.name" class="settings-section-card">
      <div class="settings-section-heading">
        <div class="settings-section-title">{{ group.name }}</div>
      </div>
      <div class="shortcut-settings-panel__list">
        <div
          v-for="item in group.items"
          :key="item.id"
          class="shortcut-settings-panel__item"
          :class="{ 'shortcut-settings-panel__item--editing': editingId === item.id }"
          @click="$emit('startEdit', item)"
        >
          <span class="shortcut-settings-panel__description">
            {{ item.description }}
          </span>

          <div class="shortcut-settings-panel__controls">
            <button
              v-if="!isDefaultShortcut(item)"
              class="shortcut-settings-panel__item-reset"
              title="重置为默认"
              @click.stop="$emit('resetShortcut', item)"
            >
              ↺
            </button>

            <input
              v-if="editingId === item.id"
              :ref="setCaptureInputRef"
              type="text"
              readonly
              data-shortcut-capture="true"
              :value="formatShortcutDisplay(editingKey)"
              class="shortcut-input editing"
              placeholder="按下..."
              @keydown="$emit('captureKeydown', $event, item)"
              @blur="$emit('cancelEdit')"
            />

            <div v-else class="shortcut-input" :class="{ custom: !isDefaultShortcut(item) }">
              {{ formatShortcutDisplay(item.shortcut) }}
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.shortcut-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.settings-warning-card {
  padding: 14px 16px;
  border-color: var(--warning-color);
  background: var(--warning-bg);
}

.settings-warning-text {
  color: var(--warning-color);
  font-size: 13px;
  font-weight: 600;
}

.shortcut-settings-panel__hint {
  color: var(--muted-color);
  font-size: 14px;
}

.shortcut-settings-panel__reset {
  font-size: 12px;
  color: var(--primary-color);
}

.shortcut-settings-panel__list {
  display: grid;
  gap: 6px;
}

.shortcut-settings-panel__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background-color: var(--sidebar-bg);
  cursor: pointer;
  transition:
    background-color 0.15s,
    outline-color 0.15s;
}

.shortcut-settings-panel__item--editing {
  background-color: color-mix(in srgb, var(--primary-color) 8%, transparent);
  outline: 2px solid var(--primary-color);
}

.shortcut-settings-panel__description {
  font-size: 14px;
  color: var(--text-color);
}

.shortcut-settings-panel__controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.shortcut-settings-panel__item-reset {
  display: flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--muted-color);
  font-size: 12px;
  transition:
    background-color 0.15s,
    color 0.15s;
}

.shortcut-settings-panel__item-reset:hover {
  background: var(--hover-bg);
  color: var(--text-secondary);
}

.shortcut-input {
  min-width: 100px;
  height: 30px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-color);
  text-align: center;
  white-space: nowrap;
  letter-spacing: 0.5px;
}

.shortcut-input.custom {
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.shortcut-input.editing {
  background: color-mix(in srgb, var(--primary-color) 8%, transparent);
  border-color: var(--primary-color);
  color: var(--primary-color);
  outline: none;
}
</style>
