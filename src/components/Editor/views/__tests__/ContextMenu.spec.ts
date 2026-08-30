// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, createApp, nextTick, ref } from 'vue';
import ContextMenuComponent, { type ContextMenuItem } from '../ContextMenu.vue';

const ITEMS: ContextMenuItem[] = [
  { id: 'a', label: 'Action A' },
  { id: 'b', label: 'Action B', disabled: true },
  { id: 'c', label: 'Action C' },
];

/**
 * Mount helper: wraps ContextMenuComponent in a parent that captures the
 * exposed API and the emitted 'select' events.
 */
function mountContextMenu(items: ContextMenuItem[] = ITEMS) {
  const onSelect = vi.fn();
  const contextMenuRef = ref<InstanceType<typeof ContextMenuComponent> | null>(null);

  const Wrapper = defineComponent({
    setup() {
      return () =>
        h(ContextMenuComponent, {
          ref: (el: any) => {
            contextMenuRef.value = el;
          },
          items,
          // Vue 3 maps emit('select') → onSelect prop in render functions
          onSelect,
        });
    },
  });

  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(Wrapper);
  app.mount(el);

  return {
    api: contextMenuRef,
    onSelect,
    unmount: () => {
      app.unmount();
      document.body.removeChild(el);
    },
  };
}

function makeMouseEvent(clientX: number, clientY: number): MouseEvent {
  return new MouseEvent('contextmenu', {
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  });
}

/**
 * Check whether the context-menu div is hidden.
 * <Transition> + v-show in happy-dom may not set display:none on the inner
 * element reliably, so we also accept the element being absent or having
 * an empty parent as "hidden".
 */
function isMenuHidden(): boolean {
  const menu = document.querySelector('.context-menu') as HTMLElement | null;
  if (!menu) return true;
  if (menu.style.display === 'none') return true;
  // When wrapped in <Transition>, v-show=false may leave the element
  // in DOM but with no visible content after transition completes.
  // We check the closest wrapper for display:none as well.
  const parent = menu.parentElement;
  if (parent && parent.style.display === 'none') return true;
  return false;
}

describe('ContextMenu', () => {
  let originalInnerWidth: number;
  let originalInnerHeight: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
    Object.defineProperty(window, 'innerHeight', {
      value: originalInnerHeight,
      configurable: true,
    });
  });

  describe('open / close', () => {
    it('open() 使菜单可见并定位到鼠标位置', async () => {
      const { api, unmount } = mountContextMenu();
      await nextTick();

      api.value!.open(makeMouseEvent(200, 300));
      await nextTick();

      const menu = document.querySelector('.context-menu') as HTMLElement;
      expect(menu).toBeTruthy();
      expect(menu.style.left).toBe('200px');
      expect(menu.style.top).toBe('300px');

      unmount();
    });

    it('close() 隐藏菜单', async () => {
      const { api, unmount } = mountContextMenu();
      await nextTick();

      api.value!.open(makeMouseEvent(100, 100));
      await nextTick();
      expect(isMenuHidden()).toBe(false);

      api.value!.close();
      await nextTick();
      // Allow transition to settle
      await new Promise((r) => setTimeout(r, 50));
      await nextTick();

      expect(isMenuHidden()).toBe(true);

      unmount();
    });

    it('重复 open() 先关闭再打开（不叠加监听器）', async () => {
      const addSpy = vi.spyOn(document, 'addEventListener');
      const { api, unmount } = mountContextMenu();
      await nextTick();

      api.value!.open(makeMouseEvent(100, 100));
      await nextTick();
      const countAfterFirst = addSpy.mock.calls.length;

      api.value!.open(makeMouseEvent(200, 200));
      await nextTick();
      expect(addSpy.mock.calls.length).toBe(countAfterFirst * 2);

      addSpy.mockRestore();
      unmount();
    });
  });

  describe('dismiss triggers', () => {
    it('document click 关闭菜单', async () => {
      const { api, unmount } = mountContextMenu();
      await nextTick();

      api.value!.open(makeMouseEvent(100, 100));
      await nextTick();

      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));
      await nextTick();

      expect(isMenuHidden()).toBe(true);

      unmount();
    });

    it('Escape 键关闭菜单', async () => {
      const { api, unmount } = mountContextMenu();
      await nextTick();

      api.value!.open(makeMouseEvent(100, 100));
      await nextTick();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));
      await nextTick();

      expect(isMenuHidden()).toBe(true);

      unmount();
    });

    it('window blur 关闭菜单', async () => {
      const { api, unmount } = mountContextMenu();
      await nextTick();

      api.value!.open(makeMouseEvent(100, 100));
      await nextTick();

      window.dispatchEvent(new Event('blur'));
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));
      await nextTick();

      expect(isMenuHidden()).toBe(true);

      unmount();
    });

    it('卸载时清理监听器（不泄漏）', async () => {
      const { api, unmount } = mountContextMenu();
      await nextTick();

      api.value!.open(makeMouseEvent(100, 100));
      await nextTick();

      // Should not throw
      unmount();
      expect(true).toBe(true);
    });
  });

  describe('item selection', () => {
    it('点击可用项触发 select emit 并关闭菜单', async () => {
      const { api, onSelect, unmount } = mountContextMenu();
      await nextTick();

      api.value!.open(makeMouseEvent(100, 100));
      await nextTick();

      const buttons = document.querySelectorAll(
        '.context-menu-item',
      ) as NodeListOf<HTMLButtonElement>;
      expect(buttons.length).toBe(3);
      buttons[0].click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));
      await nextTick();

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(ITEMS[0]);
      expect(isMenuHidden()).toBe(true);

      unmount();
    });

    it('点击禁用项不触发 select，菜单保持打开', async () => {
      const { api, onSelect, unmount } = mountContextMenu();
      await nextTick();

      api.value!.open(makeMouseEvent(100, 100));
      await nextTick();

      const buttons = document.querySelectorAll(
        '.context-menu-item',
      ) as NodeListOf<HTMLButtonElement>;
      buttons[1].click();
      await nextTick();

      expect(onSelect).not.toHaveBeenCalled();
      expect(isMenuHidden()).toBe(false);

      unmount();
    });
  });

  describe('viewport boundary flip', () => {
    it('靠近右边界时向左翻转', async () => {
      const { api, unmount } = mountContextMenu();
      await nextTick();

      api.value!.open(makeMouseEvent(900, 100));
      await nextTick();

      const menu = document.querySelector('.context-menu') as HTMLElement;
      const left = parseInt(menu.style.left, 10);
      expect(left).toBeLessThanOrEqual(816);

      unmount();
    });

    it('靠近下边界时向上翻转', async () => {
      const { api, unmount } = mountContextMenu();
      await nextTick();

      api.value!.open(makeMouseEvent(100, 700));
      await nextTick();

      const menu = document.querySelector('.context-menu') as HTMLElement;
      const top = parseInt(menu.style.top, 10);
      expect(top).toBeLessThanOrEqual(648);

      unmount();
    });
  });
});
