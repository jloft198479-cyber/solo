<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { FONT_OPTIONS } from '../constants/fonts';
import { isFontAvailable } from '../services/fontLoader';
import CheckIcon from './icons/CheckIcon.vue';
import './popover-shared.css';

const settingsStore = useSettingsStore();

defineProps<{ isActive: boolean }>();
const emit = defineEmits<{ (e: 'toggle'): void; (e: 'select'): void }>();

const fontOptions = FONT_OPTIONS;
const currentFont = computed(() => settingsStore.settings.fontFamily);

/** 已下载的字体集合（CSS family → 是否已下载） */
const availableFonts = ref<Record<string, boolean>>({});

onMounted(async () => {
  const map: Record<string, boolean> = {};
  for (const opt of fontOptions) {
    map[opt.value] = await isFontAvailable(opt.value);
  }
  availableFonts.value = map;
});

async function selectFont(value: string) {
  const available = await isFontAvailable(value);
  if (!available) {
    // 未下载的字体先触以下载（ensureFontLoaded 被 useEditorAppearance 调用，
    // 但 settings 已经更新了，所以先更新再让 watcher 去下载）
    settingsStore.updateSetting('fontFamily', value);
    // 标记为等待中
    availableFonts.value[value] = false;
    emit('select');
  } else {
    settingsStore.updateSetting('fontFamily', value);
    emit('select');
  }
}
</script>

<template>
  <div class="quick-action-item">
    <button class="icon-btn" title="字体" @click.stop="emit('toggle')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 2.7v10.6" />
        <path d="M2.7 4.7V3.3a.7.7 0 0 1 .7-.7h9.2a.7.7 0 0 1 .7.7v1.4" />
        <path d="M6 13.3h4" />
      </svg>
    </button>
    <Transition name="quick-popover">
      <div v-if="isActive" class="quick-popover">
        <div class="quick-popover-header">字体</div>
        <div class="quick-popover-list">
          <button
            v-for="opt in fontOptions"
            :key="opt.value"
            class="quick-popover-option"
            :class="{ 'is-active': opt.value === currentFont }"
            @click="selectFont(opt.value)"
          >
            <span class="font-preview" :style="{ fontFamily: opt.value }">永</span>
            <span class="quick-popover-label">
              {{ opt.label }}
              <span v-if="opt.downloadUrl && !availableFonts[opt.value]" class="font-dl-badge">下载</span>
            </span>
            <CheckIcon v-if="opt.value === currentFont" class="check-icon" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.font-preview {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--hover-bg);
  border-radius: 5px;
  flex-shrink: 0;
}

.font-dl-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 0 5px;
  font-size: 10px;
  line-height: 1.6;
  border-radius: 3px;
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
  color: var(--primary-color);
  vertical-align: middle;
  font-weight: 500;
}
</style>
