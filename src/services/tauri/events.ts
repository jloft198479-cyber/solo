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
const activeDragDropHandlers = new Set<DragDropHandler>();

/**
 * 全局只注册一次原生拖拽监听。
 * 支持多 handler 同时订阅（如编辑器图片拖入 + 窗口 .md 文件打开），
 * 事件广播给所有注册的 handler，由各自内部判断是否处理。
 * 返回 unlisten 函数，调用后从 handler 集合中移除（不影响原生监听）。
 */
export async function subscribeDragDrop(handler: DragDropHandler): Promise<UnlistenFn> {
  if (!sharedUnlisten) {
    sharedUnlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'drop' && activeDragDropHandlers.size > 0) {
        const payload: DragDropPayload = {
          type: 'drop',
          paths: event.payload.paths,
          position: event.payload.position,
        };
        // 复制成数组再遍历：避免某个 handler 在回调里 unsubscribe 另一个 handler，
        // 导致 Set 迭代过程中跳过元素。
        // 每个 handler 单独 try/catch：单个订阅者抛错不影响其他订阅者收到事件
        // （遵循架构原则「一处崩溃不影响全局」）。
        for (const h of [...activeDragDropHandlers]) {
          // 单个 handler 失败不阻断后续广播；异步 handler 的 rejection 也要兜住，
          // 否则成为 unhandled rejection（错误由 handler 自身日志负责呈现）
          try {
            const result = h(payload);
            if (result instanceof Promise) {
              result.catch((err) => console.warn('[drag-drop] handler 执行失败:', err));
            }
          } catch (err) {
            console.warn('[drag-drop] handler 执行失败:', err);
          }
        }
      }
    });
  }
  activeDragDropHandlers.add(handler);
  return () => {
    activeDragDropHandlers.delete(handler);
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

/** 编辑器焦点事件：窗口获得焦点 / 需要初始化编辑器时由 Rust 定向发出 */
export async function listenEditorFocus(handler: () => void): Promise<UnlistenFn> {
  return listenWindowEvent<null>('solo:editor-focus', handler);
}
