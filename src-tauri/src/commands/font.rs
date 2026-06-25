use base64::Engine;

/// 通过 Rust 的 HTTP 客户端下载资源并返回 base64 编码的数据。
/// 绕过前端 CSP/CORS 限制，专用于字体文件下载。
#[tauri::command]
pub async fn fetch_font_data(url: String) -> Result<String, crate::error::AppError> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| crate::error::AppError::Network(e.to_string()))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| crate::error::AppError::Network(e.to_string()))?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(encoded)
}
