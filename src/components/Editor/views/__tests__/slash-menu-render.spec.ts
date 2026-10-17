// @vitest-environment happy-dom
/**
 * 斜杠菜单渲染锁（2026-10-17 · 批 3 第 3 步）
 *
 * 防的事故：14 项的图标曾经是**系统字符**（`¶` `H1` `•` `☐` `∑` …），由字体渲染，
 * 粗细 / 大小 / 基线全不可控。`menu-icons.spec.ts` 锁的是「数据层必须是图标键」，
 * 但数据对了、模板照样能退回 `{{ item.icon }}`（屏幕上就印出 `paragraph` 字样）。
 * 所以这里在 DOM 层再锁一次：**图标格里出现的必须是 `<svg>`，不许有文字**。
 */
import { createApp, defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';

import SlashMenu from '../SlashMenu.vue';
import { slashCommandItems } from '../../tiptap/extensions/slash-commands';

describe('斜杠菜单渲染锁', () => {
  it('14 项全部渲染成 svg，图标格里没有残留文字', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(
      defineComponent({
        render: () => h(SlashMenu, { items: slashCommandItems, command: () => {} }),
      }),
    );
    app.mount(host);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // DOM 断言必须在 unmount 之前（unmount 会清空 host）
    const boxes = [...host.querySelectorAll('.mk-slash-menu-icon')];
    const svgs = host.querySelectorAll('.mk-slash-menu-icon svg');
    const leftoverText = boxes.map((box) => (box.textContent ?? '').trim()).filter(Boolean);

    expect(boxes.length).toBe(slashCommandItems.length);
    expect(svgs.length).toBe(slashCommandItems.length);
    expect(leftoverText, '图标格里出现了文字，说明模板退回成字符渲染了').toEqual([]);

    app.unmount();
    host.remove();
  });
});
