<script setup lang="ts">
import { open } from '../../services/tauri/dialog';
import SettingsRangeField from './SettingsRangeField.vue';
import SettingsSwitch from './SettingsSwitch.vue';
import './settings-shared.css';

const autoSave = defineModel<boolean>('autoSave', { required: true });
const autoSaveInterval = defineModel<number>('autoSaveInterval', { required: true });
const imageStoragePath = defineModel<string>('imageStoragePath', { required: true });

async function pickFolder() {
  const selected = await open({ directory: true, multiple: false, title: '选择图片存储文件夹' });
  if (selected) {
    imageStoragePath.value = selected;
  }
}

function clearStoragePath() {
  imageStoragePath.value = '';
}
</script>

<template>
  <div class="save-settings-panel">
    <section class="settings-section-card settings-section-card--hero">
      <div>
        <div class="settings-section-title">文档保存</div>
        <p class="settings-section-desc">
          自动保存适合持续写作，关闭后会完全改回手动保存模式。
        </p>
      </div>
      <div class="settings-hero-metrics">
        <div class="settings-hero-chip">自动保存：{{ autoSave ? '开启' : '关闭' }}</div>
        <div v-if="autoSave" class="settings-hero-chip">间隔：{{ autoSaveInterval }} 秒</div>
      </div>
    </section>

    <section class="settings-section-card">
      <div class="settings-row">
        <div>
          <label class="settings-row-title">自动保存</label>
          <p class="settings-row-desc">编辑时自动保存文件</p>
        </div>
        <SettingsSwitch v-model="autoSave" label="切换自动保存" />
      </div>

      <div v-if="autoSave" class="settings-row settings-row--column">
        <div>
          <label class="settings-row-title">保存间隔: {{ autoSaveInterval }} 秒</label>
          <p class="settings-row-desc">在不打断写作的前提下平衡安全性与性能。</p>
        </div>
        <SettingsRangeField
          v-model="autoSaveInterval"
          class="w-full"
          label="保存间隔"
          :min="10"
          :max="120"
          :step="10"
          value-suffix=" 秒"
          min-label="10秒"
          max-label="120秒"
        />
      </div>
    </section>

    <!-- 图片存储位置 -->
    <section class="settings-section-card">
      <div class="settings-row settings-row--column">
        <div>
          <label class="settings-row-title">图片存储位置</label>
          <p class="settings-row-desc">
            默认保存在文档所在目录的 assets/ 文件夹中
          </p>
        </div>
        <div class="storage-path-row">
          <div v-if="imageStoragePath" class="storage-path-value storage-path-value--custom">
            {{ imageStoragePath }}
          </div>
          <div class="storage-path-actions">
            <button class="storage-path-btn" @click="pickFolder">
              {{ imageStoragePath ? '更改' : '自定义' }}
            </button>
            <button
              v-if="imageStoragePath"
              class="storage-path-btn storage-path-btn--reset"
              @click="clearStoragePath"
            >
              恢复默认
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.save-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.storage-path-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.storage-path-value {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 13px;
  color: var(--muted-color);
  background: var(--sidebar-bg);
  word-break: break-all;
  font-family: var(--font-mono, monospace);
}

.storage-path-value--custom {
  color: var(--text-color);
  border-color: var(--primary-color);
}

.storage-path-actions {
  display: flex;
  gap: 8px;
}

.storage-path-btn {
  padding: 6px 14px;
  font-size: 13px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 0.12s, border-color 0.12s;
}

.storage-path-btn:hover {
  background: var(--hover-bg);
  border-color: var(--primary-color);
  color: var(--text-color);
}

.storage-path-btn--reset {
  color: var(--muted-color);
}
</style>
