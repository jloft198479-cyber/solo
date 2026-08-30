use crate::error::AppError;
use crate::events::emit_window_close_requested;
use crate::state::{CloseDecision, CloseGuard, FocusedWindow, LoadedWindows};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSColor, NSWindow};
use std::time::Duration;
use tauri::{Emitter, Manager, WebviewWindow};

#[cfg(target_os = "windows")]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
#[cfg(target_os = "windows")]
use windows_core::Interface;

/// 前端应答宽限期：close-requested 送出后这么久仍没收到 ack，
/// 判定 WebView 的 JS 线程被占死（大文档序列化就是这个量级），
/// 下一次关闭请求走逃生舱。取值要显著大于「健康 JS 从收到事件到弹框」的耗时。
const CLOSE_ACK_GRACE: Duration = Duration::from_millis(3000);

/// 设置 WebView2 的内存目标等级。
/// Low 模式下允许 OS 将 renderer 物理内存页换出，Normal 恢复。
/// 仅在 Windows 上生效；其他平台静默跳过。
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

/// 看门狗判定：状态缺失或锁不可用时回退 Prompt（宁可多问一次，绝不放水关闭）。
fn evaluate_close_request(handle: &tauri::AppHandle, label: &str) -> CloseDecision {
    handle
        .try_state::<CloseGuard>()
        .and_then(|guard| guard.evaluate(label, CLOSE_ACK_GRACE).ok())
        .unwrap_or(CloseDecision::Prompt)
}

pub fn attach_window_events(window: &WebviewWindow, app: &tauri::AppHandle) {
    let label = window.label().to_string();
    let window_clone = window.clone();
    let handle = app.clone();

    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                match evaluate_close_request(&handle, window_clone.label()) {
                    CloseDecision::Prompt => {
                        api.prevent_close();
                        emit_window_close_requested(&window_clone);
                    }
                    // 确认框已经在屏上（或刚送出还没应答）：吞掉重复请求，
                    // 否则连按关闭会叠出多个确认框。
                    CloseDecision::Waiting => api.prevent_close(),
                    // 逃生舱：宽限期已过而前端一次都没应答，说明 JS 线程被占死，
                    // 确认框永远出不来。这里不调 prevent_close，原生关闭直接放行。
                    // 代价是最后一次自动保存之后的编辑会丢——这是「卡死时唯一退路」
                    // 的必然取舍，所以要用户主动按下第二次关闭才触发。
                    CloseDecision::Force => {
                        eprintln!(
                            "[window] {} 关闭请求前端无应答，逃生舱放行原生关闭",
                            window_clone.label()
                        );
                    }
                }
            }

            tauri::WindowEvent::Focused(focused) => {
                let event_name = if *focused {
                    "solo:editor-focus"
                } else {
                    "solo:editor-blur"
                };
                let _ = handle.emit_to(label.as_str(), event_name, ());

                // 跟踪焦点窗口，供菜单事件定向分发使用
                if let Some(focused_state) = handle.try_state::<FocusedWindow>() {
                    if *focused {
                        let _ = focused_state.set(label.clone());
                    } else {
                        // 仅当自己是当前焦点窗口时才清除，避免其他窗口 blur 误清
                        if let Ok(Some(current)) = focused_state.get() {
                            if current == label {
                                let _ = focused_state.clear();
                            }
                        }
                    }
                }

                // blur → 降低 WebView2 内存占用，focus → 恢复
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

            tauri::WindowEvent::Destroyed => {
                if let Some(loaded) = handle.try_state::<LoadedWindows>() {
                    let _ = loaded.remove(&label);
                }
                if let Some(guard) = handle.try_state::<CloseGuard>() {
                    let _ = guard.clear(&label);
                }
                if let Some(focused) = handle.try_state::<FocusedWindow>() {
                    if let Ok(Some(current)) = focused.get() {
                        if current == label {
                            let _ = focused.clear();
                        }
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

/// 应用级退出：不直接杀进程，而是向所有窗口定向发送 close-requested，
/// 让每个窗口走自己已有的「脏态确认 → 保存 → destroy」链路（前端 listenWindowCloseRequested）。
/// 所有窗口关闭后进程自然退出（Tauri 默认行为）。
/// 任一窗口在确认框选「取消」即中止退出（该窗口不销毁，其余已关闭窗口不恢复）。
/// 未 startup_ready 的窗口：前端 listener 尚未注册，事件会丢失——
/// 但懒初始化设计保证其无用户内容，直接销毁即可。
#[tauri::command]
pub fn request_app_quit(app: tauri::AppHandle) -> Result<(), AppError> {
    for (label, window) in app.webview_windows() {
        let is_loaded = app
            .try_state::<LoadedWindows>()
            .and_then(|state| state.contains(&label).ok())
            .unwrap_or(false);
        if !is_loaded {
            let _ = window.destroy();
            continue;
        }
        match evaluate_close_request(&app, &label) {
            CloseDecision::Prompt => emit_window_close_requested(&window),
            // 该窗口已经有确认框在等用户答话，别再叠一个
            CloseDecision::Waiting => {}
            CloseDecision::Force => {
                eprintln!("[window] {label} 退出请求前端无应答，逃生舱直接销毁窗口");
                let _ = window.destroy();
            }
        }
    }
    Ok(())
}

/// 关窗逃生舱握手。
/// `phase = "ack"`：前端已收到 close-requested，证明 JS 主线程还活着，
/// 此后重复的关闭请求一律吞掉（确认框正在等用户答话）。
/// `phase = "abort"`：本次关闭链已中止（用户取消 / 保存失败），
/// 清掉看门狗让下一次关闭请求重新弹窗。
#[tauri::command]
pub fn report_window_close(window: WebviewWindow, phase: String) -> Result<(), AppError> {
    let Some(guard) = window.try_state::<CloseGuard>() else {
        return Ok(());
    };
    match phase.trim() {
        "ack" => {
            guard.mark_acked(window.label())?;
        }
        "abort" => {
            guard.clear(window.label())?;
        }
        _ => return Err(AppError::validation("phase must be ack or abort")),
    }
    Ok(())
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
