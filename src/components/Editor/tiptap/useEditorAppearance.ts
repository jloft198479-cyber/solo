import { onBeforeUnmount, onMounted, type Ref, watch } from 'vue';

import { useSettingsStore } from '../../../stores/settings';
import { buildFontStack } from '../../../utils/fontStack';
import { ensureFontLoaded } from '../../../services/fontLoader';
import { reinitializeMermaidTheme } from './extensions/mermaid-block';
import { refreshParagraphFocus } from './extensions/paragraph-focus';
import type { Editor as TiptapEditor } from '@tiptap/vue-3';
import type { EditorView } from '@tiptap/pm/view';

const hljsCssId = 'hljs-theme';
const hljsLightUrl = new URL('highlight.js/styles/github.css', import.meta.url).href;
const hljsDarkUrl = new URL('highlight.js/styles/github-dark.css', import.meta.url).href;

function syncHljsTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  let el = document.getElementById(hljsCssId) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.id = hljsCssId;
    el.rel = 'stylesheet';
    document.head.appendChild(el);
  }
  el.href = isDark ? hljsDarkUrl : hljsLightUrl;

  // 同步 Mermaid 主题
  reinitializeMermaidTheme().catch(() => {});
}

function applyFontFamily(fontFamily: string) {
  // 立即应用 CSS（浏览器先用 fallback 渲染，保证布局不闪）
  document.documentElement.style.setProperty('--font-text', buildFontStack(fontFamily));
  // 按需加载字体（非阻塞，加载完成后浏览器自动重绘）
  ensureFontLoaded(fontFamily);
}

export function useEditorAppearance(editorRef?: Ref<TiptapEditor | null>) {
  const settingsStore = useSettingsStore();

  // 主题切换时 applyTheme 会依次触发多次 class 变化（theme-transitioning / dark），
  // 用 RAF 合流到一帧，避免重复执行 syncHljsTheme + refreshParagraphFocus
  let _themeRafId: number | null = null;
  const themeObserver = new MutationObserver(() => {
    if (_themeRafId != null) return;
    _themeRafId = requestAnimationFrame(() => {
      _themeRafId = null;
      syncHljsTheme();
      const view: EditorView | undefined = editorRef?.value?.view;
      if (view) refreshParagraphFocus(view);
    });
  });

  watch(() => settingsStore.settings.fontFamily, applyFontFamily, { immediate: true });

  // 字号：null 表示使用主题默认值，不覆盖 CSS 变量
  watch(
    () => settingsStore.settings.fontSize,
    (fontSize) => {
      if (fontSize != null) {
        document.documentElement.style.setProperty('--mk-font-size', `${fontSize}px`);
      } else {
        document.documentElement.style.removeProperty('--mk-font-size');
      }
    },
    { immediate: true },
  );

  // 行高：null 表示使用主题默认值，不覆盖 CSS 变量
  watch(
    () => settingsStore.settings.lineHeight,
    (lineHeight) => {
      if (lineHeight != null) {
        document.documentElement.style.setProperty('--mk-line-height', String(lineHeight));
      } else {
        document.documentElement.style.removeProperty('--mk-line-height');
      }
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
    if (_themeRafId != null) {
      cancelAnimationFrame(_themeRafId);
      _themeRafId = null;
    }
  });
}
