import { defineComponent, h, type PropType } from 'vue';
import { ICON_PROPS, ICONS, type IconName } from './svg';

/**
 * 图标组件（设计规范化 2026-10-17 · 批 3 第 1 步）
 *
 * 用法：`<Icon name="copy" :size="16" />`
 * - **不套任何包装元素**，直接渲染 `<svg>` —— 用 span 包一层会破坏使用处既有的
 *   `svg { width: … }` 一类选择器。
 * - 规格（画布 / 线宽 / 端点 / 颜色 / aria）全部来自 `svg.ts` 的 `ICON_PROPS`，
 *   组件本身不重复声明，改规格只改那一处。
 * - 尺寸默认 16，需要别的尺寸传 `:size`。
 *
 * 第 2 步起接入各使用处；`svg.ts` 的 `iconSvg()` 供 `.ts` 侧 innerHTML 使用，
 * 两者取的是同一份图源，不存在第二套定义。
 */
export default defineComponent({
  name: 'Icon',
  props: {
    name: { type: String as PropType<IconName>, required: true },
    size: { type: Number, default: 16 },
  },
  setup(props) {
    return () =>
      h('svg', {
        ...ICON_PROPS,
        width: props.size,
        height: props.size,
        innerHTML: ICONS[props.name],
      });
  },
});
