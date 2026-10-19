<script setup lang="ts">
import type { Theme } from '../../themes/types';

defineProps<{
  theme: Theme;
}>();
</script>

<template>
  <div
    class="theme-preview"
    :style="{
      backgroundColor: theme.colors.bgColor,
      borderColor: theme.colors.borderColor,
      boxShadow: theme.colors.shadowMd,
    }"
  >
    <div
      class="theme-preview-topbar"
      :style="{ backgroundColor: theme.colors.bgSecondary, borderColor: theme.colors.borderLight }"
    >
      <!-- 顶栏圆点用主题自有性格色（主色 / 第二性格色 accentColor），体现各主题差异 -->
      <div class="theme-preview-dot" :style="{ backgroundColor: theme.colors.primaryColor }" />
      <div
        class="theme-preview-dot"
        :style="{ backgroundColor: theme.colors.accentColor ?? theme.colors.primaryHover }"
      />
    </div>
    <!-- 缩略图只画真实存在的结构：标题栏 + 文档正文。
         solo 没有左侧导航栏（一窗一文档，唯一可选面板是右侧大纲），
         曾画过的「左侧导航列」会让人误以为有侧边栏 —— 别再加回来。 -->
    <div class="theme-preview-editor">
      <div class="theme-preview-toolbar" :style="{ borderColor: theme.colors.borderLight }">
        <div class="theme-preview-chip" :style="{ backgroundColor: theme.colors.primaryColor }" />
        <div class="theme-preview-tool" :style="{ backgroundColor: theme.colors.primaryLight }" />
        <div
          class="theme-preview-tool theme-preview-tool--small"
          :style="{ backgroundColor: theme.colors.primaryLight }"
        />
      </div>

      <div class="theme-preview-body">
        <div class="theme-preview-heading" :style="{ backgroundColor: theme.colors.textColor }" />
        <div class="theme-preview-line" :style="{ backgroundColor: theme.colors.textColor }" />
        <div
          class="theme-preview-line theme-preview-line--muted"
          :style="{ backgroundColor: theme.colors.textSecondary }"
        />
        <div class="theme-preview-callout" :style="{ backgroundColor: theme.colors.calloutTipBg }">
          <div
            class="theme-preview-callout-bar"
            :style="{ backgroundColor: theme.colors.calloutTip }"
          />
          <div class="theme-preview-callout-content">
            <div
              class="theme-preview-callout-line"
              :style="{ backgroundColor: theme.colors.textColor }"
            />
            <div
              class="theme-preview-callout-line theme-preview-callout-line--short"
              :style="{ backgroundColor: theme.colors.textSecondary }"
            />
          </div>
        </div>
        <div
          class="theme-preview-code"
          :style="{ backgroundColor: theme.colors.codeBg, borderColor: theme.colors.codeBorder }"
        >
          <div
            class="theme-preview-code-line"
            :style="{ backgroundColor: theme.colors.primaryColor }"
          />
          <div
            class="theme-preview-code-line theme-preview-code-line--muted"
            :style="{ backgroundColor: theme.colors.textSecondary }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.theme-preview {
  display: flex;
  flex-direction: column;
  min-height: 122px;
  border: 1px solid;
  /* 微缩窗口外框与卡片语言一致（8px） */
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.theme-preview-topbar {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 18px;
  padding: 0 8px;
  border-bottom: 1px solid;
}

.theme-preview-dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  opacity: 0.9;
}

.theme-preview-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  /* 缩略图正文区的最小高度（与 .theme-preview 的 122px 对齐：18 顶栏 + 103 正文 + 边框） */
  min-height: 103px;
}

.theme-preview-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  height: 24px;
  padding: 0 8px;
  border-bottom: 1px solid;
}

.theme-preview-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
}

.theme-preview-chip {
  width: 28px;
  height: 8px;
  border-radius: var(--radius-pill);
}

.theme-preview-tool {
  width: 14px;
  height: 8px;
  border-radius: var(--radius-pill);
  opacity: 0.9;
}

.theme-preview-tool--small {
  width: 10px;
}

.theme-preview-heading {
  width: 54%;
  height: 8px;
  border-radius: var(--radius-pill);
}

.theme-preview-line {
  width: 88%;
  height: 6px;
  border-radius: var(--radius-pill);
  opacity: 0.9;
}

.theme-preview-line--muted {
  width: 64%;
  opacity: 0.5;
}

.theme-preview-callout {
  display: flex;
  gap: var(--space-sm);
  align-items: stretch;
  min-height: 18px;
  padding: 4px 5px;
  /* 微缩比例下的 callout 内框，对应真实 radius-sm */
  border-radius: var(--radius-sm);
}

.theme-preview-callout-bar {
  width: 3px;
  border-radius: var(--radius-pill);
}

.theme-preview-callout-content {
  flex: 1;
}

.theme-preview-callout-line {
  width: 74%;
  height: 4px;
  margin-top: var(--space-2xs);
  border-radius: var(--radius-pill);
  opacity: 0.9;
}

.theme-preview-callout-line--short {
  width: 48%;
  opacity: 0.55;
}

.theme-preview-code {
  padding: 5px 6px;
  border: 1px solid;
  border-radius: var(--radius-sm);
}

.theme-preview-code-line {
  width: 62%;
  height: 4px;
  border-radius: var(--radius-pill);
  opacity: 0.95;
}

.theme-preview-code-line--muted {
  width: 82%;
  margin-top: var(--space-xs);
  opacity: 0.45;
}
</style>
