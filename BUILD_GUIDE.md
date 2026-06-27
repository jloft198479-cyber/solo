# solo 系统编译说明书

> **目标**：任何开发者（人或 AI）按此文档操作，均可在干净 Windows 环境下成功编译 solo。
> **适用范围**：Windows 10+ x64，Tauri v2.11.2，Rust 1.96.0，Bun 1.3.14。
> **最后验证**：2026-06-27，`vue-tsc --noEmit` ✅ → `vite build` ✅ → `cargo build --release` ✅ → `makensis` ✅

---

## 目录

1. [技术栈速览](#1-技术栈速览)
2. [环境准备](#2-环境准备)
3. [环境变量配置（关键！）](#3-环境变量配置关键)
4. [分步编译](#4-分步编译)
5. [自动化脚本](#5-自动化脚本)
6. [踩坑实录](#6-踩坑实录)
7. [故障排查](#7-故障排查)
8. [附录](#8-附录)

---

## 1. 技术栈速览

| 层 | 技术 | 版本 | 说明 |
|---|---|---|---|
| 桌面框架 | Tauri | 2.11.2 | 无边框窗口、插件体系 |
| 原生核心 | Rust | 1.96.0 | edition 2021, release profile opt-level=3 |
| 前端框架 | Vue 3 | 3.5 | Composition API + `<script setup>` |
| 构建 | Vite | 7.x | |
| 类型检查 | vue-tsc | 3.3.4 | |
| 包管理器 | Bun | 1.3.14 | 也兼容 npm |
| 样式 | Tailwind CSS 4 | 4.3 | |
| 编辑器 | TipTap / ProseMirror | 3.26 | |
| 包格式 | NSIS | — | 安装包产出 `.exe` |

**项目路径**：`F:\fzz-Project\md-editor\md-editor`

---

## 2. 环境准备

### 2.1 必需工具

| 工具 | 最低版本 | 获取方式 |
|---|---|---|
| Rust toolchain | 1.96.0 | `rustup-init.exe` |
| MSVC Build Tools | v14.44+ | Visual Studio Build Tools 2022 |
| WebView2 | — | Windows 10+ 内置，无需单独安装 |
| Bun | 1.3.14 | `powershell -c "irm bun.sh/install.ps1 | iex"` |

### 2.2 Rust 工具链安装

1. 下载 `rustup-init.exe` 并运行，选择默认安装（stable-x86_64-pc-windows-msvc）。
2. 安装完成后确认：
   ```
   rustc --version    # rustc 1.96.0 (ac68faa20 2026-05-25)
   cargo --version    # cargo 1.96.0
   rustup show        # active toolchain: stable-x86_64-pc-windows-msvc
   ```

### 2.3 MSVC Build Tools 安装

1. 下载 [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)。
2. 安装时勾选：
   - **使用 C++ 的桌面开发**（Desktop development with C++）
   - 右侧必选组件：MSVC v143 生成工具 + Windows 10/11 SDK
3. 安装后确认 `vcvars64.bat` 存在：
   - 典型路径：`M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat`
   - 如果使用默认安装路径，通常在 `C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\`

### 2.4 前端依赖安装

```bash
cd F:\fzz-Project\md-editor\md-editor
bun install
```

如果 `bun install` 因网络问题失败，改用 npm：

```bash
npm install
```

---

## 3. 环境变量配置（关键！）

**这是最容易踩坑的地方，请严格按照以下步骤操作。**

### 3.1 必需的变量

```bash
set CARGO_HOME=M:\rust\.cargo
set RUSTUP_HOME=M:\rust\.rustup
set PATH=M:\rust\.cargo\bin;%PATH%
```

> 如果 Rust 安装在默认路径，上述路径应调整为：
> ```
> set CARGO_HOME=C:\Users\<用户名>\.cargo
> set RUSTUP_HOME=C:\Users\<用户名>\.rustup
> set PATH=%CARGO_HOME%\bin;%PATH%
> ```

### 3.2 ⚠️ RUSTUP_HOME 末尾空格陷阱

**从 PowerShell 运行 `.bat` 时，`RUSTUP_HOME` 末尾可能被附加空格。**

例如 `cmd /c "set RUSTUP_HOME=M:\rust\.rustup"` 在 PowerShell 中执行后，变量值可能变为 `"M:\rust\.rustup "`（末尾多一个空格），导致 `rustup` 找不到工具链。

**解决方案**：
- 直接在 `.bat` 文件中设置变量（不要通过 `cmd /c`）。
- 或者使用本仓库提供的 `launch-dev.bat` / `build_solo_tauri.bat`。

### 3.3 CARGO_HOME 大小写敏感

`CARGO_HOME` 和 `RUSTUP_HOME` 必须使用**全大写**形式，不能写成 `CargoHome` 或 `cargo_home`。

---

## 4. 分步编译

### 4.1 编译流程总览

```
src/ (Vue + TS)  ──vue-tsc──▶ 类型检查
                             ──vite build──▶ dist/ (前端产物)

src-tauri/src/ (Rust)  ──cargo build --release──▶ solo.exe
                                                  ──makensis──▶ solo_1.2.2_x64-setup.exe
```

`solo.exe` → 绿色可执行文件
`solo_1.2.2_x64-setup.exe` → NSIS 安装包

### 4.2 方式一：前端独立编译（验证前端改动）

```bash
cd F:\fzz-Project\md-editor\md-editor
bun run build
```

内部等价于：`vue-tsc --noEmit && vite build`

产出：`dist/` 目录。

### 4.3 方式二：Rust 独立编译（验证 Rust 改动）

```batch
call M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat
set CARGO_HOME=M:\rust\.cargo
set RUSTUP_HOME=M:\rust\.rustup
set PATH=M:\rust\.cargo\bin;%PATH%
cargo build --release --manifest-path src-tauri\Cargo.toml
```

产出：`src-tauri\target\release\solo.exe`

### 4.4 方式三：完整打包（一键生成安装包）

```batch
cd F:\fzz-Project\md-editor\md-editor
bun run build                                          # 前端构建
call M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat  # MSVC 环境
set CARGO_HOME=M:\rust\.cargo
set RUSTUP_HOME=M:\rust\.rustup
set PATH=M:\rust\.cargo\bin;%PATH%
bunx tauri build                                       # Rust 编译 + NSIS 打包
```

> **注意**：`bunx tauri build` 会在内部自动触发 `bun run build`，因此不需要手动执行第 1 步。上例展示的是分离控制权的情况。

### 4.5 关键参数说明

| 参数 | 说明 |
|---|---|
| `--release` | 启用优化（opt-level=3），编译更慢但产物更快 |
| `--manifest-path` | 指定 `Cargo.toml` 路径，避免在 `src-tauri/` 目录下执行 |
| `bunx tauri build` | Tauri CLI 的完整打包命令，含 Rust 编译 + NSIS 打包 |
| `bun run build` | 前端构建，等价于 `vue-tsc --noEmit && vite build` |

---

## 5. 自动化脚本

### 5.1 `launch-dev.bat` — 开发模式启动

位置：项目根目录

```batch
@echo off
title Solo Dev

set CARGO_HOME=M:\rust\.cargo
set RUSTUP_HOME=M:\rust\.rustup
set PATH=%CARGO_HOME%\bin;%PATH%

set HTTP_PROXY=
set HTTPS_PROXY=
set CARGO_HTTP_CHECK_REVOKE=false

set VCVARS=M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat
if exist "%VCVARS%" (
    call "%VCVARS%" >nul
)

cd /d "F:\fzz-Project\md-editor\md-editor"

echo.
echo === Solo Dev ===
rustc --version

npx tauri dev

pause
```

### 5.2 `build_solo_full.bat` — 前端 + Rust 编译（不含打包）

位置：`M:\temp\build_solo_full.bat`

```batch
@echo off
chcp 65001 >nul
echo ===== 1/3 Frontend: vue-tsc + vite build =====
cd /d F:\fzz-Project\md-editor\md-editor
call bun run build
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

echo ===== 2/3 Rust: cargo build --release =====
call M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat >nul
set CARGO_HOME=M:\rust\.cargo
set RUSTUP_HOME=M:\rust\.rustup
set PATH=M:\rust\.cargo\bin;%PATH%
cargo build --release --manifest-path src-tauri\Cargo.toml
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

echo ===== 全部通过 =====
echo 可执行文件: src-tauri\target\release\solo.exe
```

### 5.3 `build_solo_tauri.bat` — 完整打包（含安装包）

位置：`M:\temp\build_solo_tauri.bat`

```batch
@echo off
chcp 65001 >nul
cd /d F:\fzz-Project\md-editor\md-editor

REM Step 1: frontend
echo ===== 1/2 Frontend build =====
call bun run build
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

REM Step 2: Tauri bundle
echo ===== 2/2 Tauri build (bundle) =====
call M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat >nul
set CARGO_HOME=M:\rust\.cargo
set RUSTUP_HOME=M:\rust\.rustup
set PATH=M:\rust\.cargo\bin;%PATH%
call bunx tauri build
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

echo ===== Done =====
```

### 5.4 构建产出

| 文件 | 路径 | 说明 |
|---|---|---|
| `solo.exe` | `src-tauri\target\release\solo.exe` | 绿色可执行文件（约 15MB） |
| `solo_1.2.2_x64-setup.exe` | `src-tauri\target\release\bundle\nsis\solo_1.2.2_x64-setup.exe` | NSIS 安装包 |

---

## 6. 踩坑实录

### 6.1 `RUSTUP_HOME` 末尾空格

**现象**：`rustc --version` 正常，但 `cargo build` 报错找不到工具链。

**原因**：PowerShell 中执行 `cmd /c "set RUSTUP_HOME=M:\rust\.rustup" `可能引入尾部空格。

**解决**：始终在 `.bat` 文件中设置变量，或在 PowerShell 中使用：
```powershell
$env:RUSTUP_HOME = "M:\rust\.rustup"
```
（确保引号闭合后无空格）

### 6.2 `bunx tauri build` 必须在项目根目录执行

**现象**：在 `src-tauri/` 目录下运行 `bunx tauri build` 报错。

**原因**：Tauri CLI 需要从 `tauri.conf.json` 所在目录（项目根目录）运行，因为它需要读取 `beforeBuildCommand`、`frontendDist` 等配置。

**解决**：任何 Tauri CLI 命令（`dev` / `build`）都从项目根目录执行：
```bash
cd F:\fzz-Project\md-editor\md-editor
bunx tauri build
```

### 6.3 `cargo check` 不通过但 `cargo build` 通过

**现象**：`cargo check` 报错，但 `cargo build --release` 成功。

**原因**：罕见，可能与 MSVC 工具链解析顺序有关。以 `cargo build` 为准。

### 6.4 MSVC 环境激活顺序

**现象**：`cargo build` 报错 `link.exe` 未找到。

**原因**：Cargo 需要 MSVC 的链接器，必须先执行 `vcvars64.bat` 激活环境。

**解决**：每次打开新终端或启动新进程时，都要先执行：
```batch
call M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat
```

### 6.5 `on_window_event` 只能注册一个回调

**现象**：后续注册的 `on_window_event` 覆盖了之前的。

**原因**：Tauri v2 的 `Window::on_window_event` 内部使用 `take`，只保留最后一个回调。

**解决**：在 `attach_window_events()` 中**合并所有逻辑**到单个回调中（close 拦截 + focus/blur + destroyed 清理）。

参考代码：`src-tauri/src/commands/window.rs`

### 6.6 `window.set_focus()` 受 Windows 前台锁限制

**现象**：`create_editor_window` 后调用 `set_focus()` 有时不生效。

**原因**：Windows 只允许前台进程（或最近的前台进程）调用 `SetForegroundWindow`。

**解决**：不依赖 `set_focus()` 总是成功。前端通过 `setTimeout(50ms)` 兜底检测 `document.hasFocus()`，必要时手动初始化编辑器。

### 6.7 `app.exit(0)` 必须在 IPC 线程调用

**现象**：在主线程调用 `AppHandle::exit()` 导致 `Chrome_WidgetWin_0` 错误。

**原因**：Tauri v2 中 `exit()` 不能从主线程调用。

**解决**：通过 `#[tauri::command]` 暴露 `exit_app` 命令，在 IPC 异步线程中执行 `app.exit(0)`。前端 `handleQuit` 在窗口 destroyed 事件后调用。

### 6.8 `StateFlags::FULLSCREEN` 导致窗口尺寸错乱

**现象**：以全屏模式退出后重新启动，窗口尺寸不恢复。

**原因**：已知 Tauri bug（issue #3215），`FULLSCREEN` 标志位被持久化后干扰窗口状态恢复。

**解决**：从 `StateFlags` 中移除 `FULLSCREEN`，只保留 `SIZE | POSITION | MAXIMIZED | VISIBLE | DECORATION`。

### 6.9 `bun run build` 的输出警告可以忽略

以下警告不影响构建结果，可安全忽略：

```
(!) Some chunks are larger than 500 kB after minification.
(!) <module> is dynamically imported by ... but also statically imported by ...
```

这些是 Vite 的分块提示和模块引用方式的非致命通知，不影响产出。

### 6.10 `StartupOpenRequests::replace` unused warning

**现象**：Rust 编译出现 `warning: method 'replace' is never used`。

**原因**：`state.rs` 中为 `StartupOpenRequests` 定义了 `replace()` 方法，但当前未在任何代码路径中调用。此警告已有，不影响功能。

---

## 7. 故障排查

### 7.1 构建失败速查表

| 症状 | 原因 | 解决 |
|---|---|---|
| `vue-tsc` 类型错误 | TypeScript 类型不匹配 | 根据错误信息修正类型 |
| `vite build` 报模块未找到 | `bun install` 未执行或失败 | 重跑 `bun install` |
| `link.exe` 找不到 | MSVC 环境未激活 | 执行 `vcvars64.bat` |
| `rustup` 找不到工具链 | `RUSTUP_HOME` 路径错误或尾随空格 | 检查环境变量（见 6.1） |
| `cargo` 下载依赖失败 | 网络问题或 cargo 注册表不可达 | 设置代理或使用 `--offline` |
| `makensis` 找不到 | NSIS 未安装（bunx tauri build 自带） | 确保 `bunx tauri build` 完整执行 |
| WASM 相关错误 | 项目中不使用 WASM，忽略异常源 | 检查 `cargo build` 而非 `wasm-pack` |

### 7.2 干净构建步骤

如果遇到奇怪的问题，从头开始：

```bash
# 1. 清理前端缓存
rm -rf node_modules bun.lock dist
bun install

# 2. 清理 Rust 缓存
cd src-tauri
cargo clean
cd ..

# 3. 重新构建
call M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat
set CARGO_HOME=M:\rust\.cargo
set RUSTUP_HOME=M:\rust\.rustup
set PATH=M:\rust\.cargo\bin;%PATH%
bunx tauri build
```

### 7.3 增量构建速度参考

| 阶段 | 首次 | 增量 |
|---|---|---|
| `bun install` | ~30s | ~5s |
| `vue-tsc --noEmit` | ~10s | ~8s |
| `vite build` | ~13s | ~13s |
| `cargo build --release` | ~1m54s | ~47s |
| `makensis` | ~10s | ~10s |
| **总计（tauri build）** | **~2m30s** | **~1m20s** |

---

## 8. 附录

### 8.1 环境配置清单

```
Rust:
  rustc:   1.96.0 (stable-x86_64-pc-windows-msvc)
  rustup:  M:\rust\.rustup
  cargo:   M:\rust\.cargo

MSVC:
  Build Tools v14.44.35207
  Path:    M:\VS\BuildTools
  vcvars:  M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat

Node.js / Bun:
  bun:     1.3.14

项目:
  根目录:  F:\fzz-Project\md-editor\md-editor
  Tauri:   2.11.2
  wry:     0.55.1
  webview2-com: 0.38.2
  windows: 0.61.3
```

### 8.2 关键依赖的 Cargo 版本

```
tauri = "2" (actually 2.11.2)
tauri-plugin-opener = "2" (2.5.4)
tauri-plugin-dialog = "2.7.1" (2.7.1)
tauri-plugin-clipboard-manager = "2" (2.3.2)
tauri-plugin-cli = "2" (2.4.1)
tauri-plugin-single-instance = "2" (2.4.2)
tauri-plugin-store = "2.4.3" (2.4.3)
tauri-plugin-window-state = "2.4.1" (2.4.1)
serde = "1" (with derive)
reqwest = "0.12" (with json)
tokio = "1" (with macros, rt-multi-thread)
base64 = "0.22"
webview2-com = "0.38.2"         # Windows only
windows-core = "0.61"           # Windows only
```

### 8.3 关键 npm 依赖版本

```
@tauri-apps/api: ^2.11.0
@tauri-apps/cli: ^2.11.2
@tauri-apps/plugin-store: ^2.4.3
@tauri-apps/plugin-window-state: ^2.4.1
@tauri-apps/plugin-dialog: ^2.7.1
@tauri-apps/plugin-clipboard-manager: ^2.3.2
@tauri-apps/plugin-opener: ^2.5.4
@tauri-apps/plugin-os: ^2.3.2
vue-tsc: ^3.3.4
vite: ^7.0.0
typescript: ~6.0.3
vue: ^3.5.38
pinia: ^3.0.4
```

### 8.4 项目关键文件索引

| 用途 | 路径 |
|---|---|
| Rust 入口 | `src-tauri/src/lib.rs` |
| Rust 命令（窗口） | `src-tauri/src/commands/window.rs` |
| Rust 命令（文档） | `src-tauri/src/commands/document.rs` |
| Rust 状态管理 | `src-tauri/src/state.rs` |
| Rust 菜单 | `src-tauri/src/menu.rs` |
| Rust 错误模型 | `src-tauri/src/error.rs` |
| Tauri 配置 | `src-tauri/tauri.conf.json` |
| Cargo 配置 | `src-tauri/Cargo.toml` |
| 前端入口 | `src/main.ts` |
| 前端协调层 | `src/App.vue` |
| 编辑器组件 | `src/components/Editor/MarkdownEditor.vue` |
| 文档生命周期 | `src/composables/useDocumentSession.ts` |
| 窗口会话管理 | `src/composables/useAppWindowSession.ts` |
| IPC 服务层 | `src/services/tauri/` |
| 命令名登记 | `src/services/tauri/command-names.ts` |
| Tailwind 配置 | `tailwind.config.js` |
| Vite 配置 | `vite.config.ts` |
| 架构文档 | `ARCHITECTURE.md` |

### 8.5 常用命令速查

```bash
# 开发
bun run dev                     # 纯前端开发 (Vite dev server)
bun run dev:tauri               # Tauri 全栈开发（热更新）
launch-dev.bat                  # 一键启动开发（含环境变量）

# 构建
bun run build                   # 前端构建（vue-tsc + vite）
bun run build:tauri             # Tauri 全量构建（含 Rust + 打包）
M:\temp\build_solo_full.bat     # 前端 + Rust 编译
M:\temp\build_solo_tauri.bat    # 完整打包（含安装包）

# 检查
bun run test                    # 运行 Vitest 测试
bun run lint                    # ESLint 检查
bun run format                  # Prettier 格式化
cargo check --manifest-path src-tauri/Cargo.toml  # Rust 编译检查（快速）

# 清理
cargo clean --manifest-path src-tauri/Cargo.toml  # 清理 Rust 构建缓存
bun run build --emptyOutDir     # 清理输出目录后构建
```

### 8.6 开发环境验证脚本

以下脚本可快速验证环境是否就绪：

```bash
echo Rust: && rustc --version && cargo --version && rustup show
echo MSVC: && dir "M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
echo Bun: && bun --version
echo Project: && cd F:\fzz-Project\md-editor\md-editor && bun --version
```

期望输出：

```
Rust: rustc 1.96.0 (ac68faa20 2026-05-25) / cargo 1.96.0
MSVC: 目录存在
Bun: 1.3.14
Project: 1.3.14
```

---

> **最后提醒**：编译环境最大的敌人是**环境变量和目录**。每次报错先确认：当前在哪个目录、环境变量设对了没有、`vcvars64.bat` 执行了没有。保持冷静，按文档一步步来，你一定能编译成功。
