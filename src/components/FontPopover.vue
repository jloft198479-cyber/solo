<script setup lang="ts">
import { computed, onUnmounted } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { FONT_OPTIONS } from '../constants/fonts';
import { useFontStatus } from '../composables/useFontStatus';
import Icon from './icons/Icon';
import './popover-shared.css';

const settingsStore = useSettingsStore();

defineProps<{ isActive: boolean }>();
const emit = defineEmits<{ (e: 'toggle'): void; (e: 'select'): void }>();

const fontOptions = FONT_OPTIONS;
const currentFont = computed(() => settingsStore.settings.fontFamily);

const { available, failed, downloadPct, clearDownload, onSettled } = useFontStatus();

/** 当前字体下载落定后，弹窗的收尾停留（ms）：让满格进度条留一瞬再关 */
const SETTLE_HOLD_MS = 600;
let selectTimer: ReturnType<typeof setTimeout> | null = null;

onSettled((family) => {
  if (currentFont.value === family) {
    selectTimer = setTimeout(() => {
      clearDownload(family);
      emit('select');
    }, SETTLE_HOLD_MS);
  } else {
    clearDownload(family);
  }
});

onUnmounted(() => {
  if (selectTimer) clearTimeout(selectTimer);
});

function selectFont(value: string) {
  settingsStore.updateSetting('fontFamily', value);
  // 已可用的字体：立即关闭弹窗；需下载的：弹窗保持打开，看进度条
  if (available.value[value] !== false) {
    emit('select');
  }
}
</script>

<template>
  <div class="quick-action-item">
    <button class="ghost-icon-btn" title="正文字体" @click.stop="emit('toggle')">
      <Icon name="type" :size="14" />
    </button>
    <Transition name="quick-popover">
      <div v-if="isActive" class="quick-popover">
        <div class="quick-popover-header">正文字体</div>
        <div class="quick-popover-list">
          <button
            v-for="opt in fontOptions"
            :key="opt.value"
            class="quick-popover-option"
            :class="{ 'is-active': opt.value === currentFont }"
            @click="selectFont(opt.value)"
          >
            <span class="quick-popover-label">
              {{ opt.label }}
              <template v-if="downloadPct[opt.value] !== undefined">
                <span class="font-dl-badge font-dl-badge--active">下载中</span>
              </template>
              <template v-else-if="failed[opt.value]">
                <span class="font-dl-badge font-dl-badge--fail">下载失败</span>
              </template>
              <template v-else-if="opt.fileName && !available[opt.value]">
                <span class="font-dl-badge">需下载</span>
              </template>
            </span>
            <Icon v-if="opt.value === currentFont" name="check" :size="14" class="check-icon" />
          </button>
          <!-- 进度条 -->
          <div
            v-for="opt in fontOptions"
            v-show="downloadPct[opt.value] !== undefined"
            :key="'bar-' + opt.value"
            class="font-progress-track"
            :class="{ 'is-indeterminate': downloadPct[opt.value] === 0 }"
          >
            <div
              v-if="downloadPct[opt.value]"
              class="font-progress-bar"
              :style="{ width: downloadPct[opt.value] + '%' }"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.font-dl-badge {
  display: inline-block;
  margin-left: var(--space-xs);
  padding: 0 5px;
  font-size: 10px;
  line-height: 1.6;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--muted-color) 12%, transparent);
  color: var(--muted-color);
  vertical-align: middle;
  font-weight: 500;
}

.font-dl-badge--fail {
  background: color-mix(in srgb, var(--error-color) 12%, transparent);
  color: var(--error-color);
}

.font-dl-badge--active {
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
  color: var(--primary-color);
}

.font-progress-track {
  height: 2px;
  margin: 0 12px 4px;
  border-radius: var(--radius-pill);
  background: var(--border-color);
  overflow: hidden;
}

.font-progress-bar {
  height: 100%;
  background: var(--primary-color);
  border-radius: var(--radius-pill);
  transition: width var(--motion-slow) ease;
}

.font-progress-track.is-indeterminate {
  position: relative;
  overflow: hidden;
}

.font-progress-track.is-indeterminate::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 30%, var(--primary-color) 50%, transparent 70%);
  animation: font-indeterminate 1.2s infinite ease-in-out;
}

@keyframes font-indeterminate {
  0% { transform: translateX(-33%); }
  100% { transform: translateX(100%); }
}
</style>
