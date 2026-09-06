/**
 * 链接 Ctrl/Cmd+Click 跳转扩展
 *
 * 行业共识（Typora/Obsidian/iA Writer）：编辑器场景下，单击留给光标定位/编辑，
 * Ctrl/Cmd+Click 触发跳转。Link 扩展默认 openOnClick: false 关闭了单击跳转，
 * 此扩展补上 Ctrl/Cmd+Click 跳转入口。
 *
 * 点击判定：handleDOMEvents mousedown 记录起点、click 自判位移（阈值 10px），
 * 不依赖 PM handleClick 的 4px 门控——轻微手抖/触摸板拖动不再被 PM 判为拖拽而
 * 静默失效（KNOWN-ISSUES #10「时灵时不灵」的根因之一）。
 *
 * 光标语义：默认 text（与正文一致，单击只定位光标），按住 Ctrl/Cmd 时才 pointer
 * （.ctrl-held 类由本扩展切换）——指针出现即代表「现在点会跳转」，消除
 * 「hover 显示可点、单击却无反应」的误导。
 *
 * 白名单外不再静默：file:///#锚点/相对路径点击时提示仅支持 http/https/mailto。
 *
 * 退化安全：openUrl 失败时回退到 window.open（Tauri webview 里 window.open
 * 不可靠，但比静默失败好）；协议白名单防 javascript: 等危险协议。
 */
import { Extension } from '@tiptap/vue-3';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { openUrl } from '@tauri-apps/plugin-opener';
import { message } from '../../../../services/tauri/dialog';

const linkOpenPluginKey = new PluginKey('linkOpen');

/** 允许的 URL 协议白名单，防止 javascript: 等危险协议 */
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:'];

/** mousedown → click 位移超过该值（px）视为拖拽/手抖，不触发跳转 */
const DRAG_THRESHOLD_PX = 10;

/** 待配对的 Ctrl/Cmd+mousedown 起点；每次 mousedown 重置（无超时必要：
 *  任何后续 mousedown 都会先重写此状态，不存在跨手势误配对） */
let pendingCtrlClick: { x: number; y: number } | null = null;

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

function isModifierClick(event: MouseEvent): boolean {
  return event.button === 0 && (event.ctrlKey || event.metaKey);
}

function findAnchor(event: Event): HTMLAnchorElement | null {
  const target = event.target as Element | null;
  return target?.closest('a') ?? null;
}

export const LinkOpen = Extension.create({
  name: 'linkOpen',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: linkOpenPluginKey,
        view(editorView) {
          // Ctrl/Cmd 按住状态 → 编辑器根挂 .ctrl-held，CSS 据此切换链接光标。
          // keydown/keyup 都读实时修饰键状态，无需分辨具体是哪个键。
          const root = editorView.dom;
          const setHeld = (held: boolean) => {
            root.classList.toggle('ctrl-held', held);
          };
          const onKey = (event: KeyboardEvent) => setHeld(event.ctrlKey || event.metaKey);
          const onBlur = () => setHeld(false);
          document.addEventListener('keydown', onKey, true);
          document.addEventListener('keyup', onKey, true);
          window.addEventListener('blur', onBlur);
          return {
            destroy() {
              document.removeEventListener('keydown', onKey, true);
              document.removeEventListener('keyup', onKey, true);
              window.removeEventListener('blur', onBlur);
              root.classList.remove('ctrl-held');
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousedown(_view, event) {
              const mouseEvent = event as MouseEvent;
              pendingCtrlClick =
                isModifierClick(mouseEvent) && findAnchor(mouseEvent)
                  ? { x: mouseEvent.clientX, y: mouseEvent.clientY }
                  : null;
              return false;
            },
            click(_view, event) {
              const mouseEvent = event as MouseEvent;
              if (!isModifierClick(mouseEvent)) return false;

              const start = pendingCtrlClick;
              pendingCtrlClick = null;
              if (!start) return false;

              // 位移超阈值 → 拖拽/手抖，不触发
              const dx = Math.abs(mouseEvent.clientX - start.x);
              const dy = Math.abs(mouseEvent.clientY - start.y);
              if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) return false;

              const anchor = findAnchor(mouseEvent);
              if (!anchor) return false;

              // 用 getAttribute 取原始 href（避免 webview 规范化成 asset URL）
              const href = anchor.getAttribute('href');
              if (!href) return false;

              if (!isAllowedHref(href)) {
                void message('仅支持 http/https/mailto 链接的外部跳转。', {
                  title: '链接',
                  kind: 'info',
                });
                return true;
              }

              void openLink(href);
              return true;
            },
          },
        },
      }),
    ];
  },
});
