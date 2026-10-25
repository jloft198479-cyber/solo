import { LazyStore } from '@tauri-apps/plugin-store';

const APP_STORE_PATH = 'settings.json';
const SETTINGS_KEY = 'settings';
const FOCUS_MODE_KEY = 'focusMode';

const appStore = new LazyStore(APP_STORE_PATH, {
  defaults: {},
  autoSave: false,
});

export async function readStoredSettings<T>() {
  return appStore.get<T>(SETTINGS_KEY);
}

/**
 * 丢掉本进程的 store 缓存、从磁盘重读（多窗口合并写的前提）。
 * LazyStore 每个窗口（WebView）各有一份 JS 缓存，他窗的落盘只存在于磁盘——
 * 不 reload 就读，读到的永远是自己启动时那份旧值（审计 P2-3）。
 */
export async function reloadStoredSettings() {
  await appStore.reload();
}

export async function writeStoredSettings(settings: unknown) {
  await appStore.set(SETTINGS_KEY, settings);
  await appStore.save();
}

export async function readStoredFocusMode() {
  return appStore.get<boolean>(FOCUS_MODE_KEY);
}

export async function writeStoredFocusMode(enabled: boolean) {
  await appStore.set(FOCUS_MODE_KEY, enabled);
  await appStore.save();
}
