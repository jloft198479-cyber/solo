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
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 14a.7.7 0 0 1 0-14 6.7 6 0 0 1 6.7 6 3.3 3.3 0 0 1-3.4 3.3H9.8a1.2 1.2 0 0 0-.9 1.9l.2.3a1.2 1.2 0 0 1-.9 1.9z" />
        <circle cx="9" cy="4.3" r=".4" fill="currentColor" stroke="none" />
        <circle cx="11.6" cy="7" r=".4" fill="currentColor" stroke="none" />
        <circle cx="4.3" cy="8.3" r=".4" fill="currentColor" stroke="none" />
        <circle cx="5.6" cy="5" r=".4" fill="currentColor" stroke="none" />
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
