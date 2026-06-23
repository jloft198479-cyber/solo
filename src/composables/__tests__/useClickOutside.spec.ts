// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ref, defineComponent, h, createApp } from 'vue';
import { useClickOutside } from '../useClickOutside';

/**
 * 使用原生 Vue createApp 挂载组件，避免依赖 @vue/test-utils。
 * 返回卸载函数。
 */
function mountWith(composable: () => void): () => void {
  const Component = defineComponent({
    setup() {
      composable();
      return () => h('div');
    },
  });

  const el = document.createElement('div');
  document.body.appendChild(el);

  const app = createApp(Component);
  app.mount(el);

  return () => {
    app.unmount();
    document.body.removeChild(el);
  };
}

describe('useClickOutside', () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addSpy = vi.spyOn(document, 'addEventListener');
    removeSpy = vi.spyOn(document, 'removeEventListener');
  });

  afterEach(() => {
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('挂载时注册文档点击监听，卸载时移除', () => {
    const target = ref<HTMLElement | null>(null);
    const handler = vi.fn();

    const unmount = mountWith(() => useClickOutside(target, handler));

    expect(addSpy).toHaveBeenCalledWith('click', expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function));
  });

  it('点击目标元素内部时不触发回调', () => {
    const inner = document.createElement('div');
    const outer = document.createElement('div');
    outer.appendChild(inner);
    document.body.appendChild(outer);

    const target = ref<HTMLElement | null>(outer);
    const handler = vi.fn();

    const unmount = mountWith(() => useClickOutside(target, handler));

    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(handler).not.toHaveBeenCalled();

    unmount();
    document.body.removeChild(outer);
  });

  it('点击目标元素外部时触发回调', () => {
    const target = ref<HTMLElement | null>(document.createElement('div'));
    const handler = vi.fn();

    const unmount = mountWith(() => useClickOutside(target, handler));

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.any(MouseEvent));

    unmount();
  });

  it('target 为 null 时不触发回调（安全降级）', () => {
    const target = ref<HTMLElement | null>(null);
    const handler = vi.fn();

    const unmount = mountWith(() => useClickOutside(target, handler));

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(handler).not.toHaveBeenCalled();

    unmount();
  });

  it('支持自定义事件名（mousedown）', () => {
    const targetEl = document.createElement('div');
    document.body.appendChild(targetEl);
    const target = ref<HTMLElement | null>(targetEl);
    const handler = vi.fn();

    const unmount = mountWith(() => useClickOutside(target, handler, { eventName: 'mousedown' }));

    expect(addSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).not.toHaveBeenCalled();

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);

    unmount();
    document.body.removeChild(targetEl);
  });
});
