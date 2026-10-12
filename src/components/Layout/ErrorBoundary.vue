<template>
  <template v-if="!hasError">
    <slot />
  </template>
  <div v-else class="error-boundary-fallback" role="alert">
    <div class="error-boundary-content">
      <div class="error-boundary-icon" aria-hidden="true">⚠</div>
      <p class="error-boundary-text">编辑器遇到了问题</p>
      <p class="error-boundary-detail">{{ errorMessage }}</p>
      <div class="error-boundary-actions">
        <button class="error-boundary-retry" type="button" @click="retry">重试</button>
        <button class="error-boundary-copy" type="button" @click="copyDetail">
          {{ copied ? '已复制' : '复制错误详情' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onErrorCaptured, onBeforeUnmount } from 'vue';

// 「已复制」反馈停留时长
const COPY_FEEDBACK_DURATION = 1500;

const hasError = ref(false);
const errorMessage = ref('');
const errorDetail = ref('');
const copied = ref(false);
let copyTimer: number | undefined;

/** 兜底页给用户看的短句：任何对象/字符串异常都不许裸奔成 [object Object] */
function toDisplayMessage(err: unknown): string {
  if (err instanceof Error) return err.message || '未知错误';
  if (typeof err === 'string' && err.trim()) return err;
  if (err !== null && typeof err === 'object') {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return '未知错误，详情已记录到控制台';
}

/** 供「复制错误详情」使用的完整信息（含堆栈 / 结构化对象，兼容循环引用） */
function toErrorDetail(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  if (err !== null && typeof err === 'object') {
    try {
      const seen = new WeakSet<object>();
      return JSON.stringify(
        err,
        (_key, value: unknown) => {
          if (value !== null && typeof value === 'object') {
            if (seen.has(value as object)) return '[Circular]';
            seen.add(value as object);
          }
          return value;
        },
        2,
      );
    } catch {
      return String(err);
    }
  }
  return String(err);
}

onErrorCaptured((err) => {
  console.error('[solo] 组件错误:', err);
  hasError.value = true;
  errorMessage.value = toDisplayMessage(err);
  errorDetail.value = toErrorDetail(err);
  return false;
});

async function copyDetail() {
  try {
    await navigator.clipboard.writeText(errorDetail.value || errorMessage.value);
    copied.value = true;
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => (copied.value = false), COPY_FEEDBACK_DURATION);
  } catch {
    // 剪贴板被系统拒绝时不打扰用户：完整信息已在 console.error 留底
  }
}

function retry() {
  hasError.value = false;
  errorMessage.value = '';
  errorDetail.value = '';
  copied.value = false;
  window.clearTimeout(copyTimer);
}

onBeforeUnmount(() => window.clearTimeout(copyTimer));
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
  color: var(--muted-color);
  margin-bottom: 16px;
}

.error-boundary-text {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0 0 8px;
}

.error-boundary-detail {
  font-size: 12px;
  color: var(--muted-color);
  max-width: 448px;
  margin: 0 0 16px;
  word-break: break-word;
}

.error-boundary-retry {
  padding: 6px 16px;
  font-size: 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--motion-fast), color var(--motion-fast);
}

.error-boundary-retry:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.error-boundary-actions {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

.error-boundary-copy {
  padding: 6px 12px;
  font-size: 13px;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--muted-color);
  cursor: pointer;
  transition:
    color var(--motion-fast),
    background-color var(--motion-fast);
}

.error-boundary-copy:hover {
  color: var(--primary-color);
  background: var(--hover-bg);
}
</style>
