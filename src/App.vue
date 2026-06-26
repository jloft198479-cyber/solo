<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppWindowSession } from './composables/useAppWindowSession';
import { useCommandDispatcher } from './composables/useCommandDispatcher';
import { useAppDomEvents } from './composables/useAppDomEvents';
import { useAppEditorState } from './composables/useAppEditorState';
import { useDocumentSession } from './composables/useDocumentSession';
import { useExportActions } from './composables/useExportActions';
import { useImagePreview } from './composables/useImagePreview';
import { useMenuEvents } from './composables/useMenuEvents';
import { useMenuShortcutsSync } from './composables/useMenuShortcutsSync';
import CustomTitlebar from './components/Layout/CustomTitlebar.vue';
import ErrorBoundary from './components/Layout/ErrorBoundary.vue';
import ImageFullscreenOverlay from './components/Editor/ImageFullscreenOverlay.vue';
import ImagePreviewView from './components/Editor/ImagePreviewView.vue';
import SettingsModal from './components/Settings/SettingsModal.vue';
import StatusbarQuickActions from './components/StatusbarQuickActions.vue';
import WindowResizeHandles from './components/Layout/WindowResizeHandles.vue';
import { useFileStore } from './stores/file';
import { useSettingsStore } from './stores/settings';
import { message } from './services/tauri/dialog';
import { destroyCurrentWindow, newEditorWindow } from './services/tauri/window';
import { findCommandByShortcut } from './commands/registry';
import { getCurrentWindow } from '@tauri-apps/api/window';
import pkg from '../package.json';

const MarkdownEditor = defineAsyncComponent(() => import('./components/Editor/MarkdownEditor.vue'));

const fileStore = useFileStore();
const settingsStore = useSettingsStore();
const { settings, isLoaded } = storeToRefs(settingsStore);
const appVersion = pkg.version;
const { editorRef, stats, handleEditorUpdate } = useAppEditorState();

const showAboutModal = ref(false);

const {
  activeViewMode,
  imagePreviewUrl,
  isFullscreenPreview,
  closeFullscreenPreview,
  openFullscreenPreview,
  resetToEditor,
} = useImagePreview();

const documentSession = useDocumentSession({
  resetViewMode: resetToEditor,
});

async function handleOpenFile(path: string) {
  await documentSession.openDocumentWithPrompt(path);
}

import { renameFile } from './services/tauri/document';
import { normalizeTauriError } from './services/tauri/client';

async function handleRename(name: string) {
  const currentFile = fileStore.currentFile;
  if (!currentFile.path) {
    fileStore.setDisplayName(name);
    return;
  }

  const trimmed = name.trim();
  if (!trimmed || trimmed === currentFile.displayName) return;

  try {
    const result = await renameFile(currentFile.path, trimmed);
    fileStore.renamePath(result.path);
  } catch (error) {
    const { message: errorMsg } = normalizeTauriError(error);
    await message(`重命名失败: ${errorMsg}`, { title: '错误', kind: 'error' });
  }
}

const { autoSaveStatus, externalFileWarning } = documentSession;

const focusModeNotice = ref<{ message: string; timestamp: number } | null>(null);
watch(() => settingsStore.isFocusMode, (active) => {
  if (!active) {
    const msg = { message: '已退出焦点模式', timestamp: Date.now() };
    focusModeNotice.value = msg;
    setTimeout(() => {
      if (focusModeNotice.value?.timestamp === msg.timestamp) {
        focusModeNotice.value = null;
      }
    }, 2000);
  }
});

const { exportHtml, exportPdf, copyToWechat } = useExportActions({
  editorRef,
  activeViewMode,
  fileStore,
  settingsStore,
});

const { syncMenuShortcuts, stopWatching: stopWatchingMenuShortcuts } = useMenuShortcutsSync({
  customShortcuts: computed(() => settings.value.customShortcuts),
  isLoaded,
});

const windowTitle = computed(() => {
  const file = fileStore.currentFile;
  let fileName = file.displayName || '未命名';

  if (activeViewMode.value === 'image' && imagePreviewUrl.value) {
    fileName = '查看图片';
  }

  return fileName;
});

const windowSession = useAppWindowSession({
  openDocument: handleOpenFile,
  saveDocument: documentSession.saveCurrentDocument,
  isDirty: () => fileStore.currentFile.isDirty,
  windowTitle,
});

function switchToImageView() {
  activeViewMode.value = 'image';
  isFullscreenPreview.value = false;
}

function showAbout() {
  showAboutModal.value = true;
}

const { executeCommand } = useCommandDispatcher({
  editorRef,
  activeViewMode,
  handleNew: async () => {
    await newEditorWindow();
  },
  handleOpen: documentSession.handleOpenDocument,
  handleSave: documentSession.saveCurrentDocument,
  handleSaveAs: documentSession.saveCurrentDocumentAs,
  exportHtml,
  exportPdf,
  copyToWechat,
  openSettings: () => settingsStore.openModal(),
  toggleFocusMode: () => settingsStore.toggleFocusMode(),
  showAbout,
  toggleFullscreen: windowSession.toggleFullscreen,
  handleQuit: windowSession.handleQuit,
});

useAppDomEvents({
  activeViewMode,
  isFullscreenPreview,
  isFocusMode: () => settingsStore.isFocusMode,
  customShortcuts: () => settingsStore.settings.customShortcuts,
  findCommandByShortcut,
  executeCommand,
  clearFullscreenPreview: () => {
    isFullscreenPreview.value = false;
  },
  toggleFocusMode: () => settingsStore.toggleFocusMode(),
  showImagePasteWarning: (msg) => message(msg, { title: '粘贴图片', kind: 'warning' }),
  resetViewMode: resetToEditor,
});

useMenuEvents(async (commandId) => {
  await executeCommand(commandId, 'menu');
});

// ── 窗口控制 ──────────────────────────────────────────────
async function handleMinimize() {
  await getCurrentWindow().minimize();
}

async function handleMaximize() {
  const win = getCurrentWindow();
  if (await win.isMaximized()) {
    await win.unmaximize();
  } else {
    await win.maximize();
  }
}

async function handleClose() {
  try {
    await windowSession.handleCloseRequest();
  } catch (e) {
    console.error('[handleClose] close failed, forcing destroy:', e);
    await destroyCurrentWindow();
  }
}

onMounted(async () => {
  try {
    await Promise.all([
      settingsStore.init(),
      windowSession.setup(),
      syncMenuShortcuts(),
    ]);
  } catch (e) {
    console.error('[App] onMounted init failed:', e);
  }
});

onUnmounted(() => {
  windowSession.cleanup();
  stopWatchingMenuShortcuts();
});
</script>

<template>
  <div
    class="app-root h-screen flex flex-col overflow-hidden select-none"
    :class="{ 'focus-mode': settingsStore.isFocusMode }"
  >
    <WindowResizeHandles />

    <CustomTitlebar
      :title="windowTitle"
      :file-path="fileStore.currentFile.path"
      :display-name="fileStore.currentFile.displayName"
      :auto-hide="settingsStore.settings.titlebarAutoHide"
      :always-on-top="settingsStore.settings.alwaysOnTop"
      :focus-mode="settingsStore.isFocusMode"
      @rename="handleRename"
      @minimize="handleMinimize"
      @maximize="handleMaximize"
      @close="handleClose"
      @toggle-always-on-top="settingsStore.toggleAlwaysOnTop()"
      @toggle-focus-mode="settingsStore.toggleFocusMode()"
    />

    <main class="flex-1 relative overflow-hidden select-text">
      <ErrorBoundary>
        <MarkdownEditor
          v-if="activeViewMode === 'editor'"
          ref="editorRef"
          :initial-content="fileStore.currentFile.content"
          @update="handleEditorUpdate"
          @image-dblclick="openFullscreenPreview"
        />

        <ImagePreviewView
          v-else-if="activeViewMode === 'image' && imagePreviewUrl"
          :image-url="imagePreviewUrl"
          @open-fullscreen="isFullscreenPreview = true"
        />
      </ErrorBoundary>
    </main>

    <!-- 极简状态栏 -->
    <div
      class="statusbar-container transition-opacity duration-300"
      :class="{ 'opacity-0 pointer-events-none': settingsStore.isFocusMode }"
    >
      <div class="minimal-statusbar">
        <div class="statusbar-left">
          <span class="statusbar-brand">solo</span>
          <span v-if="focusModeNotice" class="statusbar-stat statusbar-stat--accent">{{ focusModeNotice.message }}</span>
          <span v-else-if="stats.selectionText" class="statusbar-stat statusbar-stat--accent">{{ stats.selectionText.length }} 字选中</span>
          <span v-else-if="externalFileWarning" class="statusbar-stat statusbar-stat--warn">{{ externalFileWarning }}</span>
          <span v-else class="statusbar-stat">{{ stats.wordCount }} 字</span>
        </div>
        <div class="statusbar-right">
          <span v-if="autoSaveStatus" class="statusbar-stat statusbar-stat--success">{{ autoSaveStatus.message }}</span>
          <button
            v-else
            class="statusbar-save-btn"
            :class="fileStore.currentFile.isDirty ? 'is-dirty' : 'is-clean'"
            :title="fileStore.currentFile.isDirty ? '点击保存 (Ctrl+S)' : '已保存'"
            @click="fileStore.currentFile.isDirty && documentSession.saveCurrentDocument()"
          >
            <span class="statusbar-save-dot" />
            {{ fileStore.currentFile.isDirty ? '未保存' : '已保存' }}
          </button>

          <!-- 快捷入口：主题/字体/导出 直达弹出菜单 -->
          <StatusbarQuickActions
            :export-html="exportHtml"
            :export-pdf="exportPdf"
            :copy-to-wechat="copyToWechat"
          />

          <button
            class="statusbar-settings-btn"
            title="设置 (Ctrl+,)"
            @click="settingsStore.openModal()"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="8" cy="8" r="2.2" />
              <path d="M13.1 10a1.2 1.2 0 0 0 .24 1.32l.04.04a1.45 1.45 0 1 1-2.06 2.06l-.04-.04a1.2 1.2 0 0 0-1.32-.24 1.2 1.2 0 0 0-.73 1.1v.11a1.45 1.45 0 1 1-2.9 0v-.06a1.2 1.2 0 0 0-.79-1.1 1.2 1.2 0 0 0-1.32.24l-.04.04a1.45 1.45 0 1 1-2.06-2.06l.04-.04a1.2 1.2 0 0 0 .24-1.32 1.2 1.2 0 0 0-1.1-.73h-.11a1.45 1.45 0 1 1 0-2.9h.06a1.2 1.2 0 0 0 1.1-.79 1.2 1.2 0 0 0-.24-1.32l-.04-.04a1.45 1.45 0 1 1 2.06-2.06l.04.04a1.2 1.2 0 0 0 1.32.24h.06a1.2 1.2 0 0 0 .73-1.1v-.11a1.45 1.45 0 1 1 2.9 0v.06a1.2 1.2 0 0 0 .73 1.1 1.2 1.2 0 0 0 1.32-.24l.04-.04a1.45 1.45 0 1 1 2.06 2.06l-.04.04a1.2 1.2 0 0 0-.24 1.32v.06a1.2 1.2 0 0 0 1.1.73h.11a1.45 1.45 0 1 1 0 2.9h-.06a1.2 1.2 0 0 0-1.1.73z" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <ErrorBoundary>
      <SettingsModal />
    </ErrorBoundary>

    <ImageFullscreenOverlay
      :visible="isFullscreenPreview && Boolean(imagePreviewUrl)"
      :image-url="imagePreviewUrl || ''"
      @close="closeFullscreenPreview"
      @open-in-viewer="switchToImageView"
    />

    <!-- About 弹窗 -->
    <Teleport to="body">
      <Transition name="about">
        <div
          v-if="showAboutModal"
          class="about-overlay"
          @click.self="showAboutModal = false"
        >
          <div class="about-dialog">
            <div class="about-header">
              <h2 class="about-title">solo</h2>
              <span class="about-version">v{{ appVersion }}</span>
            </div>
            <p class="about-desc">极简 Markdown 编辑器</p>
            <p class="about-sub">基于 Tauri 2 · Rust · Vue 3 · TipTap</p>
            <button class="about-close" @click="showAboutModal = false">关闭</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.app-root {
  background-color: var(--bg-color);
  color: var(--text-color);
}

/* ── 极简状态栏 ──────────────────────────────────────────────
   设计标准：38px 高度，上下留白充足，图标按钮 32×32 命中区，
   描边 1.4 保持清晰，hover 态有微妙背景反馈。
   参考线性：Linear / Raycast 状态栏的呼吸感与克制配色。 */
.minimal-statusbar {
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  opacity: 0.55;
  transition: opacity 0.25s ease;
  user-select: none;
}

.minimal-statusbar:hover {
  opacity: 0.78;
}

.statusbar-left,
.statusbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.statusbar-brand {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary-color);
  letter-spacing: 0.06em;
  opacity: 0.7;
  text-transform: lowercase;
}

.statusbar-stat {
  color: var(--text-secondary);
  font-weight: 500;
  white-space: nowrap;
}

.statusbar-stat--accent {
  color: var(--primary-color);
  font-weight: 600;
}

.statusbar-stat--warn {
  color: var(--warning-color);
}

.statusbar-stat--success {
  color: var(--success-color);
}

/* ── 保存状态按钮：圆点 + 文字，状态色克制 ──────────────── */
.statusbar-save-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--text-secondary);
  transition: background-color 0.15s, color 0.15s;
}

.statusbar-save-btn:hover {
  background-color: var(--hover-bg);
  color: var(--text-color);
}

.statusbar-save-btn.is-dirty {
  color: #c08a5a;
}

.statusbar-save-btn.is-clean {
  color: var(--success-color);
}

.statusbar-save-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: currentColor;
  flex-shrink: 0;
}

/* ── 设置按钮：与其它图标按钮统一规格 ──────────────────── */
.statusbar-settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 0.15s, color 0.15s, opacity 0.15s;
  opacity: 0.6;
}

.statusbar-settings-btn:hover {
  background-color: var(--hover-bg);
  color: var(--text-color);
  opacity: 1;
}

/* ── About 弹窗 ────────────────────────────────────── */
.about-overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--modal-overlay);
  backdrop-filter: blur(4px);
}

.about-dialog {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xl);
  box-shadow: var(--modal-shadow);
  padding: 36px 40px 32px;
  text-align: center;
  max-width: 320px;
}

.about-header {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 10px;
  margin-bottom: 12px;
}

.about-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-color);
  letter-spacing: -0.02em;
  margin: 0;
}

.about-version {
  font-size: 13px;
  font-weight: 500;
  color: var(--muted-color);
  font-variant-numeric: tabular-nums;
}

.about-desc {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0 0 4px;
}

.about-sub {
  font-size: 12px;
  color: var(--muted-color);
  margin: 0 0 20px;
}

.about-close {
  padding: 8px 28px;
  border-radius: var(--radius-md);
  border: none;
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s;
}

.about-close:hover {
  background: var(--btn-primary-hover);
}

/* ── About 弹窗过渡动画 ──────────────────────────── */
.about-enter-active,
.about-leave-active {
  transition: opacity 0.2s ease;
}

.about-enter-active .about-dialog,
.about-leave-active .about-dialog {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.about-enter-from,
.about-leave-to {
  opacity: 0;
}

.about-enter-from .about-dialog,
.about-leave-to .about-dialog {
  transform: scale(0.95);
  opacity: 0;
}
</style>

<style>
/* 暗色主题下的未保存色调整：保持柔和，避免刺眼 */
html.dark .statusbar-save-btn.is-dirty {
  color: #d4a888;
}
</style>
