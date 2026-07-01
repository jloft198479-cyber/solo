import { getCurrentWindow } from '@tauri-apps/api/window';

const MENU_EVENT = 'menu-event';
const WINDOW_CLOSE_REQUESTED = 'window-close-requested';

export type UnlistenFn = () => void;
export type AppEventHandler<T> = (payload: T) => void | Promise<void>;
export type AppOpenSource = 'startup' | 'cli' | 'os-open' | 'single-instance' | 'new-window';

export interface AppOpenPathsPayload {
  paths: string[];
  source: AppOpenSource;
}

interface DragDropPayload {
  type: 'enter' | 'over' | 'drop' | 'leave';
  paths: string[];
  position: { x: number; y: number };
}

type DragDropHandler = (payload: DragDropPayload) => void | Promise<void>;

let sharedUnlisten: Promise<UnlistenFn> | null = null;
const subscribers = new Set<DragDropHandler>();

async function ensureSharedDragDropListener(): Promise<UnlistenFn> {
  if (!sharedUnlisten) {
    sharedUnlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        const payload: DragDropPayload = {
          type: 'drop',
          paths: event.payload.paths,
          position: event.payload.position,
        };
        for (const handler of subscribers) {
          handler(payload);
        }
      }
    });
  }
  return sharedUnlisten;
}

export async function subscribeDragDrop(handler: DragDropHandler): Promise<UnlistenFn> {
  await ensureSharedDragDropListener();
  subscribers.add(handler);
  return () => {
    subscribers.delete(handler);
  };
}

/**
 * 窗口级事件监听：只接收定向到当前窗口的事件，不接收全局广播。
 */
function listenWindowEvent<T>(eventName: string, handler: AppEventHandler<T>) {
  return getCurrentWindow().listen(eventName, (event) => handler(event.payload as T));
}

export async function listenMenuEvent(handler: AppEventHandler<string>) {
  return listenWindowEvent(MENU_EVENT, handler);
}

export async function listenWindowCloseRequested(handler: AppEventHandler<null>) {
  return listenWindowEvent(WINDOW_CLOSE_REQUESTED, handler);
}

export async function emitMenuEvent(commandId: string) {
  const { emit } = await import('@tauri-apps/api/event');
  await emit(MENU_EVENT, commandId);
}

export async function emitWindowCloseRequested() {
  const { emit } = await import('@tauri-apps/api/event');
  await emit(WINDOW_CLOSE_REQUESTED);
}
