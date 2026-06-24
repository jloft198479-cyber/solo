use crate::models::AppOpenPathsPayload;
use tauri::{AppHandle, Emitter, Runtime, WebviewWindow};

pub const MENU_EVENT: &str = "menu-event";
pub const WINDOW_CLOSE_REQUESTED_EVENT: &str = "window-close-requested";
pub const APP_OPEN_PATHS_EVENT: &str = "app-open-paths";

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

pub fn emit_app_open_paths<R: Runtime>(app: &AppHandle<R>, payload: AppOpenPathsPayload) {
    if let Err(e) = app.emit(APP_OPEN_PATHS_EVENT, payload) {
        eprintln!("[events] emit app-open-paths 失败: {e}");
    }
}
