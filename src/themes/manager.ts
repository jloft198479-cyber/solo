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
    const value = colors[colorKey];
    if (value) {
      style.setProperty(cssVar, value);
    }
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
  heading1LineHeight: '--mk-heading1-line-height',
  heading2LineHeight: '--mk-heading2-line-height',
  heading3LineHeight: '--mk-heading3-line-height',
  heading4LineHeight: '--mk-heading4-line-height',
  heading5LineHeight: '--mk-heading5-line-height',
  heading6LineHeight: '--mk-heading6-line-height',
  heading1Margin: '--mk-heading1-margin',
  heading2Margin: '--mk-heading2-margin',
  heading3Margin: '--mk-heading3-margin',
  heading4Margin: '--mk-heading4-margin',
  heading5Margin: '--mk-heading5-margin',
  heading6Margin: '--mk-heading6-margin',
  heading1LetterSpacing: '--mk-heading1-letter-spacing',
  heading2LetterSpacing: '--mk-heading2-letter-spacing',
  quoteBorderWidth: '--mk-quote-border-width',
  markBorderRadius: '--mk-mark-radius',
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
      const value = colors[key as keyof ThemeColors];
      if (value) vars[cssVar] = value;
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
  // 编辑区内容 crossfade：灭「内容闪一下」的体感（与 theme-transitioning 协同）
  triggerContentCrossfade();
  setTimeout(() => {
    document.documentElement.classList.remove('theme-transitioning');
  }, 300);
}

/**
 * 给编辑区 .mk-editor 加一次 200ms 透明度淡入。
 * 主题 / 字体切换时调用：CSS 变量重绘会让内容闪一下，crossfade 抹平这个闪烁感。
 * 容器不存在时安全跳过。
 */
let _crossfadeTimer: ReturnType<typeof setTimeout> | null = null;
export function triggerContentCrossfade() {
  const el = document.querySelector('.mk-editor');
  if (!el) return;
  if (_crossfadeTimer) {
    clearTimeout(_crossfadeTimer);
    _crossfadeTimer = null;
  }
  // 强制重排让动画能再次触发（连续切换主题的情况）
  el.classList.remove('mk-content-crossfade');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('mk-content-crossfade');
  _crossfadeTimer = setTimeout(() => {
    el.classList.remove('mk-content-crossfade');
    _crossfadeTimer = null;
  }, 220);
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


