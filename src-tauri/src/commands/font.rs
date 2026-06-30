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

/// 检查字体文件是否已缓存到共享路径。
/// 返回本地文件路径（若已缓存），否则返回 None。
/// 多个进程共享同一个 app_local_data_dir，避免重复下载。
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

/// 将字体字节写入共享缓存路径，返回本地文件路径。
/// 幂等：同一 family 的多次写入覆盖同一文件，内容不变（同一 URL 下载结果一致）。
#[tauri::command]
pub async fn save_font_cache(
    family: String,
    data: Vec<u8>,
    app: AppHandle,
) -> Result<String, AppError> {
    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Native(e.to_string()))?
        .join("font-cache");
    fs::create_dir_all(&cache_dir)?;
    let cached = cache_dir.join(&family);
    // 先写临时文件，再 rename，防止半写状态被其他进程读到
    let tmp = cache_dir.join(format!("{}.tmp", &family));
    fs::write(&tmp, &data)?;
    fs::rename(&tmp, &cached)?;
    Ok(cached.to_string_lossy().to_string())
}
