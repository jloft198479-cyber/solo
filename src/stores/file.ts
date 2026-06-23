import { defineStore } from 'pinia';

/** 默认显示名称 / 无标题文档占位名 */
export const DEFAULT_DISPLAY_NAME = '未命名';

export interface FileState {
  path: string | null;
  content: string;
  isDirty: boolean;
  lastModifiedTime: number | null;
  /** Display name shown in titlebar (editable by user) */
  displayName: string;
  /**
   * 从 path 提取的原始文件名基础名（去扩展名）。
   * 用于在保存时判断“标题是否被改过”：
   * displayName !== originalBaseName 意味着用户改了标题，下次保存应走另存为。
   */
  originalBaseName: string;
}

interface FileStoreState {
  currentFile: FileState;
  hasUserEdit: boolean;
  isLoading: boolean;
}

function createEmptyFileState(): FileState {
  return {
    path: null,
    content: '',
    isDirty: false,
    lastModifiedTime: null,
    displayName: DEFAULT_DISPLAY_NAME,
    originalBaseName: DEFAULT_DISPLAY_NAME,
  };
}

export const useFileStore = defineStore('file', {
  state: (): FileStoreState => ({
    currentFile: createEmptyFileState(),
    // 标记用户是否有过编辑操作
    hasUserEdit: false,
    isLoading: false,
  }),

  actions: {
    setLoading(loading: boolean) {
      this.isLoading = loading;
    },

    setContent(content: string) {
      this.currentFile.content = content;
      // 只有用户有编辑操作时才标记为脏
      if (this.hasUserEdit) {
        this.currentFile.isDirty = true;
      }
    },

    // 用户编辑操作时调用
    markUserEdit() {
      this.hasUserEdit = true;
      this.currentFile.isDirty = true;
    },

    setFile(content: string, path: string | null, lastModifiedTime: number | null = null) {
      const baseName = path
        ? (path.split(/[/\\]/).pop() || DEFAULT_DISPLAY_NAME).replace(/\.(md|markdown|txt)$/i, '')
        : DEFAULT_DISPLAY_NAME;
      this.currentFile = {
        path,
        content,
        isDirty: false,
        lastModifiedTime,
        displayName: baseName,
        originalBaseName: baseName,
      };
      // 重置编辑标志
      this.hasUserEdit = false;
    },

    setDisplayName(name: string) {
      const trimmed = name.trim();
      this.currentFile.displayName = trimmed || DEFAULT_DISPLAY_NAME;
      this.currentFile.isDirty = true;
      this.hasUserEdit = true;
    },

    markSaved(lastModifiedTime: number | null = null) {
      this.currentFile.isDirty = false;
      this.hasUserEdit = false;
      if (lastModifiedTime !== null) {
        this.currentFile.lastModifiedTime = lastModifiedTime;
      }
    },

    reset() {
      this.currentFile = createEmptyFileState();
      this.hasUserEdit = false;
    },
  },
});
