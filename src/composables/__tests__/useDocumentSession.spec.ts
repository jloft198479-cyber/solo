import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY_NAME } from '../../stores/file';

const openMock = vi.fn();
const saveMock = vi.fn();
const confirmMock = vi.fn();
const messageMock = vi.fn();
const openDocumentMock = vi.fn();
const saveDocumentMock = vi.fn();

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
  markSaved: vi.fn((lastModifiedTime: number | null) => {
    fileStoreState.currentFile.isDirty = false;
    fileStoreState.currentFile.lastModifiedTime = lastModifiedTime;
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
    fileStoreState.reset.mockClear();
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
    expect(fileStoreState.markSaved).toHaveBeenCalledWith(1500);
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
    const callArgs = saveMock.mock.calls[0][0] as { defaultPath?: string; filters?: Array<{ extensions: string[] }> };
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

  it('routes save through save-as when displayName differs from original base name', async () => {
    // 打开 original.md，标题被改为“新标题”且未保存
    fileStoreState.currentFile = {
      path: '/tmp/original.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: '新标题',
      originalBaseName: 'original',
    };
    saveMock.mockResolvedValue('/tmp/新标题.md');
    saveDocumentMock.mockResolvedValue({
      path: '/tmp/新标题.md',
      lastModifiedMs: 2000,
    });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    await session.saveCurrentDocument();
    // 走的是另存为路径：saveMock 被调，saveDocumentMock 也被调（以新路径）
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveDocumentMock).toHaveBeenCalledWith('/tmp/新标题.md', 'draft', null, true);
    // 原文件 /tmp/original.md 未被静默写回
    expect(saveDocumentMock).not.toHaveBeenCalledWith('/tmp/original.md', 'draft', 1000, expect.anything());
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

  it('keeps displayName when user cancels the save-as dialog after renaming', async () => {
    // 打开后改了标题，弹另存为，用户点取消
    fileStoreState.currentFile = {
      path: '/tmp/original.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: '新标题',
      originalBaseName: 'original',
    };
    saveMock.mockResolvedValue(null); // 用户取消

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    const result = await session.saveCurrentDocument();
    expect(result).toBe(false);
    // 标题保留：displayName 不被回滚
    expect(fileStoreState.currentFile.displayName).toBe('新标题');
    // 仍为脏状态，下一次保存会重试另存为
    expect(fileStoreState.currentFile.isDirty).toBe(true);
  });

  it('sanitizes illegal filesystem characters in buildDefaultSavePath', async () => {
    fileStoreState.currentFile = {
      path: '/tmp/original.md',
      content: 'draft',
      isDirty: true,
      lastModifiedTime: 1000,
      displayName: 'a/b:c*d?e',
      originalBaseName: 'original',
    };
    saveMock.mockResolvedValue('/tmp/a_b_c_d_e.md');
    saveDocumentMock.mockResolvedValue({
      path: '/tmp/a_b_c_d_e.md',
      lastModifiedMs: 2000,
    });

    const { useDocumentSession } = await import('../useDocumentSession');
    const session = useDocumentSession({
      resetViewMode: vi.fn(),
    });

    await session.saveCurrentDocument();
    const callArgs = saveMock.mock.calls[0][0] as { defaultPath?: string };
    expect(callArgs.defaultPath).toBe('a_b_c_d_e.md');
  });
});
