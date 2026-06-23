import { onBeforeUnmount, onMounted, watch } from 'vue';

import { useSettingsStore } from '../../../stores/settings';
import { buildFontStack } from '../../../utils/fontStack';
import { ensureFontLoaded } from '../../../services/fontLoader';
import { reinitializeMermaidTheme } from './extensions/mermaid-block';

const customCssId = 'marklight-custom-editor-css';
const hljsDarkCssId = 'hljs-dark-theme';

function injectCustomCSS(css: string) {
  let el = document.getElementById(customCssId) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = customCssId;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

function syncHljsTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  let el = document.getElementById(hljsDarkCssId) as HTMLLinkElement | null;
  if (isDark) {
    if (!el) {
      el = document.createElement('link');
      el.id = hljsDarkCssId;
      el.rel = 'stylesheet';
      el.href = new URL('highlight.js/styles/github-dark.css', import.meta.url).href;
      document.head.appendChild(el);
    }
  } else {
    el?.remove();
  }

  // 同步 Mermaid 主题
  reinitializeMermaidTheme().catch(() => {});
}

function applyFontFamily(fontFamily: string) {
  // 立即应用 CSS（浏览器先用 fallback 渲染，保证布局不闪）
  document.documentElement.style.setProperty('--font-text', buildFontStack(fontFamily));
  // 按需加载字体（非阻塞，加载完成后浏览器自动重绘）
  ensureFontLoaded(fontFamily);
}

export function useEditorAppearance() {
  const settingsStore = useSettingsStore();
  const themeObserver = new MutationObserver(syncHljsTheme);

  watch(() => settingsStore.settings.customEditorCSS, injectCustomCSS, { immediate: true });
  watch(() => settingsStore.settings.fontFamily, applyFontFamily, { immediate: true });

  // 字号：settings 优先级高于主题默认值，主题切换时重新覆盖
  watch(
    () => [settingsStore.settings.fontSize, settingsStore.settings.activeThemeId] as const,
    ([fontSize]) => {
      document.documentElement.style.setProperty('--mk-font-size', `${fontSize}px`);
    },
    { immediate: true },
  );

  // 行高：settings 优先级高于主题默认值，主题切换时重新覆盖
  watch(
    () => [settingsStore.settings.lineHeight, settingsStore.settings.activeThemeId] as const,
    ([lineHeight]) => {
      document.documentElement.style.setProperty('--mk-line-height', String(lineHeight));
    },
    { immediate: true },
  );

  onMounted(() => {
    syncHljsTheme();
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  });

  onBeforeUnmount(() => {
    themeObserver.disconnect();
  });
}
