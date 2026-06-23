<script setup lang="ts">
import SettingsSwitch from './SettingsSwitch.vue';
import SettingsTabWidthSelector from './SettingsTabWidthSelector.vue';
import './settings-shared.css';

const spellCheck = defineModel<boolean>('spellCheck', { required: true });
const tabWidth = defineModel<number>('tabWidth', { required: true });
const titlebarAutoHide = defineModel<boolean>('titlebarAutoHide', { required: true });
</script>

<template>
  <div class="editor-settings-panel">
    <section class="settings-section-card settings-section-card--hero">
      <div>
        <div class="settings-section-title">编辑器行为</div>
        <p class="settings-section-desc">控制行号、拼写检查等核心编辑体验。</p>
      </div>
      <div class="settings-hero-metrics">
        <div class="settings-hero-chip">Tab：{{ tabWidth }} 空格</div>
        <div class="settings-hero-chip">拼写检查：{{ spellCheck ? '开启' : '关闭' }}</div>
      </div>
    </section>

    <section class="settings-section-card">
      <div class="settings-row">
        <div>
          <label class="settings-row-title">拼写检查</label>
          <p class="settings-row-desc">启用系统拼写检查</p>
        </div>
        <SettingsSwitch v-model="spellCheck" label="切换拼写检查" />
      </div>

      <div class="settings-row settings-row--column">
        <div>
          <label class="settings-row-title">Tab 宽度</label>
          <p class="settings-row-desc">控制缩进与代码块、列表的默认对齐宽度。</p>
        </div>
        <SettingsTabWidthSelector v-model="tabWidth" />
      </div>
    </section>

    <section class="settings-section-card">
      <div class="settings-row">
        <div>
          <label class="settings-row-title">标题栏自动隐藏</label>
          <p class="settings-row-desc">开启后鼠标移开顶部区域时标题栏自动隐藏，腾出更多编辑空间；关闭后标题栏始终显示。</p>
        </div>
        <SettingsSwitch v-model="titlebarAutoHide" label="切换标题栏自动隐藏" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.editor-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
</style>
