<script setup lang="ts">
import WechatThemeSelector from './WechatThemeSelector.vue';
import './settings-shared.css';

const wechatTheme = defineModel<string>('wechatTheme', { required: true });
</script>

<template>
  <div class="export-settings-panel">
    <section class="settings-section-card settings-section-card--hero">
      <div>
        <div class="settings-section-title">导出主题</div>
        <p class="settings-section-desc">控制复制到微信等场景时的排版风格和主色表现。</p>
      </div>
    </section>

    <section class="settings-section-card">
      <div class="settings-section-heading">
        <div>
          <div class="settings-section-title">主题选择</div>
          <p class="settings-section-desc">当前为复制到微信的富文本导出提供单独的排版主题。</p>
        </div>
      </div>
      <WechatThemeSelector v-model="wechatTheme" />
    </section>
  </div>
</template>

<style scoped>
.export-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
</style>
