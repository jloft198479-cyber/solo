import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';

import { useSettingsStore } from '../../../stores/settings';
import { buildFontStack } from '../../../utils/fontStack';
import { ensureFontLoaded } from '../../../services/fontLoader';
import { triggerContentCrossfade } from '../../../themes/manager';
import { reinitializeMermaidTheme } from './extensions/mermaid-block';
import type { Editor as TiptapEditor } from '@tiptap/vue-3';

// 设计体系规则：代码语法高亮不再加载 highlight.js 外部配色
// （github / github-dark），颜色统一由 editor.css 的 .hljs-* → 主题 token
// 映射提供，切主题时随主题整体变化。此处仅负责 Mermaid 主题同步重渲。
function syncMermaidTheme() {
  reinitializeMermaidTheme().catch(() => {});
}

function applyFontFamily(fontFamily: string) {
  // 立即应用 CSS（浏览器先用 fallback 渲染，保证布局不闪）
  document.documentElement.style.setProperty('--font-text', buildFontStack(fontFamily));
  // 按需加载字体（非阻塞，加载完成后浏览器自动重绘）
  ensureFontLoaded(fontFamily);
  // 字体切换 crossfade：抹平字体到位时的「内容闪一下」
  triggerContentCrossfade();
}

export function useEditorAppearance(_editorRef?: Ref<TiptapEditor | null>) {
  const settingsStore = useSettingsStore();

  // 主题切换时 applyTheme 会依次触发多次 class 变化（theme-transitioning / dark），
  // 用 RAF 合流到一帧，避免重复执行 syncMermaidTheme + refreshParagraphFocus
  // 注：主题切换不改变 focus mode 装饰内容（active/dimmed class 不随主题变化），
  // 所以不需要 refreshParagraphFocus——跳过它省掉一次全量装饰重建（大文档下开销）。
  let _themeRafId: number | null = null;
  const themeObserver = new MutationObserver(() => {
    if (_themeRafId != null) return;
    _themeRafId = requestAnimationFrame(() => {
      _themeRafId = null;
      // 只同步 Mermaid 主题色（SVG 颜色在渲染时固化，必须重渲）
      syncMermaidTheme();
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
    syncMermaidTheme();
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
