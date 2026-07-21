use arboard::Clipboard;

use crate::error::AppError;

/// 从操作系统剪贴板读取 HTML 富文本。
///
/// 为什么需要它：WebView2 的粘贴事件 `event.clipboardData` 经常不带 `text/html`
/// （外部应用 / 跨源复制尤其如此），且 `navigator.clipboard.read()` 在桌面 webview
/// 里不可靠。因此粘贴保格式的最后可靠来源是【系统剪贴板本身】，由 Rust 直接读取
/// （arboard 是 clipboard-manager 插件的底层依赖，本机已存在，无需新增依赖）。
///
/// 无 HTML / 剪贴板不可用 → 返回 `Ok(None)`，前端自行降级为 markdown / 纯文本。
///
/// 说明：arboard 的 `Clipboard` 是阻塞式系统调用，故放进 `spawn_blocking`，
/// 避免阻塞 Tauri 异步运行时；所有 arboard 对象都在闭包内创建并销毁，
/// 闭包本身保持 `Send`，不受 `Clipboard` 是否 `Send` 影响。
#[tauri::command]
pub async fn read_clipboard_html() -> Result<Option<String>, AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut clipboard = Clipboard::new()
            .map_err(|e| AppError::Native(format!("无法访问剪贴板: {}", e)))?;
        match clipboard.get().html() {
            Ok(html) if !html.trim().is_empty() => Ok(Some(html)),
            // 剪贴板里没有 HTML 格式（只有纯文本 / 图片）→ 视为无，交给前端降级
            Ok(_) => Ok(None),
            Err(_) => Ok(None),
        }
    })
    .await
    .map_err(|e| AppError::Native(format!("剪贴板读取任务失败: {}", e)))?
}
