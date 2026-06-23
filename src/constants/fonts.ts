/**
 * 字体选项常量
 *
 * 统一维护编辑器可选字体清单，供 FontPopover 与 SettingsFontSelect 共享，
 * 避免清单分散导致新增/删除字体时出现多处修改遗漏。
 */

export interface FontOption {
  /** CSS font-family 值（system-ui 等 CSS 关键字不加引号） */
  value: string;
  /** 展示名称 */
  label: string;
}

/**
 * 可选字体清单。
 * 顺序即展示顺序：思源宋体 → 微软雅黑 UI → 朱雀仿宋 → 小赖字体 → 霞鹜文楷 → 汇文明朝 → 系统默认。
 */
export const FONT_OPTIONS: readonly FontOption[] = [
  { value: 'Noto Serif SC', label: '思源宋体' },
  { value: 'Microsoft YaHei UI', label: '微软雅黑 UI' },
  { value: 'Zhuque Fangsong', label: '朱雀仿宋' },
  { value: 'Xiaolai SC', label: '小赖字体' },
  { value: 'LXGW WenKai', label: '霞鹜文楷' },
  { value: 'Huiwen-mincho', label: '汇文明朝' },
  { value: 'system-ui', label: '系统默认' },
] as const;
