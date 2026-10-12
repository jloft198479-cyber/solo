import type { EditorView } from '@tiptap/pm/view';

/**
 * 大纲跳转 / 高亮共用的「标题目标位置」：视口顶部往下 25% 处。
 * 与 Obsidian / Typora 的大纲跳转习惯一致：标题偏上，正文从头读。
 * 一处定义，跳转（scrollToPos）与 scroll-spy（updateActive）共用，保证所见即所得。
 */
export const OUTLINE_SCROLL_RATIO = 0.25;

/** 文档首位置（doc 起点之后第一个可写位置） */
export const DOC_START = 1;

/**
 * 纵向坐标落在**内容之外**（首块上方 / 末块下方）时 → 贴靠文档首 / 末；
 * 落在内容高度范围内 → null（交调用方按自己的语义处理）。
 *
 * 为什么按**首末块 DOM 的真实边界**判定、而不是 `view.dom` 的盒子：
 * `.tiptap-editor` 的 `min-height:100%` 相对 `height:auto` 的父级（`.mk-editor-inner`）
 * 解析 ⇒ 按 CSS 规则退化为 0 ⇒ 今天它的盒子**恰好**等于内容盒（软巧而非保证）。
 * 一旦有人把编辑器撑满可视区，`view.dom` 盒子底边就成了视口底 ⇒ 留白一律被
 * 判成「在内容内」。用首末块边界与 「撑不撑满」解耦，两边都稳。
 *
 * 调用方分工（同一份判据，两种语义）：
 * - 拖拽落点 `posFromDropPoint`：`posAtCoords` 取不到位置时贴首/末，取到 null 则
 *   回落「打开文件」（纵向在内容内但横向偏出内容列的落点，插到文档首是错的）。
 * - 空白点击 `blankClickFallbackPos`：只接管内容外的留白，故要求结果为非 null。
 */
export function posOutsideContent(view: EditorView, clientY: number): number | null {
  const firstRect = view.dom.firstElementChild?.getBoundingClientRect();
  if (firstRect && clientY < firstRect.top) return DOC_START;

  const lastRect = view.dom.lastElementChild?.getBoundingClientRect();
  if (lastRect && clientY > lastRect.bottom) return view.state.doc.content.size;

  return null;
}

/**
 * JS 滚动调用的行为选择：CSS 的 `scroll-behavior` 与 `prefers-reduced-motion`
 * 媒体查询管不到 scrollTo / scrollIntoView 的 `behavior` 参数，必须在这里
 * 显式降级——「减少动态效果」系统偏好下平滑滚动要退化为即时跳转。
 */
export function smoothScrollBehavior(): ScrollBehavior {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return 'auto';
  }
  return 'smooth';
}

/**
 * 稳定获取文档位置 pos 处的块级 DOM 元素。
 *
 * 坑（实测定位）：`view.domAtPos(pos)` 在 pos 恰好等于块节点起始边界时，
 * 返回的是父级容器（编辑根 .ProseMirror）而非块元素本身，
 * 导致后续 scrollIntoView 等操作「目标错误、静默失效」——
 * 大纲跳转只剩 focus 附带的「最小滚动」，标题被滚到视口边缘，观感即「滚了但没对准」。
 * 解法：优先 `view.nodeDOM(pos)` 直接取节点 DOM；
 * 退化路径用 domAtPos(pos + 1)（必然进入块内部，返回文本节点后取其父元素）。
 */
export function getBlockElFromPos(view: EditorView, pos: number): HTMLElement | null {
  const nodeDom = view.nodeDOM(pos);
  if (nodeDom instanceof HTMLElement) return nodeDom;
  const at = view.domAtPos(Math.min(pos + 1, view.state.doc.content.size));
  const el = at.node instanceof HTMLElement ? at.node : at.node.parentElement;
  return el instanceof HTMLElement ? el : null;
}

/**
 * 将元素平滑滚动到编辑区滚动容器「视口顶部往下 ratio」处（默认 0.25）。
 * 手算 scrollTop，不依赖 scrollIntoView 的 block 语义，目标位置可精确指定；
 * 找不到滚动容器时退回 scrollIntoView 顶部对齐（仍受 CSS scroll-padding-top 留白保护）。
 */
export function scrollElementIntoView(
  view: EditorView,
  el: HTMLElement,
  ratio: number = OUTLINE_SCROLL_RATIO,
): void {
  const container = (view.dom as HTMLElement).closest('.mk-editor') as HTMLElement | null;
  if (!container) {
    el.scrollIntoView({ behavior: smoothScrollBehavior(), block: 'start' });
    return;
  }
  const elTop = el.getBoundingClientRect().top;
  const containerTop = container.getBoundingClientRect().top;
  const targetScrollTop =
    elTop - containerTop + container.scrollTop - container.clientHeight * ratio;
  container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: smoothScrollBehavior() });
}
