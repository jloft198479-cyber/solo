# docs/defect-hotspots.md — bug 容易出在哪

> 改代码前先读本节，知道每个敏感区的「雷」。每条给：风险点 / 为什么容易错 / 涉及文件 / 改前必读。

## 1. 脏态机制（最易踩）
- **风险**：`file.ts` 的 `setContent()` vs `markUserEdit()` 分离是有意的。编辑器加载后立即序列化写回是建「规范化基线」，不是用户编辑。
- **为什么易错**：把两者合并或弄反 → 重新引入**脏态闪烁**（假脏/不脏）。
- **文件**：[`src/stores/file.ts`](../src/stores/file.ts)
- **必读**：[`ARCHITECTURE.md`](../ARCHITECTURE.md) §7.1、§11.1

## 2. 保存冲突检测（Rust 侧）
- **风险**：`save_document(path, content, expected_last_modified_ms, force)` 非 force 时比对 mtime，不符返回 `Conflict`。
- **为什么易错**：前端递归重试若不放锁会死锁；force 路径要谨慎（会覆盖外部改动）。
- **文件**：[`src-tauri/src/commands/document.rs`](../src-tauri/src/commands/document.rs) + [`src/composables/useDocumentSession.ts`](../src/composables/useDocumentSession.ts)
- **必读**：[`ARCHITECTURE.md`](../ARCHITECTURE.md) §11.2

## 3. 序列化尾换行
- **风险**：`serializeMarkdown()` 强制恰好一个 `\n`。
- **为什么易错**：「多了一个换行」先查 serializer，**别去改 roundtrip 测试的预期值**。
- **文件**：[`src/components/Editor/tiptap/markdown/serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts)
- **必读**：[`ARCHITECTURE.md`](../ARCHITECTURE.md) §11.3

## 4. 图片资产安全
- **风险**：`validate_image_asset_path` 先 `canonicalize` 再校验扩展名白名单（6 种）。
- **为什么易错**：跳过 canonicalize → 路径穿越（`evil.png → /etc/passwd`）。新增图片处理必须走此校验。
- **文件**：[`src-tauri/src/commands/document.rs`](../src-tauri/src/commands/document.rs)

## 5. 启动开打竞态
- **风险**：前端未 ready 就收到开文件请求。三层缓冲：`StartupOpenRequests` + `PendingWindowPaths` + `LoadedWindows`。
- **为什么易错**：动 `startup_ready()` 分支或事件顺序 → 丢开打请求 / 双开。
- **文件**：[`src-tauri/src/state.rs`](../src-tauri/src/state.rs) + [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs)
- **排查**：Rust 命令 `reveal_startup_open_log` 返回 `startup-open.log` 路径（见 [`docs/debugging.md`](./debugging.md)）

## 6. 三档防抖分层
- **风险**：统计 50ms / 光标 100ms / 序列化 500ms，刻意分离。
- **为什么易错**：随意改一档 → 卡顿或脏态判断错位。
- **文件**：[`src/components/Editor/MarkdownEditor.vue`](../src/components/Editor/MarkdownEditor.vue)

## 7. 命令名 / 定义真理源
- **风险**：命令名只在 `command-names.ts`，定义只在 `registry.ts`。
- **为什么易错**：硬写字符串命令名 → 拼写错误编译期才发现不了（虽 `TauriCommandName` 类型有约束，但 Rust 侧要同步）。
- **文件**：[`src/services/tauri/command-names.ts`](../src/services/tauri/command-names.ts) + [`src/commands/registry.ts`](../src/commands/registry.ts) + [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs) 的 `generate_handler!`
- **新增命令全流程**：登记 command-names → 服务层封装 → Rust 实现 → lib.rs 注册 → [`src-tauri/capabilities/`](../src-tauri/capabilities/) 加权限（见 [`ARCHITECTURE.md`](../ARCHITECTURE.md) 附录 B 末行）

## 8. 主题色彩/排版注入
- **风险**：`applyTheme` 注入 `--bg-color` 等 68 个色彩变量 + `--mk-*` 排版变量。
- **为什么易错**：直接写死 CSS 颜色 → 主题切换失效；新增颜色必须进 `CSS_VAR_MAP`。
- **文件**：[`src/themes/manager.ts`](../src/themes/manager.ts) + [`src/themes/types.ts`](../src/themes/types.ts)（`CSS_VAR_MAP`）+ [`src/components/Editor/tiptap/editor.css`](../src/components/Editor/tiptap/editor.css)（消费 `--mk-*`）

## 9. 多窗口进程模型
- **风险**：`new_editor_window` 原子递增 label；关最后一个窗口不退出。
- **为什么易错**：误用单实例假设 → 多窗口状态串扰。
- **文件**：[`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs)

## 10. 构建环境（非代码，但高频踩）
- **风险**：bun 下 `vue-tsc`/`vite`/`vitest run <过滤>` segfault；cargo 需 MSVC 环境。
- **排查**：[`docs/debugging.md`](./debugging.md) + [`HANDOVER.md`](../HANDOVER.md) 环境段。

## See also

- [已知问题与技术债](./KNOWN-ISSUES.md)
- [调试指南](./debugging.md)
- [文档索引与术语表](./INDEX.md)
- [接手指南](../HANDOVER.md)
- [项目工作手册](../AGENTS.md)
- [架构权威地图](../ARCHITECTURE.md)
