/// 按需代理检测：仅在用户手动检查更新时运行，零启动开销。
/// 检测优先级：HTTPS_PROXY 环境变量 → Windows 系统代理 → 本地常见代理端口
use std::time::Duration;
use tokio::net::TcpStream;

/// 检测 GitHub 更新所需的代理，返回代理 URL。
/// 未检测到时返回 None（表示直连）。
pub async fn detect_github_proxy() -> Option<String> {
    // 1. 环境变量检查（即时，优先级最高）
    if let Some(proxy) = check_env_proxy() {
        return Some(proxy);
    }

    // 2. Windows 系统代理（即时，读注册表）
    #[cfg(target_os = "windows")]
    if let Some(proxy) = check_system_proxy() {
        return Some(proxy);
    }

    // 3. 本地代理端口扫描（仅前两步失败时）
    //    只扫 Clash(7890) 和 V2Ray(10809) 两个常见端口，50ms 超时/端口
    check_local_ports().await
}

/// 检查环境变量 HTTPS_PROXY / HTTP_PROXY
fn check_env_proxy() -> Option<String> {
    for var in &["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        if let Ok(val) = std::env::var(var) {
            let val = val.trim().to_string();
            if !val.is_empty() && !val.starts_with("socks") {
                return Some(val);
            }
        }
    }
    None
}

/// 读取 Windows 系统代理设置（HKCU\Internet Settings）
#[cfg(target_os = "windows")]
fn check_system_proxy() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let settings = hkcu
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        .ok()?;

    let enabled: u32 = settings.get_value("ProxyEnable").ok()?;
    if enabled == 0 {
        return None;
    }

    let server: String = settings.get_value("ProxyServer").ok()?;
    if server.is_empty() {
        return None;
    }

    // 格式: "host:port" 或 "http=host:port;https=host:port;..."
    for entry in server.split(';') {
        let addr = entry
            .strip_prefix("https=")
            .or_else(|| entry.strip_prefix("http="))
            .unwrap_or(entry)
            .trim();
        if !addr.is_empty() {
            return Some(format!("http://{}", addr));
        }
    }
    None
}

/// 扫描本地代理端口：仅 Clash(7890) 和 V2Ray(10809)
async fn check_local_ports() -> Option<String> {
    for &port in &[7890u16, 10809] {
        let Ok(Ok(_)) = tokio::time::timeout(
            Duration::from_millis(50),
            TcpStream::connect(("127.0.0.1", port)),
        )
        .await
        else {
            continue;
        };
        return Some(format!("http://127.0.0.1:{}", port));
    }
    None
}
