import { invoke } from '@tauri-apps/api/core';

/**
 * 从系统剪贴板读取 HTML 富文本。
 *
 * 为什么需要它：WebView2 的粘贴事件中，`event.clipboardData.getData('text/html')`
 * 常常为空（外部应用 / 跨源复制尤其如此）——但系统剪贴板里（网页 / Word / Notion /
 * 微信复制的内容）确实带着 HTML。这是桌面端保住格式最可靠的来源，远比
 * `navigator.clipboard.read()`（webview 的 secure-context 限制多、经常拿不到）稳妥。
 *
 * 实际读取由 Rust 命令 `read_clipboard_html`（arboard）完成，绕开 webview 的剪贴板限制。
 * 失败（无权限 / 剪贴板无 HTML / 非桌面环境）一律返回 null，调用方自行降级。
 */
export async function readClipboardHtml(): Promise<string | null> {
  try {
    const html = await invoke<string | null>('read_clipboard_html');
    return html && html.trim() ? html : null;
  } catch {
    return null;
  }
}
