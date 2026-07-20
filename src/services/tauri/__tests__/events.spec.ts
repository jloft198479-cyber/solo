import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let dragDropCallback: ((event: { payload: unknown }) => void) | null = null;
  const onDragDropEvent = vi.fn((cb: (event: { payload: unknown }) => void) => {
    dragDropCallback = cb;
    return Promise.resolve(() => {
      dragDropCallback = null;
    });
  });

  return {
    dragDropCallback: () => dragDropCallback,
    onDragDropEvent,
    resetDragDropCallback: () => {
      dragDropCallback = null;
    },
  };
});

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: mocks.onDragDropEvent,
  }),
}));

describe('subscribeDragDrop — 多 handler 广播', () => {
  beforeEach(async () => {
    mocks.onDragDropEvent.mockClear();
    mocks.resetDragDropCallback();
    // 重置模块内部状态（sharedUnlisten + handlers 集合）
    vi.resetModules();
  });

  it('注册多个 handler 时，drop 事件广播给所有 handler', async () => {
    const { subscribeDragDrop } = await import('../events');
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    await subscribeDragDrop(handlerA);
    await subscribeDragDrop(handlerB);

    const cb = mocks.dragDropCallback();
    expect(cb).toBeTruthy();
    cb!({
      payload: {
        type: 'drop',
        paths: ['/tmp/test.md'],
        position: { x: 0, y: 0 },
      },
    });

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerA).toHaveBeenCalledWith({
      type: 'drop',
      paths: ['/tmp/test.md'],
      position: { x: 0, y: 0 },
    });
  });

  it('unlisten 只移除对应 handler，其他 handler 仍能收到事件', async () => {
    const { subscribeDragDrop } = await import('../events');
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    const unlistenA = await subscribeDragDrop(handlerA);
    await subscribeDragDrop(handlerB);

    unlistenA();

    const cb = mocks.dragDropCallback();
    cb!({
      payload: {
        type: 'drop',
        paths: ['/tmp/img.png'],
        position: { x: 10, y: 20 },
      },
    });

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it('原生监听只注册一次（sharedUnlisten 复用）', async () => {
    const { subscribeDragDrop } = await import('../events');
    await subscribeDragDrop(vi.fn());
    await subscribeDragDrop(vi.fn());
    await subscribeDragDrop(vi.fn());

    expect(mocks.onDragDropEvent).toHaveBeenCalledTimes(1);
  });

  it('所有 handler 都 unlisten 后，drop 事件不会触发任何回调', async () => {
    const { subscribeDragDrop } = await import('../events');
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    const unlistenA = await subscribeDragDrop(handlerA);
    const unlistenB = await subscribeDragDrop(handlerB);

    unlistenA();
    unlistenB();

    const cb = mocks.dragDropCallback();
    cb!({
      payload: {
        type: 'drop',
        paths: ['/tmp/x.md'],
        position: { x: 0, y: 0 },
      },
    });

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('非 drop 类型事件不触发 handler', async () => {
    const { subscribeDragDrop } = await import('../events');
    const handler = vi.fn();
    await subscribeDragDrop(handler);

    const cb = mocks.dragDropCallback();
    cb!({
      payload: {
        type: 'enter',
        paths: ['/tmp/x.md'],
        position: { x: 0, y: 0 },
      },
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
