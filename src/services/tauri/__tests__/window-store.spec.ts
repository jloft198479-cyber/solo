import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TAURI_COMMANDS } from '../command-names';

const mocks = vi.hoisted(() => {
  const window = {
    setTitle: vi.fn(),
    destroy: vi.fn(),
    isFullscreen: vi.fn(),
    setFullscreen: vi.fn(),
    setTheme: vi.fn(),
  };

  return {
    window,
    getCurrentWindow: vi.fn(() => window),
    invokeCommand: vi.fn(),
    storeGet: vi.fn(),
    storeSet: vi.fn(),
    storeSave: vi.fn(),
    lazyStoreConstructor: vi.fn(),
  };
});

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    constructor(path: string, options: unknown) {
      mocks.lazyStoreConstructor(path, options);
    }

    get<T>(key: string): Promise<T | undefined> {
      return mocks.storeGet(key);
    }

    set(key: string, value: unknown): Promise<void> {
      return mocks.storeSet(key, value);
    }

    save(): Promise<void> {
      return mocks.storeSave();
    }
  },
}));

vi.mock('../client', () => ({
  invokeCommand: mocks.invokeCommand,
}));

describe('tauri window service', () => {
  beforeEach(() => {
    Object.values(mocks.window).forEach((mock) => mock.mockReset());
    mocks.getCurrentWindow.mockClear();
    mocks.invokeCommand.mockReset();
  });

  it('routes current window operations through the window API', async () => {
    mocks.window.isFullscreen.mockResolvedValueOnce(false);

    const {
      destroyCurrentWindow,
      isCurrentWindowFullscreen,
      setCurrentWindowFullscreen,
      setCurrentWindowTheme,
      setCurrentWindowTitle,
    } = await import('../window');

    await setCurrentWindowTitle('Demo');
    await expect(isCurrentWindowFullscreen()).resolves.toBe(false);
    await setCurrentWindowFullscreen(true);
    await setCurrentWindowTheme('dark');
    await destroyCurrentWindow();

    expect(mocks.window.setTitle).toHaveBeenCalledWith('Demo');
    expect(mocks.window.isFullscreen).toHaveBeenCalledWith();
    expect(mocks.window.setFullscreen).toHaveBeenCalledWith(true);
    expect(mocks.window.setTheme).toHaveBeenCalledWith('dark');
    expect(mocks.window.destroy).toHaveBeenCalledWith();
  });

  it('routes native window commands through the command wrapper', async () => {
    const {
      startupReady,
      refreshNativeMenuShortcuts,
      revealStartupOpenLog,
      setCurrentWindowBackgroundColor,
    } = await import('../window');

    await setCurrentWindowBackgroundColor('#ffffff');
    await refreshNativeMenuShortcuts({ 'file.save': 'CmdOrCtrl+S' });
    await revealStartupOpenLog();
    await startupReady();

    expect(mocks.invokeCommand).toHaveBeenNthCalledWith(
      1,
      TAURI_COMMANDS.setWindowBackgroundColor,
      { color: '#ffffff' },
    );
    expect(mocks.invokeCommand).toHaveBeenNthCalledWith(
      2,
      TAURI_COMMANDS.refreshNativeMenuShortcuts,
      { shortcuts: { 'file.save': 'CmdOrCtrl+S' } },
    );
    expect(mocks.invokeCommand).toHaveBeenNthCalledWith(3, TAURI_COMMANDS.revealStartupOpenLog);
    expect(mocks.invokeCommand).toHaveBeenNthCalledWith(4, TAURI_COMMANDS.startupReady);
  });
});

describe('tauri store service', () => {
  beforeEach(() => {
    mocks.storeGet.mockReset();
    mocks.storeSet.mockReset();
    mocks.storeSave.mockReset();
    mocks.lazyStoreConstructor.mockClear();
  });

  it('initializes the settings store with the app settings file', async () => {
    await import('../store');

    expect(mocks.lazyStoreConstructor).toHaveBeenCalledWith('settings.json', {
      defaults: {},
      autoSave: false,
    });
  });

  it('reads and writes persisted settings through LazyStore', async () => {
    const settings = { theme: 'light' };
    mocks.storeGet.mockResolvedValueOnce(settings);

    const { readStoredSettings, writeStoredSettings } = await import('../store');

    await expect(readStoredSettings()).resolves.toBe(settings);
    await writeStoredSettings(settings);

    expect(mocks.storeGet).toHaveBeenCalledWith('settings');
    expect(mocks.storeSet).toHaveBeenCalledWith('settings', settings);
    expect(mocks.storeSave).toHaveBeenCalledWith();
  });

  it('reads and writes persisted focus mode through LazyStore', async () => {
    mocks.storeGet.mockResolvedValueOnce(true);

    const { readStoredFocusMode, writeStoredFocusMode } = await import('../store');

    await expect(readStoredFocusMode()).resolves.toBe(true);
    await writeStoredFocusMode(false);

    expect(mocks.storeGet).toHaveBeenCalledWith('focusMode');
    expect(mocks.storeSet).toHaveBeenCalledWith('focusMode', false);
    expect(mocks.storeSave).toHaveBeenCalledWith();
  });
});


