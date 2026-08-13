// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::{Duration, SystemTime};

const STALE_DATA_DIR_AGE: Duration = Duration::from_secs(60 * 60); // 1h

fn main() {
    let webview_dir = setup_webview2_data_dir();
    solo_lib::run();
    // 进程正常退出后，清理自己的 WebView2 数据目录。
    // 崩溃/强杀路径走到不了这里，残留由下次启动的 stale 清理兜底。
    std::thread::sleep(Duration::from_millis(100));
    let _ = std::fs::remove_dir_all(&webview_dir);
}

/// 为每个进程分配独立的 WebView2 数据目录，避免 LevelDB 锁竞争导致的全进程卡死。
/// 目录位于 %TEMP%\com.solomarkdown\EBWebView-{PID}-{毫秒时间戳}。
///
/// 正常退出时 main() 会清理自己的目录。启动时仅清理 >1h 的残留目录——
/// 不无条件删全部，避免误伤仍在运行的双开老进程的 EBWebView 目录。
fn setup_webview2_data_dir() -> std::path::PathBuf {
    let company_dir = std::env::temp_dir().join("com.solomarkdown");
    let _ = std::fs::create_dir_all(&company_dir);

    let now = SystemTime::now();

    // 清理足够老的 EBWebView 残留目录（>STALE_DATA_DIR_AGE）。
    // 正常退出时 main() 会清理自己的目录；这里只兜底崩溃/强杀残留。
    if let Ok(entries) = std::fs::read_dir(&company_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("EBWebView-") {
                continue;
            }
            let is_stale = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
                .map(|age| age > STALE_DATA_DIR_AGE)
                .unwrap_or(false);
            if is_stale {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }

    let pid = std::process::id();
    let ms = now
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dir_name = format!("EBWebView-{}-{}", pid, ms);
    let webview_dir = company_dir.join(dir_name);

    let _ = std::fs::create_dir_all(&webview_dir);
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_dir);

    webview_dir
}
