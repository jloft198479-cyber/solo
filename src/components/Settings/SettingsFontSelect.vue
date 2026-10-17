<script setup lang="ts">
import { FONT_OPTIONS } from '../../constants/fonts';
import { useFontStatus } from '../../composables/useFontStatus';

const model = defineModel<string>({ required: true });
const fontOptions = FONT_OPTIONS;

const { available, failed, downloadPct, clearDownload, onSettled } = useFontStatus();

// 设置页不需要弹窗那种满格停留：落定即收进度条（失败态由 failed 接棒显示）
onSettled((family) => clearDownload(family));
</script>

<template>
  <div class="settings-font-select">
    <label class="settings-font-select__label">正文字体</label>
    <div class="settings-font-select-wrap">
      <select v-model="model" class="settings-font-select__input">
        <option v-for="opt in fontOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
          <template v-if="downloadPct[opt.value] !== undefined">（下载中 {{ downloadPct[opt.value] }}%）</template>
          <template v-else-if="failed[opt.value]">（下载失败）</template>
          <template v-else-if="opt.fileName && available[opt.value] === false">（需下载）</template>
        </option>
      </select>
      <div
        v-if="Object.keys(downloadPct).length > 0"
        class="font-progress-track"
      >
        <div
          class="font-progress-bar"
          :style="{ width: (Object.values(downloadPct)[0] ?? 0) + '%' }"
        />
      </div>
    </div>
    <p class="settings-font-select__hint">
      只作用于文章正文，界面字体跟随系统。文艺字体在首次选择后开始下载，缓存到本地后可离线使用
    </p>
  </div>
</template>

<style scoped>
.settings-font-select {
  min-width: 0;
}

.settings-font-select__label {
  display: block;
  color: var(--text-color);
  font-size: 14px;
  font-weight: 500;
}

.settings-font-select-wrap {
  margin-top: var(--space-md);
}

.settings-font-select__input {
  width: 100%;
  padding: var(--space-md) var(--space-lg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background-color: var(--bg-color);
  color: var(--text-color);
  font-size: 14px;
}

.settings-font-select__input:focus {
  border-color: transparent;
  outline: none;
  box-shadow: 0 0 0 2px var(--primary-color);
}

.font-progress-track {
  margin-top: var(--space-sm);
  height: 3px;
  border-radius: 2px;
  background: var(--border-color);
  overflow: hidden;
}

.font-progress-bar {
  height: 100%;
  background: var(--primary-color);
  border-radius: 2px;
  transition: width var(--motion-slow) ease;
}

.settings-font-select__hint {
  margin-top: var(--space-sm);
  font-size: 12px;
  color: var(--muted-color);
}
</style>
