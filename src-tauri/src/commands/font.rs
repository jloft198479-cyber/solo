use crate::error::AppError;
use std::fs;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use url::Url;

static FONT_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// 字体下载/缓存体积上限。合法中文字体最大 ~20MB（8-15MB 常见），留足余量；
/// 无上限时恶意/异常响应可把内存与磁盘吃穿（image.rs 的远程图有同款上限，审计 R-4）。
const MAX_FONT_BYTES: usize = 32 * 1024 * 1024;

/// 校验字体下载 URL：只允许 https。
/// 当前唯一调用方 fontLoader.ts 用的是硬编码 https 常量，此校验不改变正常行为，
/// 只堵住命令被传入任意 URL（file:// / http:// 明文）时的读取与降级风险。
/// 刻意不做主机白名单：GitHub release 下载会 302 跳到 objects.githubusercontent.com，
/// 白名单会打断下载——字体链路有「连修四版才修对」的历史，不再引入新的失效面。
fn validate_font_url(raw: &str) -> Result<String, AppError> {
    let url = Url::parse(raw.trim()).map_err(|_| AppError::validation("无效的字体 URL"))?;
    if url.scheme() != "https" {
        return Err(AppError::validation("字体仅支持 https 下载"));
    }
    if url.host_str().is_none() {
        return Err(AppError::validation("字体 URL 缺少主机名"));
    }
    Ok(String::from(url))
}

/// 校验缓存文件名/族名必须是「单段、非路径」形态：拒绝空串、路径分隔符、`..`
/// 与盘符冒号。此前 save/read/get_cached 三族命令把 IPC 入参直接 `join` 进
/// font-cache 目录——`file_name="../..x"` 可把读写锚点挪出缓存目录（`read_font_bytes`
/// 更是整文件读出经 IPC 回传，等于任意文件读取）。与 document/image 命令族的
/// #9 治理对齐（审计 R-4，两个独立审计分区交叉命中）。
fn validate_font_file_name(name: &str) -> Result<(), AppError> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains(':')
    {
        return Err(AppError::validation("非法的字体缓存文件名"));
    }
    Ok(())
}

fn font_client() -> Result<reqwest::Client, AppError> {
    if let Some(client) = FONT_CLIENT.get() {
        return Ok(client.clone());
    }

    // reqwest 配 rustls-tls（不读系统证书库），但开启 system-proxy feature 后
    // 会自动读环境变量（HTTP_PROXY/HTTPS_PROXY）+ Windows 注册表系统代理，
    // 让 rustls-tls 也能走系统代理下载字体，网络受限环境下不再失败。
    //
    // 重定向策略：GitHub release 依赖 302（见 validate_font_url 注释），不能禁；
    // 但只许 https 跳转——默认策略会跟到任何协议，`https://x` 302 到
    // `http://y` 时「仅 https」校验被静默打穿成明文（审计 R-4）。
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() != "https" {
                attempt.error("字体重定向必须保持 https")
            } else if attempt.previous().len() > 10 {
                attempt.error("字体重定向次数过多")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|error| AppError::Network(format!("创建客户端失败: {}", error)))?;

    let _ = FONT_CLIENT.set(client);
    FONT_CLIENT.get().cloned().ok_or_else(|| AppError::Network("Client init failed".into()))
}

/// 校验字体文件完整性：magic bytes + 表目录 offset+length ≤ 文件大小。
/// 防止截断/损坏的字体被写入缓存（GitHub release 曾被截断导致四版修复无效）。
fn validate_font_bytes(bytes: &[u8]) -> Result<(), AppError> {
    if bytes.len() < 12 {
        return Err(AppError::Network(format!(
            "字体文件过小（{} bytes），疑似截断",
            bytes.len()
        )));
    }
    let magic = &bytes[0..4];
    if magic != b"OTTO" && magic != b"\x00\x01\x00\x00" {
        return Err(AppError::Network(format!(
            "字体 magic bytes 无效: {:02x?}，非 OTF/TTF 格式",
            magic
        )));
    }
    let num_tables = u16::from_be_bytes([bytes[4], bytes[5]]) as usize;
    let file_size = bytes.len() as u64;
    for i in 0..num_tables {
        let off = 12 + i * 16;
        if off + 16 > bytes.len() {
            return Err(AppError::Network(
                "字体表目录超出文件范围，文件已截断".into(),
            ));
        }
        let offset = u32::from_be_bytes([bytes[off + 8], bytes[off + 9], bytes[off + 10], bytes[off + 11]]) as u64;
        let length = u32::from_be_bytes([bytes[off + 12], bytes[off + 13], bytes[off + 14], bytes[off + 15]]) as u64;
        if offset + length > file_size {
            return Err(AppError::Network(format!(
                "字体表 {} 数据越界（offset={} + length={} > file_size={}），文件已截断",
                i, offset, length, file_size
            )));
        }
    }
    Ok(())
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
    let url = validate_font_url(&url)?;
    let mut response = font_client()?.get(&url).send().await?;
    // 流式接收并设上限（见 MAX_FONT_BYTES）：一次性 bytes() 会先全量落内存，
    // 上限形同虚设（审计 R-4）
    let mut bytes: Vec<u8> = Vec::with_capacity(1024 * 1024);
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > MAX_FONT_BYTES {
            return Err(AppError::Network(format!(
                "字体文件超过 {}MB 上限，拒绝下载",
                MAX_FONT_BYTES / 1024 / 1024
            )));
        }
        bytes.extend_from_slice(&chunk);
    }

    // 下载后立即校验完整性，拒绝截断/损坏文件（不写入缓存）
    validate_font_bytes(&bytes)?;

    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Native(e.to_string()))?
        .join("font-cache");
    // 缓存文件名用 URL 末段（含扩展名，如 NotoSerifSC-Regular.otf）。
    // 历史背景：v1.2.27 用 family（如 "Noto Serif SC"，无扩展名）作文件名；
    // v1.2.28 改为 fileName 后旧缓存无法被新代码识别（key 不匹配），被迫重新下载。
    // 用 fileName 而非 family 的真正原因：与 FONT_OPTIONS 的 fileName 字段对齐，
    // 让前端 getCachedFontPath(family, fileName) 与 Rust 落盘文件名严格一致，
    // 避免前端 family 字符串与磁盘文件名之间的二次映射。
    // （早期注释说"无扩展名导致 Content-Type 推断失败"是错误的——v1.2.27 时
    // 无扩展名的 family 文件名能正常加载，反证了这一点。）
    // 磁盘 IO（写 8-15MB 字体）放 spawn_blocking，不压 tokio worker 线程（对齐 #2 标准）。
    let cached = tauri::async_runtime::spawn_blocking(move || -> Result<std::path::PathBuf, AppError> {
        fs::create_dir_all(&cache_dir)?;
        let file_name = url
            .rsplit('/')
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or(&family)
            .to_string();
        // URL 末段与 family 兜底都是「会被 join 进缓存目录」的名字，双双校验
        validate_font_file_name(&file_name)?;
        validate_font_file_name(&family)?;
        let cached = cache_dir.join(&file_name);
        let tmp = cache_dir.join(format!("{}.tmp", file_name));
        fs::write(&tmp, &bytes)?;
        fs::rename(&tmp, &cached)?;
        Ok(cached)
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))??;

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
    validate_font_file_name(&family)?;
    validate_font_file_name(&file_name)?;
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
    validate_font_file_name(&family)?;
    validate_font_file_name(&file_name)?;
    let _ = &family; // family 保留用于日志/将来扩展；缓存定位用 file_name（含扩展名）
    // 校验字体完整性，拒绝截断/损坏数据
    validate_font_bytes(&data)?;
    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Native(e.to_string()))?
        .join("font-cache");
    // 磁盘 IO（写 8-15MB 字体）放 spawn_blocking（对齐 #2 标准）
    tauri::async_runtime::spawn_blocking(move || -> Result<(), AppError> {
        fs::create_dir_all(&cache_dir)?;
        let cached = cache_dir.join(&file_name);
        let tmp = cache_dir.join(format!("{}.tmp", &file_name));
        fs::write(&tmp, &data)?;
        fs::rename(&tmp, &cached)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))??;
    Ok(())
}

/// 读取字体缓存的字节内容。
///
/// 前端通过 IPC 读取字节后创建 blob URL 加载 FontFace，
/// 绕过 FontFace API 对 asset URL 的 CORS 限制。
///
/// FontFace API 默认走 CORS 模式，而 Tauri asset protocol 不返回
/// Access-Control-Allow-Origin 头，导致 `new FontFace(family, "url('asset...')")`
/// 的 `fontFace.load()` 被 CORS 拦截。
///
/// 用 blob URL（同源）完全绕过 CORS。代价是 IPC 传输几 MB 字节，
/// 但只在字体切换时执行一次，之后被 loadedFonts 缓存，可接受。
#[tauri::command]
pub async fn read_font_bytes(
    family: String,
    file_name: String,
    app: AppHandle,
) -> Result<Vec<u8>, AppError> {
    validate_font_file_name(&family)?;
    validate_font_file_name(&file_name)?;
    // 磁盘 IO（读 8-15MB 字体 ×2 路径探测）放 spawn_blocking（对齐 #2 标准）
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, AppError> {
        let cache_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| AppError::Native(e.to_string()))?
            .join("font-cache");

        // 先查新名（file_name，含扩展名）
        let cached = cache_dir.join(&file_name);
        if cached.exists() {
            return Ok(fs::read(&cached)?);
        }

        // 再查旧名（family，无扩展名）——v1.2.27 兼容
        let legacy = cache_dir.join(&family);
        if legacy.exists() {
            let bytes = fs::read(&legacy)?;
            // 迁移为新名
            let _ = fs::rename(&legacy, &cached);
            return Ok(bytes);
        }

        Ok(Vec::new())
    })
    .await
    .map_err(|e| AppError::Native(format!("任务调度失败: {}", e)))?
}

#[cfg(test)]
mod tests {
    use super::{validate_font_file_name, validate_font_url};

    #[test]
    fn validate_font_url_accepts_https_release_url() {
        // 与 fontLoader.ts 的 FONT_SOURCES 同形：加固不能打断真实下载链路
        let url = "https://github.com/jloft198479-cyber/solo/releases/download/fonts-v1/NotoSerifSC-Regular.otf";
        assert_eq!(validate_font_url(url).unwrap(), url);
    }

    #[test]
    fn validate_font_url_rejects_non_https_and_garbage() {
        for bad in [
            "http://github.com/any/font.ttf",
            "file:///C:/Windows/Fonts/evil.ttf",
            "not a url",
        ] {
            assert!(
                validate_font_url(bad).is_err(),
                "expected rejection for {bad}"
            );
        }
    }

    // 审计 R-4：缓存名必须是「单段、非路径」形态，防 IPC 入参把读写锚点挪出
    // font-cache 目录（read_font_bytes 曾可整文件读出任意路径经 IPC 回传）
    #[test]
    fn validate_font_file_name_rejects_path_shapes() {
        for ok in ["NotoSerifSC-Regular.otf", "LXGWWenKaiLite.ttf", "a"] {
            assert!(validate_font_file_name(ok).is_ok(), "expected accept for {ok}");
        }
        for bad in [
            "",
            "..",
            "../evil.otf",
            "..\\..\\evil.otf",
            "sub/dir/font.otf",
            "C:\\Windows\\evil.otf",
            "C:/Windows/evil.otf",
            "a:b.otf",
        ] {
            assert!(
                validate_font_file_name(bad).is_err(),
                "expected rejection for {bad}"
            );
        }
    }
}
