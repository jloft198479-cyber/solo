<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { FONT_OPTIONS } from '../constants/fonts';
import CheckIcon from './icons/CheckIcon.vue';
import './popover-shared.css';

const settingsStore = useSettingsStore();

defineProps<{ isActive: boolean }>();
const emit = defineEmits<{ (e: 'toggle'): void; (e: 'select'): void }>();

const fontOptions = FONT_OPTIONS;
const currentFont = computed(() => settingsStore.settings.fontFamily);

function selectFont(value: string) {
  settingsStore.updateSetting('fontFamily', value);
  emit('select');
}
</script>

<template>
  <div class="quick-action-item">
    <button class="icon-btn" title="字体" @click.stop="emit('toggle')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 13L8 3l4 10" />
        <path d="M5.3 9.5h5.4" />
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
            <span class="quick-popover-label">{{ opt.label }}</span>
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
</style>
