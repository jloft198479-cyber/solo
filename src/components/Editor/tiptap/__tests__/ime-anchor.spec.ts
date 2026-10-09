// @vitest-environment happy-dom
/**
 * IME 候选窗失锚「重锚」护栏的契约锁。
 *
 * 该模块是 Windows/WebView2 缩放失锚的唯一对症手段（blur → 等间隔 → focus）。
 * 本文件锁住四类契约：① 只有 Windows 才装；② 防抖 + 时序（blur 与 focus 必须隔开）；
 * ③ 组字中不打断、组字后补做；④ 退化安全（无 view / 无焦点 / A/B 开关关 → 空操作）。
 *
 * 详见 docs/IME-ANCHOR-GUARD-2026-10-09.md。
 */
import type { EditorView } from '@tiptap/pm/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IME_ANCHOR_DEBOUNCE_MS,
  IME_ANCHOR_FOCUS_DELAY_MS,
  installImeAnchorGuard,
} from '../ime-anchor';

const AB_SWITCH_KEY = 'solo:imeAnchorGuard';

/** 只需 composing / dom / isDestroyed / focus 的假 view —— 本模块不碰其它成员。
 *  dom 默认**不入 DOM**，由各用例自行 append / focus。 */
function fakeView(composing = false): { view: EditorView; dom: HTMLElement } {
  const dom = document.createElement('div');
  dom.setAttribute('contenteditable', 'true');
  const view = {
    composing,
    isDestroyed: false,
    dom,
    focus: vi.fn(),
  } as unknown as EditorView;
  return { view, dom };
}

describe('installImeAnchorGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  it('非 Windows（enabled=false）→ 整段空操作，不装任何监听', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const dispose = installImeAnchorGuard({ getView: () => null, enabled: false });
    expect(add).not.toHaveBeenCalled();
    dispose();
    add.mockRestore();
  });

  it('默认间隔不为 0（0 会被渲染进程合并，等于没转移焦点）', () => {
    expect(IME_ANCHOR_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(IME_ANCHOR_FOCUS_DELAY_MS).toBeGreaterThan(0);
  });

  it('缩放稳定后：blur → 等 focusDelay → focus，两步拉开间隔', () => {
    const { view, dom } = fakeView();
    document.body.appendChild(dom);
    dom.focus();
    expect(document.activeElement).toBe(dom);
    const blur = vi.spyOn(dom, 'blur');

    const dispose = installImeAnchorGuard({
      getView: () => view,
      enabled: true,
      debounceMs: 50,
      focusDelayMs: 40,
      target: window,
    });
    window.dispatchEvent(new Event('resize'));

    // 未到防抖时间：不动手（避免拖拽中途反复抢焦点）
    vi.advanceTimersByTime(49);
    expect(blur).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(blur).toHaveBeenCalledTimes(1);
    // blur 与 focus 之间必须留间隔：贴在一起会被渲染进程合并
    expect(view.focus).not.toHaveBeenCalled();

    vi.advanceTimersByTime(39);
    expect(view.focus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(view.focus).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('连续 resize 只重锚一次（防抖）', () => {
    const { view, dom } = fakeView();
    document.body.appendChild(dom);
    dom.focus();
    const blur = vi.spyOn(dom, 'blur');

    const dispose = installImeAnchorGuard({
      getView: () => view,
      enabled: true,
      debounceMs: 50,
      focusDelayMs: 40,
      target: window,
    });
    for (let i = 0; i < 8; i++) window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(200);
    expect(blur).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('焦点不在编辑器 → 空操作', () => {
    const { view, dom } = fakeView();
    document.body.appendChild(dom);
    // 不 focus：activeElement 是 body
    const blur = vi.spyOn(dom, 'blur');

    const dispose = installImeAnchorGuard({
      getView: () => view,
      enabled: true,
      debounceMs: 50,
      focusDelayMs: 40,
      target: window,
    });
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(200);
    expect(blur).not.toHaveBeenCalled();

    dispose();
  });

  it('getView 返回 null（编辑器未建 / 已销毁）→ 空操作', () => {
    const dispose = installImeAnchorGuard({ getView: () => null, enabled: true, target: window });
    expect(() => {
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(200);
    }).not.toThrow();
    dispose();
  });

  it('组字中不打断（不 blur），组字结束后再补做', () => {
    const { view, dom } = fakeView(true); // 正在组字
    document.body.appendChild(dom);
    dom.focus();
    const blur = vi.spyOn(dom, 'blur');

    const dispose = installImeAnchorGuard({
      getView: () => view,
      enabled: true,
      debounceMs: 50,
      focusDelayMs: 40,
      target: window,
    });
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(50);
    expect(blur).not.toHaveBeenCalled(); // 组字中不打断

    // 组字结束 → 补做
    view.composing = false;
    window.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    vi.advanceTimersByTime(50);
    expect(blur).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('组字结束后未收到 resize 时，pending 不误触发', () => {
    const { view, dom } = fakeView();
    document.body.appendChild(dom);
    dom.focus();
    const blur = vi.spyOn(dom, 'blur');

    const dispose = installImeAnchorGuard({
      getView: () => view,
      enabled: true,
      debounceMs: 50,
      focusDelayMs: 40,
      target: window,
    });
    // 没有 resize，直接来一次 compositionend：不应有任何动作
    window.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(blur).not.toHaveBeenCalled();

    dispose();
  });

  it('重锚后还原编辑容器的滚动位置', () => {
    const { view, dom } = fakeView();
    const scroller = document.createElement('div');
    scroller.appendChild(dom);
    document.body.appendChild(scroller);
    dom.focus();
    Object.defineProperty(scroller, 'scrollTop', { value: 120, writable: true });

    const dispose = installImeAnchorGuard({
      getView: () => view,
      enabled: true,
      debounceMs: 10,
      focusDelayMs: 10,
      target: window,
    });
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(60);
    expect(scroller.scrollTop).toBe(120);

    dispose();
  });

  it('临时 A/B 开关 off → 不动作（验证用，非产品功能）', () => {
    const { view, dom } = fakeView();
    document.body.appendChild(dom);
    dom.focus();
    const blur = vi.spyOn(dom, 'blur');
    window.localStorage.setItem(AB_SWITCH_KEY, 'off');

    const dispose = installImeAnchorGuard({
      getView: () => view,
      enabled: true,
      debounceMs: 50,
      focusDelayMs: 40,
      target: window,
    });
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(200);
    expect(blur).not.toHaveBeenCalled();

    dispose();
  });

  it('卸载后不再响应 resize', () => {
    const { view, dom } = fakeView();
    document.body.appendChild(dom);
    dom.focus();
    const blur = vi.spyOn(dom, 'blur');

    const dispose = installImeAnchorGuard({
      getView: () => view,
      enabled: true,
      debounceMs: 50,
      focusDelayMs: 40,
      target: window,
    });
    dispose();
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(200);
    expect(blur).not.toHaveBeenCalled();
  });
});
