use tauri::{AppHandle, Emitter, Runtime, WebviewWindow};

pub const MENU_EVENT: &str = "menu-event";
pub const WINDOW_CLOSE_REQUESTED_EVENT: &str = "window-close-requested";

pub fn emit_menu_event<R: Runtime>(app: &AppHandle<R>, menu_id: String) {
    if let Err(e) = app.emit(MENU_EVENT, menu_id) {
        eprintln!("[events] emit menu-event 失败: {e}");
    }
}

pub fn emit_window_close_requested<R: Runtime>(window: &WebviewWindow<R>) {
    if let Err(e) = window.emit(WINDOW_CLOSE_REQUESTED_EVENT, ()) {
        eprintln!("[events] emit window-close-requested 失败: {e}");
    }
}
