<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import SettingsFontSelect from './SettingsFontSelect.vue';
import SettingsRangeField from './SettingsRangeField.vue';
import ThemeSelector from './ThemeSelector.vue';
import './settings-shared.css';

const settingsStore = useSettingsStore();

const fontFamily = defineModel<string>('fontFamily', { required: true });

/** Effective fontSize: user value → theme typography → CSS default (16) */
const effectiveFontSize = computed({
  get: () => {
    if (settingsStore.settings.fontSize != null) return settingsStore.settings.fontSize;
    const raw = settingsStore.currentTheme?.typography?.fontSize;
    return raw ? parseFloat(raw) : 16;
  },
  set: (v: number) => {
    settingsStore.settings.fontSize = v;
  },
});

/** Effective lineHeight: user value → theme typography → CSS default (1.6) */
const effectiveLineHeight = computed({
  get: () => {
    if (settingsStore.settings.lineHeight != null) return settingsStore.settings.lineHeight;
    const raw = settingsStore.currentTheme?.typography?.lineHeight;
    return raw ? parseFloat(raw) : 1.6; // 与 editor.css --mk-line-height 保持一致（设计契约锁住，设计规范化 2026-10-17 · A4）
  },
  set: (v: number) => {
    settingsStore.settings.lineHeight = v;
  },
});

const isFontSizeCustom = computed(() => settingsStore.settings.fontSize != null);
const isLineHeightCustom = computed(() => settingsStore.settings.lineHeight != null);

function resetFontSize() {
  settingsStore.settings.fontSize = null;
}
function resetLineHeight() {
  settingsStore.settings.lineHeight = null;
}
</script>

<template>
  <div class="appearance-settings-panel">
    <section class="settings-section-card">
      <div class="settings-section-heading">
        <div>
          <div class="settings-section-title">主题库</div>
          <p class="settings-section-desc">主题选择会立即生效；所有主题默认直接展示，方便快速横向比较。</p>
        </div>
      </div>
      <ThemeSelector />
    </section>

    <section class="settings-section-card">
      <div class="settings-section-heading">
        <div>
          <div class="settings-section-title">排版与阅读</div>
          <p class="settings-section-desc">控制文章正文的字体、字号与行高，保持写作与阅读体验协调（界面字体跟随系统，不随正文变化）。</p>
        </div>
      </div>
      <div class="settings-form-grid">
        <div class="settings-form-item settings-form-item--with-reset">
          <SettingsRangeField
            v-model="effectiveFontSize"
            label="字体大小"
            :min="12"
            :max="24"
            :step="1"
            value-suffix="px"
            min-label="12px"
            max-label="24px"
          />
          <button
            v-if="isFontSizeCustom"
            class="settings-reset-btn"
            title="恢复主题默认"
            @click="resetFontSize"
          >↺</button>
        </div>

        <SettingsFontSelect v-model="fontFamily" class="settings-form-item" />

        <div class="settings-form-item settings-form-item--with-reset">
          <SettingsRangeField
            v-model="effectiveLineHeight"
            label="行高"
            :min="1.2"
            :max="2.4"
            :step="0.1"
          />
          <button
            v-if="isLineHeightCustom"
            class="settings-reset-btn"
            title="恢复主题默认"
            @click="resetLineHeight"
          >↺</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.appearance-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.settings-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.settings-form-item--with-reset {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.settings-form-item--with-reset > .settings-form-item {
  flex: 1;
  min-width: 0;
}

.settings-reset-btn {
  flex-shrink: 0;
  margin-top: 22px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted-color);
  font-size: 14px;
  cursor: pointer;
  transition: background-color var(--motion-fast), color var(--motion-fast);
}

.settings-reset-btn:hover {
  background-color: var(--hover-bg);
  color: var(--text-color);
}

@media (max-width: 960px) {
  .settings-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
