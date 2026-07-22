/**
 * 字体选项常量
 *
 * 统一维护编辑器可选字体清单，供 FontPopover 与 SettingsFontSelect 共享，
 * 避免清单分散导致新增/删除字体时出现多处修改遗漏。
 *
 * 下载型字体（有 fileName）首次使用时从远端加载并缓存到本地，
 * 系统字体（微软雅黑 UI、system-ui）无需加载。
 * 「是否需下载」统一用 fileName !== undefined 推导，UI 与 fontLoader 共用此判定。
 */

export interface FontOption {
  /** CSS font-family 值（system-ui 等 CSS 关键字不加引号） */
  value: string;
  /** 展示名称 */
  label: string;
  /** 字体文件名。有值表示下载型字体（首次使用从远程拉取并缓存到本地），undefined 表示系统字体无需下载 */
  fileName?: string;
}

/**
 * 可选字体清单。
 * 顺序即展示顺序：系统默认 → 微软雅黑 UI → 思源宋体 → 朱雀仿宋 → 小赖字体 → 霞鹜文楷 Lite → 汇文明朝。
 */

export const FONT_OPTIONS: readonly FontOption[] = [
  { value: 'system-ui',      label: '系统默认' },
  { value: 'Microsoft YaHei UI', label: '微软雅黑 UI' },
  { value: 'Noto Serif SC',  label: '思源宋体',   fileName: 'NotoSerifSC-Regular.otf' },
  { value: 'Zhuque Fangsong', label: '朱雀仿宋',   fileName: 'ZhuqueFangsong-Regular.ttf' },
  { value: 'Xiaolai SC',     label: '小赖字体',   fileName: 'XiaolaiSC-Regular.ttf' },
  { value: 'LXGW WenKai Lite', label: '霞鹜文楷 Lite', fileName: 'LXGWWenKai-Regular.ttf' },
  { value: 'Huiwen-mincho',  label: '汇文明朝',   fileName: 'Huiwen-mincho-Regular.otf' },
] as const;
