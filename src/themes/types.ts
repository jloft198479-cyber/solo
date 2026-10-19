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
  /**
   * 编辑器中的「次级容器」底色：代码块工具条 / 数学块 / frontmatter / 图片占位 /
   * 斜杠菜单图标 / 设置底栏。缺省回退 `--sidebar-bg`（即今天的观感）。
   * 单独成项是为了切断 `sidebarBg` 的兼职 —— 它本意只该管右侧大纲面板。
   */
  surfaceAltColor?: string;
  textColor: string;
  textSecondary: string;
  mutedColor: string;
  borderColor: string;
  borderLight: string;
  /** 水平分割线 `hr`。缺省回退 `--border-light` */
  hrColor?: string;
  /** 表格单元格边框。缺省回退 `--border-color` */
  tableBorderColor?: string;
  /** 列表前的小圆点 / 序号。缺省回退 `--text-secondary` */
  listMarkerColor?: string;
  sidebarBg: string;
  sidebarHover: string;
  codeBg: string;
  codeBorder: string;
  hoverBg: string;
  activeBg: string;
  selectedBg: string;
  /** 编辑器内选中文本的底色。缺省回退 `primary-color` 18% 混合 */
  selectionBg?: string;
  quoteBg: string;
  /** 引用块左侧竖线。缺省回退 `--primary-color`（与 quoteBg 对称） */
  quoteBorderColor?: string;
  /**
   * 标签底色/文字色。**预留槽位**：solo 暂无标签功能，界面无消费点。
   * 故为可选 —— 主题模板不提供，写了也不生效（`main.css` 只保留变量定义）。
   */
  tagBg?: string;
  tagColor?: string;
  successColor: string;
  /** 成功提示底色。**预留槽位**：暂无 toast 类 UI，无消费点 */
  successBg?: string;
  warningColor: string;
  warningBg: string;
  errorColor: string;
  errorBg: string;
  infoColor: string;
  /** 信息提示底色。**预留槽位**：暂无 toast 类 UI，无消费点 */
  infoBg?: string;
  shadowSm: string;
  shadowMd: string;
  /** 大/超大阴影。**预留槽位**：弹窗走 modalShadow、浮层走 popoverShadow，无消费点 */
  shadowLg?: string;
  shadowXl?: string;
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
 * 排版变量（**按层级分工**：全文级四项归「设置 → 编辑器」，主题只保留局部视觉项）。
 *
 * 现状：9 套预设的 `typography` 全是空的 ⇒ 换主题只换颜色，不换排版；
 * 主题模板给的是 7 个局部项（H1~H6 字号梯度 + 引用块边框宽度），值等于默认值，
 * 照抄不改版式零变化（`theme-template.spec.ts` 锁「模板值 = editor.css 实测值」）。
 * ⚠️ `lineHeight` / `fontSize` / `letterSpacing` / `paragraphSpacing` 已从模板移除
 * （全文级排版归设置管，主题不该碰），仅为兼容旧版自定义主题文件而保留在接口里。
 *
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
  surfaceAltColor: '--surface-alt',
  textColor: '--text-color',
  textSecondary: '--text-secondary',
  mutedColor: '--muted-color',
  borderColor: '--border-color',
  borderLight: '--border-light',
  hrColor: '--hr-color',
  tableBorderColor: '--table-border-color',
  listMarkerColor: '--list-marker-color',
  sidebarBg: '--sidebar-bg',
  sidebarHover: '--sidebar-hover',
  codeBg: '--code-bg',
  codeBorder: '--code-border',
  hoverBg: '--hover-bg',
  activeBg: '--active-bg',
  selectedBg: '--selected-bg',
  selectionBg: '--selection-bg',
  quoteBg: '--quote-bg',
  quoteBorderColor: '--blockquote-border-color',
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
