import { getCurrentWindow } from '@tauri-apps/api/window';
import { APP_EVENT_NAMES } from './event-names';

export type AppEventHandler<T> = (payload: T) => void | Promise<void>;
export type AppOpenSource = 'startup' | 'cli' | 'os-open' | 'single-instance' | 'new-window';

export interface AppOpenPathsPayload {
  paths: string[];
  source: AppOpenSource;
}

/**
 * 窗口级事件监听：只接收定向到当前窗口的事件，不接收全局广播。
 * 菜单事件和关闭请求均使用此方式，确保多窗口场景下不会互相干扰。
 */
function listenWindowEvent<T>(eventName: string, handler: AppEventHandler<T>) {
  return getCurrentWindow().listen(eventName, (event) => handler(event.payload as T));
}

export async function listenMenuEvent(handler: AppEventHandler<string>) {
  return listenWindowEvent(APP_EVENT_NAMES.menu, handler);
}

export async function listenWindowCloseRequested(handler: AppEventHandler<null>) {
  return listenWindowEvent(APP_EVENT_NAMES.windowCloseRequested, handler);
}

export async function emitMenuEvent(commandId: string) {
  const { emit } = await import('@tauri-apps/api/event');
  await emit(APP_EVENT_NAMES.menu, commandId);
}

export async function emitWindowCloseRequested() {
  const { emit } = await import('@tauri-apps/api/event');
  await emit(APP_EVENT_NAMES.windowCloseRequested);
}
