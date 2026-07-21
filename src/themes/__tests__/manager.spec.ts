import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, getPresetTheme, importTheme } from '../manager';
import type { Theme } from '../types';

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

  it('injects --dirty-color from a preset that defines it', () => {
    const theme = getPresetTheme('default-light');
    expect(theme?.colors.dirtyColor).toBeTruthy();

    applyTheme(theme!);

    expect(mocks.setPropertyMock).toHaveBeenCalledWith('--dirty-color', theme!.colors.dirtyColor);
  });

  it('does not inject --dirty-color when the theme omits it (CSS fallback applies)', () => {
    const theme: Theme = {
      id: 'no-dirty',
      name: 'No Dirty',
      type: 'custom',
      appearance: 'light',
      colors: { ...getPresetTheme('default-light')!.colors, dirtyColor: undefined },
    };

    applyTheme(theme);

    const dirtyCalls = mocks.setPropertyMock.mock.calls.filter((c) => c[0] === '--dirty-color');
    expect(dirtyCalls).toHaveLength(0);
  });
});
