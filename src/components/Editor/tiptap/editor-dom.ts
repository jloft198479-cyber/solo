import type { EditorView } from '@tiptap/pm/view';

/**
 * 大纲跳转 / 高亮共用的「标题目标位置」：视口顶部往下 25% 处。
 * 与 Obsidian / Typora 的大纲跳转习惯一致：标题偏上，正文从头读。
 * 一处定义，跳转（scrollToPos）与 scroll-spy（updateActive）共用，保证所见即所得。
 */
export const OUTLINE_SCROLL_RATIO = 0.25;

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
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const elTop = el.getBoundingClientRect().top;
  const containerTop = container.getBoundingClientRect().top;
  const targetScrollTop =
    elTop - containerTop + container.scrollTop - container.clientHeight * ratio;
  container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
}
