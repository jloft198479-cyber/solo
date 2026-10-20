import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY_NAME } from '../../stores/file';
import {
  documentTier,
  setDocumentTier,
  HEAVY_DOC_CHARS,
  EXTREME_DOC_CHARS,
} from '../../components/Editor/document-scale';

const openMock = vi.fn();
const saveMock = vi.fn();
const confirmMock = vi.fn();
const messageMock = vi.fn();
const openDocumentMock = vi.fn();
const saveDocumentMock = vi.fn();
const renameFileMock = vi.fn();
const syncWikilinksMock = vi.fn();

const fileStoreState = {
  currentFile: {
    path: null as string | null,
    content: '',
    isDirty: false,
    lastModifiedTime: null as number | null,
    displayName: DEFAULT_DISPLAY_NAME as string,
    /** 从 path 提取的原始文件名基础名（去扩展名），用于判定“标题是否被改过” */
    originalBaseName: DEFAULT_DISPLAY_NAME as string,
  },
  setLoading: vi.fn(),
  setFile: vi.fn((content: string, path: string | null, lastModifiedTime: number | null) => {
    const originalBaseName = path
      ? (path.split(/[/\\]/).pop() || DEFAULT_DISPLAY_NAME).replace(/\.(md|markdown|txt)$/i, '')
      : DEFAULT_DISPLAY_NAME;
    fileStoreState.currentFile = {
      path,
      content,
      isDirty: false,
      lastModifiedTime,
      displayName: originalBaseName,
      originalBaseName,
    };
  }),
  markSaved: vi.fn((lastModifiedTime: number | null, content?: string) => {
    if (content !== undefined) {
      fileStoreState.currentFile.content = content;
    }
    fileStoreState.currentFile.isDirty = false;
    fileStoreState.currentFile.lastModifiedTime = lastModifiedTime;
  }),
  /**
   * 默认桩「永远不相等且不动脏态」，仅供不关心脏态的用例通过。
   * 脏态判定相关的用例必须调 `withFaithfulSyncEditedContent()` 换成忠实语义版
   * （真实实现见 stores/file.ts，stores/__tests__/file.spec.ts 覆盖）。
   */
  syncEditedContent: vi.fn((_content: string): boolean => false),
  renamePath: vi.fn((newPath: string) => {
    const baseName = newPath
      ? (newPath.split(/[/\\]/).pop() || DEFAULT_DISPLAY_NAME).replace(/\.(md|markdown|txt)$/i, '')
      : DEFAULT_DISPLAY_NAME;
    fileStoreState.currentFile.path = newPath;
    fileStoreState.currentFile.displayName = baseName;
    fileStoreState.currentFile.originalBaseName = baseName;
  }),
  reset: vi.fn(),
};

const settingsStoreState = {
  settings: {
    autoSave: false,
    autoSaveInterval: 30,
  },
};

vi.mock('../../services/tauri/dialog', () => ({
  open: openMock,
  save: saveMock,
  confirm: confirmMock,
  message: messageMock,
}));

vi.mock('../../services/tauri/document', () => ({
  openDocument: openDocumentMock,
  saveDocument: saveDocumentMock,
  renameFile: renameFileMock,
  syncWikilinksOnRename: syncWikilinksMock,
}));

vi.mock('../../stores/file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/file')>();
  return {
    ...actual,
    useFileStore: () => fileStoreState,
  };
});

vi.mock('../../stores/settings', () => ({
  useSettingsStore: () => settingsStoreState,
}));

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return {
    ...actual,
    onUnmounted: vi.fn(),
  };
});

describe('useDocumentSession', () => {
  beforeEach(() => {
    openMock.mockReset();
    saveMock.mockReset();
    confirmMock.mockReset();
    messageMock.mockReset();
    openDocumentMock.mockReset();
    saveDocumentMock.mockReset();
    renameFileMock.mockReset();
    syncWikilinksMock.mockReset();
    // 默认：改名同步预览返回空（无文档链到旧名）→ 前端同步链路安全早退，不影响其它用例
    syncWikilinksMock.mockResolvedValue([]);
    fileStoreState.currentFile = {
      path: null,
      content: '',
      isDirty: false,
      lastModifiedTime: null,
      displayName: DEFAULT_DISPLAY_NAME,
      originalBaseName: DEFAULT_DISPLAY_NAME,
    };
    fileStoreState.setLoading.mockReset();
    fileStoreState.setFile.mockClear();
    fileStoreState.markSaved.mockClear();
    fileStoreState.renamePath.mockClear();
    fileStoreState.reset.mockClear();
    // 忠实语义版只在其用例内需要，每个用例开头复位回默认桩，防跨用例泄漏
    fileStoreState.syncEditedContent.mockImplementation(() => false);
  });

  it('loads document content and mtime together', async () => {
    openDocumentMock.mockResolvedValue({
      path: '/tmp/demo.md',
      content: '# title',
      lastModifiedMs: 123,
    });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    await expect(session.loadDocumentFromPath('/tmp/demo.md')).resolves.toBe(true);
    expect(fileStoreState.setLoading).toHaveBeenNthCalledWith(1, true);
    expect(fileStoreState.setLoading).toHaveBeenLastCalledWith(false);
    expect(fileStoreState.setFile).toHaveBeenCalledWith('# title', '/tmp/demo.md', 123);
  });

  it('未修改时不写盘：Ctrl+S 不再把 CRLF 文件静默改成 LF（M-03 回归锁）', async () => {
    fileStoreState.currentFile = {
      path: '/tmp/demo.md',
      content: 'a\r\nb\r\n',
      isDirty: false,
      lastModifiedTime: 1000,
      displayName: 'demo',
      originalBaseName: 'demo',
    };

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({ resetViewMode: vi.fn() });

    await expect(session.saveCurrentDocument(false, true)).resolves.toBe(true);
    expect(saveDocumentMock).not.toHaveBeenCalled();
  });

  it('有未保存修改时 Ctrl+S 仍然写盘（门控不误伤正常保存）', async () => {
    fileStoreState.currentFile = {
      path: '/tmp/demo.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: 'demo',
      originalBaseName: 'demo',
    };
    saveDocumentMock.mockResolvedValueOnce({ path: '/tmp/demo.md', lastModifiedMs: 1500 });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({ resetViewMode: vi.fn() });

    await expect(session.saveCurrentDocument(false, true)).resolves.toBe(true);
    expect(saveDocumentMock).toHaveBeenCalledTimes(1);
  });

  /**
   * 数据安全线复现锁（见 docs/REVIEW-2026-10-10-数据安全线复审-二次核实.md P1-①/②）。
   * 这两条改的是「脏态判定」，桩版 syncEditedContent 不会推进基线，必须换成语义
   * 比对真身，否则断言的是测试自己的假设。
   */
  function withFaithfulSyncEditedContent() {
    fileStoreState.syncEditedContent.mockImplementation((next: string) => {
      const strip = (s: string) => s.replace(/\n+$/, '');
      if (strip(next) === strip(fileStoreState.currentFile.content)) return false;
      fileStoreState.currentFile.content = next;
      fileStoreState.currentFile.isDirty = true;
      return true;
    });
  }

  it('编辑后 store 未追平（防抖窗口内）按 Ctrl+S 必须落盘（P1-① 复现锁）', async () => {
    fileStoreState.currentFile = {
      path: '/tmp/demo.md',
      content: '磁盘原文',
      // 500ms 序列化防抖 + 空闲调度（useEditorSync）还没把新内容写回 store，
      // 此刻 isDirty 仍是 false —— 修复前 Ctrl+S 被这个滞后门吞掉，静默不落盘。
      isDirty: false,
      lastModifiedTime: 1000,
      displayName: 'demo',
      originalBaseName: 'demo',
    };
    withFaithfulSyncEditedContent();
    saveDocumentMock.mockResolvedValue({ path: '/tmp/demo.md', lastModifiedMs: 2000 });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
      getContent: () => '磁盘原文＋刚敲的一个字',
      isSyncedWithStore: () => false,
    });

    await expect(session.saveCurrentDocument(false, true)).resolves.toBe(true);
    expect(saveDocumentMock).toHaveBeenCalledTimes(1);
    expect(saveDocumentMock.mock.calls[0][1]).toBe('磁盘原文＋刚敲的一个字');
  });

  it('走实时评估后内容仍未变 ⇒ 照样不写盘（守住 §二 #20，修 P1-① 不许回潮）', async () => {
    // 基线是「编辑器序列化产物」（LF 规范化，见 MarkdownEditor.vue setContent(baseline)），
    // 拦住房 CRLF 被静默归一的是这个规范化基线 + 语义比对，不是快路径。
    fileStoreState.currentFile = {
      path: '/tmp/demo.md',
      content: '第一行\n第二行',
      isDirty: false,
      lastModifiedTime: 1000,
      displayName: 'demo',
      originalBaseName: 'demo',
    };
    withFaithfulSyncEditedContent();

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
      getContent: () => '第一行\n第二行',
      // 故意让快路径失效，逼门控走「冲刷实时内容再判」那条分支
      isSyncedWithStore: () => false,
    });

    await expect(session.saveCurrentDocument(false, true)).resolves.toBe(true);
    expect(saveDocumentMock).not.toHaveBeenCalled();
    expect(fileStoreState.currentFile.isDirty).toBe(false);
  });

  it('保存往返期间的新编辑不得被旧快照 markSaved 洗成「已保存」（P1-② 复现锁）', async () => {
    let editorText = 'v1';
    fileStoreState.currentFile = {
      path: '/tmp/demo.md',
      content: 'v1',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: 'demo',
      originalBaseName: 'demo',
    };
    withFaithfulSyncEditedContent();
    saveDocumentMock.mockImplementation(async (_path: string, content: string) => {
      // IPC 往返期间空闲序列化落地：store 基线被推进到写盘快照之外的新内容
      editorText = `${content}＋往返期间又敲的字`;
      fileStoreState.syncEditedContent(editorText);
      return { path: '/tmp/demo.md', lastModifiedMs: 2000 };
    });
    const getContentMock = vi.fn(() => editorText);

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
      getContent: getContentMock,
      // 空闲回调把 syncedGeneration 追平了 ⇒ 代际比对此刻正在**谎报**已同步
      isSyncedWithStore: () => true,
    });

    await expect(session.saveCurrentDocument(false, true)).resolves.toBe(true);
    // 磁盘上确实只有快照 v1（不许事后追写，那属另一个话题）
    expect(saveDocumentMock.mock.calls[0][1]).toBe('v1');
    // 修复前：markSaved(v1) 把基线拉回 v1 并清了脏 ⇒「已保存」是假的，
    // 自动保存不再保存、关窗不弹确认 ⇒ 往返期间那笔编辑静默丢失。
    expect(fileStoreState.currentFile.isDirty).toBe(true);
    expect(fileStoreState.currentFile.content).toBe('v1＋往返期间又敲的字');
    // 竞态真发生过时才会二次取内容——那一次在生产里是缓存命中（回调刚刷过缓存）
    expect(getContentMock).toHaveBeenCalledTimes(2);
  });

  it('常规保存全链路只取一次实时内容（自动保存不许多跑一遍全文序列化）', async () => {
    fileStoreState.currentFile = {
      path: '/tmp/demo.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: 'demo',
      originalBaseName: 'demo',
    };
    saveDocumentMock.mockResolvedValue({ path: '/tmp/demo.md', lastModifiedMs: 1500 });
    const getContentMock = vi.fn(() => 'draft');

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
      getContent: getContentMock,
      isSyncedWithStore: () => true,
    });

    await expect(session.saveCurrentDocument()).resolves.toBe(true);
    // 只有 persistDocument 取快照这一次：store 没被中途改动 ⇒ 保存后的 P1-② 复查不得触发。
    // 这条锁的意义是「有自动保存的会话里，每一次保存都多跑一遍全文序列化」不能发生。
    expect(getContentMock).toHaveBeenCalledTimes(1);
  });

  it('retries save with force after a document conflict is confirmed', async () => {
    fileStoreState.currentFile = {
      path: '/tmp/demo.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: 'demo',
      originalBaseName: 'demo',
    };
    saveDocumentMock
      .mockRejectedValueOnce({ code: 'document_conflict', message: 'conflict' })
      .mockResolvedValueOnce({
        path: '/tmp/demo.md',
        lastModifiedMs: 1500,
      });
    confirmMock.mockResolvedValueOnce(true);

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    await expect(session.saveCurrentDocument()).resolves.toBe(true);
    expect(saveDocumentMock).toHaveBeenNthCalledWith(1, '/tmp/demo.md', 'draft', 1000, false);
    expect(saveDocumentMock).toHaveBeenNthCalledWith(2, '/tmp/demo.md', 'draft', 1000, true);
    expect(fileStoreState.markSaved).toHaveBeenCalledWith(1500, 'draft');
    // 普通「外部修改」冲突：正文取 Rust 消息，按钮仍是「强制覆盖」
    expect(confirmMock).toHaveBeenCalledWith(
      'conflict',
      expect.objectContaining({ okLabel: '强制覆盖' }),
    );
  });

  it('文件被移动或删除：弹窗按「重建」措辞，不再误报「已被外部修改」', async () => {
    // 回归：旧实现对 document_conflict 写死「文件已被外部修改，是否强制覆盖？」，
    // 而文件被删/挪走时 Rust 给的是「是否在此位置重新创建？」—— 用户看到错误场景。
    fileStoreState.currentFile = {
      path: '/tmp/demo.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: 'demo',
      originalBaseName: 'demo',
    };
    const goneMessage = '文件已被移动或删除，是否在此位置重新创建？';
    saveDocumentMock.mockRejectedValueOnce({
      code: 'document_conflict',
      message: goneMessage,
    });
    confirmMock.mockResolvedValueOnce(false); // 用户取消，仅断言弹窗内容

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
      getContent: () => 'draft',
    });

    await expect(session.saveCurrentDocument()).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledWith(
      goneMessage,
      expect.objectContaining({ okLabel: '重新创建' }),
    );
  });

  it('冲突取消后基线不被污染、脏标不被洗白（保存失败静默丢编辑回归锁）', async () => {
    // C1 回归：旧实现在 persistDocument 里提前把基线改成编辑器内容，
    // 保存失败（冲突取消/磁盘满）后基线≠磁盘，后续 syncEditedContent
    // 语义比对「内容未变」会把 isDirty 洗成 false —— 关窗不弹确认，编辑丢失。
    fileStoreState.currentFile = {
      path: '/tmp/demo.md',
      content: '磁盘基线',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: 'demo',
      originalBaseName: 'demo',
    };
    saveDocumentMock.mockRejectedValueOnce({
      code: 'document_conflict',
      message: 'conflict',
    });
    confirmMock.mockResolvedValueOnce(false); // 用户在冲突弹框选「取消」

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
      getContent: () => '编辑器里的新内容',
    });

    await expect(session.saveCurrentDocument()).resolves.toBe(false);
    // 基线仍是磁盘内容（未被提前回写），脏标保持 —— 关窗闸口会如实拦截
    expect(fileStoreState.currentFile.content).toBe('磁盘基线');
    expect(fileStoreState.currentFile.isDirty).toBe(true);
    expect(fileStoreState.markSaved).not.toHaveBeenCalled();
  });

  it('保存成功后基线同步为实际写入的内容（乐观路径不再依赖提前回写）', async () => {
    fileStoreState.currentFile = {
      path: '/tmp/demo.md',
      content: '旧基线',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: 'demo',
      originalBaseName: 'demo',
    };
    saveDocumentMock.mockResolvedValueOnce({
      path: '/tmp/demo.md',
      lastModifiedMs: 1500,
    });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
      getContent: () => '编辑器新内容',
    });

    await expect(session.saveCurrentDocument()).resolves.toBe(true);
    expect(saveDocumentMock).toHaveBeenCalledWith('/tmp/demo.md', '编辑器新内容', 1000, false);
    expect(fileStoreState.currentFile.content).toBe('编辑器新内容');
    expect(fileStoreState.currentFile.isDirty).toBe(false);
  });

  it('saves a new document through save as', async () => {
    fileStoreState.currentFile = {
      path: null,
      content: 'draft',
      isDirty: true,
      lastModifiedTime: null,
      displayName: DEFAULT_DISPLAY_NAME,
      originalBaseName: DEFAULT_DISPLAY_NAME,
    };
    saveMock.mockResolvedValue('/tmp/demo.md');
    saveDocumentMock.mockResolvedValue({
      path: '/tmp/demo.md',
      lastModifiedMs: 2000,
    });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    await expect(session.saveCurrentDocument()).resolves.toBe(true);
    expect(saveDocumentMock).toHaveBeenCalledWith('/tmp/demo.md', 'draft', null, true);
    expect(fileStoreState.setFile).toHaveBeenCalledWith('draft', '/tmp/demo.md', 2000);
    // setFile 已经将 isDirty 置为 false，无需再调 markSaved
    expect(fileStoreState.markSaved).not.toHaveBeenCalled();
  });

  it('pre-fills save dialog with displayName + .md when path is empty', async () => {
    fileStoreState.currentFile = {
      path: null,
      content: 'draft',
      isDirty: true,
      lastModifiedTime: null,
      displayName: '学习笔记',
      originalBaseName: DEFAULT_DISPLAY_NAME,
    };
    saveMock.mockResolvedValue('/tmp/学习笔记.md');
    saveDocumentMock.mockResolvedValue({
      path: '/tmp/学习笔记.md',
      lastModifiedMs: 2000,
    });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    await session.saveCurrentDocument();
    expect(saveMock).toHaveBeenCalledTimes(1);
    const callArgs = saveMock.mock.calls[0][0] as {
      defaultPath?: string;
      filters?: Array<{ extensions: string[] }>;
    };
    expect(callArgs.defaultPath).toBe('学习笔记.md');
    expect(callArgs.filters).toEqual([{ name: 'Markdown', extensions: ['md'] }]);
  });

  it('falls back to untitled-{timestamp}.md when displayName is empty', async () => {
    fileStoreState.currentFile = {
      path: null,
      content: 'draft',
      isDirty: true,
      lastModifiedTime: null,
      displayName: '',
      originalBaseName: DEFAULT_DISPLAY_NAME,
    };
    saveMock.mockResolvedValue('/tmp/untitled-1234.md');
    saveDocumentMock.mockResolvedValue({
      path: '/tmp/untitled-1234.md',
      lastModifiedMs: 2000,
    });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    await session.saveCurrentDocument();
    const callArgs = saveMock.mock.calls[0][0] as { defaultPath?: string };
    expect(callArgs.defaultPath).toMatch(/^untitled-\d+\.md$/);
  });

  it('pre-fills save dialog when explicit saveAs is invoked on an open file', async () => {
    fileStoreState.currentFile = {
      path: '/tmp/original.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: '改名后的笔记',
      originalBaseName: 'original',
    };
    saveMock.mockResolvedValue('/tmp/改名后的笔记.md');
    saveDocumentMock.mockResolvedValue({
      path: '/tmp/改名后的笔记.md',
      lastModifiedMs: 2000,
    });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    await session.saveCurrentDocumentAs();
    const callArgs = saveMock.mock.calls[0][0] as { defaultPath?: string };
    expect(callArgs.defaultPath).toBe('改名后的笔记.md');
  });

  it('routes save through rename when displayName differs from original base name', async () => {
    // 打开 original.md，标题被改为”新标题”且未保存
    fileStoreState.currentFile = {
      path: '/tmp/original.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: '新标题',
      originalBaseName: 'original',
    };
    renameFileMock.mockResolvedValue({
      path: '/tmp/新标题.md',
      lastModifiedMs: 1500,
    });
    saveDocumentMock.mockResolvedValue({
      path: '/tmp/新标题.md',
      lastModifiedMs: 2000,
    });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    await session.saveCurrentDocument();
    // 走 rename 路径：renameFile 被调，saveDocument 在新路径上被调，不弹保存对话框
    expect(renameFileMock).toHaveBeenCalledWith('/tmp/original.md', '新标题');
    expect(saveDocumentMock).toHaveBeenCalledWith('/tmp/新标题.md', 'draft', null, true);
    expect(saveMock).not.toHaveBeenCalled();
    // 原文件 /tmp/original.md 未被静默写回
    expect(saveDocumentMock).not.toHaveBeenCalledWith(
      '/tmp/original.md',
      'draft',
      1000,
      expect.anything(),
    );
  });

  it('renaming syncs inbound wikilinks automatically (no prompt)', async () => {
    fileStoreState.currentFile = {
      path: '/tmp/original.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: '新标题',
      originalBaseName: 'original',
    };
    renameFileMock.mockResolvedValue({ path: '/tmp/新标题.md' });
    saveDocumentMock.mockResolvedValue({ path: '/tmp/新标题.md', lastModifiedMs: 2000 });
    syncWikilinksMock.mockResolvedValueOnce(['a.md', 'b.md']);

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({ resetViewMode: vi.fn() });
    const ok = await session.saveCurrentDocument();

    expect(ok).toBe(true);
    // 一次调用直接改写，参数只有 (旧路径, 新路径) —— 不再有 dryRun 预览那一趟
    expect(syncWikilinksMock).toHaveBeenCalledTimes(1);
    expect(syncWikilinksMock).toHaveBeenCalledWith('/tmp/original.md', '/tmp/新标题.md');
    // 改名同步不再打扰用户（弹框会被自动保存打断，错过一次就永久不同步）
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('silent saves in place when displayName matches original base name', async () => {
    fileStoreState.currentFile = {
      path: '/tmp/original.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: 'original',
      originalBaseName: 'original',
    };
    saveDocumentMock.mockResolvedValue({
      path: '/tmp/original.md',
      lastModifiedMs: 2000,
    });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    await session.saveCurrentDocument();
    expect(saveMock).not.toHaveBeenCalled();
    expect(saveDocumentMock).toHaveBeenCalledWith('/tmp/original.md', 'draft', 1000, false);
  });

  it('recovers to the renamed path when persisting content fails after rename', async () => {
    // P1-03 回归：rename 成功但写内容失败时，store 必须同步到新路径，
    // 否则下次保存会对已不存在的旧路径再 rename，永久死锁。
    fileStoreState.currentFile = {
      path: '/tmp/original.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: '新标题',
      originalBaseName: 'original',
    };
    renameFileMock.mockResolvedValue({ path: '/tmp/新标题.md' });
    saveDocumentMock
      .mockRejectedValueOnce({ code: 'io_error', message: 'disk full' })
      .mockResolvedValueOnce({ path: '/tmp/新标题.md', lastModifiedMs: 2000 });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    const result = await session.saveCurrentDocument();
    expect(result).toBe(false);
    // store 同步到新路径：path/displayName/originalBaseName 均为新名
    expect(fileStoreState.renamePath).toHaveBeenCalledWith('/tmp/新标题.md');
    expect(fileStoreState.currentFile.path).toBe('/tmp/新标题.md');
    expect(fileStoreState.currentFile.displayName).toBe('新标题');
    // 仍为脏状态，内容未丢失
    expect(fileStoreState.currentFile.isDirty).toBe(true);

    // 下次保存走正常分支直写新路径（不再 rename），不再死锁
    const retry = await session.saveCurrentDocument();
    expect(retry).toBe(true);
    expect(renameFileMock).toHaveBeenCalledTimes(1);
    expect(saveDocumentMock).toHaveBeenNthCalledWith(2, '/tmp/新标题.md', 'draft', 1000, false);
  });

  it('passes displayName to renameFile for save-after-rename flow', async () => {
    fileStoreState.currentFile = {
      path: '/tmp/original.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: 'a/b:c*d?e',
      originalBaseName: 'original',
    };
    renameFileMock.mockResolvedValue({
      path: '/tmp/a_b_c_d_e.md',
      lastModifiedMs: 1500,
    });
    saveDocumentMock.mockResolvedValue({
      path: '/tmp/a_b_c_d_e.md',
      lastModifiedMs: 2000,
    });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    await session.saveCurrentDocument();
    // rename 路径：displayName 直接传给 renameFile，不弹保存对话框
    expect(renameFileMock).toHaveBeenCalledWith('/tmp/original.md', 'a/b:c*d?e');
    expect(saveDocumentMock).toHaveBeenCalledWith('/tmp/a_b_c_d_e.md', 'draft', null, true);
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe('useDocumentSession 关窗脏闸口的免序列化快路径', () => {
  function setFile(isDirty: boolean) {
    fileStoreState.currentFile = {
      path: '/tmp/big.md',
      content: 'baseline',
      isDirty,
      lastModifiedTime: 1000,
      displayName: 'big',
      originalBaseName: 'big',
    };
    fileStoreState.syncEditedContent.mockClear();
  }

  it('基线已追平时直接信任脏标记，一次 getContent 都不调（4MB 关窗免卡死）', async () => {
    setFile(false);
    const getContent = vi.fn(() => 'baseline');

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
      getContent,
      isSyncedWithStore: () => true,
    });

    expect(session.evaluateDirtyFromEditor()).toBe(false);
    expect(getContent).not.toHaveBeenCalled();
    expect(fileStoreState.syncEditedContent).not.toHaveBeenCalled();
  });

  it('基线已追平且确有编辑时，仍如实报脏（快路径不吞掉保存提示）', async () => {
    setFile(true);
    const getContent = vi.fn(() => 'edited');

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
      getContent,
      isSyncedWithStore: () => true,
    });

    expect(session.evaluateDirtyFromEditor()).toBe(true);
    expect(getContent).not.toHaveBeenCalled();
  });

  it('未追平时保留兜底：取实时内容并回写 store，坑2 的最后一秒编辑不丢', async () => {
    setFile(false);
    const getContent = vi.fn(() => 'edited');

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
      getContent,
      isSyncedWithStore: () => false,
    });

    session.evaluateDirtyFromEditor();
    expect(getContent).toHaveBeenCalledTimes(1);
    expect(fileStoreState.syncEditedContent).toHaveBeenCalledWith('edited');
  });

  it('调用方未提供 isSyncedWithStore 时，行为与改造前一致（走 getContent 兜底）', async () => {
    setFile(false);
    const getContent = vi.fn(() => 'edited');

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({ resetViewMode: vi.fn(), getContent });

    session.evaluateDirtyFromEditor();
    expect(getContent).toHaveBeenCalledTimes(1);
  });
});

describe('useDocumentSession 大文档档位闸门（阈值分层 + 自动降级）', () => {
  async function loadWith(content: string) {
    openDocumentMock.mockResolvedValue({ path: '/tmp/big.md', content, lastModifiedMs: 1 });
    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({ resetViewMode: vi.fn() });
    return session.loadDocumentFromPath('/tmp/big.md');
  }

  beforeEach(() => {
    confirmMock.mockReset();
    openDocumentMock.mockReset();
    fileStoreState.setFile.mockClear();
    setDocumentTier('normal');
  });

  it('heavy 档：自动降级但绝不打扰用户（不弹确认框）', async () => {
    await expect(loadWith('x'.repeat(HEAVY_DOC_CHARS))).resolves.toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(documentTier.value).toBe('heavy');
    expect(fileStoreState.setFile).toHaveBeenCalledTimes(1);
  });

  it('extreme 档：用户取消则不写 store，也不留下降级痕迹', async () => {
    confirmMock.mockResolvedValueOnce(false);
    await expect(loadWith('x'.repeat(EXTREME_DOC_CHARS))).resolves.toBe(false);
    expect(fileStoreState.setFile).not.toHaveBeenCalled();
    expect(documentTier.value).toBe('normal');
  });

  it('extreme 档：用户确认后才按 extreme 档发布并写入', async () => {
    confirmMock.mockResolvedValueOnce(true);
    await expect(loadWith('x'.repeat(EXTREME_DOC_CHARS))).resolves.toBe(true);
    expect(documentTier.value).toBe('extreme');
    expect(fileStoreState.setFile).toHaveBeenCalledTimes(1);
  });

  it('base64 内嵌图片不计入档位度量（渲染成独立节点，不参与全文遍历）', async () => {
    const md = `![p](data:image/png;base64,${'A'.repeat(EXTREME_DOC_CHARS)})\n正文`;
    await expect(loadWith(md)).resolves.toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(documentTier.value).toBe('normal');
  });
});
