---
title: solo 外部文件监听（Agent Sync）技术方案
type: proposal
audience: maintainer
status: proposal
tags: [提案, 文件监听, watcher, 待拍板]
summary: 外部文件监听技术方案——未执行，待拍板（加 notify 依赖需确认）
updates: [src-tauri/src/commands/document.rs, src/composables/useDocumentSession.ts, docs/KNOWN-ISSUES.md]
---

# solo 外部文件监听（Agent Sync）技术方案

> 目标：当外部程序（Claude Code / Cursor / Copilot 等 AI 工具，或任何编辑器）改了 solo 当前打开的那个 `.md` 文件时，solo 能**主动察觉**并优雅地把新内容同步进来——**不卡、不闪、不丢光标、不覆盖用户未保存的改动**。
>
> 状态：**仅方案，未执行**。等你拍板后再动手。

---

## 0. 一句话结论

**solo 已经具备 90% 的地基**（乐观锁、脏态、mtime 基线、`emitUpdate:false` 无标脏替换全都现成），要补的只是一段 **Rust 目录监听 + 前端三态分流**。借鉴 ColaMD 的目录监听与自恢复，但比它多一层 **脏态保护**（这是 solo 服务"人写作"而非"AI 协作"的关键差异）。

---

## 1. 现状盘点：solo 已有的、能直接复用的资产

| 资产 | 位置 | 作用 |
|------|------|------|
| 乐观锁冲突检测 | `src-tauri/src/commands/document.rs` → `save_document` 的 `expected_last_modified_ms` | 外部改了文件后，用户再保存会报「文件已被外部修改」。**被动兜底已存在**，本方案是把"被动"变"主动" |
| mtime 基线 | `open_document` 返回 `last_modified_ms`；`save_document` 返回新值 | 打开/保存时都拿到精确 mtime，可用来"过滤自己的保存" |
| 原子写 | `atomic_write`（temp 文件 + `rename` 覆盖） | 意味着 watcher **必须监听目录而非文件**（见 §3.3） |
| 脏态机制 | `src/stores/file.ts`：`hasUserEdit` / `isDirty` / `lastModifiedTime` | 判断"用户有没有未保存改动"，是三态分流的核心依据 |
| 无标脏替换 | `MarkdownEditor.vue`：`setContent(doc.toJSON(), { emitUpdate: false })` | 外部注入内容**不会触发 onUpdate 标脏、不重序列化**——"不闪"的关键 |
| 交互门控 | `MarkdownEditor.vue`：`userInteracted` / `armInteractionGate` / `releaseInteractionGate` | 已免疫插件后台事务误标脏，同源思路 |
| 定向事件 | `events.rs`：`window.emit` / `handle.emit_to(label, …)` | 多窗口下只通知"打开该文件的窗口" |
| 状态管理模式 | `state.rs`：`Mutex` 包裹的 struct + `app.manage` | 照葫芦画瓢加 watcher 注册表 |
| 窗口生命周期钩子 | `commands/window.rs` → `attach_window_events` 的 `Destroyed` 分支 | 关窗时清理 watcher 的现成挂点 |

**缺失项**：Rust 侧没有文件 watcher（已确认），前端没有"外部变更"事件订阅。

---

## 2. 总体架构（信号链路）

```
外部程序改文件
   │ (rename 覆盖 / change)
   ▼
Rust 目录 watcher ──过滤自身保存──▶ 防抖 100ms ──读文件+新mtime──▶ emit "file-changed" {path, content, lastModifiedMs}
                                                                          │ (定向到打开该文件的窗口)
   ▼
前端 listen 事件 ──三态分流──────────────────────────────────────────────┐
   ① 无脏、内容变了 → setContent(emitUpdate:false) + 重置基线 + 补发字数/大纲  │
   ② 有脏、内容不同 → 弹「文件已被外部修改」冲突框（复用现有乐观锁语义）          │
   ③ 内容相同 / 是自己刚保存的 mtime → 忽略                                   │
```

---

## 3. Rust 侧设计

### 3.1 新增依赖（需你确认后才会加）

```toml
# src-tauri/Cargo.toml
notify = "6"
```

`notify` 是 Rust 生态标准文件监听库，**纯 Rust、无系统库依赖**，跨 Windows / macOS / Linux 统一 API。加进 Cargo.toml 后 `cargo` 自动下载编译（不是装系统软件，但按咱们铁律，动手前先跟你确认）。

### 3.2 新命令（两个）

| 命令 | 入参 | 作用 |
|------|------|------|
| `start_watch` | `path: String` | 前端打开/另存为成功后调用，注册该文件的监听（绑定当前窗口 label） |
| `stop_watch` | 无（用窗口 label） | 前端切换/关闭文件时调用，释放监听 |

在 `lib.rs` 的 `generate_handler!` 里追加 `start_watch, stop_watch`；在 `command-names.ts` 里加 `startWatch: 'start_watch'` 等条目。

### 3.3 监听策略（借鉴 ColaMD，逐条对应）

ColaMD 的核心洞察是**监听父目录，而不是文件本身**——因为 AI 工具保存时几乎都是"写临时文件再 rename 覆盖"（原子保存），这会让绑定在旧文件上的 watcher 失效。solo 自己的 `atomic_write` 也是这个模式，所以这条**必须照搬**。

| ColaMD 做法 | solo 落地 |
|-------------|-----------|
| `watch(dir)` 监听父目录 | `notify::recommended_watcher` 监听 `path.parent()` |
| `rename` 事件 → 原子保存检测 + 重建监听 `establish()` | 收到 `Modify(Name(..))` / `Remove` / `Create` 都当作"可能的外部变更"，读当前 mtime 判断 |
| `change` 事件 → 直接重载 | 同上 |
| watcher `error` → 自恢复 `establish()` | `notify` 回调的 `Err` 分支里重建 watcher |
| 目录不可监听 → 降级监听文件 | 包一层 try/catch，失败降级 `watch(file)` |
| macOS FSEvents 启动回放 → `suppressUntil = now + 300ms` | 建立 watcher 后设置 300ms 抑制窗口（仅 macOS 需要，其他平台无害） |
| 防抖 100ms | 同值，见 §3.4 |

### 3.4 自身保存过滤（比 ColaMD 更稳）

ColaMD 用 `isInternalSave` 布尔 flag + `setTimeout(100ms)` 复位来屏蔽自身保存——**这有时间窗口漏洞**：若外部程序恰好在 100ms 内也写文件，会被误过滤掉。

solo 有更硬的武器——**mtime 精确比对**（solo 保存后本来就会返回新 mtime）：

1. `save_document` 成功后，把 `(path → 新mtime)` 记入一个 `HashMap<PathBuf, u64>`（`recently_saved`）。
2. watcher 回调触发时，读当前文件 mtime：
   - 等于 `recently_saved[path]` → **是自己刚保存的，忽略**，并清除该记录。
   - 不等 → 真外部变更，走防抖 → 读文件 → emit。
3. 防抖仍保留 100ms（合并 AI 连续写入）。

这样不依赖时间窗口，且跨进程安全。即便极端情况下 mtime 同毫秒漏判，还有第 2 层的乐观锁兜底（用户下次保存报冲突）。

### 3.5 事件 payload

```rust
// models.rs 新增
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileChangedPayload {
    pub path: String,
    pub content: String,
    pub last_modified_ms: u64,
}
```

通过 `window.emit("file-changed", payload)` 定向发送（复用 `events.rs` 现有 emit 模式，加一个 `emit_file_changed(window, payload)` 函数）。

### 3.6 生命周期清理

在 `attach_window_events` 的 `WindowEvent::Destroyed` 分支追加：从 watcher 注册表里移除该 label 的所有 watcher。前端主动切文件时也调 `stop_watch`。双保险防泄漏。

---

## 4. 前端侧设计

### 4.1 事件订阅（挂点：`useDocumentSession.ts`）

`useDocumentSession.ts` 是打开/保存/重命名的核心 composable，所有动作都在这，是接 watcher 的天然挂点：

- **第 66 行 `openDocument(path)` 成功后**（约 106 行 `setFile(...)` 处）→ 调 `startWatch(path)`。
- **保存成功后（192 行 `markSaved(result.lastModifiedMs)`）** → 无需额外动作，mtime 已在 store，Rust 侧已自动过滤。
- **另存为 / 重命名成功后（240 / 271 行 `setFile(...)`）** → 先 `stopWatch()` 旧路径，再 `startWatch(新路径)`。
- **关闭 / 切文件时** → `stopWatch()`。

### 4.2 三态分流（新 listener 的核心逻辑）

```ts
// 伪码，落在 useDocumentSession.ts 里新增 listenFileChanged()
onFileChanged(payload) {
  const cur = fileStore.currentFile
  // ① 不是当前文件 / 路径对不上 → 忽略（多窗口各自管自己的）
  if (payload.path !== cur.path) return
  // ② 内容没变（含自己保存触发的回弹）→ 忽略
  if (normalize(payload.content) === normalize(cur.content)) return
  // ③ 有未保存改动 + 内容不同 → 弹冲突，绝不静默覆盖
  if (cur.isDirty) {
    return promptConflict(payload)  // 「加载外部 / 保留我的」
  }
  // ④ 干净状态 → 无标脏替换
  applyExternalContent(payload)
}
```

`applyExternalContent` 复用 `MarkdownEditor.vue` 现成的文件切换逻辑：`setContent(doc.toJSON(), { emitUpdate: false })` + `fileStore.setFile(content, path, newMtime)` + 补发字数/大纲。需要把编辑器暴露一个"按外部内容刷新"的方法（`defineExpose` 里加一个 `replaceContentFromExternal(content, mtime)`）。

### 4.3 冲突对话框

沿用 `save_document` 现有的冲突语义 + `message` 对话框（`services/tauri/dialog.ts`），按钮两项：
- **「加载外部」** → 放弃本地未保存改动，`applyExternalContent`。
- **「保留我的」** → 什么都不做；此时用户再保存会走 Rust 乐观锁报冲突，可 `force` 覆盖（现有 `saveCurrentDocument` 已支持 force 重试，见 `useDocumentSession.ts` 167 行）。

---

## 5. 三目标逐条对照（不卡 / 不闪 / 不丢光标）

| 目标 | 机制 | 落地位置 |
|------|------|----------|
| **不卡** | ① 100ms 防抖合并 AI 连续写入；② 读文件走 `spawn_blocking`（solo 已有该模式）；③ 前端替换前先比对内容，相同直接跳过 | Rust watcher + 前端 listener |
| **不闪** | ① 内容相同不重渲；② `emitUpdate:false` 不触发 onUpdate、不重序列化、不标脏；③ 只在"干净状态"才自动替换 | `MarkdownEditor.vue` 复用现有 `setContent(...,{emitUpdate:false})` |
| **不丢光标** | 按场景分流：未聚焦直接替换（无所谓光标）；聚焦且无脏替换后 `focus('start')`；**聚焦且有脏 → 弹冲突不替换** | 前端三态分流 |

**关于"丢光标"要讲透**：真正的痛点是"AI 改文件时你正好在同一处打字"——这个场景里，你**有未保存改动**，直接走 ③ 冲突框，你的内容一个字都不会被静默吞掉。至于"AI 改文件时你啥也没干、光标停在某处"这种，光标位置本来就不重要，替换后 `focus('start')` 即可。所以**不丢光标 ≈ 不丢内容，靠脏态保护兜底，而不是硬 map 光标位置**（全量替换后 doc 结构变了，硬 map 位置不可靠，MVP 不做）。

---

## 6. 与 ColaMD 的关键差异（为什么不能照抄）

| 维度 | ColaMD | solo 本方案 |
|------|--------|-------------|
| 定位 | 人 + AI 协作 | 人 + 文字写作 |
| 外部变更处理 | **无条件 auto-reload**（不判断脏态） | **先查脏态**：有脏弹冲突，无脏才自动替换 |
| 自身保存过滤 | `isInternalSave` flag + 100ms 时间窗口 | **mtime 精确比对**（更稳，无时间窗口漏洞） |
| 光标策略 | 不特殊处理 | 脏态保护 + 分场景 focus |

一句话：ColaMD 可以"AI 说了算"，solo 必须"用户的未保存改动说了算"。

---

## 7. 改动清单（文件级，只列不改）

### Rust
1. `src-tauri/Cargo.toml` — 加 `notify = "6"`（需确认）。
2. `src-tauri/src/models.rs` — 加 `FileChangedPayload`。
3. `src-tauri/src/file_watcher.rs`（新）— watcher 注册表 + `start_watch`/`stop_watch` 命令 + `recently_saved` 过滤 + 防抖 + 自恢复。
4. `src-tauri/src/commands/document.rs` — `save_document` 成功后写 `recently_saved`。
5. `src-tauri/src/events.rs` — 加 `emit_file_changed`。
6. `src-tauri/src/commands/window.rs` — `Destroyed` 分支清理 watcher。
7. `src-tauri/src/lib.rs` — `mod file_watcher`、`app.manage(watcher_state)`、`generate_handler!` 加两命令。

### 前端
8. `src/services/tauri/command-names.ts` — 加 `startWatch` / `stopWatch`。
9. `src/services/tauri/document.ts` — 加 `startWatch` / `stopWatch` 封装。
10. `src/services/tauri/events.ts` — 加 `listenFileChanged`。
11. `src/composables/useDocumentSession.ts` — 打开/保存/另存为/重命名处接 `startWatch`/`stopWatch`，新增 `onFileChanged` 三态分流。
12. `src/components/Editor/MarkdownEditor.vue` — `defineExpose` 加 `replaceContentFromExternal`。

---

## 8. 风险与边界

- **误触自身保存**：靠 mtime 比对 + 内容比对双保险，兜底靠乐观锁。
- **文件被删除**：watcher 收 `Remove`，读文件失败静默 catch（借鉴 ColaMD），不崩；前端可后续提示。
- **多窗口同开一个文件**：每个窗口各自 watcher 各自 label，互不干扰（现有 `emit_to(label)` 已保证）。
- **macOS FSEvents 回放**：300ms 抑制窗口。
- **性能**：单文件单目录监听，零开销（见上一轮分析），无 polling。

## 9. 待你确认

1. 是否同意加 `notify = "6"` 依赖（纯 Rust，无系统库）。
2. 冲突对话框按钮文案：`「加载外部」/「保留我的」` 是否 OK。
3. 是否要顺带做 **ColaMD 的 agent 活动状态提示**（如状态栏显示"AI 正在写入…"）——非必需，可后置。

---

*方案基于两边真实源码：solo 的 `document.rs` / `file.ts` / `MarkdownEditor.vue` / `useDocumentSession.ts` / `window.rs` / `lib.rs`，ColaMD 的 `src/main/index.ts`（WebFetch 在线读取）。*
