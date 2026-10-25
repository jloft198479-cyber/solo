import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit, listen } from '@tauri-apps/api/event';

const MENU_EVENT = 'menu-event';
const WINDOW_CLOSE_REQUESTED = 'window-close-requested';
/**
 * 改名同步改写了别的文档。跨窗口广播（**全局目标**，非定向）：
 * 改写发生在「改名那篇」所在的窗口，被改的却是**另一个窗口正开着的文档**，
 * 定向事件到不了它，必须让所有窗口都收到再各自按路径过滤。
 */
const WIKILINKS_SYNCED = 'solo:wikilinks-synced';
const FILE_RENAMED = 'solo:file-renamed';

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
    const registration = getCurrentWindow().onDragDropEvent((event) => {
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
    // 注册失败（启动早期事件系统瞬时不可用）不能把 rejected promise 当「已注册」
    // 缓存：那会让本窗口的拖拽订阅**永久失效**且无告警（还多一条 unhandled
    // rejection）。失败置回 null，下次订阅自然重试（审计 D-7）。
    registration.catch((err) => {
      console.warn('[drag-drop] 事件注册失败，将在下次订阅时重试:', err);
      sharedUnlisten = null;
    });
    sharedUnlisten = registration;
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

export interface WikilinksSyncedPayload {
  /** 已被改写的文档绝对路径（Rust 直返；范围 = 改名文档的本层 + 向上 `WIKILINK_SCAN_DEPTH` 层） */
  paths: string[];
}

/**
 * 广播「这些文档的盘上内容刚被改名同步改写」。
 *
 * 走全局 emit（JS 侧 `emit` 的目标是 `Any`，不过滤监听方 target），
 * 因此每个窗口都能收到——这正是需要的：改写方与受影响方**不是同一个窗口**。
 */
export async function emitWikilinksSynced(payload: WikilinksSyncedPayload): Promise<void> {
  await emit(WIKILINKS_SYNCED, payload);
}

/** 监听改名同步广播（全局口径，配合上面的 emitWikilinksSynced） */
export async function listenWikilinksSynced(
  handler: AppEventHandler<WikilinksSyncedPayload>,
): Promise<UnlistenFn> {
  return listen<WikilinksSyncedPayload>(WIKILINKS_SYNCED, (event) => handler(event.payload));
}

export interface FileRenamedPayload {
  oldPath: string;
  newPath: string;
}

/**
 * 广播「这篇文档在磁盘上换了路径」。
 *
 * 必须走全局 emit：改名发生在 A 窗口，而还开着旧路径的可能是任意 B 窗口，
 * 发送方无从知道它的 label。**与 wikilinks-synced 分开**——那条的语义是
 * 「你开着的文档内容被改写 → 重载」，这条是「路径变了 → 只跟着换路径，绝不重载」
 * （buffer 里可能有 A 并不知道的未保存编辑，重载会把它抹掉）。
 */
export async function emitFileRenamed(payload: FileRenamedPayload): Promise<void> {
  await emit(FILE_RENAMED, payload);
}

/** 监听改名跟随广播（全局口径，配合上面的 emitFileRenamed） */
export async function listenFileRenamed(
  handler: AppEventHandler<FileRenamedPayload>,
): Promise<UnlistenFn> {
  return listen<FileRenamedPayload>(FILE_RENAMED, (event) => handler(event.payload));
}
