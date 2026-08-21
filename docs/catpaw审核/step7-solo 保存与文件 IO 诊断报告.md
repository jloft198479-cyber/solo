# solo 保存与文件 I/O 诊断报告（Step 7）

> 只读排查，未修改任何代码。排查日期：2026-08-21。
> 依据：以实际代码为准。排查范围：自动保存触发、序列化开销、IPC/Rust 写入、冲突处理、失败感知与内容丢失风险。
> 关联报告：[step2](./step2-solo%20%E7%BC%96%E8%BE%91%E5%99%A8%E8%BE%93%E5%85%A5%E5%93%8D%E5%BA%94%E4%B8%8E%E5%BB%B6%E8%BF%9F%E8%AF%8A%E6%96%AD%E6%8A%A5%E5%91%8A.md)（serialize 防抖退化）、[step4](./step4-solo%20%E7%BC%96%E8%BE%91%E5%99%A8%E6%95%B4%E4%BD%93%E6%9E%B6%E6%9E%84%E4%B8%8E%E6%89%A9%E5%B1%95%E6%9C%BA%E5%88%B6%E8%AF%8A%E6%96%AD%E6%8A%A5%E5%91%8A.md)（数据流与脏态真相源）、[step6](./step6-solo%20%E6%B8%B2%E6%9F%93%E7%AE%A1%E7%BA%BF%E4%B8%8E%20ProseMirror%20%E5%A2%9E%E9%87%8F%E6%9B%B4%E6%96%B0%E8%AF%8A%E6%96%AD%E6%8A%A5%E5%91%8A.md)（渲染管线）。

---

## 一、核心结论

**保存链路整体是「诚实且健壮」的：原子写 + spawn_blocking + 互斥锁 + A1 语义比对兜底，没有「确定性会丢数据」的 bug。** 发现的问题集中在三类：**一条可触发的保存死锁路径（中）、自动保存失败时的弹窗轰炸（中）、以及三处死代码/未接线（低）**。

一次保存从击键到磁盘的完整链路：

```
用户编辑 → onUpdate → 500ms 防抖 serializeMarkdown → syncEditedContent 语义比对标脏
   ↓（保存触发：Ctrl+S / 自动保存 / 关窗/切换闸口）
persistDocument → getContent() 实时 serializeMarkdown（同步全量 O(n)，主线程）
   ↓ invokeCommand（JSON 序列化传输）
Rust save_document（async）→ spawn_blocking：
   ① mtime 冲突检查（expected_last_modified_ms 比对）→ 冲突返回 document_conflict
   ② 原子写：写 .{name}.{millis}.tmp → fs::rename 覆盖目标
   ③ 读回新 mtime
   ↓
markSaved(新 mtime) 清脏
```

---

## 二、五面排查明细

### 面 1：自动保存触发时机与频率 ✅ 设计合理，有一处死代码

**机制**（`useDocumentSession.ts:327-360`）：watch `[autoSave, autoSaveInterval]` 启用后**递归 setTimeout**——每个 tick 的 `scheduleNext()` 在 `await saveCurrentDocument()` 完成之后才调用（`:340-354`），天然保证「保存飞行中不叠加下一个 tick」，无需额外互斥。触发条件 `isDirty && path && !autoSavePaused`。

| 项       | 值                                                                       | 评价         |
| ------- | ----------------------------------------------------------------------- | ---------- |
| 默认开关    | `autoSave: false`、`interval: 30s`（`settings.ts:50-51`）                  | 默认关闭，保守 ✅  |
| 间隔下限    | `max(interval, 5)` 双重保护（`settings.ts:94` + `useDocumentSession.ts:336`） | ✅          |
| 触发频率    | 仅 dirty 时每 interval 一次；不 dirty 时空 tick                                  | 无浪费 ✅      |
| 并发防护    | `_savePromise` 互斥锁（`:183-184`）+ 递归 setTimeout                           | 手动/自动不并发 ✅ |
| **死代码** | `autoSavePaused`（`:30,203,282,345,348`）**全项目从未被置 true**，恒 false         | ⚠️ 历史遗留    |

**autoSavePaused 分析**：原设计应是「冲突弹窗期间暂停自动保存」，但 `document_conflict` 分支后来改成「confirm → 强制覆盖」（`:207-219`），暂停机制被取代后变量未清理。当前恒 false \= 不影响行为，纯死代码。

### 面 2：序列化是否卡 UI ⚠️ 自动保存触发时有可感知卡顿（大文档），但非高频

- **保存路径必然同步全量序列化**：`persistDocument` 用 `options.getContent()` 实时取数（`:174`），即 `serializeMarkdown(editor.state.doc)` 同步 O\(n\)。Step 2 P3-1 已实测量级：**大文档（10 万字）10\~100ms**，是全应用最贵单次操作。
- **自动保存场景最伤**：用户在打字时自动保存触发 → 同步序列化阻塞主线程 → 一次可感知卡顿。频率 ≥5s 一次，不是高频，但大文档 + 慢打字叠加时体感明显。
- **拼接无 O\(n²\) 灾难**：`serializer.ts` 用 `this.output += text`（`:35`），V8 cons-string 摊销近似 O\(n\)，成本在遍历与逻辑本身，不在字符串拼接。
- 手动保存（Ctrl+S）同样同步序列化，但用户主动操作，可接受。
- 关窗/切换闸口 `evaluateDirtyFromEditor`（`:111-116`）也同步序列化——见问题 P2-S7-2。

### 面 3：IPC 传输与 Rust 写入 ✅ 健壮，一处静默跳过

**Rust 侧全链路在异步层**：`save_document` 是 `async` 命令，冲突检查 + 原子写 + 读 mtime 全部在 `spawn_blocking` 内（`document.rs:47-63`）——不阻塞 Tauri 主线程 ✅。

| 项         | 实现                                                                                                                            | 评价                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 原子写       | 写 `.{name}.{millis}.tmp` → `fs::rename`（Windows `MOVEFILE_REPLACE_EXISTING` / Unix `rename(2)`，`document.rs:434-454`）         | ✅ 防半写，磁盘要么旧要么新       |
| 临时文件清理    | `open_document` 时清理 \>1h 的同名 `.tmp` 残留（`:24-25,460-499`），只删纯数字中段、守卫双开进程                                                       | ✅（AGENTS 历史经验落地）     |
| 异常传递      | `AppError` 序列化为 `{code, message}`（`error.rs:38-48`），前端 `normalizeTauriError` 还原                                               | ✅ 无吞没                |
| **静默跳过点** | 冲突检查 `if let Ok(current_modified) = read_modified_time_ms(...)`（`document.rs:51`）——metadata 读失败（文件被外部删除/权限异常）时**跳过冲突检查直接原子写** | ⚠️ 外部删文件后保存会静默重建，无提示 |

**IPC 传输**：content 字符串走 Tauri v2 默认 JSON 序列化。10 万字 markdown ≈ 数百 KB，`JSON.stringify` 与传输各几 ms 且 invoke 是异步的，不阻塞 UI。✅

### 面 4：多窗口 / 外部修改冲突 ⚠️ 被动检测健全，主动检测未接线

**保存时被动冲突检测链（健全）**：打开文档存 `lastModifiedMs`（`applyLoadedDocument` → `setFile`）→ 保存传 `expected_last_modified_ms` → Rust 比对当前 mtime → 不等返回 `document_conflict` → 前端 confirm「强制覆盖？」→ `saveCurrentDocument(true)` 跳过检查直接写（`useDocumentSession.ts:207-219`）。有测试覆盖（`save_document_reports_conflicts` / `save_document_force_skips_conflict_check`）✅。

**两个已知局限（均低风险）**：

1. **双开 solo 窗口互写不可防**：A 保存成功 → mtime 更新；B 保存时 expected（打开时旧 mtime）≠ 当前 → 冲突（正确）；但 **A 再次保存时 expected \= 自己写入的 mtime \= 当前** → 无冲突 → last-writer-wins，双方都「以为安全」。mtime 冲突检测只能防「编辑期间被外部程序修改」，防不了「两个 solo 窗口交替保存」——这是所有 mtime 方案的通病（VS Code 靠文件 watcher + 内容哈希）。
2. **外部修改无主动检测**：`externalFileWarning`（状态栏警告槽位，`App.vue:322`）**全项目从未被赋非 null 值**——只有声明（`useDocumentSession.ts:25`）、清空（`:299`）、显示（`App.vue:322`），检测逻辑从未接线。外部修改只有「保存那一刻」才被动感知。

### 面 5：保存失败感知与内容丢失风险 ✅ 兜底健全，一条死锁路径

**健全的兜底**（逐一验证）：

- **关窗闸口**：`handleCloseRequest` → `stopAutoSave` → `isDirty()`（App.vue:149 接 `evaluateDirtyFromEditor`，**实时序列化评估，不会丢最后半秒** ✅）→ 三选一弹窗 → save 失败 `return false` 不关窗 → 保存窗口状态 → destroy（`useAppWindowSession.ts:132-156`）✅
- **保存飞行中继续编辑**：`persistDocument` 把快照写回基线 → IPC 飞行期间用户打字 → `markSaved` 清脏 → 500ms 后 debounce 触发 `syncEditedContent`（实时 doc）与基线比对 → 不同重新标脏。A1 语义比对兜底，**不丢内容** ✅
- **保存失败后 isDirty 保持 true**：失败路径不调 `markSaved`；后续 `syncEditedContent` 相同时「不改动、不清脏」（`file.ts:57-66`）→ 状态栏持续「未保存」，下个 tick 重试 ✅ 自洽
- **崩溃/断电**：自动保存开启时最多丢「上次成功保存后 \~5s」的编辑；原子写保证磁盘文件不半写 ✅
- **大文档打开确认**：\>10 万字弹 confirm（`loadDocumentFromPath:76-85`），且 loading 已释放不阻塞弹窗 ✅

**问题路径**：

- **P1-S7-1【风险·中】rename 成功后写内容失败 → 保存死锁 + 文件分裂**（详见问题清单）

---

## 三、问题清单（按严重程度降序）

### P1-S7-1【风险·中】标题重命名保存：rename 成功 + 内容写失败 → 保存永久卡死 + 磁盘文件分裂

**位置**：`useDocumentSession.ts:267-292`（`saveRenamedDocument`）+ `document.rs:93-133`（`rename_file`）

**触发时序**：

1. 用户在标题栏改名 → `setDisplayName` 标脏（`App.vue:72-76`）
2. 保存 → `saveCurrentDocument` 检测 `displayName ≠ originalBaseName` → `saveRenamedDocument`
3. `renameFile("old.md", "new")` **成功** → 磁盘只有 `new.md`（旧内容）
4. `persistDocument("new.md", true, null)` **失败**（磁盘满 / 权限 / 杀软锁文件）
5. catch → 弹「保存失败」→ return false。**但 store.path 仍是 **`"old.md"`，磁盘上已无 old.md
6. 下次保存 → 再次 `saveRenamedDocument` → `renameFile` 检测 `!old_path_ref.exists()` → `validation("原文件不存在")`（`document.rs:95-97`）→ **永久卡死**，无恢复路径

**后果**：内容不丢（编辑器内存 + new.md 有旧内容），但保存流程死锁，用户被迫另存为脱困，且「保存失败: 原文件不存在」提示极具迷惑性。

**修复方向**（待确认后实施）：rename 成功后写内容失败时，**把 **`store.path` 同步为新路径（写失败但文件确实已改名），或尝试 rename 回旧名回滚。最小改动是 catch 分支里把 `fileStore.renamePath(renameResult.path)`，让后续保存直接走旧路径写入而非再次 rename。

### P1-S7-2【UX·中】自动保存持续失败 → 弹窗轰炸

**位置**：`useDocumentSession.ts:205-224`（catch 统一 `await message(...)`）+ `:345-351`（每 tick 重试）

**机制**：自动保存失败走与手动保存相同的 modal 错误弹窗。磁盘满 / 目标文件被锁等持续失败场景下，**每 ≥5s 弹一次**，用户无法关掉（关掉后下个 tick 又弹），且状态栏无「保存失败」常驻提示（`updateAutoSaveStatus` 只在成功时调用）。

**修复方向**：自动保存失败不弹 modal——降级为状态栏警告（复用 `externalFileWarning` 槽位）+ 指数退避重试（如 5s→10s→30s 封顶）。

### P2-S7-1【性能·中-低】自动保存每次触发同步全量序列化，卡用户打字主线程

**位置**：`useDocumentSession.ts:174`（`persistDocument` 的 `getContent()`）→ `serializeMarkdown` 同步 O\(n\)

**量级**：大文档 10\~100ms（Step 2 P3-1）。自动保存触发时用户正打字 → 同步阻塞 → 一次可感知卡顿。手动保存同路径但用户主动，可接受。慢打字者场景（serialize 防抖退化每按键序列化）在 Step 2 P3-1 已记录，保存路径在此之上额外叠加。

**修复方向**：自动保存路径的序列化错峰（`requestIdleCallback` / `setTimeout 0` 后取数），或保存前先检查「距上次 serialize 防抖结果是否未变」跳过重复序列化。Worker 化需迁移 PM schema 依赖，成本高，列为远期。

### P2-S7-2【性能·低】关窗链路两次全量序列化

**位置**：`useAppWindowSession.ts:135`（`isDirty()` → `evaluateDirtyFromEditor` 序列化一次）→ 用户点「保存」→ `saveCurrentDocument` → `persistDocument` 再序列化一次

**机制**：关窗评估脏态与保存取数各一次 `serializeMarkdown`。弹窗期间用户无法编辑，两次结果一致，纯冗余开销。大文档关窗多 \~1 倍序列化时间（可在 `evaluateDirtyFromEditor` 缓存结果供 `persistDocument` 复用，但收益小）。

### P3-S7-1【死代码】`autoSavePaused` 恒 false

**位置**：`useDocumentSession.ts:30,203,282,345,348`

**分析**：原「冲突弹窗期间暂停自动保存」机制被 force-overwrite 取代后未清理。不影响行为，建议删除或复用。

### P3-S7-2【未接线】外部修改主动检测从未实现

**位置**：`useDocumentSession.ts:25,299` + `App.vue:322`

**分析**：`externalFileWarning` 状态栏槽位、`externalWarningTimer` 定时器、`clearExternalWarning` 复位函数都已就位，但**没有任何代码为 **`externalFileWarning.value` 赋非 null 值。外部修改只在保存瞬间被动冲突检测。若要实现主动检测：定时 mtime 轮询（保存时记录 mtime，前台定时比对）或 Tauri `fs` 事件监听，命中时置 `externalFileWarning`。

### P3-S7-3【静默】外部删除文件后保存静默重建

**位置**：`document.rs:51`（`if let Ok` 跳过冲突检查）→ `atomic_write` 重建文件

**分析**：文件被外部删除后，冲突检查读 metadata 失败 → 跳过 → 原子写重新创建文件。行为「合理」（保存即恢复），但用户无感知，可能覆盖「用户已接受删除」的意图。低风险，可选提示。

---

## 四、健全项清单（本次排查确认无问题的设计）

| 项        | 证据                                                                   | 评价                 |
| -------- | -------------------------------------------------------------------- | ------------------ |
| Rust 原子写 | `document.rs:434-454` temp + rename                                  | ✅ 防半写              |
| 全 IO 异步化 | `save_document` async + `spawn_blocking`（`:39-71`）                   | ✅ 不阻塞主线程           |
| 保存互斥     | `_savePromise` / `isSaving`（`useDocumentSession.ts:180-197,235,268`） | ✅ 手动/自动/rename 不并发 |
| 脏态真相源    | A1 `syncEditedContent` 语义比对（`file.ts:57-66`）                         | ✅ 保存飞行中编辑不丢        |
| 关窗闸口实时评估 | `evaluateDirtyFromEditor`（`App.vue:149` 接线正确）                        | ✅ 不丢最后半秒           |
| 冲突检测链    | mtime 比对 + confirm 强制覆盖 + 测试覆盖                                       | ✅ 被动检测健全           |
| 大文档打开确认  | \>10 万字 confirm，loading 已释放                                          | ✅ 不阻塞              |
| 崩溃残留清理守卫 | \>1h + 纯数字中段 + 前缀后缀双匹配（`document.rs:460-499`）                        | ✅ 防误删双开进程          |

---

## 五、与既有步骤的边界

| 本报告问题          | 与既有步骤的关系                                                          |
| -------------- | ----------------------------------------------------------------- |
| P1-S7-1 死锁     | 新发现（涉及 rename + persist 组合路径，此前各步未审计保存链路）                         |
| P1-S7-2 弹窗轰炸   | 新发现                                                               |
| P2-S7-1 序列化卡顿  | Step 2 P3-1 同源（`serializeMarkdown` 是全应用最贵单次操作），本报告补充「自动保存路径」这一触发点 |
| P2-S7-2 关窗双序列化 | 新发现（`evaluateDirtyFromEditor` 与 `persistDocument` 的组合）            |
| P3-S7-1/2/3    | 新发现（死代码 / 未接线 / 静默行为）                                             |
| 数据流与脏态真相源      | Step 4 §3（本报告引用其结论，未重复审计）                                         |

---

## 六、修复方向汇总（待确认后实施）

1. **P1-S7-1**：`saveRenamedDocument` 的 catch 分支把 `store.path` 同步为新路径（rename 已成功，文件确实改名了），消除保存死锁。
2. **P1-S7-2**：自动保存失败不弹 modal，降级为状态栏警告 + 指数退避重试（可复用 `externalFileWarning` 槽位）。
3. **P2-S7-1**：自动保存路径序列化错峰（空闲调度）或复用防抖结果，避免大文档保存瞬间卡打字。
4. **P3-S7-2**：接线外部修改主动检测（mtime 轮询 / fs 事件），状态栏槽位已在。
5. **P3-S7-1**：删除 `autoSavePaused` 死变量（或与 #2 一并改造为「失败退避中暂停」的实际用途）。

 

# Dumate复审

报告读完。大部分 P1/P2 问题与前序报告重复（已核实），这次重点核实 Step 6 新增的内容：扩展计数（32项）、主题切换链路（manager.ts）、injectTypography 无 diff、KaTeX 同步渲染、NodeView.update 全返回 true、DOM 结构深度表。

现在核实 NodeView.update 全返回 true 的说法——需要检查所有有 NodeView 的扩展。

所有关键代码已读完。逐一给出核实结论。

---

## 核实结论

### 扩展计数：32 项 — **需要修正**

逐行清点 `editor-extensions.ts:130-265` 返回数组：

| \#  | 扩展                        | 类型         |
| --- | ------------------------- | ---------- |
| 1   | StarterKit.configure      | 组合（含多个子扩展） |
| 2   | Frontmatter               | Node       |
| 3   | FootnoteRef               | Node       |
| 4   | FootnoteSection           | Node       |
| 5   | FootnoteDef               | Node       |
| 6   | SemanticHeading           | Node       |
| 7   | CustomCodeBlock           | Node       |
| 8   | CustomTable               | Node       |
| 9   | CustomTableRow            | Node       |
| 10  | CustomTableHeader         | Node       |
| 11  | CustomTableCell           | Node       |
| 12  | CustomImage               | Node       |
| 13  | Callout                   | Node       |
| 14  | Highlight.configure       | Mark       |
| 15  | ParagraphFocus            | Extension  |
| 16  | SearchHighlight.configure | Extension  |
| 17  | Link.configure            | Mark       |
| 18  | LinkOpen                  | Extension  |
| 19  | TaskList                  | Node       |
| 20  | TaskItem.configure        | Node       |
| 21  | Placeholder.configure     | Extension  |
| 22  | MathBlock                 | Node       |
| 23  | MathInline                | Node       |
| 24  | MermaidBlock              | Node       |
| 25  | MarkdownInput             | Extension  |
| 26  | MarkdownPaste.configure   | Extension  |
| 27  | Superscript               | Mark       |
| 28  | Subscript                 | Mark       |
| 29  | Dim                       | Mark       |
| 30  | Wikilink.configure        | Mark       |
| 31  | SlashCommands.configure   | Extension  |
| 32  | EmojiSuggest.configure    | Extension  |

**总计 32 项，其中 31 个自定义** ✅。报告计数正确。

但报告把它们分成"6 组 Node 型 + 14 个扩展型"——实际清点：Node 型 18 个（Frontmatter/Footnote×3/SemanticHeading/CustomCodeBlock/Table×4/CustomImage/Callout/MathBlock/MathInline/MermaidBlock/TaskList/TaskItem \= 18），Mark 型 6 个（Highlight/Link/Superscript/Subscript/Dim/Wikilink），Extension 型 8 个（ParagraphFocus/SearchHighlight/LinkOpen/Placeholder/MarkdownInput/MarkdownPaste/SlashCommands/EmojiSuggest）。报告的分类描述有误，但不影响"32 项"的核心结论。

### P0-A：DOM 结构深度表 — **基本正确，两处需修正**

逐项核实：

- **codeBlock**：报告说 `div.mk-code-block-shell > (div.header + pre > code)`，3-4 层 ✅
- **mermaidBlock**：`div.mk-mermaid-block > (div.header + div.render + div.edit)`，2-3 层 ✅
- **mathBlock**：`div.mk-math-block > (div.header + div.render + div.edit)`，2-3 层 ✅
- **mathInline**：`span.mk-math-inline`，1 层 ✅
- **image**：`span.mk-image-shell > (img + figcaption + div.source-text)`，2-3 层 ✅
- **callout**：报告说 `contentDOM = dom`，1-2 层 ✅（`callout.ts:63` 确认）
- **frontmatter**：`div.mk-frontmatter > (div.header + div.content > text)`，2-3 层 ✅
- **table**：报告说 5-6 层，`renderWrapper:true` ✅

**两处修正**：

1. **footnoteSection/footnoteDef**：报告说"renderHTML 渲染，无 NodeView"。但 `grep` 结果中 `footnote.ts` 没有出现在 NodeView（`isolating|contentDOM`）的搜索结果中——确认无 NodeView，走 renderHTML ✅。但报告说的"2-3 层"取决于 renderHTML 输出结构，报告没有提供 `renderHTML` 的具体实现引用，这个深度是推测的。
2. **footnoteRef**：报告说"sup 原子节点（无 NodeView）"——但 `footnote.ts` 未出现在 NodeView grep 结果中，确认走 renderHTML。`sup` 是 inline 原子节点，1 层 ✅。

### P1-D：主题切换链路 — **完全正确**

`manager.ts:242-258` 的 `applyTheme` 逐行确认：

1. 第 243 行 `classList.add('theme-transitioning')` ✅
2. 第 244 行 `getBoundingClientRect()` 强制重排 ✅
3. 第 245 行 `applyDarkClass` ✅
4. 第 246 行 `injectColors`（diff 注入，第 147-150 行确认）✅
5. 第 248 行 `injectTypography`（**无条件全量重写**，见下方 P2-A）✅
6. 第 252 行 `triggerContentCrossfade` ✅
7. 第 255-257 行 `setTimeout` 200ms 后移除 `theme-transitioning` ✅

`main.css:385-390` 确认 `theme-transitioning *` + `*::before/after` 全选器 + `!important` ✅

报告说的完整链路（MutationObserver → RAF → mermaid 重渲 + refreshParagraphFocus）已在 Step 4 P1-B 核实确认 ✅

### P2-A：injectTypography 无条件全量重写 — **完全正确**

`manager.ts:204-222` 逐行确认：

```js
function injectTypography(typography?: ThemeTypography) {
  const style = document.documentElement.style;
  // 先重置所有排版变量为空字符串
  for (const cssVar of Object.values(TYPOGRAPHY_VAR_MAP)) {
    style.removeProperty(cssVar);  // ← 无条件删除全部 26 个
  }
  // 再注入主题自定义值
  if (!typography) return;
  for (const [key, cssVar] of Object.entries(TYPOGRAPHY_VAR_MAP)) {
    const value = typography[key as keyof ThemeTypography];
    if (value) {
      style.setProperty(cssVar, value);  // ← 无条件写入（有值就写，不检查旧值）
    }
  }
}
```

与 `injectColors`（第 141-152 行）的 diff 注入对比：

```js
if (value && style.getPropertyValue?.(cssVar) !== value) {  // ← 检查旧值
  style.setProperty(cssVar, value);
}
```

`injectTypography` 确实没有 diff 检查——先 `removeProperty` 全部再重新 `setProperty`，即使值完全相同也会触发 style recalc ✅

**一个报告没提到的细节**：`TYPOGRAPHY_VAR_MAP` 实际有 **26 个条目**（第 175-202 行逐行数：lineHeight/fontSize/letterSpacing/paragraphSpacing + heading1-6 Size + heading1-6 LineHeight + heading1-6 Margin + heading1-2 LetterSpacing + quoteBorderWidth + markBorderRadius \= 4+6+6+6+2+2 \= 26）。报告说的"26 个" ✅。

### P2-B：图片无 width/height 占位 — **完全正确**

`editor.css:684-690` 确认：

```css
.tiptap-editor img.mk-image {
  max-width: 100%;
  max-height: 520px;
  object-fit: contain;
  border-radius: 4px;
  display: block;
}
```

无 `width`/`height`/`aspect-ratio` ✅

`editor.css:693-703` skeleton 确认 `min-height: 80px` ✅

报告说的"加载完成时高度从 80px 跳变到实际高度 → 文档流重排"成立 ✅

### P2-D：KaTeX 同步渲染 — **完全正确**

`math-block.ts:110-135` 确认：

```js
async function renderKatex(latex: string) {
  // ...
  const katex = await getKatex();  // ← 首次动态 import（异步）
  // ...
  renderDiv.innerHTML = katex.default.renderToString(latex, {  // ← 同步 CPU 计算
    displayMode: true,
    throwOnError: false,
    trust: false,
  });
}
```

`katex.renderToString` 是同步函数 ✅。`async` 包装仅让 `getKatex()` 的动态 import 异步等待，`renderToString` 本身是同步阻塞主线程的 ✅

NodeView.update（第 219-225 行）在节点内容变化时调 `renderKatex(node.textContent)` ✅

### 方向 3：NodeView.update 全返回 true — **完全正确**

逐个核实 5 个有 NodeView 的扩展：

| 扩展            | update 返回               | 位置                       |
| ------------- | ----------------------- | ------------------------ |
| code-block    | `return true`（type 匹配时） | `code-block.ts:223` ✅    |
| mermaid-block | `return true`           | `mermaid-block.ts:504` ✅ |
| math-block    | `return true`           | `math-block.ts:225` ✅    |
| math-inline   | `return true`           | `math-inline.ts:68` ✅    |
| image         | `return true`           | `image.ts:512` ✅         |

全部在 type 匹配时返回 true，type 不匹配时返回 false ✅。这意味着 PM 在节点内容变化时只做增量 DOM 更新（调 NodeView.update），不重建 NodeView ✅

报告说"7 个 NodeView.update"——实际只有 **5 个**扩展有 NodeView（code-block/mermaid/math-block/math-inline/image）。Callout 用 `contentDOM: dom` 走 renderHTML 路径（不是 NodeView），frontmatter 用 `contentDOM: content` 同理。报告的"7 个"有误，但不影响"全部返回 true"的结论。

### 方向 4：KaTeX/Mermaid 懒加载 + isolating — **完全正确**

- `math-block.ts:32` `isolating: true` ✅
- `math-block.ts:218` `contentDOM: undefined` ✅
- `mermaid-block.ts:274` `isolating: true` ✅
- `mermaid-block.ts:497` `contentDOM: undefined` ✅
- `math-inline.ts:63` `contentDOM: undefined` ✅

isolating + contentDOM:undefined \= 光标隔离 + 编辑走 textarea → textarea 输入不产生 PM 事务 → 不触发 NodeView.update → KaTeX/Mermaid 不进打字热路径 ✅

### 方向 3：dispatch 审计表 — **正确**

报告列出的所有 dispatch 调用点均在之前各步核实中确认过。新增的 `markdown-input.ts:307` dispatch 确认是 `setMarkdownInputState`（setMeta only，不改 doc）✅

### P2-F：selection-only 事务跑全部 decorations props — **正确**

已在 Step 5 核实。`prosemirror-view:5519` 确认 `viewDecorations(this)` 每次 updateState 都调 ✅

### P2-G：强制重排点清单 — **正确**

已在 Step 3 核实。三处均低频或有界 ✅

---

## 总结

| 问题                            | 报告结论                           | 核实结果                                                                    |
| ----------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| 扩展计数 32 项                     | StarterKit + 31 自定义            | **计数正确**。分类描述有误（实际 18 Node + 6 Mark + 8 Extension，非"6 组 Node + 14 扩展型"） |
| P0-A DOM 结构深度表                | 各节点 DOM 层级                     | **基本正确**。footnote 深度为推测（未引 renderHTML），其余全部实锤                           |
| P1-A ParagraphFocus           | focus-mode 下每次编辑全量重建           | **正确**（Step 2/3/5 已核实）                                                  |
| P1-B code-block-lowlight      | 块内输入全量重高亮                      | **正确**（Step 2 已核实）                                                      |
| P1-C markdown-input           | 全树扫描                           | **正确**（Step 2 已核实）                                                      |
| P1-D 主题切换链路                   | `*` 过渡 + recalc + mermaid 重渲   | **完全正确**。manager.ts + main.css 逐行实锤                                     |
| P2-A injectTypography 无 diff  | 先删全部再重写，不检查旧值                  | **完全正确**。与 injectColors 的 diff 对比明确                                     |
| P2-B 图片无尺寸占位                  | 无 width/height，skeleton 80px   | **完全正确**                                                                |
| P2-D KaTeX 同步渲染               | renderToString 同步，async 包装不改本质 | **完全正确**                                                                |
| P2-E SearchHighlight 缺 doc 检查 | 高亮错位                           | **正确**（Step 5 已核实）                                                      |
| 方向 3 NodeView.update          | 全返回 true                       | **完全正确**。但报告说"7 个"实为 5 个                                                |
| 方向 3 dispatch 审计              | 无热路径破坏增量更新                     | **正确**                                                                  |
| 方向 4 KaTeX/Mermaid 懒加载        | isolating + textarea 不进热路径     | **完全正确**                                                                |

**整体评价**：这是六份报告中**信息量最大**的一份——它是对前五份的交叉验证 + 渲染管线层的补充归因。价值在于"否定项"部分：通过全 dispatch 审计确认了 PM 增量更新未被任何扩展破坏，通过 NodeView.update 审计确认了无强制重建，通过 KaTeX/Mermaid 的 isolating 机制确认了懒加载未进热路径。这些"确认没问题"的结论与"发现问题"同样有价值——它们划定了优化边界，避免后续修错地方。

需要修正的都是计数/分类层面的小错（NodeView 数量 7→5、扩展分类描述），不影响任何技术结论。报告自己在末尾的"与既有步骤的边界划分"表也准确反映了各步的覆盖范围和重叠关系，没有重复劳动。
