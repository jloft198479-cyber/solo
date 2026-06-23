<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted } from 'vue';
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
import { findCommandByShortcut } from './utils/shortcuts';
import { getCurrentWindow } from '@tauri-apps/api/window';
import pkg from '../package.json';

const MarkdownEditor = defineAsyncComponent(() => import('./components/Editor/MarkdownEditor.vue'));

const fileStore = useFileStore();
const settingsStore = useSettingsStore();
const { settings, isLoaded } = storeToRefs(settingsStore);
const appVersion = pkg.version;
const { editorRef, stats, handleEditorUpdate } = useAppEditorState();

const {
  activeViewMode,
  imagePreviewUrl,
  isFullscreenPreview,
  closeFullscreenPreview,
  resetToEditor,
} = useImagePreview();

const documentSession = useDocumentSession({
  resetViewMode: resetToEditor,
});

async function handleOpenFile(path: string) {
  await documentSession.openDocumentWithPrompt(path);
}

const { autoSaveStatus, externalFileWarning } = documentSession;

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

function showAbout() {
  message(
    `MD编辑器 v${appVersion}\n\n极简 Markdown 编辑器`,
    {
      title: '关于',
      kind: 'info',
    },
  );
}

const { executeCommand } = useCommandDispatcher({
  editorRef,
  activeViewMode,
  isSourceMode: computed(() => false),
  handleNew: documentSession.handleNewDocument,
  handleOpen: documentSession.handleOpenDocument,
  handleSave: documentSession.saveCurrentDocument,
  handleSaveAs: documentSession.saveCurrentDocumentAs,
  exportHtml,
  exportPdf,
  copyToWechat,
  openSettings: () => settingsStore.openModal(),
  openShortcuts: () => {},
  toggleFocusMode: () => settingsStore.toggleFocusMode(),
  showAbout,
  toggleFullscreen: windowSession.toggleFullscreen,
  handleQuit: windowSession.handleQuit,
});

useAppDomEvents({
  editorRef,
  activeViewMode,
  isSourceMode: computed(() => false),
  isFullscreenPreview,
  isFocusMode: () => settingsStore.isFocusMode,
  customShortcuts: () => settingsStore.settings.customShortcuts,
  findCommandByShortcut,
  executeCommand,
  clearFullscreenPreview: () => {
    isFullscreenPreview.value = false;
  },
  toggleFocusMode: () => settingsStore.toggleFocusMode(),
  showImagePasteWarning: () => {},
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
  await getCurrentWindow().close();
}

onMounted(async () => {
  await settingsStore.init();
  await windowSession.setup();
  await syncMenuShortcuts();
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
      @rename="fileStore.setDisplayName"
      @minimize="handleMinimize"
      @maximize="handleMaximize"
      @close="handleClose"
    />

    <main
      class="flex-1 relative overflow-hidden select-text"
      :class="{ 'focus-mode-editor': settingsStore.isFocusMode }"
    >
      <ErrorBoundary>
        <MarkdownEditor
          v-if="activeViewMode === 'editor'"
          ref="editorRef"
          :initial-content="fileStore.currentFile.content"
          @update="handleEditorUpdate"
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
          <span v-if="stats.selectionText" class="statusbar-stat statusbar-stat--accent">{{ stats.selectionText.length }} 字选中</span>
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
              <circle cx="8" cy="8" r="2.2"/>
              <path d="M13.1 10a1.2 1.2 0 0 0 .24 1.32l.04.04a1.45 1.45 0 1 1-2.06 2.06l-.04-.04a1.2 1.2 0 0 0-1.32-.24 1.2 1.2 0 0 0-.73 1.1v.11a1.45 1.45 0 1 1-2.9 0v-.06a1.2 1.2 0 0 0-.79-1.1 1.2 1.2 0 0 0-1.32.24l-.04.04a1.45 1.45 0 1 1-2.06-2.06l.04-.04a1.2 1.2 0 0 0 .24-1.32 1.2 1.2 0 0 0-1.1-.73h-.11a1.45 1.45 0 1 1 0-2.9h.06a1.2 1.2 0 0 0 1.1-.79 1.2 1.2 0 0 0-.24-1.32l-.04-.04a1.45 1.45 0 1 1 2.06-2.06l.04.04a1.2 1.2 0 0 0 1.32.24h.06a1.2 1.2 0 0 0 .73-1.1v-.11a1.45 1.45 0 1 1 2.9 0v.06a1.2 1.2 0 0 0 .73 1.1 1.2 1.2 0 0 0 1.32-.24l.04-.04a1.45 1.45 0 1 1 2.06 2.06l-.04.04a1.2 1.2 0 0 0-.24 1.32v.06a1.2 1.2 0 0 0 1.1.73h.11a1.45 1.45 0 1 1 0 2.9h-.06a1.2 1.2 0 0 0-1.1.73z"/>
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
    />
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
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  opacity: 0.62;
  transition: opacity 0.25s ease;
  user-select: none;
}

.minimal-statusbar:hover {
  opacity: 0.92;
}

.statusbar-left,
.statusbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
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
</style>

<style>
/* 暗色主题下的未保存色调整：保持柔和，避免刺眼 */
html.dark .statusbar-save-btn.is-dirty {
  color: #d4a888;
}
</style>
