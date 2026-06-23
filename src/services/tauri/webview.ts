import { getCurrentWindow } from '@tauri-apps/api/window';

export type UnlistenFn = () => void;

interface DragDropPayload {
  type: 'enter' | 'over' | 'drop' | 'leave';
  paths: string[];
  position: { x: number; y: number };
}

export async function listenCurrentWebviewDragDrop(
  handler: (event: { payload: DragDropPayload }) => void,
): Promise<UnlistenFn> {
  const unlisten = await getCurrentWindow().onDragDropEvent((event) => {
    if (event.payload.type === 'drop') {
      handler({
        payload: {
          type: 'drop',
          paths: event.payload.paths,
          position: event.payload.position,
        },
      });
    }
  });
  return unlisten;
}
