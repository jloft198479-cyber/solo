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
  isLoading: boolean;
  /**
   * 文档载入代号：仅 setFile（从磁盘载入/另存为落地）递增。
   * 编辑器 watch [path, reloadToken] 触发文档替换——不能直接 watch content：
   * 编辑期 syncEditedContent 也在写 content，watch 它会在 store 滞后于编辑器时
   * （保存失败保留旧基线、防抖窗口）把正在编辑的内容回退成旧基线。
   * 同路径外部修改重载（path 不变）靠本 token 触发刷新。
   */
  reloadToken: number;
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
    isLoading: false,
    reloadToken: 0,
  }),

  actions: {
    setLoading(loading: boolean) {
      this.isLoading = loading;
    },

    setContent(content: string) {
      // 同步基线：仅更新内容、不标脏（A1 后脏标记由 syncEditedContent 判定）
      this.currentFile.content = content;
    },

    /**
     * 编辑序列化结果回写（A1 改造）。
     * 以「内容与基线是否语义变化」为脏标记的唯一真相源：
     * 内容与基线不同 → 更新内容并标脏；内容未变 → 不改动、不标脏。
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
      // 通知编辑器：磁盘内容已载入，同路径重载也要刷新 doc（否则旧 doc 的
      // 延迟序列化会把旧内容写回 store，用户一保存就覆盖掉外部修改）
      this.reloadToken += 1;
    },

    setDisplayName(name: string) {
      const trimmed = name.trim();
      this.currentFile.displayName = trimmed || DEFAULT_DISPLAY_NAME;
      this.currentFile.isDirty = true;
    },

    renamePath(newPath: string) {
      const baseName = newPath
        ? (newPath.split(/[/\\]/).pop() || DEFAULT_DISPLAY_NAME).replace(/\.(md|markdown|txt)$/i, '')
        : DEFAULT_DISPLAY_NAME;
      this.currentFile.path = newPath;
      this.currentFile.displayName = baseName;
      this.currentFile.originalBaseName = baseName;
    },

    /**
     * 保存成功后清脏。
     * content 传入时同步基线为「实际写入磁盘的内容」——基线只能在保存
     * 成功后更新（失败/冲突取消时若提前更新，后续 syncEditedContent 语义
     * 比对会因「内容未变」把脏标洗白，未保存编辑静默丢失）。
     */
    markSaved(lastModifiedTime: number | null = null, content?: string) {
      if (content !== undefined) {
        this.currentFile.content = content;
      }
      this.currentFile.isDirty = false;
      this.currentFile.displayName = this.currentFile.originalBaseName;
      if (lastModifiedTime !== null) {
        this.currentFile.lastModifiedTime = lastModifiedTime;
      }
    },

    reset() {
      this.currentFile = createEmptyFileState();
    },
  },
});
