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

export async function consumeStartupOpenRequest(): Promise<AppOpenPathsPayload | null> {
  return invokeCommand<AppOpenPathsPayload | null>(TAURI_COMMANDS.consumeStartupOpenRequest);
}

export async function notifyFrontendReady(): Promise<AppOpenPathsPayload | null> {
  return invokeCommand<AppOpenPathsPayload | null>(TAURI_COMMANDS.notifyFrontendReady);
}

export async function refreshNativeMenuShortcuts(shortcuts: Record<string, string>) {
  await invokeCommand<void>(TAURI_COMMANDS.refreshNativeMenuShortcuts, { shortcuts });
}

export async function revealStartupOpenLog() {
  return invokeCommand<string>(TAURI_COMMANDS.revealStartupOpenLog);
}

export async function printDocument() {
  await invokeCommand<void>(TAURI_COMMANDS.printDocument);
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
