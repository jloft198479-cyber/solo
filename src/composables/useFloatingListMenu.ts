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

  /**
   * 显示菜单。**列表为空时不显示**（已显示则收起）——「没有内容可展示的菜单」
   * 对用户只是噪音，且会一直挂在光标下遮挡正文（如中文里打「类型/属性」：
   * `/` 后是汉字，与唤出命令长得一样，程序分不出，只能等 query 零命中后收场）。
   *
   * 唯一例外是「空态承载的是用法说明而非无结果提示」——互链菜单未保存文档时
   * 显示「存到文件夹后，可链接同目录文档」，那句是在教用户怎么用，必须留。
   * 此类菜单显式传 `allowEmpty: true`（见 editor-extensions.ts 的 WikilinkSuggest）。
   *
   * 注意：不要给 WikilinkSuggest 去掉 allowEmpty——它的 onStart 先显示缓存、
   * 再靠后台 refreshWikilinkCandidates().then(updateItems()) 异步补数据；
   * 缓存为空时若在此收掉，异步数据到达后无人重唤 show，互链补全会静默失效
   *（同类事故见 docs/CHANGELOG.md「`[[` 曾两度不弹」）。
   *
   * `options.items`：调用方**当帧的列表快照**，判空优先用它。Suggestion 回调里
   * items 经 Vue props 传播滞后一帧（父组件重渲染在下个微任务），`getItems()`
   * 读到的是上一帧旧列表——启动后首次唤出时旧列表恰为初始空数组，判空误收，
   * 菜单死且无人重唤（「/ 不弹出」事故，2026-09-14 修）。快照与 props 在绘制前
   * 会合，实际渲染内容不受影响；只有判空这个同步读必须用快照。
   */
  function show(pos: MenuPosition, options?: { allowEmpty?: boolean; items?: T[] }) {
    const currentItems = options?.items ?? getItems();
    if (currentItems.length === 0 && !options?.allowEmpty) {
      visible.value = false;
      return;
    }
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
