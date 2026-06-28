// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    setup_webview2_data_dir();
    solo_lib::run()
}

/// 为每个进程分配独立的 WebView2 数据目录，避免 LevelDB 锁竞争导致的全进程卡死。
/// 目录位于 %TEMP%\com.solomarkdown\EBWebView-{PID}-{毫秒时间戳}。
/// 启动时自动清理超过 24 小时未修改的旧目录。
fn setup_webview2_data_dir() {
    let company_dir = std::env::temp_dir().join("com.solomarkdown");
    let _ = std::fs::create_dir_all(&company_dir);

    // 清理 24h 前的过期目录
    if let Ok(entries) = std::fs::read_dir(&company_dir) {
        let now = std::time::SystemTime::now();
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with("EBWebView-") {
                if let Ok(metadata) = entry.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        if now
                            .duration_since(modified)
                            .map(|d| d.as_secs() > 86400)
                            .unwrap_or(false)
                        {
                            let _ = std::fs::remove_dir_all(entry.path());
                        }
                    }
                }
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
