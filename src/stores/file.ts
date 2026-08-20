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
  /** 从 path 提取的原始文件名基础名（去扩展名）。保存后 displayName 会重置回此值。 */
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

    /**
     * 编辑序列化结果回写（A1 改造）。
     * 与 setContent 的「同步基线、不标脏」不同，本方法以「内容与基线是否语义变化」为脏标记的唯一真相源：
     * 内容与基线不同 → 更新内容并标脏（不再依赖 hasUserEdit 门控）；内容未变 → 不改动、不标脏。
     * 由此同时根治「漏标脏」（拖入图片等非键盘交互）与「误标脏」（Mermaid 等后台事务不改内容）。
     * 调用前保证 content 是编辑器当前的序列化 markdown。
     * @returns 是否发生了语义变化（即是否标为脏）
     */
    syncEditedContent(content: string) {
      const normalizedNew = content.replace(/\n+$/, '');
      const normalizedBase = this.currentFile.content.replace(/\n+$/, '');
      if (normalizedNew === normalizedBase) {
        return false;
      }
      this.currentFile.content = content;
      this.currentFile.isDirty = true;
      return true;
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

    renamePath(newPath: string) {
      const baseName = newPath
        ? (newPath.split(/[/\\]/).pop() || DEFAULT_DISPLAY_NAME).replace(/\.(md|markdown|txt)$/i, '')
        : DEFAULT_DISPLAY_NAME;
      this.currentFile.path = newPath;
      this.currentFile.displayName = baseName;
      this.currentFile.originalBaseName = baseName;
    },

    markSaved(lastModifiedTime: number | null = null) {
      this.currentFile.isDirty = false;
      this.hasUserEdit = false;
      this.currentFile.displayName = this.currentFile.originalBaseName;
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
