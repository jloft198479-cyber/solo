<template>
  <!-- 窗口边缘缩放拖拽手柄（decorations: false 时替代原生边框） -->
  <div class="window-resize-n" @mousedown="onResizeStart('North')" />
  <div class="window-resize-s" @mousedown="onResizeStart('South')" />
  <div class="window-resize-w" @mousedown="onResizeStart('West')" />
  <div class="window-resize-e" @mousedown="onResizeStart('East')" />
  <div class="window-resize-nw" @mousedown="onResizeStart('NorthWest')" />
  <div class="window-resize-ne" @mousedown="onResizeStart('NorthEast')" />
  <div class="window-resize-sw" @mousedown="onResizeStart('SouthWest')" />
  <div class="window-resize-se" @mousedown="onResizeStart('SouthEast')" />
</template>

<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';

type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West';

function onResizeStart(direction: ResizeDirection) {
  return (e: MouseEvent) => {
    e.preventDefault();
    if (e.detail === 2) return;
    getCurrentWindow().startResizeDragging(direction).catch(() => {});
  };
}
</script>
