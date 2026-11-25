// @vitest-environment happy-dom
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
  destroyCurrentWindow: vi.fn(),
  reportWindowClose: vi.fn(),
  saveWindowState: vi.fn(),
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
  destroyCurrentWindow: mocks.destroyCurrentWindow,
  isCurrentWindowFullscreen: vi.fn().mockResolvedValue(false),
  setCurrentWindowFullscreen: vi.fn().mockResolvedValue(undefined),
  setCurrentWindowTitle: vi.fn().mockResolvedValue(undefined),
  requestAppQuit: vi.fn().mockResolvedValue(undefined),
  reportWindowClose: mocks.reportWindowClose,
}));

vi.mock('@tauri-apps/plugin-window-state', () => ({
  saveWindowState: mocks.saveWindowState,
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

let capturedCloseHandler: (() => Promise<void>) | null = null;

describe('useAppWindowSession 启动文件投递', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCloseHandler = null;
    mocks.startupReady.mockReset().mockResolvedValue(null);
    mocks.newEditorWindow.mockReset().mockResolvedValue('editor-1');
    mocks.registerShellNew.mockReset().mockResolvedValue(undefined);
    mocks.openDocument.mockReset().mockResolvedValue(undefined);
    mocks.message.mockReset();
    mocks.subscribeDragDrop.mockReset().mockResolvedValue(() => {});
    mocks.listenWindowCloseRequested.mockReset().mockImplementation((handler) => {
      capturedCloseHandler = handler;
      return Promise.resolve(() => {});
    });
    mocks.destroyCurrentWindow.mockReset().mockResolvedValue(undefined);
    mocks.reportWindowClose.mockReset().mockResolvedValue(undefined);
    mocks.saveWindowState.mockReset().mockResolvedValue(undefined);
  });

  function makeSession(overrides: Partial<Parameters<typeof useAppWindowSession>[0]> = {}) {
    return useAppWindowSession({
      openDocument: mocks.openDocument,
      saveDocument: vi.fn().mockResolvedValue(true),
      isDirty: () => false,
      windowTitle: ref('solo'),
      shellIntegration: () => false,
      ...overrides,
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

  it('关窗选择取消后恢复自动保存，窗口继续存活（F-03）', async () => {
    const stopAutoSave = vi.fn();
    const resumeAutoSave = vi.fn();
    const session = makeSession({
      isDirty: () => true,
      stopAutoSave,
      resumeAutoSave,
    });
    await session.setup();

    const closing = capturedCloseHandler!();
    await vi.waitFor(() => expect(document.querySelector('.unsaved-overlay')).not.toBeNull());
    (document.querySelector('[data-action="cancel"]') as HTMLElement).click();
    await closing;

    expect(stopAutoSave).toHaveBeenCalledTimes(1);
    expect(resumeAutoSave).toHaveBeenCalledTimes(1);
    expect(mocks.destroyCurrentWindow).not.toHaveBeenCalled();
    expect(mocks.reportWindowClose).toHaveBeenCalledWith('abort');
  });

  it('关窗保存期间又有新编辑时不销毁窗口，并恢复自动保存（F-04）', async () => {
    const stopAutoSave = vi.fn();
    const resumeAutoSave = vi.fn();
    const session = makeSession({
      isDirty: vi.fn().mockReturnValueOnce(true).mockReturnValue(true),
      saveDocument: vi.fn().mockResolvedValue(true),
      stopAutoSave,
      resumeAutoSave,
    });
    await session.setup();

    const closing = capturedCloseHandler!();
    await vi.waitFor(() => expect(document.querySelector('.unsaved-overlay')).not.toBeNull());
    (document.querySelector('[data-action="save"]') as HTMLElement).click();
    await closing;

    expect(stopAutoSave).toHaveBeenCalledTimes(1);
    expect(resumeAutoSave).toHaveBeenCalledTimes(1);
    expect(mocks.destroyCurrentWindow).not.toHaveBeenCalled();
    expect(mocks.saveWindowState).toHaveBeenCalledTimes(1);
    expect(mocks.reportWindowClose).toHaveBeenCalledWith('abort');
    expect(mocks.message).toHaveBeenCalledWith(
      expect.stringContaining('新的编辑'),
      expect.anything(),
    );
  });

  it('窗口状态保存期间又有新编辑时不销毁窗口（F-04）', async () => {
    let resolveWindowState!: () => void;
    mocks.saveWindowState.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveWindowState = resolve;
      }),
    );
    let dirty = false;
    const resumeAutoSave = vi.fn();
    const session = makeSession({ isDirty: () => dirty, resumeAutoSave });
    await session.setup();

    const closing = capturedCloseHandler!();
    await vi.waitFor(() => expect(mocks.saveWindowState).toHaveBeenCalledTimes(1));
    dirty = true;
    resolveWindowState();
    await closing;

    expect(resumeAutoSave).toHaveBeenCalledTimes(1);
    expect(mocks.destroyCurrentWindow).not.toHaveBeenCalled();
    expect(mocks.reportWindowClose).toHaveBeenCalledWith('abort');
    expect(mocks.message).toHaveBeenCalledWith(
      expect.stringContaining('新的编辑'),
      expect.anything(),
    );
  });

  it('关窗保存失败后恢复自动保存，窗口继续存活（F-03）', async () => {
    const stopAutoSave = vi.fn();
    const resumeAutoSave = vi.fn();
    const session = makeSession({
      isDirty: () => true,
      saveDocument: vi.fn().mockResolvedValue(false),
      stopAutoSave,
      resumeAutoSave,
    });
    await session.setup();

    const closing = capturedCloseHandler!();
    await vi.waitFor(() => expect(document.querySelector('.unsaved-overlay')).not.toBeNull());
    (document.querySelector('[data-action="save"]') as HTMLElement).click();
    await closing;

    expect(stopAutoSave).toHaveBeenCalledTimes(1);
    expect(resumeAutoSave).toHaveBeenCalledTimes(1);
    expect(mocks.destroyCurrentWindow).not.toHaveBeenCalled();
    expect(mocks.reportWindowClose).toHaveBeenCalledWith('abort');
  });

  it('关闭链抛异常时恢复自动保存并复位看门狗', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const resumeAutoSave = vi.fn();
    const session = makeSession({
      isDirty: () => true,
      saveDocument: vi.fn().mockRejectedValue(new Error('save crashed')),
      resumeAutoSave,
    });
    await session.setup();

    const closing = capturedCloseHandler!();
    await vi.waitFor(() => expect(document.querySelector('.unsaved-overlay')).not.toBeNull());
    (document.querySelector('[data-action="save"]') as HTMLElement).click();
    await closing;

    expect(resumeAutoSave).toHaveBeenCalledTimes(1);
    expect(mocks.destroyCurrentWindow).not.toHaveBeenCalled();
    expect(mocks.reportWindowClose).toHaveBeenCalledWith('abort');
  });

  it('主动放弃未保存修改后仍能正常关闭', async () => {
    const session = makeSession({ isDirty: () => true });
    await session.setup();

    const closing = capturedCloseHandler!();
    await vi.waitFor(() => expect(document.querySelector('.unsaved-overlay')).not.toBeNull());
    (document.querySelector('[data-action="discard"]') as HTMLElement).click();
    await closing;

    expect(mocks.destroyCurrentWindow).toHaveBeenCalledTimes(1);
  });

  it('正常关闭不恢复自动保存，避免窗口销毁后再次写盘', async () => {
    const stopAutoSave = vi.fn();
    const resumeAutoSave = vi.fn();
    const session = makeSession({ stopAutoSave, resumeAutoSave });
    await session.setup();

    await capturedCloseHandler!();

    expect(stopAutoSave).toHaveBeenCalledTimes(1);
    expect(resumeAutoSave).not.toHaveBeenCalled();
    expect(mocks.destroyCurrentWindow).toHaveBeenCalledTimes(1);
  });
});
