<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { FONT_OPTIONS } from '../constants/fonts';
import { isFontAvailable, isFontFailed, onProgress } from '../services/fontLoader';
import CheckIcon from './icons/CheckIcon.vue';
import './popover-shared.css';

const settingsStore = useSettingsStore();

defineProps<{ isActive: boolean }>();
const emit = defineEmits<{ (e: 'toggle'): void; (e: 'select'): void }>();

const fontOptions = FONT_OPTIONS;
const currentFont = computed(() => settingsStore.settings.fontFamily);

const fontStatus = ref<Record<string, boolean>>({});
const fontFailed = ref<Record<string, boolean>>({});

async function refreshStatus() {
  const results = await Promise.all(fontOptions.map(opt => isFontAvailable(opt.value)));
  for (let i = 0; i < fontOptions.length; i++) {
    fontStatus.value[fontOptions[i].value] = results[i];
    fontFailed.value[fontOptions[i].value] = isFontFailed(fontOptions[i].value);
  }
}

onMounted(refreshStatus);

const progressing = ref<Record<string, number>>({});

const unsub = onProgress((family, pct) => {
  if (pct >= 0) {
    progressing.value[family] = pct;
  } else {
    progressing.value[family] = 100;
    isFontAvailable(family).then((ok) => {
      fontStatus.value[family] = ok;
      fontFailed.value[family] = !ok && isFontFailed(family);
      if (currentFont.value === family) {
        setTimeout(() => {
          delete progressing.value[family];
          emit('select');
        }, 600);
      } else {
        delete progressing.value[family];
      }
    });
  }
});

onUnmounted(unsub);

function selectFont(value: string) {
  settingsStore.updateSetting('fontFamily', value);
  // 已可用的字体：立即关闭弹窗；需下载的：弹窗保持打开，看进度条
  if (fontStatus.value[value] !== false) {
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
            <span class="quick-popover-label">
              {{ opt.label }}
              <template v-if="progressing[opt.value] !== undefined">
                <span class="font-dl-badge font-dl-badge--active">下载中</span>
              </template>
              <template v-else-if="fontFailed[opt.value]">
                <span class="font-dl-badge font-dl-badge--fail">下载失败</span>
              </template>
              <template v-else-if="opt.downloadUrl && !fontStatus[opt.value]">
                <span class="font-dl-badge">需下载</span>
              </template>
            </span>
            <CheckIcon v-if="opt.value === currentFont" class="check-icon" />
          </button>
          <!-- 进度条 -->
          <div
            v-for="opt in fontOptions"
            v-show="progressing[opt.value] !== undefined && progressing[opt.value] >= 0"
            :key="'bar-' + opt.value"
            class="font-progress-track"
            :class="{ 'is-indeterminate': progressing[opt.value] === 0 }"
          >
            <div
              v-if="progressing[opt.value] > 0"
              class="font-progress-bar"
              :style="{ width: progressing[opt.value] + '%' }"
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
  margin-left: 4px;
  padding: 0 5px;
  font-size: 10px;
  line-height: 1.6;
  border-radius: 3px;
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
  border-radius: 1px;
  background: var(--border-color);
  overflow: hidden;
}

.font-progress-bar {
  height: 100%;
  background: var(--primary-color);
  border-radius: 1px;
  transition: width 0.3s ease;
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
