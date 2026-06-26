import type { Ref } from 'vue';
import { onUnmounted, watch } from 'vue';
import type { AppOpenPathsPayload } from '../services/tauri/events';
import { listenWindowCloseRequested } from '../services/tauri/events';
import { subscribeDragDrop } from '../services/tauri/webview';
import {
  consumeStartupOpenRequest,
  destroyCurrentWindow,
  isCurrentWindowFullscreen,
  notifyFrontendReady,
  registerShellNew,
  setCurrentWindowFullscreen,
  setCurrentWindowTitle,
} from '../services/tauri/window';
import { saveAllWindowState } from '../services/tauri/window-state';

interface AppWindowSessionOptions {
  openDocument: (path: string) => void | Promise<void>;
  saveDocument: () => Promise<boolean>;
  isDirty: () => boolean;
  windowTitle: Ref<string>;
  /** 是否启用 Windows Shell 集成（注册表文件关联） */
  shellIntegration: () => boolean;
}

/** 当前打开的确认弹窗的清理函数，供外部（如组件 unmount 时）强制关闭 */
let pendingDialogCleanup: (() => void) | null = null;

export function confirmUnsavedChanges(): Promise<'save' | 'discard' | 'cancel'> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'unsaved-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'unsaved-dialog';
    dialog.innerHTML = `
      <div class="unsaved-dialog-inner">
        <h3 class="unsaved-title">未保存的更改</h3>
        <p class="unsaved-message">文件内容尚未保存。</p>
        <div class="unsaved-actions">
          <button class="unsaved-btn unsaved-btn--save" data-action="save">保存</button>
          <button class="unsaved-btn unsaved-btn--discard" data-action="discard">不保存</button>
          <button class="unsaved-btn unsaved-btn--cancel" data-action="cancel">取消</button>
        </div>
      </div>
    `;

    overlay.appendChild(dialog);

    let resolved = false;

    function cleanup() {
      overlay.remove();
      document.removeEventListener('keydown', handleKeyDown);
      dialog.removeEventListener('click', handleClick);
      pendingDialogCleanup = null;
    }

    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest('[data-action]');
      if (!target) return;
      const action = (target as HTMLElement).dataset.action as 'save' | 'discard' | 'cancel';
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(action);
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve('cancel');
      }
    }

    // 注册外部清理路径：组件 unmount 时可强制关闭弹窗
    pendingDialogCleanup = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve('cancel');
    };

    dialog.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    document.body.appendChild(overlay);

    const firstBtn = dialog.querySelector('[data-action]') as HTMLButtonElement | null;
    firstBtn?.focus();
  });
}

export function useAppWindowSession(options: AppWindowSessionOptions) {
  let unlistenCloseRequest: (() => void) | null = null;
  let unlistenDragDrop: (() => void) | null = null;
  let removeDragOverListener: (() => void) | null = null;
  let removeDropListener: (() => void) | null = null;
  let stopTitleWatcher: (() => void) | null = null;

  async function handleOpenPayload(payload: AppOpenPathsPayload | null | undefined) {
    if (!payload?.paths?.length) {
      return;
    }
    for (const path of payload.paths) {
      if (!path) continue;
      await options.openDocument(path);
    }
  }

  async function handleCloseRequest() {
    if (options.isDirty()) {
      const result = await confirmUnsavedChanges();
      if (result === 'cancel') {
        return;
      }
      if (result === 'save') {
        const saved = await options.saveDocument();
        if (!saved) {
          return;
        }
      }
    }

    // 先保存窗口状态，再销毁窗口，避免窗口关闭后状态丢失
    try {
      await saveAllWindowState();
    } catch {
      // 窗口状态保存失败不影响关闭流程
    }
    await destroyCurrentWindow();
  }

  async function setupDragDrop() {
    const preventNavigation = (event: DragEvent) => {
      event.preventDefault();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('dragover', preventNavigation);
      document.addEventListener('drop', preventNavigation);
      removeDragOverListener = () => {
        document.removeEventListener('dragover', preventNavigation);
      };
      removeDropListener = () => {
        document.removeEventListener('drop', preventNavigation);
      };
    }

    // 使用共享拖拽监听器：与图片拖入共用同一个 Tauri 事件订阅
    unlistenDragDrop = await subscribeDragDrop(async (payload) => {
      const documentPath = payload.paths.find((path) => /\.(md|markdown|txt)$/i.test(path));
      if (documentPath) {
        await options.openDocument(documentPath);
      }
    });
  }

  async function setup() {
    stopTitleWatcher = watch(
      options.windowTitle,
      (title) => {
        setCurrentWindowTitle(title).catch((error: string) => {
          if (!String(error).includes('window.set_title not allowed')) {
            console.error('Failed to set window title:', error);
          }
        });
      },
      { immediate: true },
    );

    unlistenCloseRequest = await listenWindowCloseRequested(async () => {
      await handleCloseRequest();
    });

    await handleOpenPayload(await consumeStartupOpenRequest());
    await setupDragDrop();
    await handleOpenPayload(await notifyFrontendReady());

    // 仅在用户启用 Shell 集成时注册 Windows 右键"新建 Markdown 文档"
    if (options.shellIntegration()) {
      await registerShellNew().catch((e) => console.warn('[ShellNew] registration failed:', e));
    }
  }

  function cleanup() {
    // 关闭可能残留的确认弹窗，防止 DOM/监听器泄漏
    pendingDialogCleanup?.();
    pendingDialogCleanup = null;

    unlistenCloseRequest?.();
    unlistenCloseRequest = null;
    unlistenDragDrop?.();
    unlistenDragDrop = null;
    removeDragOverListener?.();
    removeDragOverListener = null;
    removeDropListener?.();
    removeDropListener = null;
    stopTitleWatcher?.();
    stopTitleWatcher = null;
  }

  async function toggleFullscreen() {
    await setCurrentWindowFullscreen(!(await isCurrentWindowFullscreen()));
  }

  async function handleQuit() {
    await handleCloseRequest();
  }

  onUnmounted(cleanup);

  return {
    setup,
    cleanup,
    toggleFullscreen,
    handleQuit,
    handleCloseRequest,
  };
}
