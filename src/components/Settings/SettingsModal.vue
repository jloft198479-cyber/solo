<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { confirm } from '../../services/tauri/dialog';
import AppearanceSettingsPanel from './AppearanceSettingsPanel.vue';
import CloseIcon from '../icons/CloseIcon.vue';
import EditorSettingsPanel from './EditorSettingsPanel.vue';
import SaveSettingsPanel from './SaveSettingsPanel.vue';
import SettingsSidebarNav, { type SettingsTabKey } from './SettingsSidebarNav.vue';
import ShortcutSettingsPanel from './ShortcutSettingsPanel.vue';
import AboutSettingsPanel from './AboutSettingsPanel.vue';
import { useShortcutSettings } from './useShortcutSettings';

const settingsStore = useSettingsStore();

// 当前选中的设置分组
const activeTab = ref<SettingsTabKey>('appearance');

// 监听 pendingTab，支持从外部直接打开指定分组
watch(() => settingsStore.isModalOpen, (isOpen) => {
  if (isOpen && settingsStore.pendingTab) {
    activeTab.value = settingsStore.pendingTab as SettingsTabKey;
    settingsStore.pendingTab = '';
  }
});
const {
  conflictWarning,
  editingId,
  editingKey,
  formatShortcutDisplay,
  isDefaultShortcut,
  isMac,
  resetAllShortcuts,
  resetShortcut,
  shortcutGroups,
  startEdit,
  setCaptureInputRef,
  cancelEdit,
  captureKeydown,
} = useShortcutSettings(settingsStore.settings);

const tabMeta = {
  appearance: {
    title: '外观与主题',
    description: '管理应用主题、字体与排版风格，让界面更贴近你的使用习惯。',
  },
  editor: {
    title: '编辑器偏好',
    description: '调整编辑器行为、显示细节和写作体验相关设置。',
  },
  shortcuts: {
    title: '快捷键',
    description: '查看并修改命令快捷键，建立更顺手的操作路径。',
  },
  save: {
    title: '保存策略',
    description: '控制自动保存与文件持久化行为。',
  },
  about: {
    title: '关于',
    description: '版本信息与软件更新。',
  },
} as const;

const activeTabMeta = computed(() => tabMeta[activeTab.value]);
const currentThemeName = computed(() => settingsStore.currentTheme?.name ?? '未选择主题');

// 关闭弹窗
function close() {
  settingsStore.closeModal();
  cancelEdit();
}

// 点击遮罩关闭
function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    close();
  }
}

// 重置设置
async function handleReset() {
  const confirmed = await confirm('确定要恢复默认设置吗？', {
    title: '恢复默认',
    kind: 'warning',
    okLabel: '恢复',
    cancelLabel: '取消',
  });
  if (confirmed) {
    settingsStore.resetSettings();
  }
}

// 快捷键关闭
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close();
  }
}

</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="settingsStore.isModalOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
        tabindex="-1"
        @click="onOverlayClick"
        @keydown="onKeyDown"
      >
        <div
          class="settings-modal__dialog rounded-xl shadow-2xl w-[1040px] max-w-[94vw] max-h-[84vh] overflow-hidden flex flex-col"
          @click.stop
        >
          <!-- 头部 -->
          <div class="settings-modal-header">
            <h2 class="settings-modal-title">设置</h2>
            <button class="settings-close-btn" @click="close">
              <CloseIcon class="settings-close-icon" />
            </button>
          </div>

          <!-- 主体 -->
          <div class="flex flex-1 overflow-hidden settings-shell">
            <!-- 侧边导航 -->
            <SettingsSidebarNav v-model="activeTab" />

            <!-- 设置内容 -->
            <div
              class="flex-1 overflow-y-auto settings-content-area settings-modal__content"
            >
              <div class="settings-content">
                <div class="settings-page-header">
                  <div>
                    <h3 class="settings-page-title">{{ activeTabMeta.title }}</h3>
                    <p class="settings-page-desc">{{ activeTabMeta.description }}</p>
                  </div>
                  <div
                    v-if="activeTab === 'appearance'"
                    class="settings-page-badge"
                  >
                    {{ `当前主题：${currentThemeName}` }}
                  </div>
                </div>

                <!-- 外观设置 -->
                <AppearanceSettingsPanel
                  v-show="activeTab === 'appearance'"
                  v-model:font-size="settingsStore.settings.fontSize"
                  v-model:font-family="settingsStore.settings.fontFamily"
                  v-model:line-height="settingsStore.settings.lineHeight"
                  :current-theme-name="currentThemeName"
                />

                <!-- 编辑器设置 -->
                <EditorSettingsPanel
                  v-show="activeTab === 'editor'"
                  v-model:spell-check="settingsStore.settings.spellCheck"
                  v-model:titlebar-auto-hide="settingsStore.settings.titlebarAutoHide"
                />

                <!-- 快捷键设置 -->
                <ShortcutSettingsPanel
                  v-show="activeTab === 'shortcuts'"
                  :conflict-warning="conflictWarning"
                  :editing-id="editingId"
                  :editing-key="editingKey"
                  :format-shortcut-display="formatShortcutDisplay"
                  :is-default-shortcut="isDefaultShortcut"
                  :is-mac="isMac"
                  :set-capture-input-ref="setCaptureInputRef"
                  :shortcut-groups="shortcutGroups"
                  @reset-all="resetAllShortcuts"
                  @reset-shortcut="resetShortcut"
                  @start-edit="startEdit"
                  @cancel-edit="cancelEdit"
                  @capture-keydown="captureKeydown"
                />

                <!-- 保存设置 -->
                <SaveSettingsPanel
                  v-show="activeTab === 'save'"
                  v-model:auto-save="settingsStore.settings.autoSave"
                  v-model:auto-save-interval="settingsStore.settings.autoSaveInterval"
                  v-model:image-storage-path="settingsStore.settings.imageStoragePath"
                  v-model:shell-integration="settingsStore.settings.shellIntegration"
                />

                <!-- 关于 -->
                <AboutSettingsPanel
                  v-show="activeTab === 'about'"
                  v-model:enable-auto-update-check="settingsStore.settings.enableAutoUpdateCheck"
                />
              </div>
            </div>
          </div>

          <!-- 底部 -->
          <div class="settings-footer">
            <button class="settings-footer-reset" @click="handleReset">恢复默认</button>
            <button class="settings-footer-done" @click="close">完成</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-active > div,
.modal-leave-active > div {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from > div,
.modal-leave-to > div {
  transform: scale(0.95);
  opacity: 0;
}

.settings-shell {
  min-height: 0;
}

.settings-modal__dialog {
  background-color: var(--bg-color);
  color: var(--text-color);
}

.settings-modal__content {
  background-color: var(--bg-secondary);
}

.settings-content-area {
  min-width: 0;
}

.settings-content {
  width: min(100%, 760px);
  margin: 0 auto;
  padding: 28px 28px 32px;
}

/* ── 弹窗头部 ──────────────────────────────────── */
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

/* ── 页面标题 ──────────────────────────────────── */
.settings-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.settings-page-title {
  margin: 0;
  color: var(--text-color);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.settings-page-desc {
  margin: 8px 0 0;
  color: var(--muted-color);
  font-size: 14px;
  line-height: 1.7;
}

.settings-page-badge {
  flex-shrink: 0;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-color);
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 600;
}

/* ── 弹窗底部 ──────────────────────────────────── */
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

@media (max-width: 960px) {
  .settings-page-header {
    flex-direction: column;
  }
}

</style>
