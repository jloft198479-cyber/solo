type OsPlatform = 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'freebsd' | 'dragonfly' | 'netbsd' | 'openbsd' | 'solaris' | 'unknown';

function resolvePlatform(): OsPlatform {
  const ua = navigator.userAgent;
  if (ua.includes('Mac')) return 'macos';
  if (ua.includes('Windows')) return 'windows';
  if (ua.includes('Linux')) return 'linux';
  return 'unknown';
}

const currentPlatform = resolvePlatform();

export const isMac = currentPlatform === 'macos';
export const isWindows = currentPlatform === 'windows';
export const isLinux = currentPlatform === 'linux';

/**
 * 判断是否按下了平台对应的修饰键 (Mac: Command, Win/Linux: Ctrl)
 */
export function isModKey(e: KeyboardEvent | MouseEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/**
 * 格式化快捷键显示文本
 * @param shortcut 原始快捷键，例如 "CmdOrCtrl+K"
 */
export function formatShortcut(shortcut: string): string {
  if (isMac) {
    return shortcut
      .replace('CmdOrCtrl+', '⌘')
      .replace('Ctrl+', '⌘')
      .replace('Alt+', '⌥')
      .replace('Option+', '⌥')
      .replace('Shift+', '⇧');
  }
  return shortcut
    .replace('CmdOrCtrl+', 'Ctrl+')
    .replace('Meta+', 'Win+')
    .replace('Alt+', 'Alt+')
    .replace('Option+', 'Alt+')
    .replace('Shift+', 'Shift+');
}

/**
 * 获取当前平台文件管理器的名称
 */
export function getFileManagerName(): string {
  if (isMac) return 'Finder';
  if (isWindows) return '资源管理器';
  return '文件管理器';
}
