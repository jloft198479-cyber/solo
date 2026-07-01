use std::net::{TcpStream, ToSocketAddrs};
use std::sync::OnceLock;
use std::time::Duration;

static RESOLVED_PROXY: OnceLock<String> = OnceLock::new();

/// Returns the detected proxy URL, if any. Only available after calling [`resolve_proxy`].
pub fn get_proxy() -> Option<&'static str> {
    let s = RESOLVED_PROXY.get()?;
    if s.is_empty() { None } else { Some(s) }
}

/// Run proxy detection once. Subsequent calls return the cached result.
/// Priority: env vars > Git config > Windows registry > common port probing.
pub fn resolve_proxy() -> Option<&'static str> {
    if RESOLVED_PROXY.get().is_some() {
        return get_proxy();
    }

    let found = _resolve_proxy();
    if let Some(ref proxy) = found {
        eprintln!("[solo] proxy resolved: {proxy}");
    }

    let _ = RESOLVED_PROXY.set(found.unwrap_or_default());
    get_proxy()
}

fn _resolve_proxy() -> Option<String> {
    // Priority 1: env vars
    if let Some(proxy) = from_env() {
        return Some(proxy);
    }

    // Priority 2: Git config
    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    if let Some(proxy) = from_git_config() {
        return Some(proxy);
    }

    // Priority 3: Windows system proxy
    #[cfg(target_os = "windows")]
    if let Some(proxy) = from_windows_registry() {
        return Some(proxy);
    }

    // Priority 4: probe common proxy ports
    if let Some(proxy) = probe_common_ports() {
        return Some(proxy);
    }

    None
}

// ── Priority 1: Environment Variables ──────────────────────────

fn from_env() -> Option<String> {
    for var in &[
        "HTTPS_PROXY", "https_proxy",
        "HTTP_PROXY", "http_proxy",
        "ALL_PROXY", "all_proxy",
    ] {
        if let Ok(val) = std::env::var(var) {
            let trimmed = val.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    None
}

// ── Priority 2: Git Config ────────────────────────────────────

fn from_git_config() -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["config", "--global", "--get", "http.proxy"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let proxy = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if proxy.is_empty() {
        return None;
    }

    Some(normalize_proxy_url(proxy))
}

// ── Priority 3: Windows Registry ──────────────────────────────

#[cfg(target_os = "windows")]
fn from_windows_registry() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let internet_settings = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        .ok()?;

    let proxy_enable: u32 = internet_settings.get_value("ProxyEnable").ok()?;
    if proxy_enable != 1 {
        return None;
    }

    let proxy_server: String = internet_settings.get_value("ProxyServer").ok()?;
    if proxy_server.is_empty() {
        return None;
    }

    // Windows proxy format can be:
    //   "host:port"                           — single proxy for all protocols
    //   "http=host1:port1;https=host2:port2"  — per-protocol
    let parts: Vec<&str> = proxy_server.split(';').collect();
    if parts.len() == 1 {
        return Some(normalize_proxy_url(proxy_server));
    }

    // Prefer HTTPS proxy
    for part in &parts {
        let kv: Vec<&str> = part.splitn(2, '=').collect();
        if kv.len() == 2 && kv[0].trim().to_lowercase() == "https" {
            let val = kv[1].trim();
            if !val.is_empty() {
                return Some(normalize_proxy_url(val.to_string()));
            }
        }
    }

    // Fallback to HTTP
    for part in &parts {
        let kv: Vec<&str> = part.splitn(2, '=').collect();
        if kv.len() == 2 && kv[0].trim().to_lowercase() == "http" {
            let val = kv[1].trim();
            if !val.is_empty() {
                return Some(normalize_proxy_url(val.to_string()));
            }
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
fn from_windows_registry() -> Option<String> {
    None
}

// ── Priority 4: Port Probing ──────────────────────────────────

const PROXY_CANDIDATES: &[(&str, u16)] = &[
    ("127.0.0.1", 7890),  // Clash / Clash Verge
    ("127.0.0.1", 10809), // v2rayN
    ("127.0.0.1", 1080),  // SSR / Shadowsocks
    ("127.0.0.1", 8118),  // Privoxy
    ("127.0.0.1", 8080),  // Generic HTTP proxy
];

fn probe_common_ports() -> Option<String> {
    for (host, port) in PROXY_CANDIDATES {
        let addr = format!("{host}:{port}");
        if let Ok(mut addrs) = addr.to_socket_addrs() {
            if let Some(sock_addr) = addrs.next() {
                if TcpStream::connect_timeout(&sock_addr, Duration::from_millis(200)).is_ok() {
                    return Some(format!("http://{addr}"));
                }
            }
        }
    }
    None
}

// ── URL Normalization ─────────────────────────────────────────

fn normalize_proxy_url(proxy: String) -> String {
    let proxy = proxy.trim().to_string();
    if proxy.contains("://") {
        proxy
    } else {
        format!("http://{proxy}")
    }
}
