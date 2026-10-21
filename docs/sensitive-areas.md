---
title: solo 敏感区速查（改码前必读）
type: core
audience: dev
status: active
tags: [敏感区, 安全网, 改码约束]
summary: 易错区速查表（26 条）+ §11.1–§11.8 详解；每条链 KNOWN-ISSUES 实证。改码前必读对应行。
updates: [src/stores/file.ts, src-tauri/src/commands/document.rs, src-tauri/src/commands/session.rs, src-tauri/src/native_resize.rs, serializer.ts, src-tauri/src/state.rs, useEditorSync.ts, registry.ts, command-names.ts, themes/manager.ts, document-scale.ts, extensions/*, editor-extensions.ts, ARCHITECTURE.md, docs/KNOWN-ISSUES.md]
---

# solo 敏感区速查（改码前必读）

> 本文件从 `ARCHITECTURE.md` §11 独立成篇：Agent 改码前**只拉这一篇**，按下表定位对应行，不必载入整篇架构总览。
> 速查表 + §11.1–§11.8 详解（含「为什么 / 改动铁律 / KNOWN-ISSUES 溯源」）。**改码前必读对应行**，不要靠记忆。
> **敏感区速查表**（原 `docs/defect-hotspots.md` 已并入此处，避免两处漂移）：改代码前先对照下表定位「易错区 → 关键文件 → 详解」。

| # | 敏感区 | 关键文件 | 详解 |
|---|--------|----------|------|
| 1 | 脏态机制（A1 语义比对） | [`src/stores/file.ts`](../src/stores/file.ts)（`setContent`/`syncEditedContent`） | §11.1 |
| 2 | 保存冲突检测 | [`src-tauri/src/commands/document.rs`](../src-tauri/src/commands/document.rs) + [`useDocumentSession.ts`](../src/composables/useDocumentSession.ts) | §11.2 |
| 3 | 序列化尾换行 | [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts) | §11.3 |
| 4 | IPC 路径 / URL 信任边界（扩展名白名单、图片资产、远程 URL） | [`src-tauri/src/commands/document.rs`](../src-tauri/src/commands/document.rs) + [`image.rs`](../src-tauri/src/commands/image.rs) + [`font.rs`](../src-tauri/src/commands/font.rs) | §11.4 |
| 5 | 启动开打竞态 | [`src-tauri/src/state.rs`](../src-tauri/src/state.rs) + [`lib.rs`](../src-tauri/src/lib.rs) | §11.5 |
| 6 | 防抖分层（字数150/光标100/大纲500/序列化500） | [`useEditorSync.ts`](../src/composables/useEditorSync.ts) | ARCHITECTURE §6.3 |
| 7 | 命令真理源（**两套，勿混**）：Tauri（Rust）命令名 vs 应用命令定义 | [`command-names.ts`](../src/services/tauri/command-names.ts)（**Tauri 命令名**，与 `lib.rs::generate_handler!` 对齐）+ [`registry.ts`](../src/commands/registry.ts)（**前端应用命令**：命令面板 / 快捷键） | ARCHITECTURE §4.2 + §9.1 |
| 8 | 主题色彩/排版注入（三层结构） | [`themes/manager.ts`](../src/themes/manager.ts) + [`types.ts`](../src/themes/types.ts) | ARCHITECTURE §10.1 |
| 9 | 多窗口进程模型 | [`lib.rs`](../src-tauri/src/lib.rs) | — |
| 10 | 构建环境 | 见 [`docs/debugging.md`](./debugging.md) + [`docs/HANDOVER.md`](./HANDOVER.md) | — |
| 11 | 字体渲染 CORS + 资源错配 | [`fontLoader.ts`](../src/services/fontLoader.ts) + [`font.rs`](../src-tauri/src/commands/font.rs) | [字体手册](./font-handling.md) |
| 12 | NodeView 事件/定时器成对清理 | [`extensions/code-block.ts`](../src/components/Editor/tiptap/extensions/code-block.ts) + [`image.ts`](../src/components/Editor/tiptap/extensions/image.ts) | §11.7 |
| 13 | 文件 vs 剪贴板两种转义模式，嵌套 state 必须继承 | [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts) | §11.8 |
| 14 | Suggestion 输入扩展门控（**`[[` 曾两度不弹**：v1.2.43 漏递扩展级 option、后又误加「无路径不弹」；现只判代码上下文；Slash/Emoji 菜单「零命中即隐藏」——互链是唯一豁免者，因其空态承载用法引导且依赖异步补数据链路）+ 拖拽落点路由（混拖让路/坐标换算） | [`editor-extensions.ts`](../src/components/Editor/tiptap/editor-extensions.ts) + [`useFloatingListMenu.ts`](../src/composables/useFloatingListMenu.ts) + [`markdown-input.ts`](../src/components/Editor/tiptap/extensions/markdown-input.ts) + [`wikilink-drop.ts`](../src/components/Editor/tiptap/extensions/wikilink-drop.ts) + [`useAppWindowSession.ts`](../src/composables/useAppWindowSession.ts) | [KNOWN-ISSUES §一 #21/#22](./KNOWN-ISSUES.md) |
| 15 | 列表容器与项类型判定（**「容器肯不肯装」直接决定内容存亡**：`bulletList`/`orderedList` 的 content 须为 `(listItem \| taskItem)+`，`taskList` 保持 `taskItem+`；容器判定须为「本层**全部**项都是任务项」且**跳过嵌套层**。任一处收紧 ⇒ `createAndFill` 失败 ⇒ `closeNode()` 静默丢弃整段。**动前先看 `schema-contract.spec.ts` 的正向契约锁**——差异集校验看不出「约束被一致地改错」）。**另半条同源铁律（2026-10-10 补）**：`createAndFill` **只校验「新节点装不装得下自己的 content」，不校验它能否放进父节点** ⇒ 任何「把节点/文本放进当前栈顶」的地方（`addNode` / `addText` / 插件 handler / 顶层 rescue）都必须自己校**放置**：块级不得落进 textblock（先 `closeNode`）、文本/行内不得落进 block 容器（先补段落）。漏一处的后果不是丢一段而是**层层放大到整篇变空**（`buildDoc` 兜底成空文档）；且**全量单测可能全绿**，只有全仓体检看得见（台账 §一 #44）。 | [`parser.ts`](../src/components/Editor/tiptap/markdown/parser.ts)（`areAllTopLevelItemsTasks` / `addNode` / `addText` / `closeNode` / `buildDoc`）+ [`editor-extensions.ts`](../src/components/Editor/tiptap/editor-extensions.ts) + [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts) | [KNOWN-ISSUES §二 #10](./KNOWN-ISSUES.md) / [§一 #44](./KNOWN-ISSUES.md) |
| 16 | mark 定界符的开**与**合都必须按嵌套语义定序（**「开启序」与「后开先关」是一对硬契约**。① **关闭**：`renderMarks` 须按**实际打开顺序**逆序遍历 `activeMarks`（该数组按打开时间追加），**不能**按 `node.marks` 数组序——后者是 schema 的 marks 定义序（`link` rank 0 早于 `italic` rank 3），错序会把外层收尾符写进内层收尾符**之前**（`*foo [bar](/url)*` → `*foo [bar*](/url)`）。② **开启**（2026-10-10 补，`sortOpeningMarks()`）：同一节点**同时开启**多个 mark 时同样**不能**按 rank 序——按「本块内该 mark 的延续终点」倒序（更晚结束＝更外层＝先开），终点相同（同范围）时 **`code` 恒排最后**（code 内容是字面量，被别的定界符包住会把对方写成字面字符）。错序的表现是**真静默**：屏幕正常、存一次才发现外层格式没了（`**[a](b) c**` → `[**a](b) c**`，且二次不收敛；`==`x`==` → `` `==x==` ``）。回归锁见 `roundtrip.spec.ts` Phase E（关闭序）+ **Phase F（开启序）**。另两处同源禁忌：`code` mark 已放开 `excludes`（须与 bold/italic 共存，别再改回 `'_'`）；（原「`renderContent` 须跳过列表项内模型补位段」**已作废**——台账 §二 #30 把 `listItem`/`taskItem` 首格放开为 `block+` 后不再产生补位段，该补丁已删除）） | [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts)（`renderMarks` / `sortOpeningMarks` / `renderContent`）+ [`editor-extensions.ts`](../src/components/Editor/tiptap/editor-extensions.ts)（`Code.extend`） | [KNOWN-ISSUES §一 #26 / #40](./KNOWN-ISSUES.md) |
| 16b | **mark 必须有 markdown 载体（`markDelimiter` 无 case ⇒ 静默吞格式，数据损失级）** | 能进生产 schema 只说明编辑器**能渲染**；能否**存住**取决于 `markDelimiter()` 有没有对应 `case`。脱节时走 `default: return ''` ⇒ **开闭都不写** ⇒ 文本在、格式静默消失，**不报错、不丢字、用户看不出已丢**（粘贴进来屏幕上有下划线，存盘后没了，他以为存好了）。**两个方向都要防**：① schema 有 / case 无 ⇒ 落default 丢格式；② case 有 / schema 无 ⇒ 僵尸分支。**新增 mark 的检查清单**：`markDelimiter()` 加 case + `parser.ts` 加对应 token handler（否则解析不回来）+ 给 UI 入口，且**语法须是别人也认的**（方言语法发出去别人打开是字面量）。**没有 markdown 载体就别进 schema**（`underline` 即此例：CommonMark/GFM 皆无下划线语法，而 solo 刻意 `html:false`）——`StarterKit.configure()` 里必须**显式 `underline: false`**，它是默认成员，漏关就漏进来了 | [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts)（`markDelimiter`）+ [`editor-extensions.ts`](../src/components/Editor/tiptap/editor-extensions.ts)（`underline: false`）+ [`mark-delimiter-coverage.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/mark-delimiter-coverage.spec.ts)（全量集合比对防线）+ [`schema-contract.spec.ts`](../src/components/Editor/tiptap/__tests__/schema-contract.spec.ts)（正向钉死） | [KNOWN-ISSUES §一 #31](./KNOWN-ISSUES.md) |
| 17 | 运行时注入 `<style>` 的库 + Tauri prod CSP nonce（**`tauri dev` 验不出**：dev 不附加 CSP，`tauri build` 才注入 nonce ⇒ `'unsafe-inline'` 被忽略 ⇒ mermaid `render()` 经 innerHTML 注入的主题 `<style>` 被静默拦截、形状回退黑色。三版才修对。**任何 lit / KaTeX 类库同坑**，解法 `dangerousDisableAssetCspModification: ["style-src"]`，`script-src` 的 nonce 保留不降级） | [`mermaid-block.ts`](../src/components/Editor/tiptap/extensions/mermaid-block.ts) + [`tauri.conf.json`](../src-tauri/tauri.conf.json) | [KNOWN-ISSUES §一 #1](./KNOWN-ISSUES.md) |
| 18 | callout NodeView 属性同步（NodeView 创建裸 `div.mk-callout` 不挂属性 ⇒ `addAttributes.renderHTML` **只作用于剪贴板/HTML 序列化、不作用于 NodeView DOM** ⇒ `data-callout-type` 从未出现在编辑器 DOM，类型配色一直失效、`::before` 标签为空。**改 callout 配色/CSS 前先确认 NodeView 已同步属性**） | [`extensions/callout.ts`](../src/components/Editor/tiptap/extensions/callout.ts) | [KNOWN-ISSUES §一 #20](./KNOWN-ISSUES.md) |
| 19 | 互链改名同步（改文件名后回写同目录文档里的 `[[旧名]]`：`rename_file` 落盘成功后扫同目录、**跳过改名后的当前文档自身**、`rewrite_wikilink_targets` 逐行**跳过 ``` / ~~~ 围栏代码块内的示例**、先 `dry_run` 列清单确认再 `atomic_write`；单文件失败静默跳过、绝不阻断改名） | [`document.rs`](../src-tauri/src/commands/document.rs)（`sync_wikilinks_on_rename`）+ [`useDocumentSession.ts`](../src/composables/useDocumentSession.ts)（`syncInboundWikilinks`） | [KNOWN-ISSUES §一 #23](./KNOWN-ISSUES.md) |
| 20 | `.tmp` 原子写残留清理（`save_document` 产生 `.{文件名}.{毫秒}.{pid}.{序号}.tmp`——PID 防双进程、序号防**同进程多窗口**同毫秒撞名，2026-10-10 补，见 KNOWN-ISSUES §一 #39；`open_document` 兜底 `cleanup_stale_tmp_files` **仅删「中间各段全为数字」且 mtime 超 1h** 的残留，避免误伤双开进程正在写的 .tmp，也避免误删用户同名文件，失败静默。**改名字格式时必须同步两处**：本表的格式串 + [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) §崩溃恢复里教用户找回文件的那一句） | [`document.rs`](../src-tauri/src/commands/document.rs)（`temp_path` / `cleanup_stale_tmp_files`） | [KNOWN-ISSUES §一 #19](./KNOWN-ISSUES.md) |
| 21 | **Windows 文件关联注册 / 注销**（`HKCU\Software\Classes` 下 `.md`/`.markdown`/`solo.markdown` 写入，末尾 `notify_shell_change()` 发 `SHChangeNotify(SHCNE_ASSOCCHANGED)` 让 Explorer 立即生效）。**两条铁律**：① **注册必须幂等** —— `notify_shell_change` 会让 Explorer 重算**全盘**图标关联，桌面上所有文件夹重绘闪动；无幂等判断时每次启动都触发（2026-10-03 已修，判据见 `association_is_current`，**exe 路径参与比对**故升级/换目录仍会重登记）。② **注销不得整键删除** —— 扩展名键下还挂着 `OpenWithProgids`（Windows 维护的「可打开该类型的程序」清单，含他人程序）、`PerceivedType` 等，只删 solo 自己写的值/子树。**读值坑**：`ShellNew\NullFile` 的值**就是空字符串**，判「是否已配」只能用存在性判断，空串 ≠ 未配。（**注册现有两个入口**：`App.vue` 的设置 watcher 与 `useAppWindowSession.setup()` 启动分支都会调 register —— 目前靠 Rust 侧 `association_is_current` 幂等兜住，重复调用不发 `SHChangeNotify`，**无用户可感缺陷**；收口到一处属整洁化，见 ARCHITECTURE §12.4） | [`desktop.rs`](../src-tauri/src/commands/desktop.rs)（`register_shell_new` / `unregister_shell_new`）+ [`useAppWindowSession.ts`](../src/composables/useAppWindowSession.ts) + [`App.vue`](../src/App.vue) | [KNOWN-ISSUES §二 #21 / #22](./KNOWN-ISSUES.md) |
| 22 | **键位 / 输入层不得假定「父块是 doc」**（2026-10-10 复审实测三例 + 2026-10-11 补第四例，全都是**静默**的：① 列表项内敲 `# 标题` —— `convertPendingHeading` 先删前缀再 `setBlockType`，而 heading 不能当 listItem 首块 ⇒ **改型 no-op、前缀已丢**（§二 #25）；② 顶层中间项行首 `Backspace` / `Mod-Backspace` / `Shift-Tab` —— 上游 `liftOutOfList` 在被提内容两侧各塞一个空 list 壳且**不做 join** ⇒ 列表劈成两段 + 中间夹一个 doc 层孤立段落，且**原样落盘、重开不变**（§二 #26）。**✅ 该族入口已全部收口：`Backspace` / `Mod-Backspace` 2026-10-10 修、`Shift-Tab` 2026-10-11 按方案 B 收口**（顶层项一律 no-op，见 §二 #55 与 `PROPOSAL-list-shifttab.md`）——此例保留是**判据的历史来由**，**不再是现存缺陷**，别再照着它去「修」一遍；③ 光标在列表**后面那个块**的行首按 `Backspace` ⇒ 该块被吸进容器并丢掉自身身份（标题降级 ⇒ 从大纲里蒸发）——**2026-10-10 用户实测定性为「正常交互」，不移除**（能精确把光标移到块首 content 位置再按退格的用户，意图就是合并；且触发门槛极低频），见 [KNOWN-ISSUES §三 设计取舍](./KNOWN-ISSUES.md)——**这条保留、不修**；④ **列表项内敲 `- ` / `1. ` / `[ ] `** —— 上游 `wrappingInputRule` 不看父块，把当前行**塞进一个新造的子列表**（想要「同级再来一行」，拿到「往里缩一级」）（§二 #59，**已修 2026-10-11**：守卫挂在 `BulletList` / `OrderedList` / **`TaskItem`** 的 `addInputRules` 上——注意 `[ ] ` 的规则本身在 TaskItem，挂 TaskList 是死代码）；**判据只有一条：动手前先问「我要改的这个块，父节点是谁」**，用 `canChangeType` / `canReplaceWith` / `canJoin` 先探，探不过就**整步不做**（而不是先删再失败——solo 的保真红线不允许任何"先改坏再说"的中间态）。同类先例：`registry.ts:284-290` 已记过一次「app 作用域 + 默认键」的双轨坑，§二 #28 是它没回头核对其余命令的余债 | [markdown-input.ts](../src/components/Editor/tiptap/extensions/markdown-input.ts):663-664 · [list-move.ts](../src/components/Editor/tiptap/list-move.ts) · [serializer.ts](../src/components/Editor/tiptap/markdown/serializer.ts):512 · 上游 @tiptap/extension-list / @tiptap/extension-blockquote | [PROPOSAL-list-structure-fix.md §十](./archive/PROPOSAL-list-structure-fix.md) |

| 23 | **ZWNJ 预处理 × 代码区占位符（解析前改写输入 ⇒ 它是「横切不变量」）**（`parser.ts` §1.5 在解析**前**往正文插 U+200C，让 markdown-it 按中文习惯判定 flanking。**两条铁律**：① **代码区必须先占位** —— 行内 / 围栏代码内容不得进 ZWNJ 判定，否则 ZWNJ 随代码原样存盘（`protectCodeRegions`；**缩进式代码块不在覆盖内**，靠序列化侧 `stripZwnj` 兜底）；② **占位符 `\u0000` 必须与 `\p{P}\p{S}` 同等对待** —— 占位前该位置是**反引号**（属 `\p{S}`），NUL 既非标点也非空白 ⇒ 会被两条 flanking 正则当成「普通字」，把 ZWNJ 错插到**闭合 `**` 之后** ⇒ **整段加粗静默消失**（§一 #35）。**守卫也必须一并改**（`ASCII_SYNTAX_PUNCT` 要含 NUL），否则 `` `a`**b `` 会从「不插」变「插」——修一个洞挖一个新坑。**③ 横切面（⭐ 契约）**：任何**读解析期产物**后要**对外呈现 / 计数 / 写盘**的地方，都必须过 `stripZwnj`。**「解析期产物」＝ 正文文本 ＋ 属性通道**（由正文衍生的 attrs：alt / title / label / target / alias / latex 等）——ZWNJ 不只存在于文本节点，也会固化进 attrs，而 attrs 的序列化**不经过** `escapeInline`（那只作用于文本节点），必须在各写出点显式剥（台账 §二 #32）。实现与常量统一在 [`zwnj.ts`](../src/components/Editor/tiptap/zwnj.ts)（**唯一来源**，别再各处写 `'\u200C'` 字面量，也别再造第二份剥离函数）。**④ 字面内容容器**：`$$…$$` / `$…$` **不在** `protectCodeRegions` 覆盖内 ⇒ ZWNJ 会插进数学源、`mathInline` 甚至落进 `attrs.latex`（**属性通道**的最早实例：attrs 序列化不过 `escapeInline`，见 ③），**并被原样写进文件**（实测 `$$a**——b$$` 中招）⇒ 已在 [math 解析入口](../src/components/Editor/tiptap/markdown/plugins/math.ts) 剥一次（入口是数学内容的唯一来源，故**不在序列化侧重复剥**）。**⑤ 覆盖清单（2026-10-10 第 3 步闭环：属性通道共 11 个写出点）**：**文本通道**——`serializer`（escapeInline / 行内码 / 围栏块）；**属性通道**（均不过 `escapeInline`）——`image` alt＋title、`link` title、`footnoteRef` label、`footnoteDef` label（**3 个写出点在取值处剥一次**）、`wikilink` target＋alias、`callout` title、math 三处入口（`attrs.latex`）；**读数点**——`serializeClipboardText`（纯文本槽）+ `getEditorWordCount`（字数）+ `extractEditorOutline`（大纲文本）+ **出站 HTML**（2026-10-11 起：[`externalize-html.ts`](../src/components/Editor/tiptap/externalize-html.ts) 的清洗组在归一末尾对**文本节点与全部属性值**各过一遍 `stripZwnj`；此前 DOMSerializer 那条路没人剥，复制正文粘到 Word 就带隐形字符）。⚠️ wikilink / callout 两处曾被疑「潜在落点」，2026-10-10 实测（**未闭合 `**`＋标点**，如 `[[a，**b]]` / `> [!note] 甲，**乙`）**当下即触发落盘**，已同批修入并有 [roundtrip Phase A4](../src/components/Editor/tiptap/markdown/__tests__/roundtrip.spec.ts) 回归锁——别再当「潜在」漏掉。**路线级备选（暂不做）**：改 markdown-it 的 flanking 规则而非改写输入 —— 更内聚，但属大重构） | [`parser.ts`](../src/components/Editor/tiptap/markdown/parser.ts)（`protectCodeRegions` / `ASCII_SYNTAX_PUNCT` / §1.5）+ [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts)（`stripZwnj`）+ [`editor-metadata.ts`](../src/components/Editor/tiptap/editor-metadata.ts) + [`externalize-html.ts`](../src/components/Editor/tiptap/externalize-html.ts)（出站 HTML） | [KNOWN-ISSUES §一 #35](./KNOWN-ISSUES.md) |

| 24 | **会话记忆一致性（最近文件 + 阅读位置）**（2026-10-13 登记）：数据落在 Rust 侧 `app_local_data_dir/session/document-session.json`，**不在 Pinia、也不在用户文档里**。三条铁律：① **多窗口并发写是「最后一次为准」**（`spawn_blocking` 串行、**故意不做跨进程锁**——这份数据不值得弹框打扰用户），别为了"更准"引入会失败就打断人的机制；② **记比例不记像素**（窗口尺寸变了像素即失效）；比例必须 `clamp(0,1)` 并丢弃 NaN/Inf，否则整个 JSON 反序列化失败 ⇒ 记忆全丢；③ **文件损坏 / 被用户手改 → 视为空状态重建，绝不报错**。已知取舍：`recentFiles` 只存路径、**不校验文件是否还在**（面板会列出已删文件，点了才失败）——要修就在**读取侧**过滤，别在写入侧加 IO。调用点有意识分散（面板直读、编辑器直写），**别在别处再造第二份会话缓存** | [`commands/session.rs`](../src-tauri/src/commands/session.rs) + [`session.ts`](../src/services/tauri/session.ts) + [`CommandPalette.vue`](../src/components/CommandPalette.vue) + [`MarkdownEditor.vue`](../src/components/Editor/MarkdownEditor.vue) | [ARCHITECTURE §12.1](../ARCHITECTURE.md) |
| 25 | **大文档分档 × IME 候选窗（`doc-heavy` ⇄ `content-visibility`）**（2026-10-13 登记）：`heavy` 档会给 `<html>` 加 `doc-heavy` 并启用 `content-visibility`，而它会**干扰 WebView2 的组字光标矩形**（IME 候选窗失锚变形；该问题 2026-09-24 已封存为「宿主行为、进程内不可达」）。⇒ **下调 `HEAVY_DOC_CHARS` 门槛 = 让更多文档暴露在已知 IME 风险下**，看似"更早优化"，实则是拿输入体验换可有可无的收益（50 万字档的实时字数实测仅 4.5ms）。**改门槛 / 改分档判定前必读** [`document-scale.ts`](../src/components/Editor/document-scale.ts) 头注释与 [IME 主题唯一入口](./archive/IME-CANDIDATE-WINDOW.md) | [`document-scale.ts`](../src/components/Editor/document-scale.ts)（定档在 [`useDocumentSession.ts`](../src/composables/useDocumentSession.ts)）＋ 消费方 `code-block.ts` / `list-fold.ts` / `paragraph-focus.ts` / `useEditorSearch.ts` / `App.vue` | [ARCHITECTURE §12.2](../ARCHITECTURE.md) |
| 26 | **Windows 原生缩放子窗（Win32 + 10 处 `unsafe`，无单测可依）**（2026-10-13 登记）：Windows 的边缘/四角缩放由 Rust 创建并维护一个 `WS_CHILD` 覆盖子窗（`WM_NCHITTEST` 直接返回 `HT*`，`WM_NCLBUTTONDOWN` 转交系统模态循环），**前端 `WindowResizeHandles` 已从 Windows 路径移除**。三条：① **`#![cfg(target_os="windows")]` ⇒ 非 Windows 上 `cargo check` 根本不编译它** ⇒ 只能靠真机验：Win + 100/125/150% 三档 DPI + 四边四角拖拽 + 双击最大化 + Aero 吸附；② **静态扫描会给出假绿灯**（v1 教训：对父窗 `SendMessage(WM_NCHITTEST)` 结果全绿，而真实鼠标命中的却是 WebView2 子窗）⇒ 别用"API 调用对了"当结论；③ 全屏 / 最大化必须**清空区域、命中穿透**（tao 会移除 `WS_SIZEBOX`），漏了会出现"最大化后仍能拉边"的幽灵热区 | [`native_resize.rs`](../src-tauri/src/native_resize.rs)（Windows only）＋ [`App.vue`](../src/App.vue)（模板 `v-if="!isWindows"`） | [ARCHITECTURE §12.3](../ARCHITECTURE.md) |

### 11.1 脏态机制不可随意改动（A1 语义比对模型）

`file.ts` 的 `setContent()`（仅同步基线，不标脏）与 `syncEditedContent()`（语义比对为唯一脏真相源）分离是**有意的**（见 ARCHITECTURE §7.1）。编辑器加载后立即 `setContent(serializeMarkdown())` 建立**规范化基线**，消除 parser/serializer 归一化差异导致的假脏态。

**改动铁律**：
- 不要把基线写回（程序性）误判为脏——必须用 `syncEditedContent` 的语义比对，而非 `hasUserEdit` 式标志。
- 不要在 `syncEditedContent` 里对 `normalizedNew === normalizedBase` 分支做任何"标脏"动作，否则 Mermaid 后台事务会误标脏、拖入图片会漏标脏。
- **动了它就会重新引入脏态闪烁。**

### 11.2 保存冲突检测在 Rust 侧

`save_document(path, content, expected_last_modified_ms, force)`：
- 非 force 时对比传入的 expected mtime 与磁盘当前 mtime，不符 → 返回 `AppError::Conflict`（code `document_conflict`）。
- 前端 `useDocumentSession` 收到 conflict → 弹"强制覆盖"确认 → 递归调用（先释放 `isSaving` 锁防死锁）。
- `atomic_write`：先写 `.tmp` 再 `rename`，跨平台原子覆盖（Windows 用 `MoveFileExW` + REPLACE，**不做先删后改名**以免引入竞态窗口）。

### 11.3 序列化总是规范化尾换行

`serializeMarkdown()` 强制输出**恰好一个**尾换行。roundtrip 测试同样规范化预期值。**"多了一个换行"先查 serializer，别改测试。**

### 11.4 IPC 路径 / URL 信任边界

前端传入的路径与 URL **不可直接采信**：恶意文档内容（如构造的 `image src`）能诱导命令越权读写文件或向内网发请求。当前闸门：

- **扩展名白名单**（`validate_document_extension`，大小写不敏感）：读 `md/markdown/txt`（与 `lib.rs` 的 `supported_open_path` 同源，新增可编辑类型两处都要改）；写多一个 `json`——「导出主题模板」复用 `save_document` 写 `.json`。本地绝对路径本身是合法用例（用户引用 `D:/docs/x.md`），故**只卡扩展名，不做目录约束**。
- `validate_image_asset_path`：先 `canonicalize`（解析符号链接/`..`）再校验 `is_file` 与扩展名，**防 `evil.png → /etc/passwd` 绕过**。只在 8 种图片扩展名白名单内放行（`png/jpg/jpeg/gif/webp/svg/bmp/ico`；v1.2.27 从 6 种扩到 8 种补齐 `.bmp/.ico`，此前文档写「6 种」已滞后）。`import_document_image` 的 source 也走它，防止把任意文件拷进资产目录。**这 8 种是三处硬编码**——Rust `IMAGE_EXTENSIONS`、前端 `editor-image-drop.ts` 的 `supportedImageExtensions`、Rust `mime_to_extension` 的返回值必须一致，否则会出现「能保存但显示失败」（`.bmp/.ico` 当初就是这么踩到的）。
- `validate_remote_image_url`：限 http/https + 拦截**字面量**内网主机（回环/私有/链路本地/组播、`localhost`/`.local`/`.internal`、云元数据 `169.254.169.254`，含 IPv4 内嵌 IPv6 形式）。
- `validate_font_url`：限 https，**刻意不做主机白名单**——GitHub release 会 302 跳到 `objects.githubusercontent.com`，白名单会打断下载（字体链路有「连修四版才修对」的历史，不再引入新失效面）。

**改动铁律**：
- **校验什么就请求什么**——校验后必须用规范化 URL 建请求（含 `Referer`），不能拿原始输入去 fetch，否则校验形同虚设。
- 缓存 key 仍哈希**原始输入**，避免加固后既有 `remote-image-cache` 全部失效。
- 残留风险（DNS rebinding：域名解析后指向内网）见 [`docs/KNOWN-ISSUES.md` §二 #5](./KNOWN-ISSUES.md)。

### 11.5 启动开打是竞态敏感的

`StartupOpenRequests` + `PendingWindowPaths` 两层缓冲（`LoadedWindows` 为已加载窗口登记，不属缓冲层；见 ARCHITECTURE §4.5）。动启动事件顺序前务必理解 `startup_ready` 的分支。

### 11.6 真理源自一处

- 命令名只在 `command-names.ts` 登记。
- 命令定义只在 `registry.ts`。
- 字体清单只在 `fonts.ts`，字体栈只在 `fontStack.ts`。
- 主题色彩映射只在 `types.ts::CSS_VAR_MAP`：**任何要跟随主题切换的颜色，必须同时在 `ThemeColors` 接口与 `CSS_VAR_MAP` 登记，禁止只在 `main.css` 写死某个颜色**——否则切预设主题时该色不随主题变化（参考 2026-07-21「状态栏未保存指示不随主题」bug：当时的 `--dirty-color` 漏登记导致始终回退书卷气默认值；**该 token 已于 2026-10-13 移除**，「未保存」指示改走 `--primary-color`）。
- **设计体系规则（2026-08-21 确立，全格式覆盖）**：solo 之内的一切视觉颜色都必须来自主题 token（`--*` CSS 变量），**按产品设计定义，不按依赖关系**——外部依赖（highlight.js / mermaid / KaTeX 等）只要渲染在 solo 界面内，其颜色同样必须走 token 映射，禁止加载外部主题或硬编码色值：
  - 主题三层结构：范式（token 全集，`types.ts::CSS_VAR_MAP` + `editor.css :root` 排版默认 + `manager.ts::SHARED_LIGHT/DARK_COLORS` 共享默认）→ 实例（8 个 preset JSON，只写性格 token）→ 消费（渲染层只引用 `var(--x)`）。
  - 代码语法高亮：`editor.css` 的 `.hljs-*` → 主题 token 映射（**禁止**加载 highlight.js 外部配色，见 `useEditorAppearance.ts`）。
  - Mermaid 图表：`mermaid-block.ts::buildMermaidConfig` 用 `getComputedStyle` 读当前主题 CSS 变量注入 `themeVariables`（theme: 'base'，**禁止** mermaid 内置 default/dark 主题与硬编码提亮）。
  - 新增任何"带颜色的格式"时先回答：它的颜色进 token 全集了吗？进不了就拒绝实现或收编。
  - 主题 JSON 只允许存在"性格差异"字段，共享值（radius/功能色/markBg/遮罩/幽灵按钮）一律进共享默认层（SHARED_LIGHT/DARK_COLORS），禁止复制进各主题。

### 11.7 NodeView 事件与定时器必须成对清理

NodeView 的 `dom` 由 ProseMirror 直接增删，**不走 Vue 的生命周期**，所以 `addEventListener` / `setInterval` / `setTimeout` 没有任何东西替你收尾——节点销毁后监听器和整条闭包仍存活，频繁增删同类节点的长会话会线性积累内存与幽灵回调。

**仓库统一套路**（`AbortController`，勿另发明）：

```ts
const eventController = new AbortController();      // 建 DOM 时先声明
el.addEventListener('click', onClick, { signal: eventController.signal });  // 每个监听器都带 signal
destroy() {
  eventController.abort();                           // 一次摘掉全部监听
  if (timer) clearTimeout(timer);                    // 定时器不在 signal 管辖内，单独清
}
```

现役实现：[`code-block.ts`](../src/components/Editor/tiptap/extensions/code-block.ts) / [`image.ts`](../src/components/Editor/tiptap/extensions/image.ts) / [`math-block.ts`](../src/components/Editor/tiptap/extensions/math-block.ts) / [`mermaid-block.ts`](../src/components/Editor/tiptap/extensions/mermaid-block.ts)。回归锁：[`extensions/__tests__/nodeview-destroy.spec.ts`](../src/components/Editor/tiptap/extensions/__tests__/nodeview-destroy.spec.ts)。

**易漏的第二半**：销毁后的**异步回写**也要守卫。图片 src 解析是异步的，`requestId` 闭包变量活在同一个已销毁的闭包里、晚到的响应仍会自匹配——**单靠 requestId 挡不住**，必须额外查 `eventController.signal.aborted` 再碰 DOM。

### 11.8 剪贴板 text/plain 产出 + 两种转义模式

**text/plain 放什么**由 `serializeClipboardText()`（[`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts)）决定，照 Typora 范式：

- 选区**只含文本型内容**（`PLAIN_TEXT_SAFE_NODES` 白名单：段落/标题/引用/列表/任务列表/代码块/表格/分隔线）→ 给**渲染后的干净文字**，去掉标记、不补反斜杠。
- 选区**含 solo 专有节点**（公式 / 图表 / 互链 / 脚注 / frontmatter / callout / 图片）→ **回落 Markdown 源码**，因为这些语法在纯文本里没有等价表达。

**链接是 mark 不是节点**，因此不触发回落：`[百度](url)` 在纯文本槽里给 `百度`。这与浏览器一致（`text/plain` 的定义就是「字符、无标记」——选中带链接的文字粘到代码编辑器同样是超链接消失、只剩文字），也照 Typora 范式。要网址有两个出口：富文本目标（Word / 微信 / 公众号）读 `text/html` 槽、网址本就在且可点击；纯文本目标按 `Mod+Shift+M` 取源码。

「图片回落、链接不回落」的分界**不是双标**：图片去掉标记只剩 alt（常为文件名或空，无意义），纯文本里没有合格替身；链接去掉标记就是人写的显示文字，有合格替身。

白名单是**退化安全**方向：将来新增扩展节点默认回落，绝不会因为忘了登记而在纯文本槽静默丢内容。

- `text/html` 有**两个入口，共用同一个出站归一层**（2026-10-21 起）：
  - **整篇（「复制全文」按钮）**：`clipboard-html.ts::serializeDocumentHtml()` → `DOMSerializer` → `externalize-html.ts` 档位 `document`。删**全部** frontmatter、拆 `div.tableWrapper`——整篇出站不回读，拆掉布局壳 Word / 公众号才好排版。
  - **选区（`Ctrl+C` / 右键复制）**：`editorProps.clipboardSerializer = createSelectionClipboardSerializer()` → 同一个 `DOMSerializer` → 同一个归一层，档位 `selection`。**只删「第一块」frontmatter**（用户复制整篇去公众号的动作是 Ctrl+A → Ctrl+C，frontmatter 必然被选中，不删就会在文章顶部显示一段 YAML；从中间选一段时它不在选区里，规则不误伤），**永不拆 tableWrapper**（拆了顶层节点身份就变，而 `data-pm-slice` 是 PM 在归一层返回之后才打在第一个顶层元素上的，标记会落错）。
  - **「顶层节点身份不变」只对 `selection` 档位成立**——这是「粘回 solo 不走形」的硬约束（`externalize-selection.spec.ts` C 组锁）；`document` 档位有意改变顶层结构，代价是不回读。
  - [`utils/markdown-to-html.ts`](../src/utils/markdown-to-html.ts) 已降为**无编辑器时的回落**（图片预览模式下编辑器被卸载），回落产出仍带 callout / 互链 / 数学的裸标记失真。**solo→solo 粘贴走 HTML + 各扩展的 `parseHTML`，不依赖 text/plain**。
  - callout 标题出站时**属性与正文双写**：正文那段带 `data-solo-injected-title` **来源标记**，回读由 `markdown-paste.ts::stripInjectedCalloutTitles` 只删带标记的节点。**判据必须是来源标记，不能是「首段是加粗且文字等于标题」**——用户自己写的那一段在节点层完全同形，靠内容猜会把合法正文当标题删掉（静默丢内容，复审 Critical）。图片 `src` 解析优先取 `data-src`，规则见 `image.ts::pickImageSrc`。`<pre>` / 行内 `<code>` 会补内联的 `white-space` + `font-family`（**不带颜色**：跟主题走会把深色主题的黑块带进白底文章，写死又违反「不硬编码颜色」）。
- ⚠️ 归一层的三条铁律（CP-20261011-002）：**不换私有节点的标签名、不删私有属性**（`li[data-type="taskItem"]`、`sup[data-footnote-ref]`、`span.mk-dim` 等正是 `parseHTML` 的命中面，删了「复制出去再粘回来」就降级）；**空串属性不删**（`footnote.ts` 把 `data-footnote-ref` 渲染成空串，判据只看「在不在」）；**不往内容规格装不下的壳里塞元素**（`FootnoteSection.content = 'footnoteDef+'`、`MermaidBlock.content = 'text*'`，塞进去 PM **不报错**而是把外壳静默闭成空壳）。⇒ 新增扩展节点时，除了验 `renderHTML` 的产出，还要问一句「归一层要不要加规则」。
- 需要主动拿 Markdown 源码时用命令 `edit.copyAsMarkdown`（Mod+Shift+M / 命令面板），它复用下面的剪贴板轻量转义。

`escapeInline` 按 `clipboard` 标记分两套转义，两者**故意不同，别互相"修正"**：

| 模式 | 入口 | 行内转义集 | 行首额外转义 |
|---|---|---|---|
| 文件落盘（严格） | `serializeMarkdown()` | `` ` [ ] ( ) * ~ ^ = \| $ < > { } `` | `# + - .` |
| 剪贴板（轻量） | `serializeMarkdownForClipboard()`（经 `serializeClipboardSlice`：回落路径 + `edit.copyAsMarkdown`） | `` ` * ~ [ ] < > `` | `# + - . > =` |

**改动铁律**：块处理器需要**嵌套序列化**（引用块内部、表格单元格文本）时，必须用 `state.createChild()` 拿内层 state，**不要 `new MarkdownSerializerState()`**——默认构造是文件模式，会把外层 clipboard 标记丢掉，导致粘到外部编辑器的内容多出 `\=` `\$`。只有上面两个真入口允许直接构造。

另一处坑：表格的**列宽统计**与**内容输出**必须调同一个 `cellToText(state, cell)`，否则 `padEnd` 对齐用的长度与实际写入的字符串不是同一份，表格会错位。

---
