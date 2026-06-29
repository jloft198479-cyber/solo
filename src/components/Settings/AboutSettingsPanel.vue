<script setup lang="ts">
import { ref } from 'vue';
import { check } from '@tauri-apps/plugin-updater';
import SettingsSwitch from './SettingsSwitch.vue';
import './settings-shared.css';
import pkg from '../../../package.json';

const enableAutoUpdateCheck = defineModel<boolean>('enableAutoUpdateCheck', { required: true });
const appVersion = pkg.version;
const updateStatus = ref<'idle' | 'checking' | 'uptodate' | 'available' | 'error'>('idle');
const statusMessage = ref('');

async function checkForUpdate() {
  updateStatus.value = 'checking';
  statusMessage.value = '';
  try {
    const update = await check();
    if (update) {
      updateStatus.value = 'available';
      await update.downloadAndInstall();
    } else {
      updateStatus.value = 'uptodate';
      statusMessage.value = '当前已是最新版本';
    }
  } catch (e) {
    updateStatus.value = 'error';
    statusMessage.value = '检查更新失败，请检查网络后重试';
  }
}
</script>

<template>
  <div class="about-settings-panel">
    <section class="settings-section-card settings-section-card--hero">
      <div>
        <div class="settings-section-title">solo</div>
        <p class="settings-section-desc">
          极简 Markdown 编辑器 · 基于 Tauri · Rust · Vue 3 · TipTap
        </p>
      </div>
      <div class="settings-hero-metrics">
        <div class="settings-hero-chip">v{{ appVersion }}</div>
      </div>
    </section>

    <section class="settings-section-card">
      <div class="settings-row">
        <div>
          <label class="settings-row-title">启动时自动检查更新</label>
          <p class="settings-row-desc">应用启动时自动检测 GitHub 上的新版本</p>
        </div>
        <SettingsSwitch v-model="enableAutoUpdateCheck" label="切换自动检查更新" />
      </div>
    </section>

    <section class="settings-section-card">
      <div class="settings-row settings-row--column">
        <div>
          <label class="settings-row-title">检查更新</label>
          <p class="settings-row-desc">当前版本 v{{ appVersion }}</p>
        </div>
        <div class="update-check-row">
          <button
            class="update-check-btn"
            :disabled="updateStatus === 'checking'"
            @click="checkForUpdate"
          >
            {{ updateStatus === 'checking' ? '检查中…' : '检查更新' }}
          </button>
          <span
            v-if="statusMessage"
            class="update-status-text"
            :class="{
              'update-status-text--success': updateStatus === 'uptodate',
              'update-status-text--error': updateStatus === 'error',
              'update-status-text--info': updateStatus === 'available',
            }"
          >
            {{ statusMessage }}
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.about-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.update-check-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.update-check-btn {
  padding: 8px 18px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-color);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.12s, border-color 0.12s;
}

.update-check-btn:hover:not(:disabled) {
  background: var(--hover-bg);
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.update-check-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.update-status-text {
  font-size: 13px;
  line-height: 1.4;
}

.update-status-text--success {
  color: var(--primary-color);
}

.update-status-text--error {
  color: var(--warn-color, #e74c3c);
}

.update-status-text--info {
  color: var(--primary-color);
}
</style>
