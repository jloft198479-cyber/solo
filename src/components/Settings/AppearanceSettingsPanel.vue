<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import SettingsFontSelect from './SettingsFontSelect.vue';
import SettingsRangeField from './SettingsRangeField.vue';
import ThemeSelector from './ThemeSelector.vue';
import './settings-shared.css';

defineProps<{
  currentThemeName: string;
}>();

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

/** Effective lineHeight: user value → theme typography → CSS default (1.9) */
const effectiveLineHeight = computed({
  get: () => {
    if (settingsStore.settings.lineHeight != null) return settingsStore.settings.lineHeight;
    const raw = settingsStore.currentTheme?.typography?.lineHeight;
    return raw ? parseFloat(raw) : 1.9;
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
    <section class="settings-section-card settings-section-card--hero">
      <div>
        <div class="settings-section-title">当前主题</div>
        <p class="settings-section-desc">
          主题选择会立即生效。默认先从主题库里挑选风格，只有在需要个性化时再进入高级编辑。
        </p>
      </div>
      <div class="settings-hero-metrics">
        <div class="settings-hero-chip">应用主题：{{ currentThemeName }}</div>
        <div class="settings-hero-chip">字体：{{ fontFamily }}</div>
        <div class="settings-hero-chip">字号：{{ effectiveFontSize }}px</div>
      </div>
    </section>

    <section class="settings-section-card">
      <div class="settings-section-heading">
        <div>
          <div class="settings-section-title">主题库</div>
          <p class="settings-section-desc">所有主题默认直接展示，方便快速横向比较。</p>
        </div>
      </div>
      <ThemeSelector />
    </section>

    <section class="settings-section-card">
      <div class="settings-section-heading">
        <div>
          <div class="settings-section-title">排版与阅读</div>
          <p class="settings-section-desc">统一控制字体、字号和行高，保持写作与阅读体验协调。</p>
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
  transition: background-color 0.15s, color 0.15s;
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
