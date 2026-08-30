import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { EditorState } from '@tiptap/pm/state';
import type { Editor as TiptapEditor } from '@tiptap/vue-3';

import { createMarkdownCompatSchema } from '../../components/Editor/tiptap/markdown/compat-schema';
import { setDocumentTier } from '../../components/Editor/document-scale';
import { useFileStore } from '../../stores/file';
import { useEditorSync } from '../useEditorSync';

// useEditorSync 模块顶层按「window.requestIdleCallback 是否存在」选择调度器，
// 必须在 import 之前注入 mock（vi.hoisted 在模块加载前执行）。
type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;
vi.hoisted(() => {
  const callbacks = new Map<number, IdleCallback>();
  let nextId = 1;
  (globalThis as unknown as { __idleCallbacks: Map<number, IdleCallback> }).__idleCallbacks =
    callbacks;
  (globalThis as unknown as { window: unknown }).window = {
    requestIdleCallback: (cb: IdleCallback) => {
      callbacks.set(nextId, cb);
      return nextId++;
    },
    cancelIdleCallback: (id: number) => {
      callbacks.delete(id);
    },
  };
});

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return { ...actual, onBeforeUnmount: vi.fn() };
});

const schema = createMarkdownCompatSchema();

function fakeEditor(text: string): TiptapEditor {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [schema.text(text)]),
  ]);
  return {
    state: EditorState.create({ schema, doc }),
    isDestroyed: false,
  } as unknown as TiptapEditor;
}

/** 手动触发所有挂起的空闲回调。默认模拟真实空闲（didTimeout: false）；
 * 传 { timeout: true } 模拟「2s 兜底超时强制唤醒」路径。 */
function runIdle(opts?: { timeout?: boolean }) {
  const callbacks = (globalThis as unknown as { __idleCallbacks: Map<number, IdleCallback> })
    .__idleCallbacks;
  const pending = [...callbacks.values()];
  callbacks.clear();
  for (const cb of pending)
    cb({ didTimeout: opts?.timeout ?? false, timeRemaining: () => 0 });
}

describe('useEditorSync serialize 空闲调度（P4-05）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('防抖到点后仅排队空闲回调，空闲时段到达才序列化', () => {
    const store = useFileStore();
    const syncSpy = vi.spyOn(store, 'syncEditedContent');
    const { handleDocChange } = useEditorSync({ onUpdate: vi.fn() });

    handleDocChange(fakeEditor('hello'));
    vi.advanceTimersByTime(500); // 防抖到点
    expect(syncSpy).not.toHaveBeenCalled(); // 空闲回调尚未执行

    runIdle();
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  it('空闲回调挂起期间多次到点合并为一次序列化，且用最新文档', () => {
    const store = useFileStore();
    const syncSpy = vi.spyOn(store, 'syncEditedContent');
    const { handleDocChange } = useEditorSync({ onUpdate: vi.fn() });

    handleDocChange(fakeEditor('first'));
    vi.advanceTimersByTime(500); // 第一次到点 → 空闲回调排队（未执行）
    handleDocChange(fakeEditor('second'));
    vi.advanceTimersByTime(500); // 第二次到点 → 合并进同一次空闲回调

    runIdle();
    expect(syncSpy).toHaveBeenCalledTimes(1);
    const arg = syncSpy.mock.calls[0][0];
    expect(arg).toContain('second');
    expect(arg).not.toContain('first');
  });

  it('超时兜底撞上续打 → 推迟回防抖，不在输入中途硬跑大序列化', () => {
    const store = useFileStore();
    const syncSpy = vi.spyOn(store, 'syncEditedContent');
    const { handleDocChange } = useEditorSync({ onUpdate: vi.fn() });

    handleDocChange(fakeEditor('first'));
    vi.advanceTimersByTime(500); // 防抖到点 → 空闲回调排队，记录当时代际
    handleDocChange(fakeEditor('second')); // 用户续打，代际前进

    runIdle({ timeout: true }); // 兜底超时到来——但用户正在打字
    expect(syncSpy).not.toHaveBeenCalled(); // 不硬跑，回到防抖

    vi.advanceTimersByTime(500); // 下一个停顿
    runIdle(); // 真空闲到来
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy.mock.calls[0][0]).toContain('second');
  });

  it('cancelPending 取消挂起的空闲序列化', () => {
    const store = useFileStore();
    const syncSpy = vi.spyOn(store, 'syncEditedContent');
    const { handleDocChange, cancelPending } = useEditorSync({ onUpdate: vi.fn() });

    handleDocChange(fakeEditor('hello'));
    vi.advanceTimersByTime(500);
    cancelPending();

    runIdle();
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('编辑器已销毁时跳过序列化', () => {
    const store = useFileStore();
    const syncSpy = vi.spyOn(store, 'syncEditedContent');
    const { handleDocChange } = useEditorSync({ onUpdate: vi.fn() });

    const ed = fakeEditor('hello');
    ed.isDestroyed = true;
    handleDocChange(ed);
    vi.advanceTimersByTime(500);

    runIdle();
    expect(syncSpy).not.toHaveBeenCalled();
  });
});

describe('useEditorSync 同步代际（关窗闸口免序列化判据）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('基线尚未锚定时报「未同步」——不能因为两个计数器都是初始值就误判已同步', () => {
    const { isSyncedWithStore } = useEditorSync({ onUpdate: vi.fn() });
    expect(isSyncedWithStore()).toBe(false);
  });

  it('markSynced 锚定后报「已同步」（载入 / 切文档写入序列化基线的场景）', () => {
    const { markSynced, isSyncedWithStore } = useEditorSync({ onUpdate: vi.fn() });
    markSynced();
    expect(isSyncedWithStore()).toBe(true);
  });

  it('编辑已发生但序列化还在防抖 / 空闲窗口内 → 报「未同步」，闸口须走兜底序列化', () => {
    const { handleDocChange, markSynced, isSyncedWithStore } = useEditorSync({
      onUpdate: vi.fn(),
    });

    markSynced();
    handleDocChange(fakeEditor('typed'));
    vi.advanceTimersByTime(500); // 防抖到点，但空闲回调还没执行

    expect(isSyncedWithStore()).toBe(false);
  });

  it('空闲序列化写回 store 后自动追平，无需调用方 markSynced', () => {
    const { handleDocChange, markSynced, isSyncedWithStore } = useEditorSync({
      onUpdate: vi.fn(),
    });

    markSynced();
    handleDocChange(fakeEditor('hello'));
    expect(isSyncedWithStore()).toBe(false);

    vi.advanceTimersByTime(500);
    runIdle();
    expect(isSyncedWithStore()).toBe(true);
  });
});

describe('useEditorSync 大文档降级（H7：字数不再跟随编辑）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
  });
  afterEach(() => {
    vi.useRealTimers();
    setDocumentTier('normal');
  });

  function hasWordCountPayload(onUpdate: ReturnType<typeof vi.fn>): boolean {
    return onUpdate.mock.calls.some(([payload]) => 'wordCount' in (payload ?? {}));
  }

  it('heavy 档位：防抖到点也不发字数，序列化与同步代际照常', () => {
    setDocumentTier('heavy');
    const store = useFileStore();
    const syncSpy = vi.spyOn(store, 'syncEditedContent');
    const onUpdate = vi.fn();
    const { handleDocChange, markSynced, isSyncedWithStore } = useEditorSync({ onUpdate });

    markSynced();
    handleDocChange(fakeEditor('typed'));
    vi.advanceTimersByTime(500);

    expect(hasWordCountPayload(onUpdate)).toBe(false);
    expect(isSyncedWithStore()).toBe(false);

    runIdle();
    expect(syncSpy).toHaveBeenCalledTimes(1); // 降级不能弄脏「是否已同步」判据
    expect(isSyncedWithStore()).toBe(true);
  });

  it('normal 档位（对照）：字数照旧实时发出，证明降级门没有误伤正常路径', () => {
    const onUpdate = vi.fn();
    const { handleDocChange } = useEditorSync({ onUpdate });

    handleDocChange(fakeEditor('typed'));
    vi.advanceTimersByTime(500);

    expect(hasWordCountPayload(onUpdate)).toBe(true);
  });
});
