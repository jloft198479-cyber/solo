# solo 多窗口与进程架构诊断报告（Step 8）

> 只读排查，未修改任何代码。排查日期：2026-08-21。
> 依据：以实际代码为准。排查范围：窗口创建与权限、菜单事件定向分发、启动多文件竞态、窗口间数据隔离、退出逻辑。
> 关联报告：[step7](./step7-solo%20保存与文件%20IO%20诊断报告.md)（同文件双开的冲突链）、[step4](./step4-solo%20编辑器整体架构与扩展机制诊断报告.md)（数据流真相源）。

---

## 一、多窗口模型全景

solo 的多窗口模型是 **「每窗口一个编辑器实例」**，无标签页、无单实例、窗口间零共享：

```
进程（单个 solo.exe）
 ├── main 窗口（tauri.conf.json 默认 label "main"）
 │     ├── Pinia fileStore / settingsStore（per-webview 独立 JS 上下文）
 │     ├── useAppWindowSession（关窗闸口 / 启动打开 / 拖拽）
 │     └── useMenuEvents（收 Rust 定向菜单事件）
 ├── editor-0 / editor-1 / ...（Ctrl+N 或新文件创建，label 原子计数）
 │     └── 与 main 同构（capabilities 权限差一项，见 P2-S8-3）
 └── Rust 侧共享状态（AppHandle 级）：
       StartupOpenRequests（启动待打开路径，全局一份，take() 一次取走）
       PendingWindowPaths（label → payload，按窗口定向）
       FocusedWindow（当前焦点窗口 label，供菜单定向）
       LoadedWindows（已加载窗口集合，⚠️ 只写不读）
```

**窗口间数据隔离结论**：`fileStore` / `settingsStore` 是 **per-window 单例**（每个 WebView 是独立 JS 运行时，Pinia 不跨窗口共享），两个窗口的编辑器内容、脏态、撤销栈完全隔离 ✅。唯一的跨窗口共享点是「磁盘文件」——同文件双开走 Step 7 已审计的 mtime 冲突链兜底。

---

## 二、五面排查明细

### 面 1：窗口创建与权限 ⚠️ 一处权限漏配（editor 窗口无法拖拽缩放）

**创建链**：前端 `newEditorWindow(path?)`（`window.ts:60-62`）→ invoke `new_editor_window`（`lib.rs:111-117`）→ `create_editor_window`（`lib.rs:56-109`）：

- label 用 `editor-{原子计数器}` 保证唯一（`:60`）
- `visible(false)` 创建 → 前端 `startup_ready` IPC 里 `window.show()`（`:33`）避免黑闪（与 Step 1 启动时序设计一致）
- 有关联文件：存入 `PendingWindowPaths[label]`（`:83-91`），等新窗口 ready 后按 label 定向取走——**不会与其他窗口抢**
- `attach_window_events`（`commands/window.rs:37-99`）：CloseRequested → prevent_close + 定向发 close-requested；Focused → 维护 FocusedWindow；Destroyed → 清理

**权限配置**（`capabilities/` 三份）：

| 文件 | windows 匹配 | 权限 | 评价 |
|---|---|---|---|
| `default.json` | `main`、`editor-*` | core:default + 各插件 default | 基础集（不含窗口操控类） |
| `main-window.json` | `main` | 窗口/事件/对话框/存储操作集 | 含 `core:window:allow-start-resize-dragging`（`:21`） |
| `secondary-window.json` | `main-*`、`editor-*` | **比 main-window 少一项** `core:window:allow-start-resize-dragging` | ⚠️ editor 窗口缺失边缘拖拽缩放权限（P2-S8-3） |

**结论**：新窗口（`editor-*`）同时匹配 `default.json` + `secondary-window.json`，**与 `main` 的能力差异只有一项：`core:window:allow-start-resize-dragging`**（窗口边缘拖拽缩放权限）。该项不在 `core:default` 中（这正是 `main-window.json:21` 要显式加它的原因），而 `secondary-window.json` 漏配——**editor-* 窗口的 `WindowResizeHandles` 边缘缩放手柄全部静默失效**（`WindowResizeHandles.vue:30` 调 `startResizeDragging`，`.catch(() => {})` 吞掉权限拒绝错误，用户无感知）。详见 P2-S8-3。其余权限逐项一致。另两个小发现：`secondary-window.json` 的 `main-*` 匹配是死规则（当前无 `main-*` 窗口，tauri.conf.json 只有一个默认 label `main`）；`lib.rs:265-271` 的 window-state `map_label` 同样为 `main-*` 预留（映射到 "secondary"），对当前 `editor-*` 不生效。均无实际影响。

### 面 2：菜单事件分发 ✅ 正常路径严格定向，存在一条平台相关退化路径

**完整链路**：用户点菜单/按快捷键 → Rust `on_menu_event`（`menu.rs:169-197`）→ 查 `FocusedWindow` → `get_webview_window(label)` → **`emit_menu_event(&window, menu_id)` 定向发送**（`events.rs:8-12`，`window.emit` 只发给该窗口）→ 前端 `useMenuEvents` 用 `getCurrentWindow().listen(MENU_EVENT)`（`events.ts:64-70`）只收**本窗口定向事件** → 执行命令。

**B 窗口会不会误响应？不会（正常路径）**——定向 emit 只有焦点窗口收到；且前端 `emitMenuEvent`（全局 emit）虽然存在于 `events.ts:76-79`，**全项目无调用点**（死代码，菜单事件只从 Rust 进来），不存在前端误广播。

**FocusedWindow 状态维护正确**（`commands/window.rs:49-69`）：focus → `set(label)`；blur → **仅当自己是当前焦点时才 clear**（`:62-67`，防其他窗口 blur 误清）；Destroyed → 清理。逻辑自洽，多窗口交替聚焦不会错乱。

**退化路径（需 macOS 实测确认）**：当焦点在外部应用、所有 solo 窗口 blur 时，`FocusedWindow` 为 `None`。此时若用户点击 macOS 菜单栏（点击菜单栏不改变窗口焦点），`attach_menu_events` 走 fallback 分支——`eprintln!("无法确定焦点窗口，回退全局广播")` + `app.emit` 全局广播（`menu.rs:186-192`），**所有 solo 窗口都会响应同一菜单命令**（如所有窗口同时「保存」）。代码注释「不应发生」，但在 macOS「焦点在外部 app + 点菜单栏」是真实可达场景。Windows 上菜单栏不可见（decorations:false 自定义标题栏），菜单只经快捷键触发，快捷键必有键盘焦点窗口 → 不会走到 fallback。

### 面 3：启动多文件竞态 ⚠️ 按打开途径分三种行为，一条有缺陷

| 打开途径 | 进程/窗口 | 行为 | 评价 |
|---|---|---|---|
| **Windows 双击 .md**（fileAssociations 注册，`tauri.conf.json:49-58`） | 每文件一个**独立进程**（Windows Shell 对每个文件执行一次 verb） | 3 文件 = 3 个 solo 进程，各开 1 窗口 1 文件 | ✅ 符合「无标签页」设计；进程间无协调、无干扰 |
| **CLI 单进程多参数** `solo a.md b.md c.md` | 1 进程 1 窗口 | raw args 收集 3 路径 → merge 进 `StartupOpenRequests`（去重，`state.rs:11-26`）→ main 窗口 `startup_ready` `take()` 全取 → 前端 `handleOpenPayload` **循环在同一个窗口逐个打开**（`useAppWindowSession.ts:104-130`）→ **前两个被静默替换，最后只显示 c** | ⚠️ **行为缺陷**：a/b 文件没被打开（无窗口无提示），文件本身未损坏 |
| **macOS Finder 批量打开 / 运行中 os-open** | 每文件独立窗口 | `RunEvent::Opened` 每个 url → `create_editor_window(path)`（`lib.rs:374-392`） | ✅ 正确 |
| **运行中打开文件**（拖拽 .md 进窗口） | 当前窗口打开 | `subscribeDragDrop` → `openDocumentWithPrompt` | ✅ |

**StartupOpenRequests 全局 take 的竞态（设计缺陷，概率低）**：`startup_ready`（`lib.rs:25-52`）先查自己的 `PendingWindowPaths`（定向，正确），**没有命中时再 `take()` 全局 `StartupOpenRequests`——任何窗口都能 take**。若启动后用户立即 Ctrl+N（或菜单新建）抢建 editor-1，且 editor-1 的 webview 比 main 先 ready，**editor-1 会 take 走全局启动请求**（把 [a,b,c] 打开在自己窗口，main 落空）。正常时序 main 先 ready 所以概率低，但「谁先 ready 谁拿」无归属保证，属于时序竞态。

**启动竞态保护现状**：`StartupOpenRequests.merge` 去重 ✅；`take()` 单次取走防重复打开 ✅；`PendingWindowPaths` 按 label 定向 ✅；**缺失**的是「全局请求只能由 main 窗口认领」的归属约束。

### 面 4：窗口间数据隔离 ✅ 运行时隔离彻底，共享点只有磁盘

- **fileStore / settingsStore / 撤销栈 / 编辑器状态**：全部 per-window（WebView 独立 JS 上下文），无跨窗口通信（无 `emitTo` 跨窗口广播业务事件，`menu-event` 和 `close-requested` 是唯一的窗口定向事件）✅
- **同文件双开**：两个窗口各自持有独立 `lastModifiedTime`，A 保存 → B 保存触发 `document_conflict` → confirm 强制覆盖（Step 7 冲突链）✅。局限同 Step 7：双窗口交替保存是 last-writer-wins，无内容哈希级检测。
- **settings 持久化共享文件**：两窗口共用同一 `tauri-plugin-store` 文件，同时改设置（如主题/字体）时**最后写者胜**，另一窗口的设置被覆盖且无提示——低频、非数据破坏性（设置可重新配置），低风险。
- **无跨窗口文件 watcher**：A 窗口保存后，B 窗口无感知（除非保存触发冲突）——Step 7 P3-S7-2 已记录。

### 面 5：退出逻辑 ⚠️ 发现 P1：exit_app 只检查当前窗口脏态

**两条退出路径**：

| 路径 | 行为 | 安全性 |
|---|---|---|
| **逐窗口关闭**（标题栏 X） | 每窗 CloseRequested → 前端 `handleCloseRequest`（检查**该窗口**脏态 → 三选一确认 → 保存）→ `destroy` → 最后一个窗口关闭后应用退出 | ✅ 每窗都检查，安全 |
| **应用级退出**（`app.quit` 菜单 / CmdOrCtrl+Q） | Rust `app.quit` 菜单项 → 定向到**焦点窗口** → 前端 `handleQuit`（`useAppWindowSession.ts:229-235`）→ `handleCloseRequest`（**只检查当前焦点窗口脏态**）→ 通过后 `exitApp` → `app.exit(0)`（`commands/window.rs:162-166`，强制退出整个进程） | ⚠️ **其他窗口未保存内容不检查、不确认、直接丢失** |

**P1-S8-1【风险·高】`exit_app` 绕过其他窗口的脏态检查**：`app.exit(0)` 是强制进程退出，不会触发各窗口的 CloseRequested。场景：窗口 A 和 B 都有未保存内容 → 用户在 A 按 CmdOrCtrl+Q（或菜单退出）→ A 检查自己的脏态 → 确认保存 → `app.exit(0)` → **B 的未保存内容直接丢失**。这是真实可触发、跨窗口的数据丢失路径。

**修复方向**（待确认）：`handleQuit` 改为「先向所有已加载窗口广播 close-requested，等所有窗口完成确认/保存后再 `exit_app`」；Rust 侧可遍历 `LoadedWindows`（该状态当前**只写不读**，正好复用）逐窗口 emit close-requested，全部确认后退出。

---

## 三、问题清单（按严重程度降序）

### P1-S8-1【风险·高】应用级退出只检查焦点窗口，其他窗口未保存内容丢失

- **位置**：`useAppWindowSession.ts:229-235`（handleQuit）+ `commands/window.rs:162-166`（exit_app `app.exit(0)`）
- **触发**：任意窗口按 CmdOrCtrl+Q / 菜单「退出 solo」→ 当前窗口确认后强制退出进程 → 其他窗口脏数据丢失
- **修复方向**：退出前遍历所有窗口确认；`LoadedWindows` 状态已就位（见 P3-S8-1）

### P2-S8-1【行为缺陷】CLI 单进程多路径启动：只打开最后一个文件，其余静默丢弃

- **位置**：`lib.rs:286-298`（raw args 合并到一个 `StartupOpenRequests`）+ `useAppWindowSession.ts:104-130`（`handleOpenPayload` 单窗口循环打开）
- **触发**：`solo a.md b.md c.md` → main 窗口依次打开 a→b→c，前两个被静默替换（无窗口、无提示、文件未损坏）
- **修复方向**：CLI 多路径与 macOS `RunEvent::Opened` 行为对齐——为每个路径创建独立窗口；或至少提示用户

### P2-S8-2【竞态·低】StartupOpenRequests 无窗口归属约束，新窗口可能抢走启动请求

- **位置**：`lib.rs:46-51`（`startup_ready` 无命中 pending 时无条件 `take()` 全局请求）
- **触发**：启动 + 用户立即 Ctrl+N，editor-1 先于 main ready → 启动路径被 editor-1 认领，main 落空
- **修复方向**：`startup_ready` 只在 `window.label() == "main"` 时才允许 take 全局请求；editor-* 只查自己的 PendingWindowPaths

### P2-S8-3【功能缺失·中低】editor-* 窗口无法拖拽调整大小：`start-resize-dragging` 权限漏配 + 静默吞错

> 定级中-低：不影响数据安全（无丢失风险），但影响 editor 窗口的基础可用性（无边框窗口无法拖拽边缘缩放）。

- **位置**：`capabilities/secondary-window.json`（缺 `core:window:allow-start-resize-dragging`，而 `main-window.json:21` 有）+ `WindowResizeHandles.vue:30`
- **机制**：solo 是 `decorations: false` 无边框窗口，边缘缩放完全依赖 `WindowResizeHandles` 的 8 方向手柄 → `getCurrentWindow().startResizeDragging(direction)`（走 `plugin:window|start_resize_dragging`）。该权限**不在 `core:default` 中**（`main-window.json` 显式添加即为证），`editor-*` 窗口因 `secondary-window.json` 漏配被权限系统拒绝——**新窗口只能用标题栏按钮最大化/最小化，无法自由拖拽调整大小**。
- **加剧因素**：`.catch(() => {})` 静默吞掉拒绝错误，用户与开发者都无感知（console 不报错），排查难度高。
- **修复方向**：`secondary-window.json` 的 permissions 补 `"core:window:allow-start-resize-dragging"`（与 main-window.json 对齐）；顺手把 `WindowResizeHandles.vue:30` 的 `.catch(() => {})` 改为 console.warn，避免同类权限缺失再次无感知。

### P3-S8-1【死状态】LoadedWindows 只写不读

- **位置**：`state.rs:59-61` + `commands/window.rs:83-86` + `lib.rs:35,277`
- **分析**：`mark_loaded` / `remove` 正常维护，但**全项目无任何逻辑读取它**（grep 确认，仅测试）。设计意图（窗口枚举/退出协调）未接线——恰好可服务于 P1-S8-1 的退出前全窗口确认。

### P3-S8-2【平台相关·需实测】FocusedWindow 为 None 时菜单事件回退全局广播

- **位置**：`menu.rs:186-192`
- **分析**：fallback 广播会让所有窗口同时执行菜单命令。代码注释「不应发生」，但 macOS「焦点在外部 app + 点击菜单栏（不聚焦窗口）」场景可能真实触发。Windows 走快捷键必有焦点窗口，不受影响。需 macOS 实测确认（项目目标平台主要是 Windows，影响面有限）。

### P3-S8-3【死代码】前端 `emitMenuEvent` / `emitWindowCloseRequested` 全局 emit 无调用点

- **位置**：`events.ts:76-84`
- **分析**：全局 `emit` 会把事件发给所有窗口，若未来被接线会造成多窗口误响应。当前无调用点，建议删除或改为 `getCurrentWindow().emit`（定向）。

---

## 四、健全项清单

| 项 | 证据 | 评价 |
|---|---|---|
| 菜单事件定向分发 | `menu.rs:180-193` FocusedWindow → `emit_menu_event`（定向）+ 前端 `window.listen` | ✅ B 窗口不误响应（正常路径） |
| FocusedWindow 防误清 | `commands/window.rs:62-67` 仅自己清 + Destroyed 清理 | ✅ 多窗口交替聚焦自洽 |
| PendingWindowPaths 按 label 定向 | `state.rs:38-57` + `lib.rs:83-91` | ✅ 新窗口文件定向取走 |
| 启动请求去重 + 单次 take | `state.rs:11-35` merge 去重 / take 消费 | ✅ 防重复打开 |
| 窗口创建黑闪防护 | `visible(false)` + `startup_ready` 时 `show()` | ✅ 与 Step 1 启动时序一致 |
| 数据隔离 | Pinia per-webview 实例 + 无跨窗口业务广播 | ✅ fileStore 完全 per-window |
| 同文件双开冲突链 | Step 7 已审计（mtime → document_conflict → 覆盖确认） | ✅ |
| capabilities 覆盖 | `editor-*` 同时匹配 default + secondary | ⚠️ 差 `start-resize-dragging`（P2-S8-3），其余一致 |

> **修正记录（2026-08-21）**：首版本报告宣称 capabilities「逐项相同、无权限缺口」，经复核实为 `main-window.json` 与 `secondary-window.json` 存在一处差异（缺 `core:window:allow-start-resize-dragging`），已修正为 P2-S8-3。教训："逐项比对"必须真的逐项 diff，不能目测列表长度相近就下结论。

---

## 五、与既有步骤的边界

| 本报告问题 | 与既有步骤的关系 |
|---|---|
| P1-S8-1 退出丢数据 | 新发现（多窗口特有，前 7 步单窗口视角未覆盖） |
| P2-S8-1 CLI 多路径覆盖 | 新发现（启动路径分析） |
| P2-S8-2 全局 take 竞态 | 新发现（state 归属设计） |
| P2-S8-3 缩放权限漏配 | 新发现（capabilities 逐项 diff 复核时发现，首版漏报） |
| 同文件双开冲突 | 引用 Step 7 冲突链，未重复审计 |
| externalFileWarning 未接线 / 无跨窗口 watcher | Step 7 P3-S7-2，本报告确认其在多窗口场景同样缺位 |

---

## 六、修复方向汇总（待确认后实施）

1. **P1-S8-1**：退出前全窗口确认——`handleQuit` 改为遍历所有已加载窗口广播 close-requested，全部确认/保存后再 `exit_app`；复用 `LoadedWindows` 状态（Rust 侧逐窗口 emit 或前端轮询各窗口脏态二选一，前者更可靠）。
2. **P2-S8-1**：CLI 多路径与 macOS `RunEvent::Opened` 对齐——每路径独立窗口；或退而求其次在 `handleOpenPayload` 检测到多路径时提示「将打开最后一个文件」。
3. **P2-S8-2**：`startup_ready` 加窗口归属约束（仅 main 可 take 全局请求）。
4. **P2-S8-3**：`secondary-window.json` 补 `core:window:allow-start-resize-dragging`；`WindowResizeHandles.vue:30` 的 `.catch(() => {})` 改 console.warn，消除权限类失败的无感知。
5. **P3-S8-1**：`LoadedWindows` 接入退出确认逻辑（与 #1 一起做）。
6. **P3-S8-3**：删除前端两个未接线全局 emit（或改定向 emit），杜绝未来误广播。
