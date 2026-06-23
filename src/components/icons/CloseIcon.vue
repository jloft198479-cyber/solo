<script setup lang="ts">
/**
 * 关闭图标（X）
 *
 * 统一项目中所有关闭/删除按钮的 X 图标。
 * 尺寸通过外部 CSS class 控制（默认继承父元素字体大小或通过 class 设置 width/height）。
 */
</script>

<template>
  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
</template>
