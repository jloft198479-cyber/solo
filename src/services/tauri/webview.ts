import { getCurrentWindow } from '@tauri-apps/api/window';

export type UnlistenFn = () => void;

interface DragDropPayload {
  type: 'enter' | 'over' | 'drop' | 'leave';
  paths: string[];
  position: { x: number; y: number };
}

type DragDropHandler = (payload: DragDropPayload) => void | Promise<void>;

// ── 共享拖拽监听器（单例模式） ──────────────────────────────────
// 全局只注册一个 Tauri onDragDropEvent 监听，多个消费者通过 subscribe 注册回调。
// 避免两个独立监听器同时订阅同一事件导致的冗余和潜在竞态。

let sharedUnlisten: Promise<UnlistenFn> | null = null;
const subscribers = new Set<DragDropHandler>();

async function ensureSharedListener(): Promise<UnlistenFn> {
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

/**
 * 注册一个拖拽回调到共享监听器。返回取消注册函数。
 * 多个消费者（文档拖入、图片拖入）可安全共存，不会产生重复的 Tauri 事件订阅。
 */
export async function subscribeDragDrop(handler: DragDropHandler): Promise<UnlistenFn> {
  await ensureSharedListener();
  subscribers.add(handler);
  return () => {
    subscribers.delete(handler);
  };
}

/**
 * @deprecated 使用 subscribeDragDrop 替代。保留仅为向后兼容。
 */
export async function listenCurrentWebviewDragDrop(
  handler: (event: { payload: DragDropPayload }) => void,
): Promise<UnlistenFn> {
  return subscribeDragDrop((payload) => handler({ payload }));
}
