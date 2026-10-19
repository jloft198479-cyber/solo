<script setup lang="ts">
import SettingsSwitch from './SettingsSwitch.vue';
import './settings-shared.css';

const titlebarAutoHide = defineModel<boolean>('titlebarAutoHide', { required: true });
</script>

<template>
  <div class="editor-settings-panel">
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
  gap: var(--space-2xl);
}
</style>
