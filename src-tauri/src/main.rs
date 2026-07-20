// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    setup_webview2_data_dir();
    solo_lib::run()
}

/// 为每个进程分配独立的 WebView2 数据目录，避免 LevelDB 锁竞争导致的全进程卡死。
/// 目录位于 %TEMP%\com.solomarkdown\EBWebView-{PID}-{毫秒时间戳}。
/// 启动时清理所有旧目录（均为历史进程残留，当前进程用不上）。
fn setup_webview2_data_dir() {
    let company_dir = std::env::temp_dir().join("com.solomarkdown");
    let _ = std::fs::create_dir_all(&company_dir);

    // 清理所有旧 EBWebView 目录
    if let Ok(entries) = std::fs::read_dir(&company_dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with("EBWebView-") {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }

    let pid = std::process::id();
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dir_name = format!("EBWebView-{}-{}", pid, ms);
    let webview_dir = company_dir.join(dir_name);

    let _ = std::fs::create_dir_all(&webview_dir);
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_dir);
}
