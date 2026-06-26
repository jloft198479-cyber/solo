<script setup lang="ts">
import './popover-shared.css';

const props = defineProps<{
  isActive: boolean;
  exportHtml: () => void;
  exportPdf: () => void;
  copyToWechat: () => void;
}>();
const emit = defineEmits<{ (e: 'toggle'): void; (e: 'select'): void }>();

function doExport(type: 'html' | 'pdf' | 'wechat') {
  emit('select');
  if (type === 'html') props.exportHtml();
  else if (type === 'pdf') props.exportPdf();
  else props.copyToWechat();
}
</script>

<template>
  <div class="quick-action-item">
    <button class="icon-btn" title="导出" @click.stop="emit('toggle')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="9" width="10" height="5" rx="1.5" />
        <polyline points="11,5.5 8,2.5 5,5.5" />
        <line x1="8" y1="2.5" x2="8" y2="9" />
      </svg>
    </button>
    <Transition name="quick-popover">
      <div v-if="isActive" class="quick-popover">
        <div class="quick-popover-header">导出</div>
        <div class="quick-popover-list">
          <button class="quick-popover-option" @click="doExport('html')">
            <svg class="export-glyph" style="background:var(--warning-color)" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12.5V2a1 1 0 0 1 1-1h5.5L13 5v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
              <path d="M9.5 1v4h4" />
              <path d="M6 9h4" />
              <path d="M6 11.5h4" />
            </svg>
            <span class="quick-popover-label">导出 HTML</span>
          </button>
          <button class="quick-popover-option" @click="doExport('pdf')">
            <svg class="export-glyph" style="background:var(--error-color)" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h3.59a1 1 0 0 1 .7.3l2.41 2.4a1 1 0 0 1 .3.71V12.5A1.5 1.5 0 0 1 10 14H4.5A1.5 1.5 0 0 1 3 12.5z" />
              <path d="M8 2v3.5a.5.5 0 0 0 .5.5H12" />
              <path d="M6.5 8v4M8.5 10a1 1 0 1 0 0-2H6.5v2z" />
            </svg>
            <span class="quick-popover-label">打印</span>
          </button>
          <button class="quick-popover-option" @click="doExport('wechat')">
            <svg class="export-glyph" style="background:var(--success-color)" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 7a4.5 4.5 0 0 1-4.1 4.48A5 5 0 0 1 3 7.5 3.5 3.5 0 0 1 6.5 4a4.5 4.5 0 0 1 6.5 3z" />
              <path d="M9.5 7.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z" />
              <path d="M12 7.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z" />
              <path d="M5 11.5a3.5 3.5 0 0 0 2.52 1.05A4 4 0 0 0 12 10" />
            </svg>
            <span class="quick-popover-label">复制到微信格式</span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.export-glyph {
  width: 20px;
  height: 20px;
  padding: 2px;
  border-radius: 5px;
  flex-shrink: 0;
  color: white;
}
</style>
