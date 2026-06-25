/**
 * 字体选项常量
 *
 * 统一维护编辑器可选字体清单，供 FontPopover 与 SettingsFontSelect 共享，
 * 避免清单分散导致新增/删除字体时出现多处修改遗漏。
 *
 * 下载型字体（有 downloadUrl）首次使用时从远端加载并缓存到本地，
 * 系统字体（微软雅黑 UI、system-ui）无需加载。
 *
 * TODO: 打包上传 GitHub 后替换 downloadUrl 为实际 Release asset 地址。
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
 *
 * 下载 URL 占位符 {owner}/{repo}/releases/download/fonts-v1/ 替换为实际 GitHub 仓库信息后生效。
 */
const DL = 'https://github.com/{owner}/{repo}/releases/download/fonts-v1';

export const FONT_OPTIONS: readonly FontOption[] = [
  { value: 'system-ui',      label: '系统默认' },
  { value: 'Microsoft YaHei UI', label: '微软雅黑 UI' },
  { value: 'Noto Serif SC',  label: '思源宋体',   downloadUrl: `${DL}/NotoSerifSC-Regular.otf`,    fileName: 'NotoSerifSC-Regular.otf' },
  { value: 'Zhuque Fangsong', label: '朱雀仿宋',   downloadUrl: `${DL}/ZhuqueFangsong-Regular.ttf`,  fileName: 'ZhuqueFangsong-Regular.ttf' },
  { value: 'Xiaolai SC',     label: '小赖字体',   downloadUrl: `${DL}/XiaolaiSC-Regular.ttf`,     fileName: 'XiaolaiSC-Regular.ttf' },
  { value: 'LXGW WenKai',    label: '霞鹜文楷',   downloadUrl: `${DL}/LXGWWenKai-Regular.ttf`,    fileName: 'LXGWWenKai-Regular.ttf' },
  { value: 'Huiwen-mincho',  label: '汇文明朝',   downloadUrl: `${DL}/Huiwen-mincho-Regular.otf`,  fileName: 'Huiwen-mincho-Regular.otf' },
] as const;
