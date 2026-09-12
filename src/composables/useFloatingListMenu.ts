import { ref, computed, watch, nextTick, type Ref } from 'vue';
import type { MenuPosition } from '../components/Editor/tiptap/editor-extensions';

/**
 * 浮动列表菜单 composable
 *
 * 抽取 SlashMenu / EmojiMenu / WikilinkMenu 共有的浮动菜单逻辑：
 * - 显隐与定位
 * - 选中索引管理（items 变化时自动重置）
 * - 键盘导航（ArrowUp / ArrowDown / Enter）
 * - 选中项滚动到可视区
 *
 * @param options.items 返回当前扁平化条目列表的 getter（用于计算总数与选中项）
 * @param options.command 选中条目时执行的回调
 * @param options.menuRef 菜单根元素引用（用于 scrollIntoView）
 */
export function useFloatingListMenu<T>(options: {
  items: () => T[];
  command: () => (item: T) => void;
  menuRef: Ref<HTMLElement | undefined>;
}) {
  const { items: getItems, command: getCommand, menuRef } = options;

  const visible = ref(false);
  // 隐藏态占位值，show() 时必被覆盖
  const position = ref<MenuPosition>({ top: 0, left: 0, maxHeight: 0 });
  const selectedIndex = ref(0);

  /**
   * 直接给模板的 style：放下方给 top、放上方给 bottom（见 MenuPosition），
   * 并把可用高度作为 --menu-max-height 下发，由 CSS 施加到滚动区。
   */
  const menuStyle = computed(() => {
    const { top, bottom, left, maxHeight } = position.value;
    return {
      left: `${left}px`,
      ...(bottom === undefined ? { top: `${top ?? 0}px` } : { bottom: `${bottom}px` }),
      '--menu-max-height': `${maxHeight}px`,
    };
  });

  // 条目列表变化时重置选中项
  watch(getItems, () => {
    selectedIndex.value = 0;
  });

  function selectItem(index: number) {
    const item = getItems()[index];
    if (item) getCommand()(item);
  }

  function onKeyDown(event: KeyboardEvent): boolean {
    const count = getItems().length;
    if (count === 0) return false;

    if (event.key === 'ArrowUp') {
      selectedIndex.value = (selectedIndex.value - 1 + count) % count;
      scrollToSelected();
      return true;
    }
    if (event.key === 'ArrowDown') {
      selectedIndex.value = (selectedIndex.value + 1) % count;
      scrollToSelected();
      return true;
    }
    if (event.key === 'Enter') {
      selectItem(selectedIndex.value);
      return true;
    }
    return false;
  }

  function scrollToSelected() {
    nextTick(() => {
      const el = menuRef.value?.querySelector('.mk-slash-menu-item--active');
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  function show(pos: MenuPosition) {
    position.value = pos;
    visible.value = true;
    selectedIndex.value = 0;
  }

  function hide() {
    visible.value = false;
  }

  return {
    visible,
    menuStyle,
    selectedIndex,
    selectItem,
    onKeyDown,
    show,
    hide,
  };
}
