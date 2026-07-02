<script setup lang="ts">
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import SettingsSwitch from './SettingsSwitch.vue';
import './settings-shared.css';
import pkg from '../../../package.json';

const enableAutoUpdateCheck = defineModel<boolean>('enableAutoUpdateCheck', { required: true });
const appVersion = pkg.version;
const updateStatus = ref<'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'installing' | 'error'>('idle');
const statusMessage = ref('');
const downloadProgress = ref(0);

const isBusy = ref(false);

async function checkForUpdate() {
  if (isBusy.value) return;
  isBusy.value = true;
  updateStatus.value = 'checking';
  statusMessage.value = '';
  downloadProgress.value = 0;
  try {
    await invoke<string>('detect_proxy_for_update').catch(() => {});
    const update = await check();
    if (update) {
      updateStatus.value = 'downloading';
      statusMessage.value = '正在下载 0%';
      let totalSize = 0;
      let downloaded = 0;
      await update.download((event) => {
        if (event.event === 'Started') {
          totalSize = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (totalSize > 0) {
            const pct = Math.round((downloaded / totalSize) * 100);
            downloadProgress.value = pct;
            statusMessage.value = `正在下载 ${pct}%`;
          }
        }
      });
      updateStatus.value = 'installing';
      statusMessage.value = '正在安装，即将重启';
      await update.install();
    } else {
      updateStatus.value = 'uptodate';
      statusMessage.value = '当前已是最新版本';
    }
  } catch (e) {
    updateStatus.value = 'error';
    statusMessage.value = '检查更新失败，请检查网络后重试';
  } finally {
    isBusy.value = false;
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
            :disabled="isBusy"
            @click="checkForUpdate"
          >
            {{ updateStatus === 'checking' ? '检查中…' : updateStatus === 'downloading' ? '下载中…' : updateStatus === 'installing' ? '安装中…' : '检查更新' }}
          </button>
          <span
            v-if="statusMessage"
            class="update-status-text"
            :class="{
              'update-status-text--success': updateStatus === 'uptodate',
              'update-status-text--error': updateStatus === 'error',
              'update-status-text--info': updateStatus === 'downloading' || updateStatus === 'installing',
            }"
          >
            {{ statusMessage }}
          </span>
        </div>
        <div v-if="updateStatus === 'downloading'" class="update-progress-bar">
          <div class="update-progress-fill" :style="{ width: downloadProgress + '%' }" />
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
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--text-color);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
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
  color: var(--error-color);
}

.update-status-text--info {
  color: var(--primary-color);
}

.update-progress-bar {
  width: 100%;
  height: 3px;
  background: var(--border-color);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 8px;
}

.update-progress-fill {
  height: 100%;
  background: var(--primary-color);
  border-radius: 2px;
  transition: width 0.3s ease;
}
</style>
