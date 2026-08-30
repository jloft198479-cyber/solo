import { getCurrentWindow } from '@tauri-apps/api/window';
import { invokeCommand } from './client';
import { TAURI_COMMANDS } from './command-names';
import type { AppOpenPathsPayload } from './events';

export type NativeWindowTheme = 'light' | 'dark' | 'system';

export async function setCurrentWindowTitle(title: string) {
  await getCurrentWindow().setTitle(title);
}

export async function isCurrentWindowFullscreen(): Promise<boolean> {
  return await getCurrentWindow().isFullscreen();
}

export async function setCurrentWindowFullscreen(fullscreen: boolean) {
  await getCurrentWindow().setFullscreen(fullscreen);
}

export async function destroyCurrentWindow() {
  await getCurrentWindow().destroy();
}

export async function startupReady(): Promise<AppOpenPathsPayload | null> {
  return invokeCommand<AppOpenPathsPayload | null>(TAURI_COMMANDS.startupReady);
}

export async function refreshNativeMenuShortcuts(shortcuts: Record<string, string>) {
  await invokeCommand<void>(TAURI_COMMANDS.refreshNativeMenuShortcuts, { shortcuts });
}

export async function revealStartupOpenLog() {
  return invokeCommand<string>(TAURI_COMMANDS.revealStartupOpenLog);
}

export async function setCurrentWindowTheme(theme: NativeWindowTheme) {
  if (theme === 'system') {
    return;
  }
  await getCurrentWindow().setTheme(theme);
}

export async function setCurrentWindowBackgroundColor(color: string) {
  await invokeCommand<void>(TAURI_COMMANDS.setWindowBackgroundColor, { color });
}

export async function registerShellNew() {
  await invokeCommand<void>(TAURI_COMMANDS.registerShellNew);
}

export async function unregisterShellNew() {
  await invokeCommand<void>(TAURI_COMMANDS.unregisterShellNew);
}

export async function setCurrentWindowAlwaysOnTop(onTop: boolean) {
  await getCurrentWindow().setAlwaysOnTop(onTop);
}

/** 创建一个新的编辑器窗口，可选关联文件路径 */
export async function newEditorWindow(path?: string): Promise<string> {
  return invokeCommand<string>(TAURI_COMMANDS.newEditorWindow, { path: path ?? null });
}

/** 请求应用级退出：Rust 向所有窗口广播 close-requested，各窗口自行确认/保存后关闭 */
export async function requestAppQuit() {
  await invokeCommand<void>(TAURI_COMMANDS.requestAppQuit);
}

/**
 * 关窗逃生舱握手。
 * - `ack`：本窗口已收到 close-requested（证明 JS 主线程还活着），Rust 此后吞掉重复的关闭请求，
 *   避免大文档卡死时连按关闭叠出多个确认框。
 * - `abort`：本次关闭链已中止（用户取消 / 保存失败），让下一次关闭请求重新弹窗。
 */
export async function reportWindowClose(phase: 'ack' | 'abort') {
  await invokeCommand<void>(TAURI_COMMANDS.reportWindowClose, { phase });
}
