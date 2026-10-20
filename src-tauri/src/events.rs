use tauri::{Emitter, Runtime, WebviewWindow};

pub const MENU_EVENT: &str = "menu-event";
pub const WINDOW_CLOSE_REQUESTED_EVENT: &str = "window-close-requested";

/// ⚠️ **这里只能 `emit_to`，绝不能 `window.emit`。**
///
/// Tauri 2 的 `Emitter::emit` 是**全局广播**：trait 默认实现直接调 `manager.emit(...)`，
/// 遍历所有 webview 下发（tauri 2.11 `src/lib.rs` `Emitter::emit` →
/// `manager/mod.rs` `AppManager::emit`）。`window.emit(...)` 只是「借 window 句柄调全局方法」，
/// 名字像定向、行为是全广播。
///
/// 而前端监听用的是 `getCurrentWindow().listen(...)`，**按窗口注册**（target = 本窗口 label）。
/// 两边语义错配 ⇒ 发给 B 的事件，A 也会收到并执行。
///
/// **已发生的事故（2026-10-20）**：A 文档点互链另开 B 窗口，关掉 B，A 跟着一起关
/// —— 因为 B 的 close-requested 被广播给了 A，A 把它当自己的关窗请求跑了关闭链。
/// 同一缺陷也污染菜单事件（Ctrl+S / Ctrl+N 会同时作用于所有窗口），只是此前几乎只用单窗口，
/// 一窗一文档 + 互链开窗把这条潜伏了三个版本的错配顶到台面上。
///
/// 定向能力由 `emit_to(window.label(), ...)` 提供：`&str` → `EventTarget::AnyLabel`，
/// 与前端注册的 `{ kind: 'Window', label }` 按 label 精确匹配（tauri `emit_to` 的
/// `filter_target`）。回归锁：`src/__tests__/event-dispatch-target-lock.spec.ts`。
fn emit_to_window<R: Runtime, S: serde::Serialize + Clone>(
    window: &WebviewWindow<R>,
    event: &str,
    payload: S,
) -> tauri::Result<()> {
    window.emit_to(window.label(), event, payload)
}

/// 将菜单事件定向发送到指定窗口，而非全局广播。
/// 多窗口场景下防止"保存/新建"等操作被所有窗口同时执行。
pub fn emit_menu_event<R: Runtime>(window: &WebviewWindow<R>, menu_id: &str) {
    if let Err(e) = emit_to_window(window, MENU_EVENT, menu_id) {
        eprintln!("[events] emit menu-event 失败: {e}");
    }
}

/// 关闭请求只送给**被关的那一扇窗**。
/// 送给全部窗口的后果见文件头注释：关一扇，全关。
pub fn emit_window_close_requested<R: Runtime>(window: &WebviewWindow<R>) {
    if let Err(e) = emit_to_window(window, WINDOW_CLOSE_REQUESTED_EVENT, ()) {
        eprintln!("[events] emit window-close-requested 失败: {e}");
    }
}
