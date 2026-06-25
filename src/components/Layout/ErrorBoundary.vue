<template>
  <template v-if="!hasError">
    <slot />
  </template>
  <div v-else class="error-boundary-fallback">
    <div class="error-boundary-content">
      <div class="error-boundary-icon">⚠</div>
      <p class="error-boundary-text">编辑器遇到了问题</p>
      <p class="error-boundary-detail">{{ errorMessage }}</p>
      <button class="error-boundary-retry" @click="retry">重试</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue';

const hasError = ref(false);
const errorMessage = ref('');

onErrorCaptured((err) => {
  console.error('[solo] 组件错误:', err);
  hasError.value = true;
  errorMessage.value = err instanceof Error ? err.message : String(err);
  return false;
});

function retry() {
  hasError.value = false;
  errorMessage.value = '';
}
</script>

<style scoped>
.error-boundary-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.error-boundary-content {
  text-align: center;
  padding: 32px;
}

.error-boundary-icon {
  font-size: 40px;
  opacity: 0.3;
  margin-bottom: 16px;
}

.error-boundary-text {
  font-size: 14px;
  opacity: 0.7;
  margin: 0 0 8px;
}

.error-boundary-detail {
  font-size: 12px;
  opacity: 0.5;
  max-width: 448px;
  margin: 0 0 16px;
  word-break: break-word;
}

.error-boundary-retry {
  padding: 6px 16px;
  font-size: 14px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-color);
  opacity: 0.7;
  cursor: pointer;
  transition: opacity 0.15s;
}

.error-boundary-retry:hover {
  opacity: 1;
}
</style>
