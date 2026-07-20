# docs/KNOWN-ISSUES.md — 已知问题与技术债

> 接手者 / agent 排查问题时先查本表：能区分「这是已知坑」还是「新 bug」。
> 状态图例：`[已修复]` 供溯源 ｜ `[部分缓解]` ｜ `[未解决]` 待办 ｜ `[文档坑]` 文档类陷阱 ｜ `[设计取舍]` 非 bug

## 一、已修复（保留供溯源，勿误当现状）

| # | 现象 | 根因 | 修复 | 文件 |
|---|---|---|---|---|
| 1 | mermaid 图表全黑 | `securityLevel:'strict'` 使 DOMPurify 删掉主题 `<style>` | 改 `'loose'`（本地优先单文件，风险可忽略） | [`src/components/Editor/tiptap/extensions/mermaid-block.ts`](../src/components/Editor/tiptap/extensions/mermaid-block.ts) |
| 2 | 拖入 `.md` 不打开新窗口 | [`src/services/tauri/events.ts`](../src/services/tauri/events.ts) 的 `activeDragDropHandler` 单值变量，后注册覆盖前者 | 改为 `Set<DragDropHandler>` 广播分发 | [`src/services/tauri/events.ts`](../src/services/tauri/events.ts) |
| 3 | 图片拖入调用点 5 行 if/else | 路径模式判别 + authorize 分散 | 新增 `resolve_image_display` 单命令合并 | [`src-tauri/src/commands/document.rs`](../src-tauri/src/commands/document.rs) |
| 4 | IME 候选栏变箭头 | `editor.css` 的 `ime-mode: active`（IE 遗留，WebView2 上致候选窗变形） | 删除该属性 | [`src/components/Editor/tiptap/editor.css`](../src/components/Editor/tiptap/editor.css) |
| 5 | 文档干净度矛盾（导出功能/测试数） | 多份文档与代码脱节 | 2026-07-20 文档对账，导出功能按代码为准对齐 | [`README.md`](../README.md)×4 / [`ARCHITECTURE.md`](../ARCHITECTURE.md) / [`.opencode/PROFILE.md`](../.opencode/PROFILE.md) / [`RELEASE-CHECKLIST.md`](../RELEASE-CHECKLIST.md) |

## 二、未解决 / 待办（[未解决]）

| # | 现象 | 说明 | 相关文件 |
|---|---|---|---|
| 1 | 崩溃时 `.tmp` 文件未清理 | `save_document` 原子写产生 `.tmp`，崩溃路径无清理 | [`src-tauri/src/commands/document.rs`](../src-tauri/src/commands/document.rs) |
| 2 | 字体缓存文档脱节 | [`ARCHITECTURE.md`](../ARCHITECTURE.md) 说 IndexedDB，[`.opencode/PROFILE.md`](../.opencode/PROFILE.md) 说 v1.2.10 后改文件系统 | [`ARCHITECTURE.md`](../ARCHITECTURE.md):568 / [`.opencode/PROFILE.md`](../.opencode/PROFILE.md) |
| 3 | mermaid 中文标签体验有限 | 已加错误提示 + 5 个单测，但中文/特殊字符标签仍需用户自加引号 `A["文本"]` | [`src/components/Editor/tiptap/extensions/mermaid-block.ts`](../src/components/Editor/tiptap/extensions/mermaid-block.ts) |
| 4 | 测试数曾多处不一致 | 2026-07-20 已治理（README/PROFILE/ARCHITECTURE 去硬编码），但**新增文档请勿再硬编码测试数**，统一写「以 `bun run test` 实际输出为准」 | 全局 |

## 三、设计取舍（[设计取舍]，非 bug，勿"修"）

| 项 | 说明 |
|---|---|
| 导出系统 v1.2.18 删除 | 改为状态栏「复制为 HTML」（剪贴板），无独立导出/PDF/微信。PDF 实为浏览器打印（[`TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) §5） |
| `html:false` / `linkify:false` | 解析器刻意不保留原始 HTML、不自动链接裸 URL，保真优先 |
| 多进程架构（v1.2.5+） | 每双击一个 `.md` 起独立进程；关最后一个窗口默认不退出，需菜单「退出」 |

## 四、文档类已知坑（[文档坑]，agent 必读）

- **`.trae/documents/`**：旧架构文档（文件树/workspace watcher/fs.rs 等），**已失效，忽略**（不要链接、不要读取）。
- **[`.opencode/PROFILE.md`](../.opencode/PROFILE.md)**：技术档案，含历史快照，可能与当前代码有延迟；以 [`ARCHITECTURE.md`](../ARCHITECTURE.md) + 代码为准。
- **[`ARCHITECTURE.md`](../ARCHITECTURE.md) 附录 C**：已固化「文档-代码差异」清单，遇到矛盾先查此表。
- 任何文档若与代码不符，**以代码为准并更新文档**。

## See also

- [bug 易发区地图](./defect-hotspots.md)
- [调试指南](./debugging.md)
- [文档索引与术语表](./INDEX.md)
- [接手指南](../HANDOVER.md)
- [项目工作手册](../AGENTS.md)
- [架构权威地图](../ARCHITECTURE.md)
