---
title: Markdown 保真度全链路审核报告（进站到出站）
type: archive
audience: maintainer
status: archive
doc-life: frozen
review-by: —
owner: 简乐
tags: [fidelity, markdown, audit, serialization, race]
summary: 2026-11-25 全链路保真审核：生命周期竞态、跨窗口覆盖与解析缺口
updates: [docs/KNOWN-ISSUES.md, docs/FIDELITY-PROMISE.md, docs/INDEX.md]
---

# Markdown 保真度全链路审核报告（2026-11-25）

> **一句话结论**：普通同路径保存已有较完整的竞态保护；当前最危险的是读盘、另存/改名、关窗和跨窗口回写四条异步链，以及脚注重复定义这一处确定的静默丢正文。
>
> **审核基线**：`2a4bf41`（2026-11-25）。代码工作树无未提交代码改动；仓库另有与本次无关的用户改动，未触碰。
>
> **审核性质**：只读、源码级、全链路。未执行修复、未运行测试/构建/应用探针，未把新问题回填 `KNOWN-ISSUES.md`。本件是冻结快照，不是待办真理源。

## 1. 给第三方审核者的阅读说明

### 1.1 目的

独立回答三个问题：

1. 用户的 Markdown 从选择文件到再次打开，会不会在哪个边界丢内容、变结构或反复变形？
2. 现有防线为什么没有拦住？是缺保护，还是保护只覆盖了另一条路径？
3. 哪些是确定缺陷，哪些只是待真机验证的候选，哪些已经是明确设计取舍？

### 1.2 范围

- Windows 文件关联、启动开文件、普通打开、拖入打开。
- Rust 读盘、编码/BOM/换行识别、mtime 采集。
- 前端加载、Markdown 解析、TipTap JSON/内部 HTML、编辑与规范化基线。
- 自动保存、手动保存、另存为、改名保存、关窗。
- Rust 冲突检查、原子写、互链改名批量同步。
- 多窗口改名跟随、外部修改、重新打开。
- 复制为 HTML、Markdown 回退渲染等出站路径。

### 1.3 证据等级

- **S（源码确认）**：调用链、数据流和缺口都能在当前源码中直接指出；竞态类需要相应调度交错才会发生。
- **C（候选）**：静态路径可达，但真实 UI/HTML 粘贴或命令入口尚未运行验证。
- **K（已知/取舍）**：已在 `KNOWN-ISSUES.md` 登记为暂缓、部分解决或明确接受。
- **T（测试盲区）**：不是产品行为缺陷本身，但会导致现有测试无法证明用户可见保真。

### 1.4 结论总账

| 分类 | 数量 | 说明 |
|---|---:|---|
| S · P1 | 8 | 可能静默丢编辑、丢正文或覆盖其他窗口内容 |
| S · P2 | 4 | 链接目标、格式结构、图片尺寸或 frontmatter 元数据变形 |
| C · P2 | 1 | 行内图片叠加 code mark 的重开行为，待真机确认 |
| T | 3 | 端到端行为锁、全仓扫描基线、测试绿含义存在盲区 |
| D | 1 | `KNOWN-ISSUES.md` 的 #60/#63 与当前代码明显不一致 |

## 2. 全链路地图

| 阶段 | 主链路 | 已核实的保护 | 主要发现 |
|---|---|---|---|
| 启动/选文件 | `startup_ready` → `handleOpenPayload` → `openDocumentWithPrompt` → `open_document` | 前端 ready 后投递；多文件拆窗；打开前询问放弃未保存更改 | F-01、F-05 |
| 读盘 | `read_text_with_layout` + `read_modified_time_ms` | 识别 UTF-8/UTF-8 BOM/UTF-16；记录 BOM、换行和混合状态 | F-05 |
| 解析 | `parseMarkdown` → TipTap schema → 规范化基线 | 生产 schema；ZWNJ 预处理；表格单行容器特判 | F-08、F-09、F-10、F-12、F-13 |
| 编辑 | `onUpdate` → 防抖 → 空闲序列化 → `syncEditedContent` | 关窗/保存闸口会从编辑器实时取内容 | F-01、F-04 |
| 普通保存 | `saveCurrentDocument` → `persistDocument` → `save_document` | `isSaving` 互斥；保存期间继续编辑会重新标脏；冲突提示 | 正常路径有效；F-05 是磁盘边界缺口 |
| 另存/改名 | `saveCurrentDocumentAs` / `saveRenamedDocument` | 保存互斥；布局随文档走 | F-02 |
| 关窗 | `runCloseChain` → 停自动保存 → 判脏 → 保存 → 销毁 | 关窗前强制刷设置与阅读位置；异常时 abort 握手 | F-03、F-04 |
| 跨窗口 | `listenFileRenamed` / `listenWikilinksSynced` | 路径跟随不直接回灌编辑器；互链刷新前检查路径与脏态 | F-06、F-07 |
| 落盘 | `encode_with_layout` → `atomic_write` | tmp + `fsync` + rename；保留 UTF-8 BOM 与 CRLF/CR | F-05、F-07；权限不保留为 K |
| 重开/出站 | `setFile` → `parseMarkdown`；`DOMSerializer` → `externalize-html` | 同路径外部刷新有二次脏态检查；正文复制走统一归一层 | F-09、F-10、F-11、F-12、F-13；回退渲染为 K |

启动入口证据：[lib.rs:27](../../src-tauri/src/lib.rs#L27)、[useAppWindowSession.ts:143](../../src/composables/useAppWindowSession.ts#L143)、[useAppWindowSession.ts:285](../../src/composables/useAppWindowSession.ts#L285)。读盘入口证据：[document.rs:174](../../src-tauri/src/commands/document.rs#L174)、[document.rs:186](../../src-tauri/src/commands/document.rs#L186)、[document.rs:226](../../src-tauri/src/commands/document.rs#L226)。

## 3. 已核实有效的保护

这些保护真实存在，第三方审核时不要把“有原子写”或“有冲突检查”误判为相关问题已经解决。

- **普通保存期间继续编辑会重新标脏**：保存快照与 store 内容在 `markSaved` 之前比较，若 IPC 期间 store 已前进，则保存后重新同步实时编辑器内容。见 [useDocumentSession.ts:279](../../src/composables/useDocumentSession.ts#L279)。
- **外部互链刷新有二次守卫**：读盘后再次检查当前路径、`isSaving` 和实时脏态，避免把刚输入的内容冲掉。见 [useDocumentSession.ts:528](../../src/composables/useDocumentSession.ts#L528)。
- **跨窗口改名跟随不直接回灌编辑器**：`renamePath` 使用独立 `pathFollowToken`，编辑器只跟路径、不替换 buffer。见 [file.ts:122](../../src/stores/file.ts#L122)、[MarkdownEditor.vue:559](../../src/components/Editor/MarkdownEditor.vue#L559)。
- **写盘具备原子替换与数据 fsync**：先写临时文件、`sync_all()`，再 rename；降低半文件风险。见 [document.rs:1102](../../src-tauri/src/commands/document.rs#L1102)。
- **BOM 与换行可回写**：UTF-8 BOM、CRLF、CR 会随 `DocumentLayout` 保存；UTF-16 归一为 UTF-8 是明确取舍。见 [document.rs:174](../../src-tauri/src/commands/document.rs#L174)、[document.rs:186](../../src-tauri/src/commands/document.rs#L186)。
- **表格正常入口已收紧**：单元格 schema 只接受 `paragraph`；格内 `<br>` 已有读侧还原，且代码 span 内的字面 `<br>` 不拆。见 [table.ts:41](../../src/components/Editor/tiptap/extensions/table.ts#L41)、[parser.ts:243](../../src/components/Editor/tiptap/markdown/parser.ts#L243)。

## 4. 确认缺陷（S）

### F-01 · P1 · 打开文件期间继续输入，会在加载完成时被新文档替换

**用户症状**：打开较大的第二份文件时，旧编辑器仍可输入；读取完成后，刚输入的内容随整篇文档替换消失。

**最小复现建议**（本轮未执行）：

1. 打开文档 A，保留可编辑状态。
2. 通过文件对话框打开加载较慢的文档 B。
3. 在 B 尚未显示时继续在 A 中输入。
4. B 加载完成，观察 A 中刚输入的文字是否被整体替换。

**调用链**：`openDocumentWithPrompt()` 只在 `await` 前询问一次脏态 → `loadDocumentFromPath()` 等待 `openDocument()` → `applyLoadedDocument()` 调 `setFile()` → `reloadToken` 触发 `MarkdownEditor` 整篇替换。

**现有保护及缺口**：`isOpeningFile` 只阻止并发打开，不阻止编辑；加载指示只是进度条，不遮挡输入；`setFile()` 与编辑器替换分支没有加载后的脏态/路径守卫。正确的外部刷新链反而有二次守卫，说明该模式在本仓已有先例。

**证据**：[useDocumentSession.ts:103](../../src/composables/useDocumentSession.ts#L103)、[useDocumentSession.ts:194](../../src/composables/useDocumentSession.ts#L194)、[App.vue:365](../../src/App.vue#L365)、[MarkdownEditor.vue:585](../../src/components/Editor/MarkdownEditor.vue#L585)、[file.ts:93](../../src/stores/file.ts#L93)。

**审核判据**：加载完成后，如果当前 buffer 在等待期间变脏，不能静默替换；应取消回灌、重新询问或保留新输入。

### F-02 · P1 · 另存为/改名保存期间继续输入，会被保存快照回滚

**用户症状**：另存为或改名保存成功后，IPC 往返期间新敲的文字从屏幕上消失。

**最小复现建议**：

1. 编辑文档并触发另存为或改名保存。
2. 在保存请求尚未返回时继续输入。
3. 保存成功瞬间观察编辑器是否退回保存开始时的内容。

**调用链**：`persistDocument()` 捕获 `content` 快照 → IPC 返回 → `setFile(content, ...)` → `reloadToken` → 编辑器 parse 回旧快照。

**现有保护及缺口**：普通保存有 `storeMovedDuringSave` 补偿，另存为与改名保存没有；`setFile()` 的语义是“磁盘内容已载入”，不适合直接表示“路径/基线变了，但当前 buffer 不能回灌”。

**证据**：[useDocumentSession.ts:351](../../src/composables/useDocumentSession.ts#L351)、[useDocumentSession.ts:391](../../src/composables/useDocumentSession.ts#L391)、[useDocumentSession.ts:369](../../src/composables/useDocumentSession.ts#L369)、[useDocumentSession.ts:420](../../src/composables/useDocumentSession.ts#L420)、[MarkdownEditor.vue:585](../../src/components/Editor/MarkdownEditor.vue#L585)。

**台账状态**：K，`KNOWN-ISSUES.md` #38 已明确登记并暂缓。见 [KNOWN-ISSUES.md:142](../KNOWN-ISSUES.md#L142)。

**审核判据**：保存期间新增输入必须继续标脏并保留在当前 buffer；新路径落盘快照与当前编辑内容应分离管理。

### F-03 · P1 · 关窗取消或保存失败后，自动保存永久停止

**用户症状**：点关闭后选择“取消”，窗口留下了，但之后再也不会自动保存；只能手动保存或再次尝试关闭。

**最小复现建议**：

1. 启用自动保存并制造未保存修改。
2. 点击关闭，在确认框选择“取消”。
3. 等待超过自动保存间隔，继续编辑并检查是否产生自动保存。

**调用链**：`runCloseChain()` 第一行调 `stopAutoSave()` → 取消/保存失败直接 `return false` → 没有恢复调用。

**现有保护及缺口**：自动保存只在设置 watcher 内启动；`stopAutoSave()` 把 `autoSaveActive=false` 并清 timer，但没有公开 resume 入口。关窗失败分支只 abort 握手，不恢复调度。

**证据**：[useAppWindowSession.ts:189](../../src/composables/useAppWindowSession.ts#L189)、[useAppWindowSession.ts:206](../../src/composables/useAppWindowSession.ts#L206)、[useDocumentSession.ts:636](../../src/composables/useDocumentSession.ts#L636)、[useDocumentSession.ts:644](../../src/composables/useDocumentSession.ts#L644)。

**审核判据**：所有“窗口继续存活”的关闭分支都必须恢复自动保存，或采用不破坏常驻调度的暂停/恢复状态机。

### F-04 · P1 · 关窗选择保存后继续打字，最后一批输入可能随窗口关闭丢失

**用户症状**：在关窗确认框选择“保存”后，保存期间继续输入；窗口关闭，新输入既未提示也未落盘。

**最小复现建议**：

1. 修改文档后点关闭，选择“保存”。
2. 在保存请求返回前继续输入。
3. 保存完成后窗口直接关闭；重开文件检查最后输入是否存在。

**调用链**：`isDirty()` 只判断一次 → `confirmUnsavedChanges()` → `saveDocument()` → `saveWindowState()` → `destroyCurrentWindow()`。

**现有保护及缺口**：普通保存会尽量保留保存期间产生的新脏态，但关闭链在保存成功后不再检查脏态，仍继续销毁窗口；停止自动保存又消除了后续补救机会。

**证据**：[useAppWindowSession.ts:206](../../src/composables/useAppWindowSession.ts#L206)、[useAppWindowSession.ts:221](../../src/composables/useAppWindowSession.ts#L221)、[App.vue:195](../../src/App.vue#L195)、[useDocumentSession.ts:279](../../src/composables/useDocumentSession.ts#L279)。

**审核判据**：保存返回后必须再次从编辑器评估脏态；若又有编辑，不能静默销毁，应再次保存或提示。

### F-05 · P1 · mtime 比较不是快照协议，外部修改可在检查/读取窗口内被漏掉

**用户症状**：两个窗口同时保存，后保存者覆盖先保存者；极端情况下，打开时读到的旧内容会配上一个较新的 mtime，随后保存被误判为“没有外部修改”。

**最小复现建议**：

1. 两个窗口打开同一文件，保持相同基线。
2. 分别输入不同内容，尽量同时保存。
3. 重开文件，检查是否只剩最后一次写入。
4. 读盘竞态需在 `fs::read` 与 `metadata.modified()` 之间插入外部写入；本轮未执行。

**调用链**：

- 保存：`read_modified_time_ms()` 比较期望值 → `encode_with_layout()` → `atomic_write()`。
- 打开：`read_text_with_layout()` 先读内容 → 随后单独读取 mtime。

**现有保护及缺口**：原子写保证单次替换不是半文件，但不保证 lost-update 安全；检查与写入不在同一临界区，mtime 还被截断到毫秒。打开路径的内容与 mtime也不是同一快照。

**证据**：[document.rs:226](../../src-tauri/src/commands/document.rs#L226)、[document.rs:399](../../src-tauri/src/commands/document.rs#L399)、[document.rs:423](../../src-tauri/src/commands/document.rs#L423)、[document.rs:1209](../../src-tauri/src/commands/document.rs#L1209)。

**审核判据**：不能只用“文件 mtime 相等”证明磁盘内容未变；至少要把内容哈希/版本与写入纳入同一并发协议，并提高时间精度或改用文件锁。

### F-06 · P1 · 跨窗口改名后直接采纳新 mtime，可绕过冲突保护

**用户症状**：A 窗口改名并保存新内容，B 窗口仍基于旧内容编辑；B 随后保存时不提示冲突，可能把 A 的内容覆盖掉。

**最小复现建议**：

1. A、B 两窗打开同一文件。
2. A 改名并保存内容 A。
3. B 收到改名事件后继续基于旧 buffer 编辑内容 B 并保存。
4. 重开文件，检查 A 的改动是否被 B 覆盖。

**调用链**：`handleFileRenamed()` → `renamePath(newPath)` → `getFileMtime(newPath)` → `syncLastModifiedTime(mtime)` → 下次保存把该 mtime 当期望值。

**现有保护及缺口**：路径跟随本身正确地保留了 B 的 buffer 和脏态；问题在于把“新路径当前磁盘 mtime”直接当成 B 旧 buffer 的基线。代码注释寄希望于 `save_document` 的 mtime 检查，但基线已经被对齐，检查自然通过。

**证据**：[useDocumentSession.ts:553](../../src/composables/useDocumentSession.ts#L553)、[useDocumentSession.ts:571](../../src/composables/useDocumentSession.ts#L571)、[file.ts:140](../../src/stores/file.ts#L140)、[MarkdownEditor.vue:559](../../src/components/Editor/MarkdownEditor.vue#L559)。

**审核判据**：改名事件不能让旧 buffer 无条件获得新文件的冲突豁免；应保留旧内容身份/版本，或在跟随时要求重新载入/合并。

### F-07 · P1 · 互链改名批量同步无冲突检查，可覆盖引用文件的并发编辑

**用户症状**：给文件改名时，其他文档中指向它的链接被更新，但同一引用文件里刚保存/刚输入的内容可能被批量同步器的旧快照覆盖。

**最小复现建议**：

1. 文档 C 含指向 `旧名.md` 的互链，并在窗口 B 中打开。
2. 在窗口 A 触发 `旧名.md` 改名，进入批量同步。
3. 在 C 的读取与写回之间让 B 保存新内容。
4. 检查 C 是否只剩同步器读到的旧内容加新链接。

**调用链**：扫描目录 → `fs::read_to_string(C)` → `rewrite_wikilink_targets()` → `atomic_write(C)`。

**现有保护及缺口**：有扩展名闸门、扫描上限和跳过自身；但没有读取版本、mtime 比较、内容哈希或写入锁。UTF-16 等非 UTF-8 引用文件还会被直接跳过，导致链接同步不完整。

**证据**：[document.rs:749](../../src-tauri/src/commands/document.rs#L749)、[document.rs:775](../../src-tauri/src/commands/document.rs#L775)、[document.rs:780](../../src-tauri/src/commands/document.rs#L780)。

**审核判据**：批量改写必须采用“读版本 → 改写 → 条件写回”，发现磁盘已变化就跳过/冲突；同时应明确非 UTF-8 文件的处理策略。

### F-08 · P2 · URL 整体解码会把保留字符一起解释，改变链接目标

**用户症状**：链接或图片地址同时含 `%20`、中文编码或 `%5C` 时，`%23`、`%26`、`%2F` 等保留字符也被解码；例如 `%23` 从路径字符变成片段分隔符，链接可能指错文件或断链。

**最小复现建议**：

1. 打开 `[报告](目录%20甲/文件%23乙.md)`。
2. 检查解析后的 link 节点 `href`。
3. 对比原始百分号编码地址与节点目标，观察 `%23` 是否已变成 `#`。

**调用链**：`decodeLinkDestination()` 只要命中任一解码条件，就对整个值执行 `decodeURIComponent()`。

**现有保护及缺口**：纯 ASCII 的 `%25` 等在不触发条件时保留，这是有效保护；但触发条件是“整个 URL 级”的，无法区分需要还原的字节与必须保留的保留字符。

**证据**：[parser.ts:85](../../src/components/Editor/tiptap/markdown/parser.ts#L85)、[parser.ts:99](../../src/components/Editor/tiptap/markdown/parser.ts#L99)。

**审核判据**：解码应针对明确由 markdown-it 产生的字节，不应把合法保留字符一并解释；至少要为 `%23`、`%26`、`%2F`、`%3D` 建立往返用例。

### F-09 · P1 · 重复脚注标签会静默丢掉较早定义的正文

**用户症状**：同一标签出现两个定义时，较早定义的正文整段消失，不报错、不提醒。

**最小复现建议**：

```md
文字[^1]

[^1]: 甲定义

[^1]: 乙定义
```

保存后只保留 `乙定义`。

**调用链**：脚注解析器将定义收进 section，重复标签在建模阶段只剩一个可表示的定义；序列化器只能写出最终留下的定义。

**现有保护及缺口**：`safety-net.spec.ts` 已明确用“仍然会丢”的双向登记锁证明该行为存在；测试绿不代表缺陷不存在。

**证据**：[safety-net.spec.ts:60](../../src/components/Editor/tiptap/markdown/__tests__/safety-net.spec.ts#L60)、[safety-net.spec.ts:70](../../src/components/Editor/tiptap/markdown/__tests__/safety-net.spec.ts#L70)、[plugins/footnote.ts:9](../../src/components/Editor/tiptap/markdown/plugins/footnote.ts#L9)。

**台账状态**：K，`KNOWN-ISSUES.md` #43，暂不处理。见 [KNOWN-ISSUES.md:147](../KNOWN-ISSUES.md#L147)。

**审核判据**：这是确定内容丢失，不应因“已登记”降级为格式问题。

### F-10 · P2 · CommonMark 引用定义、空 label 链接与嵌套同型强调仍会丢失

**用户症状**：

- 未使用的 `[foo]: /url` 引用定义整行消失。
- `[](url)`、`[]()` 空 label 链接整行消失。
- 嵌套同型强调掉一层格式，部分形态不收敛。

**最小复现建议**：使用 `safety-net.spec.ts` 的 CommonMark 207、418、432、484、487 五个编号输入，比较原文、输出与重开后的结构。

**调用链**：Markdown token 映射到 ProseMirror 扁平 marks/nodes；schema 无法表达的深度或空 label 没有保真载体，序列化时消失。

**现有保护及缺口**：这些例子在 CommonMark SKIP 与安全网中都有登记；保护作用是“变好时提醒删登记”，不是阻止当前丢失。marks 的 `addToSet/removeFromSet` 只能表示同类型 mark 的开/关，不能表示嵌套深度。

**证据**：[safety-net.spec.ts:100](../../src/components/Editor/tiptap/markdown/__tests__/safety-net.spec.ts#L100)、[parser.ts:292](../../src/components/Editor/tiptap/markdown/parser.ts#L292)。

**台账状态**：K，`KNOWN-ISSUES.md` #44，未解决。见 [KNOWN-ISSUES.md:148](../KNOWN-ISSUES.md#L148)。

**审核判据**：引用定义/空 label 是内容或链接实体丢失；嵌套强调至少是结构降级，两类不应混为同一严重度叙述。

### F-11 · P2 · 图片只有宽度或只有高度时，尺寸元数据被丢弃

**用户症状**：从 HTML 粘贴仅带 `width` 或仅带 `height` 的图片，编辑器不显示该尺寸，保存后 Markdown 也没有尺寸信息。

**最小复现建议**：

1. 粘贴 `<img src="a.png" width="320">` 与 `<img src="b.png" height="180">`。
2. 检查图片节点 attrs、NodeView 的 DOM 属性。
3. 保存并重开，检查 `|WxH` 尺寸后缀是否缺失。

**调用链**：图片 `parseHTML` 可独立读取 width/height → NodeView 只在两者都存在时写 DOM → serializer 只在两者都存在时输出 `|WxH`。

**现有保护及缺口**：双边尺寸路径正常；单边尺寸没有退化表达，内存 attrs 中有值也会在显示与落盘两端被忽略。

**证据**：[image.ts:364](../../src/components/Editor/tiptap/extensions/image.ts#L364)、[image.ts:456](../../src/components/Editor/tiptap/extensions/image.ts#L456)、[serializer.ts:885](../../src/components/Editor/tiptap/markdown/serializer.ts#L885)。

**审核判据**：这是确定的元数据丢失；若产品只支持双边尺寸，应在入口明确拒绝/归一单边尺寸，而不是静默忽略。

### F-12 · P2 · 完全空的 frontmatter `---\n---` 不被识别

**用户症状**：文件开头的空 YAML frontmatter 被当成普通 Markdown 分隔线，保存时可能被规整为两条普通分隔线，frontmatter 身份丢失。

**最小复现建议**：

```md
---
---
正文
```

对比 `---\n\n---\n正文`，检查是否只有后者被建成 `frontmatter` 节点。

**调用链**：`FRONTMATTER_RE` 要求关闭 `---` 前还有一个换行；紧邻写法的两个分隔线之间没有内容行，无法命中。

**现有保护及缺口**：代码已专门处理 `---\n\n---` 的“命中且 raw 为空”，避免空头被吞；但正则本身仍不接受紧邻空头。

**证据**：[frontmatter.ts:12](../../src/components/Editor/tiptap/markdown/plugins/frontmatter.ts#L12)、[frontmatter.ts:17](../../src/components/Editor/tiptap/markdown/plugins/frontmatter.ts#L17)。

**审核判据**：空 YAML 文档是否属于产品支持范围需要明确；若不支持，应文档化；若支持，当前正则会漏判。

## 5. 待真机验证候选（C）

### F-13 · P2 候选 · code mark 包住行内图片时，重开可能变成字面文本

**静态现象**：序列化器对非文本 inline 节点也会在两侧渲染 marks；图片扩展配置为 inline。若图片带 `code` mark，写出形态可能成为代码 span 中包含图片 Markdown，而不是图片节点。

**为何不直接定为确认缺陷**：源码路径静态可达，但真实用户通过哪种 HTML 粘贴、命令或拖拽操作能稳定造出该组合，本轮未运行验证。

**复核建议**：

1. 通过 HTML 粘贴尝试构造 `<code><img src="a.png"></code>` 或等效结构。
2. 检查 PM doc 中 image 是否带 `code` mark。
3. 序列化并重开，观察是否仍为 image 节点。
4. 若可稳定复现，再确认实际 UI 可达性与严重度。

**证据**：[serializer.ts:327](../../src/components/Editor/tiptap/markdown/serializer.ts#L327)、[image.ts:671](../../src/components/Editor/tiptap/extensions/image.ts#L671)。

## 6. 已知、取舍与文档漂移

### 6.1 已知/取舍条目

| 条目 | 本报告口径 | 依据 |
|---|---|---|
| #35 callout 混合格式标题 | K；源码仍显示标题只从首个 text token 提取，暂缓项 | [KNOWN-ISSUES.md:139](../KNOWN-ISSUES.md#L139)、[callout.ts:53](../../src/components/Editor/tiptap/markdown/plugins/callout.ts#L53) |
| #38 另存/改名快照回灌 | K；与本报告 F-02 同一问题，已暂缓 | [KNOWN-ISSUES.md:142](../KNOWN-ISSUES.md#L142) |
| #39 UTF-16/BOM/换行 | K；BOM 与 CRLF/CR 已解决，UTF-16 转 UTF-8 是明示取舍 | [KNOWN-ISSUES.md:143](../KNOWN-ISSUES.md#L143) |
| #41 原子写权限不保留 | K；Unix mode / Windows ACL 不保留，已暂缓 | [KNOWN-ISSUES.md:145](../KNOWN-ISSUES.md#L145) |
| #42 改回原文仍显示脏 | K；误标脏存在，但简单置 false 会造成真丢稿 | [KNOWN-ISSUES.md:146](../KNOWN-ISSUES.md#L146)、[file.ts:82](../../src/stores/file.ts#L82) |
| #43 重复脚注定义 | K；与本报告 F-09 同一问题，已暂缓 | [KNOWN-ISSUES.md:147](../KNOWN-ISSUES.md#L147) |
| #44 CommonMark 五条缺口 | K；与本报告 F-10 同一问题，未解决 | [KNOWN-ISSUES.md:148](../KNOWN-ISSUES.md#L148) |
| #54 出站 HTML 降级 | K；无编辑器时回退 `markdown-to-html`，不按新缺陷上报 | [KNOWN-ISSUES.md:158](../KNOWN-ISSUES.md#L158)、[StatusbarQuickActions.vue:107](../../src/components/StatusbarQuickActions.vue#L107) |

### 6.2 已接受的文件/格式归一

- UTF-16 保存为 UTF-8；UTF-8 BOM 与 CRLF/CR 保留。
- 混合换行按主导/原布局样式归一。
- 序列化器统一单个尾换行。
- GFM 表格空格对齐会重排一次。
- 外部修改采用提示而非静默重载。
- 无编辑器时的对外 HTML 是明确低保真回退。

这些属于产品取舍，不应在“保真缺陷”计数中重复累计。

### 6.3 D-01 · #60/#63 的台账状态已落后于当前代码

**文档现状**：`KNOWN-ISSUES.md` #60 仍写“单元格可造块级结构、只拍平第一层”，#63 仍写“`<br>` 读侧是死代码”。

**当前代码**：

- 单元格/表头 schema 已收紧为 `paragraph`。
- `renderFlattenedInline()` 在递归每层兄弟块之间补 `<br>`。
- `MarkdownParseState.addText()` 已在表格单元格内把 `<br>` 还原为 `hardBreak`，并排除 code mark。

**结论**：正常用户路径下，#60/#63 的原始主要症状已实质修复；台账与 `docs/INDEX.md` 的摘要仍描述旧状态，会误导第三方把已修问题重复立项。旧 JSON/未来 schema 回归仍由拍平分支兜底，但不能再把“正常入口仍可造块”作为当前事实。

**证据**：[KNOWN-ISSUES.md:164](../KNOWN-ISSUES.md#L164)、[KNOWN-ISSUES.md:167](../KNOWN-ISSUES.md#L167)、[INDEX.md:99](../INDEX.md#L99)、[table.ts:41](../../src/components/Editor/tiptap/extensions/table.ts#L41)、[serializer.ts:367](../../src/components/Editor/tiptap/markdown/serializer.ts#L367)、[parser.ts:259](../../src/components/Editor/tiptap/markdown/parser.ts#L259)。

本报告只记录漂移，未修改台账正文。

## 7. 测试盲区（T）

### T-01 · `roundTrip()` 不覆盖编辑器、IPC、磁盘与重开

`roundTrip()` 只执行 `parseMarkdown → serializeMarkdown`，因此 F-01～F-07 的生命周期/磁盘竞态天然不在其覆盖范围。纯函数绿不能证明“用户保存后重开内容仍在”。

**证据**：[test-utils.ts:45](../../src/components/Editor/tiptap/markdown/__tests__/test-utils.ts#L45)。

**需要的证据层级**：真实编辑器或可控调度 → `save_document` → 临时目录落盘 → 重新 open → 比较用户可见内容与结构。

### T-02 · 全仓保真扫描的签名基线与扫描范围互斥

`SKIP_DIRS` 明确跳过 `docs`、`archive`、`wiki`，但 `KNOWN_SCAN_SIGNATURES` 的全部键都是 `docs/...`。这些签名无法由当前 walk 命中，不能作为有效棘轮。扫描还主要看标签种类净减少与两轮收敛，不能证明 URL/属性、文本顺序或私有语法保真。

**证据**：[fidelity-scan.spec.ts:58](../../src/components/Editor/tiptap/markdown/__tests__/fidelity-scan.spec.ts#L58)、[fidelity-scan.spec.ts:106](../../src/components/Editor/tiptap/markdown/__tests__/fidelity-scan.spec.ts#L106)、[fidelity-scan.spec.ts:121](../../src/components/Editor/tiptap/markdown/__tests__/fidelity-scan.spec.ts#L121)。

### T-03 · “登记锁”会主动锁定坏行为，测试绿不等于没有缺陷

重复脚注定义与 CommonMark 缺口的测试断言当前仍会丢失；这是有意的双向锁，用于提醒维护者修复后删登记。审核报告必须区分“测试通过”与“产品行为正确”。

**证据**：[safety-net.spec.ts:68](../../src/components/Editor/tiptap/markdown/__tests__/safety-net.spec.ts#L68)、[safety-net.spec.ts:119](../../src/components/Editor/tiptap/markdown/__tests__/safety-net.spec.ts#L119)。

## 8. 第三方复核清单

请第三方按以下顺序复核，不必接受本报告的自述：

1. **先锁定基线**：核对 commit `2a4bf41` 与当前源码，确认没有后续修复改变结论。
2. **逐条回到第一现场**：打开每个 `file:line`，确认调用方向、await 边界和数据覆盖方向。
3. **竞态类必须挑战可达性**：F-01～F-07 不是“必然发生”，要明确需要怎样的调度交错；但不要用 `atomic_write` 回答 lost-update 问题。
4. **分开验证现有保护**：普通保存补偿、外部刷新二次判脏、路径跟随不回灌，都是真实保护，不能因为别的路径有洞就一并否定。
5. **对 F-09/F-10 看测试断言本身**：确认登记锁是否真的在断言“坏行为仍在”。
6. **对 F-13 做真机入口验证**：未稳定复现前保持候选，不升级为确认缺陷。
7. **对 #60/#63 先读当前 parser/schema**：不要照抄旧台账状态。
8. **输出复核结论**：每条标记“证实 / 证伪 / 需运行验证”，并附新的源码或运行证据；不要只给同意/不同意。

## 9. 建议处理顺序（仅建议，本轮未执行）

1. **先收口 P1 生命周期**：F-03、F-04、F-01、F-02。它们直接对应用户刚输入的文字消失，修复边界集中在前端会话层。
2. **再收口跨窗口覆盖**：F-05、F-06、F-07。它们需要明确版本/锁策略，不能只提高 mtime 精度。
3. **随后处理确定内容丢失**：F-09；若产品接受重复脚注语义，至少应明确保留策略并消除静默。
4. **最后处理 P2 与文档漂移**：F-08、F-10、F-11、F-12、D-01，并补 T-01 的端到端行为锁。

## 10. 本次执行边界与修订记录

- 已执行：只读源码审核；新增本报告；在 `docs/INDEX.md` 登记本报告。
- 未执行：代码修复、测试、构建、应用探针、真机复现、`KNOWN-ISSUES.md` 回填、提交。
- 修订：v1（2026-11-25），首次落地，证据基线 `2a4bf41`。
