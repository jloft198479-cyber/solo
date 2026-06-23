<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { FONT_OPTIONS } from '../../constants/fonts';

const model = defineModel<string>({ required: true });

const fontOptions = FONT_OPTIONS;

// 检测字体是否可用（使用 document.fonts API + canvas 双重检测）
const unavailableFonts = ref<Set<string>>(new Set());

async function checkFontAvailability(fontFamily: string): Promise<boolean> {
  if (fontFamily === 'system-ui') return true;

  // 方法1: document.fonts.check（如果浏览器支持）
  if (document.fonts?.check) {
    // 用足够多的字符触发字体匹配
    const testStr = `a中字${fontFamily}`;
    if (document.fonts.check(`16px "${fontFamily}"`, testStr)) {
      return true;
    }
    // 等待字体加载完成再检查一次
    try {
      await document.fonts.ready;
      if (document.fonts.check(`16px "${fontFamily}"`, testStr)) {
        return true;
      }
    } catch { /* fallback */ }
  }

  // 方法2: canvas 宽度比较
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const testStr = '测试字体FontAvail测';
  const fallbackFont = 'monospace';

  ctx.font = `72px "${fontFamily}", ${fallbackFont}`;
  const widthWithFont = ctx.measureText(testStr).width;
  ctx.font = `72px ${fallbackFont}`;
  const widthWithFallback = ctx.measureText(testStr).width;

  // 用较大字号和较长文本提高区分度
  return Math.abs(widthWithFont - widthWithFallback) > 1;
}

onMounted(async () => {
  const unavailable = new Set<string>();
  await document.fonts.ready;
  for (const opt of fontOptions) {
    const available = await checkFontAvailability(opt.value);
    if (!available) {
      unavailable.add(opt.value);
    }
  }
  unavailableFonts.value = unavailable;
});
</script>

<template>
  <div class="settings-font-select">
    <label class="settings-font-select__label">字体族</label>
    <select v-model="model" class="settings-font-select__input">
      <option v-for="opt in fontOptions" :key="opt.value" :value="opt.value">
        {{ opt.label }}{{ unavailableFonts.has(opt.value) ? '（未安装）' : '' }}
      </option>
    </select>
    <p v-if="unavailableFonts.size > 0" class="settings-font-select__hint">
      标记"未安装"的字体需先安装到系统后才能生效
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
