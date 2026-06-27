# solo 项目档案

> 每次新会话先读此文件，立即进入工作状态。

## 快速启动

```bash
# 开发（前端 + Tauri）
cd F:\fzz-Project\md-editor\md-editor
bun run dev:tauri

# 完整打包（含安装包）
M:\temp\build_solo_tauri.bat

# 只编译 Rust（不打包）
M:\temp\build_solo_full.bat
```

## 项目路径

`F:\fzz-Project\md-editor\md-editor`

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面框架 | Tauri | 2.11.2 |
| 原生核心 | Rust | 1.96.0 |
| 前端框架 | Vue 3.5 + Pinia + TS | — |
| 编辑器 | TipTap v3 (ProseMirror) | 3.26 |
| Markdown 解析 | markdown-it | — |
| 构建 | Vite 7 + vue-tsc 3.3 | — |
| 包管理 | Bun | 1.3.14 |
| 样式 | Tailwind CSS 4 | 4.3 |
| 打包格式 | NSIS (安装包 .exe) | — |

## 环境变量（强制）

```bash
# MSVC 环境必须最先激活
call M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat

# Rust（必须用 .bat 设置，避免 PowerShell 尾随空格）
set CARGO_HOME=M:\rust\.cargo
set RUSTUP_HOME=M:\rust\.rustup
set PATH=M:\rust\.cargo\bin;%PATH%
```

## 关键文件

| 用途 | 路径 |
|---|---|
| Tauri 配置 | `src-tauri/tauri.conf.json` |
| Rust 入口 | `src-tauri/src/lib.rs` |
| Rust 窗口事件 | `src-tauri/src/commands/window.rs` |
| Rust 文档命令 | `src-tauri/src/commands/document.rs` |
| Rust 状态管理 | `src-tauri/src/state.rs` |
| Rust 菜单 | `src-tauri/src/menu.rs` |
| Rust 注册表关联 | `src-tauri/src/commands/desktop.rs` |
| NSIS 安装钩子 | `src-tauri/nsis-hooks.nsh` |
| 前端入口 | `src/main.ts` |
| 编辑器组件 | `src/components/Editor/MarkdownEditor.vue` |
| 文档生命周期 | `src/composables/useDocumentSession.ts` |
| 窗口会话 | `src/composables/useAppWindowSession.ts` |
| IPC 服务层 | `src/services/tauri/window.ts` |
| 粘贴检测 | `src/components/Editor/tiptap/extensions/markdown-paste.ts` |
| 导出弹窗 | `src/components/ExportPopover.vue` |
| 命令注册 | `src/commands/registry.ts` |

## 架构决策（不可违反）

### v1.2.x 系列修复摘要

**窗口生命周期**：
- `on_window_event` 只能注册一个回调 → 所有逻辑合并到 `attach_window_events()`（close 拦截 + focus/blur + destroyed 清理）
- `window.set_focus()` 受 Windows 前台锁限制，不一定成功 → 前端 `setTimeout(50ms)` 兜底
- `LoadedWindows` / `FocusedWindow` 在 destroyed 时清理，防止内存泄漏

**编辑器懒加载**：
- 窗口获得焦点前不创建 TipTap 实例，节省内存
- blur 时 destroy 编辑器，focus 时重建
- `@click.self` → `@click`（编辑器未创建时 target 不是 editor shell）
- `MemoryUsageTargetLevel=Low` blur 时降低内存

**保存与退出**：
- `isSaving` 锁保护并发保存，close 时等待 ≤1s 而非直接放弃
- `handleCloseRequest` 先停 auto-save 再弹对话框
- `app.exit(0)` 必须通过 IPC 命令调用（Rust `#[tauri::command]`），不能在主线程调

**StateFlags**：移除 `FULLSCREEN`（GH bug #3215，全屏后窗口尺寸不恢复）

### 文件关联（v1.2.3 关键修复）

**问题**：Tauri 的 `fileAssociations` 只写 ProgID/UserChoice，不写 ShellNew（新建菜单）和 DefaultIcon `,0`（图标索引）。Rust 的 `register_shell_new` 虽然补全了这些，但**只在 app 启动时执行**，用户安装后首次打开前关联不生效。

**方案（NSIS installerHooks）**：`src-tauri/nsis-hooks.nsh` 在安装阶段写入：
- `HKCU\Software\Classes\.md\ShellNew` + `NullFile`（右键新建）
- 删除 `HKCU\Software\Classes\.markdown\ShellNew`（消除旧版重复项）
- DefaultIcon 追加 `,0`
- `SHChangeNotify(0x08000000)` 刷新 Explorer

`tauri.conf.json` 配置：
```json
"nsis": {
  "installerHooks": "./nsis-hooks.nsh"
}
```

**效果**：安装即生效，无需启动 app。Rust `register_shell_new` 保留为 Settings 重注册保底。

## 编译须知

### 版本号同步修改

改版本时需同步 3 处：
- `src-tauri/Cargo.toml` — `[package] version`
- `src-tauri/tauri.conf.json` — `version`
- `package.json` — `version`

### 自动化脚本

| 脚本 | 作用 | 耗时 |
|---|---|---|
| `M:\temp\build_solo_full.bat` | 前端 + Rust 编译（不打包） | ~1m |
| `M:\temp\build_solo_tauri.bat` | 完整打包（含 NSIS 安装包） | ~2m30s |
| `M:\temp\build_solo_frontend.bat` | 仅前端（vue-tsc + vite） | ~15s |

产出：`src-tauri\target\release\bundle\nsis\solo_1.x.x_x64-setup.exe`

### 踩坑速查

| 症状 | 原因 | 解决 |
|---|---|---|
| `link.exe` 找不到 | MSVC 未激活 | 先执行 `vcvars64.bat` |
| `rustup` 找不到工具链 | `RUSTUP_HOME` 尾随空格 | 用 `.bat` 设变量，不用 PowerShell |
| `makensis` 找不到 | 缺 NSIS | `bunx tauri build` 自带 |
| `bunx tauri build` 报错 | 目录不对 | 必须在项目根目录执行 |

### 文件关联验证

安装后检查注册表：

```
# 应该有：
HKCU\Software\Classes\.md\ShellNew\  (默认) = ""
# 不应该有：
HKCU\Software\Classes\.markdown\ShellNew\  （旧版残留，安装时已删）
# 必须以 ,0 结尾：
HKCU\Software\Classes\solo.markdown\DefaultIcon\  (默认) = "C:\...\solo.exe,0"
```

## 待办

- P3: 崩溃 `.tmp` 残留清理（搁置）

## 开发习惯

- 任何改动前先读相关文件确认代码实际行为，不以注释为准
- `vue-tsc --noEmit` + `vite build` + `cargo build --release` 逐级验证
- 改了后端（Rust）必须验证前端（`window.ts` / composables 调用方），反之亦然
- 每次版本发布先清 `node_modules` + `cargo clean` 再全量构建
