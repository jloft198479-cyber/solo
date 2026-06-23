<script setup lang="ts">
defineEmits<{
  close: [];
  reset: [];
}>();
</script>

<template>
  <div class="settings-footer">
    <button class="settings-footer-reset" @click="$emit('reset')">
      恢复默认
    </button>
    <button class="settings-footer-done" @click="$emit('close')">完成</button>
  </div>
</template>

<style scoped>
.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 28px;
  border-top: 1px solid var(--border-color);
  background-color: var(--sidebar-bg);
  box-shadow: 0 -1px 0 rgba(15, 23, 42, 0.02);
}

.settings-footer-reset {
  padding: 8px 16px;
  font-size: 14px;
  color: var(--muted-color);
  transition: color 0.15s;
}

.settings-footer-done {
  padding: 8px 24px;
  border-radius: 8px;
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.15s;
}

.settings-footer-done:hover {
  background: var(--btn-primary-hover);
}
</style>
