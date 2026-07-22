<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppWindowSession } from './composables/useAppWindowSession';
import { useCommandDispatcher } from './composables/useCommandDispatcher';
import { useAppDomEvents } from './composables/useAppDomEvents';
import { useAppEditorState } from './composables/useAppEditorState';
import { useDocumentSession } from './composables/useDocumentSession';
import { invokeCommand } from './services/tauri/client';
import { TAURI_COMMANDS } from './services/tauri/command-names';
import { useImagePreview } from './composables/useImagePreview';
import { useMenuEvents } from './composables/useMenuEvents';
import { useMenuShortcutsSync } from './composables/useMenuShortcutsSync';
import CustomTitlebar from './components/Layout/CustomTitlebar.vue';
import ErrorBoundary from './components/Layout/ErrorBoundary.vue';
import ImageFullscreenOverlay from './components/Editor/ImageFullscreenOverlay.vue';
import ImagePreviewView from './components/Editor/ImagePreviewView.vue';
import SettingsModal from './components/Settings/SettingsModal.vue';
import StatusbarQuickActions from './components/StatusbarQuickActions.vue';
import OutlinePanel from './components/Editor/OutlinePanel.vue';
import CommandPalette from './components/CommandPalette.vue';
import WindowResizeHandles from './components/Layout/WindowResizeHandles.vue';
import { useOutline } from './composables/useOutline';
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
const { isOpen: outlineOpen, toggle: toggleOutline, close: closeOutline } = useOutline();

const paletteOpen = ref(false);
function togglePalette() {
  paletteOpen.value = !paletteOpen.value;
}

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
  getContent: () => editorRef.value?.getContent?.() ?? null,
});

async function handleOpenFile(path: string, silent = false) {
  await documentSession.openDocumentWithPrompt(path, silent);
}

/**
 * 标题栏重命名：统一延迟模型。
 * 无论文件是否已保存，都只改 displayName 并标脏。
 * 实际文件重命名在保存时通过 save-as 流程完成，
 * 避免与自动保存的 atomic_write 产生竞态导致文件分裂。
 */
async function handleRename(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === fileStore.currentFile.displayName) return;
  fileStore.setDisplayName(trimmed);
}

const { autoSaveStatus, externalFileWarning } = documentSession;

const focusModeNotice = ref<{ message: string; timestamp: number } | null>(null);
const _focusNoticeTimer = ref<ReturnType<typeof setTimeout> | null>(null);
// 进入焦点模式的引导提示：淡入后 3.5s 自动消失
const focusEnterNotice = ref(false);
const _focusEnterTimer = ref<ReturnType<typeof setTimeout> | null>(null);
onUnmounted(() => {
  if (_focusNoticeTimer.value) clearTimeout(_focusNoticeTimer.value);
  if (_focusEnterTimer.value) clearTimeout(_focusEnterTimer.value);
});
watch(() => settingsStore.isFocusMode, (active) => {
  if (_focusNoticeTimer.value) clearTimeout(_focusNoticeTimer.value);
  if (_focusEnterTimer.value) clearTimeout(_focusEnterTimer.value);
  if (active) {
    focusEnterNotice.value = true;
    _focusEnterTimer.value = setTimeout(() => {
      _focusEnterTimer.value = null;
      focusEnterNotice.value = false;
    }, 3500);
  } else {
    const msg = { message: '已退出焦点模式', timestamp: Date.now() };
    focusModeNotice.value = msg;
    _focusNoticeTimer.value = setTimeout(() => {
      _focusNoticeTimer.value = null;
      if (focusModeNotice.value?.timestamp === msg.timestamp) {
        focusModeNotice.value = null;
      }
    }, 2000);
  }
});

// ── Shell 集成动态注册/注销 ─────────────────────────────────
import { registerShellNew, unregisterShellNew } from './services/tauri/window';
import { isWindows } from './utils/platform';

watch(
  () => settingsStore.settings.shellIntegration,
  async (enabled) => {
    if (!isWindows) return;
    try {
      if (enabled) {
        await registerShellNew();
      } else {
        await unregisterShellNew();
      }
    } catch (e) {
      console.warn('[ShellIntegration] toggle failed:', e);
    }
  },
);

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
  shellIntegration: () => settingsStore.settings.shellIntegration,
  stopAutoSave: documentSession.stopAutoSave,
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
  toggleOutline: toggleOutline,
  toggleCommandPalette: togglePalette,
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
    // 阶段3：只加载主题和背景色，立即启动窗口会话（触发 startupReady 显示窗口）
    await settingsStore.initThemeOnly();
    await windowSession.setup();
    // 阶段4：窗口已可见，后台加载完整配置、初始化主题列表、启动 watcher
    await Promise.all([
      settingsStore.init(),
      syncMenuShortcuts(),
    ]);
    autoCheckForUpdate();
  } catch (e) {
    console.error('[App] onMounted init failed:', e);
  }
});

async function autoCheckForUpdate() {
  if (!settings.value.enableAutoUpdateCheck) return;
  try {
    // 先尝试检测代理
    await invokeCommand<string>(TAURI_COMMANDS.detectProxyForUpdate).catch(() => {});
    const { check } = await import('@tauri-apps/plugin-updater');
    await check();
  } catch {
    // 静默忽略网络错误，不打扰用户
  }
}

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
      @toggle-outline="toggleOutline"
      :outline-open="outlineOpen"
    />

    <main class="flex-1 relative overflow-hidden select-text flex">
      <!-- 焦点模式进入引导：移动到顶部退出聚焦 -->
      <Transition name="focus-hint">
        <div v-if="focusEnterNotice" class="focus-enter-hint">移到顶部退出聚焦</div>
      </Transition>

      <ErrorBoundary class="editor-area">
        <MarkdownEditor
          v-if="activeViewMode === 'editor'"
          ref="editorRef"
          :initial-content="fileStore.currentFile.content"
          @update="handleEditorUpdate"
          @image-dblclick="openFullscreenPreview"
          @navigate-wikilink="handleOpenFile"
        />

        <ImagePreviewView
          v-else-if="activeViewMode === 'image' && imagePreviewUrl"
          :image-url="imagePreviewUrl"
          @open-fullscreen="isFullscreenPreview = true"
        />
      </ErrorBoundary>

      <OutlinePanel
        :is-open="outlineOpen"
        :items="stats.outline"
        :editor-ref="editorRef"
        @close="closeOutline"
      />
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

          <!-- 快捷入口：主题/字体 直达弹出菜单 -->
          <StatusbarQuickActions />

          <button
            class="statusbar-settings-btn"
            title="设置 (Ctrl+,)"
            @click="settingsStore.openModal()"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="8" cy="8" r="2.2" />
              <path d="M13.1 10a1.2 1.2 0 0 0 .24 1.32l.04.04a1.45 1.45 0 1 1-2.06 2.06l-.04-.04a1.2 1.2 0 0 0-1.32-.24 1.2 1.2 0 0 0-.73 1.1v.11a1.45 1.45 0 1 1-2.9 0v-.06a1.2 1.2 0 0 0-.79-1.1 1.2 1.2 0 0 0-1.32.24l-.04.04a1.45 1.45 0 1 1-2.06-2.06l.04-.04a1.2 1.2 0 0 0 .24-1.32 1.2 1.2 0 0 0-1.1-.73h-.11a1.45 1.45 0 1 1 0-2.9h.06a1.2 1.2 0 0 0 1.1-.79 1.2 1.2 0 0 0-.24-1.32l-.04-.04a1.45 1.45 0 1 1 2.06-2.06l.04.04a1.2 1.2 0 0 0 1.32.24h.06a1.2 1.2 0 0 0 .73-1.1v-.11a1.45 1.45 0 1 1 2.9 0v.06a1.2 1.2 0 0 0 .73 1.1 1.2 1.2 0 0 0 1.32-.24l.04-.04a1.45 1.45 0 1 1 2.06 2.06l-.04.04a1.2 1.2 0 0 0-.24 1.32v.06a1.2 1.2 0 0 0 1.1.73h.11a1.45 1.45 0 1 1 0 2.9h-.06a1.2 1.2 0 0 0-1.1.73z" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <ErrorBoundary>
      <KeepAlive>
        <SettingsModal v-if="settingsStore.isModalOpen" />
      </KeepAlive>
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

    <!-- 命令面板：Ctrl+K 唤起 -->
    <CommandPalette
      :open="paletteOpen"
      :execute-command="(id) => executeCommand(id, 'palette')"
      :custom-shortcuts="settings.customShortcuts"
      @close="paletteOpen = false"
    />
  </div>
</template>

<style scoped>
.app-root {
  background-color: var(--bg-color);
  color: var(--text-color);
}

/* ── 编辑区：横向 flex 中占满剩余宽度，outline 展开时让位（push） ── */
.editor-area {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* ── 焦点模式进入引导提示 ──────────────────────────────── */
.focus-enter-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 400;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--popover-bg);
  border: 1px solid var(--border-light);
  border-radius: 999px;
  box-shadow: var(--shadow-md);
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
}

.focus-hint-enter-active,
.focus-hint-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.focus-hint-enter-from,
.focus-hint-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
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
  opacity: 0.9;
  transition: opacity 0.25s ease;
  user-select: none;
}

.minimal-statusbar:hover {
  opacity: 1;
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
  color: var(--primary-color);
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
  color: var(--dirty-color);
}

.statusbar-save-btn.is-clean {
  color: var(--primary-color);
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
  border-radius: var(--radius-lg);
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
