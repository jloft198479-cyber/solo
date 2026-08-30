use crate::commands::document::mime_to_extension;
use crate::error::AppError;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::net::IpAddr;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use url::Url;

const MAX_REMOTE_IMAGE_BYTES: usize = 10 * 1024 * 1024;
static IMAGE_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// 判断主机名是否指向本机/内网（SSRF 常见跳板）。
/// 只覆盖字面量形式；域名解析后的内网地址（DNS rebinding）不在本函数职责内，
/// 因为那需要自建解析 + 连接层校验，收益不匹配本地编辑器面临的威胁模型。
fn is_blocked_host(host: &str) -> bool {
    // 去掉 IPv6 的字面量方括号：url crate 返回 [::1] 形式
    let bare = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);
    let name = bare.trim_end_matches('.').to_ascii_lowercase();

    if name == "localhost" || name.ends_with(".localhost") || name.ends_with(".local")
        || name.ends_with(".internal")
        || name == "metadata.google.internal"
    {
        return true;
    }

    match name.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            ip.is_loopback()
                || ip.is_private()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_multicast()
        }
        Ok(IpAddr::V6(ip)) => {
            if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
                return true;
            }
            // IPv4 内嵌地址（::ffff:127.0.0.1 与旧的 ::127.0.0.1）按 IPv4 规则判
            if let Some(v4) = ip.to_ipv4() {
                return v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified();
            }
            // fc00::/7 唯一本地；fe80::/10 链路本地（含云元数据常用的 fd00:ec2::254）
            let first = ip.segments()[0];
            (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
        Err(_) => false,
    }
}

/// 校验远程图片 URL：只允许 http/https，且主机不能是字面量的本机/内网地址。
/// 在发起请求前把关，避免恶意文档诱导编辑器对本地服务或云元数据端点代发请求。
fn validate_remote_image_url(raw: &str) -> Result<Url, AppError> {
    let url = Url::parse(raw.trim()).map_err(|_| AppError::validation("无效的图片 URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::validation("仅支持 http/https 图片链接"));
    }
    match url.host_str() {
        Some(host) if is_blocked_host(host) => {
            Err(AppError::validation("出于安全考虑，不加载本机或内网地址的图片"))
        }
        Some(_) => Ok(url),
        None => Err(AppError::validation("图片 URL 缺少主机名")),
    }
}

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
    // 校验通过后再发请求；请求与 Referer 都用校验后的规范化 URL，做到「校验什么就请求什么」
    let validated = String::from(validate_remote_image_url(&url)?);
    let client = image_client()?;
    let mut response = client
        .get(&validated)
        .header("Referer", &validated)
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

#[cfg(test)]
mod tests {
    use super::{validate_remote_image_url, MAX_REMOTE_IMAGE_BYTES};

    #[test]
    fn validate_remote_image_url_allows_public_urls() {
        for ok in [
            "https://example.com/a.png",
            "http://example.com/a.png",
            " https://example.com/a.png ",
        ] {
            assert!(validate_remote_image_url(ok).is_ok(), "expected ok for {ok}");
        }
    }

    #[test]
    fn validate_remote_image_url_rejects_non_http_scheme() {
        for bad in [
            "file:///C:/Windows/win.ini",
            "ftp://example.com/a.png",
            "gopher://example.com:70/a",
            "not a url",
        ] {
            assert!(
                validate_remote_image_url(bad).is_err(),
                "expected rejection for {bad}"
            );
        }
    }

    #[test]
    fn validate_remote_image_url_rejects_loopback_and_private_hosts() {
        for bad in [
            "http://127.0.0.1:8080/a.png",
            "http://localhost:3000/a.png",
            "http://0.0.0.0/a.png",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.5/a.png",
            "http://192.168.1.1/a.png",
            "http://172.16.3.2/a.png",
            "http://[::1]:8080/a.png",
            "http://[fd00:ec2::254]/a.png",
            "http://[::ffff:127.0.0.1]/a.png",
            "http://myhost.local/a.png",
            "http://svc.internal/a.png",
        ] {
            assert!(
                validate_remote_image_url(bad).is_err(),
                "expected SSRF rejection for {bad}"
            );
        }
    }

    #[test]
    fn remote_image_cap_is_ten_megabytes() {
        assert_eq!(MAX_REMOTE_IMAGE_BYTES, 10 * 1024 * 1024);
    }
}
