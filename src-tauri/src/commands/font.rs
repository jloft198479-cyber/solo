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

/// 检查本地字体缓存，存在则返回路径，否则返回 None。
/// 前端通过 convertFileSrc + fetch 流式加载，避免 IPC 传输二进制数据。
#[tauri::command]
pub async fn get_cached_font_path(
    family: String,
    app: AppHandle,
) -> Result<Option<String>, AppError> {
    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Native(e.to_string()))?
        .join("font-cache");
    let cached = cache_dir.join(&family);
    if cached.exists() {
        Ok(Some(cached.to_string_lossy().to_string()))
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
