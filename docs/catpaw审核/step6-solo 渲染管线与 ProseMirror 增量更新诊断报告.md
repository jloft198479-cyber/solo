# solo 渲染管线与 ProseMirror 增量更新诊断报告（Step 6 合并版）

> 只读排查，未修改任何代码。排查日期：2026-08-21。
> 依据：以实际代码为准。DOM 节点量级为结构估算，非实测；实测结论交叉引用 Step 3 报告。
> 本报告由两份 Step 6 报告合并而成：初版（虚拟滚动视角）+ 修正版（增量更新视角，重点核查「增量更新是否被破坏 + 扩展里有没有拖慢渲染的重操作」）。
> 关联报告：[step2-solo 编辑器输入响应与延迟诊断报告](./step2-solo%20%E7%BC%96%E8%BE%91%E5%99%A8%E8%BE%93%E5%85%A5%E5%93%8D%E5%BA%94%E4%B8%8E%E5%BB%B6%E8%BF%9F%E8%AF%8A%E6%96%AD%E6%8A%A5%E5%91%8A.md)（输入热路径）、[step3-solo 大文档滚动与渲染诊断报告](./step3-solo%20%E5%A4%A7%E6%96%87%E6%A1%A3%E6%BB%9A%E5%8A%A8%E4%B8%8E%E6%B8%B2%E6%9F%93%E8%AF%8A%E6%96%AD%E6%8A%A5%E5%91%8A.md)（滚动行为层）、[step5-solo 搜索、替换与文本操作诊断报告](./step5-solo%20%E6%90%9C%E7%B4%A2%E3%80%81%E6%9B%BF%E6%8D%A2%E4%B8%8E%E6%96%87%E6%9C%AC%E6%93%8D%E4%BD%9C%E8%AF%8A%E6%96%AD%E6%8A%A5%E5%91%8A.md)（编辑期高亮/替换层）。

---

## 〇、前提澄清：「21 个扩展」的实际数字

`createEditorExtensions`（`editor-extensions.ts:130-265`）返回数组实际为 **32 项**：`StarterKit.configure` 1 项 + 自定义扩展 **31 项**。若按「StarterKit 算一个整体」，也不是 21。用户记忆中的「21 个扩展」与代码现状不符，以代码为准：**32 个扩展项，其中 31 个自定义**（含 6 组 Node 型：Frontmatter / Footnote×3 / SemanticHeading / CustomCodeBlock / Table×4 / CustomImage / Callout / MathBlock / MathInline / MermaidBlock，以及 14 个扩展型）。

---

## 一、核心结论

回答本步骤的核心问题：**大文档下卡不卡？卡的话，是 DOM 太多、PM 增量更新被某个扩展破坏了、还是 KaTeX/Mermaid 懒加载失效进了热路径？**

**答案：卡。但三者的责任完全不同——**

1. **DOM 太多：是，结构性主因**。ProseMirror 是全量 DOM 渲染器、不虚拟化，整篇文档常驻 DOM（5 万字文档约 2 万+ 节点）。滚动时浏览器每帧对可见区域做 layout + paint，DOM 树越大每帧成本越高——这是「文档变长滚动变卡」的根因。**注意：这不是「扩展拖慢渲染」，是 ProseMirror 全量渲染器的固有形态**（Obsidian/Typora 同样面临），可修方向是 `content-visibility: auto` 让离屏块跳过 layout+paint（风险点：选中/搜索/scroll-spy 的几何测量）。
2. **PM 增量更新被破坏：否，机制健康**。全量 dispatch 审计（见方向 3）无「每次 update/onUpdate 触发 setContent/重建」的破坏性调用；7 个 NodeView.update 全部返回 true；唯一的整树重建是跨文档 `setContent`（设计如此，切换场景非输入场景）。**没有任何扩展在输入热路径上破坏增量更新。**
3. **KaTeX/Mermaid 懒加载失效：否，未进热路径**。`getKatex`/`getMermaid` 动态 import（首见才下库）；`renderKatex`/`renderMermaid` 只在 NodeView **创建/节点内容变化**时触发；公式/图表块是 `isolating + contentDOM:undefined`，编辑走原生 textarea 不触发 PM update。快速打字（普通段落）不会出现 KaTeX/Mermaid 同步调用栈。**架构文档「懒加载不进解析器热路径」的说法与代码一致。**

**卡顿的阶段分层**：

- **滚动期**：PM 零参与（滚动不产生事务、不重建 DOM、不现算高亮），成本全在浏览器侧 \= 大文本树每帧绘制 + OutlinePanel scroll-spy（有界）。卡顿 \= 结构性 DOM 太多。
- **编辑期**：三个全量重操作集中点拖慢输入——ParagraphFocus（focus-mode 下每次编辑全量重建顶层块 decorations）、markdown-input pending heading decorations（全树扫描，Step 2 P0-3）、code-block-lowlight（块内输入全量重高亮所有代码块，Step 2 P0-1）。其中前两处由本报告审计确认，第三处为 Step 2 已确认项。
- **切换/主题期**：跨文档切换 \= 同步全量序列化+解析+DOM 重建；主题切换 \= 全文档 `*` 过渡 + CSS 变量全量 recalc + 全部 mermaid 重渲。

**诚实性评价（延续 Step 2-5 的结论）**：渲染管线整体是「诚实」的——增量 DOM diff 被正确利用、无强制全量重绘循环、decorations 有缓存、渲染下游有防抖、所有 NodeView 包裹层功能必需无装饰性冗余。结构性短板（无虚拟化）是全行业通病；「打开即全量加载图片/图表」「focus-mode 跨块全量重建」「代码块内输入全量重高亮」三个编辑期尖峰是本项目特有的、可修的点。

---

## 二、问题清单（按影响程度降序）

### P0-A【结构性】无虚拟化 + 无 `content-visibility`：DOM 全量常驻，滚动每帧全量绘制

**证据**：grep 全 `src/` 无 `content-visibility`/`contain:`/`will-change`/`virtual*` 命中（含 `editor.css`）；滚动容器为 `.mk-editor`（`overflow-y-auto`，`MarkdownEditor.vue:6`）；ProseMirror 为全部节点建 DOM。

**DOM 结构深度（自 **`.ProseMirror` 根起）：

| 节点                            | DOM 结构                                                                                                      | 深度      | 来源                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| paragraph / heading           | `p` / `h1-6` \> text                                                                                        | 1-2     | PM 原生                                                          |
| blockquote                    | `blockquote` \> `p` \> text                                                                                 | 2-3     | PM 原生                                                          |
| bulletList / orderedList      | `ul/ol` \> `li` \> `p`                                                                                      | 3-4     | PM 原生                                                          |
| taskList                      | `ul` \> `li` \> `div` \> \(`input`+`div`\>`p`\)                                                             | 4-5     | PM 原生                                                          |
| codeBlock                     | `div.mk-code-block-shell` \> \(`div.header`\(button+input+button\) + `pre` \> `code`\)                      | 3-4     | `code-block.ts:95-145`                                         |
| mermaidBlock                  | `div.mk-mermaid-block` \> \(`div.header`\(badge+del+zoom\) + `div.render`\(svg\) + `div.edit`\(textarea\)\) | 2-3     | `mermaid-block.ts:292-365`                                     |
| mathBlock                     | `div.mk-math-block` \> \(`div.header`\(badge+del\) + `div.render` + `div.edit`\(textarea\)\)                | 2-3     | `math-block.ts:50-104`                                         |
| mathInline                    | `span.mk-math-inline`                                                                                       | 1       | `math-inline.ts:35-75`                                         |
| image                         | `span.mk-image-shell` \> \(`img` + `figcaption` + `div.source-text`\)                                       | 2-3     | `image.ts:286-309`                                             |
| callout                       | `div.mk-callout`（`contentDOM = dom`，零额外包裹）                                                                  | 1-2     | `callout.ts:58-65`                                             |
| footnoteSection / footnoteDef | `div[data-footnote-section]` \> `div[data-footnote-def]` \> 内层块（renderHTML 渲染，无 NodeView）                   | 2-3     | `footnote.ts:27-67`                                            |
| footnoteRef                   | `sup` 原子节点（无 NodeView）                                                                                      | 1       | `footnote.ts:3-25`                                             |
| frontmatter                   | `div.mk-frontmatter` \> \(`div.header` + `div.content` \> text\)                                            | 2-3     | `frontmatter.ts:24-42`                                         |
| table                         | `div.mk-table-wrapper` \> `table` \> `tbody` \> `tr` \> `td` \> `p`                                         | **5-6** | `table.ts:18` `renderWrapper:true`（extension-table 自带 wrapper） |

**包裹层审计结论**：31 个自定义扩展的包裹层全部功能必需（header 顶栏/编辑区/caption/source 均为功能需要），**无装饰性冗余 div**。DOM 总量问题 \= ProseMirror 全量渲染器固有形态，不是扩展「乱套 div」造成的。

**量级估算**：5 万字中文文档 ≈ 1000 段 × 50 字 → 1000 `p` + 1000 文本节点（无行内 mark 时）≈ 2 千节点；行内 mark 会把文本节点拆细（每处加粗/链接/行内代码多拆 1-2 个）；表格每单元格 5-6 层；1 万段落文档 → 2 万+ 节点。**每新增一个块，浏览器滚动帧的 layout/paint 成本线性增加。**

**影响**：滚动的卡顿来源 \= 浏览器每帧绘制大文本树（叠加 `text-rendering: optimizeLegibility` 的 shaping 成本，`editor.css:82`）。此条与 Step 3 P0-1 同源。

### P1-A【编辑期】ParagraphFocus：focus-mode 下每次编辑全量重建顶层块 decorations

**位置**：`paragraph-focus.ts:47-64`（`decorations` prop，缓存条件 `activeBlock + docSize`）+ `editor.css:1402-1410`（`transition: opacity 0.35s ease`）

**机制**：focus-mode 开启时每次选区跨块或文档编辑，`state.doc.forEach` 全量遍历顶层块重建 decorations 并挂 opacity 类。**关键：缓存条件含 **`docSize`，每次击键 docSize 必变 → 缓存必 miss → O\(块数\) × 每次击键。`0.35s` transition 让 N 块同时进入淡入淡出（opacity 走合成器不触发布局，但 N 个合成层持续合成 0.35s）。与 Step 2 P1-1 / Step 5 P3-D 同源。

### P1-B【编辑期】代码块内输入触发所有代码块全量重高亮

**位置**：code-block-lowlight 插件 `state.apply` 无条件 2 次 `findChildren`（Step 2 P0-1 已确认）。**渲染管线角度**：高亮计算在事务期同步执行（`highlight` 库同步词法分析），结果缓存在插件 state；但每次代码块内输入都对**全部代码块**重算——文档含 10 个大代码块时，一次击键 \= 10 次同步高亮。

### P1-C【编辑期】markdown-input pending heading decorations 全树扫描

**位置**：`markdown-input.ts:242-249`（decorations prop，`buildPendingHeadingDecorations`）+ `:455-461`（`_scanCache` WeakMap 每次击键 miss）——Step 2 P0-3 已确认。每次输入全树 `descendants` 扫描。

### P1-D【主题切换】`theme-transitioning *` 全文档过渡 + CSS 变量全量 recalc + 全部 mermaid 重渲

**位置**：`main.css:385-390` + `themes/manager.ts:242-258` + `useEditorAppearance.ts:34-42`

**机制**：`applyTheme` 完整链路——① `classList.add('theme-transitioning')` → `main.css` 给**全文档所有元素**（含 `*::before/after`）挂 `background-color/color/border-color` 200ms 过渡（`!important`），**与 DOM 元素数线性**；② `getBoundingClientRect()` 强制重排（:244）；③ dark class + `injectColors`（**diff 注入**，仅值变化才写，`manager.ts:147-150`）；④ `injectTypography`（**无条件全量重写**，见 P2-A）；⑤ `triggerContentCrossfade`（opacity 0.6→1 动画 220ms，合成器无布局成本 ✅）；⑥ MutationObserver → RAF 合流 → `reinitializeMermaidTheme`（全部 mermaid NodeView 重渲，SVG 颜色固化必须重渲）+ `refreshParagraphFocus`（全量 decorations 重建 + dispatch 空事务）。

**Layout/Paint 估算**：静态审查无法实测，但机制上切主题必然发生 ① 全文档 style recalc（CSS 变量变化，与 DOM 线性，固有成本）→ ② 全文档 paint + 200ms 插值（`*` 过渡）→ ③ mermaid/decoration 重算。**大文档下这是几十 ms 级的卡顿**。

### P2-A【主题切换】`injectTypography` 无条件全量重写 26 个排版变量

**位置**：`manager.ts:204-222`。先 `removeProperty` 全部 26 个排版变量再重新注入（**无 diff**）——即使主题排版与当前一致也触发 style recalc。**可优化点：与 **`injectColors` 对齐做 diff 注入（值不变不写）。

### P2-B【滚动】图片无 width/height 占位，lazy 加载完成时 layout shift

**位置**：`editor.css:684-690`（`img.mk-image` 仅 `max-width:100%` + `max-height:520px`，无固定尺寸）+ `image.ts:294`（`loading='lazy'`）。skeleton 有 `min-height:80px`（`editor.css:702`）部分缓解，但**加载完成时高度从 80px 跳变到实际高度 → 文档流重排**。滚动经过图片区（lazy 触发加载）时 Layout Shift + Paint 成本集中。

### P2-C【加载期】打开文档即全量触发图片 IPC 与 mermaid/math 渲染排队

**证据**：本地图 NodeView 创建时 `syncView` → `_localSrcResolver` → `resolveImageDisplay` IPC（`image.ts:372-389`、`MarkdownEditor.vue:339-353`），文档打开 → N 张图 N 次 IPC 集中爆发（有 `resolvedImageCache` 复用）；mermaid/math NodeView 创建时立即 `renderMermaid`（`mermaid-block.ts:484`）/ `renderKatex`（`math-block.ts:213`），**全部块同时排队**（mermaid.render 异步排队后集中执行 CPU 尖峰；KaTeX `renderToString` 同步计算）。

**渲染管线角度**：库是懒的（动态 import），块是急的——「首见才下库」但「打开即全渲」，无滚动到才渲染。与 Step 3 P0-3 同源。

### P2-D【编辑期】KaTeX 大公式同步渲染阻塞主线程

**证据**：`math-block.ts:110-135` 与 `math-inline.ts:41-57` 的 `renderKatex`/`render` 都是 `async` 函数，但核心是 `katex.renderToString(...)`——**同步 CPU 计算**，async 包装不改变这一点（仅 `getKatex()` 首次动态 import 是异步的）。每次 NodeView update（公式内容变化）都重新 `renderToString`。几十行的大公式渲染是毫秒级同步阻塞，数百个公式块的文档在输入触发时会有可感知的同步卡顿。**注意：这只在公式内容变化时触发，不在打字热路径（见方向 4）。**

### P2-E【编辑期/正确性】SearchHighlight 缓存缺 doc 检查

**位置**：`search-highlight.ts:47-48`——缓存条件 `matches === _cachedMatchesRef && activeIndex === _cachedActiveIndex` **不含 doc 引用检查**。搜索高亮期间编辑 → docChanged 后 updateStateInner（prosemirror-view:5519 每次 updateState 都调 viewDecorations）返回旧 doc 位置的缓存 DecorationSet → **高亮错位**。正确性 bug，命中缓存时零计算、不拖慢渲染。与 Step 5 P1-A 同源。

### P2-F【局部】selection-only 事务仍跑全部 decorations props + matchesNode 浅比较

**证据**：prosemirror-view `updateStateInner` 每次 updateState（含纯选区变化）都调 `viewDecorations(this)`（`prosemirror-view/dist/index.js:5519`）→ 所有插件的 decorations prop 被调用；随后 `matchesNode` O\(n\) 浅比较（:5522）判定无需重建 DOM。**成本有界但非零**：search-highlight（命中缓存零计算）、paragraph-focus（focus-mode 下全量重建，见 P1-A）、code-block-lowlight（读 state 缓存，零计算）。纯光标移动时最坏情况 \= 几次 decorations 计算 + 一次 O\(块数\) 浅比较。

### P2-G【局部】强制重排点清单（JS 触发的同步布局）

| 位置                                          | 触发方式                             | 频率                                           |
| ------------------------------------------- | -------------------------------- | -------------------------------------------- |
| `editor-dom.ts:43-44` scrollElementIntoView | `getBoundingClientRect()` ×2     | 跳转时（低频）                                      |
| `useEditorSearch.ts` pulseJumpTarget        | `void el.offsetWidth` 强制重排让动画重触发 | 搜索跳转时（低频）                                    |
| `OutlinePanel.vue:57-70` scroll-spy         | 每帧二分 `getBoundingClientRect`     | 滚动每帧（有界，Step 3 P1-1：批处理下 1 次强制布局 + \~10 次读取） |

均低频或有界，无高频强制重排循环。✅

### P3-A【结构性】多文档切换 \= 同步全量序列化 + 解析 + DOM 重建

`MarkdownEditor.vue:217-238`：`serializeMarkdown`（全量）→ `parseMarkdown`（全量）→ `setContent`（全量 DOM 重建，同步）。渲染管线角度：这是全项目唯一一处「整树重建」，且未修改文档也无法跳过（`isDirty` 在 store 切到新文件后语义失效，见 Step 3 修正）。与 Step 3 P0-2 / Step 4 P0-A 同源。

**否定项（确认无问题）**：PM 增量更新未被破坏 ✅；KaTeX/Mermaid 懒加载未进热路径 ✅；useEditorSync 四档防抖无热路径绕过 ✅；无扩展在 update/onUpdate 里 dispatch 事务或 setContent ✅；Callout/Footnote 等复杂节点无多余包裹层 ✅；crossfade opacity 动画本身无布局成本 ✅。

---

## 三、明细

### 方向 1：DOM 节点总量与结构深度 ⚠️ 结构性风险

见 P0-A 结构表。要点：普通正文 2-3 层（健康）；**表格 5-6 层最重**（`renderWrapper:true` 多一层 wrapper）；列表嵌套 4-5 层；自定义 NodeView 的额外包裹均为「功能必需」层，无纯装饰性冗余。整体结构深度合理，问题是**总量**（全量常驻）而非**深度**（嵌套过深）。

### 方向 2：虚拟滚动是否真正生效 ❌ 未生效（ProseMirror 固有形态）

- 无任何虚拟化库/实现（grep 无命中）。
- ProseMirror 为全文档建 DOM；滚动是浏览器原生行为，**PM 在滚动期间零参与**（滚动不产生事务、不触发 decorations、不重建 DOM，Step 3 已实测确认）。
- 无 `display:none` 视口外隐藏、无 IntersectionObserver 惰性建块、无 `content-visibility` 离屏跳过。
- 结论：**虚拟滚动完全未生效**。浏览器能优化的只有「绘制时按视口裁剪」这一层，layout/paint 的候选集仍是全文档。这是全行业 ProseMirror 编辑器的通病，修法通常是 `content-visibility:auto` 内容分层。

### 方向 3：PM 增量更新是否被破坏 ✅ 未被破坏

**全 dispatch/setContent/updateState 审计**（grep `view.dispatch|editor.view.dispatch|.setContent(|updateState(`）：

| 调用点                                                                                                        | 触发场景                               | 是否输入热路径              |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------- |
| `MarkdownEditor.vue:201` setContent                                                                        | 编辑器初始创建加载                          | 否（加载一次）              |
| `MarkdownEditor.vue:231` setContent                                                                        | 跨文档切换                              | 否（切换场景，含全量序列化+解析+重建） |
| `useEditorSearch.ts:172` dispatch 空事务                                                                      | closeSearch                        | 否（用户操作）              |
| `editor-image-drop.ts:75` dispatch                                                                         | 拖拽图片                               | 否（用户操作）              |
| `code-block.ts:74` / `math-block.ts:84,171,205` / `mermaid-block.ts:335,436,476` / `image.ts:434` dispatch | 删块/退出编辑/改语言                        | 否（用户操作）              |
| `markdown-paste.ts:481,511,523,589` dispatch                                                               | 粘贴                                 | 否（用户操作）              |
| `paragraph-focus.ts:75` dispatch 空事务                                                                       | `refreshParagraphFocus`（主题/焦点模式切换） | 否（显式刷新）              |
| `markdown-input.ts:307` dispatch                                                                           | `setMarkdownInputState`（输入转换元数据）   | 输入链路但非重渲染（仅 setMeta） |

**onUpdate / onSelectionUpdate 接线**（`MarkdownEditor.vue:187-195`）：`onUpdate → handleDocChange → 4 个 debounce`；`onSelectionUpdate → rafUpdateBubbleMenu + handleSelectionChange`——**均无 dispatch、无 setContent、无强制重渲染**。

**7 个 NodeView.update 全部返回 true**（code-block:219-224 / mermaid:498-505 / math:219-226 / math-inline:64-69 / image:505-513）——PM 只做增量 DOM 更新，不重建。无 `view.update()`/`forceUpdate` 强制重绘调用（grep 仅命中 `editor.destroy()`）。文档编辑走 `docView.update` 增量 DOM diff（prosemirror-view:5543），非全量 `docViewDesc` 重建。

**三个重点对象专项**：

- **SearchHighlight**：`decorations(state)` 每次 updateState 被调用（prosemirror-view:5519），命中缓存零计算；缓存 miss 时一次性重建全部 inline decoration（P2-E 正确性缺陷 + Step 5 P2-C 全量高亮 DOM 膨胀）。**不破坏增量更新**。
- **ParagraphFocus**：见 P1-A，focus-mode 下每次编辑全量重建（`state.doc.forEach` 顶层块）。**这是最接近「破坏增量」的点**——但它是 decorations 层的全量重算（O\(块数\)，无 DOM 重建），非 PM 增量机制的破坏；`refreshParagraphFocus` 的 dispatch 空事务仅主题/焦点模式切换时调用。
- **useEditorAppearance**：MutationObserver + RAF 合流 → `syncMermaidTheme`（全部 mermaid 重渲）+ `refreshParagraphFocus`（全量 decorations + dispatch）。**仅主题切换触发，非输入热路径**。

**结论：PM 增量更新机制未被任何扩展破坏**。输入热路径上没有 setContent、没有 node view 重建、没有整树重绘。

### 方向 4：渲染时机与懒加载热路径 ✅ 滚动期零现算，KaTeX/Mermaid 未进打字热路径

**渲染时机总表**：

| 渲染项         | 计算时机                                          | 同步/异步                             | 滚动期       | 打字热路径                             |
| ----------- | --------------------------------------------- | --------------------------------- | --------- | --------------------------------- |
| 代码块低亮       | 事务期（插件 state.apply，P1-B）                      | 同步（highlight 词法分析）                | **不现算** ✅ | 代码块内输入时全量重高亮 ⚠️                   |
| KaTeX 公式    | NodeView 创建 + update（内容变化）                    | `renderToString` **同步**（async 包装） | 不现算 ✅     | **不进**（公式块 isolating 走 textarea）✅ |
| Mermaid     | NodeView 创建 + update + 主题切换                   | **异步**（render 返回 Promise，双缓冲）     | 不现算 ✅     | **不进** ✅                          |
| Markdown 预览 | —（本项目为 WYSIWYG，无独立预览渲染）                       | —                                 | —         | —                                 |
| 字数/大纲/序列化   | 编辑后防抖 150/500/500ms（`useEditorSync.ts:26-30`） | 同步计算（debounce 尾部）                 | 不触发 ✅     | 停顿 ≥ 窗口才触发                        |

**KaTeX/Mermaid 懒加载验证**：`getKatex()`（`math-block.ts:12-23`，动态 import + 首用注入 CSS）、`getMermaid()`（`mermaid-block.ts:12-23`）——首次使用才下载，文档无公式/图表时不加载 ✅。渲染仅在 NodeView 创建时 + NodeView.update（节点内容变化）触发；MathBlock/MermaidBlock 均为 `isolating:true + contentDOM:undefined`，编辑走原生 textarea（`math-block.ts:96-104`、`mermaid-block.ts:356-365`），textarea 输入不产生 PM 事务 → 不触发 update。**Performance 面板快速打字时不应看到 KaTeX/Mermaid 同步调用栈**。若实际看到，需排查「公式内容被其他插件后台修改」场景。

**useEditorSync 四档防抖与实际触发**：字数 150ms / 光标 100ms / 大纲 500ms / 序列化 500ms，均为 trailing debounce（`useEditorSync.ts:26-32`）。快速打字时各回调在「停顿 ≥ 窗口」后触发一次，不会每击键全量工作（慢打字者除外，Step 2 P3-1/2 已记录）。

**serializeMarkdown 全调用点审计**（绕过防抖的直接调用）：

| 调用点                                 | 场景                                                                    | 性质                                    |
| ----------------------------------- | --------------------------------------------------------------------- | ------------------------------------- |
| `useEditorSync.ts:58`               | 500ms 防抖内                                                             | 正规路径 ✅                                |
| `MarkdownEditor.vue:224`            | 跨文档切换（watch path）                                                     | 切换场景，非输入                              |
| `MarkdownEditor.vue:447` getContent | 保存/自动保存（`persistDocument:174`）、关窗/切换闸口（`evaluateDirtyFromEditor:112`） | **用户主动操作前实时取数**，设计意图明确（绕开防抖避免丢最后半秒编辑） |

**结论：没有「输入热路径绕过防抖直接序列化」的路径**。所有绕过都是「用户主动操作（保存/关窗/切换）前实时取数」的正确设计。`emitImmediateStats`（`MarkdownEditor.vue:213,235`）只算字数+大纲，**不调 serializeMarkdown**。

### 方向 5：图片 / 媒体资源加载策略 ⚠️ 字节懒、解析急、视口外 DOM 完整、无尺寸占位

| 资源             | 字节加载                                                     | 路径解析/授权                                                      | 渲染                                          |
| -------------- | -------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| 本地图            | `loading='lazy'` ✅（`image.ts:294`）                       | **打开即全部 IPC**（`_localSrcResolver` + `resolvedImageCache` 复用） | 无缩略图，原图直出；有 skeleton 占位（`image.ts:343-345`） |
| 远程图            | lazy + 4 并发 + 50MB LRU + failure TTL ✅（`image.ts:62-64`） | 打开即全部落盘排队                                                    | blob URL + skeleton 占位                      |
| mermaid / math | 库动态 import ✅                                             | —                                                            | **打开即全部渲染排队**（无滚动到才渲染）                      |

要点：

- **视口外 DOM**：`CustomImage` NodeView 为每个图片创建完整 DOM（`span.shell > img + figcaption + div.source`），无虚拟化 → **视口外图片节点完整常驻**（含 `<img>` 标签与 skeleton class）。字节懒加载不解决 DOM 常驻。
- **Layout Shift 风险**（P2-B）：无固定 width/height 占位，skeleton `min-height:80px` 部分缓解，加载完成时高度跳变 → 文档流重排。
- **Paint 成本**：原图直出（无缩略图），`max-height:520px` 只限制显示尺寸，**解码仍是原图分辨率**。
- 结论：**字节级懒加载是诚实的，但「路径解析/渲染动作」是打开即全量**。`loading='lazy'` 只解决网络字节，管不了 IPC 与渲染。

### 方向 6：CSS 布局陷阱与主题切换 ⚠️ 无灾难项，缺大文档优化；主题切换成本集中

| 项                                    | 结论                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `content-visibility`/`contain`       | **全无**（P0-A，最大缺失项）                                                                                   |
| `text-rendering: optimizeLegibility` | 全局启用（`editor.css:82`），提高文本 shaping 成本                                                                |
| `line-break: strict`                 | CJK 换行（`editor.css:83`），文本布局计算成本高于普通换行                                                               |
| focus-mode opacity transition        | 0.35s 全块过渡，合成器不触发布局，但 N 块同时进过渡有合成开销（P1-A）                                                            |
| `:has()` 选择器                         | 仅 3 处，作用于段落（`editor.css:95-101`），Chromium 实现为匹配时父回溯，成本可控 ✅                                           |
| 强制重排点                                | 3 处，均低频或有界（P2-G）✅                                                                                    |
| heading gutter                       | `.ProseMirror` `padding-left: 1.9rem` + 标题 `::before` 定位，无重排风险 ✅                                     |
| 表格                                   | `renderWrapper:true` + `resizable`，编辑期重布局成本高，滚动不受影响                                                  |
| 滚动监听                                 | 仅 OutlinePanel scroll-spy 一处，RAF 合并 + passive（Step 3 已确认）✅                                           |
| 主题切换                                 | 见 P1-D：`theme-transitioning *` 全文档过渡 + CSS 变量全量 recalc + injectTypography 无条件重写（P2-A）+ 全部 mermaid 重渲 |
| crossfade                            | `mk-content-crossfade` opacity 0.6→1 动画 220ms（`editor.css:1450-1456`），合成器动画，无布局成本 ✅                  |

无 flex 嵌套灾难、无布局抖动、无高频强制重排。整体 CSS 布局是健康的，缺的是「离屏跳过」这一层优化。

---

## 四、修复方向（建议，仅排查不实施，待确认）

| 问题                              | 建议方向                                                                                                    | 类型        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | --------- |
| P0-A 无虚拟化                       | 编辑内容容器加 `content-visibility: auto` + `contain-intrinsic-size`（实测收益与选中/搜索/scroll-spy 兼容性后再定）；表格/大代码块单独评估 | 结构性，需实测验证 |
| P1-A focus-mode 全量重建            | paragraph-focus 改「仅重建选区前后相邻块」或缓存不变块的 decorations（Step 2/5 建议合并实施）                                       | 局部可修      |
| P1-B 代码块全量重高亮                   | code-block-lowlight 短路：当前代码块语言未变化 + 仅单个代码块内容变化时只重算该块                                                    | 局部可修      |
| P1-C pending heading 全树扫描       | markdown-input 改增量扫描（Step 2 建议：WeakMap 缓存 doc 引用 + 增量 diff）                                             | 局部可修      |
| P1-D 主题切换全文档过渡                  | `theme-transitioning` 过渡范围收窄（仅 `.mk-editor` 或去掉 `*` 全选）；mermaid 重渲改视口内才渲                                | 局部可修      |
| P2-A injectTypography 无条件重写     | 对齐 `injectColors` 做 diff 注入（值不变不写）                                                                      | 一行级小修     |
| P2-B 图片无尺寸占位                    | 图片按 `width/height` 或 `aspect-ratio` 预留尺寸（从 markdown 解析时估算）                                              | 局部可修      |
| P2-C 打开即全量加载                    | 图片路径解析 + mermaid/math 渲染改 IntersectionObserver 触发（滚动接近视口才 IPC/渲染，placeholder 占位）                        | 改动面较大     |
| P2-D KaTeX 同步渲染                 | 大公式改异步分帧（`requestIdleCallback` 或 rAF 分批）；单公式毫秒级可暂不处理                                                    | 可选        |
| P2-E SearchHighlight 缓存缺 doc 检查 | 缓存条件加 doc 引用检查                                                                                          | 一行级小修     |
| P3-A 切换全量重建                     | 切换前短路未修改文档的序列化（注意 store 时序，Step 3 已指出不能用切换后 isDirty 直接判断）；A1 语义比对已保证数据安全                                | 局部可修      |

> 所有建议均为「确认后再实施」。与 Step 2/3/5 的待办合并排期，避免重复工作量：P1-A 与 Step2 P1-1 / Step5 P3-D 同源，P1-B/P1-C 与 Step2 P0-1/P0-3 同源，P0-A 与 Step3 P0-1 同源，P2-E 即 Step5 P1-A，P3-A 与 Step3 P0-2 / Step4 P0-A 同源。

---

## 五、与既有步骤的边界划分

| 步骤           | 视角               | 已覆盖                                                               | Step 6 补充                                               |
| ------------ | ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| Step 2 输入响应  | 编辑期热路径           | code-block 全量重高亮、pending heading 扫描、focus-mode 重建、Suggestion 每事务跑 | 渲染管线机制层归因（decorations/增量更新视角）、否定项确认                     |
| Step 3 大文档滚动 | 行为层：滚动触发什么、内存、加载 | P0-1 无虚拟化、P0-2 切换全量、P0-3 打开即全量、scroll-spy                         | DOM 结构深度实测表、PM 增量利用核查、KaTeX 同步渲染定位、NodeView.update 全面审计 |
| Step 4 整体架构  | 骨架层              | 撤销栈污染、命令体系、依赖                                                     | 渲染管线层（无重叠）                                              |
| Step 5 搜索替换  | 编辑层：搜索/替换/选区     | 高亮缓存缺陷（P1-A \= 本报告 P2-E）、全量高亮膨胀                                   | 无重叠（本报告引用其 P3-D）                                        |

# DUmate审核

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
