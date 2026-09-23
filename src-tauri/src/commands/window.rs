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

    #[cfg(target_os = "windows")]
    {
        // IME 重锚日志：与 startup-open.log 同目录。用途 = 事后自诊断——
        // 下次再出现失锚，读这份日志即可知道各触发器有没有开火、注入是否成功，
        // 不再需要用户描述或配合测试。
        if let Ok(dir) = app.path().app_log_dir() {
            let _ = std::fs::create_dir_all(&dir);
            ime_nudge::init(dir.join("ime-nudge.log"));
        }
    }

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

            // 窗口几何变化后 IME 候选窗锚点可能失效。
            //
            // ⚠️ 必须**同时**接 `Moved`，这是 2026-09-24 首版漏掉的关键：
            //   - 鼠标拖动窗口 → `WM_WINDOWPOSCHANGED` → tao 发 `Moved`
            //   - `WM_SIZE` → tao 才发 `Resized`
            //   - 拖动**不改变尺寸** ⇒ **一个 `Resized` 都不发**
            //   （映射见 `tao/src/platform_impl/windows/event_loop.rs`）
            //   用户实测「挪完窗口最容易失锚」，而首版只监听 `Resized` ⇒ 补丁从未触发。
            //
            // 注入细节见文件末尾 ime_nudge 模块。
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                #[cfg(target_os = "windows")]
                ime_nudge::on_geometry_changed();
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
                    // 重新获得焦点后的「首次组字」是失锚高发时机
                    // ⇒ 提前注入一次重锚事件（详见文件末尾 ime_nudge 模块）。
                    if *focused {
                        ime_nudge::on_focus_gained();
                    }

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

// ── IME 候选窗重锚（Windows）────────────────────────────────
//
// 背景：WebView2 的微软拼音候选窗偶发**脱离光标**、钉死在一个固定的屏幕坐标上
// （2026-09 排查，见 `docs/IME-CANDIDATE-WINDOW-REPORT.md`）。已知唯一可靠的解除
// 方式 = 产生一次**鼠标输入事件**（用户手动「晃一下鼠标」即可自愈）。
//
// ⚠️ 时机结论（2026-09-24 v2 实测定性，是本模块设计的核心依据）：
//   - v2 只在「窗口移动结束后」注入（预防性），病照犯 ⇒ **事前注入防不住**；
//   - 解药生效的时机是「候选窗已钉死**之后**」鼠标一动 ⇒ **事后注入才对得上**；
//   - 失锚高发于「窗口几何变化 / 焦点切换之后的第一次组字」。
// ⇒ 触发点分两层：
//   ① 预防层（保留 v2）：几何稳定 / 重新聚焦后注入一次，覆盖部分场景、成本为零；
//   ② 治疗层（v3 新增）：前端在 compositionstart 时通知本模块，若近期（15s 内）
//      动过窗口 / 切过焦点，则在 +250ms 与 +900ms 各注入一次——此时候选窗已出现，
//      正是「晃一下就好」的生效窗口。
//
// 约束：
// 1. **净位移为零**：先把指针移开 MOVE_PX 像素，再立刻移回原坐标 ⇒ 指针最终位置
//    **必然复原**（不做任何坐标换算，多显示器 / DPI 缩放下同样安全）。
//    为什么不直接发「零位移」事件：位移为 0 的合成事件可能被系统合并/丢弃，
//    而用户的解药是**真实晃动**，故这里复刻真实位移。
// 2. **鼠标按下期间绝不注入**：拖动窗口 / 按住按键时移动指针会把被拖对象带偏。
//    因此先等几何稳定，再等鼠标空闲（有上限，超时放弃本次）。
// 3. **去抖**：拖动期间 `Moved` 连发，只在停止后注入一次，且同时最多一个等待任务。
// 4. **失败静默 + 全程落日志**：任何一步失败都直接返回；每次注入尝试写一行
//    `ime-nudge.log`（路径见 init），供事后自诊断。
// 5. 仅 Windows 生效（编译期 `#[cfg]` 移除），其他平台零行为、零依赖。
#[cfg(target_os = "windows")]
mod ime_nudge {
    use std::io::Write as _;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::OnceLock;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    /// 几何稳定多久后才注入（去抖窗口）。
    const DEBOUNCE: Duration = Duration::from_millis(120);
    /// 鼠标仍被按下时的重试间隔。
    const RETRY: Duration = Duration::from_millis(120);
    /// 等鼠标空闲的最长时间；超时则放弃本次注入（不排队、不重试）。
    const MAX_IDLE_WAIT: Duration = Duration::from_millis(2000);
    /// 注入时指针临时位移量（像素）。1px 足以产生真实移动事件，
    /// 又小到不可能改变指针下方的目标。
    const MOVE_PX: i32 = 1;
    /// 临时位移保持时长。>0 才能保证「移开 + 移回」被识别为**两次**独立移动，
    /// 而不是被系统合并成一次净零位移（那就等于没动）。
    const MOVE_HOLD: Duration = Duration::from_millis(15);
    /// 「近期动过窗口/焦点」的判定窗口：组字开始时往回看这么久，
    /// 有几何/焦点事件才注入（治疗层）。避免日常打字被频繁打扰。
    const RECENT_WINDOW_MS: u64 = 15_000;
    /// 治疗层注入时刻（组字开始后）。候选窗在首个拼音键后即出现，
    /// +250ms 对准「已出现、刚钉死」；+900ms 兜底长组字 / 慢锚定。
    const HEAL_DELAYS_MS: [u64; 2] = [250, 900];

    /// 最后一次窗口几何变化的时间戳（毫秒）。
    static LAST_GEOMETRY_MS: AtomicU64 = AtomicU64::new(0);
    /// 最后一次获得焦点的时间戳（毫秒）。
    static LAST_FOCUS_MS: AtomicU64 = AtomicU64::new(0);
    /// 是否已有等待中的去抖任务。
    static DEBOUNCE_PENDING: AtomicBool = AtomicBool::new(false);
    /// 日志落点（attach_window_events 里 init 一次）。
    static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

    /// 初始化日志路径。仅第一次调用生效。
    pub fn init(path: PathBuf) {
        let _ = LOG_PATH.set(path);
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    /// 追加一行诊断日志。任何失败静默（日志绝不能反过来影响功能）。
    fn log(message: impl AsRef<str>) {
        if let Some(path) = LOG_PATH.get() {
            if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                let _ = writeln!(file, "[{}] {}", now_ms(), message.as_ref());
            }
        }
    }

    /// 近期（RECENT_WINDOW_MS 内）是否动过窗口几何 / 切过焦点。
    fn had_recent_activity() -> bool {
        let now = now_ms();
        let geometry = LAST_GEOMETRY_MS.load(Ordering::SeqCst);
        let focus = LAST_FOCUS_MS.load(Ordering::SeqCst);
        let recent = |t: u64| t != 0 && now.saturating_sub(t) < RECENT_WINDOW_MS;
        recent(geometry) || recent(focus)
    }

    /// 窗口几何变化（`Resized` / `Moved`）时调用：去抖 → 等鼠标空闲 → 注入一次。
    pub fn on_geometry_changed() {
        LAST_GEOMETRY_MS.store(now_ms(), Ordering::SeqCst);

        // 已有等待中的任务则直接返回——它会读到最新的时间戳，
        // 从而把注入推迟到「最后一次几何变化 + DEBOUNCE」之后。
        if DEBOUNCE_PENDING.swap(true, Ordering::SeqCst) {
            return;
        }

        std::thread::spawn(|| {
            loop {
                std::thread::sleep(DEBOUNCE);
                let last = LAST_GEOMETRY_MS.load(Ordering::SeqCst);
                if now_ms().saturating_sub(last) >= DEBOUNCE.as_millis() as u64 {
                    break;
                }
            }
            DEBOUNCE_PENDING.store(false, Ordering::SeqCst);
            if wait_until_mouse_idle() {
                let ok = nudge();
                log(format!("geometry ok={ok}"));
            } else {
                log("geometry skip(mouse-busy)");
            }
        });
    }

    /// 窗口重新获得焦点时调用：等鼠标空闲后注入一次（无需去抖）。
    pub fn on_focus_gained() {
        LAST_FOCUS_MS.store(now_ms(), Ordering::SeqCst);
        std::thread::spawn(|| {
            if wait_until_mouse_idle() {
                let ok = nudge();
                log(format!("focus ok={ok}"));
            } else {
                log("focus skip(mouse-busy)");
            }
        });
    }

    /// 治疗层入口：前端在 `compositionstart`（组字开始）时调用。
    ///
    /// 此时候选窗即将出现——正是「鼠标一动即自愈」的生效时机。
    /// 仅当近期动过窗口 / 切过焦点才注入（失锚的高发前提），
    /// 避免日常打字被无谓打扰。在 HEAL_DELAYS_MS 各排一次注入。
    pub fn on_composition_started() {
        if !had_recent_activity() {
            return; // 与高发场景无关的组字：不打扰（连日志也不写，保持文件干净）
        }
        log("composition armed(recent-geometry)");
        for delay in HEAL_DELAYS_MS {
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(delay));
                if wait_until_mouse_idle() {
                    let ok = nudge();
                    log(format!("composition delay={delay} ok={ok}"));
                } else {
                    log(format!("composition delay={delay} skip(mouse-busy)"));
                }
            });
        }
    }

    /// 等到没有任何鼠标按键被按下。拖动 / 长按期间注入会把被拖对象带偏 1px。
    fn wait_until_mouse_idle() -> bool {
        let deadline = now_ms().saturating_add(MAX_IDLE_WAIT.as_millis() as u64);
        while mouse_button_down() {
            if now_ms() >= deadline {
                return false;
            }
            std::thread::sleep(RETRY);
        }
        true
    }

    fn mouse_button_down() -> bool {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
        };
        // GetAsyncKeyState 的最高位 = 当前是否按下。
        const DOWN: i16 = 0x8000u16 as i16;

        [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].into_iter().any(|vk| {
            // SAFETY: 无副作用查询，任意线程可调用；返回值仅作位判断。
            unsafe { (GetAsyncKeyState(vk as i32) & DOWN) != 0 }
        })
    }

    /// 注入一次**净位移为零**的真实鼠标移动（移开 1px → 立刻移回）。
    /// 返回是否完整走完「移开 + 移回」。
    pub fn nudge() -> bool {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};

        // SAFETY: 三个 API 均为无副作用查询 / 光标定位；失败即返回，不改动任何状态。
        unsafe {
            let mut origin = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut origin) == 0 {
                return false;
            }
            // 移开失败（如锁屏）直接放弃：绝不能留下「移开了但没移回」的残局。
            if SetCursorPos(origin.x + MOVE_PX, origin.y) == 0 {
                return false;
            }
            std::thread::sleep(MOVE_HOLD);
            let _ = SetCursorPos(origin.x, origin.y);
        }
        true
    }
}

/// IME 候选窗重锚（治疗层入口）：前端在 `compositionstart` 时调用。
/// Rust 侧自行判断「近期是否动过窗口 / 切过焦点」，无关的组字直接忽略。
/// 详见本文件 `ime_nudge` 模块文档。
#[tauri::command]
pub fn ime_nudge_soon() {
    #[cfg(target_os = "windows")]
    ime_nudge::on_composition_started();
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
