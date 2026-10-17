// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 子面板挂载时会查字体缓存（Tauri IPC）——测试环境没有 Tauri，统一返回"无缓存"
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async () => null,
  convertFileSrc: (p: string) => p,
}));

import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import SettingsModal from '../SettingsModal.vue';
import { useSettingsStore } from '../../../stores/settings';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** 与组件实现同口径的可聚焦选择器（只在测试里用来定位边界元素） */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let app: App | null = null;
let host: HTMLElement | null = null;

function mountModal() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useSettingsStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  app = createApp(defineComponent({ render: () => h(SettingsModal) }));
  app.use(pinia);
  app.mount(host);
  return store;
}

async function openModal() {
  const store = mountModal();
  store.openModal();
  await nextTick();
  await nextTick();
  return store;
}

function dialogEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.settings-modal__dialog');
  if (!el) throw new Error('settings dialog not mounted');
  return el;
}

function focusables(): HTMLElement[] {
  return Array.from(dialogEl().querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));

afterEach(() => {
  app?.unmount();
  app = null;
  host?.remove();
  host = null;
  document.body.innerHTML = '';
});

describe('设置弹窗 · 静态契约（A1 / B2）', () => {
  it('层级刻度单调递增，模态高于 chrome，遮罩用 var(--z-modal)', () => {
    const css = read('../../../assets/styles/main.css');
    const token = (name: string) => Number(css.match(new RegExp(`--${name}:\\s*(\\d+)`))?.[1]);

    // 整条刻度：同含义复用同一档，不同含义绝不同号（B2 全面归位后的恒定契约）
    const ladder = [
      'z-content',
      'z-raised',
      'z-floating',
      'z-chrome',
      'z-chrome-hot',
      'z-editor-popup',
      'z-hint',
      'z-context-menu',
      'z-modal',
      'z-command',
      'z-lightbox',
      'z-window-edge',
      'z-unsaved',
    ];
    const values = ladder.map(token);
    expect(values.every(Number.isFinite), '刻度里有未定义的档位').toBe(true);
    for (let i = 1; i < values.length; i++) {
      expect(values[i], `${ladder[i]} 必须高于 ${ladder[i - 1]}`).toBeGreaterThan(values[i - 1]);
    }
    expect(token('z-chrome')).toBe(200);
    expect(token('z-modal')).toBeGreaterThan(token('z-chrome'));

    const modal = read('../SettingsModal.vue');
    expect(modal).toMatch(/\.settings-modal-overlay\s*\{[^}]*z-index:\s*var\(--z-modal\)/);
    // 不允许退回 Tailwind 默认档位（z-50 曾让它被标题栏压住）
    expect(modal).not.toMatch(/\bz-50\b/);
  });

  it('具备 dialog 语义：role / aria-modal / aria-labelledby 指向标题', () => {
    const modal = read('../SettingsModal.vue');
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain('aria-labelledby="settings-modal-title"');
    expect(modal).toMatch(/<h2 id="settings-modal-title"/);
  });

  it('Esc 监听不挂在遮罩上，改为 document 捕获阶段（不依赖焦点）', () => {
    const modal = read('../SettingsModal.vue');
    expect(modal).not.toContain('@keydown="onKeyDown"');
    expect(modal).toMatch(/document\.addEventListener\('keydown', onKeyDown, true\)/);
    expect(modal).toMatch(/document\.removeEventListener\('keydown', onKeyDown, true\)/);
  });
});

describe('设置弹窗 · 行为', () => {
  it('打开后焦点进入对话框（原实现的 Esc 失效就是因为从未 focus）', async () => {
    await openModal();
    expect(dialogEl().contains(document.activeElement)).toBe(true);
  });

  it('Esc 关闭弹窗（焦点在容器上，不依赖遮罩收到事件）', async () => {
    const store = await openModal();
    press('Escape');
    expect(store.isModalOpen).toBe(false);
  });

  it('焦点在更上层浮层时不接管（命令面板等），Esc 留给它', async () => {
    const store = await openModal();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    press('Escape');
    expect(store.isModalOpen).toBe(true);
  });

  it('快捷键录制中 Esc 不关弹窗（那里 Esc = 取消录制）', async () => {
    const store = await openModal();
    const capture = document.createElement('input');
    capture.setAttribute('data-shortcut-capture', 'true');
    dialogEl().appendChild(capture);
    capture.focus();
    capture.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(store.isModalOpen).toBe(true);
  });

  it('Tab 焦点陷阱：末个 Tab 回首个、首个 Shift+Tab 到末个', async () => {
    await openModal();
    const items = focusables();
    expect(items.length).toBeGreaterThan(2);

    const first = items[0];
    const last = items[items.length - 1];

    // 断言"焦点真的被移动"而不是"还在对话框里"——后者在陷阱失效时也是绿的（假绿）
    last.focus();
    press('Tab');
    expect(document.activeElement).toBe(first);

    first.focus();
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('关闭后焦点归还触发元素', async () => {
    const store = mountModal();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    store.openModal();
    await nextTick();
    await nextTick();
    store.closeModal();
    await nextTick();

    expect(document.activeElement).toBe(trigger);
  });
});
