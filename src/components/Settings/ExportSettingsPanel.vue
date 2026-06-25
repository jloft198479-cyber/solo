<script setup lang="ts">
import './settings-shared.css';

const wechatTheme = defineModel<string>('wechatTheme', { required: true });

// 强制跟随编辑器主题，移除独立的微信主题选择
wechatTheme.value = 'follow-editor';
</script>

<template>
  <div class="export-settings-panel">
    <section class="settings-section-card settings-section-card--hero">
      <div>
        <div class="settings-section-title">导出</div>
        <p class="settings-section-desc">复制到微信等场景的排版跟随当前编辑器主题。</p>
      </div>
    </section>

    <section class="settings-section-card">
      <div class="settings-section-heading">
        <div>
          <div class="settings-section-title">导出风格</div>
          <p class="settings-section-desc">
            微信导出使用编辑器当前主题的配色方案，所见即所得——编辑时看到什么风格，导出就是什么风格。
          </p>
        </div>
      </div>
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
