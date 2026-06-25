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
        <circle cx="12" cy="3.3" r="2" />
        <circle cx="4" cy="8" r="2" />
        <circle cx="12" cy="12.7" r="2" />
        <line x1="5.7" y1="9" x2="10.3" y2="11.7" />
        <line x1="10.3" y1="4.3" x2="5.7" y2="7" />
      </svg>
    </button>
    <Transition name="quick-popover">
      <div v-if="isActive" class="quick-popover">
        <div class="quick-popover-header">导出</div>
        <div class="quick-popover-list">
          <button class="quick-popover-option" @click="doExport('html')">
            <span class="export-glyph export-glyph--html">H</span>
            <span class="quick-popover-label">导出 HTML</span>
          </button>
          <button class="quick-popover-option" @click="doExport('pdf')">
            <span class="export-glyph export-glyph--pdf">P</span>
            <span class="quick-popover-label">打印</span>
          </button>
          <button class="quick-popover-option" @click="doExport('wechat')">
            <span class="export-glyph export-glyph--wechat">W</span>
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
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  border-radius: 5px;
  flex-shrink: 0;
  color: white;
  font-family: system-ui, sans-serif;
}

.export-glyph--html {
  background: var(--warning-color);
}

.export-glyph--pdf {
  background: var(--error-color);
}

.export-glyph--wechat {
  background: var(--success-color);
}
</style>
