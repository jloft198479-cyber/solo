<script setup lang="ts">
import { WECHAT_THEMES } from '../../utils/wechat-themes';

const model = defineModel<string>({ required: true });

const FOLLOW_EDITOR = 'follow-editor';
</script>

<template>
  <div class="wechat-theme-grid">
    <!-- 跟随编辑器主题 -->
    <button
      class="wechat-theme-card wechat-theme-card--follow"
      :class="{ 'wechat-theme-card--active': model === FOLLOW_EDITOR }"
      @click="model = FOLLOW_EDITOR"
    >
      <div class="wechat-theme-card__header">
        <span class="wechat-theme-card__dot" :style="{ background: 'var(--primary-color)' }" />
        <span class="wechat-theme-card__name">跟随当前主题</span>
      </div>
      <div class="wechat-theme-card__desc">导出配色与编辑器所见一致</div>
    </button>

    <button
      v-for="theme in WECHAT_THEMES"
      :key="theme.id"
      class="wechat-theme-card"
      :class="{ 'wechat-theme-card--active': model === theme.id }"
      @click="model = theme.id"
    >
      <div class="wechat-theme-card__header">
        <span class="wechat-theme-card__dot" :style="{ backgroundColor: theme.colors.primary }" />
        <span class="wechat-theme-card__name">
          {{ theme.name }}
        </span>
      </div>
      <div class="wechat-theme-card__swatches">
        <span class="wechat-theme-card__swatch" :style="{ backgroundColor: theme.colors.primary }" />
        <span
          class="wechat-theme-card__swatch"
          :style="{ backgroundColor: theme.colors.primaryDark }"
        />
        <span class="wechat-theme-card__swatch" :style="{ backgroundColor: theme.colors.codeBg }" />
      </div>
    </button>
  </div>
</template>

<style scoped>
.wechat-theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.wechat-theme-card {
  padding: 12px;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background-color 0.15s;
}

.wechat-theme-card:hover {
  border-color: var(--text-muted);
}

.wechat-theme-card--active {
  border-color: var(--primary-color);
  background-color: color-mix(in srgb, var(--primary-color) 8%, transparent);
}

.wechat-theme-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.wechat-theme-card__dot {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  flex-shrink: 0;
}

.wechat-theme-card__name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
}

.wechat-theme-card__desc {
  font-size: 11px;
  color: var(--muted-color);
  line-height: 1.4;
  margin-left: 24px;
}

.wechat-theme-card__swatches {
  display: flex;
  gap: 4px;
  margin-left: 24px;
}

.wechat-theme-card__swatch {
  width: 24px;
  height: 8px;
  border-radius: 4px;
}
</style>
