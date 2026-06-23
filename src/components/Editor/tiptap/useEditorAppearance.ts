import { onBeforeUnmount, onMounted, watch } from 'vue';

import { useSettingsStore } from '../../../stores/settings';
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

/** 根据用户选择的字体生成完整的 font-family 栈 */
function buildFontStack(primary: string): string {
  // 衬线 fallback：优先中文字体，再西文衬线
  const serifFallback = "'Source Han Serif SC', 'STSong', 'Songti SC', 'SimSun', Georgia, 'Times New Roman', serif";
  // 无衬线 fallback：优先中文字体，再西文无衬线
  const sansFallback = "'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'STHeiti', system-ui, -apple-system, 'Segoe UI', sans-serif";
  // 仿宋 fallback
  const fangsongFallback = "'FangSong', 'STFangsong', serif";
  // 明朝 fallback
  const minchoFallback = "'Huiwen-mincho', 'Source Han Serif SC', 'STSong', Georgia, 'Times New Roman', serif";

  // 无衬线字体
  if (primary === 'Microsoft YaHei UI') {
    return `'${primary}', ${sansFallback}`;
  }
  // system-ui 是 CSS 关键字，不能加引号
  if (primary === 'system-ui') {
    return `system-ui, ${sansFallback}`;
  }
  // 仿宋
  if (primary === 'Zhuque Fangsong') {
    return `'${primary}', ${fangsongFallback}`;
  }
  // 明朝
  if (primary === 'Huiwen-mincho') {
    return `'${primary}', ${minchoFallback}`;
  }
  // 手写/圆体 → 无衬线兜底
  if (primary === 'Xiaolai SC') {
    return `'${primary}', ${sansFallback}`;
  }
  // 默认：思源宋体等衬线字体
  return `'${primary}', ${serifFallback}`;
}

function applyFontFamily(fontFamily: string) {
  document.documentElement.style.setProperty('--font-text', buildFontStack(fontFamily));
}

export function useEditorAppearance() {
  const settingsStore = useSettingsStore();
  const themeObserver = new MutationObserver(syncHljsTheme);

  watch(() => settingsStore.settings.customEditorCSS, injectCustomCSS, { immediate: true });
  watch(() => settingsStore.settings.fontFamily, applyFontFamily, { immediate: true });

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
