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
| 5 | 文档干净度矛盾（导出功能/测试数） | 多份文档与代码脱节 | 2026-07-20 文档对账，导出功能按代码为准对齐 | [`README.md`](../README.md)×4 / [`ARCHITECTURE.md`](../ARCHITECTURE.md) / [`.opencode/PROFILE.md`](../.opencode/PROFILE.md) / [`RELEASE_PROCESS.md`](../RELEASE_PROCESS.md) |
| 6 | 字体缓存文档脱节（IndexedDB vs 文件系统） | [`ARCHITECTURE.md`](../ARCHITECTURE.md) 原写 IndexedDB，[`.opencode/PROFILE.md`](../.opencode/PROFILE.md) 说 v1.2.10 后改文件系统，两说打架 | 2026-07-21 文档规范化：以 `fontLoader.ts` 实际机制（文件系统缓存）为准，ARCHITECTURE 改文件系统、PROFILE 删除重复段改指针 | [`ARCHITECTURE.md`](../ARCHITECTURE.md):489/574 / [`.opencode/PROFILE.md`](../.opencode/PROFILE.md) |
| 7 | 字体不显示（下载完成却显示不出来） | 渲染层用 `asset://` 的 `@font-face` 被 CORS **静默拦截**（不报错）；叠加「霞鹜文楷」文件名标 Regular 但内部是 Lite 轻便版、与代码 `value` 不符的资源错配 | 渲染改走字节通道（`readFontBytes` IPC 取字节 → `new FontFace(family, bytes)` 同源加载）；霞鹜对齐为 Lite 真名（`value='LXGW WenKai Lite'`） | [`src/services/fontLoader.ts`](../src/services/fontLoader.ts) + [字体手册](./font-handling.md) |

## 二、未解决 / 待办（[未解决]）

| # | 现象 | 说明 | 相关文件 |
|---|---|---|---|
| 1 | 崩溃时 `.tmp` 文件未清理 | `save_document` 原子写产生 `.tmp`，崩溃路径无清理 | [`src-tauri/src/commands/document.rs`](../src-tauri/src/commands/document.rs) |
| 2 | mermaid 中文标签体验有限 | 已加错误提示 + 5 个单测，但中文/特殊字符标签仍需用户自加引号 `A["文本"]` | [`src/components/Editor/tiptap/extensions/mermaid-block.ts`](../src/components/Editor/tiptap/extensions/mermaid-block.ts) |
| 3 | 测试数曾多处不一致 | 2026-07-20 已治理（README/PROFILE/ARCHITECTURE 去硬编码），但**新增文档请勿再硬编码测试数**，统一写「以 `bun run test` 实际输出为准」 | 全局 |
| 4 | 打开含 Mermaid 的文档，未作任何修改却显示「未保存」 | **成因**：`MarkdownEditor.vue` 的 `onUpdate` 回调里无条件调用 `fileStore.markUserEdit()`。`setContent({ emitUpdate: false })` 虽用 `preventUpdate` meta 阻止 `onUpdate`，但它仍是 docChanged 的 transaction，会触发 `markdown-input.ts` 插件的 `update` → 延迟 `forceCheck` → `appendTransaction` 扫描文档。普通文档扫描后无转换返回 null；**含 Mermaid 的文档**因异步 NodeView 渲染与 `forceCheck` 时机叠加，产生了非 `preventUpdate` 的 transaction → 触发 `onUpdate` → `markUserEdit()` → 误标脏。**影响**：仅状态栏显示错误，不影响数据安全（保存后脏标清除）。**解决办法**：在 `onUpdate` 里判断 transaction 的 `preventUpdate` meta，是 `true` 则跳过 `markUserEdit()`；或加「加载中」标志位，加载完成前的 `onUpdate` 不标脏。**验证**：含 Mermaid 文档打开后状态栏应显示「已保存」，手动编辑后才变「未保存」。 | [`src/components/Editor/MarkdownEditor.vue`](../src/components/Editor/MarkdownEditor.vue):257-264 / [`src/components/Editor/tiptap/extensions/markdown-input.ts`](../src/components/Editor/tiptap/extensions/markdown-input.ts):185-239 |

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

- [bug 易发区地图（ARCHITECTURE §11）](../ARCHITECTURE.md)
- [调试指南](./debugging.md)
- [文档索引与术语表](./INDEX.md)
- [接手指南](../HANDOVER.md)
- [项目工作手册](../AGENTS.md)
- [架构权威地图](../ARCHITECTURE.md)
