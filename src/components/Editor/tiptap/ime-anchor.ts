/**
 * Windows / WebView2：宿主窗口缩放后输入法候选窗失锚的「重锚」护栏。
 *
 * ## 现象与成因
 * 用鼠标拖窗口边框缩放后立刻用输入法打字，候选窗与预编辑会浮到**屏幕固定角**、
 * 并**不自愈**（光标仍在正文、文字能提交，只有候选窗位置错）。成因在 WebView2
 * 宿主层：缩放后浏览器进程侧的 TSF 文本库丢了 caret 布局，`GetTextExt` 拿不到锚点，
 * 输入法退回默认位置。要把它喂回去，必须让渲染进程**重发一次 TextInputState**。
 *
 * ## 为什么是「blur → 等一会儿 → focus」而不是「focus 一下」
 * 必须有**真实焦点转移**、且两次状态变化**拉开间隔**才会触发重发；太近会被渲染
 * 进程合并成「没变过」。实测（外部同栈项目 Lanmark，见
 * docs/IME-CANDIDATE-WINDOW.md §16）：只 `focus()`、同步 `blur+focus`、
 * `setTimeout(0)`、只挪 DOM 选区 —— 全部无效。本项目此前的「鼠标注入」三版补丁
 * 走的是另一条机制（刷新触发器），亦全部无效。
 *
 * ## 触发面
 * 首版**只挂 `resize`**（与外部已验证方案对齐，最小改动、最可对照）。本项目另有
 * 「切文档 / 切焦点后首次组字」也会失锚 —— 是否扩展触发面留待真机验证后决定。
 *
 * ## 约束（勿违）
 * 1. 组字态走 `composition-freeze.ts`（`isFrozen`）这一唯一真相源，不另造判断。
 * 2. 组字中**不打断**：置 pending，等 `compositionend` 再补做（blur 会吞预编辑）。
 * 3. 只在 Windows 生效；其它平台整段空操作。
 * 4. 退化安全：无编辑器 / 已销毁 / 焦点不在编辑器 → 空操作。
 *
 * 详见修复档案 docs/IME-ANCHOR-GUARD-2026-10-09.md。
 */
import type { EditorView } from '@tiptap/pm/view';

import { isWindows } from '../../../utils/platform';
import { isFrozen } from './composition-freeze';

/** 缩放拖动期间 resize 连发；等它稳定下来再重锚一次 */
export const IME_ANCHOR_DEBOUNCE_MS = 120;

/**
 * blur 与 focus 之间必须留的间隔。不能是 0：
 * 同一任务内（含 `setTimeout(0)`）的 blur+focus 会被渲染进程合并，浏览器进程侧
 * 看不到焦点转移，TSF 布局就不会重发。
 */
export const IME_ANCHOR_FOCUS_DELAY_MS = 60;

/**
 * ⚠️ 临时 A/B 验证开关 —— **验证完成后必须删除**（见修复档案 §4/阶段 4）。
 * 用法：DevTools Console 执行
 *   `localStorage.setItem('solo:imeAnchorGuard','off')` → 护栏停用（即时生效，无需刷新）
 *   `localStorage.removeItem('solo:imeAnchorGuard')`   → 护栏恢复
 */
const AB_SWITCH_KEY = 'solo:imeAnchorGuard';

function isDisabledBySwitch(): boolean {
  try {
    return window.localStorage.getItem(AB_SWITCH_KEY) === 'off';
  } catch {
    return false;
  }
}

export interface ImeAnchorGuardOptions {
  /** 取当前编辑器 view；懒建期间可能为 null */
  getView: () => EditorView | null;
  /** 默认按平台判定（仅 Windows 生效）；测试可强制 */
  enabled?: boolean;
  debounceMs?: number;
  focusDelayMs?: number;
  /** 注入用（默认真实 window；测试传 happy-dom window） */
  target?: Window;
}

interface ScrollState {
  el: HTMLElement;
  top: number;
  left: number;
}

/** 自被重锚元素向上逐层记下非零滚动位置，重锚后还原（避免焦点转移引发跳动） */
function saveScroll(el: HTMLElement): ScrollState[] {
  const out: ScrollState[] = [];
  let node: HTMLElement | null = el;
  while (node) {
    if (node.scrollTop !== 0 || node.scrollLeft !== 0) {
      out.push({ el: node, top: node.scrollTop, left: node.scrollLeft });
    }
    node = node.parentElement;
  }
  return out;
}

function restoreScroll(states: ScrollState[]): void {
  for (const s of states) {
    if (!s.el.isConnected) continue;
    s.el.scrollTop = s.top;
    s.el.scrollLeft = s.left;
  }
}

/**
 * 装上「缩放后重锚输入焦点」护栏，返回卸载函数。
 * 任何时候调用都安全：无编辑器 / 焦点不在编辑器 / 非 Windows 时都是空操作。
 */
export function installImeAnchorGuard(opts: ImeAnchorGuardOptions): () => void {
  const w = opts.target ?? window;
  const enabled = opts.enabled ?? isWindows;
  if (!enabled) return () => {};

  const debounceMs = opts.debounceMs ?? IME_ANCHOR_DEBOUNCE_MS;
  const focusDelayMs = opts.focusDelayMs ?? IME_ANCHOR_FOCUS_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  // 组字中不能 blur（会吞掉预编辑）；置 pending，等 compositionend 再补做
  let pending = false;

  const reanchor = (): void => {
    if (isDisabledBySwitch()) return;
    const view = opts.getView();
    if (!view || view.isDestroyed) return;
    const el = view.dom as HTMLElement;
    // 焦点不在编辑器 → 空操作（护的是输入焦点，别的地方不碰）
    if (w.document.activeElement !== el) return;
    // 组字中 → 不打断，等组字结束再补
    if (isFrozen(view)) {
      pending = true;
      return;
    }
    const scrolls = saveScroll(el);
    el.blur();
    // 必须等一会儿：紧挨着（同一任务，甚至 setTimeout(0)）的 blur+focus 会被
    // 渲染进程合并，浏览器进程侧看不到焦点转移，TSF 布局不会重发。
    focusTimer = setTimeout(() => {
      focusTimer = undefined;
      if (disposed || view.isDestroyed) return;
      // 用 PM 的 focus（会按 state.selection 还原选区），而非裸 DOM focus
      view.focus();
      restoreScroll(scrolls);
    }, focusDelayMs);
  };

  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      reanchor();
    }, debounceMs);
  };

  const onCompositionEnd = (): void => {
    if (!pending) return;
    pending = false;
    schedule();
  };

  w.addEventListener('resize', schedule);
  w.addEventListener('compositionend', onCompositionEnd, true);

  return () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    if (focusTimer !== undefined) clearTimeout(focusTimer);
    w.removeEventListener('resize', schedule);
    w.removeEventListener('compositionend', onCompositionEnd, true);
  };
}
