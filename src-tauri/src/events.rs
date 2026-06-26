use tauri::{Emitter, Runtime, WebviewWindow};

pub const MENU_EVENT: &str = "menu-event";
pub const WINDOW_CLOSE_REQUESTED_EVENT: &str = "window-close-requested";

/// 将菜单事件定向发送到指定窗口，而非全局广播。
/// 多窗口场景下防止"保存/新建"等操作被所有窗口同时执行。
pub fn emit_menu_event<R: Runtime>(window: &WebviewWindow<R>, menu_id: &str) {
    if let Err(e) = window.emit(MENU_EVENT, menu_id) {
        eprintln!("[events] emit menu-event 失败: {e}");
    }
}

pub fn emit_window_close_requested<R: Runtime>(window: &WebviewWindow<R>) {
    if let Err(e) = window.emit(WINDOW_CLOSE_REQUESTED_EVENT, ()) {
        eprintln!("[events] emit window-close-requested 失败: {e}");
    }
}
