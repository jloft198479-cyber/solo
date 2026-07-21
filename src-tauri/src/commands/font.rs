use crate::error::AppError;
use std::fs;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

static FONT_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn font_client() -> Result<reqwest::Client, AppError> {
    if let Some(client) = FONT_CLIENT.get() {
        return Ok(client.clone());
    }

    // reqwest 配 rustls-tls（不读系统证书库），但开启 system-proxy feature 后
    // 会自动读环境变量（HTTP_PROXY/HTTPS_PROXY）+ Windows 注册表系统代理，
    // 让 rustls-tls 也能走系统代理下载字体，网络受限环境下不再失败。
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
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
    // 缓存文件名用 URL 末段（含扩展名，如 NotoSerifSC-Regular.otf）。
    // 历史背景：v1.2.27 用 family（如 "Noto Serif SC"，无扩展名）作文件名；
    // v1.2.28 改为 fileName 后旧缓存无法被新代码识别（key 不匹配），被迫重新下载。
    // 用 fileName 而非 family 的真正原因：与 FONT_OPTIONS 的 fileName 字段对齐，
    // 让前端 getCachedFontPath(family, fileName) 与 Rust 落盘文件名严格一致，
    // 避免前端 family 字符串与磁盘文件名之间的二次映射。
    // （早期注释说"无扩展名导致 Content-Type 推断失败"是错误的——v1.2.27 时
    // 无扩展名的 family 文件名能正常加载，反证了这一点。）
    let file_name = url
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(&family);
    let cached = cache_dir.join(file_name);
    let tmp = cache_dir.join(format!("{}.tmp", file_name));
    fs::write(&tmp, &bytes)?;
    fs::rename(&tmp, &cached)?;

    Ok(cached.to_string_lossy().to_string())
}

/// 检查本地字体缓存，存在则返回路径，否则返回 None。
/// 前端通过 convertFileSrc + fetch 流式加载，避免 IPC 传输二进制数据。
///
/// 兼容 v1.2.27 旧缓存：v1.2.27 用 family（无扩展名）作文件名，v1.2.28 改用
/// file_name（含扩展名）。先查新名，找不到再查旧名（family），找到则迁移为新名。
/// 迁移后旧文件消失，后续都走新名，一次性升级无残留。
#[tauri::command]
pub async fn get_cached_font_path(
    family: String,
    file_name: String,
    app: AppHandle,
) -> Result<Option<String>, AppError> {
    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Native(e.to_string()))?
        .join("font-cache");

    // 1. 先查新缓存名（file_name，含扩展名）
    let cached = cache_dir.join(&file_name);
    if cached.exists() {
        return Ok(Some(cached.to_string_lossy().to_string()));
    }

    // 2. 兼容旧缓存名（family，无扩展名）——v1.2.27 留下的
    //    找到则迁移为新名，之后都用新名定位，旧文件不再残留
    let legacy = cache_dir.join(&family);
    if legacy.exists() {
        // 迁移：把旧名重命名为新名
        match fs::rename(&legacy, &cached) {
            Ok(()) => return Ok(Some(cached.to_string_lossy().to_string())),
            Err(_) => {
                // 迁移失败（权限/跨盘等），退而求其次返回旧路径
                // 字体仍可加载，只是每次都要走 fallback 查找
                return Ok(Some(legacy.to_string_lossy().to_string()));
            }
        }
    }

    Ok(None)
}

/// 将字体字节写入本地缓存。
/// 同一个 family 覆盖写入。
#[tauri::command]
pub async fn save_font_cache(
    family: String,
    file_name: String,
    data: Vec<u8>,
    app: AppHandle,
) -> Result<(), AppError> {
    let _ = &family; // family 保留用于日志/将来扩展；缓存定位用 file_name（含扩展名）
    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Native(e.to_string()))?
        .join("font-cache");
    fs::create_dir_all(&cache_dir)?;
    let cached = cache_dir.join(&file_name);
    let tmp = cache_dir.join(format!("{}.tmp", &file_name));
    fs::write(&tmp, &data)?;
    fs::rename(&tmp, &cached)?;
    Ok(())
}
