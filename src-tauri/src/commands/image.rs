use crate::commands::document::mime_to_extension;
use crate::error::AppError;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

const MAX_REMOTE_IMAGE_BYTES: usize = 10 * 1024 * 1024;
static IMAGE_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn image_client() -> Result<reqwest::Client, AppError> {
    if let Some(client) = IMAGE_CLIENT.get() {
        return Ok(client.clone());
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| AppError::Network(format!("创建客户端失败: {}", error)))?;

    let _ = IMAGE_CLIENT.set(client);
    IMAGE_CLIENT
        .get()
        .cloned()
        .ok_or_else(|| AppError::Network("图片客户端初始化失败".to_string()))
}

/// 对 URL 做稳定哈希，用作缓存文件名
fn url_hash(url: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    hasher.finish()
}

/// 异步获取网络图片，落盘缓存后返回本地文件路径。
/// 前端通过 `toAssetUrl(path)` 转为 asset:// URL 直接显示。
/// IPC 只传几十字节路径，不再传 base64 数据。
#[tauri::command]
pub async fn fetch_remote_image(app: AppHandle, url: String) -> Result<String, AppError> {
    let client = image_client()?;
    let mut response = client
        .get(&url)
        .header("Referer", &url)
        .header(
            "Accept",
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        )
        .send()
        .await
        .map_err(|error| AppError::Network(format!("请求失败: {}", error)))?;

    let status = response.status();
    if !status.is_success() {
        return Err(AppError::Network(format!("HTTP 错误: {}", status)));
    }

    if let Some(content_length) = response.content_length() {
        if content_length > MAX_REMOTE_IMAGE_BYTES as u64 {
            return Err(AppError::Network(format!(
                "图片过大: {} bytes，最大支持 {} bytes",
                content_length, MAX_REMOTE_IMAGE_BYTES
            )));
        }
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| AppError::Network(format!("读取响应失败: {}", error)))?
    {
        if bytes.len() + chunk.len() > MAX_REMOTE_IMAGE_BYTES {
            return Err(AppError::Network(format!(
                "图片过大: 超过 {} bytes",
                MAX_REMOTE_IMAGE_BYTES
            )));
        }
        bytes.extend_from_slice(&chunk);
    }

    // 落盘缓存：以 URL 哈希命名，已存在则跳过写盘
    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Native(format!("获取缓存目录失败: {}", e)))?
        .join("remote-image-cache");
    fs::create_dir_all(&cache_dir)?;

    let ext = mime_to_extension(&content_type);
    let file_name = format!("{:x}.{}", url_hash(&url), ext);
    let cached = cache_dir.join(&file_name);

    if !cached.exists() {
        fs::write(&cached, &bytes)?;
    }

    // 授权 asset 协议作用域
    app.asset_protocol_scope().allow_file(&cached)?;

    // 只回传路径（几十字节），不再回传 base64（十几 MB）
    Ok(cached.to_string_lossy().to_string())
}
