<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { FONT_OPTIONS } from '../../constants/fonts';
import { isFontAvailable, onProgress } from '../../services/fontLoader';

const model = defineModel<string>({ required: true });
const fontOptions = FONT_OPTIONS;

const fontStatus = ref<Record<string, boolean | 'loading'>>({});
const progressPct = ref<Record<string, number>>({});

onMounted(async () => {
  const results = await Promise.all(fontOptions.map(opt => isFontAvailable(opt.value)));
  for (let i = 0; i < fontOptions.length; i++) {
    fontStatus.value[fontOptions[i].value] = results[i];
  }
});

const unsub = onProgress((family, pct) => {
  if (pct >= 0) {
    progressPct.value[family] = pct;
    fontStatus.value[family] = 'loading';
  } else {
    delete progressPct.value[family];
    isFontAvailable(family).then((ok) => { fontStatus.value[family] = ok; });
  }
});

onUnmounted(unsub);

async function onSelect(value: string) {
  model.value = value;
}
</script>

<template>
  <div class="settings-font-select">
    <label class="settings-font-select__label">字体族</label>
    <div class="settings-font-select-wrap">
      <select v-model="model" class="settings-font-select__input" @change="onSelect(model)">
        <option v-for="opt in fontOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
          <template v-if="fontStatus[opt.value] === 'loading'">（下载中 {{ progressPct[opt.value] ?? 0 }}%）</template>
          <template v-else-if="opt.downloadUrl && fontStatus[opt.value] === false">（需下载）</template>
        </option>
      </select>
      <div
        v-if="Object.keys(progressPct).length > 0"
        class="font-progress-track"
      >
        <div
          class="font-progress-bar"
          :style="{ width: (Object.values(progressPct)[0] ?? 0) + '%' }"
        />
      </div>
    </div>
    <p class="settings-font-select__hint">
      文艺字体在首次选择后开始下载，缓存到本地后可离线使用
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
  margin-top: 8px;
}

.settings-font-select__input {
  width: 100%;
  padding: 8px 12px;
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
  margin-top: 6px;
  height: 3px;
  border-radius: 2px;
  background: var(--border-color);
  overflow: hidden;
}

.font-progress-bar {
  height: 100%;
  background: var(--primary-color);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.settings-font-select__hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted-color);
}
</style>
