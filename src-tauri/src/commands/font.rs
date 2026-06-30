use crate::error::AppError;
use std::fs;
use tauri::{AppHandle, Manager};

/// 通过 Rust 的 reqwest 下载字体文件并返回原始字节。
/// 绕过前端 CSP/CORS 限制。
#[tauri::command]
pub async fn fetch_font_data(url: String) -> Result<Vec<u8>, AppError> {
    let response = reqwest::get(&url).await?;
    let bytes = response.bytes().await?;
    Ok(bytes.to_vec())
}

/// 从本地缓存读取字体数据。
/// 已缓存则返回字节数组，否则返回 None。
#[tauri::command]
pub async fn get_cached_font_data(
    family: String,
    app: AppHandle,
) -> Result<Option<Vec<u8>>, AppError> {
    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Native(e.to_string()))?
        .join("font-cache");
    let cached = cache_dir.join(&family);
    if cached.exists() {
        let bytes = fs::read(&cached)?;
        Ok(Some(bytes))
    } else {
        Ok(None)
    }
}

/// 将字体字节写入本地缓存。
/// 同一个 family 覆盖写入。
#[tauri::command]
pub async fn save_font_cache(
    family: String,
    data: Vec<u8>,
    app: AppHandle,
) -> Result<(), AppError> {
    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Native(e.to_string()))?
        .join("font-cache");
    fs::create_dir_all(&cache_dir)?;
    let cached = cache_dir.join(&family);
    let tmp = cache_dir.join(format!("{}.tmp", &family));
    fs::write(&tmp, &data)?;
    fs::rename(&tmp, &cached)?;
    Ok(())
}
