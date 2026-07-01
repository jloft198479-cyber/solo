use crate::error::AppError;
use std::fs;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

static FONT_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn font_client() -> Result<reqwest::Client, AppError> {
    if let Some(client) = FONT_CLIENT.get() {
        return Ok(client.clone());
    }

    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30));

    if let Some(proxy_url) = crate::proxy::get_proxy() {
        if let Ok(proxy) = reqwest::Proxy::https(proxy_url) {
            builder = builder.proxy(proxy);
        }
    }

    let client = builder
        .build()
        .map_err(|error| AppError::Network(format!("创建客户端失败: {}", error)))?;

    let _ = FONT_CLIENT.set(client);
    FONT_CLIENT.get().cloned().ok_or_else(|| AppError::Network("Client init failed".into()))
}

/// 通过 Rust 的 reqwest 下载字体文件并直接写入 font-cache 目录，返回缓存路径。
/// 绕过前端 CSP/CORS 限制。
/// 返回路径供前端用 convertFileSrc + fetch 读取，避免 IPC 传输二进制数据。
#[tauri::command]
pub async fn fetch_font_data(
    url: String,
    family: String,
    app: AppHandle,
) -> Result<String, AppError> {
    let response = font_client()?.get(&url).send().await?;
    let bytes = response.bytes().await?;

    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Native(e.to_string()))?
        .join("font-cache");
    fs::create_dir_all(&cache_dir)?;
    let cached = cache_dir.join(&family);
    let tmp = cache_dir.join(format!("{}.tmp", &family));
    fs::write(&tmp, &bytes)?;
    fs::rename(&tmp, &cached)?;

    Ok(cached.to_string_lossy().to_string())
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
