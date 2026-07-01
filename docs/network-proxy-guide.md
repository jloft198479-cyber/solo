# 网络与代理配置指南

> 适用对象：solo 用户（尤其是中国大陆地区用户）
> 关联：自动更新功能、在线资源下载

---

## 背景

solo 的自动更新功能依赖 Tauri 的 `tauri-plugin-updater` 插件，底层使用 Rust `reqwest` HTTP 客户端从 GitHub Release 拉取更新信息。

在中国大陆，访问 GitHub 通常需要代理工具。不同用户的代理配置方式各不相同，这导致了部分用户虽然能正常上网，但应用内的更新检查却失败。

从 v1.2.16 开始，solo 内置了自动代理检测机制，覆盖了绝大部分场景。如果你仍然遇到更新失败的问题，可以参考本文档排查。

## 代理检测机制（v1.2.16+）

solo 按以下优先级自动检测代理，命中即停：

| 优先级 | 检测来源 | 说明 |
|-------|---------|------|
| 1 | 环境变量 | `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`（大小写均识别） |
| 2 | Git 全局配置 | `git config --global http.proxy` |
| 3 | Windows 注册表 | 系统代理设置（Internet 选项中的代理服务器） |
| 4 | 端口探测 | 自动探测 `127.0.0.1` 上的常见代理端口（7890/10809/1080/8118/8080） |

> 如果通过环境变量或系统代理等方式正确配置了代理，检测到后即可自动用于更新请求，无需额外操作。

## 常见场景配置

### 场景 1：VPN 使用 TUN 模式（推荐）

TUN 模式在系统层面创建虚拟网卡，全局接管流量。solo 的 `reqwest` 无需任何额外配置即可正常工作。

**验证方法：**
```bash
curl -I https://github.com
```
如果返回 HTTP 2xx，说明 TUN 模式生效。

**结论：** 无需任何配置，自动更新正常工作。

### 场景 2：VPN 使用系统代理模式

部分代理工具设置为"系统代理"模式，会写入 Windows Internet 选项。solo 会从注册表读取此配置（优先级 3）。

**验证方法：**
1. 打开 Windows「设置 → 网络和 Internet → 代理」
2. 检查"使用代理服务器"是否已开启

**结论：** solo 会自动检测并使用，无需额外配置。

### 场景 3：VPN 仅配置了 Git 代理（最常见的问题来源）

许多用户通过以下方式让 Git 走代理：
```bash
git config --global http.proxy 127.0.0.1:9098
```
但并未设置系统环境变量或系统代理。此时 `gh` CLI 正常工作，但 `curl` 和 solo 的更新检查均会失败。

**解决方法：** 设置环境变量（选任意一种）

**方法 A（当前终端生效）：**
```bash
# bash (Git Bash / WSL)
export HTTPS_PROXY=http://127.0.0.1:9098
export HTTP_PROXY=http://127.0.0.1:9098
```
```powershell
# PowerShell
$env:HTTPS_PROXY = 'http://127.0.0.1:9098'
$env:HTTP_PROXY = 'http://127.0.0.1:9098'
```
*如果你的代理端口不同，替换 `9098` 为实际端口。*

**方法 B（持久化，所有终端生效）：**
1. 打开 Windows「设置 → 系统 → 系统信息 → 高级系统设置 → 环境变量」
2. 新建系统变量 `HTTPS_PROXY`，值为 `http://127.0.0.1:9098`
3. 新建系统变量 `HTTP_PROXY`，值为 `http://127.0.0.1:9098`
4. 重启 solo 即可

**方法 C（仅适用于 solo v1.2.16+，推荐）：**
solo v1.2.16+ 会自动检测常见代理端口。如果你的代理工具运行在默认端口（见场景 4），无需任何配置即可工作。如果自动检测失败，再用手动设置。

### 场景 4：V2Ray / Clash / SSR 等客户端（端口模式）

这些工具通常在本地监听特定端口：

| 工具 | 默认代理地址 |
|------|-------------|
| Clash Verge / Clash Meta | `http://127.0.0.1:7890` |
| v2rayN | `http://127.0.0.1:10809` |
| SS / SSR | `socks5://127.0.0.1:1080`（HTTP 代理一般为 `http://127.0.0.1:1080`）|
| Privoxy | `http://127.0.0.1:8118` |

solo v1.2.16+ 会自动探测这些端口（优先级 4）。如果自动探测失败，手动设置环境变量即可（详见场景 3）。

### 场景 5：无需代理（直连可用时）

某些网络环境（如部分企业网络、教育网）可直接访问 GitHub。此时 solo 会直接连接，无需任何代理配置。

## 适用范围

代理检测结果不仅用于自动更新，还用于以下内置网络请求：

- **自动更新** — 检测 GitHub Release 新版本
- **字体下载** — 编辑器内使用的远程字体文件
- **远程图片** — 粘贴/拖拽的远程图片 URL

所有场景共享同一套检测结果，无需分别配置。

## 环境变量参考

| 变量名 | 示例值 | 说明 |
|-------|--------|------|
| `HTTPS_PROXY` | `http://127.0.0.1:7890` | HTTPS 请求的代理地址 |
| `HTTP_PROXY` | `http://127.0.0.1:7890` | HTTP 请求的代理地址 |
| `ALL_PROXY` | `http://127.0.0.1:7890` | 全部请求的代理地址 |

- 环境变量可直接设为 bare host:port（如 `127.0.0.1:9098`）或完整 URL（如 `http://127.0.0.1:9098`）
- 建议将 `HTTPS_PROXY` 和 `HTTP_PROXY` 都设置

## 验证联网是否正常

在终端执行以下命令：
```bash
curl -I https://github.com
```

- 返回 `HTTP/2 200` → 直连或 TUN 模式，solo 无需配置
- 返回 `HTTP/2 200`（但需要 `curl -x http://127.0.0.1:xxxx` 才能通）→ 需要环境变量
- 返回 `curl: (7) Failed to connect` → 无法连接 GitHub，需要代理工具

## 故障排查流程

```
更新失败？
  │
  ├─ 浏览器能否打开 github.com？
  │   ├─ 否 → 先解决网络问题（开启 VPN/代理）
  │   └─ 是 → 继续排查
  │
  ├─ 终端执行 curl -I https://github.com 能通吗？
  │   ├─ 是 → 检查是否用了较旧版本的 solo（升级到 v1.2.16+）
  │   └─ 否 → 继续排查
  │
  ├─ 设置了 HTTPS_PROXY 环境变量吗？
  │   ├─ 否 → 设置后重试（见场景 3）
  │   └─ 是 → 继续排查
  │
  └─ 检查代理端口是否正确
      常见端口：7890(Clash) / 10809(v2rayN) / 1080(SSR)
```

## 技术说明（面向开发者）

### reqwest 平台差异

`reqwest::Proxy::system()` 在不同平台行为不同：

| 平台 | 代理发现方式 |
|------|-------------|
| macOS / Linux | 读取 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` 环境变量 |
| Windows | 调用 WinHTTP API（与浏览器/IE 使用的 WinINET 不同），**不读环境变量** |

这就是只设 `HTTPS_PROXY` 在 macOS/Linux 上有效、在 Windows 上无效的原因。

### solo 的双重注入策略（v1.2.16+）

solo 在 `src-tauri/src/proxy.rs` 完成 4 级检测后，在 `src-tauri/src/lib.rs::run()` 中做了两件事：

```rust
// 1. 设置 HTTPS_PROXY 环境变量（macOS/Linux 的 reqwest 会读取）
std::env::set_var("HTTPS_PROXY", proxy);

// 2. 直接注入 updater builder（跨平台生效，Windows 绕过 WinHTTP）
updater = updater.proxy(url);  // 内部使用 reqwest::Proxy::https()
```

双重注入确保无论用户在哪個平台，updater 都能用上检测到的代理。同时 `image.rs` / `font.rs` 的 `OnceLock<Client>` 也在构建时调用 `proxy::get_proxy()` 设置代理。

### 安全说明

- 检测是**只读**的：不写注册表、不修改系统代理设置、不创建文件
- 端口探测只连 `127.0.0.1`（不回测试远程地址）
- 每个端口超时 200ms，最多 5 个候选端口，耗时不超过 1s
- 环境变量仅在 solo 进程内设置，不影响其他进程

### 已知限制

- 端口探测固定报 `http://` 前缀，不支持纯 `socks5://` 代理（reqwest 需要启用 `socks` feature 才支持）

---

*文档维护：如代理检测逻辑有更新，请同步更新本文档。*
