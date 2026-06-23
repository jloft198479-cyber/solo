import { defineStore } from 'pinia';

export interface FileState {
  path: string | null;
  content: string;
  isDirty: boolean;
  lastModifiedTime: number | null;
  /** Display name shown in titlebar (editable by user) */
  displayName: string;
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
    displayName: '未命名',
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
      const displayName = path ? (path.split(/[/\\]/).pop() || '未命名').replace(/\.(md|markdown|txt)$/i, '') : '未命名';
      this.currentFile = {
        path,
        content,
        isDirty: false,
        lastModifiedTime,
        displayName,
      };
      // 重置编辑标志
      this.hasUserEdit = false;
    },

    setDisplayName(name: string) {
      const trimmed = name.trim();
      this.currentFile.displayName = trimmed || '未命名';
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
