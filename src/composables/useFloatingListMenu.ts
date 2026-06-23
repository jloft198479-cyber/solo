import { ref, watch, nextTick, type Ref } from 'vue';

/**
 * 浮动列表菜单 composable
 *
 * 抽取 SlashMenu / EmojiMenu 共有的浮动菜单逻辑：
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
  const position = ref({ top: 0, left: 0 });
  const selectedIndex = ref(0);

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

  function show(pos: { top: number; left: number }) {
    position.value = pos;
    visible.value = true;
    selectedIndex.value = 0;
  }

  function hide() {
    visible.value = false;
  }

  return {
    visible,
    position,
    selectedIndex,
    selectItem,
    onKeyDown,
    show,
    hide,
  };
}
