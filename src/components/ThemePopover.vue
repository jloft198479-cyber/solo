<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '../stores/settings';
import CheckIcon from './icons/CheckIcon.vue';
import './popover-shared.css';

const settingsStore = useSettingsStore();

defineProps<{ isActive: boolean }>();
const emit = defineEmits<{ (e: 'toggle'): void; (e: 'select'): void }>();

const themes = computed(() => settingsStore.allThemes);
const currentThemeId = computed(() => settingsStore.settings.activeThemeId);

function selectTheme(id: string) {
  settingsStore.setColorTheme(id);
  emit('select');
}
</script>

<template>
  <div class="quick-action-item">
    <button class="icon-btn" title="主题" @click.stop="emit('toggle')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="2" width="5" height="5" rx="1.2" />
        <rect x="9" y="2" width="5" height="5" rx="1.2" />
        <rect x="2" y="9" width="5" height="5" rx="1.2" />
        <rect x="9" y="9" width="5" height="5" rx="1.2" />
      </svg>
    </button>
    <Transition name="quick-popover">
      <div v-if="isActive" class="quick-popover">
        <div class="quick-popover-header">主题</div>
        <div class="quick-popover-list">
          <button
            v-for="t in themes"
            :key="t.id"
            class="quick-popover-option"
            :class="{ 'is-active': t.id === currentThemeId }"
            @click="selectTheme(t.id)"
          >
            <span class="theme-swatch" :style="{ backgroundColor: t.colors.bgColor, borderColor: t.colors.borderColor }">
              <span class="theme-swatch-inner" :style="{ backgroundColor: t.colors.textColor }" />
            </span>
            <span class="quick-popover-label">{{ t.name }}</span>
            <CheckIcon v-if="t.id === currentThemeId" class="check-icon" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.theme-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--border-color);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.theme-swatch-inner {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
</style>
