<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '../stores/settings';
import Icon from './icons/Icon';
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
      <Icon name="grid" :size="14" />
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
            <span
              class="theme-swatch"
              :style="{
                backgroundColor:
                  t.appearance === 'dark'
                    ? t.colors.bgColor
                    : t.colors.accentColor || t.colors.primaryColor,
                borderColor: t.colors.borderColor,
              }"
            />
            <span class="quick-popover-label">{{ t.name }}</span>
            <Icon v-if="t.id === currentThemeId" name="check" :size="14" class="check-icon" />
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
}
</style>
