// @vitest-environment happy-dom
/* eslint-disable vue/one-component-per-file -- 测试里就地 createApp 挂一个假根，不是真组件文件 */
import { describe, expect, it } from 'vitest';
import { createApp, h } from 'vue';
import Icon from '../Icon';
import { ICONS, ICON_PROPS, iconSvg, type IconName } from '../svg';

/** 图标内容允许出现的子元素（出现别的说明有人往里塞了不该塞的东西） */
const ALLOWED_TAGS = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'];

describe('图标图源（svg.ts）', () => {
  it('图标清单齐全且键名稳定', () => {
    const names = Object.keys(ICONS) as IconName[];
    // 加图标时同步改这个数 —— 这行故意不写成「≥」，就是为了让误删也红一次
    expect(names.length).toBe(38);
    for (const required of [
      'settings',
      'search',
      'close',
      'copy',
      'check',
      'link',
      'trash',
      'paragraph',
      'heading1',
      'bulletList',
      'orderedList',
      'taskList',
      'quote',
      'code',
      'table',
      'math',
      'diagram',
      // 批 3 第 2 步替换 .vue 时新增
      'eye',
      'pin',
      'chevronLeft',
      'chevronDown',
      'chevronUp',
      'plus',
      'grid',
      'arrowDownUp',
      'eraser',
      'listTree',
      // 批 3 第 3 步换 `.ts` / 菜单时新增
      'lightbulb',
      'zoomIn',
    ] as const) {
      expect(names).toContain(required);
    }
  });

  it('每个图标内容合法：非空、无外壳、无脚本、无事件、无硬编码颜色', () => {
    for (const [name, body] of Object.entries(ICONS)) {
      expect(body.length, `${name} 不能为空`).toBeGreaterThan(0);
      expect(body, `${name} 不该带 <svg> 外壳`).not.toContain('<svg');
      expect(body, `${name} 不该含脚本`).not.toMatch(/<script/i);
      expect(body, `${name} 不该含事件属性`).not.toMatch(/\son[a-z]+=/i);
      expect(body, `${name} 不该硬编码颜色`).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
      expect(body, `${name} 不该引用外部资源`).not.toMatch(/href=|url\(/i);
    }
  });

  it('每个图标只用标准 SVG 子元素', () => {
    for (const [name, body] of Object.entries(ICONS)) {
      const tags = [...body.matchAll(/<([a-zA-Z-]+)/g)].map((m) => m[1].toLowerCase());
      expect(tags.length, `${name} 至少一个子元素`).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(ALLOWED_TAGS, `${name} 出现非法元素 <${tag}>`).toContain(tag);
      }
    }
  });

  it('规格常量是唯一出口：24 画布 / 线宽 2 / 圆头圆角 / currentColor', () => {
    expect(ICON_PROPS.viewBox).toBe('0 0 24 24');
    expect(ICON_PROPS['stroke-width']).toBe('2');
    expect(ICON_PROPS['stroke-linecap']).toBe('round');
    expect(ICON_PROPS['stroke-linejoin']).toBe('round');
    expect(ICON_PROPS.stroke).toBe('currentColor');
    expect(ICON_PROPS.fill).toBe('none');
    expect(ICON_PROPS['aria-hidden']).toBe('true');
  });

  it('iconSvg() 产出完整 svg，尺寸可传（.ts 侧 innerHTML 用）', () => {
    const out = iconSvg('copy', 14);
    expect(out.startsWith('<svg ')).toBe(true);
    expect(out.endsWith('</svg>')).toBe(true);
    expect(out).toContain('viewBox="0 0 24 24"');
    expect(out).toContain('stroke-width="2"');
    expect(out).toContain('width="14"');
    expect(out).toContain('height="14"');
    expect(out).toContain(ICONS.copy);
    expect(iconSvg('copy')).toContain('width="16"');
  });
});

describe('图标组件（Icon.ts）', () => {
  function render(
    name: IconName,
    size?: number,
  ): { svg: SVGSVGElement; host: HTMLElement; done: () => void } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp({ render: () => h(Icon, { name, size }) });
    app.mount(host);
    const svg = host.querySelector('svg');
    if (!svg) throw new Error('未渲染出 svg');
    return {
      svg: svg as SVGSVGElement,
      host,
      done: () => {
        app.unmount();
        host.remove();
      },
    };
  }

  it('渲染出裸 <svg>（无包装元素）且规格正确', () => {
    const { svg, host, done } = render('copy', 20);
    // 组件的根就是 svg 本身 —— 多一层 div / span 会破坏使用处既有的 `svg { … }` 选择器
    expect(host.children.length).toBe(1);
    expect(host.firstElementChild).toBe(svg);
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
    done();
  });

  it('默认尺寸 16，内容取自同一份图源', () => {
    const { svg, done } = render('check');
    expect(svg.getAttribute('width')).toBe('16');
    // 同一份图源的子元素（happy-dom 会把自闭合序列化成成对标签，故按元素断而不是按字符串）
    expect(svg.querySelectorAll('path').length).toBe(1);
    expect(svg.querySelector('path')?.getAttribute('d')).toBe('M20 6 9 17l-5-5');
    done();
  });

  it('外部 class 透传到根 <svg>（使用处的既有样式全靠它）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp({
      render: () => h(Icon, { name: 'close', size: 14, class: 'theme-delete-icon' }),
    });
    app.mount(host);
    const svg = host.querySelector('svg');
    // 类名必须落在 svg 上 —— 落到包装元素就等于使用处的 .xxx-icon { width: 14px } 全部失效
    expect(svg?.getAttribute('class')).toBe('theme-delete-icon');
    app.unmount();
    host.remove();
  });
});
