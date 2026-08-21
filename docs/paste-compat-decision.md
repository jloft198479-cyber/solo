---
title: 粘贴兼容性优化 · 决策备忘
type: guide
audience: maintainer
status: active
tags: [粘贴, 决策, markdown]
summary: 粘贴兼容性决策备忘（优先级排序/踩坑）
updates: [src/components/Editor/tiptap/extensions/markdown-paste.ts, src-tauri/src/commands/clipboard.rs]
---

# 粘贴兼容性优化 · 决策备忘

> **定位**：agent 决策记录（SSOT 真理源在代码，本文件只留结论与排序，不抄评估细节）。
> **背景**：2026-08-21 的两份临时评估报告（D 评估 / Q 核实）已完成使命，结论沉淀于此后删除原文件，防止误导后续接手者。

## 决策原则

**先稳、再快、后全**：稳定性（防数据错乱）> 性能（无感响应）> 兼容性（格式保真）。
粘贴是信任边界，任何改动先问「会不会崩、会不会内容错乱」，其次「会不会卡」，最后才是「格式保不保」。

## 优先级排序（取代原报告的 P0/P1/P2）

### 先做（快赢 · 低风险高收益 · 能力已备）
1. **嗅探接线**：`hasMarkdownOnlySyntax` 已实现但只在纯文本路径被调，HTML 路径未利用——解决「从 Markdown 编辑器复制扩展语法（数学/wikilink/callout）丢失」。成本 <1ms。
2. **单段落行内标记转换**：粘贴 `**bold**` 纯文本不转换 → 轻量正则检测 `**[^*]+**` 等模式。成本 <1ms。
3. **URL 自动转链接**：仅粘贴路径正则扫描 `https?://`，不开全局 `linkify`（避免大文档解析 +10-15%）。

### 配性能方案再做（收益大但有坑）
4. **Word HTML 清理**：兼容性 + 性能双赢（mso 垃圾占 60-70% 体积，清理后 DOMParser 更快、内存更低）。注意：mso 格式变体极多，正则调试是时间黑洞。
5. **readClipboardHtml 接入**：收益最高但风险最高——异步竞态（连续 Ctrl+V / 粘贴后打字）+ 3x 峰值内存（IPC 字符串 + DOMParser + Slice）+ UX 卡顿。**必须配完整方案**：同步快速判断 text/html 是否为空 → 为空才异步 fallback → 防竞态 → Rust 侧预处理减小传输体积。绝不做「直接接线」的简化版。

### 按需 / 暂不做
- 其他编辑器扩展语法 HTML 结构识别：低风险，按需。
- 放宽救回阈值：收益一般，且破坏快速短路（每粘贴全量遍历），保持 `formatted > 0` 提前退出。
- 图片+文字粘贴保格式：有异步竞态风险，当前同步 insertText 响应没问题，仅格式丢，优先级低。
- **合并单元格 / RTF / raw bitmap：不做**——Markdown 表达力天花板，结构性不可能，过度工程。

## 踩坑提醒（防止被原报告误导）

- **远程图片缓存**：不是 50MB LRU，实际是 **10MB 永久缓存、无并发、无 TTL**（`image.rs`）。如需治理是独立任务（加 LRU 淘汰），与粘贴兼容性无关。
- **strike parseDOM**：只认 `<s>`，不认 `<del>`（[compat-schema.ts](../src/components/Editor/tiptap/markdown/compat-schema.ts)）——从网页复制 `<del>` 会丢删除线。
- **callout 内不嵌套 blockquote**：是设计约束，不是 bug（[callout.ts](../src/components/Editor/tiptap/markdown/plugins/callout.ts)）。

## 相关真理源

- 粘贴处理链路：`src/components/Editor/tiptap/extensions/markdown-paste.ts`（四层管道：handlePaste / clipboardTextParser / transformPasted / ProseMirror 默认）
- 剪贴板 Rust 命令：`src-tauri/src/commands/clipboard.rs`（`read_clipboard_html` 已注册未接线）
- Markdown 解析配置：`src/components/Editor/tiptap/markdown/parser.ts`（`html:false` / `linkify:false`）
