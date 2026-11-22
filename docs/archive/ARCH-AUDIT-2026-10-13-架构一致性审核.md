---
title: 架构一致性审核（文档 ⇄ 代码）
type: audit
status: 已处理（第一批）
date: 2026-10-13
audience: 简乐 + Agent
summary: 逐项比对 ARCHITECTURE.md 架构图/清单与当前源码，列出漂移项与潜在风险；第一批已于 2026-10-13 收口，详见文末「处理记录」
---

# solo 架构一致性审核报告（2026-10-13）

> 审核对象：`ARCHITECTURE.md`（架构图 §2、目录树 §3、命令表 §4.2、扩展清单 §8.3）与其引用的 `docs/sensitive-areas.md`。
> 方法：以**源码实测**为准（`generate_handler!` 宏、`editor-extensions.ts` 返回数组、`ls` 目录、`package.json`/`Cargo.toml`/`tauri.conf.json`）。
> 基准：`da6fa32`（master，工作区仅一个未跟踪文件 `scripts/perf-baseline.py`）。
> **本报告不修改任何代码与文档**，等集中处理。

---

## 0. 结论先行

| 维度 | 结论 |
|---|---|
| 三层分层（Rust / IPC 服务 / Vue） | ✅ 仍然成立，前端无一处直接 `invoke`（lint + grep 双证） |
| 数字型契约（composables 12 / store 2 / 预设 8 / 字体 7 / 事件 2 / 受管 state 5 / 插件 7 / 防抖 150-100-500-500 / configVersion 12） | ✅ 全部对得上 |
| **命令清单** | ❌ 文档 26 条 vs 代码 28 条（会话记忆两条未回灌） |
| **扩展清单** | ❌ 缺 4 项注册 + `StarterKit` 禁用项写 3 实际 11 |
| **目录树** | ❌ 缺 ~20 个已服役文件/模块（三大块新子系统） |
| **「App.vue 纯协调层」** | ❌ 已不成立（654 行，含状态机与副作用） |
| **新子系统** | ❌ 会话记忆 / 大文档分级 / Windows 原生缩放，三处**零文档覆盖** |

一句话：**架构骨架没变，但最近几轮新增的三套机件没有回灌架构文档**，导致「架构图」与「实际实现的 JE EP」差了一圈，且有两处在（`StarterKit` 禁用清单、列表容器契约）**会让 Agent 改错代码**。

---

## 1. A 类：新增子系统没进架构图（最高优先）

### A1. 会话记忆子系统（最近文件 + 阅读位置）— 无文档

| 落到哪里 | 现状 |
|---|---|
| Rust | `src-tauri/src/commands/session.rs`（新增文件） |
| IPC | `record_document_session` / `read_document_session`（`lib.rs::generate_handler!` 已在册） |
| 前端 | `src/services/tauri/session.ts`（新增文件） |
| 落盘 | `app_local_data_dir/session/document-session.json`（原子写；多窗口「最后为准」） |
| 消费点 | `useDocumentSession.ts:130`（记最近文件）、`MarkdownEditor.vue:418/424/460`（滚动位置落盘与恢复）、`CommandPalette.vue:11`（最近文件分组） |
| 文档覆盖 | ARCHITECTURE §3 / §4.2 / §5.3 / §10 **全无**；`sensitive-areas.md` **不在表内** |

为什么重要：这是**第五条持久化通道**（前四条：用户文档、图片 assets、字体缓存、远程图缓存 + settings store），且有真实的**数据一致性语义**（一动看看谁写一看便知：多窗口互相覆盖、条目不校验文件是否还存在）。

### A2. 大文档分级（`document-scale.ts`）— 无文档

- 三档：`normal < 50 万字符 ≤ heavy < 200 万 ≤ extreme`（`HEAVY_DOC_CHARS` / `EXTREME_DOC_CHARS`）。
- 消费方：`App.vue:202`（状态栏降级文案）、`code-block.ts`、`list-fold.ts`、`paragraph-focus.ts`、`useEditorSearch.ts`、`useDocumentSession.ts:91`。
- 副作用面：**写 `<html class="doc-heavy">`，该档启用 `content-visibility`** —— 注释明确写了它「会干扰 WebView2 IME 组字光标矩形」。这是与已封存的 IME 候选窗失锚问题**同源**的开关，目前只活在源码注释里，架构文档与敏感区都没提。

### A3. Windows 原生边缘缩放（`native_resize.rs`）— 无文档

- 15.5 KB，`#![cfg(target_os = "windows")]`，10 处 `unsafe`，新增 `windows 0.61` 依赖（`Cargo.toml` 已加）。
- 行为：绕开前端 `startResizeDragging` IPC，改走Win32 子窗 + `WM_NCHITTEST`。
- 后果：`App.vue:332-334` 已注明 **Windows 不再渲染 `WindowResizeHandles`**，但架构图 §2/§3 仍把它画在 Windows 路径上 → 改窗口缩放的人会改错层。

---

## 2. B 类：清单/计数漂移（逐项）

| # | 文档写什么 | 代码实际 | 证据 | 严重度 |
|---|---|---|---|---|
| B1 | §4.2 命令表 **26 条** | `generate_handler!` **28 条**，多 `record_document_session` / `read_document_session` | `lib.rs` vs `ARCHITECTURE.md:263-290` | 🔴 违反 AGENTS §1.1「新增命令同步」的第 4 处（文档未同步） |
| B2 | §8.3 扩展清单 37 项 | 实际 43 项：多 **`ListFold`**、**`ListItem.extend`**、**`ListBackspaceGuard`**、**`CellContentGuard`** | `editor-extensions.ts:195-528` | 🔴 |
| B3 | §8.3「禁用内置 `codeBlock`/`link`/`heading`」（3 项） | 实际禁用 **11 项**：`codeBlock / link / heading / code / bulletList / orderedList / listItem / paragraph / blockquote / strike / underline` | `editor-extensions.ts:196-233` | 🔴 **敏感区 #15 列表容器契约的载体之一 `listItem.extend({content:'block+'})` 漏记**，改列表会漏看 |
| B4 | §3 目录树 | 缺：`src-tauri/src/native_resize.rs`、`commands/session.rs`、`services/tauri/session.ts`、`Editor/document-scale.ts`、`tiptap/{ime-anchor,list-move,transaction-shape,zwnj}.ts`、`extensions/{blank-click-focus,cell-content-guard,idle-render-scheduler,list-backspace-guard,list-fold,list-input-guard,suggestion-guard,wikilink-drop}.ts`、`components/CommandPalette.vue`、`Editor/OutlinePanel.vue`、`Editor/views/{ContextMenu,SearchPanel,WikilinkMenu}.vue`、`popover-shared.css` | `ls` 实测 | 🟡 |
| B5 | §5.3 + 附录 C「`services/tauri/` 11 个文件」 | 12 个（+`session.ts`） | `ls services/tauri` | 🟡 违反自身「不硬编码」纪律（playbook §D1） |
| B6 | §7.1 只列 `currentFile` | 还有 **`isLoading` + `reloadToken`**；`reloadToken` 是「编辑器何时换文档」的唯一触发器 | `stores/file.ts:20-31, 79` | 🟡 属核心契约，建议入敏感区 |
| B7 | §10.1「**5 套**文件名无后缀」 | 实际 **6 套**（`cinnabar/default/elegant/jade/orchid/scholar`） | `ls themes/presets` | 🟢 |
| B8 | §8.4 自列测试网清单 | 漏 `fidelity-scan` / `serializer-perf-guard` / `clipboard-serializer` / `table-ops` / `plugins` | `ls markdown/__tests__` | 🟡 建议改为「指向 playbook §C」而非自列 |
| B9 | §1「Vitest + happy-dom 4.x」 | `vitest ^4.1.8` / **`happy-dom ^20.10.3`** | `package.json` | 🟢 |
| B10 | §1 Rust 依赖列举 | 实际多了 `arboard / tokio / base64 / url / windows 0.61 / webview2-com` | `Cargo.toml` | 🟢 |
| B11 | §7.1 `markSaved(lastModifiedMs)` | 实际签名 `markSaved(lastModifiedTime, content?)`（内容版本等高危：失败时才基线不乱动） | `stores/file.ts:96` | 🟢 |

---

## 3. C 类：既有架构原则的执行偏差

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| C1 | **App.vue 已不是「纯协调层」**（§6.2 自述失真）：325 行 script 里含焦点模式提示状态机（2 个定时器 + 独写点注释）、外部修改重载、自动更新、Shell 注册副作用、大文档降级文案、关窗原生通道降级链 | `App.vue:100-162, 195-324` | 二选一：要么抽成 composable（`useFocusNotice` / `useAppStartup`），要么把 §6.2 改成「协调层 + 少量界面编排」如实描述 |
| C2 | **数据流多出一条暗线**：会话数据不经 composable/store，`CommandPalette.vue` 直接 `import readDocumentSession`（IPC），`MarkdownEditor.vue` 直接 record/restore | `CommandPalette.vue:11`、`MarkdownEditor.vue:90` | 收口到 `useDocumentSession` 或一个 `useSessionMemory`，让 §2 分层图仍然成立 |
| C3 | **Shell 集成注册双入口**：App.vue watcher + `useAppWindowSession.setup()` 都会调用 `registerShellNew` | `App.vue:148-162`、`useAppWindowSession.ts:274-276` | 现在靠 Rust 侧幂等（敏感区 #21）兜住、不炸，但职责双头；收口到一处 |
| C4 | 敏感区速查表（现 23 条）未覆盖三处新机件：会话记忆落盘、`doc-heavy` 档位、Windows 原生缩放子窗 | `docs/sensitive-areas.md:17-42` | 至少补「会话记忆一致性」与「doc-heavy ⇄ IME」两条，理由见 A2/D2/D3 |

---

## 4. D 类：潜在风险（需拍板，不必全改）

| # | 风险 | 说明 | 建议 |
|---|---|---|---|
| D1 | `document-session.json` **明文记录绝对路径 + 阅读比例** | 无过期策略、不校验条目是否还存在 → 命令面板会列出已被删除的文件；隐私侧：打开过的文件路径本地明文 | 读取侧加存在性过滤（或标注灰色）；是否加开关由你定 |
| D2 | `doc-heavy` 的 `content-visibility` 与 IME 失锚同源 | 注释已承认「会干扰 WebView2 组字光标矩形」；IME 问题 2026-09-24 已封存 | 保持现状，**把因果写进敏感区**，避免后人误调门槛 |
| D3 | `native_resize.rs` 无自动化测试可行 | Win32 子窗 + `WM_NCHITTEST` 只能在真机验；现存注释写明「静态扫描曾给假绿灯」 | 进敏感区，明确改动验收口径：Win + 100/125/150% 三档 DPI + 四角+四边真机拖拽 |
| D4 | 文档 ↔ 代码同步**没有机器锁** | B1/B2/B3 是最后几处「靠人记得同步」的漂移；项目已有 `docs-lint.spec.ts` | 建议加一条：断言 §4.2 命令表集合 == `generate_handler!` 集合；扩展清单同理（可选，先谈再做） |
| D5 | 会话写「最后一次为准」 | 多窗口同时开同一文件时阅读位置互相覆盖 | 已在 `session.rs` 头注释自认「可接受」，记录在案即可 |

---

## 5. 已核对一致（不必动）

- 三层分层成立：全库 grep 无前端直接 `invoke(`（排除 `client.ts`）✅
- Rust：事件 2 个 ✅ / 受管 state 5 类 ✅ / 插件 7 个 ✅ / `capabilities` 3 份 ✅
- 前端：composables **12** ✅ / store **2** ✅ / Settings `.vue` **13** ✅ / 主题预设 **8** ✅ / 字体 **7** ✅ / `CommandSource` 3 ✅ / `CommandScope` 2 ✅ / `configVersion` **12** ✅
- 防抖分层：字数 150 / 光标 100 / 大纲 500 / 序列化 500 / 空闲超时 2000 ✅
- `file.ts` A1 脏态模型（`setContent` 建基线不标脏 + `syncEditedContent` 语义比对）✅
- 版本号四源同步 **1.2.59**（`package.json` / `Cargo.toml` / `tauri.conf.json` / `Cargo.lock`）✅
- NodeView 清理配对：`callout` / `code-block` / `image` / `math-block` / `mermaid-block` / `link-open` / `MarkdownEditor` 生命周期均有对称移除；`list-fold` 是 decoration widget（随 DOM 回收）+ 有 plugin `destroy` ✅

---

## 6. 建议的处理顺序（待你拍板）

1. **先补 A 类 three 块**（架构图 §2/§3 + 新增 §12 数据 persistent 通道一节）— 影响面最大、纯加法。
2. **修 B1/B2/B3**（命令表 + 扩展清单 + `StarterKit` 禁用清单）— 直接决定 Agent 改代码的正确率。
3. **C1/C2/C3 选边**：抽 composable（动代码，有回归风险）还是改文档如实描述（安全）— **建议先改文档**。
5. D1 面板过滤：用户可见的小毛刺，顺手做。

---

## 7. 处理记录（2026-10-13 执行，用户批准顺序）

**改动范围：只有文档，外加一个新测试文件。产品代码一行未动。**

### 7.1 A 类：三大子系统入档

| 落地 | 位置 |
|---|---|
| 新增 §12「三条横切机制」（§12.1 会话记忆 / §12.2 大文档分档 / §12.3 Windows 原生缩放 / §12.4 待收口例外） | `ARCHITECTURE.md` §12 |
| §2 三层图下方加「横切三条」指针；§12.1 含数据流示意图与各写入点说明 | 同上 |
| 敏感区速查表补 3 条（24 会话记忆一致性 / 25 `doc-heavy` ⇄ IME / 26 Win32 原生缩放） | `docs/sensitive-areas.md` |
| 敏感区 21（Shell 注册）补注「双入口 + 幂等兜住」 | 同上 |
| 目录树补 ~20 个已服役文件（session.rs / native_resize.rs / session.ts / document-scale.ts / zwnj.ts / list-move.ts / transaction-shape.ts / ime-anchor.ts / 8 个 extensions / CommandPalette.vue / OutlinePanel.vue / views 三个菜单 / popover-shared.css） | `ARCHITECTURE.md` §3 |

### 7.2 B 类：清单订正

| 项 | 处理 |
|---|---|
| B1 命令表 26→28 | §4.2 补 `record_document_session` / `read_document_session` 两行 |
| B2/B3 扩展清单 + StarterKit 禁用清单 | §8.3 改为**机器校验区**（两个 `<!-- SOLO:... -->` 标记块），补全 43 项注册 + 11 项禁用 |
| B5/B7/B9/B10/B11 | `services/tauri/` 12 个、happy-dom 20.x、Rust 依赖补齐、`markSaved` 签名、`reloadToken` / `isLoading` 入 §7.1 |
| B6 `reloadToken` | 写入 §7.1 并说明「它是编辑器换文档的唯一触发器」 |
| B8 测试网清单 | §8.4 补 `fidelity-scan` / `serializer-perf-guard` / `clipboard-serializer` / `table-ops` / `plugins`，跑法统一指向 playbook §C |

### 7.3 C 类：按「先改文档」处理（未抽代码）

- §6.2 标题与正文改为**如实描述**：协调职责 + 界面编排两组清单，并写明「目标是协调为主而非零业务」。
- §5.3 记录**会话数据直连 IPC 的既有例外**（面板 / 编辑器），并加约束：「新增领域数据时先想清楚要不要进 store，别默认复制这条捷径」。
- §12.4 记录 Shell 注册双入口为**待收口例外**，写明不现在动的原因（幂等兜住、无用户可感缺陷、收口需回归 Windows 注册表）。

### 7.4 D4：机器锁（新增）

`src/__tests__/arch-drift.spec.ts` —— 四条双向集合比对（命令表 ⇄ `generate_handler!`、`command-names.ts` ⇄ `generate_handler!`、扩展清单 ⇄ `createEditorExtensions` 返回数组、StarterKit 禁用清单 ⇄ `configure({ xxx: false })`）。

**反向校准实跑（2026-10-13）**：从文档删 `record_document_session` → ①红；删 `ListFold` → ③红；删 `underline` → ④红；对照组 ② 保持绿 ✓。校准项已全部还原（`grep -c _CALIB` = 0）。

**验证读数**：新增 spec 4/4 绿；全量 `vitest run` **1862 passed / 1 skipped**（基线 1858，+4）；`vue-tsc --noEmit` 0 错；`eslint` 0 error。

### 7.5 联动同步

`AGENTS.md` §1.1 改为「新增命令**四处同步**」并注明机器锁；`docs/agent-playbook.md` §C 同步四处、§C 锁分级表 B 类补 `arch-drift`；`docs/INDEX.md` 两行描述更新。

### 7.6 未做（等哪一轮单独处理）

| 项 | 状态 |
|---|---|
| D1 最近文件存在性过滤 | 代码改动，**用户未批准**（批准范围到「自动检查」为止）；已写入 §12.1 已知取舍与敏感区 24 |
| C1/C2/C3 抽 composable 版 | 按用户选择「先改文档」，已如实记录；抽码属整洁化，需单独一轮 + Windows 回归 |
