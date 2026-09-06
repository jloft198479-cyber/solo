---
title: 全面审查优化方案（2026-09-06）
type: proposal
audience: maintainer
status: proposal
tags: [优化方案, 审查, 交互体验, 响应速度, 格式兼容, 提案]
summary: 2026-09-06 三方向全面审查 30 条发现与 P0-P3 分批修复路线图，已全部收口（B3 放弃定为设计取舍）
updates: [docs/KNOWN-ISSUES.md, src/components/Editor/, src-tauri/src/]
---

# 全面审查优化方案（2026-09-06）

> 应对方向：审查 bug、提升交互体验、提升响应速度、提升格式兼容性。
> 审查方法：三个独立代码审查（交互体验 / 格式兼容性 / 性能与 bug），**全部发现均有 file:line 证据**；此前用户反馈并已登记的两条问题（[`KNOWN-ISSUES.md §二 #9/#10`](./KNOWN-ISSUES.md)）一并纳入，共 **31 条**。
> 核实（2026-09-06）：31 条已逐条对照实际代码复核——**30 条属实，B9 被运行时反证推翻剔除**（注记见方向 B 表后），本文按 **30 条**维护。
> 状态：**全部收口（2026-09-06）**——P0-P3 全部完成，B3 Word 列表重建经评估放弃、定为设计取舍（见 [`KNOWN-ISSUES.md`](./KNOWN-ISSUES.md) §三）。30 条审查发现无遗留待办。每完成一项：[`KNOWN-ISSUES.md`](./KNOWN-ISSUES.md) 对应条目移 §一 已修复 + 本文勾销进度。

---

## 一、审查发现全清单

### 方向 A：交互体验（10 条）

| # | 严重度 | 现象 | 根因（file:line） | 修法方向 |
|---|---|---|---|---|
| A1 | 高 | 图片 alt/src 行内编辑入口死锁：`.mk-image-source-text` 默认 `display:none`，仅 `.is-editing` 时显示；而 `is-editing` 只由该元素 focus 事件添加——不显示就无法聚焦、不聚焦就永不显示，整套 sourceText 编辑逻辑是死代码，改 alt/路径只能改源码 | [`editor.css`](../src/components/Editor/tiptap/editor.css):788-809 + [`image.ts`](../src/components/Editor/tiptap/extensions/image.ts):523-527 | 图片 NodeSelection 选中态或 hover 时显示 sourceText |
| A2 | 高 | 表格没有「删除整表」入口：右键菜单只有 7 个行列操作、registry/slash 均未接 `deleteTable`；逐行删到剩一行时 `deleteRow` 直接返回 false，表格删不掉（唯一逃生通道「全选单元格再删」无任何提示）——复刻 Mermaid「能创建不能删除」教训 | [`MarkdownEditor.vue`](../src/components/Editor/MarkdownEditor.vue):365-376 / [`editor-commands.ts`](../src/components/Editor/tiptap/editor-commands.ts):99-112 / [`registry.ts`](../src/commands/registry.ts):279-333；prosemirror-tables `deleteRow` 单行拒删 | 右键菜单 + 命令注册表补 `deleteTable`，`can()` 为真时启用 |
| A3 | 高 | Emoji 建议（`:` 触发）未传 `allowedPrefixes`，继承默认 `[' ']`——中文后输入 `:微笑` 不弹菜单，Slash 命令的中文场景坑原样复刻（Slash 已修、Emoji 漏修） | [`editor-extensions.ts`](../src/components/Editor/tiptap/editor-extensions.ts):220-234 继承默认值（`@tiptap/suggestion/dist/index.js:646`） | 同 Slash：显式传 `allowedPrefixes: null` + 对照单测 |
| A4 | 中高 | 焦点模式开着时 Esc 被全局劫持：关 Slash 菜单 / 退出 Mermaid 编辑 / 关右键菜单等内层 Esc 同时把焦点模式退出了（内层 handler 均 preventDefault 但不 stopPropagation，事件冒泡到 window 触发 toggle） | [`useAppDomEvents.ts`](../src/composables/useAppDomEvents.ts):86-97（window 级）+ [`mermaid-block.ts`](../src/components/Editor/tiptap/extensions/mermaid-block.ts):461 / [`math-block.ts`](../src/components/Editor/tiptap/extensions/math-block.ts):193 / [`ContextMenu.vue`](../src/components/Editor/views/ContextMenu.vue):100 / [`BubbleMenu.vue`](../src/components/Editor/views/BubbleMenu.vue):62（内层不拦截冒泡） | 内层 Esc 统一 stopPropagation，或 window 拦截前检查消费方（对照 SearchPanel 的 `.stop` 正确写法） |
| A5 | 中高 | Slash 菜单在代码块内（`// 注释`）和 URL 输入（`https://a.com`）中误触发，此时按 Enter 会执行命令把代码/URL 文本替换掉 | [`editor-extensions.ts`](../src/components/Editor/tiptap/editor-extensions.ts):178-183 无上下文守卫；[`suggestion-guard.ts`](../src/components/Editor/tiptap/extensions/suggestion-guard.ts):19-50 只查前缀不查 code 块；Suggestion 的 `allow()` 未配置 | `allow: ({editor}) => !editor.isActive('codeBlock')` + URL 场景抑制（前缀 `/`、`:`） |
| A6 | 中 | 选区 BubbleMenu（fixed 定位）不随滚动/窗口缩放更新，与选区脱节并遮挡正文；唯一刷新入口是 onSelectionUpdate | [`MarkdownEditor.vue`](../src/components/Editor/MarkdownEditor.vue):312-321 + [`BubbleMenu.vue`](../src/components/Editor/views/BubbleMenu.vue):183-186（无 scroll/resize 监听） | 编辑器滚动容器加 rAF 节流 scroll 重算，或滚动时隐藏 |
| A7 | 中 | 表格右键菜单依赖「光标已在表格内」：光标在表外段落时直接右键表格不弹菜单（PM 右键不移动光标） | [`MarkdownEditor.vue`](../src/components/Editor/MarkdownEditor.vue):378-384 以 `isActive('table')`（当前选区）判定 | 用 `view.posAtCoords(event)` 反查右键坐标是否落在表格内 |
| A8 | 中低 | Ctrl+F 完全无响应（webview 无原生查找兜底）；查找绑定在 Mod+G / Mod+Shift+G，与「跳转到行」心智冲突 | [`registry.ts`](../src/commands/registry.ts):335-353 | 默认快捷键改 Mod+F / Mod+H（保留自定义覆盖） |
| A9 | 中低 | 编辑器内粘贴图片落盘失败静默（console.error）；编辑器外粘贴失败提示「请用工具栏插入图片」但工具栏并无插入图片按钮 | [`markdown-paste.ts`](../src/components/Editor/tiptap/extensions/markdown-paste.ts):594-610（仅 console）+ [`useAppDomEvents.ts`](../src/composables/useAppDomEvents.ts):33（文案落空） | 失败接 message 弹窗（与拖拽对齐）+ 文案改「请使用拖拽插入」 |
| A10 | 低 | 搜索 0 结果无任何反馈（不区分「还没搜」和「没搜到」）；wikilink 显示文本永远搜不到不高亮 | [`SearchPanel.vue`](../src/components/Editor/views/SearchPanel.vue):40（`matchCount > 0` 才渲染）+ [`useEditorSearch.ts`](../src/components/Editor/tiptap/useEditorSearch.ts):89-98（只遍历 isText，wikilink 是 atom） | 0 匹配显示灰字；findMatches 对 wikilink 额外匹配 display 文本 |

### 方向 B：格式兼容性（9 条）

> 背景核对：KNOWN-ISSUES §一 #11/#12 已确认落地无残留；`hasMarkdownOnlySyntax` 的 HTML 路径接线缺口（paste-compat-decision.md 先做 #1）**已修复**（`markdown-paste.ts:475-485`）。以下为剩余问题。

| # | 严重度 | 现象 | 根因（file:line） | 修法方向 |
|---|---|---|---|---|
| B1 | 中 | 文件落盘转义漏 `_`：字面 `_case_`（如 `snake \_case\_`）保存时 `\_` 被剥掉，**重开变斜体**——语义静默改变（markdown-it 实测 `em_open`） | [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts):250 文件模式全局转义类不含 `_`（`*` 有、`_` 没有，CommonMark 两者等价） | 文件模式全局类补 `_`（或按 CommonMark intraword 例外做选择性转义） |
| B2 | 中 | 剪贴板出站轻量转义漏 `_ ~ [ ] < >`：复制字面 `a_b_c` / `~~text~~` / `[见附录]` / `<tag>` 粘到 Obsidian/Typora 被重新解释为斜体/删除线/引用样式/被吃 HTML——#11 只修了「多余转义」没修「转义不足」 | [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts):241-247 clipboard 模式只转义 `` ` `` `*` 与行首 `#+\-.>=` | clipboard 模式全局类补 `_~[]<>`（低频符号保持轻量） |
| B3 | 中 | Word 粘贴列表必然塌平：Word HTML 用 `MsoListParagraph` + 字面 `·`/`1.` 表达列表（无 ol/ul/li），现有管线只清理不重建 → 全变平段落 | [`markdown-paste.ts`](../src/components/Editor/tiptap/extensions/markdown-paste.ts):391-412（`stripMsoMarkup` 后 PMDOMParser 只能映射 paragraph，无列表重建逻辑）| ~~对 bullet glyph / `数字.` 段落做启发式转列表~~ **放弃（2026-09-06，定为设计取舍，见 KNOWN-ISSUES §三）**：低收益（用户核心是 Markdown 写作、不大量搬 Word）+ 高风险（列表变体多、易误判正常文字） |
| B4 | 低 | 有序列表第 10 项起嵌套子列表被 3 空格缩进落盘，重开时脱离父项变文档级列表 | [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts):303 固定 `'   '.repeat(depth)`，未按 marker 宽度（`10. ` = 4）对齐 | renderList 记录 marker 宽度，子层缩进取 markerWidth |
| B5 | 低 | 表格列宽对齐按 UTF-16 长度计算，含中文单元格 `|` 无法视觉对齐（显示宽 2 记 1） | [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts):443/453 无 East Asian Width 计算 | 加东亚宽字符宽度函数（W/F 算 2）替换 length/padEnd |
| B6 | 低 | 行内代码首尾空格 roundtrip 丢失：`` ` x ` `` 重开变 `x`（CommonMark 剥各一个空格） | [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts):147-149/188-190 padding 条件只查反引号不查空格 | padding 条件补 `startsWith/endsWith(' ')` |
| B7 | 低 | mermaid/math 块固定围栏：内容含独立 ` ``` ` / `$$` 行时**落盘即损坏**（提前闭合围栏，重开错乱）——codeBlock 有围栏升级逻辑，这两个漏做 | [`plugins/mermaid.ts`](../src/components/Editor/tiptap/markdown/plugins/mermaid.ts):22-24 / [`plugins/math.ts`](../src/components/Editor/tiptap/markdown/plugins/math.ts):31-36（对照 `serializer.ts:390-398` codeBlock 的 `_maxCharRun`） | 复用 codeBlock 围栏升级逻辑 |
| B8 | 低 | 含反斜杠的链接 destination（Windows 路径 `[x](C:\notes\a.md)`）落盘被改写且 href 损坏（`%5C` 原样落盘） | [`parser.ts`](../src/components/Editor/tiptap/markdown/parser.ts):54-64 解码白名单不含 `%5C` + [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts):534-535 平衡括号分支不处理 `\` | decode 补 `%5C` 还原，或序列化时检测后改 `<...>` 形式落盘 |
| B10 | 低 | callout 标题/折叠标记不建模：Obsidian `> [!NOTE]+ 标题` 的 `+ 标题` 变内容段落，roundtrip 后 Obsidian 语义变化；callout 内空行序列化带尾随空格 `> ` | [`plugins/callout.ts`](../src/components/Editor/tiptap/markdown/plugins/callout.ts):32 正则只剥 `[!TYPE]` + 空行写 `> `（serializer.ts:349-359） | callout attrs 增 title/fold 并回写；空行输出 `>` 不带空格 |

> **B9 已核实驳回（2026-09-06，从本表与 P2 批次剔除）**：原发现「跨块选区且起点在段中间时 text/plain 丢第一段被选中文字」经运行时端到端实测不成立——`doc.slice()` 顶层子节点是**带部分文本的 block 段落**而非裸文本节点（实测 openStart:1 时 child0 为 `paragraph "ABC文字"`），`serializeClipboardSlice` 输出 `"ABC文字\n\n第二段文字\n\n第三段\n"`，首段被选中文字完整保留；引用块内部分选区同样完整。「renderContent 空循环丢弃非 block 子节点」的机制断言与 PM 实际行为不符。同类发现勿再提交，除非附具体复现步骤。

### 方向 C：性能与潜在 bug（9 条）

> 背景核对：2026-08-14 的 9 项性能修复全部在位；「经评估跳过」3 项中，焦点模式装饰已由 P4-03 改为 O(1) 增量（旧结论过时）、lowlight 已延迟创建且 heavy 档停用 highlightAuto、`findCommandByShortcut` 线性查找量级可忽略维持跳过。序列化防抖/语义比对/重入保护/事件清理逐项核查无问题。

| # | 严重度 | 现象 | 根因（file:line） | 修法方向 |
|---|---|---|---|---|
| C1 | 高 | **保存原子写无 fsync**：`create(tmp) → write_all → rename` 全程无 `sync_all()`，断电/内核崩溃后 rename 元数据可能先于数据块落盘 → 唯一文档副本整文件截断/半旧。自动保存最短 5s 一次直写真实文件，显著放大暴露面 | [`document.rs`](../src-tauri/src/commands/document.rs):489-509（全 src-tauri 无一处 fsync） | tmp 写完 `sync_all()` 再 rename（低频操作代价可接受），rename 后 fsync 父目录 |
| C2 | 中 | **切图片查看模式卸载编辑器时静默丢编辑**：`v-if` 卸载 → onBeforeUnmount `cancelPending()` **取消**而非执行挂起序列化；最后一次击键距卸载不足 500ms 防抖 + rIC 调度时，编辑既不入 store 基线、doc 随销毁丢失，切回按旧基线重建 | [`App.vue`](../src/App.vue):331/166-169 + [`useEditorSync.ts`](../src/composables/useEditorSync.ts):189-199 + [`MarkdownEditor.vue`](../src/components/Editor/MarkdownEditor.vue):474-504 | onBeforeUnmount 若 `editGeneration !== syncedGeneration` 先同步序列化回写 store（`getContent()` 兜底 `syncEditedContent`） |
| C3 | 中 | remote-image-cache 磁盘缓存无任何清理机制，单图 ≤10MB 无限累积 | [`image.rs`](../src-tauri/src/commands/image.rs):152-166（只写不清） | 启动后台线程按 mtime/总容量清理（复用 main.rs stale 清理模式） |
| C4 | 中 | 启动关键路径同步删除 >1h 的 WebView2 残留数据目录：`remove_dir_all` 万级小文件可耗时 1-数秒，此时尚无任何窗口——「崩溃后隔日再开」必然命中，表现为点击图标长时间无响应 | [`main.rs`](../src-tauri/src/main.rs):9/30-47（先于 `run()` 同步执行） | 清理移到窗口显示后的后台线程 |
| C5 | 中 | 搜索开着时每次编辑停顿 120ms 即全文重扫 + 全量装饰重建（数千匹配 = 数千 Decoration + DOM 分裂），heavy/extreme 档未降档搜索 | [`useEditorSearch.ts`](../src/components/Editor/tiptap/useEditorSearch.ts):62-99（:79 空事务强制重建）+ 档位清单（useEditorSync.ts:145 等）无搜索项 | heavy 档重扫防抖加大（500ms）/装饰延迟到搜索面板交互 |
| C6 | 低 | 切文档时 watch 若序列化缓存未命中（500ms 内切文件）同步全量序列化旧 doc，100-300ms 卡顿恰落在切换瞬间，且目标不同文件时白算 | [`MarkdownEditor.vue`](../src/components/Editor/MarkdownEditor.vue):281-286 | 跨文件 path 变化跳过比对直接替换，仅同 path reloadToken 保留语义比对 |
| C7 | 低 | 异步命令内阻塞 fs IO 未进 spawn_blocking（与已修 #2 标准不一致）：字体 8-15MB 读写、远程图片 ≤10MB 写盘压在 tokio worker 线程 | [`font.rs`](../src-tauri/src/commands/font.rs):116-117/184-185/215/221-223 + [`image.rs`](../src-tauri/src/commands/image.rs):158/165 | 写盘段包 `spawn_blocking`，与 #2 对齐 |
| C8 | 低 | remote-image 50MB 内存 LRU 实际永不触发：#4 修复后 fetcher 返回 asset URL（非 data URL），条目 size 恒 0，预算永不超——淘汰分支是死代码，「50MB 兜底」名存实亡 | [`image.ts`](../src/components/Editor/tiptap/extensions/image.ts):108-110/245-253 | 删掉 blob/预算路径或改按条目数兜底，不留假保险 |
| C9 | 低 | 大纲面板关闭时 scroll-spy 仍在每个滚动帧运行（面板常驻挂载，attachScroll 不看 isOpen；普通档关闭时大纲仍每次编辑照常提取） | [`OutlinePanel.vue`](../src/components/Editor/OutlinePanel.vue):81-95/34-71 | `updateActive` 开头 `if (!props.isOpen) return` |

### 方向 D：既有登记问题（2 条，见 KNOWN-ISSUES §二 #9/#10）

| # | 现象 | 排查结论 |
|---|---|---|
| D1 | 表格选区复制粘到外部自带格式（完整 `<table>` + 像素列宽），「不干净」 | `text/html` 通道保留 PM 默认序列化（出站修复有意为之，保富格式）；跨单元格选区时 prosemirror-tables 升级 `CellSelection`（`content()` 返回整表/表格行，`prosemirror-tables/dist/index.cjs:538-578`），PM `wrapMap` 补 `<table><tbody>` 壳，`resizable:true` 带来固定像素 `<colgroup>`；富文本目标（Word/WPS/微信）优先取 text/html。单单元格内纯文本选区是干净的 |
| D2 | 超链接「不灵敏、时灵时不灵」+ 互链难用 | 外链 Ctrl+单击模型（`link-open.ts:52-68`）四个间歇失效源：① PM 点击判定 4px 阈值（`prosemirror-view/dist/index.cjs:3291`）超限判拖拽静默跳过；② 多窗口首点仅激活窗口；③ 行末裸 URL 未补空白不成链（autolink 要求词尾空白）+ 直输 `[文字](url)` 的 URL 含空格/括号不转换（`markdown-input.ts:447`）；④ 协议白名单仅 http/https/mailto，file:///#锚点/相对路径静默不跳。误导主因：hover `cursor:pointer`（`editor.css:498-503`）但单击永远无反应。互链五点：仅同目录、`[[` 无补全、目标不存在只弹错误无创建、未保存先拦截、单击即跳且 atom 节点无法定位光标 |

---

## 二、两个既有问题的解法（本轮重点设计）

### D1（KNOWN-ISSUES #9）表格复制带格式

**解法：copy 事件拦截，仅对单元格级选区压平 text/html。**

- 在 `MarkdownEditor.vue` 加 `copy` 事件监听（编辑器 DOM 层）：当 `view.state.selection instanceof CellSelection` 时，把剪贴板 `text/html` 替换为逐行 `<p>` 纯文本（单元格文字按行/列拼接），`text/plain` 不动（Markdown 管道表保留）。
- **普通选区一个字节不动**——粗体/斜体等富格式保真是 v1.2.x 出站修复的成果，不受影响。
- 不加设置项（减法原则：单一合理默认，不做开关）。
- 涉及：`MarkdownEditor.vue` 一处监听；测试：cell selection copy 单测（mock clipboardData）。

### D2（KNOWN-ISSUES #10）超链接 + 互链

**外链四修：**

1. **放宽拖拽误判**：LinkOpen 不再依赖 PM `handleClick` 的 4px 门控——插件内 `handleDOMEvents.mousedown` 记录坐标、`click` 事件自判（阈值 10px）。Ctrl+Click 在轻微手抖/触摸板场景不再失效。
2. **消除 pointer 误导**：`<a>` 加 `title="Ctrl+单击打开链接"`，让「hover 可点、单击不动」的交互可预期（保留 Ctrl+单击模型——编辑器共识，单击留给光标定位）。
3. **协议白名单外不再静默**：`file://`/锚点/相对路径点击时提示「仅支持 http/https/mailto 链接外部跳转」（一次提示，不再无声失败）。
4. **autolink 不成链问题**：保持现状（词尾空白触发是 linkify 行为，强行改易引入误链），在文档/wiki 说明「URL 后敲空格或回车即成链接」。

**互链四修（按优先级）：**

1. **目标不存在 → 一键创建**：跳转失败弹窗从「打开文件失败」改为 confirm「目标文档不存在，是否创建？」→ 写入带标题 frontmatter 的空 .md 并打开。消灭死胡同。
2. **`[[` 文件名补全**：✅ 已完成（2026-09-06，独立小批）：复用 Suggestion 基建（Slash/Emoji 同款）+ 新 Rust 命令 `list_markdown_files`，同目录 .md 候选、缓存 + 预取、排除自身；含代码块/`![[`/未闭合互链守卫。详见 KNOWN-ISSUES §一 #18。
3. **未保存拦截保留**（自动保存 2s 下实际很少触发，先不动——减法）。
4. **交互一致性说明**：互链保持单击跳转（对齐 Obsidian）、外链保持 Ctrl+单击，不强行统一——两类链接编辑/跳转诉求不同，在 wiki 已写明。

---

## 三、分批路线图（逐批拍板执行）

| 批次 | 主题 | 条目 | 验证 |
|---|---|---|---|
| **P0** | 数据安全 | ✅ C1 fsync、✅ C2 卸载前 flush（2026-09-06 完成，见 CHANGELOG Unreleased） | cargo check ✅（vcvars64 初始化后本地通过）；bun run test 1207 全过 ✅；vue-tsc ✅；断电/丢编辑语义代码走查 ✅ |
| **P1** | 交互死角 | ✅ 全部完成（2026-09-06）：D1、D2（创建 + title + 阈值 + 提示）+ 拆项 `[[` 补全、A1-A10；见 CHANGELOG Unreleased 与 KNOWN-ISSUES §一 #16-#18 | bun run test（1222 全过）+ vue-tsc + build 三步全过 ✅ |
| **P2** | 格式兼容 | ✅ 全部完成（2026-09-06）：主批 B1、B2、B7、B8、B6、B4（先红后绿，逐项 roundtrip 测试）+ 顺手修复 CommonMark spec Ex20/603（destination 反斜杠转义，652 条规范用例 0 失败）；次级 B5（表格东亚宽度对齐）、B10（callout 标题/折叠标记建模）+ 顺手修复 callout NodeView 丢属性（类型配色真实编辑器从未生效，见 KNOWN-ISSUES §一 #20）；**B3 Word 列表重建放弃（定为设计取舍，见 KNOWN-ISSUES §三）** | 主批：bun run test（1241 全过）+ vue-tsc + build 三步全过 ✅；次级：bun run test（1253 全过）+ vue-tsc + build 三步全过 ✅ |
| **P3** | 响应速度 | ✅ 全部完成（2026-09-06）：C4 启动清理移后台、C5 搜索门控（档位分流防抖 + 匹配未变跳过 dispatch）、C6 切文档跳过白算、C3 磁盘缓存清理（200MB 容量 + mtime LRU + 10min 宽限）、C9 大纲早退 + 重开补算、C7 spawn_blocking（font 三处 + image 写盘）、C8 删 blob/50MB 假预算死代码改条目级 LRU；见 CHANGELOG Unreleased Performance | bun run test（1254 全过）+ vue-tsc + build 三步全过 ✅；cargo check + cargo test --lib（68 全过）✅ |

> 批内顺序即优先级；P2/P3 批内条目可按剩余时间裁剪。全部完成后再回头更新 `README`/`ARCHITECTURE` 涉及面（若此次不涉及命令清单/技术栈则无需）。

## 四、执行纪律（每批必走）

1. 改 parser/serializer：`bun run test`（roundtrip 全过）+ `vue-tsc --noEmit` + `bun run build` 三步全过
2. Rust 改动：`cargo check` 必跑，不因本地环境跳过（CI 是最终闸门）
3. 每完成一项：`KNOWN-ISSUES.md` 条目移 §一 已修复 + 本表勾销；新增 Rust 命令三处同步 + `command-names.ts` 登记（本次预计无新增命令）
4. 每批完成停下通报，验收后再进下一批
5. 退化安全：所有修复必须有失败路径 fallback，不假设环境正常

## See also

- [KNOWN-ISSUES.md（D1/D2 登记处，§二 #9/#10）](./KNOWN-ISSUES.md)
- [paste-compat-decision.md（入站粘贴决策）](./paste-compat-decision.md)
- [font-handling.md（字体系统专题）](./font-handling.md)
- [large-document-performance.md（大文档档位方案）](./large-document-performance.md)
- [文档索引](./INDEX.md)
