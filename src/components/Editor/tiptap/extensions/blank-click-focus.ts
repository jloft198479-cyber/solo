import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';

import { isFrozen } from '../composition-freeze';
import { DOC_START, posOutsideContent } from '../editor-dom';

/**
 * 空白点击落光标兜底 —— 点编辑区留白 → 光标落到最近内容（Typora 手感）。
 *
 * ## 病（2026-10-13 简乐报告，真机确认）
 * 表格 / 代码块 / 图片 / 公式等大块节点**下方的视觉留白**点击，光标不出现；
 * 只有精准点到块下方第一个真实段落才定位。
 *
 * ## 两层成因（缺一不成立）
 * 1. **事件到不了 ProseMirror**：`.tiptap-editor` 的 `min-height:100%`（`editor.css`）
 *    相对 `height:auto` 的父级 `.mk-editor-inner` 解析 ⇒ 按 CSS 规则，百分比 min-height
 *    对「高度取决于内容」的包含块**退化为 0** ⇒ 编辑器盒子只到内容高度（真机读数：
 *    空文档 editor.bottom=98 vs 纸面 bottom=713）⇒ 留白**不在 `view.dom` 内**，
 *    而 PM 的 `handleDOMEvents` 全挂在 `view.dom` 上 ⇒ 挂在那儿的兜底从不触发。
 * 2. **PM 内置 mousedown 无兜底**：`prosemirror-view` `handlers.mousedown` 第一件事
 *    就是 `let pos = view.posAtCoords(...); if (!pos) return;` ⇒ 取不到位置直接返回。
 *
 * ## 药
 * 判据与拖拽落点 `posFromDropPoint`（`MarkdownEditor.vue`）同一范式：「在不在纸上」
 * 按**滚动容器**（`.mk-editor`，即 `editorWrapRef`）判定，而不是 PM 内容根 ——
 * 留白视觉上就是纸面。监听挂在容器上（模板 `@mousedown`），于是成因 1 被绕开，
 * 成因 2 由本兜底接管：内容实际底边下方 → 落文档末尾；实际顶边上方 → 落开头。
 *
 * ⚠️ 首 / 末判定与拖拽落点共用 `editor-dom.ts::posOutsideContent`（为什么用首末块
 * 真实边界、不用 `view.dom` 盒子，理由写在那里，一处定义）。
 * ⚠️ 只在 `posAtCoords` 取不到位置时接管：表格内点击、列宽拖拽、链接点击、
 * 双击选词、普通段落定位全部走 ProseMirror 原路径，本兜底零接管。
 * ⚠️ 落点沿用 PM 原生点击路径的**逐字等价**行为（`updateSelection`，view 3259-3270：
 * focus → setSelection → `pointer` meta → dispatch，**不做** scrollIntoView）——
 * 能点到留白就说明对应块可见，滚是多余的。
 *
 * 契约锁：`__tests__/blank-click-focus.spec.ts`（happy-dom 只能盖判定与事务路径，
 * 坐标几何靠真机复核）。
 */

/**
 * 空白点击的兜底落点；返回 null 表示不接管（交回浏览器 / ProseMirror 默认处理）。
 *
 * 判据顺序（任何一条不满足即放行）：左键无 Shift / 非组字中 / `posAtCoords` 为空 /
 * 坐标在纸面内 / 且在首块上方或末块下方（后两条判据见 `editor-dom.ts`）。
 */
export function blankClickFallbackPos(
  view: EditorView,
  event: MouseEvent,
  paperEl: HTMLElement,
): number | null {
  if (event.button !== 0 || event.shiftKey) return null;
  if (isFrozen(view)) return null;
  if (view.posAtCoords({ left: event.clientX, top: event.clientY })) return null;

  const paper = paperEl.getBoundingClientRect();
  if (
    event.clientX < paper.left ||
    event.clientX > paper.right ||
    event.clientY < paper.top ||
    event.clientY > paper.bottom
  ) {
    return null;
  }

  return posOutsideContent(view, event.clientY);
}

/**
 * 装上兜底落点。`pointer` meta 与 `view.focus()` 均照 PM 原生点击路径
 * （`updateSelection`）来，故本事务对下游插件与原生点击不可区分。
 * `near` 找最近合法光标位（末块是表格 / 图片等非 textblock 时，`size` 处本身
 * 不是合法光标位），末尾向文档前找（-1）、开头向文档后找（1）。
 */
function applyBlankClickFocus(view: EditorView, pos: number): void {
  const selection = TextSelection.near(
    view.state.doc.resolve(pos),
    pos === DOC_START ? 1 : -1,
  );
  // preventDefault 会吞掉浏览器原生聚焦，必须手动 focus
  view.focus();
  const tr = view.state.tr.setSelection(selection);
  tr.setMeta('pointer', true);
  view.dispatch(tr);
}

/**
 * `mousedown` 处理器。**必须以 DOM 监听器身份调用**（要用 `currentTarget` 当纸面）；
 * 由 `MarkdownEditor.vue` 挂在滚动容器 `.mk-editor` 上（模板 `@mousedown`）。
 * 返回是否接管（供测试断言）。
 */
export function handleBlankAreaMousedown(view: EditorView, event: MouseEvent): boolean {
  const paper = event.currentTarget;
  if (!(paper instanceof HTMLElement)) return false;

  const pos = blankClickFallbackPos(view, event, paper);
  if (pos === null) return false;

  applyBlankClickFocus(view, pos);
  event.preventDefault();
  return true;
}
