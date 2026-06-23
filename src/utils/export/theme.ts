import { getThemeById } from '../wechat-themes';
import { getTheme as getAppTheme } from '../../themes/manager';
import type { ExportThemeTokens } from './model';

export function getExportThemeTokens(themeId: string = 'blue'): ExportThemeTokens {
  const theme = getThemeById(themeId);

  return {
    accent: theme.colors.primary,
    accentStrong: theme.colors.primaryDark,
    accentSoft: theme.colors.primaryLight,
    text: theme.colors.text,
    textMuted: theme.colors.textMuted,
    border: theme.colors.tableBorder,
    surface: '#ffffff',
    surfaceMuted: theme.colors.blockquoteBg,
    codeBackground: theme.colors.codeBg,
    codeForeground: theme.colors.codeColor,
    preBackground: theme.colors.preBg,
    preForeground: theme.colors.preColor,
  };
}

/**
 * 从编辑器主题（themes/presets/*.json）派生导出色彩 tokens。
 *
 * HTML 导出使用编辑器主题 ID（如 'scholar-light'），
 * 而非微信主题 ID（如 'scholar'），两套系统独立。
 */
export function getExportThemeTokensFromAppTheme(themeId: string): ExportThemeTokens {
  const theme = getAppTheme(themeId, []);
  if (!theme) {
    return getExportThemeTokens('scholar');
  }

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
  };
}
