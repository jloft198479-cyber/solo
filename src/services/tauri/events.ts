import { listen } from '@tauri-apps/api/event';
import { APP_EVENT_NAMES } from './event-names';

export type AppEventHandler<T> = (payload: T) => void | Promise<void>;
export type AppOpenSource = 'startup' | 'cli' | 'os-open' | 'single-instance' | 'new-window';

export interface AppOpenPathsPayload {
  paths: string[];
  source: AppOpenSource;
}

async function listenAppEvent<T>(eventName: string, handler: AppEventHandler<T>) {
  return listen(eventName, (event) => handler(event.payload as T));
}

export async function listenMenuEvent(handler: AppEventHandler<string>) {
  return listenAppEvent(APP_EVENT_NAMES.menu, handler);
}

export async function listenWindowCloseRequested(handler: AppEventHandler<null>) {
  return listenAppEvent(APP_EVENT_NAMES.windowCloseRequested, handler);
}

export async function emitMenuEvent(commandId: string) {
  const { emit } = await import('@tauri-apps/api/event');
  await emit(APP_EVENT_NAMES.menu, commandId);
}

export async function emitWindowCloseRequested() {
  const { emit } = await import('@tauri-apps/api/event');
  await emit(APP_EVENT_NAMES.windowCloseRequested);
}
