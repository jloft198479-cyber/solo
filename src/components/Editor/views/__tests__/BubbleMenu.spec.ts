// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, createApp, nextTick, ref } from 'vue';
import BubbleMenuComponent from '../BubbleMenu.vue';

/**
 * 挂一个父组件以拿到 defineExpose 的 update()。
 * 用 createApp 而不是 @vue/test-utils：本项目没有该依赖，ContextMenu 用例同款写法。
 */
function mountBubbleMenu() {
  const api = ref<InstanceType<typeof BubbleMenuComponent> | null>(null);

  const Wrapper = defineComponent({
    setup() {
      return () =>
        h(BubbleMenuComponent, {
          ref: (el: unknown) => {
            api.value = el as InstanceType<typeof BubbleMenuComponent> | null;
          },
          onAction: vi.fn(),
        });
    },
  });

  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(Wrapper);
  app.mount(host);

  return {
    api,
    menu: () => document.querySelector('.bubble-menu') as HTMLElement | null,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('BubbleMenu 定位', () => {
  it('显示时按选区坐标定位', async () => {
    const { api, menu, unmount } = mountBubbleMenu();
    await nextTick();

    api.value!.update(true, 300, 200, {});
    await nextTick();

    const el = menu()!;
    expect(el.style.left).toBe('300px');
    expect(el.style.top).toBe('200px');
    unmount();
  });

  it('隐藏时不得把坐标写成 0,0（取消选区后左上角闪一下的回归锁）', async () => {
    // 根因：调用方隐藏时传 0,0 占位，旧实现照单全收；而 <Transition> + v-show 在
    // 离场动画期间元素仍然可见（.mk-menu-leave-active 120ms），于是被画到视口左上角。
    // 这条锁只关心坐标不被污染 —— 与离场动画是否跑完无关。
    const { api, menu, unmount } = mountBubbleMenu();
    await nextTick();

    api.value!.update(true, 300, 200, {});
    await nextTick();

    api.value!.update(false, 0, 0, {});
    await nextTick();

    const el = menu()!;
    expect(el.style.left).toBe('300px');
    expect(el.style.top).toBe('200px');
    unmount();
  });
});
