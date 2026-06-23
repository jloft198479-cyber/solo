import { onMounted, onBeforeUnmount, type Ref } from 'vue';

/**
 * 点击外部检测 composable
 *
 * 在文档层面监听点击事件，当点击发生在指定元素之外时触发回调。
 * 自动随组件生命周期挂载/卸载监听器。
 *
 * @param target 目标元素引用（点击该元素及其后代不会触发回调）
 * @param handler 点击外部时的回调
 * @param options.eventName 监听的事件名，默认 'click'
 */
export function useClickOutside(
  target: Ref<HTMLElement | null>,
  handler: (event: MouseEvent) => void,
  options: { eventName?: 'click' | 'mousedown' | 'pointerdown' } = {},
) {
  const eventName = options.eventName ?? 'click';

  function listener(event: MouseEvent) {
    const el = target.value;
    if (!el) return;
    if (el.contains(event.target as Node)) return;
    handler(event);
  }

  onMounted(() => document.addEventListener(eventName, listener));
  onBeforeUnmount(() => document.removeEventListener(eventName, listener));
}
