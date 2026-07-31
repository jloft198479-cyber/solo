/**
 * 链接 Ctrl/Cmd+Click 跳转扩展
 *
 * 行业共识（Typora/Obsidian/iA Writer）：编辑器场景下，单击留给光标定位/编辑，
 * Ctrl/Cmd+Click 触发跳转。Link 扩展默认 openOnClick: false 关闭了单击跳转，
 * 此扩展补上 Ctrl/Cmd+Click 跳转入口。
 *
 * 实现：ProseMirror handleClick 插件 + Tauri openUrl（系统浏览器打开）。
 * Tauri webview 里 window.open 不可靠（会被导航拦截或在 webview 内打开），
 * 必须用 @tauri-apps/plugin-opener 的 openUrl 调用系统浏览器。
 *
 * 退化安全：openUrl 失败时回退到 window.open；同时校验协议白名单，
 * 防止 javascript: 等危险协议。
 */
import { Extension } from '@tiptap/vue-3';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { openUrl } from '@tauri-apps/plugin-opener';

const linkOpenPluginKey = new PluginKey('linkOpen');

/** 允许的 URL 协议白名单，防止 javascript: 等危险协议 */
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:'];

function isAllowedHref(href: string | null): boolean {
  if (!href) return false;
  try {
    const url = new URL(href);
    return ALLOWED_PROTOCOLS.includes(url.protocol);
  } catch {
    // 相对路径或无效 URL，不允许跳转（编辑器内的相对路径无外部跳转意义）
    return false;
  }
}

async function openLink(href: string) {
  try {
    await openUrl(href);
  } catch {
    // 退化兜底：openUrl 失败时回退到 window.open（Tauri 里不可靠，但比静默失败好）
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

export const LinkOpen = Extension.create({
  name: 'linkOpen',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: linkOpenPluginKey,
        props: {
          handleClick(_view, _pos, event) {
            // 仅响应 Ctrl/Cmd + 左键
            const mouseEvent = event as MouseEvent;
            if (mouseEvent.button !== 0) return false;
            if (!(mouseEvent.ctrlKey || mouseEvent.metaKey)) return false;

            // 从事件目标向上查找 <a> 元素
            const target = mouseEvent.target as Element | null;
            const anchor = target?.closest('a');
            if (!anchor) return false;

            // 用 getAttribute 取原始 href（避免 webview 规范化成 asset URL）
            const href = anchor.getAttribute('href');
            if (!href || !isAllowedHref(href)) return false;

            void openLink(href);
            return true;
          },
        },
      }),
    ];
  },
});
