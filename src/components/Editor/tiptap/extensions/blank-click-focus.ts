import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';

import { isFrozen } from '../composition-freeze';

/**
 * 空白点击落光标兜底 —— 点编辑区留白 → 光标落到最近内容（Typora 手感）。
 *
 * ## 病（2026-10-13 简乐报告，真机确认）
 * 在表格 / 代码块 / 图片 / 公式等大块节点**下方的视觉留白**点击，光标不出现；
 * 只有精准点到块下方第一个真实段落才定位。与 Typora / Word「点空白任意位置
 * 自动定位到内容附近」的习惯不符。
 *
 * ## 两层成因（缺一不成立，只修一层无效）
 * 1. **事件到不了 ProseMirror**：`.tiptap-editor` 的 `min-height:100%`
 *    （`editor.css`）相对 `height:auto` 的父级 `.mk-editor-inner` 解析 ⇒ 按 CSS
 *    规则，百分比 min-height 对「高度取决于内容」的包含块**退化为 0** ⇒ 编辑器
 *    盒子只到内容高度，**内容下方的留白压根不在 `view.dom` 内**。ProseMirror 的
 *    DOM 事件（含 `handleDOMEvents`）只挂在 `view.dom` 上 ⇒ 留白上的 mousedown
 *    根本进不了 PM，任何挂在 `view.dom` 的补丁都不会被触发。
 * 2. **即便进了 PM 也没有兜底**：PM 内置 `handlers.mousedown`
 *    （`prosemirror-view/dist/index.js`：`let pos = view.posAtCoords(...);
 *    if (!pos) return;`）取不到位置就直接返回，不产生任何光标动作。
 *
 * ## 药
 * 判据与拖拽落点 `posFromDropPoint`（`MarkdownEditor.vue`）**同一范式**：
 * 「在不在纸上」按**滚动容器**（`.mk-editor`，即 `editorWrapRef`）判定，而不是
 * ProseMirror 内容根 —— 正文留白视觉上就是纸面，压不到文字节点也不该判成纸外。
 * 监听也挂在该容器上（而非 `view.dom`）⇒ 病因 1 被绕开，病因 2 由本兜底接管：
 * 内容实际底边下方 → 落文档末尾；实际顶边上方 → 落开头；其余一律放行。
 *
 * ⚠️ 首 / 末块判定用**首末块 DOM 的真实边界**，不能用 `view.dom` 的盒子 ——
 * 它被 `min-height` 撑得比内容高，内容短时其底边不是内容底边。
 * ⚠️ 只在 `posAtCoords` 取不到位置时才接管：表格内点击、列宽拖拽、链接点击、
 * 双击选词、普通段落定位全部走 ProseMirror 原路径，本兜底零接管。
 *
 * 契约锁：`__tests__/blank-click-focus.spec.ts`（happy-dom 只能盖判定与事务路径，
 * 坐标几何靠真机复核）。
 */

/** 文档首位置（doc 起点之后第一个可写位置） */
const DOC_START = 1;

function inRect(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * 空白点击的兜底落点；返回 null 表示不接管（交回 ProseMirror 默认处理）。
 *
 * 判据顺序（任何一条不满足即放行）：
 * 1. 左键、无 Shift（Shift 扩展选区语义下留白处维持 ProseMirror 原状：不动）
 * 2. 不在输入法组字中（合成期移动选区会拆组字 DOM → 候选窗失锚）
 * 3. `posAtCoords` 必须为空 —— 非空说明点到了真实内容，绝不接管
 * 4. 坐标必须在纸面（滚动容器）内
 * 5. 只接管首块上方 / 末块下方两处「内容外」留白；块间留白交回 ProseMirror
 */
export function blankClickFallbackPos(
  view: EditorView,
  event: MouseEvent,
  paperEl: HTMLElement,
): number | null {
  if (event.button !== 0 || event.shiftKey) return null;
  if (isFrozen(view)) return null;
  if (view.posAtCoords({ left: event.clientX, top: event.clientY })) return null;

  if (!inRect(paperEl.getBoundingClientRect(), event.clientX, event.clientY)) return null;

  const firstRect = view.dom.firstElementChild?.getBoundingClientRect();
  if (firstRect && event.clientY < firstRect.top) return DOC_START;

  const lastRect = view.dom.lastElementChild?.getBoundingClientRect();
  if (lastRect && event.clientY > lastRect.bottom) return view.state.doc.content.size;

  return null;
}

/**
 * 应用兜底落点：`near` 找最近合法光标位（末块是表格 / 图片等非 textblock 时，
 * `size` 处本身不是合法光标位），末尾向文档前找（-1）、开头向文档后找（1）。
 */
function applyBlankClickFocus(view: EditorView, pos: number): void {
  const selection = TextSelection.near(
    view.state.doc.resolve(pos),
    pos === DOC_START ? 1 : -1,
  );
  // preventDefault 会吞掉浏览器原生聚焦，必须手动 focus
  view.focus();
  const tr = view.state.tr.setSelection(selection).scrollIntoView();
  // 与 ProseMirror 原生点击更新选区同路（updateSelection 打 pointer 标记）
  tr.setMeta('pointer', true);
  view.dispatch(tr);
}

export interface BlankClickFocusOptions {
  /** 取当前编辑器 view；懒建期间可能为 null */
  getView: () => EditorView | null;
  /** 编辑区滚动容器（`.mk-editor` / `editorWrapRef`），即「纸面」 */
  getPaperEl: () => HTMLElement | null;
}

/**
 * 装上「点空白落光标」兜底，返回卸载函数。
 * 纸面元素在挂载前不可得 ⇒ 请在 `onMounted` 里调用。
 */
export function installBlankClickFocus(opts: BlankClickFocusOptions): () => void {
  const paper = opts.getPaperEl();
  if (!paper) return () => {};

  const onMouseDown = (event: MouseEvent): void => {
    const view = opts.getView();
    if (!view || view.isDestroyed) return;
    const pos = blankClickFallbackPos(view, event, paper);
    if (pos === null) return;
    applyBlankClickFocus(view, pos);
    event.preventDefault();
  };

  paper.addEventListener('mousedown', onMouseDown);
  return () => paper.removeEventListener('mousedown', onMouseDown);
}
