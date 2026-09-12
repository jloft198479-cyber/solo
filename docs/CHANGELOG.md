---
title: Changelog
type: core
audience: maintainer
status: active
tags: [核心文档, 版本史, 发布]
summary: 版本变更史唯一真理源（由真实 git log 整理，发版必更新）
updates: [package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json]
---

# Changelog

All notable changes to **solo** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

> 本文件由真实 `git log` 整理而成（非臆想）。更早的 v1.1.x 历史可在仓库提交记录中查阅。
> 每个版本的权威测试数量以 `bun run test` 实际输出为准，本文不硬编码数字。

---

## [Unreleased]

### Added
- **命令「复制为 Markdown」（`edit.copyAsMarkdown`，默认 Mod+Shift+M，命令面板可搜）**：把选区（含剥开口层）以 Markdown 源码写入剪贴板，供粘到 Obsidian / Typora 等外部 Markdown 编辑器。刻意**不占用 Mod+Shift+C**（已是 `editor.codeBlock` 的默认值）；命令**作用域定为 app**——窗口级快捷键分发器对「editor 作用域 + 默认快捷键」的组合一律跳过（假定由 ProseMirror 内置 keymap 处理），本命令没有对应的 PM 绑定，标 editor 会让快捷键在编辑区内按不动。

### Changed
- **复制默认产出改为「干净纯文本」（剪贴板范式改造，照 Typora）**：`text/plain` 不再无条件塞 Markdown 源码——选区只含文本型内容（段落 / 标题 / 引用 / 列表 / 任务列表 / 代码块 / 表格 / 分隔线）时给**渲染后的文字**（`## 标题` 粘出去就是 `标题`），只有含 solo 专有节点（公式 / 图表 / 互链 / 脚注 / frontmatter / callout / 图片）才回落 Markdown 源码（这些语法在纯文本里没有等价表达，回落优于静默丢内容）。判定用**白名单 + 退化安全**：新增扩展节点默认回落，不会因漏登记而静默丢内容。
  - 粘到微信 / Word / 公众号 / 记事本 / 搜索框不再出现 `a\*b`、`\#井号`、`\[重点\]` 一类转义噪音。
  - **不受影响**：`text/html`（富格式目标）仍由 ProseMirror 默认生成；solo→solo 粘贴走 HTML + 各扩展 `parseHTML`，不依赖 `text/plain`；**文件落盘序列化一行未动**。
  - 证据：19 份 roundtrip 夹具在改动前后各跑一次整篇「解析 → 序列化」快照，**逐字节 diff 为空**（4503 → 4503 字节）；两次快照确系不同代码版本（改动前那次日志中 `serializeClipboardText` 输出「函数不存在」）。

### Fixed
- **复制路径反斜杠被无条件翻倍**：`G:\skills-pi\x` 复制出来变 `G:\\skills-pi\\x`。`escapeInline` 里的 `text.replace(/\\/g, '\\\\')` 改为 `escapeBackslashes()` **逐字符判定**，仅「`\` + ASCII 标点」与「行尾 `\`」补转义（markdown-it 实测：`\` 后跟字母 / 数字 / 中文不是转义序列，无需补）。**行为变化**：磁盘上已存成 `\\` 的老文件重开保存会归一化成 `\`（语义等价）。
- **文中出现 `:\` 就弹「没有匹配的表情」**：Emoji 触发符的 URL 上下文守卫只认 `http/https/ftp/file/mailto/tel`，漏了 Windows 盘符，叠加 `allowedPrefixes: null` 使 `G:` 必触发、`:` 后整条路径被当搜索词。新增两条守卫：`:` 后紧跟 `\`、`:` 前是单字母盘符，均不唤出菜单。

---

## [1.2.53] — 2026-09-12

### Added
- **改名后自动更新「指向本文档」的互链**（解决 `[[ ]]` 双链改名断链 / 显示旧名，KNOWN-ISSUES §一 #23）：在标题栏改文件名并保存成功后，新增 Rust 命令 `sync_wikilinks_on_rename` 扫描**同目录**可编辑文档，把其中 `[[旧名]]` / `[[旧名|别名]]` 的目标段精确改成新名（别名段原样保留，覆盖带/不带 `.md` 两种写法）。落地保守：先 `dry_run` 只读预览、前端列出将被改动的文档清单让用户确认，**确认后才逐文件 `atomic_write` 改写**；单个文件读/写失败静默跳过，任何情况都不阻断改名主流程。`[[近名]]`、普通 `[文字](链接)`、子目录内文件均不受影响。跨窗口若有别的窗口正开着被改的文件，靠既有的「文件已被外部修改」提示与保存冲突检测（mtime 乐观锁）兜底，不新增机制。**审查强化（2026-09-12）**：扫描**跳过改名后的当前文档自身**；限流按**已扫描文档数**（真正兜底病态大目录）；逐行处理、**跳过 ``` / ~~~ 围栏代码块**内的示例；前端同步移到 `isSaving` 保存锁**之外**（弹框确认期间不再挡"另存为"）。回归锁 9 条（`cargo test --lib wikilink`）+ 前端 happy-path 测试。**刻意不做 / 已知限制**：不做跨目录 / 全盘 / 反向链接面板 / 链接跟随正文标题；只覆盖同目录、裸名与 `.md`（手打或粘贴的 `[[子/文]]`、`[[x.markdown]]`/`[[x.txt]]` 不覆盖），缩进/行内代码内的示例不保护。方案与边界见 [互链改名同步方案](./archive/solo互链改名同步方案-2026-09-11.md)。**链路验证（2026-09-12，CDP 探针）**：「改名 → 弹框列清单 → 点一并更新 → 实际落盘」全链路实跑通过——实测裸名与带别名均正确替换（别名段保留）、无关链接与围栏代码块不动、自链因「排除自身」不动、apply 后状态提示正确；行内代码内的示例被改属本段已声明的已知限制。弹框为系统原生窗口（webview 之外），本次以沙盒 Vite transform 劫持 `confirm` 完成驱动，**弹框原生观感仍建议人工过一眼**（方法见 [debugging §1.1](./debugging.md)）。

### Changed
- **CI 门禁补全**：`test.yml` 新增 `bun run lint` 与 `cargo test` 两步——Rust 侧 78 条回归锁与 ESLint 此前只在开发者本机生效，现在进 CI。（随本次依赖维护一并落地。）

### Fixed
- **ESLint 存量 6 个 error 清零**（此前 lint 从未进 CI，故一直未暴露；补 `bun run lint` 后会一推就红，故先修）：`parser.ts:47` 的 `no-control-regex`（`\u0000` 是成对使用的占位哨兵，属**故意**控制字符，加内联豁免并写明理由，**不改逻辑**）；`mermaid-block.ts:250` 的 `no-irregular-whitespace`（全角空格 U+3000 以字面量写入正则，改写为 `\u3000-\u303F` 转义，13 份样本验证逐字等价）；`markdown-paste.ts:172` 的 `no-useless-escape`（字符类内 `\$` → `$`，类内 `$` 无特殊含义，语义等价）；`commonmark.spec.ts` 补 `{ cause }` ×2；`paragraph-focus.spec.ts` 改 `prefer-const`。**全部为语义零变化**，改后 1289 条测试与类型检查均通过。

### Security
- **运行时依赖安全升级（`bun audit` 20 → 10 漏洞，运行时包零残留）**：只升「会随安装包发布」的运行时依赖，**不改一行业务代码、不改任何行为**。
  - `@tiptap/*` 3.27.1 → **3.31.3**：修掉 **Markdown 块级/行内属性解析的二次复杂度 ReDoS**（GHSA-j95f-988m-3j2f）——正中 solo「接住从别处复制来的内容」的主路径；另修 `mergeAttributes()` 把 `__proto__` 键转成可执行 DOM 属性（GHSA-cp6q-959q-f8rh）。
  - `mermaid` 11.15.0 → **11.17.2**、`dompurify` 3.4.11 → **3.4.15**（修 hook 残留可执行子树致 XSS）、`linkify-it` 5.0.1 → **5.0.2**（修 `mailto:` 校验器二次复杂度 DoS）。
  - **刻意不跨大版本**：`mermaid` 最新为 12.0.0、`linkify-it` 最新为 6.1.0，均**只升到修复版**，不引入破坏性变更。`dompurify` / `linkify-it` 为传递依赖（经 mermaid / markdown-it），与 `prosemirror-model`、`prosemirror-view` 一并通过 `package.json` 的 `overrides` 钉死版本。
  - 剩余 10 个漏洞全部位于构建 / 测试 / lint 链路（`postcss`、`nanoid`、`brace-expansion`、`vitest`、`esbuild`），**不进安装包**，按「稳定期收敛维护」原则本次不动。
- **格式兼容性实测（逐字节）**：升级前后对 **19 份 roundtrip 夹具 + 1 份覆盖全节点类型的综合样本**跑同一份「解析 → 序列化」探针，**20/20 输出完全一致、0 差异**——依赖升级没有改变任何 Markdown 的解析与序列化结果。
- **升级途中修掉的依赖去重故障**：Tiptap 升级后 bun 沿用旧 lock 的解析、未重新 dedupe，导致 `prosemirror-model` 顶层 1.25.11 与 8 个嵌套 1.25.9 副本并存（`prosemirror-view` 同病：1.42.3 vs 5×1.41.9），触发 ProseMirror 的 `RangeError: looks like multiple versions of prosemirror-model were loaded`——**表现为粘贴富文本直接崩溃**，并伴随 `vue-tsc` 13 个类型错误。修法：`overrides` 钉死单一版本 + `bun install --force` + 清理 `--force` 未清干净的残留副本，嵌套副本归零；再跑 `bun install` 确认不会重建。
- **验证**：单元测试 **1289/1289**、`vue-tsc --noEmit` 0 错误、`eslint` 0 错误、`vite build` 通过；并在真实运行的应用内用 CDP 探针打开全节点样本，确认标题层级 / 粗斜删高亮 / 嵌套列表 / 任务框 / 引用 / 三种 Callout / 表格 / 代码高亮 / 行内与块级公式 / mermaid 图 / 互链 / 脚注**全部正常渲染**。

## [1.2.52] — 2026-09-11

### Fixed
- **拖入文档在正文空白处完全无效**（v1.2.51 回归，用户实测报障）：「在不在正文内」原先按 `elementFromPoint` 是否命中 **ProseMirror 内容根**（`view.dom`）判定，而空文档的内容区只有一行高（实测 584×27），视觉上的"正文区"（滚动容器 703×774）几乎整片被判成"纸外" → 必然回落「打开」，表现就是"拖进去变成打开了被拖的那篇"。修复：改为按**编辑器可视区**（`editorWrapRef` 滚动容器）判定归属，`posAtCoords` 在留白处取不到精确位置时按纵向贴到**文档末 / 首**。标题栏、状态栏、大纲栏仍被正确排除。**验证**：在真实运行的应用内用 CDP 合成 `tauri://drag-drop` 事件跑通全链路（事件层 → 窗口层 → 编辑器），文字行 / 正文中部空白 / 正文下方空白均成功插入，标题栏 / 状态栏 / 拖自身 / 跨目录 / 拖图片均正确回落。

- **代码块 / 行内码被注入不可见字符（零宽非连接符 U+200C）**：CJK 边界预处理在 `md.parse` 之前对**整篇原文**插 `\u200C`，未排除代码区；而序列化只在 `escapeInline`（普通文本）剥离，行内码走 `child.text`、代码块走 `textContent` 原样写出 → 含「中文标点 + `**`」组合的代码保存后混入肉眼不可见的脏字符，外部编辑器 / 版本比对时现形。修复：预处理前把围栏代码块与行内 code span 占位保护（替换后还原，代码内容逐字保真），序列化侧对代码内容一并剥离 ZWNJ，顺带清洗存量已污染文档。**回归锁**：`roundtrip.spec.ts` Phase A3 五条，其中两条直接断言「解析后的 doc 不含 ZWNJ」——只测往返会被序列化侧的剥离兜底掩盖（实测确认：去掉保护后，仅往返断言仍全绿、doc 断言才转红）。
- **大纲侧栏「当前段落高亮」在刚打开文档时可能永久失灵**：`attachScroll` 取不到编辑器视图时直接 `return` 且无重试，而它只有 onMounted / editorRef 变化两个 `nextTick` 触发点——编辑器是 rAF 懒建的，微任务早于 rAF，那一刻 view 必为 null，此后 editorRef 不再变 → 滚动大纲永不跟高。修复：编辑器建好后派发 `solo:editor-ready` 信号，大纲监听后重挂；`attachScroll` 加「容器未变不重挂」守卫，避免重复监听。
- **斜杠菜单按 Esc 会顺带退出焦点模式**：Emoji / Wikilink 的 Esc 都 `stopPropagation`（注释亦如此声明），唯独 Slash 漏了，事件冒泡到 window 触发 `toggleFocusMode`。修复：补齐，并修正两处「与 Slash 一致」的过期注释。
- **打印时 mermaid / 公式块仍带编辑态灰条与标签**：`@media print` 里写的是 `.mk-mermaid-delete` / `.mk-math-delete` 两个**代码中不存在**的类名（真实类为 `.mk-block-delete-button`、`.mk-mermaid-header`、`.mk-mermaid-badge` 等），失配导致灰条、标签、删除/缩放按钮照常打印。修复：改用实现侧真类名，并补齐代码块语言 / 复制按钮。
- **roundtrip 测试用「镜像 schema」，与生产两处并行维护**：测试 schema 的 table cell 缺 colspan/rowspan/colwidth、image 缺 width/height，相关往返「静默通过」给假绿灯。修复：属性与生产对齐（`extensions/table.ts` / `extensions/image.ts`），补 `![alt|100x200](src)` 尺寸往返回归。

## [1.2.51] — 2026-09-11

### Added
- **拖入同目录文档即在落点处生成互链**（方案 B·看落点，一期）：把 `.md`/`.markdown` 拖进**正文内**且与当前文档**同目录**、当前文档已保存时，在**松手处**插入一条 `[[链接]]`（`view.posAtCoords` 反查落点 → `insertContentAt`；落点取不到即回落「打开」）；落在正文外 / 跨目录 / `.txt` / 未保存 / **拖当前文档自身** / 落点在代码块内 → 维持原「打开」行为（安全默认，误判非破坏、可撤销）。决策为纯函数 `wikilink-drop.ts::decideDocumentDrop`（返回 `insert | fallback` 两态，各分支均有单测）。**未做（守一期范围）**：子目录递归、跨盘绝对路径、悬停提示、vault。⚠️ 拖拽落点**跟手性未真机验证**（坐标系已据 wry 0.55.1 源码确认：相对 webview 内容区左上角的物理像素、不含标题栏 → `÷devicePixelRatio` 与 `elementFromPoint`/`posAtCoords` 同源）；误判一律回落「打开」。

### Fixed
- **拖当前文档自身会生成一条指向自己的死链**：两条入口口径不一致——`[[` 补全明确排除自身（`filterWikilinkCandidates` 比文件名），拖入却直接成链。修复：`decideDocumentDrop` 归一化路径后排除自身（分隔符混用、重复分隔符都能识别；仅大小写形式不同仍按不同文件处理，宁可放过不误链）。
- **光标在代码块内拖入 `.md` 会插出无效互链**：`[[` 补全的 `allow` 有 `!editor.isActive('codeBlock')` 守卫，拖入路径无同类检查，只能靠 schema 兜底、插入位置不可预期。修复：落点解析在 `codeBlock` 内则回落「打开」。
- **「可打开文档」扩展名判定曾写三处**：窗口层 `useAppWindowSession` 与图片拖入 `editor-image-drop` 各自内联 `/\.(md|markdown|txt)$/i`，与 `wikilink-drop.ts` 的 `DOC_EXT` 是同一事实。修复：导出 `isDocumentPath` 单一定义，三处共用（AGENTS §一 SSOT）；`DropDecision` 同时收窄为 `insert | fallback`，删掉从未被读的 `path` 字段。
- **敲 `[[` 弹不出文件候选**（自 v1.2.43 起对所有保存状态永久失效）：`WikilinkSuggest` 的 `allow` 门控读扩展级 `this.options.getDocumentPath`，但 `WikilinkSuggest.configure(...)` 只传了 `suggestion`、漏传扩展级 `getDocumentPath` → 恒为默认 `()=>null`。修复：configure 顶层补接线；`editor-extensions.spec.ts` 加「接线生效」回归锁（零件测试测不到这类漏递）。整串 `[[x]]` 与单击跳转本不受影响。
- **敲 `![说明](路径)` 被链接直输吃成 `!` + 半条链接**：`convertPendingLink` 的 `linkInputRegex` 无 `!` 前缀判别，匹配 `[说明](路径)`（index=1）后把"说明"转链接、残一个光秃秃 `!`。修复：`[` 前紧邻 `!` 则跳过（与 `suggestion-guard.ts` 对 `![[` 的守卫同款）；`markdown-input.spec.ts` 加回归（图片语法保持字面、普通链接不误伤）。

## [1.2.50] — 2026-09-07

### Fixed
- **单元格内复制文字粘出整张 GFM 表格（#16 第二层根因）**：v1.2.43 只压平了 CellSelection 的 text/html，text/plain 管道没动——格内双击选中「剪映」两个字复制，粘到纯文本目标（聊天框/VSCode）变成 `| 剪映 |\n| ---- |`。真根因：`serializeClipboardSlice` 用 `doc.copy(slice.content)` 序列化选区 slice，丢掉了 PM 的开口（openStart/openEnd）标记——选区落在表格内时 slice 的 table/row/cell 都是「部分包含」的开口容器，被序列化器当闭合节点整段渲染；引用块/列表内选字同理带出 `>`/`- ` 标记。修复：序列化前经 `stripOpenLayers` 剥开口层，只序列化完全包含的内容（table 系容器因 `nodeSerializers` 空 handler 无法独立渲染、随时剥；语义容器按开口计数剥；停在 textblock——顶层 inline 会被 renderContent 输出为空）；闭合 slice（整篇/NodeSelection 选区）原样保留，扩展语法标记不丢。CellSelection 的 text/plain 同步压平为 TSV（与 text/html 同源）。行为变化：引用块/列表**内部**选字复制不再带 `>`/`- ` 前缀（与 PM 原生 text/plain「选什么粘什么」对齐），整篇/跨格选区的 Markdown 出站保真不变。回归锁：`clipboard-serializer.spec.ts`「开口 slice 剥层」7 条。

## [1.2.43] — 2026-09-06

### Fixed
- **断电时保存的文档可能整文件截断（atomic_write 无 fsync）**：`create(tmp) → write_all → rename` 全程未调用 `sync_all()`——断电/内核崩溃时 rename 的元数据可能先行持久化而数据块尚未落盘，唯一文档副本整文件截断或半新半旧（tmp 已被 rename 走，旧数据无法恢复）；自动保存最短 5s 一次直写真实文件，风险敞口持续存在。修复：tmp 写完 `sync_all()` 再 rename（保存低频，毫秒级代价可接受）；Unix 上再 fsync 父目录确保目录项变更持久化（Windows/NTFS 元数据有日志保护且 std 无目录 fsync 入口，无需此步）。
- **切图片查看模式静默丢最后一次编辑**：查看模式用 `v-if` 卸载编辑器，而 `onBeforeUnmount` 对挂起序列化是**取消**（`cancelPending`）而非执行——最后一次击键距卸载不足 500ms（防抖窗口）且 rIC 未跑时，编辑既不入 store 基线又随 doc 销毁丢失，切回按旧基线重建。修复：`useEditorSync` 新增 `flushPendingSerialize`（已同步时跳过，不为卸载引入多余序列化），`MarkdownEditor` 卸载链路在 `editor.destroy()` 之前冲刷挂起序列化写回 store。补回归锁（含 cancel 先跑、flush 后跑的真实卸载顺序）。
- **图片 alt/路径行内编辑入口死锁**：`.mk-image-source-text` 默认 `display:none`，仅 `.is-editing` 时显示，而 `is-editing` 只由该元素 focus 事件添加——不显示就无法聚焦、不聚焦就永不显示，改 alt/路径只能改源码。修复：NodeSelection 选中或 hover 图片时即显示 sourceText 编辑入口（`image.ts` 选中/悬停/失焦三态同步 `is-editing`）。
- **表格没有「删除整表」入口**：右键菜单只有 7 个行列操作，逐行删到剩一行时 `deleteRow` 拒删（prosemirror-tables 单行保护），表格删不掉——复刻 Mermaid「能创建不能删除」教训。修复：右键菜单 + 命令注册表补 `deleteTable`（`can()` 为真时启用）。
- **Emoji 建议（`:` 触发）中文场景失效**：Suggestion 默认 `allowedPrefixes=[' ']` 只允许空格/行首前缀，中文后输入 `:微笑` 不弹菜单（Slash 已修、Emoji 漏修的同类坑）。修复：显式传 `allowedPrefixes: null`，契约测试锁死三个触发器（Slash/Emoji/Wikilink）。
- **焦点模式开着时 Esc 被全局劫持**：关 Slash 菜单 / 退出 Mermaid·Math 编辑 / 关右键·气泡菜单等内层 Esc 同时把焦点模式退出了（内层 handler 均 preventDefault 但不 stopPropagation，事件冒泡到 window 触发 toggle）。修复：内层 Esc 统一 `stopPropagation`（对齐 SearchPanel 既有正确写法）。
- **Slash 菜单在代码块与 URL 中误触发**：代码里敲 `// 注释`、`https://a.com` 会弹命令菜单，此时按 Enter 会执行命令把代码/URL 文本替换掉。修复：Suggestion `allow` 守卫——代码块/行内代码内不弹（Emoji 此前已有、Slash 漏加，本次补齐；URL 场景由 `/`、`:` 前缀守卫覆盖）。
- **选区气泡菜单不随滚动/窗口缩放更新**：BubbleMenu 用 fixed 定位但只挂 onSelectionUpdate 一个刷新入口，滚动/缩放后与选区脱节并遮挡正文。修复：编辑器滚动容器 + window 挂 scroll/resize 监听重算位置（passive scroll，卸载时同步移除）。
- **表格右键菜单依赖「光标已在表格内」**：光标在表外段落时直接右键表格不弹菜单（PM 右键不移动光标）。修复：用 `view.posAtCoords` 反查右键坐标是否落在表格节点内，命中即弹菜单。
- **Ctrl+F 完全无响应**：webview 无原生查找兜底，而查找绑定在 Mod+G 与「跳转到行」心智冲突。修复：默认快捷键改 Mod+F（保留自定义覆盖能力）。
- **粘贴图片落盘失败静默**：编辑器内粘贴失败仅 console.error，用户毫无感知；编辑器外粘贴的提示文案指向不存在的工具栏按钮。修复：失败接 `message` 弹窗（与拖拽对齐），文案改「请使用拖拽插入」。
- **搜索 0 结果无反馈 + 互链文本搜不到**：0 匹配时不区分「还没搜」和「没搜到」；wikilink 是 atom 节点，display 文本不在 doc 文本里，永远搜不到也不高亮。修复：0 匹配显示灰字提示；`findMatches` 对 wikilink 额外匹配 display 文本（命中替换 = 整节点替换，与所见即所得一致）。
- **表格选区复制粘到外部自带完整 `<table>` + 像素死宽度**：跨单元格选区被 prosemirror-tables 升级为 `CellSelection`，PM 默认序列化带出整表壳 + `resizable:true` 的固定像素 `<colgroup>`，粘进 Word/WPS/微信格式脏乱。修复：copy 事件拦截，仅 CellSelection 时把 text/html 压平为逐行 `<p>`（单元格间 `\t`，粘 Excel/WPS 自动分列）；text/plain 管道与普通选区富格式保真不动。
- **超链接 Ctrl+单击「时灵时不灵」+ 互链死胡同**：外链四源叠加——PM 4px 点击门控超限判拖拽静默跳过、hover `cursor:pointer` 与「单击无反应」自相矛盾、协议白名单外（file:///#锚点/相对路径）静默不跳。修复：① mousedown 记录坐标 + click 自判（10px 阈值）；② 光标默认 text，按住 Ctrl/Cmd 才 pointer——指针出现即代表动作可用；③ 白名单外弹「仅支持 http/https/mailto」提示。互链：目标不存在从「打开文件失败」死胡同改为 confirm 一键创建带标题 frontmatter 的空文档（`expected=0` 先探 + conflict 复查，任何竞态下不覆盖既有文件）。
- **字面下划线保存重开变斜体（文件模式转义漏 `_`）**：`snake \_case\_` 这类已手工转义的字面下划线，保存时 `\_` 被剥掉、重开 `_case_` 被解析为斜体——语义静默改变（CommonMark 里 `_` 与 `*` 同为 emphasis 定界符，但文件模式只转义 `*`）。修复：选择性转义 `escapeUnderscores`——`_` 两侧均为字母数字（intraword，如 `snake_case_var`）时不转义（文件字节保持干净，CommonMark 规定 intraword `_` 不构成 emphasis），其余 `_` 转义保语义。
- **剪贴板出站转义不足（`_ ~ [ ] < >`）**：复制字面 `a_b_c` / `~~text~~` / `[见附录]` / `<tag>` 粘到 Obsidian/Typora 被重新解释为斜体/删除线/链接/被吃 HTML——此前只修了「多余转义」没修「转义不足」。修复：clipboard 模式全局转义类补 `_~[]<>`（低频符号保持轻量，行首 `#+\-.>=` 规则不变）。
- **有序列表第 10 项起嵌套子列表脱离父项**：子列表缩进固定 3 空格，而 `10. ` marker 宽 4——第 10 项起的子列表重开时脱离父项变文档级列表。修复：`renderList` 记录每层 marker 实际宽度（`itemIndentWidth` 回调），子层缩进按 marker 宽度对齐（无序列表 `+`/`-` 宽 2 仍取 `max(3, width)` 保持既有字节不变）。
- **行内代码首尾空格 roundtrip 丢失**：`` ` x ` `` 重开变 `x`（CommonMark 剥 code span 首尾各一个空格）。修复：内容首尾均为空格且非纯空白时补双空格 padding（`` `  x  ` ``），重开剥一层后复原。
- **mermaid/math 块内容含围栏字符时落盘即损坏**：内容含独立 ` ``` ` / `$$` 行时固定三反引号围栏被提前闭合，重开结构错乱——codeBlock 有围栏升级逻辑，这两个块漏做。修复：新增共享 `computeFence`（最长同字符 run + 1，且逐行检测转义围栏冲突继续加长）；math 块内容含 `$$` 时改用 ```` ```math ```` fence 形式落盘（无冲突时维持 Obsidian 兼容的 `$$` 形式），parser 侧补 `math` fence 语言路由。
- **含反斜杠的链接 destination 保真 + CommonMark Ex20/603**：Windows 路径 `[x](C:\notes\a.md)` 此前落盘被改写（`%5C` 编码原样落盘）；且 destination 含字面 `\` 时序列化原样输出，重解析「`\`+ASCII 标点」被当作转义吃掉反斜杠（Ex 20 两轮不稳定）、末尾 `\` 转义闭合括号导致整条链接解析失败退化成纯文本（Ex 603）。修复：parser 侧 `decodeLinkDestination` 补 `%5C` 解码还原原始反斜杠形式；serializer 侧 `escapeDestBackslashes` 只转义「后跟 ASCII 标点或位于末尾」的反斜杠（「`\`+非标点」如 `\n` `\a` `\中文` 保留原样——Windows 路径字节干净），两种 destination 形式统一。CommonMark 652 条规范用例 roundtrip 全绿。
- **表格列宽含中文时 `|` 不对齐（B5）**：列宽按 UTF-16 `length` 计算，东亚宽字符（显示宽 2）被记 1，含中文单元格的表格源码里竖线永远对不齐。修复：serializer 加 `visualWidth`（East Asian Width W/F 区段记 2，按码点迭代防代理对漏判）+ `padEndVisual` 替换 `length`/`padEnd`，纯 ASCII 表格字节不变。
- **callout 标题/折叠标记不建模，Obsidian 语义漂移（B10）**：`> [!NOTE]+ 标题` 的 `+ 标题` 被当普通内容段落，roundtrip 后 Obsidian 语义变化；callout 内空行序列化带尾随空格 `> `。修复：callout 节点增 `title`/`fold` attrs，parser 提取（折叠标记须紧跟 `]`，含 inline 格式的标题保守不提取保持正文），serializer 回写 `> [!TYPE]±标题`；空行输出 `>` 不带尾随空格；有自定义标题时编辑器显示标题（`data-title` CSS），否则维持类型名。
- **callout 类型配色在真实编辑器从未生效（B10 顺手修复）**：`Callout` 的 NodeView 创建裸 `div.mk-callout`，不挂任何属性——而 `addAttributes.renderHTML` 只作用于剪贴板/HTML 序列化，不作用于 NodeView DOM，`data-callout-type` 从未出现在真实编辑器里，所有 callout 一直渲染成 note 默认配色、`::before` 类型标签为空（该 NodeView 与类型配色 CSS 同批引入，自引入日起即坏）。修复：NodeView 手动同步 `data-callout-type`/`data-title`/`data-fold`（`update()` 时增量更新），补 NodeView 属性回归锁。


### Performance
- **「崩溃后隔天再开」启动长时间无响应（C4）**：启动关键路径同步清理 >1h 的 WebView2 残留数据目录，`remove_dir_all` 删万级小文件可耗时数秒，且此时尚无任何窗口——点击图标表现为长时间无响应。修复：stale 清理移到后台线程与启动并行（清理目标仅 >1h 旧目录，与本进程刚建的目录无竞态）。
- **remote-image-cache 磁盘缓存无限累积（C3）**：单图 ≤10MB 落盘后从无清理。修复：启动时后台线程做容量清理——超 200MB 按 mtime 从旧到新删除，10 分钟宽限期内的文件跳过（防误删双开实例/本进程正在拉取的图片，宁可暂留超限）；缓存 miss 会重新下载，删除无数据丢失风险。
- **搜索开着时每次编辑停顿即全文重扫（C5）**：搜索面板打开期间每次编辑停顿 120ms 就全文重扫 + 全量装饰重建（数千匹配 = 数千 Decoration + DOM 分裂），大文档未降档。修复：编辑触发的重扫按档位分流——heavy/extreme 档防抖放到 500ms（搜索框输入仍 120ms 不变）；且匹配集合（数量与位置）未变时跳过 dispatch——已有装饰在编辑事务里被 map 平移到新位置仍然正确，空 dispatch 纯为换引用触发重建，不换就不必发。
- **切文档瞬间的 100-300ms 白算序列化（C6）**：500ms 内快速切文件时序列化缓存未命中，watch 会同步全量序列化旧 doc，而跨文件切换目标必是另一份内容、比对注定不等——卡顿恰好落在切换瞬间且是纯白算。修复：跨文件 path 变化跳过序列化直接替换内容，仅同路径 reloadToken（外部修改重载）保留语义比对（另存为/重命名落盘前 `getContent()` 已刷新缓存，不受影响）。
- **异步命令内阻塞 fs IO 压 tokio worker 线程（C7）**：字体 8-15MB 读写（fetch/save/read 三处）与远程图片 ≤10MB 写盘未进 `spawn_blocking`，与已修 #2 标准不一致。修复：全部写盘段包 `spawn_blocking` 对齐。
- **大纲面板关闭时 scroll-spy 仍每滚动帧运行（C9）**：面板常驻挂载，滚动监听不看 isOpen，关闭期间每帧二分查找 + `getBoundingClientRect` 纯浪费。修复：`updateActive`/`onScroll` 开头 `isOpen` 早退（零调度零计算），重开面板时补算一次。
- **remote-image 50MB 内存 LRU 名存实亡（C8）**：#4 改 Rust 落盘 + asset URL 后，前端缓存条目只是两个短字符串、size 恒为 0，字节预算永不超——淘汰分支是死代码，「50MB 兜底」是假保险。修复：删掉 blob 转换/记账整条死路径，改条目级 LRU（500 条封顶，只防超长会话 Map 无界增长；内存大头在 Rust 侧磁盘缓存，前端不持有图片字节）。

### Added
- **`[[` 互链文件名补全**：输入 `[[` 即弹出同目录 .md 文件名补全菜单（复用 Slash/Emoji 同款 Suggestion 基建）：新 Rust 命令 `list_markdown_files`（同目录、不递归、排序、上限 500）+ `WikilinkSuggest` 扩展 + `WikilinkMenu` 组件；候选按文档路径缓存、切换文档/懒初始化预取，排除当前文档自身、菜单上限 50。上下文守卫：代码块内不弹、`![[` 嵌入语法不触发、未闭合 `[[` 内抑制 `/` `:` 菜单（`suggestion-guard` 升级支持多字符触发，非重叠扫描对齐正则语义）。

## [1.2.42] — 2026-09-05

### Fixed
- **图片保存后重开丢失（文件名含空格 / 中文路径）**：拖入或粘贴的图片，若文件名含空格（剪贴板粘贴固定命名 `Pasted image {时间戳}.png`、部分截图工具文件名也带空格）或中文，落盘后重开会「蒸发」成字面文本或断链。根因两层：① serializer 把 image/link 的 src/href **原样写入**，而 CommonMark 规定 `(...)` 里的地址不允许未转义空格——含空格 src 重开时整段图片语法解析失败，退化成 `!\[alt\](...)` 字面文本；② markdown-it 的 `normalizeLink` 会把地址里的非 ASCII（中文路径）百分号编码，parser 未解码，导致磁盘文档里的中文路径每次保存被静默改写、零编辑文档因 src 变化被误标脏。修复：serializer 新增 `escapeLinkDestination`——括号平衡且无空白/尖括号时保留原反斜杠转义（既有文档字节不变），否则用 `<...>` 尖括号形式包裹（实测 markdown-it：反斜杠转义对空格无效，只有尖括号形式能携带空格）；parser 新增 `decodeLinkDestination` 保守还原（仅当含非 ASCII 百分号编码或 `%20` 时解码，纯 ASCII 编码如 `%25` 保持原样以免误解远程 URL）；Rust 侧粘贴图片命名从 `Pasted image {}` 改为 `pasted-image-{}`，从源头消灭空格。roundtrip 补回归锁。
- **保存失败 / 冲突取消后脏标被洗白 → 未保存编辑静默丢失**：`persistDocument` 在保存**发起前**就把编辑器内容回写 store 基线，一旦保存失败或冲突弹框被取消，基线已被污染，后续 `syncEditedContent` 语义比对因「内容与基线相同」把 `isDirty` 洗成 false——关窗不再弹确认、自动保存不再重试，用户未保存的编辑静默丢失。修复：基线只在保存**成功后**同步（`markSaved(mtime, content)` / `setFile(content, ...)`），`persistDocument` 改为返回 `{ result, content }` 交调用方在成功分支落地；失败 / 取消路径基线不动、脏标保留。补回归锁。
- **同路径外部修改重载不刷新编辑器 → 反向覆盖外部改动**：文件在外部被改动后点「重新加载」，路径不变、只有内容变，而编辑器 watch 只监听 `path`——不触发文档替换；旧 doc 的延迟序列化还会把旧内容写回 store 误标脏，用户一保存就把外部修改覆盖掉（静默数据损坏）。修复：store 新增 `reloadToken`（仅 `setFile` 从磁盘载入时递增），编辑器 watch 源改为 `[path, reloadToken]`；不直接 watch `content`（编辑期 `syncEditedContent` 也写 content，会在 store 滞后于编辑器时把正在编辑的内容回退成旧基线）。补回归锁。
- **输入法候选窗失锚偶发复发（组字期间装饰重建）**：v1.2.41 已在 `markdown-input` 的 pending heading / 行内标记转换加组字闸门，但**搜索高亮刷新**、**焦点模式装饰**与**代码块语法高亮**这三条路径在组字期间仍会重建 / swap 装饰、改动正在组字的 DOM → WebView2 下 IME 候选窗失锚变形（横向长条塌成紧凑小方块）。修复：穷举所有「组字期会改正文 DOM」的装饰插件后统一「组字期间只平移装饰、不重建、不 swap class」套路——`useEditorSearch` 的 `refreshAfterEdit` 组字期直接跳过 dispatch（组字结束后上屏的 doc change 会再触发一次，高亮不漏）；`search-highlight`、`paragraph-focus` 与代码块 `createIncrementalLowlightPlugin` 三个装饰插件用工厂闭包登记 EditorView，`view.composing` 为真时只 `map` 平移已有装饰跟随 doc 变化、不重建（`paragraph-focus` 放行焦点模式切换的 meta reset）。补组字冻结回归锁。**实测仍复发后进一步定位到渲染层根因**：P5-02 的 `content-visibility:auto`（无条件作用于 `.tiptap-editor > *`）隐含 `contain:layout style paint`，会干扰 WebView2/TSF 计算组字光标矩形，是事务层守卫堵不住的「偶发复发」真凶（该优化的兼容性清单当初漏验 IME）。修复：档位映射到 `<html class="doc-heavy">`（`setDocumentTier`），content-visibility 仅大文档（heavy/extreme）启用，普通文档（中文输入主场景）关闭。**第三层（布局层，解释「时好时坏」）**：`<ErrorBoundary class="editor-area">` 因 ErrorBoundary 是双根 fragment（v-if/v-else），Vue 无法继承 class 而将其丢弃（Extraneous non-props attributes 警告）→ `.editor-area` 的 `min-width:0`/flex-column 不生效，编辑区容器宽度随内容重排、组字时光标矩形抖动、布局稳定后又自愈。修复：App.vue 用独立 `<div class="editor-area">` 包裹 ErrorBoundary 承载布局 class。**残留（判定为外部缺陷，编辑器层封顶）**：真机取证 + 组字期诊断证明应用层干净（组字期光标矩形从未退化、DOM 仅组字文本自身变动、无 refocus、祖先链无 transform/contain、WebView2 运行时为新版 152），合成输入 3/3 正常、真实输入偶发 → 锚点失效在 WebView2/TSF 可见层之下；编辑器层不再加守卫，临时诊断 `ime-diag.ts` 已删除，详见 KNOWN-ISSUES §二 #8。

## [1.2.41] — 2026-08-31

> 全项目系统性审查与优化：安全面收口、大文档性能三阶段落地、字体下载切国内 CDN、输入法组字稳定性修复，以及一处用户可感知的痛点补齐（表格行列操作）。

### Security
- **Rust IPC 入口补路径与 URL 校验**：此前 `open_document` / `save_document` / `import_document_image` / `fetch_remote_image` 把前端传入的路径或 URL 直接用于读文件与发请求，恶意文档内容（如构造的 `image src`）可诱导越权读写与 SSRF。修复：① 读/写各加扩展名白名单（读 md/markdown/txt，与 `lib.rs` 的 `supported_open_path` 同源；写多一个 json，因为「导出主题模板」复用 `save_document` 写 `.json`）；② `import_document_image` 的 source 改走 `validate_image_asset_path`，复用 canonicalize + is_file + 图片扩展名三重校验，防止把任意文件（或 `evil.png` 指向 `secret.txt` 的符号链接）拷进资产目录；③ 新增 `validate_remote_image_url` 限定 http/https 并拦截字面量内网主机（回环/私有/链路本地/组播、`localhost` / `.local` / `.internal`、云元数据 `169.254.169.254`，含 IPv4 内嵌 IPv6 形式），请求与 Referer 改用校验后的规范化 URL，做到「校验什么就请求什么」；④ 新增 `validate_font_url` 限定 https，刻意不做主机白名单——GitHub release 会 302 跳到 `objects.githubusercontent.com`，白名单会打断下载。缓存 key 仍哈希原始输入，升级后既有 remote-image-cache 不失效。

### Fixed
- **代码块 / 图片 NodeView 事件监听器泄漏**：`code-block.ts`（4 个监听器 + 复制回显定时器）与 `image.ts`（7 个监听器）缺 `destroy()`，节点销毁后监听器与闭包仍存活，频繁增删代码块/图片的长会话线性积累。改用仓库既有的 `AbortController` 套路（对齐 `math-block.ts` / `mermaid-block.ts`）：监听器统一带 `signal`，`destroy()` 里 `abort()`。同时补两处**销毁后异步回写**的守卫——图片 src 解析是异步的，`requestId` 活在同一个已销毁的闭包里仍会自匹配，必须额外查 `signal.aborted` 才能挡住晚到的 `image.src` 赋值。
- **输入法候选窗失锚（中文输入偶发「不跟手 / 呈现怪异状态」）**：Windows TSF 候选窗贴在浏览器报告的光标矩形上——组字期间若正在组字的文本节点被替换，锚点即失效，候选窗停在旧位置或乱跳。而 `markdown-input` 的 pending heading 与行内标记转换（`setBlockType`、`delete + addMark`）正是会拆掉该文本节点的文档变更。修复：`appendTransaction` 新增组字闸门，浏览器权威信号 `view.composing` 为真时一律不转换（PM 调 `appendTransaction` 只传三个参数拿不到 view，改用插件工厂闭包登记 EditorView 实例读信号）；两处 settle 定时器到点若仍在组字则放弃本次转换。被挡下的转换不丢——那次组字结束时的 `compositionend` 会重新触发。
- **大文档卡死时窗口关不掉（关窗逃生舱）**：关窗确认链完全跑在前端，4MB 以上文档的序列化会把 WebView 的 JS 线程占死——`close-requested` 送进去没人应答，窗口既关不掉也不弹框，只能杀进程。修复：Rust 侧新增 `CloseGuard` 看门狗 + 前端握手命令 `report_window_close`。首次关闭请求照常弹确认框并起算 3 秒宽限期；前端收到即回 `ack` 证明 JS 还活着，此后重复请求一律吞掉（不再叠出多个确认框）；宽限期内前端一次都没应答则判定线程被占死，第二次关闭请求放行原生关闭。用户取消 / 保存失败 / destroy 失败都会 `abort` 复位，避免看门狗永久停在 Waiting 让逃生舱失效。
- **外部修改重载会静默丢弃未保存编辑**：文件在外部被改动后，重载链路直接覆盖了当前内容。修复：改走 `openDocumentWithPrompt`，含脏态确认与错误弹窗，不再静默丢弃。
- **关窗时丢失最后一次设置改动**：设置写入有 300ms 防抖窗口，关窗时窗口内未落盘的改动直接丢失。修复：新增 `flushPendingSettings`，关窗链路在销毁前强制落盘。
- **拖入混合文件时 .md 被当图片内联**：同时拖入含 `.md` 的混合文件时，`.md` 走了图片内联链路而非文档打开链路。修复：加混拖守卫，`.md` 一律走文档打开。
- **外部修改检查失败被静默吞掉**：失败路径无日志，问题难以定位。修复：补 `console.warn` 留痕。

### Added
- **表格行列操作入口**：新增右键菜单（`ContextMenu.vue`）与命令面板 7 条表格命令（插入/删除行列、切换表头行），解决「创建了表格但无法删除行列」的用户痛点。TipTap Table 扩展原生命令此前无任何调用点，本次补齐入口；colwidth 属性序列化 / resizable 拖拽列宽持久化留待后续（见 KNOWN-ISSUES §二 #6）。
- **文档加载指示条**：大文件读取 / 解析期间顶部显示细进度条（纯 transform 动画，零布局抖动）。此前这段时间界面毫无反馈，容易被误判为「卡死」。
- **大文档阈值分层与自动降级**：按「剔除 base64 内嵌图片后的字符数」分 normal / heavy(≥50 万) / extreme(≥200 万) 三档。heavy 档自动关掉三项高开销特性（代码块自动语言检测、焦点模式装饰、实时字数——改为打开时算一次基线）；extreme 档打开前需用户确认才进可编辑模式。取代此前 10 万字符一刀切（正常文档也误弹窗、失去意义）。

### Changed
- **字体下载切国内 CDN（用户可感知：下载明显变快）**：字体改由七牛云 CDN（`fonts.weimabbs.com`）优先分发，GitHub release 作为兜底源。字体本身不变、使用方式完全无感，唯一变化是**下载速度显著提升**（国内网络下尤其明显）。任一源失败自动换源，契合退化安全原则。`fontLoader.ts` 的 `DOWNLOAD_BASE` 改为 `FONT_SOURCES` 数组；Rust 侧失败不落盘、缓存名用 URL 末段，两源可安全复用同一份缓存。
- **动效 token 统一 + 无障碍降级**：新增 `--motion-slow`(300ms)，分散在各处的 0.15s/0.2s/0.25s ease 收敛为 token + `--ease-out` 曲线。新增 `smoothScrollBehavior()`——CSS 的 `prefers-reduced-motion` 媒体查询管不到 JS 的 `scrollTo` / `scrollIntoView`，改用 `matchMedia` 显式降级，大纲跳转与搜索跳转已接入。
- **架构收口**：`App.vue` / `WindowResizeHandles.vue` 不再直接调 `@tauri-apps` 窗口 API，统一走 `services/tauri/window.ts`（守「Tauri 调用唯一入口」铁律）；`fontLoader` 清理无调用方的僵尸代码与热路径日志。

### Performance
- **关窗 / 切文档闸口免序列化**：新增「编辑代际」判据（`editGeneration` / `syncedGeneration`）——store 基线已是当前 doc 的序列化产物时，闸口直接信任脏标记，不再全量序列化兜底。4MB 文档上这一次序列化正是「关窗卡死」的主要开销。偏保守只浪费一次序列化，偏乐观会丢编辑，故判据取严格相等。
- **载入基线改存序列化产物**：此前基线存磁盘原文，而 parse→serialize 并非字节等价往返（CRLF→LF、marks 顺序重排），导致零编辑文档语义比对永远不等 → **关窗误提示保存**（Windows 下 CRLF 必现）。改为存序列化产物并预热缓存，未编辑即关闭时 `getContent()` 直接命中。
- **编辑器热路径四项优化**：① 序列化结果缓存复用（切文档比较优先命中缓存，省 100–300ms 全量序列化）；② 大纲面板关闭时跳过全文大纲遍历（打开瞬间补算）；③ 空闲序列化撞上续打时重新排队，不再硬插造成输入卡顿；④ 焦点模式装饰由 N 条收敛为「当前 + 上一个」2 条。

## [1.2.40] — 2026-08-22

> 4 项数据可靠性修复（Ctrl+Z 跨文档回退、多窗口退出丢内容、重命名死锁、大纲跳转不精准），编辑健壮性显著增强。

### Fixed
- **切换文档后 Ctrl+Z 回退到上一篇内容（静默数据损坏）**：TipTap `setContent` 只设 `preventUpdate` 不处理 history，撤销栈跨文档污染——切换文档后按 Ctrl+Z 会把上一篇内容换回来，随后自动保存把旧内容写进当前文件。修复：文档载入/切换改用 `addToHistory: false` + `preventUpdate` 事务整体替换，Ctrl+Z 不再跨过文档边界（同时修复首次加载后 Ctrl+Z 可撤销为空文档的问题）。
- **多窗口应用级退出丢失其他窗口未保存内容**：菜单「退出」/ CmdOrCtrl+Q 原只确认焦点窗口脏态，随后 `app.exit(0)` 强杀进程，其余窗口的未保存修改直接丢失。修复：`exit_app` 更名为 `request_app_quit`——Rust 向所有已加载窗口定向发送 `window-close-requested`，各窗口走自己的「脏态确认 → 保存 → 关闭」链路，任一窗口取消即中止退出，全部关闭后进程自然退出。
- **重命名成功但写内容失败后保存死锁**：rename 已落盘而 persist 失败时 store.path 停在旧路径，此后每次保存都重走 rename 分支（目标已存在）永久失败。修复：persist 失败时把 store 路径同步到已更名的磁盘实际路径（isDirty 保持 true），下次保存走正常分支直写新路径。
- **大纲点击跳转不精准定位**：点击侧边栏标题后正文只滚到视口边缘、没对准标题。根因：`view.domAtPos` 在块节点起始边界返回编辑根容器而非标题元素，`scrollIntoView` 静默失效，只剩 focus 附带的「最小滚动」。修复：新增 `editor-dom.ts` 统一取块节点 DOM（`nodeDOM` 优先）+ 手算滚动位置，标题平滑停靠视口上方约 1/4（Obsidian/Typora 风格）；scroll-spy 高亮阈值与跳转目标对齐，跳转后高亮不再跳回上一个标题。已真窗口验证。

## [1.2.39] — 2026-08-14

> 深度性能优化（9 项）+ WebView2 缓存清理 + Mermaid 误标脏修复。

### Performance
- **Rust 同步命令异步化**：`open_document` / `save_document` / `rename_file` 等 7 个命令改为 `async fn` + `tauri::async_runtime::spawn_blocking`，大文件读写不再阻塞主线程，界面不再卡顿。
- **markdown-input 双扫描合并**：`view.update` 与 `appendTransaction` 对同一文档的两次全树遍历改为 WeakMap 缓存，第二次命中缓存；`findPendingHeading` 委托 `scanHeadings`，避免重复扫描。
- **远程图片 base64 往返消除**：`fetch_remote_image` 改为 Rust 落盘缓存 + asset URL，不再把字节转 base64 走 IPC 再 atob 转回——10MB 图片不再往返搬运 23MB 数据、不再阻塞主线程。
- **字体加载走 CSS @font-face**：`read_font_bytes` IPC 传字节改为 `@font-face { src: assetUrl }` 注入 + `document.fonts.load()` 检测，保留 IPC fallback。
- **resolve_image_display 加缓存**：Map 缓存授权结果，文件切换/路径变化时清空，多图文档不再每张图重复 canonicalize + 授权 IPC 往返。
- **字数统计改逐节点计数**：`doc.textContent` 全文拷贝改为 `descendants` 逐节点计数，防抖触发不再产生全量字符串拷贝。
- **OutlinePanel scroll-spy 二分**：滚动时对标题列表线性扫描改二分查找，标题多的文档有收益。

### Fixed
- **Mermaid 误标「未保存」**：`onUpdate` 无条件 `markUserEdit()`，加载含 Mermaid 文档时异步渲染叠加产生非 `preventUpdate` 事务 → 误标脏 → 自动保存空转、关闭弹无谓确认框。修复：**交互门控**——文档加载后，收到第一个真实用户事件（键盘/指针/输入法）才放行标脏，对触发源免疫。
- **releaseRemoteImageBlobs 未接线**：`onBeforeUnmount` 补上调用，编辑器销毁时释放远程图片 Blob。

### Changed
- **WebView2 缓存目录清理**：退出时清理当前进程 `EBWebView-{PID}-*` 目录（残留阈值从 24h 缩短到 1h 兜底崩溃残留），根治高频重启用户的缓存膨胀。

## [1.2.38] — 2026-08-04

> 修复 mermaid 生产构建纯黑的**真正根因**——1.2.37 修了 manualChunks（真问题但不是黑块根因），本次才真正修复。

### Fixed
- **mermaid 生产构建纯黑（真正根因）**：Tauri 在 `tauri build` 时自动往 CSP 的 `style-src` 注入随机 nonce。按浏览器规范，一旦 `style-src` 含 nonce，`'unsafe-inline'` 被忽略。mermaid `render()` 时通过 innerHTML 注入 `<style>` 到 SVG，没带 nonce → 被 CSP 静默拦截 → 所有形状回退到黑色填充。亮/暗主题都黑，因为根本没拿到样式。修复：`tauri.conf.json` 加 `dangerousDisableAssetCspModification: ["style-src"]`，`script-src` 的 nonce 保留（XSS 防护不降级），`style-src` 不注入 nonce（`'unsafe-inline'` 生效，mermaid `<style>` 放行）。

### 经验沉淀
- **Tauri dev 不附加 CSP，prod 才附加**：`tauri dev` 走 Vite dev server（localhost），不附加 CSP；`tauri build` 走 `tauri://localhost`，才附加含 nonce 的 CSP。**CSP 相关问题不能用 dev 验证**，必须 build 后跑真实 release 二进制。这是"dev 正常 prod 黑"的根本机制。
- **CSP nonce 会静默中和 'unsafe-inline'**：按 CSP 规范，`style-src` 一旦含 nonce/hash，`'unsafe-inline'` 被忽略。任何"运行时 innerHTML 注入 `<style>`"的库（mermaid/lit/KaTeX 等）在 Tauri prod 下都会踩这个坑。证据：frenetik.mdlite PR #68 + Tauri 官方 issue #3831。
- **不要靠猜排查 prod-only 问题**：1.2.37 修了 manualChunks 但没解决黑块，因为在猜原因而非看真实报错。正确做法是在 prod 开 DevTools 看 Console，CSP 违规会有明确报错。AGENTS.md 已有此教训，本次又犯一次。

## [1.2.37] — 2026-08-04

> 修复 mermaid 生产构建纯黑的**次因**（manualChunks 打坏懒加载）——真根因（CSP nonce）在 1.2.38 修复。

### Fixed
- **mermaid 生产构建纯黑（次因）**：根因是 `vite.config.ts` 的 `manualChunks` 用 `id.includes('mermaid')` 把 mermaid 主入口与所有图表 chunk（flow/sequence/gantt…）强制合并成一坨，打坏 mermaid 11 按图表类型 `await import()` 的懒加载链路 → 图表模块加载失败 → 主题样式不注入 → SVG 纯黑（亮/暗主题都黑）。修复：移除该手动分包行，让 Rollup 按动态 import 自动拆出独立 chunk，懒加载链路恢复。
- 顺带消除主题切换卡顿（同根因：重渲时 mermaid 内部模块加载链路已乱）。

### 经验沉淀
- **手动 manualChunks 会破坏库的懒加载契约**：mermaid 11 这类基于动态 import 拆包的库，强制合并其 chunk 会打坏内部 `await import()` 链路，导致运行时加载失败且症状隐蔽（仅 prod 复现、dev 正常）。对这类库，让其走 Rollup 自动分包，不要手动干预。

## [1.2.36] — 2026-08-04

> 集中修复三处 UI 体验问题（均来自用户在真窗口（tauri dev）验证后反馈）：mermaid 主题切换残留黑块、mermaid 无法放大查看、BubbleMenu 清除格式按钮不显眼；并顺带消除切换模板时的轻微闪烁。

### Fixed
- **mermaid 主题切换残留黑块**：根因是 `reinitializeMermaidTheme()` 只重设 mermaid 全局 theme、不重渲已存在的 SVG，导致切换 editor 主题后旧 SVG 卡在首次渲染时的主题。修复：① 用模块级 `Set` 登记所有活跃 mermaid NodeView，`reinitializeMermaidTheme` 遍历全部 `rerender()`；② 重渲改**双缓冲**（保留旧 SVG 直到新 SVG 就绪），消除「旧→空→新」的闪烁；③ `destroy()` 时从 `Set` 移除，防对已销毁实例重渲与内存泄漏。
- **mermaid 暗色主题 subgraph 标题/边框不可见**：mermaid 11 dark theme 把 cluster 标题文字与背景同色。修复：暗色下显式注入 `themeVariables`（`titleColor`/`clusterBkg`/`clusterBorder` 提亮），让「数据源/接入层/核心工具…」等 subgraph 标题清晰可读。
- **mermaid 无法放大查看**：mermaid 输出是 SVG 矢量图，原 NodeView 无任何缩放控件（点击 SVG 仅进源码编辑）。新增 **lightbox 全屏预览**：header 加独立「放大」按钮，点击弹出全屏 overlay 克隆当前 SVG，支持滚轮缩放、+/-/1:1 按钮、拖拽平移、Esc/点背景关闭——与「点 SVG 进编辑」手势零冲突，且放大多大都不糊。
- **BubbleMenu 清除格式按钮不显眼**：原按钮用灰色 muted + 抽象图标、无文字标签，用户难以识别。修复：换成通用**橡皮擦图标** + 提高对比度 + hover 切 `error` 色，意图一眼可辨。

### Changed
- **消除切换模板/主题的轻微闪烁**：`main.css` 的 `theme-transitioning` 过渡原只覆盖 `background-color` + `color`、避开 `border-color`，导致边框瞬切与背景/文字的平滑过渡不同步、形成视觉错位（用户感知到的「轻微闪一下」）。补上 `border-color` 让边框一并平滑过渡（`box-shadow` 仍避开以保性能）；`manager.ts` 的过渡类移除 `setTimeout` 由 300ms 对齐到 `--motion-base` 的 200ms，避免快速二次切换时过渡叠加。

### 经验沉淀
- **主题切换与图表重渲必须解耦联动**：改全局 theme 配置不等于改已渲染节点的视觉；任何「跟随主题重画」的组件（mermaid/SVG/图表），都需持有活跃实例引用并在主题切换时主动重渲，否则残留旧主题 SVG 是最易踩的坑。
- **双缓冲重渲**：就地替换 SVG 会产生「旧→空→新」可见闪烁；保留旧节点、等新节点就绪再替换，是体感更稳的标准做法（与 DOM 双缓冲同思路）。
- **SVG 矢量放大是天然优势**：mermaid 等 SVG 输出做 lightbox 缩放成本极低、无损清晰，比位图放大体验好得多。

---

## [1.2.35] — 2026-07-31

### Changed
- **粘贴逻辑范式重构**：从 `handlePaste` 全接管 + 来源嗅探分发，重构为「信任 ProseMirror 默认流程 + 三层管道钩子」架构。Layer 0 默认管道处理 HTML 解析与上下文感知插入（代码块自动纯文本、列表自动合并）；Layer 1 `clipboardTextParser` 钩子识别纯文本 Markdown 源；Layer 2 `transformPasted` 钩子救回装饰性 HTML 塌方；Layer 3 `handlePaste` 逃生舱仅处理图片。`handlePaste` 函数体从 150+ 行缩减到 12 行，移除了来源嗅探反模式，代码块内粘贴代码、列表内粘贴列表等场景交给 ProseMirror 默认流程处理。
- **代码块自动换行**：`editor.css` 的 `.tiptap-editor pre` 从 `overflow-x: auto` 改为 `white-space: pre-wrap` + `overflow-wrap: break-word`，长行代码折行显示，不再出横向滚动条。

### Added
- **斜杠命令拼音首字母检索**：`slash-commands.ts` 的 `SlashCommandItem` 新增 `alias` 字段，14 条命令填入拼音首字母 + 常用英文缩写。输入 `/bg` 匹配「表格」、`/dmk` 匹配「代码块」、`/lb` 匹配三个列表、`/gs` 匹配「数学公式」等，提升中文用户的命令发现性。
- **链接 Ctrl/Cmd+Click 跳转**：新增 `link-open.ts` 扩展，ProseMirror `handleClick` 插件检测 Ctrl/Cmd + 左键点击 `<a>` 元素，调用 `@tauri-apps/plugin-opener` 的 `openUrl` 用系统浏览器打开。协议白名单限制为 http/https/mailto，`openUrl` 失败时回退 `window.open`。

### 经验沉淀
- **ProseMirror 粘贴范式**：「信任默认流程 + 管道钩子增量改写」优于「全接管 + 来源嗅探分发」。默认流程已内置上下文感知（代码块纯文本、列表合并、嵌套处理），手动接管会覆盖这些行为导致「消灭一个问题又出一个」。`handlePaste` 应仅作逃生舱（处理默认流程无法处理的场景如图片落盘），常规改写用 `clipboardTextParser` / `transformPasted` 等管道钩子。
- **Slice openStart/openEnd 控制合并行为**：闭合切片（0,0）独立插入不与周围合并，开放切片（1,1）允许 ProseMirror 自动合并列表/段落。列表内粘贴列表变嵌套的问题，根因是用了闭合切片——改用开放切片让 ProseMirror 自动合并即可。

---

## [1.2.34] — 2026-07-23

> 注意：v1.2.33 记录的「CSS `@font-face` 注入方案」在**真实 WebView2** 下仍被 Tauri asset 协议（不返回 `Access-Control-Allow-Origin` 头）静默拦截——字体文件下载落盘成功，但 `FontFace` 加载字体强制走 CORS 模式，浏览器静默拒收、`document.fonts.check` 只悄悄返回 `false`。因此 v1.2.33 字体**实际仍未生效**。本版本改用 IPC 字节通道才真正修复。

### Fixed
- **字体真正生效：缓存渲染改走 IPC 字节通道**。原 `readCache` 用 `toAssetUrl()`（asset:// 协议）注入 `@font-face`，被 CORS 静默拦截。改为 `readFontBytes`（Rust 命令经 IPC 取字节）→ `new FontFace(family, bytes)` 同源加载，彻底绕开 asset 协议 CORS。Rust 侧 `read_font_bytes` 基础设施由 v1.2.32 写好但渲染层未接上，本版本接上。dev 窗口实测：切换下载型字体（思源宋体/汇文明朝/霞鹜文楷 等）正文即时变字形，Console 见 `registerFontFromBytes ... status="loaded", check=true`。
- **霞鹜文楷实为 Lite 轻便版（资源错配）**。`LXGWWenKai-Regular.ttf` 文件名标 Regular，但字体名表内部真实家族名为 `LXGW WenKai Lite`（霞鹜文楷轻便版），导致用户看到字形与预期不符。代码逻辑无误（四处 family 名自洽），问题在资源文件本身。修复：`src/constants/fonts.ts` 的 `value`→`'LXGW WenKai Lite'`、`label`→`'霞鹜文楷 Lite'`；`src/utils/fontStack.ts` 匹配分支同步对齐（不动 `fileName`，避免牵动 release/cache key）。用户若此前在设置里选过旧值「霞鹜文楷」，需重新选一次「霞鹜文楷 Lite」。

### Changed
- **字体 IPC 封装抽离为独立模块** `src/services/tauri/font.ts`：`fetchFontData` / `getCachedFontPath` / `readFontBytes` / `saveCachedFont` 从 `document.ts` 迁出，`fontLoader.ts` 的 import 改指 `./tauri/font`。字体相关逻辑收口到一个模块，便于后续排查（与文档/图片调用解耦）。`document.ts` 不再承载字体关注点。

### 经验沉淀
- **字体类「加载失败」第一步应验证资源本身**：本版本前多个 agent（含本人早期）都在查下载通道 / CSP / CORS / 代码逻辑，没人第一步解析字体文件内部 `name` 表确认它到底是不是声称的字体。霞鹜这一例正是「文件名 ≠ 文件内容」的资源错配。
- **单元测试绿 ≠ 字体真显示**：solo 测试是 Vitest + happy-dom（模拟浏览器），不模拟真实 WebView2 的 CORS 行为、也不渲染字体。字体修复必须 `bun run tauri dev` 起真窗口肉眼验证。

---

## [1.2.33] — 2026-07-22

### Fixed
- **字体不生效最终修复：改用 CSS `@font-face` 注入替代 FontFace API**。v1.2.31/v1.2.32 用 blob URL 绕过 FontFace API 的 CORS 限制，但 dev 模式实测仍失败（`FontFace.load()` 报 `NetworkError`，且 IPC 传输 `Vec<u8>` 有破坏字体数据的风险）。**根本原因**：JavaScript `FontFace API` 强制走 CORS 模式，无论用 asset URL 还是 blob URL 都有各种边缘问题。**修复方案**：改用 CSS `@font-face { src: url("assetUrl") }` 注入 `<style>` 标签——CSS `@font-face` 的 `url()` 加载字体**不走 CORS**（和 `<img src>` 一样，W3C 标准行为），用 `document.fonts.load()` 检测加载是否成功。同时移除了被 GitHub CDN CORS 拦截的前端 `fetch` 下载路径，直接用 Rust `fetch_font_data` 下载落盘后走 CSS @font-face 加载。**教训**：`FontFace API`（JavaScript）和 `@font-face`（CSS）是两套机制——前者强制走 CORS，后者不走。Tauri asset protocol 不返回 CORS 头，所以 `FontFace API` 必然失败，必须用 CSS `@font-face` 注入。
- **【根因追加】GitHub release `fonts-v1` 的字体文件全部被截断**（v1.2.33 深度排查发现）。通过 PowerShell 大端序解析 OTF/TTF 表目录，发现 5 个字体文件全部只有 1.4 MB 左右，但内部表（glyf、CFF、GPOS 等）的 offset 指向 800 万字节位置——文件被截断到只剩头部 + 表目录，表数据全部丢失。**这才是 v1.2.29 ~ v1.2.33 四个版本字体一直不生效的终极根因**——之前修 CSP、CORS、FontFace API 都是代码层面的正确修复，但文件本身就是坏的，再怎么修加载逻辑也没用。**教训**：遇到"资源加载失败"问题，第一步应该验证资源本身是否完整（检查文件大小、表目录偏移量），而不是从加载机制上猜原因。

### Added
- **互链跳转（最小可用版）**：`[[文档名]]` 单击跳转同目录目标文档；未保存文档点击时提示先保存；无扩展名自动补 `.md`；兼容 `\` 与 `/` 分隔符。涉及 `wikilink.ts`（`resolveWikilinkTarget` 纯函数 + 点击插件）、`editor-extensions.ts`、`MarkdownEditor.vue`、`App.vue`，含回归测试 `wikilink.spec.ts`。
- **粘贴质量兜底（P0）**：HTML 粘贴解析结果为「全白话段落、无 mark/结构」时，自动回退用 markdown 重新解析。双重保险门（`isLowQualityParse` + markdown 源检测）**不触碰现有正常路径**（豆包/DeepSeek 问答粘贴），含回归守卫测试 `markdown-paste.spec.ts`。

### Changed
- **字体下载硬化**：Rust 侧 `font.rs` 新增 `validate_font_bytes()`，下载后与写缓存前校验字体完整性（magic bytes + 表目录 offset/length 合法），从源头阻断坏字体落盘。

---

## [1.2.32] — 2026-07-22

### Fixed
- **字体不生效真正根因：FontFace API 的 CORS 限制**。v1.2.30 修了 CSP `font-src` 漏 `asset:` 协议，但只解决了 CSP 拦截问题，**没有解决 FontFace API 自身的 CORS 限制**。CSP 和 CORS 是两道独立的闸门：CSP = "是否允许发起请求"（v1.2.30 已修），CORS = "是否允许读取响应"（Tauri asset protocol 不返回 `Access-Control-Allow-Origin` 头，FontFace.load() 被拦截）。**为什么图片正常但字体不生效**：图片用 `<img src="assetUrl">`（不走 CORS），字体用 `new FontFace(family, "url('assetUrl')")`（**强制走 CORS**）。修复：新增 Rust 命令 `read_font_bytes` 读取字体字节，前端拿到字节后创建 `blob:` URL 加载 FontFace——blob URL 是同源，完全绕过 CORS。三条加载路径全部改用 blob URL：readCache（重启读缓存）、downloadAndCache 主路径（前端 fetch 成功）、downloadAndCache fallback（Rust 下载）。**教训**：CSP ≠ CORS，CSP 放行了请求不代表 CORS 放行了响应。FontFace API 默认走 CORS 模式，用 asset URL 加载字体必然失败，必须用 blob URL 绕过。**（注：此方案在 dev 实测中仍有边缘问题，v1.2.33 改用 CSS @font-face 彻底解决。）**
- **v1.2.31 CI 编译失败修复**：v1.2.31 新增 `read_font_bytes` 命令时，`commands/mod.rs` 的 re-export 列表漏了 `read_font_bytes`（只列了 `fetch_font_data, get_cached_font_path, save_font_cache`），导致 `lib.rs` 的 `generate_handler!` 找不到该函数，CI cargo check 报 `cannot find function read_font_bytes in this scope` + 连锁触发 never type fallback 错误，v1.2.31 因此未发布。修复：补全 re-export。**教训**：新增 Rust 命令时，除在 `font.rs` 定义函数 + `lib.rs` 的 `generate_handler!` 注册外，**必须同步更新 `commands/mod.rs` 的 re-export 列表**——三处缺一不可。

---

## [1.2.31] — 未发布（CI 编译失败）

v1.2.31 尝试用 blob URL 绕过 FontFace API 的 CORS 限制，但因 `commands/mod.rs` 漏了 `read_font_bytes` 的 re-export 导致 CI 编译失败，未发布。内容已并入 v1.2.32。

---

## [1.2.30] — 2026-07-22

### Fixed
- **字体不生效根因：CSP `font-src` 漏 `asset:` 协议**（历史遗留 bug）。v1.2.13 把字体加载从 IndexedDB + blob: URL 改为 `convertFileSrc` + asset.localhost URL，同时给 `assetProtocol.scope` 加了 font-cache 目录，但**忘了同步更新 CSP 的 `font-src`**——`img-src` 一直有 `asset:`，`font-src` 从第一天起就漏了。结果：首次下载用 `blob:` URL（CSP 允许）能临时生效，但重启读缓存用 `convertFileSrc` 转成 asset.localhost URL 时被 CSP 拦截，字体永不生效。v1.2.29 修了 reqwest system-proxy / 旧缓存兼容 / silent 参数透传等周边问题，但都没碰到核心；v1.2.30 才真正修复根因——CSP 的 `font-src` 加 `asset: http://asset.localhost`，与 `img-src` 完全对齐。**教训**：架构切换（加载方式变更）时必须同步审查 CSP/SSOT 等配置类真理源，不能只改代码不改配置。
- **SSOT 违规：`detect_proxy_for_update` 命令名硬编码**：`App.vue` 和 `AboutSettingsPanel.vue` 用 `invoke('detect_proxy_for_update')` 直接 invoke，违反「前端不直接 invoke」铁律。修复：`command-names.ts` 登记 `detectProxyForUpdate`，两处改用 `invokeCommand + TAURI_COMMANDS.detectProxyForUpdate`。与 v1.2.27 修 `read_clipboard_html` 是同类 SSOT 违规复发。
- **打印时 focus-mode 会丢段落**（bug 级）：focus mode 开着时打印，未聚焦段落 `opacity: 0.22` 仍生效，打印结果几乎丢段落。修复：`@media print` 强制 `html.focus-mode .paragraph-dimmed { opacity: 1 }`，同时隐藏代码块语言按钮、mermaid/math 删除按钮、frontmatter header 等编辑态 chrome，容器不限制宽度贴满 A4 printable area。

### Changed
- **排版设计系统性提升（对齐 iA Writer / Obsidian）**：
  - `line-height` 1.9 → 1.7（CJK 友好但不至于过松，iA Writer 1.5 / Obsidian 1.5）
  - 正文 `letter-spacing` 0.02em → 0（回归字体默认设计，不再二次放宽）
  - h1 `letter-spacing` 0.04em → -0.02em（标题应收紧而非放宽，对齐 iA Writer / Obsidian）
  - 容器宽度 760px → 720px（单行约 44 中文字符，符合 CJK 黄金行宽）
  - 段落间距 0.75em → 1em（段落不再抱团，层次分明）
  - h1 margin-top 1.4em → 2.4em，h2 1.2em → 1.8em，h3 1em → 1.2em（章节切换呼吸感）
  - blockquote 加 `font-style: italic`（西方引文排版传统，iA Writer 独创）
  - 代码块/mermaid/math/frontmatter 圆角 6px → 4px（去掉软糖感，Obsidian 4px 一致）
  - 图片移除 1px border（四款天花板全无，让图片沉浸内容流）
  - hr margin 1.5em → 2em（章节切换呼吸感）
  - 标题字号统一（h1-h6 在 editor.css + 7 主题预设间不再漂移，全部 1.5/1.3/1.2/1.05/1/0.9em）
- **图片体验提升**：
  - 新增 caption：图片下方显示 alt 文字，居中 muted 小字号（iA Writer 做法）
  - 新增 loading 占位：图片加载中显示 skeleton 动画背景，防视觉断层
- **可访问性提升**：
  - 全局 `:focus-visible` 焦点环（WCAG 2.4.7 合规，键盘导航有统一焦点环，鼠标点击不显示）
  - 列表 marker 颜色用 muted 色（iA Writer / Notion 一致，正文更突出）
  - `scroll-padding-top: 80px`（预防性修复，防未来 sticky header 遮挡跳转目标）

---

## [1.2.29] — 2026-07-22

### Fixed
- **首次启动仍弹「打开文件失败」错误框**：v1.2.26 曾修过此问题（`handleOpenPayload` 加了 os error 2 静默跳过逻辑），但修复不完整——`loadDocumentFromPath` 的内层 catch 会先 `await message(...)` 弹窗并 `return false`，错误被吃掉传不到外层 try/catch，静默逻辑形同虚设。修复：给 `loadDocumentFromPath` / `openDocumentWithPrompt` / `handleOpenFile` 加 `silent` 参数，启动链路传 `true`，遇到文件不存在时把错误抛给 `handleOpenPayload` 的静默跳过逻辑处理；用户主动打开（菜单/拖拽）仍走默认 `silent=false`，保留合理的错误提示。复查阶段发现并修复两个关键问题：①`handleOpenPayload` 用 `String(err)` 转换错误对象，但 `invokeCommand` 抛的是 `TauriAppError` 对象 `{code, message}`，`String()` 得到 `"[object Object]"`，正则无法匹配 os error 2——改为用 `normalizeTauriError(err).message` 正确提取 message；②非 os error 2 的错误 `throw err` 会中断 setup 函数，导致 `setupDragDrop()` 不执行、拖拽功能失效——改为弹窗提示但不 throw，避免中断后续启动步骤。
- **字体下载在网络受限环境失败**：`reqwest` 配 `rustls-tls`（不读系统证书库）但未开启 `system-proxy` feature，导致 rustls-tls 也不读系统代理，fallback 下载通道在网络受限环境失败。修复：`Cargo.toml` 加 `system-proxy` feature，reqwest 自动读环境变量 + Windows 注册表系统代理。同时修正 `fetch_font_data` 注释——v1.2.28 的注释说"无扩展名导致 Content-Type 推断失败"是错误的（v1.2.27 用 family 命名无扩展名文件能正常加载，反证了这一点）；真正原因是缓存 key 命名变更导致旧缓存失效 + reqwest 不读系统代理。
- **字体缓存兼容 v1.2.27 旧命名**：v1.2.28 改用 fileName（含扩展名）后，v1.2.27 用 family（无扩展名）留下的旧缓存无法识别。`get_cached_font_path` 增加兼容逻辑：先查新名，找不到再查旧名（family），找到则迁移为新名（`fs::rename`）。迁移后旧文件消失，后续都走新名，一次性升级无残留；迁移失败（权限/跨盘）时返回旧路径，字体仍可加载。
- **SSOT 违规：`read_clipboard_html` 命令名未登记**：`clipboard.ts` 用硬编码字符串 `invoke('read_clipboard_html')` 而非通过 `command-names.ts` 真理源。修复：`command-names.ts` 加 `readClipboardHtml`，`clipboard.ts` 改用 `invokeCommand + TAURI_COMMANDS.readClipboardHtml`。

### Changed
- **标题字号整体下调**：h1/h2 在 `editor.css` 默认值和全部 7 个主题预设中下调约 0.1em，让标题与正文的层级对比更克制（h3-h6 保持不变，已接近主流编辑器标准）。

---

## [1.2.28] — 2026-07-21

### Fixed
- **状态栏「已保存」文字颜色跟随主题主色**：此前「已保存」指示用了 `--success-color`（各预设多为绿色系差异极小，且 `scholar` 的 successColor 与 `main.css` 兜底值碰巧相同，掩盖了不跟随的真问题）。改为跟随 `--primary-color`——主题主色是什么，它就是什么，真正做到「颜色跟上主题」而非「拉开色值」。仅改 `App.vue` 两处（`statusbar-stat--success` / `statusbar-save-btn.is-clean`），`.is-dirty` 仍走 `--dirty-color` 不动。
- **正文字体下载失败（缓存文件名变更导致旧缓存失效）**：字体缓存落到 `$APPLOCALDATA/font-cache/` 时，v1.2.27 用 family 名（如 `Noto Serif SC`，无扩展名），v1.2.28 改用 URL 末段的 `fileName`（含 `.woff2` 等扩展名）。改名的本意是与前端 `FONT_OPTIONS.fileName` 字段对齐，避免 family 字符串与磁盘文件名的二次映射；但副作用是 v1.2.27 留下的旧缓存（family 命名）无法被新代码识别，被迫重新下载。`fetch_font_data` / `get_cached_font_path` / `save_font_cache` 三命令同步增 `file_name` 参数；前端 `fontLoader.ts` 下载落盘时补 MIME type。（后续 Unreleased 段补正：早期注释说"无扩展名导致 Content-Type 推断失败"是错误的——v1.2.27 用 family 命名无扩展名文件能正常加载，反证了这一点；真正原因是缓存 key 命名变更 + reqwest 不读系统代理。）
- **从 AI 工具（豆包 / 千问等）复制内容粘贴格式全丢**：此前粘贴来源嗅探只认「专有 markdown 语法」（`#` 标题、`**` 加粗等字面字符 `### 标题` / `**加粗**` 显示出来）。AI 工具常把 markdown 源包在 `pre`/`div` 壳里复制，源是纯 markdown 但被当成 HTML 解析，格式蒸发。扩展嗅探条件为「专有语法 **或** 通用 markdown 源（`looksLikeMarkdownSource`）」，覆盖豆包 / 千问 / 其他把 markdown 包壳复制的场景。新增 2 个回归测试（纯 markdown 源无 HTML / 通用 AI 工具壳场景）断言格式真保留。

---

## [1.2.27] — 2026-07-21

### Fixed
- **复制粘贴格式兼容性（入站）**：从网页 / Word / Notion / 微信等复制的富文本，粘贴事件常不带 `text/html`，导致格式退化成纯文本。原兜底 `navigator.clipboard.read()` 在桌面 webview 不可靠、且官方 `clipboard-manager` 插件并无 `readHtml` API。改为新增 Rust 命令 `read_clipboard_html`（复用项目已有的 `arboard` 依赖直接读系统剪贴板，零新增依赖），缺失 `text/html` 时异步兜底还原格式。回退了两处不存在的 `clipboard-manager:allow-read-html` 权限。
- **复制粘贴格式兼容性（出站）**：编辑器内 `Ctrl+C` 此前无自定义 `clipboardTextSerializer`，选区复制到外部 Markdown 编辑器（Obsidian / Typora）时，callout / 数学公式 / mermaid / wikilink / frontmatter / 脚注等 solo 扩展语法的 Markdown 标记全丢。新增 `serializeClipboardSlice`，将选区序列化为 Markdown 纯文本写入 `text/plain`；`text/html` 仍由 ProseMirror 默认生成（标准格式走 HTML 还原）。
- **状态栏保存按钮颜色不跟随主题**：`cinnabar` 与 `scholar` 预设的 `successColor` 同为 `#6b8e5a`（深色 `#8fb87a`），在两者间切换时「已保存」绿色不变，造成不跟随的错觉。已将 `cinnabar` 改为 `#7ba35a`、`cinnabar-dark` 改为 `#93c06f` 区分。

---

## [1.2.26] — 2026-07-21

### Fixed
- **启动时目标文件不存在不再弹错误框**：更新后重启或通过文件关联（双击 .md）启动 solo 时，若启动参数指向已删除/移动的文件，原行为弹「打开文件失败: 系统找不到指定的文件。(os error 2)」错误框。改为捕获 os error 2 / ENOENT 类错误后 `console.warn` 静默跳过；非文件缺失类错误（如权限问题）仍正常抛出。

---

## [1.2.25] — 2026-07-21

### Fixed
- **粘贴兼容性（核心特性）修复**：从网页 / Word / Notion / 微信 等富文本来源粘贴时格式全丢的问题。
  - **根因**：之前的「兼容性优化」只是给粘贴加了分发器，最常见那一路（富文本来源）直接 `return false` 甩回 ProseMirror 默认粘贴；默认粘贴要保住格式的前提是剪贴板带 `text/html`，在运行时常常没送到，于是退化成纯文本、格式蒸发。优化没碰这个真病根，所以「好像没什么用」。
  - **修复**：HTML 分支不再甩默认，改为用 ProseMirror DOMParser 显式解析 `text/html` 并插入（保格式可控、可测）；当粘贴事件无 `text/html` 时，`navigator.clipboard.read()` 异步从系统剪贴板再读一次 HTML 兜底（桌面端最稳）。
  - **附带修复**：`hasMarkdownOnlySyntax` 行内 `$...$` 误判——要求 `$` 之间不含空格，避免「$10 到 $20」类货币被误判为 markdown 源而走 markdown 解析丢格式。
  - **测试补强**：新增端到端用例，断言富文本 `<strong>`/`<h2>` 真还原加粗/标题节点（堵住此前「只测分发决策、不测格式是否真保住」的盲区）。

## [1.2.24] — 2026-07-20

### Added
- **统一动效语言 token**：`main.css :root` 新增 `--motion-fast: 120ms` / `--motion-base: 200ms`
  / `--ease-out: cubic-bezier(.2,.8,.2,1)` 三个变量 + `.smooth-enter` 工具类。
  把现有 `mk-menu` 入场、`theme-transitioning` 过渡、SettingsModal 入场动效的
  `ease` 曲线统一替换为 `var(--ease-out)`，时长统一为 token 值。Linear / Raycast
  丝滑的核心不是动效多，而是「一致」——同一时长、同一曲线贯穿全局。
- **`prefers-reduced-motion` 全局关动画**：尊重用户系统偏好（WCAG 无障碍底线），
  所有 `*` / `*::before` / `*::after` 的动画与过渡时长降到 0.01ms，scroll-behavior 改 auto。
- **搜索命中 / 大纲跳转的 300ms 高亮脉冲**：跳转后给目标元素加 `.mk-jump-target`
  类触发 `mk-jump-pulse` 动画（背景色淡入淡出）。UX 研究结论：跳转后明确的视觉反馈
  比静默滚动更能让用户「知道到这儿了」。同一元素连续跳转时强制重排让动画可再次触发。
  Helper `pulseJumpTarget` 从 `useEditorSearch.ts` 导出，`scrollToMatch` 和
  `MarkdownEditor.scrollToPos` 共用，避免重复实现。
- **主题 / 字体切换时编辑区内容 crossfade**：CSS 变量重绘会让内容「闪一下」。
  新增 `triggerContentCrossfade()` helper（在 `themes/manager.ts` 导出），
  切换瞬间给 `.mk-editor` 加 `mk-content-crossfade` 类，200ms 内 opacity 从 0.6 淡入到 1
  （不完全消失，保留用户位置感，参考 Notion / Linear）。主题切换 (`applyTheme`) 和
  字体切换 (`applyFontFamily`) 都调用，连续切换时强制重排让动画可再次触发。
- **字体加载 `font-display: swap`**：`fontLoader.ts` 的 `new FontFace(family, url)`
  加第三参数 `{ display: 'swap' }`。字体加载期间用系统同族字体先顶上，到位无感替换，
  对应 Web Vitals 的「消灭 FOUT（字体切换闪烁）」目标。FontFace JS API 默认行为
  接近 swap，但显式声明意图更清晰。

### Changed
- **乐观保存（Ctrl+S 立刻显示「已保存」）**：原实现等 IPC 返回才清脏标，本地写也有
  几十毫秒延迟，状态栏会有可感知的「未保存→已保存」滞后。改为进入 `saveCurrentDocument`
  主分支后立即 `fileStore.markSaved()`（不带 mtime 参数，不动 lastModifiedTime），
  IPC 飞行期间若用户继续编辑 → `hasUserEdit=true` → 成功后保留脏标等下次保存、仅更新 mtime
  防下次 conflict 误报；失败 / conflict 弹框取消时调 `fileStore.markUserEdit()` 回滚脏标
  并还原 mtime。业界共识（Notion / Linear / Google Docs）：体感来自「开始」而非「结束」。

### Tests
- `useDocumentSession.spec.ts` 补全 fileStore mock：新增 `markUserEdit` / `hasUserEdit`
  / `setContent`，`markSaved` mock 同步重置 `hasUserEdit`（与真实 store 行为一致），
  `beforeEach` 重置新字段。
- `manager.spec.ts` 补全 document mock：加 `querySelector: vi.fn(() => null)` 让
  `triggerContentCrossfade` 在测试环境（无 `.mk-editor`）安全跳过。

---

## 命令面板 + 大纲面板

### Added
- **命令面板（Command Palette）**：新增 `CommandPalette.vue`，快捷键唤起全局命令面板，集中暴露
  新建 / 打开 / 保存 / 切换主题 / 跳转设置等常用操作，减少菜单寻路成本；`CustomTitlebar.vue`
  提供触发入口，`src/commands/registry.ts` 注册可检索命令并按分组展示。
- **大纲面板（Outline Panel）**：新增 `OutlinePanel.vue` + `composables/useOutline.ts`，基于
  文档标题结构实时生成大纲，支持 scroll-spy 高亮当前章节，点击跳转对应位置并复用
  `pulseJumpTarget` 高亮脉冲给出落点反馈；默认收起，沉浸式写作时编辑区保持干净。

---

## 代码审查修复

### Fixed
- **`main.rs`：EBWebView 目录启动清理恢复 staleness 守卫（>24h）**。
  原实现无条件删除所有 `EBWebView-*` 目录，用户双开 solo（两个独立进程）时
  新进程会删掉老进程正在使用的 WebView2 数据目录，导致老进程崩溃。
  改为只删除 24 小时前的残留；拿不到修改时间的目录保守跳过。
- **`resolve_image_display`：恢复 `assets/` 相对引用走文档目录的守卫**。
  原实现只要 `storage_dir` 有值就优先 join，导致设了全局 `imageStoragePath` 后
  `![x](assets/diagram.png)` 被错误解析到 `storagePath/assets/diagram.png`。
  守卫规则集中在 Rust 侧（前端不重复实现），新增 5 个单元测试覆盖路径判别不变量。
- **`resolve_image_display`：补 containment 校验**。
  相对路径解析后必须落在基目录（文档目录或 storage_dir）之内，
  防止 `../../secret.png` 越权授权文档目录之外的文件。
  绝对路径放行（solo 是本地编辑器，用户有权引用 `D:/photos/cat.png` 等外部图片）。
- **Slash 命令菜单在中文/英文文字后不触发**。
  TipTap Suggestion 的 `allowedPrefixes` 默认值是 `[' ']`，即只允许 `/` 出现在
  空格或行首之后。中文没有词间空格习惯——用户在「你好」或「hello」后直接敲 `/`
  完全无反应，菜单不弹出。`editor-extensions.ts` 里 `SlashCommands.configure`
  显式传 `allowedPrefixes: null` 关闭前缀检查，让 `/` 在任意前缀后都能触发。
  新增 9 个回归测试锁死该契约。
- **Mermaid / 数学公式块无法删除**。
  两个块都用 `isolating: true` + `contentDOM: undefined`（为了实现「点击进入
  textarea 编辑」的交互），副作用是标准 Backspace 在块外不删块、块内 textarea
  又是原生 DOM——整个块没有删除入口。修复：顶部加一条 header 顶栏，左侧块类型
  标识（mermaid / math），右侧 × 删除按钮——hover 整块时按钮淡入显示，点击直接
  删整块。textarea 内同时保留 `Mod+Backspace` 作为键盘删除快捷键。
- **Slash / Emoji 菜单被视口边缘遮挡**。
  原定位逻辑只算 `rect.bottom + 4, rect.left`，光标在编辑器下方或右边缘时菜单
  会超出视口。抽出 `computeMenuPosition(rect, viewport)` 纯函数做边界检测：
  下方放不下且上方放得下 → 翻转到光标上方；上下都放不下 → 钉视口顶部靠菜单
  自身 scroll；右侧超出 → 向左收缩；左侧超出 → 钉视口左边。SlashMenu /
  EmojiMenu 共用同一函数。新增 7 个单测覆盖各边界场景。

### Changed
- **`events.ts`：拖拽广播加 try/catch + Set 迭代复制**。
  单个 handler 抛错不再阻断后续 handler 收到事件（遵循「一处崩溃不影响全局」原则）；
  迭代时复制成数组，规避 handler 在回调里 unsubscribe 其他 handler 导致 Set 跳过元素的边缘情况。
  新增 2 个测试用例覆盖以上不变量。

---

## [1.2.23] — 2026-07-19

### Added
- 粘贴来源自动嗅探：识别多种来源格式，自动选择最优转换策略。
- 更新进度可视化：粘贴 / 转换过程给出可见反馈。

### Changed
- `hasImage` 标记与 HTML 防重复：避免重复嵌入与重复渲染。

---

## [1.2.22] — 2026-07-18

### Fixed — 格式兼容性修复
- turndown HTML 粘贴转换优化。
- 代码块保护：粘贴时不破坏 fenced code。
- CRLF + Frontmatter 兼容。
- Callout 保留。
- 图片不再吞掉相邻文字。
- 粘贴门槛拓宽。
- 复制按钮增强。

---

## [1.2.21] ~ [1.2.18]

- **v1.2.18 导出系统移除**（用户可见）：删除 HTML/PDF/微信导出（净删约 2500 行代码），改用状态栏「复制为 HTML」按钮把渲染后 HTML 写入剪贴板。详见 [`ARCHITECTURE.md`](../ARCHITECTURE.md) §10.2。
- 其余为版本号同步与小修复（见对应提交 `bump version to 1.2.x`）。

---

## [1.2.17] — 2026-07

### Fixed
- `asset://` 图片重开后裂图。
- 启动黑闪。

---

## [1.2.16] — 2026-07

### Fixed
- 编译修复：移除不存在的 `proxy()` 方法调用。
- 版本号同步（`package.json` + `tauri.conf.json`）。

---

## [1.2.15] — 2026-07

### Fixed
- 自动更新代理检测：4 优先级兜底（env / Git / 注册表 / 端口探测），跨平台注入 updater builder + `HTTPS_PROXY` 环境变量。

---

## [1.2.14] ~ [1.2.11]

- 图片粘贴保存为文件而非 base64 内嵌，统一路径策略。
- 字体缓存 IPC 重写；文档加载时待转换标题处理。
- 自动聚焦编辑器，创建即可输入。
- 修复字体缓存 asset protocol scope，回归 `convertFileSrc`。
- 各类编译告警清理。

---

## [1.2.10] — 2026-07

### Fixed
- Callout 斜杠命令：包裹选中文字而非插入空块。

---

## [1.2.9] — 2026-07

### Fixed
- NSIS 安装器路径修正（自定义 target triple）。

---

## [1.2.8] — 2026-07

### Added
- 自动更新（auto updater）支持。

---

## [1.2.7] — 2026-07

### Fixed
- CJK 加粗 / 斜体边界修复：ZWNJ 预处理解决中文标点与 `*_**` 定界冲突。

---

## [1.2.6] — 2026-07

### Fixed — roundtrip 稳定性
- 列表 / codespan / 标题 / fence / URL / 水平线 多处序列化往返修复。

---

## [1.2.5] — 2026-07

### Changed
- 移除单实例限制，多进程独立 WebView2 数据目录（每个窗口独立）。

---

## [1.2.3] — 2026-07

### Fixed
- NSIS 安装时注册表修复（无需启动即可生效）。
- 显示名修复（`solo文档`）。
- ShellNew 去重、中文显示名、图标索引、版本号同步。

---

## [1.2.2] — 2026-07

### Added
- 粘贴 Markdown 自动转换。
- 剪贴板复制（Copy as Markdown/HTML）。
- PDF 按钮重命名。

### Fixed
- P0 菜单事件、P1 Callout/注册表/重命名、性能优化。

---

## [1.2.1] — 2026-07

### Added
- 多窗口。
- 内存优化。
- 脚注（footnotes）。

### Fixed
- 失焦时不再销毁编辑器，保持内容可见。

---

## [1.2.0] — 2026-07

### Added
- 窗口置顶（Always on Top）。
- 字体按需下载（Rust reqwest 绕过 CSP/CORS），下载进度条。
- `.md` 文件图标与右键「新建 .md」注册。
- 启动闪烁修复：窗口先隐藏，状态恢复后显示。
- 多窗口内存优化（WebView2 `MemoryUsageTargetLevel`、失焦降内存、销毁链加固）。
- 主题切换行间距修复。
- Callout 多轮设计迭代（最终对齐 GitHub Markdown Alerts：左边框 + icon）。
- 表格 CSS 对齐 prosemirror-tables 官方设计，列拖拽独立调整。
- 文件名随 displayName 变更自动重命名。

---

## 更早版本

- **v1.1.x** — 极简 Markdown 编辑器起步阶段（含沉浸模式、置顶图标、Callout 早期设计等）。
  详细提交可在仓库 `git log` 中查阅。

---

## 版本号规则速记

| 变更类型 | 升哪位 | 示例 |
|---|---|---|
| 新增功能 / 非破坏性改进 | 次版本 | 1.2.8 → 1.2.9 |
| 仅修复 bug | 修订号 | 1.2.9 → 1.2.10 |
| 破坏性变更 | 主版本 | 1.x → 2.0 |

发版完整流程见 [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md)。
