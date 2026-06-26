use crate::error::AppError;
use crate::events::emit_window_close_requested;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSColor, NSWindow};
use std::cell::Cell;
use tauri::{Emitter, WebviewWindow};

#[cfg(target_os = "windows")]
use webview2_com::{
    TrySuspendCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_3, ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    },
};
#[cfg(target_os = "windows")]
use windows_core::Interface;

// ── 内存优化：MemoryUsageTargetLevel ─────────────────────────

/// 设置 WebView2 MemoryUsageTargetLevel。
/// Low 模式允许 OS 将 renderer 物理内存换出，Normal 恢复。
#[cfg(target_os = "windows")]
fn set_memory_target(window: &WebviewWindow, level: COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL) {
    use tauri::webview::PlatformWebview;
    let _ = window.with_webview(move |wv: PlatformWebview| {
        let controller = wv.controller();
        unsafe {
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                    let _ = core19.SetMemoryUsageTargetLevel(level);
                }
            }
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn set_memory_target(_window: &WebviewWindow, _level: ()) {}

// ── 内存优化：最小化时 TrySuspend ────────────────────────────

/// 窗口最小化时暂停 WebView2 renderer 进程，释放物理内存。
/// 恢复时 WebView2 自动 Resume（IsVisible=true 触发）。
#[cfg(target_os = "windows")]
#[allow(unused_unsafe)]
fn suspend_webview(window: &WebviewWindow) {
    use tauri::webview::PlatformWebview;
    let _ = window.with_webview(move |wv: PlatformWebview| {
        let controller = wv.controller();
        unsafe {
            // IsVisible=false 是 TrySuspend 的前置条件
            let _ = controller.SetIsVisible(false);
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(core3) = core.cast::<ICoreWebView2_3>() {
                    // 最佳努力：挂起 renderer，失败不报错
                    let core3_clone = core3.clone();
                    let _ = TrySuspendCompletedHandler::wait_for_async_operation(
                        Box::new(move |handler| unsafe {
                            core3_clone.TrySuspend(&handler).ok();
                            Ok(())
                        }),
                        Box::new(|_error_code, _is_successful| Ok(())),
                    );
                }
            }
        }
    });
}

/// 窗口恢复时重新激活 WebView2 renderer。
#[cfg(target_os = "windows")]
fn restore_webview(window: &WebviewWindow) {
    use tauri::webview::PlatformWebview;
    let _ = window.with_webview(move |wv: PlatformWebview| {
        unsafe {
            // IsVisible=true 自动触发 Resume
            let _ = wv.controller().SetIsVisible(true);
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn suspend_webview(_window: &WebviewWindow) {}

#[cfg(not(target_os = "windows"))]
fn restore_webview(_window: &WebviewWindow) {}

// ── 窗口事件绑定 ─────────────────────────────────────────────

pub fn attach_window_events(window: &WebviewWindow, app: &tauri::AppHandle) {
    let label = window.label().to_string();
    let window_clone = window.clone();
    let handle = app.clone();
    let was_minimized = Cell::new(false);

    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                emit_window_close_requested(&window_clone);
            }

            tauri::WindowEvent::Focused(focused) => {
                let event_name = if *focused {
                    "solo:editor-focus"
                } else {
                    "solo:editor-blur"
                };
                let _ = handle.emit_to(label.as_str(), event_name, ());

                // blur → MemoryTargetLevel=Low, focus → Normal
                #[cfg(target_os = "windows")]
                {
                    let level = if *focused {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    };
                    set_memory_target(&window_clone, level);
                }
            }

            tauri::WindowEvent::Resized(_) => {
                // 检测最小化/恢复：Resized 事件在最小化/恢复时也会触发
                if let Ok(minimized) = window_clone.is_minimized() {
                    let prev = was_minimized.replace(minimized);
                    if minimized && !prev {
                        // 刚最小化 → 完整暂停 renderer
                        suspend_webview(&window_clone);
                    } else if !minimized && prev {
                        // 刚恢复 → 重新激活 renderer
                        restore_webview(&window_clone);
                        // 窗口已聚焦，恢复 MemoryTargetLevel
                        #[cfg(target_os = "windows")]
                        set_memory_target(&window_clone, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
                    }
                }
            }

            _ => {}
        }
    });
}

// ── macOS 窗口背景 ───────────────────────────────────────────

#[cfg(target_os = "macos")]
fn parse_hex_color(color: &str) -> Option<(f64, f64, f64, f64)> {
    let hex = color.trim().trim_start_matches('#');
    match hex.len() {
        6 => {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            Some((
                f64::from(r) / 255.0,
                f64::from(g) / 255.0,
                f64::from(b) / 255.0,
                1.0,
            ))
        }
        8 => {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            let a = u8::from_str_radix(&hex[6..8], 16).ok()?;
            Some((
                f64::from(r) / 255.0,
                f64::from(g) / 255.0,
                f64::from(b) / 255.0,
                f64::from(a) / 255.0,
            ))
        }
        _ => None,
    }
}

#[cfg(target_os = "macos")]
pub fn apply_macos_window_background(window: &WebviewWindow, color: &str) -> Result<(), AppError> {
    let (red, green, blue, alpha) =
        parse_hex_color(color).ok_or_else(|| AppError::validation(format!("invalid color: {}", color)))?;
    unsafe {
        let ns_window: &NSWindow = &*window
            .ns_window()
            .map_err(|error| AppError::Native(error.to_string()))?
            .cast();
        let background = NSColor::colorWithDeviceRed_green_blue_alpha(red, green, blue, alpha);
        ns_window.setBackgroundColor(Some(&background));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn apply_macos_window_background(
    _window: &WebviewWindow,
    _color: &str,
) -> Result<(), AppError> {
    Ok(())
}

#[tauri::command]
pub fn set_window_background_color(window: WebviewWindow, color: String) -> Result<(), AppError> {
    apply_macos_window_background(&window, &color)
}

#[tauri::command]
pub fn print_document(window: WebviewWindow) -> Result<(), AppError> {
    window
        .print()
        .map_err(|error| AppError::Native(error.to_string()))
}

#[tauri::command]
pub async fn reveal_in_finder(app: tauri::AppHandle, path: String) -> Result<(), AppError> {
    use tauri_plugin_opener::OpenerExt;
    #[cfg(target_os = "linux")]
    {
        use std::path::Path;
        let path_buf = Path::new(&path);
        let dir = if path_buf.is_dir() {
            path_buf
        } else {
            path_buf.parent().unwrap_or(Path::new("/"))
        };
        app.opener()
            .open_path(dir.to_string_lossy().to_string(), None::<String>)
            .map_err(|error| AppError::Native(error.to_string()))
    }
    #[cfg(not(target_os = "linux"))]
    {
        app.opener()
            .reveal_item_in_dir(path)
            .map_err(|error| AppError::Native(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::parse_hex_color;

    #[test]
    #[cfg(target_os = "macos")]
    fn parses_hex_rgb_colors() {
        assert_eq!(parse_hex_color("#ffffff"), Some((1.0, 1.0, 1.0, 1.0)));
        assert_eq!(
            parse_hex_color("1e1e2e"),
            Some((30.0 / 255.0, 30.0 / 255.0, 46.0 / 255.0, 1.0))
        );
        assert_eq!(
            parse_hex_color("#11223344"),
            Some((17.0 / 255.0, 34.0 / 255.0, 51.0 / 255.0, 68.0 / 255.0))
        );
        assert_eq!(parse_hex_color("oops"), None);
    }
}
