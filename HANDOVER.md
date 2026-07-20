# HANDOVER.md — solo 项目接手指南

> 受众：**下一个接手者**——可能是人类开发者，也可能是 AI agent。
> 目标：30 分钟内建立准确心智模型，并知道去哪找代码、去哪找坑。

## [警告] 黄金法则：以代码为准

本文档及本项目所有文档（包括 `ARCHITECTURE.md`）都**只是代码的快照**。
任何矛盾，以**实际代码行为**为准，并顺手更新文档。

**特别警告**：仓库内 `.trae/documents/` 下的旧文档描述了「文件树 / workspace watcher / fs.rs / watch.rs / config.rs」等**已被移除**的结构，**一律忽略**，以 `ARCHITECTURE.md` + 代码为准。

## 30 秒定位

solo = 本地优先的桌面 Markdown 编辑器（Tauri 2 + Rust 原生核心 + Vue 3 + TipTap/ProseMirror）。
不是笔记软件、不是知识库、不是平台。面向中文沉浸式写作。

- 当前版本：**v1.2.23**（以 `package.json` 为准）
- 许可证：Apache-2.0
- 仓库：`https://github.com/jloft198479-cyber/solo`

## 阅读顺序（按这个走，别跳）

1. `README.md` —— 产品是什么、能干嘛、怎么装
2. `AGENTS.md` —— 工作纪律 + 快速入门（AI/开发者必读）
3. `ARCHITECTURE.md` —— **权威架构地图**（命令清单、目录、关键约束、附录 B「常见任务从哪入手」、附录 C「文档-代码差异」）
4. 按需：`BUILD_GUIDE.md`（编译）、`TROUBLESHOOTING.md`（用户侧问题）、`docs/*`（专题）
5. 接手专用（本批新增）：`docs/KNOWN-ISSUES.md`、`docs/defect-hotspots.md`、`docs/debugging.md`、`docs/INDEX.md`

## 环境搭建（本机真实路径，照抄）

> 环境陷阱：本机 Rust 在 `M:\rust`，MSVC 在 `M:\VS\BuildTools`，**不要因为 PATH 没加载就重装**。

| 工具 | 路径 / 版本 | 说明 |
|---|---|---|
| Bun | 1.3.14 | 包管理 + 前端 dev/test |
| Rust | `M:\rust`（CARGO_HOME=`M:\rust\.cargo`），edition 2021 | 1.96.0 |
| MSVC Build Tools | `M:\VS\BuildTools`，v14.44.35207 | + Windows SDK `10.0.26100.0` |
| Node | 22/24（兜底） | 当 bun 在 vue-tsc/vite 下 segfault 时用 |

**`cargo check` 必须先把 MSVC 工具链放进环境**（PowerShell）：

```powershell
$env:CARGO_HOME = 'M:\rust\.cargo'
$env:PATH = "M:\VS\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;$env:PATH"
$env:INCLUDE = "M:\VS\BuildTools\VC\Tools\MSVC\14.44.35207\include;M:\VS\BuildTools\Windows Kits\10\Include\10.0.26100.0\ucrt;M:\VS\BuildTools\Windows Kits\10\Include\10.0.26100.0\shared;M:\VS\BuildTools\Windows Kits\10\Include\10.0.26100.0\um"
$env:LIB = "M:\VS\BuildTools\VC\Tools\MSVC\14.44.35207\lib\x64;M:\VS\BuildTools\Windows Kits\10\Lib\10.0.26100.0\ucrt\x64;M:\VS\BuildTools\Windows Kits\10\Lib\10.0.26100.0\um\x64"
cargo check --manifest-path src-tauri/Cargo.toml
```

## 常用命令（复制即用）

```bash
bun install                      # 装依赖
bun run dev                      # 纯前端 dev
bun run dev:tauri                # 全栈（含 Rust）
bun run dev:tauri:inspect        # 全栈 + 打开 DevTools（SOLO_OPEN_DEVTOOLS=1）
bun run test                     # Vitest 全量（当前 27 文件 / 974 测试，以实际输出为准）
bun run build:tauri              # 打安装包
```

> [警告] **测试陷阱（本机 bun/Windows 实测）**：
> - **永远跑完整的 `bun run test`**。子集过滤 `bunx vitest run <过滤>` 会 **segfault**（线程 worker 崩溃）。
> - `bun run build`（含 `vue-tsc` + `vite`）在本机 bun 下也 **segfault**。兜底办法：用 node 运行时直跑 JS 入口——
>   `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`
>   `node node_modules/vite/bin/vite.js build`

## 真理源文件（改任何东西前先读这些）

| 你想改的 | 唯一真相文件 |
|---|---|
| Tauri 命令**名字** | `src/services/tauri/command-names.ts`（`TAURI_COMMANDS`） |
| 命令**定义/快捷键/菜单** | `src/commands/registry.ts` |
| 字体**清单** | `src/constants/fonts.ts` |
| 字体**栈** | `src/utils/fontStack.ts` |
| 主题**色彩映射** | `src/themes/types.ts`（`CSS_VAR_MAP`） |
| Rust **命令总数/注册** | `src-tauri/src/lib.rs` 的 `generate_handler!`（当前 **20** 个） |
| Markdown **保真安全网** | `src/components/Editor/tiptap/markdown/__tests__/roundtrip.spec.ts` + `commonmark.spec.ts` |
| **脏态**机制 | `src/stores/file.ts`（`setContent` vs `markUserEdit`） |
| 保存**冲突检测** | `src-tauri/src/commands/document.rs`（`save_document`，mtime 校验） |
| 启动开打**竞态** | `src-tauri/src/state.rs` + `src-tauri/src/lib.rs` |
| 图片**资产安全** | `src-tauri/src/commands/document.rs`（`validate_image_asset_path`） |

## 给 AI agent 的特别提示

1. **先读 `ARCHITECTURE.md`**，它比任何对话摘要都准。
2. **不要信任 `.trae/documents/`**；遇到「文件树/workspace watcher」等描述，那是旧架构。
3. 找「改 X 去哪个文件」→ 直接查 `ARCHITECTURE.md` 附录 B，或本批的 `docs/defect-hotspots.md`。
4. 验证改动：**必须跑完整 `bun run test`**，不要信「我试了子集应该没问题」。
5. 改 parser/serializer 后，roundtrip + commonmark 测试必须通过（见上方真理源）。
6. 遇到环境/构建问题 → `docs/debugging.md`。
