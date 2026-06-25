/// 通过 Rust 的 reqwest 下载字体文件并返回原始字节。
/// 绕过前端 CSP/CORS 限制。
#[tauri::command]
pub async fn fetch_font_data(url: String) -> Result<Vec<u8>, crate::error::AppError> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| crate::error::AppError::Network(e.to_string()))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| crate::error::AppError::Network(e.to_string()))?;

    Ok(bytes.to_vec())
}
