<script setup lang="ts">
import { ref } from 'vue';
import ThemePopover from './ThemePopover.vue';
import FontPopover from './FontPopover.vue';
import ExportPopover from './ExportPopover.vue';
import { useClickOutside } from '../composables/useClickOutside';

defineProps<{
  exportHtml: () => void;
  exportPdf: () => void;
  copyToWechat: () => void;
}>();

type PopoverType = 'theme' | 'font' | 'export' | null;
const activePopover = ref<PopoverType>(null);
const wrapRef = ref<HTMLElement | null>(null);

function togglePopover(type: PopoverType) {
  activePopover.value = activePopover.value === type ? null : type;
}

function closePopover() {
  activePopover.value = null;
}

// 点击外部关闭弹出层
useClickOutside(wrapRef, closePopover);
</script>

<template>
  <div ref="wrapRef" class="quick-action-wrap quick-actions">
    <ThemePopover
      :is-active="activePopover === 'theme'"
      @toggle="togglePopover('theme')"
      @select="closePopover"
    />
    <FontPopover
      :is-active="activePopover === 'font'"
      @toggle="togglePopover('font')"
      @select="closePopover"
    />
    <ExportPopover
      :is-active="activePopover === 'export'"
      :export-html="exportHtml"
      :export-pdf="exportPdf"
      :copy-to-wechat="copyToWechat"
      @toggle="togglePopover('export')"
      @select="closePopover"
    />
  </div>
</template>

<style scoped>
.quick-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
