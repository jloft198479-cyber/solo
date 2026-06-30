import { getTheme as getAppTheme } from '../../themes/manager';
import type { ExportThemeTokens } from './model';

export function getExportThemeTokensFromAppTheme(themeId: string): ExportThemeTokens {
  const theme = getAppTheme(themeId, []);
  if (theme) return tokensFromAppTheme(theme);
  const fallback = getAppTheme('scholar-light', []);
  if (!fallback) return fallbackTokens();
  return tokensFromAppTheme(fallback);
}

function tokensFromAppTheme(theme: NonNullable<ReturnType<typeof getAppTheme>>): ExportThemeTokens {
  const c = theme.colors;
  return {
    accent: c.primaryColor,
    accentStrong: c.primaryHover,
    accentSoft: c.mutedColor,
    text: c.textColor,
    textMuted: c.textSecondary,
    border: c.borderColor,
    surface: c.bgColor,
    surfaceMuted: c.bgSecondary,
    codeBackground: c.codeBg,
    codeForeground: c.primaryColor,
    preBackground: c.bgSecondary,
    preForeground: c.textColor,
    highlightBg: c.markBg || '#fef08a',
  };
}

function fallbackTokens(): ExportThemeTokens {
  return {
    accent: '#8b7355',
    accentStrong: '#6b5a3e',
    accentSoft: '#a08868',
    text: '#2c2416',
    textMuted: '#5c5040',
    border: '#e4ddd2',
    surface: '#ffffff',
    surfaceMuted: '#faf8f5',
    codeBackground: '#f3efe8',
    codeForeground: '#8b7355',
    preBackground: '#f5f1eb',
    preForeground: '#2c2416',
    highlightBg: '#fef08a',
  };
}
