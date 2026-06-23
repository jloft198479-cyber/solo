// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { ref, defineComponent, h, createApp, nextTick } from 'vue';
import { useFloatingListMenu } from '../useFloatingListMenu';

interface Item {
  id: number;
  label: string;
}

function mountWith<T>(setup: () => T): { result: T; unmount: () => void } {
  let result!: T;
  const Component = defineComponent({
    setup() {
      result = setup();
      return () => h('div');
    },
  });

  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(Component);
  app.mount(el);

  return { result, unmount: () => { app.unmount(); document.body.removeChild(el); } };
}

describe('useFloatingListMenu', () => {
  function setup(items: Item[], command = vi.fn()) {
    const menuRef = ref<HTMLElement | undefined>(undefined);
    const itemsRef = ref<Item[]>(items);

    const { result, unmount } = mountWith(() =>
      useFloatingListMenu<Item>({
        items: () => itemsRef.value,
        command: () => command,
        menuRef,
      }),
    );

    return { result, unmount, itemsRef, command };
  }

  describe('初始状态', () => {
    it('默认不可见，位置为 (0,0)，选中索引为 0', () => {
      const { result, unmount } = setup([{ id: 1, label: 'A' }]);

      expect(result.visible.value).toBe(false);
      expect(result.position.value).toEqual({ top: 0, left: 0 });
      expect(result.selectedIndex.value).toBe(0);

      unmount();
    });
  });

  describe('show / hide', () => {
    it('show 设置位置并显示，重置选中索引', () => {
      const { result, unmount } = setup([{ id: 1, label: 'A' }, { id: 2, label: 'B' }]);

      result.selectedIndex.value = 1;
      result.show({ top: 100, left: 200 });

      expect(result.visible.value).toBe(true);
      expect(result.position.value).toEqual({ top: 100, left: 200 });
      expect(result.selectedIndex.value).toBe(0);

      unmount();
    });

    it('hide 隐藏菜单', () => {
      const { result, unmount } = setup([{ id: 1, label: 'A' }]);

      result.show({ top: 0, left: 0 });
      result.hide();

      expect(result.visible.value).toBe(false);

      unmount();
    });
  });

  describe('items 变化时重置选中索引', () => {
    it('替换 items 后 selectedIndex 归零', async () => {
      const { result, unmount, itemsRef } = setup([{ id: 1, label: 'A' }, { id: 2, label: 'B' }]);

      result.selectedIndex.value = 1;
      itemsRef.value = [{ id: 3, label: 'C' }, { id: 4, label: 'D' }, { id: 5, label: 'E' }];
      await nextTick();

      expect(result.selectedIndex.value).toBe(0);

      unmount();
    });
  });

  describe('selectItem', () => {
    it('调用 command 回调并传递对应条目', () => {
      const command = vi.fn();
      const { result, unmount } = setup(
        [{ id: 1, label: 'A' }, { id: 2, label: 'B' }],
        command,
      );

      result.selectItem(1);

      expect(command).toHaveBeenCalledWith({ id: 2, label: 'B' });

      unmount();
    });

    it('越界索引不触发回调', () => {
      const command = vi.fn();
      const { result, unmount } = setup([{ id: 1, label: 'A' }], command);

      result.selectItem(99);

      expect(command).not.toHaveBeenCalled();

      unmount();
    });
  });

  describe('onKeyDown', () => {
    it('ArrowDown 向下移动选中项', () => {
      const { result, unmount } = setup([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
        { id: 3, label: 'C' },
      ]);

      const handled = result.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      expect(handled).toBe(true);
      expect(result.selectedIndex.value).toBe(1);

      unmount();
    });

    it('ArrowDown 在末尾时循环到第一项', () => {
      const { result, unmount } = setup([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
      ]);

      result.selectedIndex.value = 1;
      const handled = result.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      expect(handled).toBe(true);
      expect(result.selectedIndex.value).toBe(0);

      unmount();
    });

    it('ArrowUp 向上移动选中项', () => {
      const { result, unmount } = setup([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
        { id: 3, label: 'C' },
      ]);

      result.selectedIndex.value = 2;
      const handled = result.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

      expect(handled).toBe(true);
      expect(result.selectedIndex.value).toBe(1);

      unmount();
    });

    it('ArrowUp 在开头时循环到末尾', () => {
      const { result, unmount } = setup([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
        { id: 3, label: 'C' },
      ]);

      const handled = result.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

      expect(handled).toBe(true);
      expect(result.selectedIndex.value).toBe(2);

      unmount();
    });

    it('Enter 调用 command 并传递当前选中项', () => {
      const command = vi.fn();
      const { result, unmount } = setup(
        [{ id: 1, label: 'A' }, { id: 2, label: 'B' }],
        command,
      );

      result.selectedIndex.value = 1;
      const handled = result.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(handled).toBe(true);
      expect(command).toHaveBeenCalledWith({ id: 2, label: 'B' });

      unmount();
    });

    it('未识别的按键返回 false', () => {
      const { result, unmount } = setup([{ id: 1, label: 'A' }]);

      const handled = result.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(handled).toBe(false);

      unmount();
    });

    it('空列表时所有按键均返回 false', () => {
      const { result, unmount } = setup([]);

      expect(result.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(false);
      expect(result.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }))).toBe(false);
      expect(result.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);

      unmount();
    });
  });
});
