---
title: solo 敏感区速查（改码前必读）
type: core
audience: dev
status: active
tags: [敏感区, 安全网, 改码约束]
summary: 易错区速查表 + §11.1–§11.8 详解；每条链 KNOWN-ISSUES 实证。改码前必读对应行。
updates: [src/stores/file.ts, src-tauri/src/commands/document.rs, serializer.ts, src-tauri/src/state.rs, useEditorSync.ts, registry.ts, command-names.ts, themes/manager.ts, extensions/*, editor-extensions.ts, docs/KNOWN-ISSUES.md]
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
| 15 | 列表容器与项类型判定（**「容器肯不肯装」直接决定内容存亡**：`bulletList`/`orderedList` 的 content 须为 `(listItem \| taskItem)+`，`taskList` 保持 `taskItem+`；容器判定须为「本层**全部**项都是任务项」且**跳过嵌套层**。任一处收紧 ⇒ `createAndFill` 失败 ⇒ `closeNode()` 静默丢弃整段。**动前先看 `schema-contract.spec.ts` 的正向契约锁**——差异集校验看不出「约束被一致地改错」） | [`parser.ts`](../src/components/Editor/tiptap/markdown/parser.ts)（`areAllTopLevelItemsTasks`）+ [`editor-extensions.ts`](../src/components/Editor/tiptap/editor-extensions.ts) + [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts) | [KNOWN-ISSUES §二 #10](./KNOWN-ISSUES.md) |
| 16 | mark 定界符的开合顺序（**「后开先关」是硬契约**：`renderMarks` 关闭时须按**实际打开顺序**逆序遍历 `activeMarks`（该数组按打开时间追加），**不能**按 `node.marks` 数组序——后者是 schema 的 marks 定义序（`link` rank 0 早于 `italic` rank 3），错序会把外层收尾符写进内层收尾符**之前**，输出即坏语法（`*foo [bar](/url)*` → `*foo [bar*](/url)`），用户保存一次就改坏文件。另两处同源禁忌：`code` mark 已放开 `excludes`（须与 bold/italic 共存，别再改回 `'_'`）；`renderContent` 须跳过列表项内「首块空段落且后面还有块」的**模型补位段**（独块空段落不跳，`- ` 空项照常）） | [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts)（`renderMarks` / `renderContent`）+ [`editor-extensions.ts`](../src/components/Editor/tiptap/editor-extensions.ts)（`Code.extend`） | [KNOWN-ISSUES §一 #26](./KNOWN-ISSUES.md) |
| 17 | 运行时注入 `<style>` 的库 + Tauri prod CSP nonce（**`tauri dev` 验不出**：dev 不附加 CSP，`tauri build` 才注入 nonce ⇒ `'unsafe-inline'` 被忽略 ⇒ mermaid `render()` 经 innerHTML 注入的主题 `<style>` 被静默拦截、形状回退黑色。三版才修对。**任何 lit / KaTeX 类库同坑**，解法 `dangerousDisableAssetCspModification: ["style-src"]`，`script-src` 的 nonce 保留不降级） | [`mermaid-block.ts`](../src/components/Editor/tiptap/extensions/mermaid-block.ts) + [`tauri.conf.json`](../src-tauri/tauri.conf.json) | [KNOWN-ISSUES §一 #1](./KNOWN-ISSUES.md) |
| 18 | callout NodeView 属性同步（NodeView 创建裸 `div.mk-callout` 不挂属性 ⇒ `addAttributes.renderHTML` **只作用于剪贴板/HTML 序列化、不作用于 NodeView DOM** ⇒ `data-callout-type` 从未出现在编辑器 DOM，类型配色一直失效、`::before` 标签为空。**改 callout 配色/CSS 前先确认 NodeView 已同步属性**） | [`extensions/callout.ts`](../src/components/Editor/tiptap/extensions/callout.ts) | [KNOWN-ISSUES §一 #20](./KNOWN-ISSUES.md) |
| 19 | 互链改名同步（改文件名后回写同目录文档里的 `[[旧名]]`：`rename_file` 落盘成功后扫同目录、**跳过改名后的当前文档自身**、`rewrite_wikilink_targets` 逐行**跳过 ``` / ~~~ 围栏代码块内的示例**、先 `dry_run` 列清单确认再 `atomic_write`；单文件失败静默跳过、绝不阻断改名） | [`document.rs`](../src-tauri/src/commands/document.rs)（`sync_wikilinks_on_rename`）+ [`useDocumentSession.ts`](../src/composables/useDocumentSession.ts)（`syncInboundWikilinks`） | [KNOWN-ISSUES §一 #23](./KNOWN-ISSUES.md) |
| 20 | `.tmp` 原子写残留清理（`save_document` 产生 `.{文件名}.{毫秒}.tmp`，崩溃路径无清理；`open_document` 兜底 `cleanup_stale_tmp_files` **仅删匹配 `.{原文件名}.{纯数字}.tmp` 且 mtime 超 1h 的残留**，避免误伤双开进程正在写的 .tmp，失败静默） | [`document.rs`](../src-tauri/src/commands/document.rs)（`cleanup_stale_tmp_files`） | [KNOWN-ISSUES §一 #19](./KNOWN-ISSUES.md) |

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
- 主题色彩映射只在 `types.ts::CSS_VAR_MAP`：**任何要跟随主题切换的颜色，必须同时在 `ThemeColors` 接口与 `CSS_VAR_MAP` 登记，禁止只在 `main.css` 写死某个颜色**——否则切预设主题时该色不随主题变化（参考 2026-07-21「状态栏未保存指示不随主题」bug：`--dirty-color` 漏登记导致始终回退书卷气默认值）。
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

- `text/html` 由 ProseMirror 默认生成；**solo→solo 粘贴走 HTML + 各扩展的 `parseHTML`，不依赖 text/plain**。
- 需要主动拿 Markdown 源码时用命令 `edit.copyAsMarkdown`（Mod+Shift+M / 命令面板），它复用下面的剪贴板轻量转义。

`escapeInline` 按 `clipboard` 标记分两套转义，两者**故意不同，别互相"修正"**：

| 模式 | 入口 | 行内转义集 | 行首额外转义 |
|---|---|---|---|
| 文件落盘（严格） | `serializeMarkdown()` | `` ` [ ] ( ) * ~ ^ = \| $ < > { } `` | `# + - .` |
| 剪贴板（轻量） | `serializeMarkdownForClipboard()`（经 `serializeClipboardSlice`：回落路径 + `edit.copyAsMarkdown`） | `` ` * ~ [ ] < > `` | `# + - . > =` |

**改动铁律**：块处理器需要**嵌套序列化**（引用块内部、表格单元格文本）时，必须用 `state.createChild()` 拿内层 state，**不要 `new MarkdownSerializerState()`**——默认构造是文件模式，会把外层 clipboard 标记丢掉，导致粘到外部编辑器的内容多出 `\=` `\$`。只有上面两个真入口允许直接构造。

另一处坑：表格的**列宽统计**与**内容输出**必须调同一个 `cellToText(state, cell)`，否则 `padEnd` 对齐用的长度与实际写入的字符串不是同一份，表格会错位。

---
