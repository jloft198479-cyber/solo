<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { FONT_OPTIONS } from '../../constants/fonts';
import { isFontAvailable } from '../../services/fontLoader';

const model = defineModel<string>({ required: true });

const fontOptions = FONT_OPTIONS;

/** 字体可用状态：true=可用(已安装/已下载)，false=需下载，'loading'=下载中 */
const fontStatus = ref<Record<string, boolean | 'loading'>>({});

onMounted(async () => {
  for (const opt of fontOptions) {
    fontStatus.value[opt.value] = await isFontAvailable(opt.value);
  }
});

async function onSelect(value: string) {
  if (fontStatus.value[value] === true) {
    // 已可用，直接选中
    model.value = value;
    return;
  }
  // 需要下载
  fontStatus.value[value] = 'loading';
  // 更新 model 触发 useEditorAppearance 的 watcher 去下载
  model.value = value;
}
</script>

<template>
  <div class="settings-font-select">
    <label class="settings-font-select__label">字体族</label>
    <select v-model="model" class="settings-font-select__input" @change="onSelect(model)">
      <option v-for="opt in fontOptions" :key="opt.value" :value="opt.value">
        {{ opt.label }}
        <template v-if="fontStatus[opt.value] === 'loading'">（下载中…）</template>
        <template v-else-if="opt.downloadUrl && fontStatus[opt.value] === false">（需下载）</template>
      </option>
    </select>
    <p class="settings-font-select__hint">
      文艺字体需首次使用后缓存到本地，之后可离线使用
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

.settings-font-select__input {
  width: 100%;
  margin-top: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background-color: var(--bg-color);
  color: var(--text-color);
  font-size: 14px;
}

.settings-font-select__input:focus {
  border-color: transparent;
  outline: none;
  box-shadow: 0 0 0 2px var(--primary-color);
}

.settings-font-select__hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted-color);
}
</style>
