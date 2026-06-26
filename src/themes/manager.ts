/**
 * Theme manager.
 */

import {
  setCurrentWindowBackgroundColor,
  setCurrentWindowTheme,
  type NativeWindowTheme,
} from '../services/tauri/window';
import type { Theme, ThemeAppearance, ThemeColors, ThemeTypography } from './types';
import { CSS_VAR_MAP } from './types';

import scholarLightTheme from './presets/scholar.json';
import scholarDarkTheme from './presets/scholar-dark.json';
import elegantLightTheme from './presets/elegant.json';
import cinnabarLightTheme from './presets/cinnabar.json';
import cinnabarDarkTheme from './presets/cinnabar-dark.json';
import defaultLightTheme from './presets/default.json';
import grayDomainTheme from './presets/gray-domain.json';

const PRESET_THEMES: Theme[] = [
  scholarLightTheme as Theme,
  scholarDarkTheme as Theme,
  elegantLightTheme as Theme,
  cinnabarLightTheme as Theme,
  cinnabarDarkTheme as Theme,
  defaultLightTheme as Theme,
  grayDomainTheme as Theme,
];

const presetThemeMap = new Map<string, Theme>(PRESET_THEMES.map((theme) => [theme.id, theme]));

let isDarkMode = false;

interface LegacyThemeFile {
  id: string;
  name: string;
  type?: 'preset' | 'custom';
  author?: string;
  description?: string;
  version?: string;
  light: ThemeColors;
  dark: ThemeColors;
}

function injectColors(colors: ThemeColors) {
  const style = document.documentElement.style;

  for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
    const colorKey = key as keyof ThemeColors;
    style.setProperty(cssVar, colors[colorKey]);
  }
}

function applyDarkClass(appearance: ThemeAppearance) {
  isDarkMode = appearance === 'dark';
  document.documentElement.classList.toggle('dark', isDarkMode);
}

async function syncNativeWindowTheme(appearance: ThemeAppearance) {
  try {
    await setCurrentWindowTheme(appearance as NativeWindowTheme);
  } catch {
    // Ignore in unsupported environments.
  }
}

async function syncNativeWindowBackground(bgColor: string) {
  try {
    await setCurrentWindowBackgroundColor(bgColor);
  } catch {
    // Ignore in unsupported environments.
  }
}

const TYPOGRAPHY_VAR_MAP: Record<keyof ThemeTypography, string> = {
  lineHeight: '--mk-line-height',
  fontSize: '--mk-font-size',
  letterSpacing: '--mk-letter-spacing',
  paragraphSpacing: '--mk-paragraph-spacing',
  heading1Size: '--mk-heading1-size',
  heading2Size: '--mk-heading2-size',
  heading3Size: '--mk-heading3-size',
  heading4Size: '--mk-heading4-size',
  heading5Size: '--mk-heading5-size',
  heading6Size: '--mk-heading6-size',
  quoteBorderWidth: '--mk-quote-border-width',
};

function injectTypography(typography?: ThemeTypography) {
  const style = document.documentElement.style;
  // 先重置所有排版变量为空字符串，让 CSS 默认值生效
  for (const cssVar of Object.values(TYPOGRAPHY_VAR_MAP)) {
    try {
      style.removeProperty(cssVar);
    } catch {
      style.setProperty(cssVar, '');
    }
  }
  // 再注入主题自定义值
  if (!typography) return;
  for (const [key, cssVar] of Object.entries(TYPOGRAPHY_VAR_MAP)) {
    const value = typography[key as keyof ThemeTypography];
    if (value) {
      style.setProperty(cssVar, value);
    }
  }
}

const THEME_PAINT_KEY = 'solo-theme-paint';

function persistThemeColors(colors: ThemeColors, appearance: ThemeAppearance) {
  try {
    const vars: Record<string, string> = {};
    for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
      vars[cssVar] = colors[key as keyof ThemeColors];
    }
    localStorage.setItem(
      THEME_PAINT_KEY,
      JSON.stringify({ d: appearance === 'dark', v: vars }),
    );
  } catch {
    // localStorage unavailable (private browsing, etc.)
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.add('theme-transitioning');
  document.documentElement.getBoundingClientRect();
  applyDarkClass(theme.appearance);
  injectColors(theme.colors);
  persistThemeColors(theme.colors, theme.appearance);
  injectTypography(theme.typography);
  void syncNativeWindowTheme(theme.appearance);
  void syncNativeWindowBackground(theme.colors.bgColor);
  setTimeout(() => {
    document.documentElement.classList.remove('theme-transitioning');
  }, 300);
}

export function getPresetTheme(id: string): Theme | undefined {
  return presetThemeMap.get(id);
}

export function getAllPresetThemes(): Theme[] {
  return PRESET_THEMES;
}

export function getTheme(id: string, customThemes: Theme[]): Theme | undefined {
  return presetThemeMap.get(id) ?? customThemes.find((theme) => theme.id === id);
}

export function exportTheme(theme: Theme): string {
  return JSON.stringify(theme, null, 2);
}

function isThemeColors(value: unknown): value is ThemeColors {
  return typeof value === 'object' && value !== null && 'bgColor' in value && 'textColor' in value;
}

function isModernTheme(value: unknown): value is Theme {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'appearance' in value &&
    'colors' in value &&
    isThemeColors((value as { colors: unknown }).colors)
  );
}

function isLegacyTheme(value: unknown): value is LegacyThemeFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'light' in value &&
    'dark' in value &&
    isThemeColors((value as { light: unknown }).light) &&
    isThemeColors((value as { dark: unknown }).dark)
  );
}

export function importTheme(json: string, appearance: ThemeAppearance = 'light'): Theme {
  const parsed = JSON.parse(json) as unknown;

  if (isModernTheme(parsed)) {
    return {
      ...parsed,
      type: 'custom',
    };
  }

  if (isLegacyTheme(parsed)) {
    return {
      id: parsed.id,
      name: parsed.name,
      type: 'custom',
      appearance,
      author: parsed.author,
      description: parsed.description,
      version: parsed.version,
      colors: appearance === 'dark' ? parsed.dark : parsed.light,
    };
  }

  throw new Error('无效的主题 JSON：缺少必要字段');
}

export function generateThemeId(): string {
  return `custom-${crypto.randomUUID()}`;
}

export function cloneTheme(theme: Theme): Theme {
  return JSON.parse(JSON.stringify(theme));
}

export function getIsDarkMode(): boolean {
  return isDarkMode;
}

export const ThemeManager = {
  applyTheme,
  getPresetTheme,
  getAllPresetThemes,
  getTheme,
  exportTheme,
  importTheme,
  generateThemeId,
  cloneTheme,
  getIsDarkMode,
};
