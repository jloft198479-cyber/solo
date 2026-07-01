mod commands;
mod error;
mod events;
mod menu;
mod models;
mod state;

use commands::*;
use models::{AppOpenPathsPayload, AppOpenSource};
use state::{FocusedWindow, LoadedWindows, PendingWindowPaths, StartupOpenRequests};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_window_state::StateFlags;

static WINDOW_COUNTER: AtomicU64 = AtomicU64::new(0);
static STARTUP_LOG_BUF: Mutex<Option<Vec<String>>> = Mutex::new(Some(Vec::new()));

#[tauri::command]
fn startup_ready(
    loaded_windows: tauri::State<'_, LoadedWindows>,
    pending_paths: tauri::State<'_, PendingWindowPaths>,
    startup_requests: tauri::State<'_, StartupOpenRequests>,
    window: tauri::WebviewWindow,
) -> Result<Option<AppOpenPathsPayload>, error::AppError> {
    // 此时 WebView 已完成渲染、Vue 已挂载、主题已应用，再显示窗口避免黑闪
    window.show()?;

    loaded_windows.mark_loaded(window.label().to_string())?;

    let label = window.label().to_string();
    if let Some(payload) = pending_paths.take(&label)? {
        append_startup_log(
            Some(&window.app_handle()),
            format!("startup_ready: label={}, from pending_paths, payload={:?}", label, payload),
        );
        return Ok(Some(payload));
    }

    let payload = startup_requests.take()?;
    append_startup_log(
        Some(&window.app_handle()),
        format!("startup_ready: label={}, payload={:?}", window.label(), payload),
    );
    Ok(payload)
}

/// 创建一个新的编辑器窗口。
/// 通过原子计数器保证 label 唯一性。
fn create_editor_window(
    app: &tauri::AppHandle,
    path: Option<String>,
) -> Result<String, error::AppError> {
    let label = format!("editor-{}", WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed));

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("solo")
        .inner_size(1200.0, 800.0)
        .min_inner_size(320.0, 240.0)
        .center()
        .resizable(true)
        .decorations(false)
        .visible(false)
        .build()
        .map_err(|e| error::AppError::Native(e.to_string()))?;

    // 有关联文件：存入 PendingWindowPaths，等前端 ready 后取走
    if let Some(file_path) = path {
        if let Some(pending) = app.try_state::<PendingWindowPaths>() {
            let payload = AppOpenPathsPayload {
                paths: vec![file_path],
                source: AppOpenSource::NewWindow,
            };
            let _ = pending.insert(label.clone(), payload);
        }
    }

    attach_window_events(&window, app);

    #[cfg(target_os = "macos")]
    window::apply_macos_window_background(&window, "#ffffff")?;

    #[cfg(debug_assertions)]
    if std::env::var_os("SOLO_OPEN_DEVTOOLS").is_some() {
        window.open_devtools();
    }

    // window.show() 由前端 startup_ready IPC 触发，避免黑闪
    // 显式请求前台焦点，绕过 Windows 前台锁限制
    let _ = window.set_focus();

    append_startup_log(Some(app), format!("created window: label={}", label));
    Ok(label)
}

#[tauri::command]
async fn new_editor_window(
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<String, error::AppError> {
    create_editor_window(&app, path)
}

#[tauri::command]
fn refresh_native_menu_shortcuts(
    app: tauri::AppHandle,
    shortcuts: HashMap<String, String>,
) -> Result<(), error::AppError> {
    menu::update_menu_shortcuts(&app, &shortcuts).map_err(error::AppError::from)
}

#[tauri::command]
fn reveal_startup_open_log(app: tauri::AppHandle) -> Result<String, error::AppError> {
    use tauri_plugin_opener::OpenerExt;

    append_startup_log(Some(&app), "reveal_startup_open_log");
    flush_startup_log(&app);
    let path = startup_log_path(Some(&app));
    let path = path.to_string_lossy().to_string();
    app.opener()
        .reveal_item_in_dir(path.clone())
        .map_err(|error| error::AppError::Native(error.to_string()))?;
    Ok(path)
}

fn supported_open_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("md" | "markdown" | "txt")
    )
}

fn startup_log_path(app: Option<&tauri::AppHandle>) -> PathBuf {
    app.and_then(|handle| handle.path().app_log_dir().ok())
        .unwrap_or_else(std::env::temp_dir)
        .join("startup-open.log")
}

fn flush_startup_log(app: &tauri::AppHandle) {
    let path = startup_log_path(Some(app));
    let lines = STARTUP_LOG_BUF.lock().ok().and_then(|mut guard| guard.take());
    if let Some(lines) = lines {
        if lines.is_empty() {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            return;
        }
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            for line in &lines {
                let _ = writeln!(file, "{}", line);
            }
        }
    }
}

fn append_startup_log(app: Option<&tauri::AppHandle>, message: impl AsRef<str>) {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    let line = format!("[{}] {}", timestamp_ms, message.as_ref());

    if let Ok(mut guard) = STARTUP_LOG_BUF.lock() {
        if let Some(buf) = guard.as_mut() {
            buf.push(line);
            return;
        }
    }

    let path = startup_log_path(app);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{}", line);
    }
}

fn normalize_open_path(value: &str, cwd: Option<&str>) -> Option<String> {
    if value.starts_with('-') {
        return None;
    }

    let path = PathBuf::from(value);
    if !supported_open_path(&path) {
        return None;
    }

    let path = if path.is_absolute() {
        path
    } else if let Some(cwd) = cwd {
        PathBuf::from(cwd).join(path)
    } else {
        path
    };
    path.to_str().map(|value| value.to_string())
}

fn open_paths_from_args<I, S>(args: I, cwd: Option<&str>) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .filter_map(|arg| normalize_open_path(arg.as_ref(), cwd))
        .collect()
}

pub fn run() {
    let updater = tauri_plugin_updater::Builder::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(updater.build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    StateFlags::SIZE
                        | StateFlags::POSITION
                        | StateFlags::MAXIMIZED,
                )
                .map_label(|label| {
                    if label.starts_with("main-") {
                        "secondary"
                    } else {
                        label
                    }
                })
                .build(),
        )
        .setup(|app| {
            app.manage(StartupOpenRequests::default());
            app.manage(PendingWindowPaths::default());
            app.manage(LoadedWindows::default());
            app.manage(FocusedWindow::default());

            let raw_args = std::env::args().collect::<Vec<_>>();
            append_startup_log(
                Some(&app.handle()),
                format!("setup raw args={:?}", raw_args),
            );

            let raw_paths = open_paths_from_args(raw_args.iter().skip(1), None);
            if !raw_paths.is_empty() {
                append_startup_log(
                    Some(&app.handle()),
                    format!("startup paths from raw args={:?}", raw_paths),
                );
                if let Some(state) = app.try_state::<StartupOpenRequests>() {
                    let _ = state.merge(AppOpenPathsPayload {
                        paths: raw_paths,
                        source: AppOpenSource::Cli,
                    });
                }
            }

            use tauri_plugin_cli::CliExt;
            if let Ok(matches) = app.cli().matches() {
                if let Some(file_arg) = matches.args.get("file") {
                    if let Some(file_path) = file_arg.value.as_str() {
                        append_startup_log(
                            Some(&app.handle()),
                            format!("startup cli file arg={}", file_path),
                        );
                        if let Some(file_path) = normalize_open_path(file_path, None) {
                            if let Some(state) = app.try_state::<StartupOpenRequests>() {
                                let _ = state.merge(AppOpenPathsPayload {
                                    paths: vec![file_path],
                                    source: AppOpenSource::Cli,
                                });
                            }
                        } else if let Some(state) = app.try_state::<StartupOpenRequests>() {
                            let _ = state.merge(AppOpenPathsPayload {
                                paths: vec![file_path.to_string()],
                                source: AppOpenSource::Cli,
                            });
                        };
                    }
                }
            }

            menu::setup_menu(&app.handle(), &HashMap::new()).map_err(error::AppError::from)?;
            menu::attach_menu_events(&app.handle());

            if let Some(main_window) = app.get_webview_window("main") {
                #[cfg(any(target_os = "windows", target_os = "linux"))]
                main_window
                    .set_decorations(false)
                    .map_err(error::AppError::from)?;

                #[cfg(target_os = "macos")]
                apply_macos_window_background(&main_window, "#ffffff")?;

                #[cfg(debug_assertions)]
                if std::env::var_os("SOLO_OPEN_DEVTOOLS").is_some() {
                    main_window.open_devtools();
                }

                attach_window_events(&main_window, app.handle());
            }

            flush_startup_log(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_document,
            save_document,
            rename_file,
            import_document_image,
            save_clipboard_image,
            authorize_image_asset,
            fetch_remote_image,
            startup_ready,
            new_editor_window,
            fetch_font_data,
            get_cached_font_path,
            save_font_cache,
            refresh_native_menu_shortcuts,
            reveal_startup_open_log,
            exit_app,
            set_window_background_color,
            register_shell_new,
            unregister_shell_new
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, _event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = &_event {
                append_startup_log(
                    Some(_app_handle),
                    format!("RunEvent::Opened urls={:?}", urls),
                );
                let paths = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter_map(|path| path.to_str().map(|value| value.to_string()))
                    .collect::<Vec<_>>();

                for path in paths {
                    if let Err(e) = create_editor_window(_app_handle, Some(path)) {
                        append_startup_log(Some(_app_handle), format!("RunEvent::Opened create_editor_window error: {e}"));
                    }
                }
            }
        });
}
