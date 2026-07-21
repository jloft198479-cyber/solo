# docs/debugging.md — 调试指南（人 + agent 共用）

## 一、前端运行时调试
- **DevTools**：`bun run dev:tauri:inspect`（设 `SOLO_OPEN_DEVTOOLS=1` 打开 WebView2 DevTools）。
- 日志约定：项目禁 `console.log`，仅允许 `warn`/`error`（[`AGENTS.md`](../AGENTS.md)）。排查时看 DevTools Console 的 warn/error。
- 编辑器懒加载：窗口未获焦点时 TipTap 实例不创建 → 编辑器空白，单击编辑区触发 `lazyInitEditor`（非 bug，见 [`TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) §4）。

## 二、Markdown 解析调试（草稿脚本 [`_diag.ts`](../_diag.ts)）
- 用途：单独验证 markdown-it 的 token 流（排查加粗/中文边界等解析问题）。
- 注意：脚本用 CommonJS `require('jsdom')`，且项目 `type:module`。**jsdom 不在 `package.json` 依赖里**，直接跑会缺模块。复用方式（二选一）：
  - `bun add -d jsdom` 后用 `bun _diag.ts`；或
  - 临时改 `.mjs` + 装 jsdom 后用 `node _diag.ts`。
- 这是**未接入构建的草稿**，仅供手动排查，不要依赖它做 CI。

## 三、启动开打竞态调试
- Rust 命令 `reveal_startup_open_log` 返回 `startup-open.log` 路径；该日志记录 CLI/OS-open/NewWindow 三类开打请求的缓冲过程。
- 前端调用：经 [`src/services/tauri/`](../src/services/tauri/) 封装，或直接 `invoke('reveal_startup_open_log')`。

## 四、重置设置 / 缓存（用户侧自救）
- 设置：`%APPDATA%\solo\settings.json`（tauri-plugin-store 持久化）。删除即恢复默认。
- 文档缓存：`%APPDATA%\solo\documents\`（自动保存的原地文件，非临时副本）。
- Windows 文件关联注册表（出问题时清理）：
  - `HKCU\Software\Classes\.md\ShellNew`（NullFile）
  - `HKCU\Software\Classes\solo.markdown`（ProgID / DefaultIcon 须 `,0` 结尾）
  - 详见 [`TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) 注册表表。

## 五、Rust / 构建调试
- `cargo check` 必须先注入 MSVC 环境（PATH/INCLUDE/LIB 指向 `M:\VS\BuildTools` + Windows SDK `10.0.26100.0`，`CARGO_HOME=M:\rust\.cargo`）。完整命令见 [`HANDOVER.md`](../HANDOVER.md) 环境段。
- **bun 下 segfault 的兜底**（本机 bun 1.3.14 / Windows）：
  - 类型检查：`node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`
  - 构建：`node node_modules/vite/bin/vite.js build`
  - 测试：**只跑 `bun run test`**（完整），绝不用 `bunx vitest run <过滤>`（segfault）。

## 六、验证改动的标准动作
1. 改 parser/serializer → `bun run test` 全绿（roundtrip + commonmark 必过）。
2. 改前端 → 刷新实测（本环境无 GUI，需用户在 Win11 验证的，明确标注）。
3. 改 Rust → `cargo check`（带 MSVC 环境）。
4. 发版前 → 升版本号（package.json / Cargo.toml / tauri.conf.json 三处）+ 去硬编码测试数。

## 七、桌面应用快捷键调试（Tauri/Electron + ProseMirror 通用）

> 来源：`_docs/经验/桌面应用快捷键调试经验.md`（2026-06-25）已收编于此，原文件已归档。

### 1. 四层拦截点（从底层到上层）
```
IME(输入法) → 原生菜单加速器(Tauri) → WebView2浏览器控件 → JavaScript keydown
```
- 快捷键"没反应"先怀疑前两层（IME / 原生菜单），不是 JS 层的问题。
- **快速定位法**：换一个不冲突的键（如 `Ctrl+Alt+字母`），换了能用 = 被拦截，不是逻辑坏。

### 2. 设计默认快捷键的避坑清单
| 组合 | 风险 | 推荐替代 |
|------|------|----------|
| `Ctrl+Shift+F` | IME 繁简切换拦截 | `Ctrl+Alt+F` |
| `Ctrl+F` / `Ctrl+H` | WebView2 原生查找/替换拦截 | `Ctrl+G` / `Ctrl+Shift+G` |
| `Ctrl+Alt+字母` / `Ctrl+Shift+字母`(非 F/H) | 中文 Windows 上最安全 | 首选 |
- 同一快捷键可能被多层处理导致**双重触发抵消**（窗口 handler + ProseMirror 各触发一次）→ 窗口 handler 跳过 `scope:'editor'` 的默认快捷键。

### 3. 逻辑触发了但无视觉反馈（ProseMirror 装饰层）
- `view.updateState(view.state)` 传入**同个 state 对象** → ProseMirror 内部 `state === prevState` 检查直接跳过（空操作）。
- 正确做法：`view.dispatch(state.tr)` 或 `view.updateState(state.apply(state.tr))`。
- 更可靠：扩展自身用 `MutationObserver` 监听 DOM 类变化，不依赖外部调用（如 `paragraph-focus.ts`）。

### 4. command 链路排查
```
快捷键 → findCommandByShortcut → executeCommand
  → (scope:'editor') editorRef.executeCommand → editor-commands.ts
  → (scope:'app') switch case → handler
```
- `eventToKeyString` 大小写敏感，确认 `event.key` 取值。
- `scope:'editor'` 默认先被 ProseMirror 处理，窗口级 handler 别再处理一次。

## See also

- [bug 易发区地图（ARCHITECTURE §11）](../ARCHITECTURE.md)
- [已知问题与技术债](./KNOWN-ISSUES.md)
- [文档索引与术语表](./INDEX.md)
- [接手指南](../HANDOVER.md)
- [项目工作手册](../AGENTS.md)
- [用户侧问题排查](../TROUBLESHOOTING.md)
- [架构权威地图](../ARCHITECTURE.md)
