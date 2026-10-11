---
plan_id: CP-20261011-002
revision: 6
reviewers: []
---

# CP-20261011-002：复制全文为 HTML 换生产者——出站 HTML 单一产出点 + 出站归一层

> **rev6 相对 rev5 的改动**：① 验收 #3 的签名比对**必须对两侧先施同一套清洗**（否则 `frontmatter` 被删、文本与属性里的 U+200C 被剥这三类**设计目的本身**会被当成回归，测试必红且红得没有信息量，最坏结局是实现者把 #3 整条删掉——而 #3 是唯一能抓住 PM 静默变形的锁）。② `<thead>` 提升已由第三方实测对 PM 签名**完全透明**（增删 0/0），保留，rev5 给它准备的撤除退路用不上，但仍由 #3 兜底。③ 幂等标记的作用域写清（只打在承载 div 自身，`innerHTML` 不含它 ⇒ 不出站），并在 1-A 补一条兜底断言。④ `code` 归回 1-B 守恒集（本版不新增 `<pre><code>`，它本就不该变）。⑤ 行号纠误：`FootnoteDef.content` 在 `footnote.ts:56`（rev5 写成 `:57`）。

> 立项自 CP-20261011-001 的「P1-4 另案」。CP-20261011-001 只落了 P1-1/P1-2/P1-3（脚注 `fromString` 数字强转、`sup` 规则优先级、整表选区丢 GFM），已提交 `8e2a0a3`，与本方案无交叉改动。
>
> **rev5 相对 rev4 的改动**（全部由 A 自己回磁盘核实，不含任何未验证的假设）：
> ① 归一层**换目录**（`src/utils/` → `src/components/Editor/tiptap/`），并取消对 `normalizeCalloutType` 的引用 ⇒ 不再新增跨层 import 环（台账 §二 #14 记的正是这类债）。
> ② 规则 2：**没有标题的提示块不再编造标题**（原来是 `title || 类型词`，会把 `note`/`warning` 这种英文词凭空写进别人的文档）。连带效果：①里那条「同一判据存在两处」的受控重复自动消失。
> ③ 规则 4：**撤掉脚注区前那条 `<hr>`** —— `horizontalRule` 未被关掉，粘回 solo 会在正文里多出一条真分隔线，为对外好看赔这个不值。
> ④ 规则 5：「换行会被折叠」这句话拆成**两个读者**——回到 solo 时 `code: true` 使 `whitespace === "pre"`（`prosemirror-model/dist/index.js:2141-2142` + `:2700`），本来就不塌；会塌的是浏览器/Word 那些外部消费者。结论不变，论据换准。
> ⑤ 规则 6：`style` 的摘除走 **CSSOM**（`el.style.removeProperty('min-width')`），不做字符串切割。
> ⑥ 规则 10：幂等需要一个**「已归一」标记**才成立（rev4 同时要求「重复跑零变化」和「跑时要删 `data-title`」，是自相矛盾）。
> ⑦ ④ 出站**抛错也要回落**旧管道（退化安全），并纠正「`getContent()` 不会抛」的说法——爆点是 `MarkdownEditor.vue:910` 的 `serializeMarkdown(doc)`。
> ⑧ 验收 #1 的对照文档必须**逐字写出 markdown**：ZWNJ 只在「强调闭合符紧跟标点」时才插入（`parser.ts:726-736` 的预处理 + `\p{P}\p{S}` flanking），摘要式写法一个隐形字符都产不出来，正向对照就成了永远绿灯的空判据。
> ⑨ 验收去重与纠误：`bun run build` 本身已含 `vue-tsc --noEmit`（`package.json:10`）；`ParseOptions` 的真实成员是 `preserveWhitespace / findPositions / from / to / topNode / topMatch / context`，**没有 `schema`、没有 `fromPaste`、也没有我 rev4 写出的 `recordSelection`**（`prosemirror-model/dist/index.d.ts:461-`）。
> ⑩ charset 那条从「最后一项冒烟」提前到「动手前一次性确证」，因为它一旦成立要改的是归一层的**输出契约**，届时全部期望值重写。

## 问题

「复制全文」按钮的 `text/html` 走的是**第二条渲染管道**：`doc → serializeMarkdown → markdown 字符串 → markdown-it → HTML`。先把 PM doc 摊成 markdown，再交给一个**不认识 solo 私有语法**的通用解析器重渲染。这条债记在 `docs/KNOWN-ISSUES.md` §二 **#16 ③**（「双 markdown-it 管线（`parser.ts` vs `utils/markdown-to-html.ts`，后者仅 `StatusbarQuickActions.vue` 一个消费者）」），本方案是它的收敛动作。

Ctrl+C 的 `text/html` 则由 ProseMirror 的 `DOMSerializer` 产出（走各扩展 `renderHTML`）。**同一条「对外复制」两个生产者**，是台账教训 C2「修一条漏一条 = 没修完」的结构根源：新扩展只要写了 `renderHTML`，按钮永远不跟上。

按钮这条管道的实测失真（2026-10-11 双管道对照探针，逐元素比对）：

| 编号 | 形态 | 按钮当前产出 | 性质 |
|---|---|---|---|
| P1-4a | `> [!NOTE] 我的标题` | `<blockquote><p>[!NOTE] 我的标题…` —— 裸标记进正文，整块降级成普通引用 | 内容级失真 |
| P1-4b | `[[我的页面\|别名]]` | 原样 `[[我的页面\|别名]]` | 内容级失真 |
| P1-4c | `$E=mc^2$` / `$$ … $$` | `<eq>E=mc^2</eq>` / `<section><eqn>…</eqn></section>` —— `<eq>/<eqn>` 是 texmath **identity 引擎**（`markdown-to-html.ts:65`）外面那层自造标签，外部消费者不认识 | 非法标签 |
| P1-4d | ` ```mermaid ` | `<pre><code class="language-mermaid">` —— 等宽、保换行、带语言名 | **本版低于此水位**（已知降级 3） |
| P1-4e | `![图注\|200x100](./a.png)` | `<img src alt>` —— **宽高丢失**（PM 侧带 `width`/`height`） | 属性丢失 |
| P1-4f | 双管道漂移（根因） | 见上 | 架构 |

**实测新抓到的既有缺陷（发生在 Ctrl+C，非本方案引入）**：DOMSerializer 的 HTML 产出含 **4 个 U+200C（ZWNJ）**。落盘管道剥它（`serializer.ts:438-442` 的 `href`/`title`、`:721-730` 的 `alt`/`title`/`src`，注释分别写着「实测中招」与「属性通道不经过 `escapeInline`」，溯源 §二 #32 / 敏感区 #23④），`renderHTML` + 原始文本这条路**没人剥** ⇒ 现在粘到 Word 就已经在带隐形字符。记为 **P1-5**：本版归一层修掉**按钮**这条路，**Ctrl+C 不修**（可行性见「不改什么」）。

**一条贯穿全案的红线**：出站 HTML 里的私有标签与属性**不只是噪声，它们同时是 solo→solo 粘贴的语义载体**。所以本版只许「加东西、改文字、删明确有害的三样」，**不许换私有节点的标签名、不许删私有属性、不许往内容规格装不下的节点里塞东西**。

## 代码仓

后续审核者只从以下路径读代码。**`docs/` 下只读列出的这三个文件，不做目录级检索**（`docs/REVIEW-*` 是带日期的审核快照，读到同题审核会影响独立判断）。

- `src/utils/markdown-to-html.ts`
- `src/components/StatusbarQuickActions.vue`
- `src/components/Editor/MarkdownEditor.vue`
- `src/composables/useAppEditorState.ts`、`src/composables/useEditorSync.ts`
- `src/App.vue`
- `src/components/Editor/tiptap/`：`zwnj.ts` `editor-extensions.ts` `editor-commands.ts`
- `src/components/Editor/tiptap/extensions/`：`callout.ts` `wikilink.ts` `math-inline.ts` `math-block.ts` `mermaid-block.ts` `frontmatter.ts` `footnote.ts` `image.ts` `dim.ts` `code-block.ts` `table.ts` `markdown-paste.ts`
- `src/components/Editor/tiptap/markdown/`：`serializer.ts` `parser.ts` `plugins/callout.ts` `plugins/footnote.ts`
- `src/components/Editor/tiptap/markdown/__tests__/`：`clipboard-serializer.spec.ts` `roundtrip.spec.ts` `test-utils.ts`
- `src/commands/registry.ts`
- `node_modules/prosemirror-view/dist/index.js` 与 `index.d.ts`
- `node_modules/prosemirror-model/dist/index.js` 与 `index.d.ts`
- `node_modules/@tiptap/extension-list/dist/index.js`、`node_modules/@tiptap/extension-task-item/dist/index.js`（后者是 re-export 壳，真身在 `-list`）
- `node_modules/@tiptap/extension-table/dist/index.js`、`node_modules/@tiptap/extension-code-block/dist/index.js`
- `node_modules/@tiptap/core/dist/index.js`
- `package.json`、`vitest.config.ts`
- `docs/sensitive-areas.md`（#13 / #17 / #18 / #23 / §11.8）
- `docs/KNOWN-ISSUES.md`（§二 #14 / #16 ③ / #32）
- `AGENTS.md`

## 现状

**按钮链路**：`StatusbarQuickActions.vue:35 copyMarkdown()` —— `:37` 取数（`getContent?.()` 或 store 兜底）在 `:38` 的 try **之外**；`:39` `await renderMarkdown(content)`；`:40-45` `ClipboardItem` 双槽（`text/plain` = markdown 源、`text/html` = 渲染结果，**Blob 不带 charset**）；`:51-58` catch 置 `copyFailed`（M-22：失败必须有可见反馈）。`markdown-to-html.ts:73 renderMarkdown()` → `:34-71 ensureRenderer()`（懒加载）→ `:75` `_md.render(sanitizeForExternal(markdown))`；`:17-24 sanitizeForExternal` 只做两件事（`:22` 复用解析侧 `FRONTMATTER_RE` 剥 frontmatter、`:23` 剥 `mk-dim`），**不处理 callout/互链/数学**。装配表 `:58-68`：`html:false`、`linkify:false`、`table`/`strikethrough`、task-lists、mark、sub、sup、texmath、footnote。

**Ctrl+C 链路的产出点与时序**（`prosemirror-view/dist/index.js`）：`:2812 transformCopied` → `:2813-2820` 收 openStart/openEnd 与 context → **`:2821` `view.someProp("clipboardSerializer") || DOMSerializer.fromSchema(...)`** → `:2822-2823` `detachedDoc()` 建 div 并 `appendChild(serializer.serializeFragment(content, {document: doc}))` → `:2825-2834` 按 `wrapMap` 补包裹 → **`:2835-2836` 才写 `data-pm-slice`** → `:2837-2838` text 槽走 `clipboardTextSerializer`。粘贴侧 `:2876-2877` 读回。类型面 `index.d.ts:826 clipboardSerializer?: DOMSerializer`、`:833 clipboardTextSerializer`。
⇒ 钩子存在、粒度是「换一个 DOMSerializer 实例」，注入者拿到的 fragment **早于** `data-pm-slice`。本仓 `MarkdownEditor.vue:331-344 editorProps` 只覆写了 `clipboardTextSerializer`（`:341-343`），`text/html` 全交 PM 默认。`MarkdownEditor.vue:670-698 onEditorCopy()` 只在 `CellSelection` 时改写双槽（`:660-668` 注释：PM 默认带出固定像素 `<colgroup>` 会让 Word/WPS 变死宽 —— **只修了单元格选区，整篇这条路还在**）。

**出站 HTML 会不会被 solo 自己吃回去**：`extensions/markdown-paste.ts:475-485` 在双槽齐备时先嗅探，`hasMarkdownOnlySyntax`（`:147-176`）认 **frontmatter / `$$` 块 / `[[…]]` / `> [!TYPE]` / 行内 `$x$`** 五类；命中 → 强制走 markdown 源码管道。命中不了才吃 HTML。另外 `:477` 的 `inCode` 会让嗅探整个跳过（代码块内粘贴），而 `:27` 的 Layer 4 注释写明「**text/html 不可用（WebView2 常见）**」⇒ 真机上 HTML 槽常常根本读不到。**⇒ HTML 槽被真实使用的场景 = 不含那五类标记的文档 + 代码块内粘贴**，范围比直觉小，但不是零。

**嗅探集之外的私有形态**（这些必须靠 HTML 槽还原，是归一的硬约束对象）：

| 形态 | 命中判据（出处） |
|---|---|
| 任务列表 | `li[data-type="taskItem"]`（priority 51）+ `data-checked` —— `@tiptap/extension-list/dist/index.js:1198-1213`（`-task-item` 只是 re-export 壳） |
| 脚注 | `sup[data-footnote-ref]` `extensions/footnote.ts:25`、`div[data-footnote-section]` `:43`、`div[data-footnote-def]` `:71` —— **三者都只判属性存在**，而 `:29`/`:47`/`:75` 写出的正是**空串值** |
| 行内公式 | `span[data-type="math-inline"]` `extensions/math-inline.ts:19-21` |
| mermaid | `div[data-type="mermaid-block"]` `extensions/mermaid-block.ts:281-283`（` ```mermaid ` **不在嗅探集内**） |
| 变浅 / 图片尺寸 | `span.mk-dim` `dim.ts:15-17`；`width`/`height` `image.ts:301-316` |
| callout / 互链 / 块公式 / frontmatter | 在嗅探集内，正常粘贴走 markdown 路；仅「代码块内粘贴」才吃 HTML |

**节点的内容规格决定「能不能往里塞东西」**（rev4/rev5 撤掉两条规则的直接依据，全部读自磁盘）：`FootnoteSection.content = 'footnoteDef+'`（`footnote.ts:38`）、`FootnoteDef.content = 'block+'`（`:56`）、`Callout.content = 'block+'`（`callout.ts:34`）、`MermaidBlock.content = 'text*'` + `code: true`（`mermaid-block.ts:271-272`）、`MathBlock.content = 'text*'` + `code: true`（`math-block.ts:29-31`）。往只认 `footnoteDef` 的壳里塞 `<ol>`、往 `text*` 里塞 `<pre>`，PM **不报错**：`findPlace` 会向上爬到文档层找放得下的位置，`sync`/`closeExtra` 把外壳当多余层闭掉 ⇒ 结果是**外壳变空壳、注入内容掉到正文顶层**（`NodeContext.finish` 用 `create` 不校验）。⇒ 只有 `block+` 的壳允许注入段落，本版仅用在 callout 标题这一处。

**代码块语言标签唯一来源**：`@tiptap/extension-code-block/dist/index.js:38-45` —— `language` 的 `parseHTML` 只看 `element.firstElementChild.classList` 里 `language*` 前缀。而 `MermaidBlock.addAttributes()` 返回 `{}`（`mermaid-block.ts:277-279`）、`MathBlock` 同样无语言属性 ⇒ **这两个节点没有 `language` 属性可断言**，包 `<code class="language-x">` 对 solo 侧零收益，只对外部呈现有意义。

**表格宽度**：`@tiptap/extension-table/dist/index.js:79-80` 解析读 `colwidth`（逗号分隔），`:112-118` 声明 `colspan/rowspan/colwidth` 且 **`colwidth` 默认 `null`、无自定义 `renderHTML`** ⇒ 只有值非空才写出；`:216-218`/`:292-294`/`:298` 由它算出 `<col><colgroup>` 与 `style` 宽度。实测（带 `:---:` 的表格）产出里**没有** `colwidth` ⇒ `colgroup`/`style` 的宽度是**与内容无关的布局壳**（Word 会执行 = 死宽，删），`colwidth` 只在用户**拖过列宽**后才存在（Word 忽略非标准属性、solo 靠它还原，留）。
**表格对齐活在 `style` 里**：`parser.ts:517-530` 把 `:---:` 读进 `align` attrs，`-table` 按 inline `style="text-align"` 渲染并优先解析它 ⇒ **不能整体删 `style`**。

**私有节点 `renderHTML` 实测产出**（DOMSerializer 通道，已两轮独立复现，逐项吻合）：`<div data-type="frontmatter" class="mk-frontmatter">title: …</div>`；`<div data-callout-type="note" class="mk-callout" data-title="我的标题">正文</div>`（**标题只在属性里**，可见标题由 NodeView `callout.ts:118-123` 现算 `title || normalizeCalloutType(type)`，`:122`/`:22`）；`<span target alias data-wikilink="…" class="mk-wikilink" title="…">别名</span>`；`<span latex data-type class="mk-math-inline" data-latex>E=mc^2</span>`；`<div data-type="math-block" class="mk-math-block">\int…</div>`；`<div data-type="mermaid-block" class="mk-mermaid-block">flowchart TD\n  A --&gt; B</div>`；`<sup label="1" data-footnote-ref="">[^1]</sup>`；`<div data-footnote-section=""><div label="1" data-footnote-def=""><p>…</p></div></div>`；`<img class="mk-image" loading="lazy" src="./assets/a.png" alt="图注" width="200" height="100">`（`src` 相对路径，`_localSrcResolver` 只在 NodeView 里解析 `image.ts:432-435`，两条管道对外都裂图）；`<span class="mk-dim">`；`<a rel="noopener noreferrer nofollow" class="" href="…">`（空 `class=""` 出自 `editor-extensions.ts:287`）；`<div class="tableWrapper"><table class="mk-table" style="min-width: 100px;"><colgroup>…<tbody><tr><th colspan="1" rowspan="1"><p>…`。

**ZWNJ 的产生条件**（决定测试文档怎么写）：`parser.ts:726-736` 的预处理只在「强调定界符与 `\p{P}\p{S}` 标点相邻」时插入 ZWNJ，且代码区事先被占位保护。⇒ 摘要式、空格分隔的 fixture **产不出 U+200C**。实测有效的写法形如 `含 **粗**、*斜*、` 这种闭合符紧跟顿号的形态（本次探针实测 PM 侧 4 个、markdown-it 侧 0 个）。

**取 doc 的能力已具备，不需要新 expose**：`useAppEditorState.ts:6-20` 已有 `getDoc?: () => PMNode | null`（实现 `MarkdownEditor.vue:914`，体是 `editor.value?.state.doc ?? null`，不抛）；`getContent`（`:902-913`）在 `:910` **调 `serializeMarkdown(doc)`，这一句才是会抛的爆点**（`:902-903` 只是「无实例返回 null」的守卫）。`node.type.schema` 直接可取；`DOMSerializer…serializeFragment()` 返回 `DocumentFragment`，需临时 div 承载再取 `innerHTML`。`test-utils.ts:23 createTestSchema()` 复用生产 schema（`:9-20` 禁止再手抄镜像）。

**回读用的公开 API（rev4 这里写错过）**：`DOMParser.parse(dom, options?: ParseOptions): Node` 在 `prosemirror-model/dist/index.d.ts:688`（`:697` 是 `parseSlice`）；`ParseOptions`（`:461-`）成员是 `preserveWhitespace?: boolean | "full"` / `findPositions` / `from` / `to` / `topNode` / `topMatch` / `context` —— **不含 `schema`、不含 `fromPaste`、不含 `recordSelection`**。`preserveWhitespace: true` 的语义是「把换行归一成空格」，`"full"` 才是整体保留。仓里已有正确调用可抄：`clipboard-serializer.spec.ts:339-347`。

**分块事实**：`App.vue:18` **静态** import `StatusbarQuickActions.vue`，而 `:37` 的 `MarkdownEditor` 是 `defineAsyncComponent(() => import(...))` ⇒ 归一层若被状态栏静态引入，会把 `@tiptap/*` 与各扩展拖进入站 chunk。既有先例：`markdown-to-html.ts:34-71` 把重依赖全部 `await import()`。

**层级约束**：台账 §二 **#14** 记的是「`composables/` 反向 import `components/` 下 5 个无 UI 领域工具」这类环。归一层必然要用 `tiptap/zwnj.ts` 的 `stripZwnj`（唯一来源，敏感区 #23），所以**新文件落在 `src/components/Editor/tiptap/` 下**（与 `zwnj.ts`、`composition-freeze.ts` 同层，也与同为「无 UI 领域工具」的 `markdown/serializer.ts` 一处），不做 `src/utils/` → `components/` 的新环。

**回落路径真实存在**：编辑器挂在 `App.vue:364-372` 的 `v-if="activeViewMode === 'editor'"` 上，切图片预览即卸载（卸载前 `useEditorSync.ts` 的 `flushPendingSerialize` 已把编辑同步进 store），此时 `getDoc()` 为 null ⇒ `copyMarkdown:37` 的 store 兜底就是为这条写的。

**测试工具链**：`package.json:16 "test": "vitest run"`、`:73 happy-dom`、`:80 vitest`，**无 `@vue/test-utils`** ⇒ 本版不做组件挂载测试。`package.json:10 "build": "vue-tsc --noEmit && vite build"` ⇒ 类型检查**已含在 build 里**，不重复列项。

**不变量**：敏感区 #13 与 §11.8（`docs/sensitive-areas.md:115-140`）定死 `text/html` 与 `text/plain` 是两条独立管道，`:128` 明写「`text/html` 由 ProseMirror 默认生成」——这句是本方案要改的对面。本方案**只换 `text/html` 的生产者**，`text/plain` 一个字节不改。

## 改法

**定调**：按钮的 `text/html` 换用与 Ctrl+C **同一个** `DOMSerializer`，再套一层**出站归一**；归一在 **DOM 上做**，不碰 markdown 字符串（字符串预处理会误伤围栏内容，CP-20261011-001 已证）。

**三条总约束**（高于下面任何单条，冲突时以它们为准）：

- **C-1 不换标签名、不删载体**：私有节点的标签与属性一律保留。
- **C-2 空串属性即选择器**：除 `class` 外，任何属性剥完 ZWNJ 变空**也不删**。
- **C-3 不往内容规格装不下的壳里塞元素**：块级私有节点（脚注区/定义、数学块、mermaid 块）的内部结构**一字不动**；对外表现只能靠**加内联样式与类名**，达不到的部分登记为已知降级。

**归一分两组，清洗放最后**：*改写组*（仅对外，动语义）→ *清洗组*（不改语义：ZWNJ、空 `class`）。清洗放最后，才能覆盖改写过程中从属性新写出的文本与全部保留属性值。**清洗组将来可以单独挂到 Ctrl+C 上（`editorProps.clipboardSerializer`，`data-pm-slice` 由 PM 在其后补，不受影响）；改写组永远不行。**

**① 新增 `src/components/Editor/tiptap/externalize-html.ts`** —— `export function externalizeHtml(root: HTMLElement): void`（原地改 DOM）。入口第一行判 `if (root.hasAttribute('data-solo-externalized')) return;`，函数末尾置该属性 ⇒ 幂等成立（规则 2/6 会删东西，没有这个标记重复跑就会叠加）。⚠️ **标记只打在 `root` 自身**：调用方取的是 `root.innerHTML`，而 `innerHTML` **不含 root 自己的属性** ⇒ 标记不会进剪贴板。**不许**把标记改打在每个被改写的子元素上（那样它会随 HTML 出站）——1-A 有一条兜底断言守着这件事。

*改写组：*

1. **删 frontmatter**：`div[data-type="frontmatter"]` 整节点移除（对齐现状 `sanitizeForExternal` 的语义，`markdown-to-html.ts:22`）。
2. **callout 标题落到可见层**：外壳 `div` 与其 `class="mk-callout"`/`data-callout-type`/`data-fold` **全部保留**；**当且仅当 `data-title` 非空**时，在内容最前插入 `<p><strong>{trim 后的标题}</strong></p>`，并**删除外壳的 `data-title`**。`data-title` 为空 ⇒ **什么都不注入**（原方案的 `title || 类型词` 会把 `note`/`warning` 这种英文词凭空写进用户文档，撤掉；连带不再需要 `normalizeCalloutType`，跨层引用消失）。
   - 为什么删 `data-title`：不删则粘回 solo 时「attrs.title + 正文首段」两份标题并存。删后对外正确，对内标题降级为正文首段——且几乎不会发生：含 callout 的文档正常粘贴被嗅探接管，`text/plain` 里 `> [!NOTE] 我的标题` 完好（写出点 `markdown/plugins/callout.ts:200-208`）。只有「代码块内粘贴」吃 HTML 路径。
   - `Callout.content = 'block+'`（`callout.ts:34`）⇒ 注入段落是内容规格允许的，这是全案唯一一处结构注入。
   - **本版不动 NodeView**（`callout.ts:118-123` 一行不改，避免敏感区 #18 + 禁令 12 的连带成本）。
3. **脚注引用**：`sup[data-footnote-ref]` **保留标签、`label`、空串 `data-footnote-ref`**，只把文本节点改成 `[label]`；`label` 为空则文本不动。
4. **脚注区**：`div[data-footnote-section]` 与每个 `div[data-footnote-def>` **一律原样不动**。**不建 `<ol>`/`<li>` 列表**（`footnoteDef+` 装不下，会静默把外壳闭成空壳，见「现状」），**也不插 `<hr>`**（会在正文多一条真分隔线）。⇒ 对外呈现是「上标 `[1]` + 文末若干段落」，编号不显式；登记为已知降级。
5. **块公式 / mermaid**：外壳 div **保留且内部一字不动**，只给外壳加内联样式 `white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace`，并把语言名并入外壳 `class`（mermaid 那个壳加 `language-mermaid`）。
   - 两个读者分开说：回到 solo 时 `code: true` ⇒ `whitespace === "pre"`（`prosemirror-model/dist/index.js:2141-2142` + `:2700`），**换行本来就不塌**；会塌的是浏览器/Word 这类按 HTML 规则折叠空白的外部消费者，所以这句内联样式是给它们的。Word 对 `white-space` 支持不完整 ⇒ **在 Word 里可能被压成一行**，登记为已知降级，真机按目标分别验收。
   - 行内公式不动结构，仅由清洗组处理。**本版不渲染 KaTeX**（见「不改什么」）。
6. **表格**：删 `<colgroup>`；用 **CSSOM** 摘宽度——对每个有 `style` 的元素 `el.style.removeProperty('min-width'); el.style.removeProperty('width')`，摘完若 `el.getAttribute('style') === ''` 才删 `style` 属性（**保留 `text-align`**，见「现状」）；`colwidth` **不删**（拖过列宽的文档靠它还原）；`div.tableWrapper` 用子节点替换（纯布局壳，不参与 `parseHTML` 命中）；`td/th` 上 `colspan="1"`/`rowspan="1"` 删（非 1 保留）；某 `<tr>` 内全为 `th` ⇒ 提进 `<thead>` 置于 `<tbody>` 前。
   - `<thead>` 提升：rev5 把它标为「唯一结构可疑动作」，rev6 已有实测答案 —— 它对 PM 的**类型路径签名完全透明**（增删 0/0，`<thead><tr><th>` 与 `<tbody><tr><th>` 解析回同形），⇒ **保留这一条**，rev5 准备的撤除退路用不上。仍由验收 #3 兜底（万一实现方式不同导致签名变化，#3 会红）。
7. **不改的东西**：wikilink（显示文字已正确，属性按 C-1 全留）、dim（`span.mk-dim` 是 `parseHTML` 判据，留着）。

*清洗组（最后一步，置 `data-solo-externalized` 之前）：*

8. **剥 ZWNJ（敏感区 #23 / §二 #32）**：
   - 文本节点：用 **`document.createTreeWalker(root, NodeFilter.SHOW_TEXT)`** 逐个 `node.data = stripZwnj(node.data)`。⚠️ **`new TreeWalker()` 在浏览器抛 `TypeError: Illegal constructor`，happy-dom 却可能让它过** ⇒ 单测假绿、真机炸（禁令 13）。`stripZwnj` 唯一来源 `tiptap/zwnj.ts`，**不许另写正则，也不许对整串 HTML `split/join`**（会碰标签语法）。
   - **属性值同样过 `stripZwnj`**：遍历所有元素的每个属性。依据是既有契约——`serializer.ts:438-442`（link 的 `href`/`title`，注释「实测中招」）、`:721-730`（image 的 `alt`/`title`/`src`，「属性通道不经过 `escapeInline`」）。DOM 侧 `getAttribute` 恒为 string；`stripZwnj` 自身的 `unknown` 兜底（CP-001 加的那道）保留。
   - 剥完为空**不删属性**（C-2）。
9. **删空 `class`**：`class` 值 trim 后为空 ⇒ 删该属性（`<a class="">` 这类）。**这是全案唯一允许删属性的地方。**

**② 新增 `src/components/Editor/tiptap/clipboard-html.ts`** —— 整篇 → 对外 HTML 的唯一出口。`export function serializeDocumentHtml(doc: PMNode | null): string | null`：`doc` 为 null → null；否则 `DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content)`（不传 options，用全局 `document`，保证与承载 div 同文档）→ 追加进 **detached** 临时 `div`（`document.createElement('div')`，**不得挂进 `document`**）→ `externalizeHtml(div)` → `div.innerHTML`。

**③ 懒加载接线**：`StatusbarQuickActions.vue` 内 `const { serializeDocumentHtml } = await import('../Editor/tiptap/clipboard-html')`，使 ①② 内部对 `zwnj`、`@tiptap/pm/model` 的静态 import 不进首屏 chunk（依据 `App.vue:18` 静态 / `:37` 异步的分块事实）。

**④ 改 `StatusbarQuickActions.vue:copyMarkdown()`**：

- 取数整段移进 `try`（`getContent()` 在 `MarkdownEditor.vue:910` 会调 `serializeMarkdown`，那才是要防的爆点；`getDoc()` 在 `:914` 不抛），失败落到 `:51-58` 的 `copyFailed`。
- `getDoc?.()` 的三态（方法不存在 / null / doc）统一收敛为 `doc ?? null`。
- `text/html`：先试 `serializeDocumentHtml(doc)`；**该调用抛错时也要回落到 `renderMarkdown(content)`**（退化安全，AGENTS §4），二次失败才报 `copyFailed`；`doc` 为 null 同样回落。
- `text/plain` 仍写 `content`，一字不改；`copied`/`copyFailed`/`onUnmounted` 不动。
- `markdown-to-html.ts` 文件头补一句「仅作无编辑器/归一失败时的回落，正统出口是 `clipboard-html.ts`」。

**⑤ 单测**（见「验收」#1–#3，全纯函数级，不挂组件）。

**⑥ 台账与文档联动** ——

- §二 **#16 ③**：改写为「已按 CP-20261011-002 收敛：整篇出站 HTML 由 `Editor/tiptap/clipboard-html.ts` 单一产出；`utils/markdown-to-html.ts` 降为回落」，状态写「**已实施待复核**」（AGENTS §4：标 `已修复` 须改动者以外按最小复现重跑贴结果）。
- §二 表尾**续号**新增（不硬写编号）：P1-5（Ctrl+C 的 `text/html` 泄漏 ZWNJ；附「清洗组可经 `editorProps.clipboardSerializer` 复用」线索）；粘贴侧数字强转残留（`image.ts:421 attrs.src.startsWith`、`:453 → :67-70 formatImageMarkdown` 的 `.replace`、`wikilink` 的 `target`/`alias` 同型；根因是 Tiptap `fromString` 对无 `parseHTML` 属性做数字强转，与 CP-001 P1-1 同族，属入站侧，本方案不修）；以及本方案的三条已知降级（脚注无显式编号、mermaid/块公式不再是等宽代码块、Word 可能压行）。
- `docs/sensitive-areas.md` **§11.8:128**「`text/html` 由 ProseMirror 默认生成」改为「Ctrl+C 由 PM 生成；**整篇出站由 `clipboard-html.ts` 生成**，新增节点要同时验『renderHTML 产出』与『归一层是否需加规则』」；#23 的属性通道落点清单补一行「出站 HTML（`externalize-html.ts`）」。
- **`docs/REVIEW-*.md` 不回改**：带日期的审核稿是历史快照，记录当时的判断，不随代码演进修改。死链扫描在其中命中的旧表述**只登记不改**，只改活跃文档。

**动手前先确证一件事**（它决定输出契约，成立则全部期望值重写）：现状 `text/html` 是不带 charset 的裸片段（`StatusbarQuickActions.vue:43`）。先做一次最小对照——同一段含中文与 emoji 的产出，分别以「裸片段」与「前置 `<meta charset="utf-8">` 的完整文档」写出，粘 Word 看是否乱码。现状已发布多年未见乱码报障 ⇒ 预期维持裸片段；若确证会乱码，则本方案改的是**输出契约**而非归一规则，需另立修订。

**实施顺序与停靠点**：① 规则 1/3/4/5/6 骨架 + ②③④ → 跑验收 #1-A/#1-B/#2/#3 → ① 规则 2/7/8/9 + 幂等标记 → 跑 #1 全部 → ⑥ 文档联动 → 真机冒烟 #5。每段停下报一次，不一次改到底。

## 不改什么

- **不接管 Ctrl+C 的 `text/html`（本版不修 P1-5）**。论据写准：
  - **钩子存在**——`editorProps.clipboardSerializer?: DOMSerializer`（`index.d.ts:826`，调用点 `index.js:2821`），`data-pm-slice` 由 PM 在 `serializeFragment` **之后**补（`:2835-2836`）。「技术上不可能」是错的（rev1 那句作废）。
  - 本版仍不做的真理由：**改写组动语义**（注入标题、`[^1]`→`[1]`、拆 `colgroup`），而 Ctrl+C 的 HTML 正是 solo→solo 的**语义载体**。**清洗组（剥 ZWNJ / 删空 class）不改语义，可以在下一版单独挂上去**——本方案按两组切分代码就是为此留口。
  - 次要成本：挂上去要动 `MarkdownEditor.vue:331-344`，与 `onEditorCopy` 的 CellSelection 分支（`:670-698`）和 PM 默认行为在同一条 copy 链交织。
- **不换私有标签名、不删私有属性、不往私有壳里塞元素**（C-1/C-2/C-3）。
- **不改任何扩展的 `renderHTML` / `parseHTML` / NodeView**（含 `callout.ts:118-123`）。
- **不做 KaTeX 出站渲染**：DOMSerializer 走 `renderHTML` 而**不经过 NodeView**，公式图形不在这条产出路径上；KaTeX 依赖运行时注入 CSS（`math-block.ts:19`），剪贴板片段不带 `<link>/<style>`，还要过 prod CSP nonce（敏感区 #17）。本版数学判据只有三条：无 `<eq>/<eqn>` 假标签、latex 源码可读、块级换行不塌（对内已满足、对外靠内联样式）。
- **不做本地图片 `src` 绝对化 / data URI 内联**：`image.ts:432-435` 的 `_localSrcResolver` 是异步的，`serializeDocumentHtml` 是同步的；且涉 CSP。另案。
- **不动 `text/plain` 管道**：`serializeClipboardText` / `serializeClipboardSlice` / `edit.copyAsMarkdown`（`editor-commands.ts:152-160`）与 `PLAIN_TEXT_SAFE_NODES` 不改；CP-001 刚落的 `isTableInternal` 不动。
- **不动 `onEditorCopy` 的 CellSelection 分支**（`:670-698`）。
- **不删 markdown-it 及其插件依赖**（回落仍用）。
- **不动 `index.html` / 主题 / 构建配置**。
- **已知降级 1**：切图片预览模式 ⇒ 编辑器卸载 ⇒ `getDoc()` 为 null ⇒ 走 `renderMarkdown` 回落 ⇒ 产出仍带 P1-4a~e 全部失真（本版接受，不在回落里重做归一：没有 doc，拿不到 `renderHTML`）。
- **已知降级 2**：删 `data-title` 后，「代码块内粘贴」这类吃 HTML 的路径上 callout 标题降级为正文首段（文字不丢、不重复）。
- **已知降级 3（C-3 的代价）**：脚注定义区无显式编号；mermaid/块公式不再是 `<pre><code>` 等宽代码块，只靠内联 `white-space: pre-wrap` + 等宽字体，**Word 里可能被压成一行**（浏览器/公众号预期正常）。这两条都低于按钮现状水位，是有意取舍，必须写进台账。

## 验收

1. **`src/components/Editor/tiptap/__tests__/externalize-html.spec.ts`**（`// @vitest-environment happy-dom`，参照 `markdown/__tests__/clipboard-serializer.spec.ts:1` 的环境声明与 `test-utils.ts:23` 的 `createTestSchema()`）。

   **对照文档必须逐字写成 markdown 块**（不许用空格分隔的摘要——那样产不出 ZWNJ，正向对照会成空判据）。要求包含：frontmatter；`#` 标题；一个段落里写 `含 **粗**、*斜*、`行内码`、==高亮==、~~删线~~、H~2~O、x^2^、[真实链接文字](https://example.com)、[[我的页面|别名]]、脚注引用[^1]、行内公式 $E=mc^2$、变浅 `<span class="mk-dim">变浅文字</span>`、图片 `![图注|200x100](./assets/a.png)`（**注意每个强调闭合符后紧跟顿号**，这是 ZWNJ 的触发形态）；`> [!NOTE] 我的标题` + 正文；**无标题的** `> [!WARNING]` + 正文；无序/任务/有序列表；**带 `:---:` 对齐**的 GFM 表格；` ```js ` 围栏；`$$ … $$`；` ```mermaid `；独立引用块；`---`；`[^1]: 定义含**粗体**`。

   四组断言分开写，**不许再用「所有计数相等」这种总括**：

   - **1-A 失真消失（不含）**：`[[`、`[!NOTE]`、`<eq`、`<eqn`、**U+200C**、`mk-frontmatter` 及 frontmatter 正文、`colgroup`、`min-width`、`tableWrapper`、空 `class=""`、裸 `[^1]` 文本、callout 的 `data-title`、**`data-solo-externalized`**（幂等标记只应存在于承载 div 自身，见改法 ①）。
   - **1-B 结构守恒集**：`h1` `em` `code` `mark` `s` `sub` `sup` `a` `table` `td` `th` `ul` `blockquote` `input` `img` 计数归一前后相等。**`code` 在集合内**（本版不新增 `<pre><code>`，规则 5 只加样式；它一旦增减就说明有人给块级壳补了代码元素，违 C-3）；`strong`/`p`/`div` **不在**此集，见 1-C。属性守恒：`<img>` 仍有 `width="200"`/`height="100"`；`<a>` 仍有 `href`；对齐表格仍有 `text-align`；`sup[data-footnote-ref]`/`div[data-footnote-def]`/`div[data-footnote-section]`/`li[data-type="taskItem"]`/`span[data-type="math-inline"]`/`span.mk-dim`/`div.mk-callout`/`span[data-wikilink]` 的**存在性**归一前后一致（含空串值属性）。
   - **1-C 预期变化集**（写死期望）：`div` 净减 = frontmatter 数 + `tableWrapper` 拆壳数；`p`/`strong` **+1**（**仅有标题的那个 callout**；无标题的那个必须**零增加**，防「编造类型词」回归）；`hr`/`ol`/`li`/`pre` 变化 **为 0**（出现增加即违 C-3，判红）；`class` 上 mermaid 外壳多出 `language-mermaid`、块级外壳 `style` 多出 `white-space: pre-wrap`。
   - **1-D ZWNJ 正反向对照**：先断言**归一前**的 DOMSerializer 产出含 **≥1 个 U+200C**（这是正向锁，缺它整条断言恒绿）；再断言归一后为 **0**；并单独断言 `alt`/`title`/`href`/`src` 的属性值内也为 0。

2. **`clipboard-html.spec.ts`**：`serializeDocumentHtml(parseMarkdown(createTestSchema(), 对照文档))` 通过 #1 全部四组；`serializeDocumentHtml(null) === null`；产出**不含** `data-pm-slice`；**幂等**（同一 DOM 连跑两次，第二次 `innerHTML` 逐字相等 —— 靠 `data-solo-externalized` 标记）。

3. **solo 还原回归锁**（本方案最容易自己撞坏的一条）：把 #2 产出装进 detached div，用 **`DOMParser.fromSchema(schema).parse(div)`** 取回 doc（`index.d.ts:688`；**不带任何 option**，写法照 `clipboard-serializer.spec.ts:339-347`）。判据主体是**类型路径签名**：
   - 签名 = `doc.descendants` 逐节点产出 `${深度}:${名称}${关键 attrs 的稳定串}` 序列。**比对之前先对两侧各施同一套「比对清洗」**：① 丢弃 `frontmatter` 节点及其文本；② 对文本与所有属性值剥 U+200C。清洗后的两份签名要求**逐字相等**，**唯一例外**是 callout（内部多一个标题段、`attrs.title` 缺失），这条例外写成**期望差异**，不许因此放宽整个签名。
   - 为什么必须两侧同清洗（rev6 新增，别再写错）：`frontmatter` 被删、文本与属性里的 ZWNJ 被剥，**这三类差异正是归一层的设计目的**；而 ZWNJ 是 markdown 解析期插进文本的（`parser.ts:726-736`），HTML 解析**不会再插回来** ⇒ 「源 doc 有、回读 doc 必然没有」是恒成立的。照「源 doc vs 回读 doc」裸比，测试必红，且**红得没有信息量**——最坏结局是实现者嫌吵把 #3 整条删掉，而 #3 是唯一能抓住 PM 静默变形（外壳被闭成空壳、内容掉到正文顶层）的锁。⇒ 清洗函数写成 spec 内共用的一个 `signatureOf(doc)`，**#3 不许删除、不许改为「节点存在」判据**。
   - 为什么不用「节点存在」：外壳被闭成空壳时 `footnoteSection`/`footnoteDef` 依然「都存在」，`section 的直接子节点全是 def` 这类半截判据也会放行 ⇒ 必须比完整签名。
   - 属性级补三条：`image` 的 `width === 200 && height === 100`；`taskItem` 的 `checked` 正确；**列宽**用**手工构造的带 `colwidth` 的表格文档**（即"拖过宽度"那种）单独断言 `colwidth` 回来 —— **不许**拿对齐表格当证据（它没有 `colwidth`）。
   - `serializeMarkdown(doc)` 含 `- [ ] `/`- [x] `、`[^1]:`、`$E=mc^2$`、` ```mermaid `、`![图注|200x100]`。**不**断言 `mermaidBlock.attrs.language`（该节点无此属性）。
   - callout：`attrs.title` 与正文首段**不得同时**含标题文字（防重复），且二者至少一处含。
   - ⚠️ 本条只锁「归一后的 HTML 仍带 `parseHTML` 载体、且不因归一而变形」，**不等于**跑通真实粘贴插件链（Layer 1/2/2b + 嗅探门 + WebView2 读不到 HTML 的情形），后者由 #5 真机覆盖，两者不许互相替代。

4. **既有测试不许红**：`bun run test` 全量（含 `roundtrip` Phase E、`fixtures`、`schema-contract`、`mark-matrix`、`mark-delimiter-coverage`、`safety-net`）+ `bun run build`（**已含 `vue-tsc --noEmit`**，`package.json:10`，不另列类型检查）。若 build 因 `index.html` 内联 `<style>` 报 `[vite:html-inline-proxy]`：先**改动前跑一次并记录当前失败原文**作为基线，改完只比对「有没有新增别的错误」，基线里的既有环境错按 `RELEASE_PROCESS.md` §11.2/§11.3 绕行或交 CI，**不许为此改 `index.html`**。

5. **真机冒烟（禁令 13：程序化探针不算通行证）**，六项：
   - 四个外部目标：Word、WPS、公众号后台编辑器、浏览器 `contenteditable`。逐项看：callout（有标题的标题可见且不重复、**无标题的没被塞进英文词**）、互链（只剩别名、无 `[[]]`）、数学（无假标签、块级换行）、**mermaid（多行有没有被压成一行——Word 那档预期最差，按目标分别记）**、脚注（上标 `[1]` + 文末定义、**接受无编号**）、表格（**没有死宽**、对齐方向还在、表头被认成表头）、中文标点附近**没有隐形字符**（Word 开「显示/隐藏编辑标记」）。
   - **第五个目标 = 回 solo 自身**（另一窗口 Ctrl+V），并单独走一遍**代码块内粘贴**（HTML 槽被真实使用的场景）。
   - **中文 / emoji 不乱码**——但这条在「动手前确证」里已经前置处理，这里只复核。
   - **懒加载没破**：机械判据 —— `grep -n "tiptap" src/components/StatusbarQuickActions.vue` 的命中必须全部位于 `await import(` 之后；该文件不得出现对 `@tiptap/*` 或 `Editor/tiptap/*` 的顶层静态 `import`。
   - **切图片预览模式再按复制**：回落可用、按钮不报错（失真如「不改什么」已知降级 1 所述）。
   真机判据由简乐给。

6. **死链扫描**（AGENTS §5 硬项）：`grep -rn "markdown-to-html\|StatusbarQuickActions\|copyMarkdown" --include=*.md`，**活跃文档**里命中的旧表述一并改（含 §二 #16 ③、敏感区 §11.8:128，见改法 ⑥）；`docs/REVIEW-*` 不回改。

7. `SOLO_FIDELITY_SCAN=1` 全仓保真体检：**本版默认不需要**（不动 parser / serializer / schema，也不动任何扩展产出）。一旦实施中确实动了 `extensions/*.ts` / `serializer.ts` / `parser.ts`，必须跑全套，并按禁令 12 交「改动前后快照逐字节 diff」。
