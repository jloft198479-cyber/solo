import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, getPresetTheme, importTheme } from '../manager';

const mocks = vi.hoisted(() => ({
  toggleMock: vi.fn(),
  setPropertyMock: vi.fn(),
  setCurrentWindowThemeMock: vi.fn(),
  setCurrentWindowBackgroundColorMock: vi.fn(),
}));

vi.mock('../../services/tauri/window', () => ({
  setCurrentWindowTheme: mocks.setCurrentWindowThemeMock,
  setCurrentWindowBackgroundColor: mocks.setCurrentWindowBackgroundColorMock,
}));

beforeEach(() => {
  mocks.toggleMock.mockReset();
  mocks.setPropertyMock.mockReset();
  mocks.setCurrentWindowThemeMock.mockReset();
  mocks.setCurrentWindowBackgroundColorMock.mockReset();
  vi.stubGlobal('document', {
    documentElement: {
      classList: {
        toggle: mocks.toggleMock,
        add: vi.fn(),
        remove: vi.fn(),
      },
      style: {
        setProperty: mocks.setPropertyMock,
        getPropertyValue: vi.fn(() => ''),
        removeProperty: vi.fn(),
      },
      getBoundingClientRect: vi.fn(),
    },
    // triggerContentCrossfade 在测试无 .mk-editor 时安全跳过
    querySelector: vi.fn(() => null),
  });
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme manager', () => {
  it('applies dark themes through a single appearance flag', () => {
    const theme = getPresetTheme('scholar-dark');
    expect(theme).toBeTruthy();

    applyTheme(theme!);

    expect(mocks.toggleMock).toHaveBeenCalledWith('dark', true);
    expect(mocks.setPropertyMock).toHaveBeenCalledWith('--bg-color', theme!.colors.bgColor);
  });

  it('applies light themes without the dark class', () => {
    const theme = getPresetTheme('default-light');
    expect(theme).toBeTruthy();

    applyTheme(theme!);

    expect(mocks.toggleMock).toHaveBeenCalledWith('dark', false);
  });

  it('imports legacy theme files as a single appearance theme', () => {
    const imported = importTheme(
      JSON.stringify({
        id: 'legacy-demo',
        name: 'Legacy Demo',
        type: 'custom',
        light: getPresetTheme('default-light')!.colors,
        dark: getPresetTheme('scholar-dark')!.colors,
      }),
      'dark',
    );

    expect(imported).toMatchObject({
      id: 'legacy-demo',
      name: 'Legacy Demo',
      type: 'custom',
      appearance: 'dark',
      colors: getPresetTheme('scholar-dark')!.colors,
    });
  });

  it('--success-color 随主题注入且跨主题不同（已保存态跟随主题）', () => {
    const light = getPresetTheme('default-light')!;
    const dark = getPresetTheme('scholar-dark')!;

    applyTheme(light);
    const lightSuccess = mocks.setPropertyMock.mock.calls.find(
      (c) => c[0] === '--success-color',
    )?.[1];
    mocks.setPropertyMock.mockClear();
    applyTheme(dark);
    const darkSuccess = mocks.setPropertyMock.mock.calls.find(
      (c) => c[0] === '--success-color',
    )?.[1];

    expect(lightSuccess).toBeTruthy();
    expect(darkSuccess).toBeTruthy();
    expect(lightSuccess).not.toEqual(darkSuccess);
  });

  // 注：原先三条 `--dirty-color` 用例已随该 token 一并移除（2026-10-13）——
  // 状态栏「未保存」色改为跟随主题主色（--primary-color），主题不再注入该变量。
});
