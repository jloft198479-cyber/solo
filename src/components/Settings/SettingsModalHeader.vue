<script setup lang="ts">
import CloseIcon from '../icons/CloseIcon.vue';

defineEmits<{
  close: [];
}>();
</script>

<template>
  <div class="settings-modal-header">
    <h2 class="settings-modal-title">设置</h2>
    <button class="settings-close-btn" @click="$emit('close')">
      <CloseIcon class="settings-close-icon" />
    </button>
  </div>
</template>

<style scoped>
.settings-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 28px;
  border-bottom: 1px solid var(--border-color);
}

.settings-modal-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color);
}

.settings-close-btn {
  padding: 4px;
  border-radius: 12px;
  color: var(--muted-color);
  transition:
    background-color 0.15s,
    color 0.15s;
}

.settings-close-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.settings-close-icon {
  width: 20px;
  height: 20px;
}
</style>
