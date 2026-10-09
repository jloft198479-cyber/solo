// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, nextTick, ref, type Ref } from 'vue';
import { useAppDomEvents } from '../useAppDomEvents';

type MountOptions = {
  focusMode?: boolean;
  /** 引导提示的可见状态（真实实现里由 App.vue 的 ref 驱动） */
  hint?: Ref<boolean>;
  fullscreen?: boolean;
  viewMode?: 'editor' | 'image';
};

/**
 * useAppDomEvents 在 onMounted 里挂 window 监听，需真实组件实例，
 * 故照 useClickOutside.spec.ts 的既有做法用 createApp 包一层。
 */
function mountAppDomEvents(options: MountOptions = {}) {
  const hint = options.hint ?? ref(false);
  const isFullscreenPreview = ref(options.fullscreen ?? false);
  const activeViewMode = ref<'editor' | 'image'>(options.viewMode ?? 'editor');

  const isFocusMode = vi.fn(() => options.focusMode ?? false);
  const toggleFocusMode = vi.fn();
  const clearFullscreenPreview = vi.fn();
  const resetViewMode = vi.fn();
  const isFocusEnterHintVisible = vi.fn(() => hint.value);
  // 与真实实现同构：关提示 = 把可见状态置 false
  const dismissFocusEnterHint = vi.fn(() => {
    hint.value = false;
  });

  const Wrapper = defineComponent({
    setup() {
      useAppDomEvents({
        activeViewMode,
        isFullscreenPreview,
        isFocusMode,
        customShortcuts: () => ({}),
        findCommandByShortcut: () => undefined,
        executeCommand: async () => false,
        clearFullscreenPreview,
        toggleFocusMode,
        showImagePasteWarning: vi.fn(),
        resetViewMode,
        isFocusEnterHintVisible,
        dismissFocusEnterHint,
      });
      return () => null;
    },
  });

  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(Wrapper);
  app.mount(host);

  return {
    hint,
    spies: {
      isFocusMode,
      toggleFocusMode,
      clearFullscreenPreview,
      resetViewMode,
      isFocusEnterHintVisible,
      dismissFocusEnterHint,
    },
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

/**
 * 派发一次 Esc。监听挂在 window 上，但必须从元素派发再冒泡上去——
 * 直接 window.dispatchEvent 会让 event.target 变成 window（无 closest，真实路径里不会这样）。
 */
function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
}

let active: ReturnType<typeof mountAppDomEvents> | null = null;
function mount(options?: MountOptions) {
  active = mountAppDomEvents(options);
  return active;
}
afterEach(() => {
  active?.unmount();
  active = null;
});

describe('useAppDomEvents · Esc 与焦点模式引导提示', () => {
  it('提示在屏时，Esc 只关提示，不退出焦点模式', async () => {
    const { spies } = mount({ focusMode: true, hint: ref(true) });

    const event = pressEscape();
    await nextTick();

    expect(spies.dismissFocusEnterHint).toHaveBeenCalledTimes(1);
    expect(spies.toggleFocusMode).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('提示已消失后，Esc 才退出焦点模式', async () => {
    const { spies } = mount({ focusMode: true, hint: ref(false) });

    pressEscape();
    await nextTick();

    expect(spies.dismissFocusEnterHint).not.toHaveBeenCalled();
    expect(spies.toggleFocusMode).toHaveBeenCalledTimes(1);
  });

  it('连按两次 Esc：第一次关提示，第二次退出焦点模式', async () => {
    const hint = ref(true);
    const { spies } = mount({ focusMode: true, hint });

    pressEscape();
    await nextTick();
    expect(spies.toggleFocusMode).not.toHaveBeenCalled();
    expect(hint.value).toBe(false);

    pressEscape();
    await nextTick();
    expect(spies.toggleFocusMode).toHaveBeenCalledTimes(1);
  });

  it('全屏预览优先级高于提示（提示不参与消费 Esc）', async () => {
    const { spies } = mount({ fullscreen: true, focusMode: true, hint: ref(true) });

    pressEscape();
    await nextTick();

    expect(spies.clearFullscreenPreview).toHaveBeenCalledTimes(1);
    expect(spies.dismissFocusEnterHint).not.toHaveBeenCalled();
    expect(spies.toggleFocusMode).not.toHaveBeenCalled();
  });

  it('图片视图同样优先于提示', async () => {
    const { spies } = mount({ viewMode: 'image', focusMode: true, hint: ref(true) });

    pressEscape();
    await nextTick();

    expect(spies.resetViewMode).toHaveBeenCalledTimes(1);
    expect(spies.dismissFocusEnterHint).not.toHaveBeenCalled();
  });

  it('未处于焦点模式、也无提示时，Esc 不触发任何副作用', async () => {
    const { spies } = mount({ focusMode: false, hint: ref(false) });

    pressEscape();
    await nextTick();

    expect(spies.dismissFocusEnterHint).not.toHaveBeenCalled();
    expect(spies.toggleFocusMode).not.toHaveBeenCalled();
    expect(spies.clearFullscreenPreview).not.toHaveBeenCalled();
  });
});
