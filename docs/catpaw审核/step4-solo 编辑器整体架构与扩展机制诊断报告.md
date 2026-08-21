---
title: solo 编辑器整体架构与扩展机制诊断报告
type: guide
audience: agent
status: active
tags: [性能诊断, 架构, 扩展机制, 状态管理, 撤销栈, 命令体系]
summary: Step 4 只读排查：编辑器骨架、扩展体系、状态流、撤销栈、命令注册与依赖健康度
updates: [ARCHITECTURE.md]
---

# solo 编辑器整体架构与扩展机制诊断报告

> **Step 4 · 只读排查**（日期：2026-08-21 · 基于 v1.2.39 实际代码）
> 目标：排查编辑器的插件/扩展体系、状态管理、各模块协作方式是否存在**结构性问题**。
> 原则：只诊断、不改代码；判断依据实际代码与 node_modules 已装版本，不以注释/文档为准。

---

## 结论摘要

**编辑器的「骨架」没有致命结构性问题**——扩展体系走标准 TipTap/ProseMirror 模式，状态流是「PM 单一真相源 + 防抖单出口」，命令体系是「注册表 + 分发器」双层结构，第三方依赖版本统一、无 fork。各模块之间的协作方式是高效的，没有「互相拖后腿」的级联热点。

但在排查中发现 **1 个真实的数据一致性风险（P0）**、**2 个结构性隐患（P1）**、**3 个局部问题（P2）**，按严重度排序：

| 编号   | 级别    | 问题                                                                                                | 性质          |
| ---- | ----- | ------------------------------------------------------------------------------------------------- | ----------- |
| P0-A | **高** | **切文档的 setContent 事务污染撤销栈**——切到文档 B 后 Ctrl+Z 会一步退回文档 A 的内容，此时若保存会把 A 的内容写进 B 的文件                  | 结构性（真实数据风险） |
| P1-B | 中     | 主题切换触发连锁重渲：一次 MutationObserver → 全部 Mermaid NodeView 重渲 + 编辑器装饰层全量重建                              | 结构性（低频）     |
| P1-C | 中     | 文档内容双源存储（PM doc vs store 基线 markdown），靠「实时取数兜底」维持一致，属有意复杂度但维护面宽                                   | 结构性（可接受）    |
| P2-D | 低     | `extensions/shortcuts.ts` 的 CustomShortcuts 是死代码，从未接线，注释误导性强                                      | 局部          |
| P2-E | 低     | 命令 id 分散在 3 处清单（registry / executeEditorCommand / dispatcher switch），新增命令易漏改                      | 局部          |
| P2-F | 低     | `findCommandByShortcut` 线性查找 33 条（微秒级，Step 2 已评估可忽略）；菜单 accelerator 与 window keydown 双通道潜在重复（需实测） | 局部          |

---

## 一、插件/扩展的加载与初始化

### 1.1 加载层级：三层懒加载，诚实设计

**组件级**：`MarkdownEditor` 是 `defineAsyncComponent` 懒加载（`App.vue:32`），主界面不拖首屏。

**编辑器实例级**：`lazyInitEditor()`（`MarkdownEditor.vue:313-316`）——新窗口不立即创建编辑器，首次点击/聚焦或 `solo:editor-focus` 事件（`:320-330`）才创建；50ms 延迟兜底（`:363-366`）。

**库级**：Mermaid 与 KaTeX 都是动态 import，文档无对应块时零加载——

- `mermaid-block.ts:221-229` `getMermaid()`：首次渲染才 `import('mermaid')`，且带模块级 promise 缓存
- `math-block.ts:11-23` `getKatex()`：首次使用才 `import('katex')` + `import('katex/dist/katex.min.css')`
- `image.ts:181-182,365` 的 document service 也是按需动态 import

### 1.2 扩展初始化：一次性全量注册，但无重操作

`createEditorExtensions`（`editor-extensions.ts:127-266`）在编辑器创建时一次性返回约 30 个扩展：

- StarterKit（内部展开 20+ 子扩展：Bold/Italic/List/History/Dropcursor/Gapcursor 等，`node_modules/@tiptap/starter-kit/dist/index.js:19-80`，其中禁用了 codeBlock/link/heading）
- 自定义节点：Frontmatter/Footnote×3/SemanticHeading/CustomCodeBlock/Table×4/CustomImage/Callout/MathBlock/MathInline/MermaidBlock
- 自定义插件：MarkdownInput/MarkdownPaste/ParagraphFocus/SearchHighlight/Wikilink/LinkOpen/SlashCommands/EmojiSuggest

排查结论：

- **全部扩展在编辑器创建时实例化**（TipTap 模式固有），但没有任何 `onInit`/`onCreate` 钩子（grep 全 extensions 目录无匹配）——**不存在「初始化阶段建立索引/扫描全文档」的重操作**。
- 初始化时的重成本只有两处、均为**一次性**：

   1. `createEditor` 内 `parseMarkdown` 全量解析（`MarkdownEditor.vue:200-201`）——文档加载成本，合理
   2. `setContent` dispatch 触发 code-block-lowlight 插件 `apply` 的 2×`findChildren` + markdown-input `decorations` 首次全量 build（Step 2 P0-1/P0-3 同源）——一次性，非反复成本
- 静态成本点：`code-block.ts:31-49` 用 `createLowlight` 静态注册 17 种 highlight.js 语言（bundle 体积成本，编辑器创建时 build lowlight 实例）。语言粒度是「整语言模块」，非按需。属可接受现状（17 种是主流子集），但若想进一步缩首包，可改为动态注册语言（Step 2 已记为待量化项）。

**小结**：加载机制健康，三层懒加载到位；初始化阶段无重操作。TipTap「全量注册扩展」是框架模式固有成本，不算缺陷。

---

## 二、插件之间的事件通信

### 2.1 没有事件总线，四种协作方式并存

项目**没有** mitt/EventEmitter 类总线（grep 无匹配）。插件与模块间的协作方式是：

| 方式              | 载体                 | 实例                                                                                                                                                                        |
| --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PM 事务机制**（主要） | ProseMirror 插件管线   | input rules、`appendTransaction`（markdown-input）、`decorations` props（markdown-input/paragraph-focus/search-highlight/code-block-lowlight）、`view.update`（markdown-input）    |
| **Vue 主动推送**    | emit\('update'\)   | `useEditorSync` 防抖后单出口 → `App.vue` stats（`useEditorSync.ts:44-73`）                                                                                                        |
| **ref 闭包共享**    | 闭包读取 ref           | SearchHighlight 的 `getMatches` 读 `useEditorSearch` 的 `currentMatches`（`search-highlight.ts:14-16,34-40`）；slash/emoji 菜单经 `Ref` 注入（`editor-extensions.ts:194-217,238-262`） |
| **expose 直接调用** | defineExpose / ref | App 层 `editorRef.executeCommand/getContent/getEditorView`（`MarkdownEditor.vue:430-460`）；OutlinePanel 直接拿 PM view 做 scroll-spy（Step 3 P1-1 同源）                             |

### 2.2 连锁响应实例盘点

- **每次击键的事务 → 全插件 decorations + appendTransaction**：这是 PM 管线固有行为，Step 2 已量化（4 次 O\(n\) 全文档遍历），不是通信问题而是计算问题。
- **主题切换 → 一串连锁**（本次排查新确认）：
`settings.activeThemeId` 变化 → `applyTheme` 改 `documentElement` class → `useEditorAppearance` 的 MutationObserver（`useEditorAppearance.ts:34-42`）→ RAF 合流 → `syncMermaidTheme()`（遍历**所有**活跃 mermaid NodeView 重渲，`mermaid-block.ts:232-238`）+ `refreshParagraphFocus()`（dispatch 空事务 → 全插件 decorations 重新求值）。
这是唯一一个「一个插件触发、一串插件响应」的实例，但**低频**（仅主题切换/字体切换时），且已用 RAF 合流，属可接受。
- **拖拽图片**：Rust 事件 → `setupEditorImageDrop` → dispatch 插入事务，走标准管线，无旁路。

### 2.3 评估

协作方式以 PM 事务为核心是**标准且健康**的；外围用「推送 + 闭包 + expose」而非事件总线，对该规模项目是合理取舍（避免总线风暴）。代价是 `AppEditorExpose` 把 PM view/editor 直接暴露给上层（OutlinePanel 的 scroll-spy 直接读 view DOM），耦合面较宽但功能必要。**没有发现「互相拖后腿」的通信热点**。

---

## 三、编辑器状态的存储与同步

### 3.1 各类状态存放位置全景

| 状态                | 存放位置                                                  | 真相源                                       | 备注                                         |
| ----------------- | ----------------------------------------------------- | ----------------------------------------- | ------------------------------------------ |
| 文档内容（渲染真相）        | **PM EditorState.doc**                                | PM 唯一                                     | 每次事务新建                                     |
| 文档内容（markdown 基线） | `fileStore.currentFile.content`（`file.ts:6-15`）       | **双源之一**                                  | 500ms 防抖序列化写入                              |
| 光标位置/选区           | PM EditorState.selection                              | PM 唯一                                     | 无副本                                        |
| 脏标记               | `fileStore.currentFile.isDirty`                       | `syncEditedContent` 语义比对（`file.ts:57-66`） | A1 唯一真相源                                   |
| 字数/光标行号/大纲        | `stats` reactive（`useAppEditorState.ts:25-30`）        | 从 PM 派生                                   | 单向流动，无反向写入                                 |
| 搜索匹配/索引           | `useEditorSearch` 本地 refs（`useEditorSearch.ts:37-43`） | 从 PM 派生                                   | SearchHighlight 闭包读取                       |
| 大纲 activeId       | OutlinePanel 组件本地                                     | scroll-spy 实时                             | 无副本                                        |
| 折叠状态              | **无此功能**                                              | —                                         | grep fold/collapse 仅 CSS `border-collapse` |
| 设置                | `settingsStore.settings` + Rust store 持久化             | store                                     | 300ms 防抖写盘（`settings.ts:126-140`）          |

### 3.2 双源存储评估（P1-C）

`PM doc`（渲染真相）与 `store.content`（markdown 基线）是**两处真相**，同步链为：

```
编辑 → onUpdate → useEditorSync 500ms 防抖 → serializeMarkdown → fileStore.syncEditedContent
```

这个设计是**有意的**（PM doc 是渲染真相，store 是保存/脏态基线），且两处兜底已消除「防抖窗口内不一致」的多数风险：

- 保存时**实时取数**：`persistDocument` 用 `options.getContent()`（即实时 serializeMarkdown PM doc），不读防抖副本（`useDocumentSession.ts:173-177`）
- 关窗/切换前**实时评估脏态**：`evaluateDirtyFromEditor`（`useDocumentSession.ts:111-116`）绕开防抖直接比对

**剩余风险**：两处真相的暂时分叉是架构固有（防抖窗口内 store 落后于 PM），但所有「写盘/判定」入口都已实时取数，**无实际数据丢失路径**。属「可接受的架构复杂度」，不建议为消双源而重构（改动大、收益低、风险高）。

### 3.3 同步开销

四路防抖独立计算（字数 150ms / 大纲 500ms / 序列化 500ms / 光标 100ms，`useEditorSync.ts:26-32`），`handleDocChange` 一次触发三条 debounce（`:69-73`），无同步风暴。诚实度好。

---

## 四、撤销/重做栈的实现

### 4.1 实现与粒度

- **实现**：`prosemirror-history@1.5.0`，经 StarterKit 的 `UndoRedo` 默认启用（`starter-kit/dist/index.js:54-56`），**无自定义配置**。
- **粒度**：**增量 step 存储**，非快照。每个历史条目保存事务的 steps（变更区间）+ 逆映射 + selection 映射，连续同类输入按 eventCount 自动合并（`prosemirror-history` 的 closeEvent 机制）。大文档下每步内存只与「编辑量」成正比，与文档大小无关。
- **上限**：`depth: 100`（`prosemirror-history/dist/index.js:373` `config.depth || 100`），最多 100 个合并后的事件组，超限从底部溢出（`:102`）。
- **序列化开销**：撤销栈**只在内存**，不参与任何序列化/落盘。✓

### 4.2 结构性隐患 P0-A：跨文档事务污染撤销栈（真实数据风险）

**链路**（已从源码逐层验证）：

```
切文档 → watch(fileStore.currentFile.path)（MarkdownEditor.vue:217-238）
  → editor.commands.setContent(doc.toJSON(), { emitUpdate: false })（:231）
    → @tiptap/core 的 setContent：tr.replaceWith(0, doc.content.size, document2)
      仅 setMeta("preventUpdate", !emitUpdate)（node_modules/@tiptap/core/dist/index.js:1218）
      —— 不带 history 的 addToHistory:false
    → prosemirror-history 记录所有 docChanged 事务（除非显式 meta 排除）
```

**后果**：

1. 切到文档 B 后，undo 栈顶部是一整个「A 全删 + B 全插」的 replace step。
2. 用户在 B 中按一次 Ctrl+Z → 撤销该 step → **文档内容一步退回 A**。
3. 此时 PM doc（A 内容）与 `fileStore.currentFile.content` 基线（B 内容）严重分叉。
4. 若此时触发保存：`persistDocument` 实时取 PM doc → **把 A 的内容写进 B 的文件**（`useDocumentSession.ts:173-177` 无防呆）。这是数据覆盖级风险。

**修复方向**（确认后实施，二选一）：

- **方向 A（推荐，改动最小）**：在 path watcher 的 setContent 前，先 dispatch 一个带 `setMeta('addToHistory', false)` 的事务清掉当前 undo 栈（或直接用 `history` 插件 key 的 `clearHistory` 命令/直接重置插件 state）。这样切文档 \= 历史栈清零，undo 语义回到「只撤当前文档内的编辑」。
- **方向 B**：包一层 `editor.commands.setContent` 的前置 hook，给 replaceWith 事务显式加 `setMeta('history', { addToHistory: false })`——但这样 undo 栈里仍留着旧文档的编辑历史，切回 A 后还能撤到更早状态，语义混乱，不如方向 A 干净。

> 注：Step 3 曾评估「多文档切换为同步 3 步」（serialize+parse+setContent）是 P0-2 性能项；本报告从**正确性**角度发现同一 setContent 还有撤销栈污染问题。两个问题可在同一处修复中一起处理（切换时清历史栈）。

---

## 五、自定义命令与快捷键的注册机制

### 5.1 结构

- **注册表**：`COMMANDS` 静态表 33 条（`registry.ts:45-344`）+ `COMMAND_LOOKUP` Map（O\(1\) 按 id 查，`:346-350`）。
- **分发链**：

```
window keydown（useAppDomEvents.ts:47-98）
  → findCommandByShortcut（线性 find，registry.ts:486-492，33 条，微秒级）
  → useCommandDispatcher（switch，useCommandDispatcher.ts:41-100）
    → editor 作用域：editorRef.executeCommand → executeEditorCommand（switch，editor-commands.ts:51-102）
    → app 作用域：直接调 handleNew/handleSave/... 
```

- **原生菜单**：`getMenuShortcuts` → `toTauriAccelerator`（registry.ts:450-484）→ `refreshNativeMenuShortcuts` 同步到 Rust 菜单；菜单点击经 `listenMenuEvent` 回传 → executeCommand（`useMenuEvents.ts:4-17`）。
- **用户自定义**：`settings.customShortcuts`（id → key 字符串）覆盖默认（`getShortcut`，registry.ts:352-354）；设置面板 `useShortcutSettings.ts` 读写。

### 5.2 发现的问题

**P2-D 死代码 **`shortcuts.ts`：`CustomShortcuts` 扩展（`shortcuts.ts:9-44`）定义了 Mod-1..6 / Mod-Shift-8/9/x/b/c/h/s 等一串快捷键，但从未被任何文件引用（grep 仅定义处命中），也未加入 `editor-extensions.ts`。它的注释「TipTap StarterKit 已提供基础快捷键，这里补充额外的」与实际完全不符——实际这些快捷键由 registry 的 defaultShortcut + window keydown 通道提供。**风险是误导维护者**：若有人看到 shortcuts.ts 以为标题快捷键由它兜底而删掉 registry 的 defaultShortcut，快捷键会静默失效。

**P2-E 命令 id 三处清单**：同一命令 id 存在于 registry 定义 / `executeEditorCommand` switch / `useCommandDispatcher` switch 三处。新增命令需同步 3 处，有漏改风险（与项目历史「新增 Rust 命令三处同步」的教训同构）。当前核对无遗漏，但建议未来收敛为「命令定义携带 handler」的单点注册。

**P2-F 双通道潜在重复（需实测，非定论）**：编辑器内按 Mod-s：Tauri 原生菜单 accelerator 与 window keydown 是两条独立通道。`useAppDomEvents` 对 `file.save` 等 app 命令**无去重**（:71-77 只对 editor scope 且未自定义的命令跳过）。若 Tauri 菜单 accelerator 消费后 keydown 仍到达 WebView，会触发双保存。Tauri 官方行为通常是 accelerator 优先消费，但**未在本机实测，标注为待验证项**。

**核对无冲突**：editor scope 命令的「跳过逻辑」（:71-77）依赖「registry defaultShortcut 与 PM 内置 keymap 一致」的隐式约定（Mod-b\=bold / Mod-z\=undo / Mod-i\=italic），当前逐条核对一致。

---

## 六、第三方依赖的版本与兼容性

### 6.1 版本一致性：完全统一，无混用

- package.json 声明 `@tiptap/*@^3.26.1`，\*\*锁文件实际解析为全部 \*\*`3.27.1`（bun.lock:358-434，core/pm/starter-kit/suggestion/vue-3 等全部一致），peerDependencies 互相对齐（如 core 要求 pm `3.27.1` 精确匹配）。✓
- prosemirror 各包经 `@tiptap/pm@3.27.1` 统一引入（bun.lock:428），实际版本：

   - state 1.4.4 / view 1.41.9 / model 1.25.9 / transform 1.12.0
   - history 1.5.0 / inputrules 1.5.1 / keymap 1.2.3 / commands 1.7.1 / schema-list 1.5.1 / tables 1.8.5
   - 均为当前较新版本，**无已知重大性能问题的旧版**。

### 6.2 无 fork / patch

- package.json 无 `postinstall`、无 `patchedDependencies`、无 git 依赖
- bun.lock 无 patches 字段（lockfileVersion 1，无 patch 段）
- 无 vendor / 本地魔改目录

### 6.3 组合兼容性

- highlight.js \^11.11.1 + lowlight \^3.3.0（peer 要求 `highlight.js ^11` + `lowlight ^2 || ^3`）——兼容 ✓
- markdown-it \^14.2.0 + footnote/mark/sub/sup/task-lists/texmath 插件——标准组合 ✓
- katex \^0.17.0（dev 类型 @types/katex 0.16 略低但仅类型，无运行时影响）、mermaid \^11.15.0——较新 ✓

**小结**：依赖健康、版本统一、无自改依赖，本维度无问题。

---

## 七、修复方向汇总（全部需确认后实施）

| 编号       | 修复                                                   | 成本             | 风险                              |
| -------- | ---------------------------------------------------- | -------------- | ------------------------------- |
| **P0-A** | 切文档 setContent 前清空撤销栈（方向 A）                          | 低（watcher 内几行） | 低，修复真实数据覆盖风险                    |
| **P1-B** | 主题切换连锁重渲保持现状即可（已 RAF 合流）                             | 无需改            | 若未来自定义主题频繁切换再考虑按 NodeView 可见性节流 |
| **P2-D** | 删除死代码 `extensions/shortcuts.ts`（或接入并去重 registry 快捷键） | 极低             | 删除前确认无引用（已确认）                   |
| **P2-E** | 命令注册收敛为单点（定义带 handler）                               | 中              | 属重构，可排期                         |
| **P2-F** | 实测双通道是否重复触发，如有则在 dispatcher 加去重                      | 低              | 需先实测                            |

> 与 Step 3 的联动：多文档切换的性能项（P0-2 同步 3 步）与本报告的撤销栈污染（P0-A）都在同一处 `watch path` 逻辑，可合并设计一次性修复。

---

*本报告基于实际代码与 node_modules 已装版本（@tiptap 3.27.1 / prosemirror 1.5.0 等）排查，未做任何代码修改。所有修复方向均待用户确认后实施。*

 

# Dumate复核

报告读完。需要核实 P0-A（撤销栈污染）、P1-B（主题切换连锁）、P2-D（死代码）、P2-E（命令三处清单）等。并行读取关键文件。

现在确认 P0-A 的核心论据——prosemirror-history 是否会记录 setContent 的事务。需要检查 history 插件的 apply 实现。

关键代码确认了。现在看 `reinitializeMermaidTheme` 和 `executeEditorCommand` 的 switch 清单。

所有关键代码已确认。给出核实结论。

---

## 核实结论

### P0-A：setContent 事务污染撤销栈 — **完全正确，数据风险真实存在**

这是本份报告最重的发现，逐层实锤：

**TipTap setContent 源码**（`@tiptap/core/dist/index.js:1218`）：

```js
tr.replaceWith(0, doc.content.size, document2).setMeta("preventUpdate", !emitUpdate);
```

只设了 `preventUpdate` meta，**没有设 **`addToHistory: false` ✅

**prosemirror-history apply 逻辑**（`prosemirror-history/dist/index.js:274`）：

```js
else if (tr.getMeta("addToHistory") !== false && !(appended && appended.getMeta("addToHistory") === false)) {
    // → addTransform(tr, ...)  ← 记入撤销栈
```

事务只要 `steps.length > 0` 且没显式 `addToHistory: false`，就记入历史 ✅

`setContent` 的 `tr.replaceWith(0, doc.content.size, document2)` 产生 steps 且未排除 history → **必然进入撤销栈** ✅

**后果链验证**：

1. 切文档 B 后，undo 栈顶 \= "A 全删 + B 全插" 的 replace step ✅
2. Ctrl+Z 撤销该 step → PM doc 变回 A 内容 ✅
3. `persistDocument`（`useDocumentSession.ts:174`）实时取 PM doc → **把 A 内容写进 B 文件** ✅
4. 此路径无任何防呆 ✅

**报告修复方向 A 的可行性确认**：ProseMirror history 插件支持通过 `tr.setMeta('addToHistory', false)` 排除事务，也支持 `clearHistory`（通过 `closeHistoryKey` meta 或直接重置插件 state）。在 setContent 前清空撤销栈是正确且最低成本的方向。

**一个报告没提到的缓解因素**：`confirmDiscardUnsavedChanges`（第 122 行）在切文档前会调 `evaluateDirtyFromEditor()`，如果旧文档有未保存修改会弹框确认。但这个保护只覆盖"旧文档有修改"的场景——如果旧文档没修改（isDirty\=false），切换不弹框，撤销栈照样被污染。所以这个缓解因素不改变 P0-A 的结论。

### P1-B：主题切换触发连锁重渲 — **完全正确**

`useEditorAppearance.ts:34-42` 实锤：

- `MutationObserver` 监听 `documentElement.class` 变化 ✅
- RAF 合流后执行 `syncMermaidTheme()` + `refreshParagraphFocus(view)` ✅
- `syncMermaidTheme` → `reinitializeMermaidTheme()`（`mermaid-block.ts:232-237`）→ `mermaidNodeViews.forEach(view => view.rerender())` 遍历所有活跃 mermaid NodeView ✅
- `refreshParagraphFocus`（`paragraph-focus.ts:73-75`）→ `invalidateCache()` + `view.dispatch(view.state.tr)` 空事务 → 全插件 decorations 重新求值 ✅

报告说的"低频、已 RAF 合流、可接受"判断准确。这是三个问题里描述最精确的一个——链路、影响范围、频率评估全部正确。

### P1-C：双源存储 — **正确，之前已核实**

与 Step 2/Step 3 的核实结果一致。`persistDocument` 实时取数（第 174 行）、`evaluateDirtyFromEditor` 绕开防抖（第 111-116 行）均已确认。报告说的"有意复杂度、无实际数据丢失路径"判断准确。

### P2-D：shortcuts.ts 是死代码 — **完全正确**

- `shortcuts.ts` 定义了 `CustomShortcuts` 扩展 ✅
- grep 全项目 `src` 目录：`CustomShortcuts` 仅在定义处命中，无任何 import/引用 ✅
- `editor-extensions.ts:130-266` 的扩展清单中不含 `CustomShortcuts` ✅
- 注释"TipTap StarterKit 已提供基础快捷键，这里补充额外的"与实际不符——实际快捷键由 registry 的 `defaultShortcut` + `useAppDomEvents` 的 window keydown 通道提供 ✅

**一个细微补充**：`shortcuts.ts` 定义的快捷键（Mod-1..6 标题、Mod-Shift-8/9 列表等）与 `registry.ts` 的 `defaultShortcut` 确实重叠。如果有人误接入 `CustomShortcuts`，这些快捷键会被 PM keymap 和 window keydown **同时**触发——PM keymap 先消费并 `preventDefault`，window keydown 的 `handleKeyDown` 中的跳过逻辑（`useAppDomEvents.ts:71-77`）依赖 `command.scope === 'editor' && !customShortcuts[command.id]` 判断，不会重复执行。但这是巧合性的安全，不是设计性的安全。

### P2-E：命令 id 三处清单 — **正确**

三处 switch 已确认：

1. `registry.ts` — 命令定义 + `defaultShortcut` ✅
2. `editor-commands.ts:58-101` — `executeEditorCommand` 的 switch（editor scope）✅
3. `useCommandDispatcher.ts:54-97` — `executeCommand` 的 switch（app scope）✅

新增命令需同步 3 处。报告说的"与项目历史「新增 Rust 命令三处同步」教训同构"准确——这确实是同类问题。

### P2-F：双通道潜在重复 — **正确标注为待验证**

`useAppDomEvents.ts:67-84` 的逻辑已确认：

- 第 71-77 行：编辑器内、editor scope、未自定义的命令 → 跳过（让 PM keymap 处理）
- 但 `file.save` 等 app scope 命令**无此跳过逻辑** → 如果 Tauri 菜单 accelerator 消费后 keydown 仍到达 WebView，会双触发

报告标注"需实测、非定论"是诚实的。Tauri 的行为通常是 accelerator 优先消费并阻止 keydown 传播到 WebView，但这取决于 Tauri 版本和平台——不实测不能下结论。

---

## 总结

| 问题                    | 报告结论                                             | 核实结果                                                                                                                |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| P0-A setContent 污染撤销栈 | 切文档后 Ctrl+Z 退回旧文档内容，保存会覆盖                        | **完全正确**。TipTap setContent 不设 addToHistory:false + prosemirror-history 默认记录所有 docChanged 事务 \= 撤销栈污染。数据覆盖风险真实存在，无防呆 |
| P1-B 主题切换连锁           | MutationObserver → 全 mermaid 重渲 + decorations 重建 | **完全正确**。链路、影响范围、频率评估全部准确                                                                                           |
| P1-C 双源存储             | 有意复杂度、无数据丢失路径                                    | **正确**。与之前核实一致                                                                                                      |
| P2-D shortcuts.ts 死代码 | 从未被引用、注释误导                                       | **完全正确**。grep 实锤零引用                                                                                                 |
| P2-E 命令 id 三处清单       | 新增命令需同步 3 处                                      | **正确**。三处 switch 已确认                                                                                                |
| P2-F 双通道潜在重复          | 需实测                                              | **正确标注**。app scope 命令确实无去重逻辑                                                                                        |

**整体评价**：这是四份报告中质量最高的一份。P0-A 的发现是四份报告里**唯一一个数据安全级别的真实 bug**——不是性能问题、不是架构异味，是用户操作可触发的数据覆盖风险。链路分析从 TipTap setContent → prosemirror-history apply → 撤销行为 → 保存覆盖，每一环都有源码实锤。修复方向 A（清空撤销栈）也经过验证是可行的。

如果只能修一个问题，**P0-A 是绝对优先级**——它不是"慢"或"卡"，而是"用户可能丢失数据"。而且修复成本极低（watcher 内几行代码），收益/风险比远超其他所有项。建议与 Step 3 的 P0-2（多文档切换性能）合并修复——两者都在 `watch(fileStore.currentFile.path)` 这同一处代码。

 
