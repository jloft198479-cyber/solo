import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useAppWindowSession } from '../useAppWindowSession';

// vi.mock 的工厂会被提升到模块顶部：所有桩必须先经 vi.hoisted 建好，
// 否则工厂执行时 const 还没初始化（Cannot access before initialization）。
const mocks = vi.hoisted(() => ({
  startupReady: vi.fn(),
  newEditorWindow: vi.fn(),
  registerShellNew: vi.fn(),
  message: vi.fn(),
  openDocument: vi.fn(),
  subscribeDragDrop: vi.fn(),
  listenWindowCloseRequested: vi.fn(),
}));

vi.mock('../../services/tauri/events', () => ({
  listenWindowCloseRequested: mocks.listenWindowCloseRequested,
  subscribeDragDrop: mocks.subscribeDragDrop,
}));

vi.mock('../../services/tauri/window', () => ({
  startupReady: mocks.startupReady,
  newEditorWindow: mocks.newEditorWindow,
  registerShellNew: mocks.registerShellNew,
  // 这些函数在本组合式函数里都按「返回 Promise」使用（如 `.catch(...)`），
  // 桩必须也是 Promise，否则会抛 `undefined.catch`。
  destroyCurrentWindow: vi.fn().mockResolvedValue(undefined),
  isCurrentWindowFullscreen: vi.fn().mockResolvedValue(false),
  setCurrentWindowFullscreen: vi.fn().mockResolvedValue(undefined),
  setCurrentWindowTitle: vi.fn().mockResolvedValue(undefined),
  requestAppQuit: vi.fn().mockResolvedValue(undefined),
  reportWindowClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-window-state', () => ({
  saveWindowState: vi.fn(),
  StateFlags: { SIZE: 1, POSITION: 2, MAXIMIZED: 4 },
}));

vi.mock('../../services/tauri/dialog', () => ({
  message: mocks.message,
}));

vi.mock('../../components/Editor/tiptap/extensions/wikilink-drop', () => ({
  isDocumentPath: (path: string) => /\.(md|markdown)$/i.test(path),
}));

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return {
    ...actual,
    // 组合式函数在 setup 之外调用，真实 onUnmounted 只会告警；
    // 换成 no-op 让用例输出干净。
    onUnmounted: vi.fn(),
  };
});

describe('useAppWindowSession 启动文件投递', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startupReady.mockReset().mockResolvedValue(null);
    mocks.newEditorWindow.mockReset().mockResolvedValue('editor-1');
    mocks.registerShellNew.mockReset().mockResolvedValue(undefined);
    mocks.openDocument.mockReset().mockResolvedValue(undefined);
    mocks.message.mockReset();
    mocks.subscribeDragDrop.mockReset().mockResolvedValue(() => {});
    mocks.listenWindowCloseRequested.mockReset().mockResolvedValue(() => {});
  });

  function makeSession() {
    return useAppWindowSession({
      openDocument: mocks.openDocument,
      saveDocument: vi.fn().mockResolvedValue(true),
      isDirty: () => false,
      windowTitle: ref('solo'),
      shellIntegration: () => false,
    });
  }

  it('单文件启动：在本窗口打开，不另开窗', async () => {
    mocks.startupReady.mockResolvedValue({ paths: ['/docs/a.md'], source: 'cli' });

    await makeSession().setup();

    expect(mocks.openDocument).toHaveBeenCalledTimes(1);
    expect(mocks.openDocument).toHaveBeenCalledWith('/docs/a.md', true);
    expect(mocks.newEditorWindow).not.toHaveBeenCalled();
  });

  it('多文件启动：首个进本窗，其余各开一窗（旧实现只留最后一个）', async () => {
    // 回归锁：Windows 资源管理器多选 .md 回车 → 一条命令行带多个路径。
    // 旧实现顺序调用 openDocument，前几个被后一个顶掉，用户只看到最后一份。
    mocks.startupReady.mockResolvedValue({
      paths: ['/docs/a.md', '/docs/b.md', '/docs/c.md'],
      source: 'cli',
    });

    await makeSession().setup();

    expect(mocks.openDocument).toHaveBeenCalledTimes(1);
    expect(mocks.openDocument).toHaveBeenCalledWith('/docs/a.md', true);
    expect(mocks.newEditorWindow).toHaveBeenCalledTimes(2);
    expect(mocks.newEditorWindow).toHaveBeenNthCalledWith(1, '/docs/b.md');
    expect(mocks.newEditorWindow).toHaveBeenNthCalledWith(2, '/docs/c.md');
  });

  it('首个文件不存在时静默跳过，其余文件照常各开一窗', async () => {
    mocks.startupReady.mockResolvedValue({
      paths: ['/docs/gone.md', '/docs/b.md'],
      source: 'cli',
    });
    mocks.openDocument.mockRejectedValueOnce({
      code: 'io_error',
      message: 'os error 2: No such file or directory',
    });

    await makeSession().setup();

    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.newEditorWindow).toHaveBeenCalledWith('/docs/b.md');
  });

  it('空路径被过滤：不打开任何文档，也不开窗', async () => {
    mocks.startupReady.mockResolvedValue({ paths: [''], source: 'cli' });

    await makeSession().setup();

    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(mocks.newEditorWindow).not.toHaveBeenCalled();
  });
});
