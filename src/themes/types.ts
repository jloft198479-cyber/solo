/**
 * Theme type definitions.
 */

/** Theme ID */
export type ThemeId = string;

/** Theme type */
export type ThemeType = 'preset' | 'custom';

/** Theme appearance */
export type ThemeAppearance = 'light' | 'dark';

/** Theme metadata */
export interface ThemeMeta {
  /** Theme unique identifier */
  id: ThemeId;
  /** Theme display name */
  name: string;
  /** Theme source */
  type: ThemeType;
  /** Theme appearance */
  appearance: ThemeAppearance;
  /** Theme author */
  author?: string;
  /** Theme description */
  description?: string;
  /** Theme version */
  version?: string;
}

/** Theme colors */
export interface ThemeColors {
  primaryColor: string;
  primaryHover: string;
  primaryLight: string;
  bgColor: string;
  bgSecondary: string;
  textColor: string;
  textSecondary: string;
  mutedColor: string;
  borderColor: string;
  borderLight: string;
  sidebarBg: string;
  sidebarHover: string;
  codeBg: string;
  codeBorder: string;
  hoverBg: string;
  activeBg: string;
  selectedBg: string;
  quoteBg: string;
  tagBg: string;
  tagColor: string;
  successColor: string;
  successBg: string;
  warningColor: string;
  warningBg: string;
  errorColor: string;
  errorBg: string;
  infoColor: string;
  infoBg: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
  shadowXl: string;
  modalBg: string;
  modalBorder: string;
  modalOverlay: string;
  modalShadow: string;
  inputBg: string;
  inputBorder: string;
  inputFocusBorder: string;
  inputFocusShadow: string;
  inputPlaceholder: string;
  btnPrimaryBg: string;
  btnPrimaryHover: string;
  btnPrimaryText: string;
  btnSecondaryBg: string;
  btnSecondaryHover: string;
  btnSecondaryText: string;
  btnGhostBg: string;
  btnGhostHover: string;
  popoverBg: string;
  popoverBorder: string;
  popoverShadow: string;
  calloutNote: string;
  calloutNoteBg: string;
  calloutTip: string;
  calloutTipBg: string;
  calloutWarning: string;
  calloutWarningBg: string;
  calloutDanger: string;
  calloutDangerBg: string;
  calloutSuccess: string;
  calloutSuccessBg: string;
  calloutQuote: string;
  calloutQuoteBg: string;
  calloutAbstract: string;
  calloutAbstractBg: string;
  calloutInfo: string;
  calloutInfoBg: string;
  calloutQuestion: string;
  calloutQuestionBg: string;
  calloutFailure: string;
  calloutFailureBg: string;
  calloutBug: string;
  calloutBugBg: string;
  calloutExample: string;
  calloutExampleBg: string;
  /** 高亮标记背景色 */
  markBg: string;
  /** 信号色 — 用于链接悬停、焦点环、活动指示（可选，缺省回退全局默认） */
  accentColor?: string;
}

/**
 * 排版变量（**预留通道**：字段与注入通道都已接通，但当前 8 套预设一个都没声明）。
 *
 * 现状：换主题只换颜色，不换排版 —— `presets/` 里的 `typography` 全是空的。
 * 声明即生效：`manager.ts` 的 `TYPOGRAPHY_VAR_MAP` 会把声明的字段写成
 * `documentElement` 的行内变量；**不声明的字段退回 `editor.css` 的 `--mk-*` 默认值**。
 *
 * 注释里的「当前 X」= 不声明时的实际生效值。它由 `design-contracts.spec.ts` 与
 * `editor.css` 逐条比对（改 CSS 忘了改这里会直接红），**别在这写"大概"**。
 */
export interface ThemeTypography {
  /** 正文行高。留空取 `--mk-line-height`（当前 1.6） */
  lineHeight?: string;
  /** 正文字号。留空取 `--mk-font-size`（当前 16px） */
  fontSize?: string;
  /** 正文字间距。留空取 `--mk-letter-spacing`（当前 0） */
  letterSpacing?: string;
  /** 段落间距。留空取 `--mk-paragraph-spacing`（当前 1em） */
  paragraphSpacing?: string;
  /** H1 字号。留空取 `--mk-heading1-size`（当前 1.6em） */
  heading1Size?: string;
  /** H2 字号。留空取 `--mk-heading2-size`（当前 1.3em） */
  heading2Size?: string;
  /** H3 字号。留空取 `--mk-heading3-size`（当前 1.2em） */
  heading3Size?: string;
  /** H4 字号。留空取 `--mk-heading4-size`（当前 1.05em） */
  heading4Size?: string;
  /** H5 字号。留空取 `--mk-heading5-size`（当前 1em） */
  heading5Size?: string;
  /** H6 字号。留空取 `--mk-heading6-size`（当前 0.9em） */
  heading6Size?: string;
  /** H1 行高。留空取 `--mk-heading1-line-height`（当前 1.35） */
  heading1LineHeight?: string;
  /** H2 行高。留空取 `--mk-heading2-line-height`（当前 1.4） */
  heading2LineHeight?: string;
  /** H3 行高。留空取 `--mk-heading3-line-height`（当前 1.45） */
  heading3LineHeight?: string;
  /** H4 行高。留空取 `--mk-heading4-line-height`（当前 1.5） */
  heading4LineHeight?: string;
  /** H5 行高。留空取 `--mk-heading5-line-height`（当前 1.5） */
  heading5LineHeight?: string;
  /** H6 行高。留空取 `--mk-heading6-line-height`（当前 1.5） */
  heading6LineHeight?: string;
  /** H1 上下 margin。留空取 `--mk-heading1-margin`（当前 1.25em 0 0.6em） */
  heading1Margin?: string;
  /** H2 上下 margin。留空取 `--mk-heading2-margin`（当前 1em 0 0.5em） */
  heading2Margin?: string;
  /** H3 上下 margin。留空取 `--mk-heading3-margin`（当前 0.75em 0 0.4em） */
  heading3Margin?: string;
  /** H4 上下 margin。留空取 `--mk-heading4-margin`（当前 0.6em 0 0.3em） */
  heading4Margin?: string;
  /** H5 上下 margin。留空取 `--mk-heading5-margin`（当前 0.5em 0 0.3em） */
  heading5Margin?: string;
  /** H6 上下 margin。留空取 `--mk-heading6-margin`（当前 0.5em 0 0.3em） */
  heading6Margin?: string;
  /** H1 字间距。留空取 `--mk-heading1-letter-spacing`（当前 -0.02em） */
  heading1LetterSpacing?: string;
  /** H2 字间距。留空取 `--mk-heading2-letter-spacing`（当前 -0.01em） */
  heading2LetterSpacing?: string;
  /** 引用块边框宽度。留空取 `--mk-quote-border-width`（当前 2px） */
  quoteBorderWidth?: string;
  /** 高亮标记圆角。留空取 `--mk-mark-radius`（当前 0.25em） */
  markBorderRadius?: string;
}

/** Single theme definition */
export interface Theme extends ThemeMeta {
  /** Theme colors */
  colors: ThemeColors;
  /** Theme typography (optional) */
  typography?: ThemeTypography;
}

/** CSS variable map */
export const CSS_VAR_MAP: Record<keyof ThemeColors, string> = {
  primaryColor: '--primary-color',
  primaryHover: '--primary-hover',
  primaryLight: '--primary-light',
  bgColor: '--bg-color',
  bgSecondary: '--bg-secondary',
  textColor: '--text-color',
  textSecondary: '--text-secondary',
  mutedColor: '--muted-color',
  borderColor: '--border-color',
  borderLight: '--border-light',
  sidebarBg: '--sidebar-bg',
  sidebarHover: '--sidebar-hover',
  codeBg: '--code-bg',
  codeBorder: '--code-border',
  hoverBg: '--hover-bg',
  activeBg: '--active-bg',
  selectedBg: '--selected-bg',
  quoteBg: '--quote-bg',
  tagBg: '--tag-bg',
  tagColor: '--tag-color',
  successColor: '--success-color',
  successBg: '--success-bg',
  warningColor: '--warning-color',
  warningBg: '--warning-bg',
  errorColor: '--error-color',
  errorBg: '--error-bg',
  infoColor: '--info-color',
  infoBg: '--info-bg',
  shadowSm: '--shadow-sm',
  shadowMd: '--shadow-md',
  shadowLg: '--shadow-lg',
  shadowXl: '--shadow-xl',
  modalBg: '--modal-bg',
  modalBorder: '--modal-border',
  modalOverlay: '--modal-overlay',
  modalShadow: '--modal-shadow',
  inputBg: '--input-bg',
  inputBorder: '--input-border',
  inputFocusBorder: '--input-focus-border',
  inputFocusShadow: '--input-focus-shadow',
  inputPlaceholder: '--input-placeholder',
  btnPrimaryBg: '--btn-primary-bg',
  btnPrimaryHover: '--btn-primary-hover',
  btnPrimaryText: '--btn-primary-text',
  btnSecondaryBg: '--btn-secondary-bg',
  btnSecondaryHover: '--btn-secondary-hover',
  btnSecondaryText: '--btn-secondary-text',
  btnGhostBg: '--btn-ghost-bg',
  btnGhostHover: '--btn-ghost-hover',
  popoverBg: '--popover-bg',
  popoverBorder: '--popover-border',
  popoverShadow: '--popover-shadow',
  calloutNote: '--callout-note',
  calloutNoteBg: '--callout-note-bg',
  calloutTip: '--callout-tip',
  calloutTipBg: '--callout-tip-bg',
  calloutWarning: '--callout-warning',
  calloutWarningBg: '--callout-warning-bg',
  calloutDanger: '--callout-danger',
  calloutDangerBg: '--callout-danger-bg',
  calloutSuccess: '--callout-success',
  calloutSuccessBg: '--callout-success-bg',
  calloutQuote: '--callout-quote',
  calloutQuoteBg: '--callout-quote-bg',
  calloutAbstract: '--callout-abstract',
  calloutAbstractBg: '--callout-abstract-bg',
  calloutInfo: '--callout-info',
  calloutInfoBg: '--callout-info-bg',
  calloutQuestion: '--callout-question',
  calloutQuestionBg: '--callout-question-bg',
  calloutFailure: '--callout-failure',
  calloutFailureBg: '--callout-failure-bg',
  calloutBug: '--callout-bug',
  calloutBugBg: '--callout-bug-bg',
  calloutExample: '--callout-example',
  calloutExampleBg: '--callout-example-bg',
  markBg: '--mark-bg',
  accentColor: '--accent-color',
};


