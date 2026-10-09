/**
 * Windows / WebView2：宿主窗口几何变化后输入法候选窗失锚的「重锚」护栏。
 *
 * ## 现象与成因
 * 拖动 / 缩放窗口后立刻用输入法打字，候选窗与预编辑会浮到**屏幕上的固定位置**、
 * 并**不自愈**（光标仍在正文、文字能提交，只有候选窗位置错）。成因在 WebView2
 * 宿主层：窗口几何一变，浏览器进程侧的 TSF 文本库就丢了 caret 布局，
 * `GetTextExt` 拿不到锚点，输入法退回默认位置。要把它喂回去，必须让渲染进程
 * **重发一次 TextInputState**。
 *
 * ## 为什么是「blur → 等一会儿 → focus」而不是「focus 一下」
 * 必须有**真实焦点转移**、且两次状态变化**拉开间隔**才会触发重发；太近会被渲染
 * 进程合并成「没变过」。实测（外部同栈项目 Lanmark，见
 * docs/IME-CANDIDATE-WINDOW.md §16）：只 `focus()`、同步 `blur+focus`、
 * `setTimeout(0)`、只挪 DOM 选区 —— 全部无效。本项目此前的「鼠标注入」三版补丁
 * 走的是另一条机制（刷新触发器），亦全部无效。
 *
 * ## ⭐ 触发面（2026-10-09 修订，本模块最关键的一处）
 * 首版**只挂 DOM `resize`** —— 被简乐指出**漏了主因**：据其长期经验，失锚
 * **多数发生在「移动窗口」时**；而 Windows **纯移动窗口不发 `resize` / `Resized`，
 * 只发 `Moved`**（本项目记忆与 `docs/RELEASE_PROCESS.md` 均已载）⇒ 首版对「移动」
 * **完全无感**，一直在治非主因（首轮真机「开着护栏仍失锚」即由此印证）。
 * 现改为订阅 **Tauri 原生 `onMoved` + `onResized`**（`@tauri-apps/api@2.11.1`
 * 提供，项目已有同族用法），并**保留 DOM `resize` 兜底**（非 Tauri / 测试场景）。
 *
 * ## 验证方式（概率性问题 → 不做人工刻意测试）
 * 该问题**无法按需复现** ⇒ 不再要求人工 A/B，改用**被动探针**留痕
 * （`ime-anchor-probe.ts`，读到 `%APPDATA%\com.solomarkdown\ime-anchor-probe.json`），
 * 日常使用中自然发生时再对账。探针为临时设施，**验证完必须删除**。
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
import { probe } from './ime-anchor-probe';

/** 几何变化（拖动或缩放）连发；等它稳定下来再重锚一次 */
export const IME_ANCHOR_DEBOUNCE_MS = 120;

/**
 * blur 与 focus 之间必须留的间隔。不能是 0：
 * 同一任务内（含 `setTimeout(0)`）的 blur+focus 会被渲染进程合并，浏览器进程侧
 * 看不到焦点转移，TSF 布局就不会重发。
 */
export const IME_ANCHOR_FOCUS_DELAY_MS = 60;

/**
 * ⚠️ 临时 A/B 验证开关 —— **验证完成后必须删除**（见修复档案 §4/阶段 4）。
 * **仅 DEV 生效**（`import.meta.env.DEV`）：正式版一律视为「开关未设」。
 * 用法：DevTools Console 执行
 *   `localStorage.setItem('solo:imeAnchorGuard','off')` → 护栏停用（即时生效，无需刷新）
 *   `localStorage.removeItem('solo:imeAnchorGuard')`   → 护栏恢复
 */
const AB_SWITCH_KEY = 'solo:imeAnchorGuard';

/** 护栏的触发来源（供被动探针对账：是「移动」还是「缩放」触发的） */
export type AnchorTrigger = 'move' | 'resize' | 'dom-resize' | 'composition-end';

function isDisabledBySwitch(): boolean {
  // 仅 DEV 生效：这是验证期的临时开关，绝不能让正式版用户无意间把护栏关掉（M-14）。
  // 验证方式（dev 构建）：DevTools Console 执行
  //   localStorage.setItem('solo:imeAnchorGuard','off')
  if (!import.meta.env.DEV) return false;
  try {
    return window.localStorage.getItem(AB_SWITCH_KEY) === 'off';
  } catch {
    return false;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 默认订阅：**Tauri 原生窗口几何变化（移动 + 缩放）**。
 * 异步建立（`onMoved` / `onResized` 返回 Promise），dispose 时统一退订；
 * 若订阅尚未完成就已 dispose，则在完成回调里立即退订，避免泄漏。
 * 非 Tauri 环境静默跳过。
 */
function subscribeTauriGeometry(onChange: (trigger: AnchorTrigger) => void): () => void {
  let cancelled = false;
  const unsubs: Array<() => void> = [];
  void (async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const offs = [
        await win.onMoved(() => onChange('move')),
        await win.onResized(() => onChange('resize')),
      ];
      if (cancelled) offs.forEach((off) => off());
      else unsubs.push(...offs);
    } catch {
      /* 非 Tauri 环境：忽略 */
    }
  })();
  return () => {
    cancelled = true;
    unsubs.forEach((off) => off());
  };
}

export interface ImeAnchorGuardOptions {
  /** 取当前编辑器 view；懒建期间可能为 null */
  getView: () => EditorView | null;
  /** 默认按平台判定（仅 Windows 生效）；测试可强制 */
  enabled?: boolean;
  debounceMs?: number;
  focusDelayMs?: number;
  /** DOM resize 监听目标（默认真实 window；测试传 happy-dom window） */
  target?: Window;
  /**
   * 订阅「原生窗口几何变化」的回调注入点。
   * 默认接 Tauri 的 `onMoved` / `onResized`；测试可注入假订阅以验证触发链路，
   * 或传 `() => () => {}` 关闭。
   */
  subscribeGeometry?: (onChange: (trigger: AnchorTrigger) => void) => () => void;
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
 * 装上「窗口移动 / 缩放后重锚输入焦点」护栏，返回卸载函数。
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
  // 供探针对账：本次重锚是哪种几何变化引起的
  let lastTrigger: AnchorTrigger = 'resize';

  const reanchor = (): void => {
    if (isDisabledBySwitch()) {
      probe('reanchor', { action: 'skip', reason: 'ab-off', trigger: lastTrigger });
      return;
    }
    const view = opts.getView();
    if (!view || view.isDestroyed) {
      probe('reanchor', { action: 'skip', reason: 'no-view', trigger: lastTrigger });
      return;
    }
    const el = view.dom as HTMLElement;
    // 焦点不在编辑器 → 空操作（护的是输入焦点，别的地方不碰）
    if (w.document.activeElement !== el) {
      probe('reanchor', { action: 'skip', reason: 'not-focused', trigger: lastTrigger });
      return;
    }
    // 组字中 → 不打断，等组字结束再补
    if (isFrozen(view)) {
      pending = true;
      probe('reanchor', { action: 'pending', reason: 'composing', trigger: lastTrigger });
      return;
    }
    const scrolls = saveScroll(el);
    el.blur();
    probe('reanchor', { action: 'blur+focus', trigger: lastTrigger });
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

  const schedule = (trigger: AnchorTrigger): void => {
    lastTrigger = trigger;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      reanchor();
    }, debounceMs);
  };

  const onDomResize = (): void => schedule('dom-resize');

  const onCompositionStart = (): void => probe('compositionstart');

  const onCompositionEnd = (): void => {
    if (!pending) return;
    pending = false;
    probe('compositionend', { note: 'pending-consumed' });
    schedule('composition-end');
  };

  w.addEventListener('resize', onDomResize);
  w.addEventListener('compositionstart', onCompositionStart, true);
  w.addEventListener('compositionend', onCompositionEnd, true);

  // 主触发面：Tauri 原生窗口移动 + 缩放（移动不发 DOM resize，必须走这条）
  const subscribe =
    opts.subscribeGeometry ?? (isTauriRuntime() ? subscribeTauriGeometry : () => () => {});
  const unsubscribeGeometry = subscribe(schedule);

  return () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    if (focusTimer !== undefined) clearTimeout(focusTimer);
    w.removeEventListener('resize', onDomResize);
    w.removeEventListener('compositionstart', onCompositionStart, true);
    w.removeEventListener('compositionend', onCompositionEnd, true);
    unsubscribeGeometry();
  };
}
