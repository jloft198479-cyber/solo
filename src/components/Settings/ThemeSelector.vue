<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import type { ThemeId } from '../../themes/types';
import { importTheme } from '../../themes/manager';
import { message, save as saveDialog } from '../../services/tauri/dialog';
import { saveDocument } from '../../services/tauri/document';
import ThemeCard from './ThemeCard.vue';

const settingsStore = useSettingsStore();

const allThemes = computed(() => settingsStore.allThemes);
const activeThemeId = computed(() => settingsStore.settings.activeThemeId);

function selectTheme(id: ThemeId) {
  settingsStore.setColorTheme(id);
}

function isPresetTheme(id: ThemeId): boolean {
  return settingsStore.presetThemes.some((theme) => theme.id === id);
}

function deleteCustomTheme(id: ThemeId) {
  settingsStore.removeCustomTheme(id);
}

async function downloadTemplate() {
  try {
    const selected = await saveDialog({
      title: '保存主题模板',
      defaultPath: 'theme-template.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!selected) return;
    const res = await fetch('/theme-template.json');
    const text = await res.text();
    await saveDocument(selected, text, null, true);
    await message('模板已保存', { title: '完成', kind: 'info' });
  } catch {
    await message('保存失败', { title: '错误', kind: 'error' });
  }
}

async function handleImportTheme(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const imported = importTheme(text);
    settingsStore.addCustomTheme(imported);
    await message('主题导入成功', { title: '完成', kind: 'info' });
  } catch {
    await message('主题导入失败：文件格式不正确', { title: '错误', kind: 'error' });
  } finally {
    input.value = '';
  }
}
</script>

<template>
  <div class="theme-selector">
    <div class="theme-selector-header">
      <div>
        <div class="theme-selector-title">应用主题</div>
        <div class="theme-selector-subtitle">直接选择一个你想要的应用主题。多个主题会以紧凑网格显示。</div>
      </div>
    </div>

    <div class="theme-grid">
      <ThemeCard
        v-for="theme in allThemes"
        :key="theme.id"
        :theme="theme"
        :active="activeThemeId === theme.id"
        :removable="!isPresetTheme(theme.id)"
        @select="selectTheme(theme.id)"
        @delete="deleteCustomTheme(theme.id)"
      />

      <label class="theme-import-card">
        <div class="theme-import-body">
          <svg class="theme-import-plus" width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <path d="M14 6v16M6 14h16" />
          </svg>
          <span class="theme-import-text">导入主题</span>
        </div>
        <input type="file" accept=".json" class="theme-import-input" @change="handleImportTheme" />
      </label>
    </div>

    <button class="theme-template-link" @click="downloadTemplate">下载主题模板</button>
  </div>
</template>

<style scoped>
.theme-selector {
  padding: 12px;
}

.theme-selector-header {
  margin-bottom: 16px;
}

.theme-selector-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
}

.theme-selector-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted-color);
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

@media (min-width: 1280px) {
  .theme-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.theme-import-card {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  padding: 10px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.theme-import-card:hover {
  border-color: var(--primary-color);
  background-color: color-mix(in srgb, var(--primary-color) 6%, transparent);
}

.theme-import-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--muted-color);
}

.theme-import-plus {
  opacity: 0.5;
  transition: opacity 0.15s;
}

.theme-import-card:hover .theme-import-plus {
  opacity: 0.8;
}

.theme-import-text {
  font-size: 13px;
  font-weight: 500;
}

.theme-template-link {
  margin-top: 12px;
  padding: 0;
  font-size: 12px;
  color: var(--muted-color);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
}

.theme-template-link:hover {
  color: var(--primary-color);
  text-decoration: underline;
}

.theme-import-input {
  display: none;
}
</style>
