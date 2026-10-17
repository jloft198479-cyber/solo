<script setup lang="ts">
import type { Theme } from '../../themes/types';
import ThemePreview from './ThemePreview.vue';
import Icon from '../icons/Icon';

defineProps<{
  theme: Theme;
  active: boolean;
  removable: boolean;
}>();

const emit = defineEmits<{
  (e: 'select'): void;
  (e: 'delete'): void;
}>();
</script>

<template>
  <div class="theme-card" :class="{ 'theme-card--active': active }" @click="emit('select')">
    <ThemePreview :theme="theme" />

    <div class="theme-info">
      <div class="theme-name-row">
        <span class="theme-name">{{ theme.name }}</span>
        <span v-if="theme.type === 'custom'" class="theme-badge">自定义</span>
      </div>
    </div>

    <button
      v-if="removable"
      class="theme-delete-btn"
      title="删除主题"
      @click.stop="emit('delete')"
    >
      <Icon name="close" :size="14" class="theme-delete-icon" />
    </button>

    <div v-if="active" class="theme-active-indicator">
      <Icon name="check" :size="14" class="theme-active-icon" />
    </div>
  </div>
</template>

<style scoped>
.theme-card {
  position: relative;
  padding: 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  cursor: pointer;
  transition: border-color var(--motion-fast), background-color var(--motion-fast), transform var(--motion-fast);
}

.theme-card:hover {
  border-color: var(--primary-color);
  background: var(--hover-bg);
}

.theme-card--active {
  border-color: var(--primary-color);
  background: var(--primary-light);
}

.theme-info {
  margin-top: 8px;
}

.theme-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.theme-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color);
}

.theme-badge {
  font-size: 10px;
  padding: 2px 6px;
  /* 文字标签走直角语言（非拟物控件） */
  border-radius: var(--radius-sm);
  background: var(--primary-light);
  color: var(--primary-color);
}

.theme-delete-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--error-color);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--motion-fast), background-color var(--motion-fast);
}

.theme-card:hover .theme-delete-btn {
  opacity: 1;
}

/* 键盘焦点时也要显形（原仅 hover 显形；设计规范化 2026-10-17 · B5） */
.theme-delete-btn:focus-visible {
  opacity: 1;
}

.theme-delete-btn:hover {
  background: var(--error-bg);
}

.theme-delete-icon {
  width: 14px;
  height: 14px;
}

.theme-active-indicator {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--primary-color);
}

.theme-active-icon {
  width: 14px;
  height: 14px;
  color: var(--btn-primary-text);
}
</style>
