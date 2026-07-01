/**
 * 字体选项常量
 *
 * 统一维护编辑器可选字体清单，供 FontPopover 与 SettingsFontSelect 共享，
 * 避免清单分散导致新增/删除字体时出现多处修改遗漏。
 *
 * 下载型字体（有 fileName）首次使用时从远端加载并缓存到本地，
 * 系统字体（微软雅黑 UI、system-ui）无需加载。
 */

export interface FontOption {
  /** CSS font-family 值（system-ui 等 CSS 关键字不加引号） */
  value: string;
  /** 展示名称 */
  label: string;
  /** 远程下载地址。指向 GitHub Release asset 或 CDN，undefined 表示系统字体无需下载 */
  downloadUrl?: string;
  /** 原始字体文件名（用于缓存标识和排查） */
  fileName?: string;
}

/**
 * 可选字体清单。
 * 顺序即展示顺序：思源宋体 → 微软雅黑 UI → 朱雀仿宋 → 小赖字体 → 霞鹜文楷 → 汇文明朝 → 系统默认。
 */

export const FONT_OPTIONS: readonly FontOption[] = [
  { value: 'system-ui',      label: '系统默认' },
  { value: 'Microsoft YaHei UI', label: '微软雅黑 UI' },
  { value: 'Noto Serif SC',  label: '思源宋体',   downloadUrl: '1', fileName: 'NotoSerifSC-Regular.otf' },
  { value: 'Zhuque Fangsong', label: '朱雀仿宋',   downloadUrl: '1', fileName: 'ZhuqueFangsong-Regular.ttf' },
  { value: 'Xiaolai SC',     label: '小赖字体',   downloadUrl: '1', fileName: 'XiaolaiSC-Regular.ttf' },
  { value: 'LXGW WenKai',    label: '霞鹜文楷',   downloadUrl: '1', fileName: 'LXGWWenKai-Regular.ttf' },
  { value: 'Huiwen-mincho',  label: '汇文明朝',   downloadUrl: '1', fileName: 'Huiwen-mincho-Regular.otf' },
] as const;
