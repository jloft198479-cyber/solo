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
      },
      getBoundingClientRect: vi.fn(),
    },
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
});
