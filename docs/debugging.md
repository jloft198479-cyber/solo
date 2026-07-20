# docs/debugging.md — 调试指南（人 + agent 共用）

## 一、前端运行时调试
- **DevTools**：`bun run dev:tauri:inspect`（设 `SOLO_OPEN_DEVTOOLS=1` 打开 WebView2 DevTools）。
- 日志约定：项目禁 `console.log`，仅允许 `warn`/`error`（`AGENTS.md`）。排查时看 DevTools Console 的 warn/error。
- 编辑器懒加载：窗口未获焦点时 TipTap 实例不创建 → 编辑器空白，单击编辑区触发 `lazyInitEditor`（非 bug，见 `TROUBLESHOOTING.md` §4）。

## 二、Markdown 解析调试（草稿脚本 `_diag.ts`）
- 用途：单独验证 markdown-it 的 token 流（排查加粗/中文边界等解析问题）。
- 注意：脚本用 CommonJS `require('jsdom')`，且项目 `type:module`。**jsdom 不在 `package.json` 依赖里**，直接跑会缺模块。复用方式（二选一）：
  - `bun add -d jsdom` 后用 `bun _diag.ts`；或
  - 临时改 `.mjs` + 装 jsdom 后用 `node _diag.ts`。
- 这是**未接入构建的草稿**，仅供手动排查，不要依赖它做 CI。

## 三、启动开打竞态调试
- Rust 命令 `reveal_startup_open_log` 返回 `startup-open.log` 路径；该日志记录 CLI/OS-open/NewWindow 三类开打请求的缓冲过程。
- 前端调用：经 `src/services/tauri/` 封装，或直接 `invoke('reveal_startup_open_log')`。

## 四、重置设置 / 缓存（用户侧自救）
- 设置：`%APPDATA%\solo\settings.json`（tauri-plugin-store 持久化）。删除即恢复默认。
- 文档缓存：`%APPDATA%\solo\documents\`（自动保存的原地文件，非临时副本）。
- Windows 文件关联注册表（出问题时清理）：
  - `HKCU\Software\Classes\.md\ShellNew`（NullFile）
  - `HKCU\Software\Classes\solo.markdown`（ProgID / DefaultIcon 须 `,0` 结尾）
  - 详见 `TROUBLESHOOTING.md` 注册表表。

## 五、Rust / 构建调试
- `cargo check` 必须先注入 MSVC 环境（PATH/INCLUDE/LIB 指向 `M:\VS\BuildTools` + Windows SDK `10.0.26100.0`，`CARGO_HOME=M:\rust\.cargo`）。完整命令见 `HANDOVER.md` 环境段。
- **bun 下 segfault 的兜底**（本机 bun 1.3.14 / Windows）：
  - 类型检查：`node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`
  - 构建：`node node_modules/vite/bin/vite.js build`
  - 测试：**只跑 `bun run test`**（完整），绝不用 `bunx vitest run <过滤>`（segfault）。

## 六、验证改动的标准动作
1. 改 parser/serializer → `bun run test` 全绿（roundtrip + commonmark 必过）。
2. 改前端 → 刷新实测（本环境无 GUI，需用户在 Win11 验证的，明确标注）。
3. 改 Rust → `cargo check`（带 MSVC 环境）。
4. 发版前 → 升版本号（package.json / Cargo.toml / tauri.conf.json 三处）+ 去硬编码测试数。
