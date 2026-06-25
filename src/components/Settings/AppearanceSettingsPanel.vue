<script setup lang="ts">
import SettingsFontSelect from './SettingsFontSelect.vue';
import SettingsRangeField from './SettingsRangeField.vue';
import ThemeSelector from './ThemeSelector.vue';
import './settings-shared.css';

defineProps<{
  currentThemeName: string;
}>();

const fontSize = defineModel<number>('fontSize', { required: true });
const fontFamily = defineModel<string>('fontFamily', { required: true });
const lineHeight = defineModel<number>('lineHeight', { required: true });
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
        <div class="settings-hero-chip">字号：{{ fontSize }}px</div>
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
        <SettingsRangeField
          v-model="fontSize"
          class="settings-form-item"
          label="字体大小"
          :min="12"
          :max="24"
          :step="1"
          value-suffix="px"
          min-label="12px"
          max-label="24px"
        />

        <SettingsFontSelect v-model="fontFamily" class="settings-form-item" />

        <SettingsRangeField
          v-model="lineHeight"
          class="settings-form-item"
          label="行高"
          :min="1.2"
          :max="2.4"
          :step="0.1"
        />
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

@media (max-width: 960px) {
  .settings-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
