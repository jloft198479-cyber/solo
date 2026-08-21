# Phase 6 指令：其余优化与清理

> **前置说明**：P6-01（编辑器 async chunk 与窗口显示竞争）已由 lowlight 单例懒加载修复覆盖（commit `6a9308b`），本指令不再包含。

---

## P6-02 · 图片无尺寸占位导致 layout shift

### 现状

`src/components/Editor/tiptap/extensions/image.ts:285` 的 `CustomImage` NodeView 创建 `<img>` 时无 `width`/`height`。加载中用 CSS `min-height: 80px` skeleton 占位（`editor.css:757`），图片加载完成后实际尺寸撑开容器，导致滚动位置跳动。

### 问题

含大量图片的长文档中，用户滚动时图片陆续加载，每张图片从 80px skeleton 切换到实际尺寸都会触发 reflow + scroll position jump。在快速滚动场景下体验明显。

### 约束

- solo 的 markdown 图片语法支持 `![alt](src)` 和 `![alt|widthxheight](src)` 两种形式（后者见 parser/serializer）。
- 不能假设所有图片都有尺寸信息——本地截图可能有，网络图片通常没有。
- 远程图片走 `resolve_image_display` → Rust 下载落盘 → asset URL，尺寸信息在下载前不可得。
- 不能引入网络请求获取图片头尺寸（性能反模式）。
- `loading: 'lazy'` 已设置，不要破坏。

### 验证

- 含 10+ 图片的长文档快速滚动，无明显跳动。
- 无尺寸信息的图片仍正常显示（降级到当前 skeleton 行为）。
- 有尺寸信息的图片加载前占位高度与最终高度一致。

---

## P6-03 · 自动保存序列化卡顿

### 现状

编辑器内容变化时走两条序列化路径：

1. **防抖空闲序列化**（`useEditorSync.ts:78-92`）：`debounce(500ms)` → `requestIdle` → `serializeMarkdown(doc)` → `fileStore.syncEditedContent(markdown)`。这条路径的结果存在 `fileStore.currentFile.content`。

2. **保存时实时序列化**（`useDocumentSession.ts:179`）：`persistDocument()` 调 `options.getContent()` → `MarkdownEditor.vue:457` 的 `serializeMarkdown(editor.state.doc)` 同步序列化全文档。

### 问题

路径 2 在每次自动保存（5s 间隔）和手动保存时都同步执行全文档序列化。大文档（20000+ 字）下 `serializeMarkdown` 耗时 50-100ms，阻塞主线程。

路径 1 的防抖空闲序列化可能已经算过一次相同内容，但结果存在 `fileStore.currentFile.content`，路径 2 没有复用它——因为 `getContent()` 直接从编辑器 state 取最新内容（避免防抖延迟导致保存旧内容）。

### 约束

- 保存必须用编辑器最新内容，不能用 500ms 防抖前的旧内容——这是 `persistDocument` 注释明确要求的（"避免防抖延迟导致保存旧内容"）。
- `serializeMarkdown` 是同步函数，遍历 ProseMirror doc 树生成 markdown 字符串。
- TipTap/ProseMirror 的 doc 对象不可直接结构化克隆到 Web Worker（含方法和私有引用）。
- 不能引入保存延迟——用户按 Ctrl+S 必须立即落盘。

### 验证

- 大文档（20000+ 字）自动保存时主线程无 >16ms 阻塞。
- 手动 Ctrl+S 保存响应时间不变。
- 保存内容正确性不变（roundtrip 测试全绿）。

---

## P6-04 · 关窗双序列化

### 现状

关闭窗口时 `handleCloseRequest`（`useAppWindowSession.ts:133`）的调用链：

1. `options.isDirty()` → `evaluateDirtyFromEditor()`（`useDocumentSession.ts:116`）→ `options.getContent()` → **第一次 `serializeMarkdown`**
2. 如果脏 → `options.saveDocument()` → `saveCurrentDocument()` → `persistDocument()` → `options.getContent()` → **第二次 `serializeMarkdown`**

### 问题

同一份编辑器内容在关窗流程中被序列化两次。大文档下两次 50-100ms 的同步序列化叠加，关窗响应延迟 100-200ms。

### 约束

- 第一次序列化（脏态检查）和第二次（保存）之间可能有异步间隙（`confirmUnsavedChanges` 弹窗），不能简单缓存——用户可能在弹窗期间继续编辑。
- 如果弹窗取消，缓存的内容不应被使用。
- `evaluateDirtyFromEditor` 的目的是闸口前强制评估脏态，不能跳过。

### 验证

- 关窗时 DevTools Performance 录制确认 `serializeMarkdown` 只执行一次。
- 大文档关窗响应时间减半。
- 脏态检查准确性不变。

---

## P6-05 · externalFileWarning 接线

### 现状

`useDocumentSession.ts:30` 定义了 `externalFileWarning = ref<string | null>(null)`，`App.vue:326` 在状态栏有展示位，但**从未被赋值**（只有 `= null` 清空，没有设值的代码路径）。功能完全未接线。

### 问题

设计意图是：当用户在 solo 中打开文件 A，同时用 VSCode/记事本修改了文件 A，solo 应检测到外部修改并提示用户。当前完全不做检测。

### 约束

- `Cargo.toml` 当前没有 `notify` crate（文件系统监听库），引入新依赖需谨慎评估。
- 方案 A（前端轮询 mtime）：编辑器获得焦点时调 Rust 命令查 mtime，低频不伤性能，但检测有延迟（用户聚焦后才知道）。
- 方案 B（Rust fs watch）：用 `notify` crate 监听文件变化，通过 Tauri 事件推前端，实时性好但增加依赖和复杂度。
- 需考虑：文件被外部修改后，solo 内的编辑器内容可能与磁盘不一致——是提示用户"文件已被外部修改，是否重新加载"，还是自动合并？
- 多窗口同时打开同一文件时，一个窗口保存会改变 mtime，另一个窗口不应误报。
- solo 的设计是纯本地单文件编辑器，安全策略偏保守——提示用户比自动合并更合适。
- solo 外部文件监听方案文档见 `docs/solo外部文件监听方案.md`，实施前先读。

### 验证

- 在 solo 中打开文件 → 用记事本修改同一文件 → solo 编辑器获得焦点 → 状态栏显示外部修改警告。
- 用户选择"重新加载"→ 编辑器内容更新为磁盘最新。
- 用户选择"忽略"→ 继续编辑，下次聚焦不再重复弹窗（直到文件再次被外部修改）。
- 多窗口打开同一文件，A 窗口保存后 B 窗口不误报。

---

## 通用约束

- 验证三件套全绿：`bun run test`（1114 passed）+ `npx vue-tsc --noEmit` + `bun run build`。
- Rust 改动需跑 `cargo check`（本机用 `M:\VS\BuildTools\vcvars64.bat` 注入 MSVC 环境）。
- 不破坏现有功能——每个修复项独立可回退。
- 遵循项目 SSOT/DRY 纪律：改一处查联动（见 `AGENTS.md` §七 最小联动矩阵）。
