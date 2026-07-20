// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::{Duration, SystemTime};

const STALE_DATA_DIR_AGE: Duration = Duration::from_secs(24 * 60 * 60);

fn main() {
    setup_webview2_data_dir();
    solo_lib::run()
}

/// 为每个进程分配独立的 WebView2 数据目录，避免 LevelDB 锁竞争导致的全进程卡死。
/// 目录位于 %TEMP%\com.solomarkdown\EBWebView-{PID}-{毫秒时间戳}。
///
/// 启动时仅清理「24 小时以前」的残留目录——不无条件删全部。
/// 原因：用户可能同时双开 solo（两个独立进程），新进程启动时若把
/// 仍在运行的老进程的 EBWebView 目录删掉，会导致老进程 WebView2 状态损坏或崩溃。
/// 24h 阈值足以覆盖「上次关进程没清干净」的常态残留，同时不会误伤近期活跃进程。
fn setup_webview2_data_dir() {
    let company_dir = std::env::temp_dir().join("com.solomarkdown");
    let _ = std::fs::create_dir_all(&company_dir);

    let now = SystemTime::now();

    // 仅清理足够老的 EBWebView 目录（残留 >24h）
    if let Ok(entries) = std::fs::read_dir(&company_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("EBWebView-") {
                continue;
            }
            // 用目录的最后修改时间判断是否残留；拿不到时间则跳过（保守不删）
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
}
