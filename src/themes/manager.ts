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
import jadeLightTheme from './presets/jade.json';
import orchidLightTheme from './presets/orchid.json';

const PRESET_THEMES: Theme[] = [
  // 浅色组（暖 → 冷）
  scholarLightTheme as Theme,
  elegantLightTheme as Theme,
  cinnabarLightTheme as Theme,
  defaultLightTheme as Theme,
  jadeLightTheme as Theme,
  orchidLightTheme as Theme,
  // 深色组（暖 → 冷）
  scholarDarkTheme as Theme,
  cinnabarDarkTheme as Theme,
];

const presetThemeMap = new Map<string, Theme>(PRESET_THEMES.map((theme) => [theme.id, theme]));

/**
 * 共享默认配色（亮/暗各一套）——「真理源自一处」：
 * 非性格 token（功能色/标记底色/幽灵按钮/遮罩/callout 色板）只定义一次，
 * 主题 JSON 只写性格差异，缺失字段由 resolveTheme 在此补齐。
 * 主题若需定制某个共享值，在其 JSON 中显式声明即可覆盖。
 * 色值均经 WCAG 实测（对比度 ≥4.5 或有意为之，见 .sandbox-theme-audit/verify.py）。
 * 注：圆角（--radius-*）不是主题 token（不随主题变化，属 UI 直角范式），
 * 仅定义在 main.css :root 一份，此处不重复（2026-08-21 简化）。
 */
const SHARED_LIGHT_COLORS: Partial<ThemeColors> = {
  successColor: '#15803d',
  successBg: 'rgba(21, 128, 61, 0.1)',
  warningColor: '#b45309',
  warningBg: 'rgba(180, 83, 9, 0.1)',
  errorColor: '#b91c1c',
  errorBg: 'rgba(185, 28, 28, 0.1)',
  infoColor: '#1d4ed8',
  infoBg: 'rgba(29, 78, 216, 0.1)',
  markBg: '#fef08a',
  btnGhostBg: 'transparent',
  modalOverlay: 'rgba(0, 0, 0, 0.45)',
  calloutNote: '#6b5a3e',
  calloutNoteBg: 'rgba(107, 90, 62, 0.08)',
  calloutAbstract: '#155e75',
  calloutAbstractBg: 'rgba(21, 94, 117, 0.08)',
  calloutInfo: '#1e40af',
  calloutInfoBg: 'rgba(30, 64, 175, 0.08)',
  calloutTip: '#166534',
  calloutTipBg: 'rgba(22, 101, 52, 0.08)',
  calloutSuccess: '#166534',
  calloutSuccessBg: 'rgba(22, 101, 52, 0.08)',
  calloutQuestion: '#5b21b6',
  calloutQuestionBg: 'rgba(91, 33, 182, 0.08)',
  calloutWarning: '#92400e',
  calloutWarningBg: 'rgba(146, 64, 14, 0.08)',
  calloutFailure: '#991b1b',
  calloutFailureBg: 'rgba(153, 27, 27, 0.08)',
  calloutDanger: '#991b1b',
  calloutDangerBg: 'rgba(153, 27, 27, 0.08)',
  calloutBug: '#991b1b',
  calloutBugBg: 'rgba(153, 27, 27, 0.08)',
  calloutExample: '#5b21b6',
  calloutExampleBg: 'rgba(91, 33, 182, 0.08)',
  calloutQuote: '#44403c',
  calloutQuoteBg: 'rgba(68, 64, 60, 0.08)',
};

const SHARED_DARK_COLORS: Partial<ThemeColors> = {
  successColor: '#6ee7b7',
  successBg: 'rgba(110, 231, 183, 0.15)',
  warningColor: '#fbbf24',
  warningBg: 'rgba(251, 191, 36, 0.15)',
  errorColor: '#f87171',
  errorBg: 'rgba(248, 113, 113, 0.15)',
  infoColor: '#93c5fd',
  infoBg: 'rgba(147, 197, 253, 0.15)',
  markBg: 'rgba(254, 240, 138, 0.35)',
  btnGhostBg: 'transparent',
  modalOverlay: 'rgba(0, 0, 0, 0.65)',
  calloutNote: '#b0a080',
  calloutNoteBg: 'rgba(176, 160, 128, 0.1)',
  calloutAbstract: '#67e8f9',
  calloutAbstractBg: 'rgba(103, 232, 249, 0.1)',
  calloutInfo: '#93c5fd',
  calloutInfoBg: 'rgba(147, 197, 253, 0.1)',
  calloutTip: '#86efac',
  calloutTipBg: 'rgba(134, 239, 172, 0.1)',
  calloutSuccess: '#86efac',
  calloutSuccessBg: 'rgba(134, 239, 172, 0.1)',
  calloutQuestion: '#c4b5fd',
  calloutQuestionBg: 'rgba(196, 181, 253, 0.1)',
  calloutWarning: '#fcd34d',
  calloutWarningBg: 'rgba(252, 211, 77, 0.1)',
  calloutFailure: '#fca5a5',
  calloutFailureBg: 'rgba(252, 165, 165, 0.1)',
  calloutDanger: '#fca5a5',
  calloutDangerBg: 'rgba(252, 165, 165, 0.1)',
  calloutBug: '#fca5a5',
  calloutBugBg: 'rgba(252, 165, 165, 0.1)',
  calloutExample: '#c4b5fd',
  calloutExampleBg: 'rgba(196, 181, 253, 0.1)',
  calloutQuote: '#a8a29e',
  calloutQuoteBg: 'rgba(168, 162, 158, 0.1)',
};

/** 用共享默认补齐主题缺失字段，返回完整 colors 的主题（消费方无感知） */
function resolveTheme(theme: Theme): Theme {
  const base = theme.appearance === 'dark' ? SHARED_DARK_COLORS : SHARED_LIGHT_COLORS;
  return { ...theme, colors: { ...base, ...theme.colors } };
}

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
    // diff 注入：仅当值与当前生效值不同才写，避免无谓的样式重算（性能）
    if (value && style.getPropertyValue?.(cssVar) !== value) {
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
  // diff 注入：逐变量比对，仅当值变化才写/删，避免无谓的样式重算（与 injectColors 一致）
  for (const [key, cssVar] of Object.entries(TYPOGRAPHY_VAR_MAP)) {
    const value = typography?.[key as keyof ThemeTypography];
    const current = style.getPropertyValue(cssVar);
    if (value) {
      if (current !== value) {
        style.setProperty(cssVar, value);
      }
    } else if (current) {
      // 无主题值时清除（让 CSS 默认值生效），仅当前有值才操作
      try {
        style.removeProperty(cssVar);
      } catch {
        style.setProperty(cssVar, '');
      }
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
    localStorage.setItem(THEME_PAINT_KEY, JSON.stringify({ d: appearance === 'dark', v: vars }));
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
  // 移除过渡类：时长对齐 --motion-base (200ms)，避免 class 多挂期间
  // 用户快速二次切换时过渡叠加。原生窗口背景设置异步进行，不阻塞此处。
  setTimeout(() => {
    document.documentElement.classList.remove('theme-transitioning');
  }, 200);
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
  const theme = presetThemeMap.get(id);
  return theme ? resolveTheme(theme) : undefined;
}

export function getAllPresetThemes(): Theme[] {
  return PRESET_THEMES.map(resolveTheme);
}

export function getTheme(id: string, customThemes: Theme[]): Theme | undefined {
  const theme = presetThemeMap.get(id) ?? customThemes.find((theme) => theme.id === id);
  return theme ? resolveTheme(theme) : undefined;
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
    return resolveTheme({
      ...parsed,
      type: 'custom',
    });
  }

  if (isLegacyTheme(parsed)) {
    return resolveTheme({
      id: parsed.id,
      name: parsed.name,
      type: 'custom',
      appearance,
      author: parsed.author,
      description: parsed.description,
      version: parsed.version,
      colors: appearance === 'dark' ? parsed.dark : parsed.light,
    });
  }

  throw new Error('无效的主题 JSON：缺少必要字段');
}

export function generateThemeId(): string {
  return `custom-${crypto.randomUUID()}`;
}
