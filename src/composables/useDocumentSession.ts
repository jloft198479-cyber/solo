import { onUnmounted, ref, watch } from 'vue';
import { openDocument, saveDocument, renameFile, type DocumentOpenResult } from '../services/tauri/document';
import { normalizeTauriError } from '../services/tauri/client';
import { confirm, message, open, save } from '../services/tauri/dialog';
import { useFileStore } from '../stores/file';
import { DEFAULT_DISPLAY_NAME } from '../stores/file';
import { useSettingsStore } from '../stores/settings';

export interface AutoSaveStatus {
  message: string;
  timestamp: number;
}

interface DocumentSessionOptions {
  resetViewMode: () => void;
  /** 从编辑器实时获取最新内容（绕过 store 防抖延迟）。编辑器不可用时返回 null。 */
  getContent?: () => string | null;
}

export function useDocumentSession(options: DocumentSessionOptions) {
  const fileStore = useFileStore();
  const settingsStore = useSettingsStore();

  const autoSaveStatus = ref<AutoSaveStatus | null>(null);
  const externalFileWarning = ref<string | null>(null);

  let autoSaveIntervalId: ReturnType<typeof setTimeout> | null = null;
  let autoSaveStatusTimer: ReturnType<typeof setTimeout> | null = null;
  let externalWarningTimer: ReturnType<typeof setTimeout> | null = null;
  let autoSavePaused = false;
  /** 保存互斥锁：防止自动保存与手动保存并发执行导致冲突 */
  let isSaving = false;
  /** 文件打开互斥锁：防止同时打开两个文件导致编辑器状态竞争 */
  let isOpeningFile = false;
  /** 自动保存是否应继续运行（用户关闭/禁用时停止递归） */
  let autoSaveActive = false;

  /** 大文档阈值（字符数），超过此值弹出提示 */
  const LARGE_DOC_THRESHOLD = 100_000;
  /** 自动保存状态消息展示时长（毫秒），超时后自动清除 */
  const AUTOSAVE_STATUS_DISPLAY_MS = 2000;
  /** 自动保存间隔下限（秒），与 settings store 保持一致 */
  const MIN_AUTOSAVE_INTERVAL_SECONDS = 5;

  /**
   * 为另存为对话框生成预填的文件名。
   * - 标题为空 / 默认占位时回退到 `untitled-{时间戳}.md`，避免多次新建产生同名冲突
   * - 过滤文件系统非法字符（跨平台：Windows / macOS / Linux）
   * - 采用行业惯例（VSCode / Typora / Sublime）：仅支持 markdown，自动补 `.md` 扩展名
   */
  function buildDefaultSavePath(displayName: string, now: number = Date.now()): string {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === DEFAULT_DISPLAY_NAME) {
      return `untitled-${now}.md`;
    }
    // 过滤 Windows + macOS + Linux 文件系统非法字符
    const sanitized = trimmed.replace(/[/\\:*?"<>|]/g, '_');
    return `${sanitized}.md`;
  }

  async function loadDocumentFromPath(path: string): Promise<boolean> {
    if (isOpeningFile) return false;
    isOpeningFile = true;
    try {
      fileStore.setLoading(true);
      const document = await openDocument(path);

      // 加载完成，取消 loading 避免阻塞 UI 交互
      fileStore.setLoading(false);

      // 大文档提示（此时 loading=false，不会阻塞确认对话框）
      // 排除 base64 图片数据：图片渲染为独立节点，不影响编辑打字性能
      const textContent = document.content.indexOf('data:image') >= 0
        ? document.content.replace(/!\[.*?\]\(data:image\/[^;]+;base64,[^)]+\)/g, '')
        : document.content;
      if (textContent.length > LARGE_DOC_THRESHOLD) {
        const sizeKB = Math.round(textContent.length / 1024);
        const proceed = await confirm(
          `该文件较大（约 ${sizeKB} KB），编辑器可能会变慢。是否继续打开？`,
          { title: '大文件提示', kind: 'warning', okLabel: '继续打开', cancelLabel: '取消' },
        );
        if (!proceed) {
          return false;
        }
      }

      fileStore.setLoading(true);
      applyLoadedDocument(document);
      return true;
    } catch (error) {
      const { message: errorMessage } = normalizeTauriError(error);
      console.error('Failed to open document:', errorMessage);
      await message(`打开文件失败: ${errorMessage}`, { title: '错误', kind: 'error' });
      return false;
    } finally {
      fileStore.setLoading(false);
      isOpeningFile = false;
    }
  }

  function applyLoadedDocument(document: DocumentOpenResult) {
    fileStore.setFile(document.content, document.path, document.lastModifiedMs);
  }

  async function confirmDiscardUnsavedChanges() {
    if (!fileStore.currentFile.path && !fileStore.currentFile.content.trim()) {
      return true;
    }
    if (!fileStore.currentFile.isDirty) {
      return true;
    }

    return confirm('当前文件有未保存的更改，是否放弃更改？', {
      title: '未保存的更改',
      kind: 'warning',
      okLabel: '放弃更改',
      cancelLabel: '取消',
    });
  }

  async function openDocumentWithPrompt(path: string) {
    if (!(await confirmDiscardUnsavedChanges())) {
      return false;
    }

    const loaded = await loadDocumentFromPath(path);
    if (loaded) {
      clearExternalWarning();
      options.resetViewMode();
    }
    return loaded;
  }

  async function handleNewDocument() {
    if (!(await confirmDiscardUnsavedChanges())) {
      return;
    }

    clearExternalWarning();
    fileStore.reset();
    options.resetViewMode();
  }

  async function handleOpenDocument() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    });
    if (selected && typeof selected === 'string') {
      await openDocumentWithPrompt(selected);
    }
  }

  async function persistDocument(
    path: string,
    force: boolean,
    expectedLastModifiedMs?: number | null,
  ) {
    // 优先从编辑器实时取内容，避免防抖延迟导致保存旧内容
    const content = options.getContent?.() ?? fileStore.currentFile.content;
    // 同步 store 基线：保存后 markSaved 清脏，防抖回调不会再因内容差异重新标脏
    fileStore.currentFile.content = content;
    return saveDocument(path, content, expectedLastModifiedMs, force);
  }

  let _savePromise: Promise<boolean> | null = null;

  async function saveCurrentDocument(force = false): Promise<boolean> {
    if (_savePromise) {
      await _savePromise;
    }

    const currentFile = fileStore.currentFile;
    if (!currentFile.path) {
      return saveCurrentDocumentAs();
    }

    if (currentFile.displayName !== currentFile.originalBaseName) {
      return saveRenamedDocument();
    }

    isSaving = true;
    const savePath = currentFile.path;
    const saveLastModified = currentFile.lastModifiedTime;
    _savePromise = (async () => {
      try {
        const result = await persistDocument(savePath, force, saveLastModified);
        fileStore.markSaved(result.lastModifiedMs);
        autoSavePaused = false;
        return true;
      } catch (error) {
        const appError = normalizeTauriError(error);
        if (appError.code === 'document_conflict' && !force) {
          const confirmed = await confirm('文件已被外部修改，是否强制覆盖？', {
            title: '检测到冲突',
            kind: 'warning',
            okLabel: '强制覆盖',
            cancelLabel: '取消',
          });
          if (!confirmed) {
            return false;
          }
          _savePromise = null;
          return saveCurrentDocument(true);
        }

        console.error('Failed to save document:', appError.message);
        await message(`保存失败: ${appError.message}`, { title: '错误', kind: 'error' });
        return false;
      }
    })();

    const result = await _savePromise;
    isSaving = false;
    _savePromise = null;
    return result;
  }

  async function saveCurrentDocumentAs(): Promise<boolean> {
    // 另存为也需要互斥锁
    if (isSaving) {
      return false;
    }

    const selected = await save({
      defaultPath: buildDefaultSavePath(fileStore.currentFile.displayName),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!selected) {
      return false;
    }

    isSaving = true;
    try {
      const result = await persistDocument(selected, true, null);
      fileStore.setFile(fileStore.currentFile.content, result.path, result.lastModifiedMs);
      clearExternalWarning();
      return true;
    } catch (error) {
      const appError = normalizeTauriError(error);
      console.error('Failed to save document:', appError.message);
      await message(`保存失败: ${appError.message}`, { title: '错误', kind: 'error' });
      return false;
    } finally {
      isSaving = false;
    }
  }

  /**
   * 标题栏重命名后的保存：先用 Rust rename 移动文件到新名字，
   * 再把内容写入新路径。受 isSaving 互斥保护，不会与自动保存竞态。
   */
  async function saveRenamedDocument(): Promise<boolean> {
    if (isSaving) return false;

    const currentFile = fileStore.currentFile;
    if (!currentFile.path) return saveCurrentDocumentAs();

    isSaving = true;
    try {
      // 1. Rust fs::rename：原子移动文件到新名字
      const renameResult = await renameFile(currentFile.path, currentFile.displayName);

      // 2. 保存内容到新路径（force=true，因为文件刚被 rename 过来）
      const saveResult = await persistDocument(renameResult.path, true, null);

      fileStore.setFile(fileStore.currentFile.content, saveResult.path, saveResult.lastModifiedMs);
      autoSavePaused = false;
      return true;
    } catch (error) {
      const appError = normalizeTauriError(error);
      console.error('Failed to save renamed document:', appError.message);
      await message(`保存失败: ${appError.message}`, { title: '错误', kind: 'error' });
      return false;
    } finally {
      isSaving = false;
    }
  }

  function clearExternalWarning() {
    if (externalWarningTimer) {
      clearTimeout(externalWarningTimer);
      externalWarningTimer = null;
    }
    externalFileWarning.value = null;
  }

  function updateAutoSaveStatus(messageText: string) {
    if (autoSaveStatusTimer) {
      clearTimeout(autoSaveStatusTimer);
    }

    const timestamp = Date.now();
    autoSaveStatus.value = {
      message: messageText,
      timestamp,
    };
    autoSaveStatusTimer = setTimeout(() => {
      if (autoSaveStatus.value?.timestamp === timestamp) {
        autoSaveStatus.value = null;
      }
    }, AUTOSAVE_STATUS_DISPLAY_MS);
  }

  function stopAutoSave() {
    autoSaveActive = false;
    if (autoSaveIntervalId) {
      clearTimeout(autoSaveIntervalId);
      autoSaveIntervalId = null;
    }
  }

  watch(
    () => [settingsStore.settings.autoSave, settingsStore.settings.autoSaveInterval] as const,
    ([enabled, intervalSeconds]) => {
      stopAutoSave();
      if (!enabled) {
        return;
      }

      // 下限保护：即使配置异常也不会导致过于频繁的保存
      const safeIntervalSeconds = Math.max(intervalSeconds, MIN_AUTOSAVE_INTERVAL_SECONDS);
      autoSaveActive = true;

      // 递归 setTimeout：保存完成后才设下一个 tick，避免并发和跳过
      const scheduleNext = () => {
        if (!autoSaveActive) return;
        autoSaveIntervalId = setTimeout(async () => {
          if (!autoSaveActive) return;

          if (fileStore.currentFile.isDirty && fileStore.currentFile.path && !autoSavePaused) {
            const saved = await saveCurrentDocument(false);
            if (saved) {
              autoSavePaused = false;
              updateAutoSaveStatus('已自动保存');
            }
          }
          // 无论是否实际保存，继续调度下一次
          scheduleNext();
        }, safeIntervalSeconds * 1000);
      };

      scheduleNext();
    },
    { immediate: true },
  );

  onUnmounted(() => {
    stopAutoSave();
    if (autoSaveStatusTimer) {
      clearTimeout(autoSaveStatusTimer);
    }
    clearExternalWarning();
  });

  return {
    autoSaveStatus,
    externalFileWarning,
    loadDocumentFromPath,
    openDocumentWithPrompt,
    handleNewDocument,
    handleOpenDocument,
    saveCurrentDocument,
    saveCurrentDocumentAs,
    stopAutoSave,
  };
}
