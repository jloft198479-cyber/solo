import { onUnmounted, ref, watch } from 'vue';
import {
  openDocument,
  saveDocument,
  renameFile,
  getFileMtime,
  type DocumentOpenResult,
} from '../services/tauri/document';
import { normalizeTauriError } from '../services/tauri/client';
import { confirm, message, open, save } from '../services/tauri/dialog';
import { useFileStore } from '../stores/file';
import { DEFAULT_DISPLAY_NAME } from '../stores/file';
import { useSettingsStore } from '../stores/settings';
import {
  countVisibleChars,
  resolveDocumentTier,
  setDocumentTier,
  HEAVY_DOC_CHARS,
} from '../components/Editor/document-scale';

export interface AutoSaveStatus {
  message: string;
  timestamp: number;
}

interface DocumentSessionOptions {
  resetViewMode: () => void;
  /** 从编辑器实时获取最新内容（绕过 store 防抖延迟）。编辑器不可用时返回 null。 */
  getContent?: () => string | null;
  /**
   * store 基线是否已等于编辑器当前 doc 的序列化产物。
   * true ⇒ isDirty 已是真相，闸口可直接返回，省掉一次全文序列化（大文档关窗卡死的主因）。
   * 未提供时一律走 getContent 兜底，保守但正确。
   */
  isSyncedWithStore?: () => boolean;
}

export function useDocumentSession(options: DocumentSessionOptions) {
  const fileStore = useFileStore();
  const settingsStore = useSettingsStore();

  const autoSaveStatus = ref<AutoSaveStatus | null>(null);
  const externalFileWarning = ref<string | null>(null);

  let autoSaveIntervalId: ReturnType<typeof setTimeout> | null = null;
  let autoSaveStatusTimer: ReturnType<typeof setTimeout> | null = null;
  let externalWarningTimer: ReturnType<typeof setTimeout> | null = null;
  /** 保存互斥锁：防止自动保存与手动保存并发执行导致冲突 */
  let isSaving = false;
  /** 文件打开互斥锁：防止同时打开两个文件导致编辑器状态竞争 */
  let isOpeningFile = false;
  /** 自动保存是否应继续运行（用户关闭/禁用时停止递归） */
  let autoSaveActive = false;

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

  async function loadDocumentFromPath(path: string, silent = false): Promise<boolean> {
    if (isOpeningFile) return false;
    isOpeningFile = true;
    try {
      fileStore.setLoading(true);
      const document = await openDocument(path);

      // 加载完成，取消 loading 避免阻塞 UI 交互
      fileStore.setLoading(false);

      // 档位判定放在 loading=false 之后：extreme 档要弹确认框，不能压在 loading 遮罩下。
      // 度量剔除 base64 内嵌图片——它们渲染成独立节点，不参与编辑期的全文遍历。
      const textLength = countVisibleChars(document.content);
      const tier = resolveDocumentTier(textLength);
      if (tier === 'extreme') {
        const sizeMB = (textLength / (1024 * 1024)).toFixed(1);
        const proceed = await confirm(
          `该文件约 ${sizeMB} MB，逐字符遍历的编辑特性（序列化、大纲、搜索）会明显变慢。` +
            `仍要打开编辑吗？\n` +
            `（${(HEAVY_DOC_CHARS / 10_000).toFixed(0)} 万字符以上还会自动暂停代码自动语言检测、焦点模式装饰和实时字数）`,
          { title: '超大文件提示', kind: 'warning', okLabel: '继续编辑', cancelLabel: '取消' },
        );
        if (!proceed) {
          return false;
        }
      }

      fileStore.setLoading(true);
      // 必须在写入 store 之前发布档位：store 变化会立刻触发编辑器解析文档，
      // 插件在解析阶段就要按档位决定建不建装饰、做不做自动语言检测。
      setDocumentTier(tier);
      applyLoadedDocument(document);
      return true;
    } catch (error) {
      // silent 模式：启动/恢复场景下，路径可能指向已被移动/删除的文件，
      // 把错误抛给外层（如 useAppWindowSession.handleOpenPayload）做静默跳过，
      // 避免在用户没主动操作时弹"打开文件失败"对话框。
      if (silent) throw error;
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

  /** 闸口前强制用编辑器实时内容评估脏态（坑2）：绕开 500ms 序列化防抖，
   * 避免「编辑后 <500ms 就关窗/切换」时 store 还是旧基线而误判未修改、丢最后半秒编辑。
   * 快路径：store 基线已追上当前 doc 的序列化结果时，isDirty 本身就是真相，
   * 直接返回不再 getContent()——4MB 文档「打开后立刻关窗」的那一次全量序列化就是卡死来源。 */
  function evaluateDirtyFromEditor() {
    if (options.isSyncedWithStore?.()) {
      return fileStore.currentFile.isDirty;
    }
    const live = options.getContent?.();
    if (live == null) return fileStore.currentFile.isDirty;
    fileStore.syncEditedContent(live);
    return fileStore.currentFile.isDirty;
  }

  async function confirmDiscardUnsavedChanges() {
    if (!fileStore.currentFile.path && !fileStore.currentFile.content.trim()) {
      return true;
    }
    evaluateDirtyFromEditor();
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

  async function openDocumentWithPrompt(path: string, silent = false): Promise<boolean> {
    if (!(await confirmDiscardUnsavedChanges())) {
      return false;
    }

    const loaded = await loadDocumentFromPath(path, silent);
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
    // 必须先复位档位再写 store：新建文档不该继承上一个超大文档的降级设置。
    setDocumentTier('normal');
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
    // 注意：这里绝不提前回写 store 基线——基线只能在保存成功后同步
    // （markSaved(result, content) / setFile）。失败/冲突取消时若基线已被
    // 污染，后续 syncEditedContent 语义比对会因「内容未变」把脏标洗白，
    // 未保存编辑静默丢失（关窗不弹确认、自动保存不再重试）。
    const result = await saveDocument(path, content, expectedLastModifiedMs, force);
    return { result, content };
  }

  /** 自动保存连续失败计数：首次弹 modal，后续降级为状态栏非阻塞提示。
   * 手动保存成功后重置。避免磁盘满/权限拒绝时每 5s 弹一次 modal 轰炸用户。 */
  let autoSaveFailCount = 0;
  const AUTO_SAVE_MAX_MODAL = 1;

  let _savePromise: Promise<boolean> | null = null;

  async function saveCurrentDocument(force = false, manual = false): Promise<boolean> {
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
        const { result, content } = await persistDocument(savePath, force, saveLastModified);
        // 保存成功才同步基线：写入磁盘的内容成为新的语义比对基准
        fileStore.markSaved(result.lastModifiedMs, content);
        autoSaveFailCount = 0;
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
        // 手动保存（Ctrl+S / 状态栏按钮）永远弹 modal；自动保存首次弹 modal，后续降级
        autoSaveFailCount += 1;
        if (manual || autoSaveFailCount <= AUTO_SAVE_MAX_MODAL) {
          await message(`保存失败: ${appError.message}`, { title: '错误', kind: 'error' });
        } else {
          updateAutoSaveStatus(`保存失败: ${appError.message}`);
        }
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
      const { result, content } = await persistDocument(selected, true, null);
      fileStore.setFile(content, result.path, result.lastModifiedMs);
      clearExternalWarning();
      autoSaveFailCount = 0;
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
    // rename 成功后会拿到新路径——即使后续写内容失败，也必须让 store 跟到新路径，
    // 否则磁盘文件已是新名而 store.path 仍指向已不存在的旧路径，下次保存会
    // 再次 rename（报“原文件不存在”）而永久死锁。
    let renamedPath: string | null = null;
    try {
      // 1. Rust fs::rename：原子移动文件到新名字
      const renameResult = await renameFile(currentFile.path, currentFile.displayName);
      renamedPath = renameResult.path;

      // 2. 保存内容到新路径（force=true，因为文件刚被 rename 过来）
      const { result: saveResult, content: savedContent } = await persistDocument(renamedPath, true, null);

      fileStore.setFile(savedContent, saveResult.path, saveResult.lastModifiedMs);
      autoSaveFailCount = 0;
      return true;
    } catch (error) {
      if (renamedPath) {
        // 磁盘文件已是新名，同步 store 路径；isDirty 保持 true，
        // 下次保存走正常分支直写新路径即可，不会死锁。
        fileStore.renamePath(renamedPath);
      }
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

  /**
   * 检查当前文件是否被外部修改。
   * 在窗口获得焦点时调用，对比磁盘 mtime 与上次保存/加载时记录的 mtime。
   * - 有未保存编辑（脏态）：提示用户存在外部修改，让用户决定保留自己的还是丢弃重加载。
   * - 无未保存编辑：静默重新加载（避免用户看到陈旧内容）。
   */
  async function checkExternalModification(): Promise<void> {
    const path = fileStore.currentFile.path;
    if (!path) return;
    // 正在保存/打开时跳过，避免与自身保存触发的 mtime 变化冲突
    if (isSaving || isOpeningFile) return;

    try {
      const diskMtime = await getFileMtime(path);
      const baseline = fileStore.currentFile.lastModifiedTime;
      if (baseline !== null && diskMtime === baseline) return;

      // mtime 不同 → 外部修改了文件，统一提示用户决定是否重新加载
      // （无脏态也提示——静默重载会丢失光标/滚动位置，打断阅读）
      externalFileWarning.value = '文件已被外部修改，点击重新加载';
      if (externalWarningTimer) clearTimeout(externalWarningTimer);
      externalWarningTimer = setTimeout(() => {
        externalFileWarning.value = null;
      }, 30_000);
    } catch (error) {
      // 获取 mtime 失败（文件可能被删除/移动）：跳过本次检查，但留痕便于排查
      console.warn('[external-check] getFileMtime failed:', error);
    }
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

          if (fileStore.currentFile.isDirty && fileStore.currentFile.path) {
            const saved = await saveCurrentDocument(false);
            if (saved) {
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
    evaluateDirtyFromEditor,
    checkExternalModification,
    clearExternalWarning,
  };
}
