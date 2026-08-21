# solo 大文档滚动与渲染诊断报告（Step 3）

> 只读排查，未修改任何代码。排查日期：2026-08-21。
> 依据：以实际代码为准。量级估算非实测，供定位参考。

---

## 一、核心结论

文档变长后，滚动与渲染卡顿的来源可以分成"**浏览器在画什么**"与"**我们的 JS 在干什么**"两层：

**浏览器层（结构性，无法靠 JS 局部修复）**：ProseMirror 不虚拟化，全文档节点都常驻 DOM 树。`.tiptap-editor` 没有 `content-visibility` / `contain` 优化（`editor.css` 全篇无此类属性），滚动时浏览器无法跳过离屏内容的布局/绘制；叠加 `text-rendering: optimizeLegibility`（`editor.css:82`）让文本光栅化更昂贵。**滚动本身 PM 零参与**（滚动不产生事务、不触发 decorations、不重建 DOM），每帧的成本是浏览器 rasterize 大文本树 + OutlinePanel 的 scroll-spy 布局查询。

**JS 层（可优化）**：

- 滚动监听只有一处（OutlinePanel scroll-spy），已 RAF 合并 + `passive`，二分查找标题（`OutlinePanel.vue:57-70, 34-53`）——**无未节流监听、无每节点遍历**，这是诚实的设计。但它每帧做 \~log n 次 `getBlockElFromPos` + `getBoundingClientRect`，**每次滚动帧强制 \~10-20 次布局**。
- 语法高亮是**提前算好**的（事务期在插件 state 里计算并缓存，滚动不触发事务 → 滚动不现算）✅。唯一例外是 mermaid / math：NodeView 创建时（即文档加载时）**一次性全部渲染**，不是滚动到才渲染。
- 图片字节级懒加载（`img.loading='lazy'`，`image.ts:294`）✅，但**路径解析/授权是一次性全触发的**（每个 image NodeView 创建时同步调 `resolveImageDisplay` IPC，`MarkdownEditor.vue:339-353`），文档打开即 N 次 IPC。
- 多文档切换 \= **全量序列化当前文档 + 全量解析目标文档 + 全量重建 DOM**（同步阻塞，`MarkdownEditor.vue:224-236`），未修改文档也无法跳过序列化。

**内存**：无泄漏（所有模块级缓存有界、WeakMap 弱引用、`onBeforeUnmount` 清理完整），但有"大文档双份内容常驻"（PM doc + `fileStore.content` 字符串）与 history 100 组事务的固有占用。

---

## 二、问题清单（按影响程度降序）

### P0-1【结构性】编辑器无虚拟化 + 无 `content-visibility`/`contain`：大文档滚动每帧全量绘制

**证据**：`editor.css` 全篇无 `content-visibility`/`contain`/`will-change`（grep 全仓库仅命中菜单/弹层 transform）；`.mk-editor` 为滚动容器（`overflow-y-auto`，`MarkdownEditor.vue:6`）；ProseMirror 为全部节点建 DOM（滚动不触发任何 view 更新，`prosemirror-view` `updateState` 只在事务/选区变化时跑）。

**影响**：文档 1 万段落 → 1 万+ DOM 元素。滚动时浏览器每帧对可见文本 rasterize；`text-rendering: optimizeLegibility`（`editor.css:82`）额外提高文本光栅化成本。文档越长，每帧绘制成本线性上升，这是"文档变长滚动变卡"的根因性结构问题。**注意**：这是 Chromium 通用行为（Typora/Obsidian 同样面临），修法通常是内容分层（`content-visibility:auto` 让离屏块跳过 layout+paint）或列表/代码块等重 DOM 区域做专用渲染。

### P0-2【结构性】多文档切换 \= 同步全量序列化 + 全量解析 + 全量 DOM 重建

**位置**：`MarkdownEditor.vue:217-238`（watch `fileStore.currentFile.path`）

```js
const currentMarkdown = serializeMarkdown(editor.value.state.doc).replace(/\n+$/, ''); // 224 全量序列化
...
const doc = parseMarkdown(editor.value.schema, content);                              // 229 全量解析
editor.value.commands.setContent(doc.toJSON(), { emitUpdate: false });                // 231 全量 DOM 重建
```

**影响**：大文档切换 \= O\(n\) markdown 序列化 + O\(n\) markdown-it 解析 + O\(n\) DOM 重建，三者串行同步执行，期间 UI 冻结。未修改文档（`isDirty=false`，序列化结果必等于基线）也无法跳过第 224 行。属"切换延迟"主因。

### P0-3【结构性】图片/嵌入内容"打开即全量加载"，非滚动到才加载

**证据**：

- 本地图：`CustomImage` NodeView 创建时 `syncView` → `_localSrcResolver`（`image.ts:372-389`）→ `resolveImageDisplay` IPC（`MarkdownEditor.vue:339-353`）。**文档打开 → 所有图片同时发起路径解析+授权 IPC**。有 `resolvedImageCache` 同 key 复用（`MarkdownEditor.vue:342-349`），且 IPC 异步非阻塞，但 N 张图 \= N 次 IPC 集中爆发。
- 远程图：同样 NodeView 创建时触发 `getRemoteImageDisplaySrc` → `fetchRemoteImageData` 落盘（`image.ts:190-236`），有 4 并发 + 50MB LRU 上限。
- mermaid / math：NodeView 创建时立即 `renderMermaid`（`mermaid-block.ts:371-403`），mermaid 库本身动态 import（✅ 库懒加载），但**文档里所有 mermaid 块加载时全部排队渲染**，大文档多图表时首屏后有 CPU 尖峰。
- `img.loading='lazy'` 只管**字节加载**，管不了上面的 IPC/渲染集中爆发。

### P1-1【局部】OutlinePanel scroll-spy 每帧强制布局 \~log n 次

**位置**：`OutlinePanel.vue:57-70`（RAF 合并 ✅）+ `:24-55`（二分）

```js
const el = getBlockElFromPos(view, props.items[mid].pos); // 42 domAtPos
el.getBoundingClientRect().top                            // 47 强制布局
```

滚动每帧执行一次 `updateActive`，二分最多 log n 次 `getBlockElFromPos` + `getBoundingClientRect`。`getBoundingClientRect` 触发样式计算；滚动帧里每帧 \~10-20 次布局查询会放大浏览器重排成本。量级：千标题文档 \~10 次/帧，万节点文档 \~13-14 次/帧。**有界但不为零**，且与 P0-1 的每帧绘制成本叠加。可以接受，但"每帧强制布局"是滚动性能的大忌之一，属于可再压缩的局部点。

### P1-2【局部】smooth scroll 长距离动画期间持续触发 scroll-spy

**证据**：大纲跳转 `scrollElementIntoView`（`editor-dom.ts:47` `behavior:'smooth'`）、搜索跳转 `scrollIntoView({behavior:'smooth'})`（`useEditorSearch.ts:78`）。平滑滚动动画期间 scroll 事件高频触发 → 每帧一次 scroll-spy（见 P1-1）。大文档长距离跳转的平滑动画可达数百毫秒，期间持续每帧强制布局。属 P1-1 的放大器。

### P2-1【内存注意点】大文档双份内容常驻 + history 100 组

- `fileStore.currentFile.content` 常驻完整 markdown 字符串（`file.ts:46,63`），与 PM doc 并存——序列化基线需要，但大文档是双份内存。
- UndoRedo 未配置（`editor-extensions.ts:131-136` 未覆盖 history）→ 默认 `undoDepth: 100`（`@tiptap/extension-history` 默认值）。连续编辑 100 组事务的 steps 有界保留；大段删除/替换时 step 携带大 slice，累积内存可观但有界。

### P2-2【内存良性】缓存盘点（无泄漏）

| 缓存                                             | 作用域      | 释放机制                                                                                                  |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| markdown-input `_scanCache` WeakMap            | 模块       | 弱引用，doc GC 即回收 ✅                                                                                      |
| markdown-input `_cachedDoc/_cachedDecorations` | 模块       | 只持最新一个 doc ✅                                                                                          |
| code-block-lowlight decorations                | 模块       | 每次事务重建，单值 ✅                                                                                           |
| paragraph-focus 模块级                            | 模块       | `refreshParagraphFocus` 失效清理 ✅                                                                        |
| search-highlight 模块级                           | 模块       | matches 清空时置 null ✅                                                                                   |
| `resolvedImageCache`（MarkdownEditor）           | 组件       | 文件切换/存储路径变化时 `clear()`（`:220,:415`）✅（无上限但周期短，低风险）                                                     |
| remote image blob（50MB LRU）                    | 模块       | 编辑器卸载 `releaseRemoteImageBlobs()`（`MarkdownEditor.vue:401`）；**文件切换不释放**——设计使然（跨文档复用远程图缓存），50MB 上限兜底 ✅ |
| mermaid 块事件监听                                  | NodeView | 随 DOM 移除被 GC（AbortController signal 绑定）✅                                                              |

### P2-3【良性记录】focus-mode 全块 opacity transition

`html.focus-mode .paragraph-dimmed { opacity: var(--mk-focus-dimmed-opacity); transition: opacity 0.35s ease }`（`editor.css:1402-1410`）——opacity 变化走合成器不触发布局，且滚动本身不改 opacity。不构成滚动问题，仅记录。

---

## 三、六维度明细

### 维度 1：滚动时编辑器在重绘什么 ✅

**机制**：ProseMirror 为全文档建 DOM（无虚拟化）。滚动是浏览器原生行为：**滚动不产生事务、不触发任何插件钩子、不重建 DOM**。滚动期间 PM 层零参与，每帧开销全在浏览器侧（大文本树 rasterize + 布局），外加 OutlinePanel scroll-spy（P1-1）。所以"整篇文档都在跟着动"的答案是：DOM 是整篇存在的，但**绘制**是浏览器按视口裁剪的——卡顿来自绘制成本本身（P0-1），不是"整篇重绘"。

### 维度 2：语法高亮是提前算还是现算 ✅

**提前算**。lowlight 高亮在插件 state 的 `apply` 阶段计算（事务期），decorations 读 `getState` 缓存（`@tiptap/extension-code-block-lowlight/dist/index.js:109-113`）。滚动不触发事务 → 滚动不现算。✅ 编辑期的问题（代码块内输入全量重算所有代码块）已在 Step2 P0-1 记录，与滚动无关。mermaid/math 是"加载时全渲、滚动不重渲"（渲染结果驻留 SVG DOM），符合"滚到不现算"。

### 维度 3：内存是否一直涨不回落 ✅ 有界，无泄漏

见 P2-1/P2-2 盘点。结论：所有模块级缓存有界或弱引用，`onBeforeUnmount` 清理完整（`MarkdownEditor.vue:374-402`：focus 监听、拖拽、editor.destroy、DOM 事件、blob 释放）。唯一"涨"的来源是 DOM 树与双份内容——随文档大小线性，随文档替换回落（setContent 重建后旧 DOM/旧 doc 可被 GC）。无悄悄累积的泄漏点。

### 维度 4：图片与嵌入内容加载策略 ⚠️ 混合

| 资源      | 库/代码                       | 字节加载                     | 解析/渲染                 |
| ------- | -------------------------- | ------------------------ | --------------------- |
| 本地图     | `CustomImage` NodeView     | `loading='lazy'` ✅       | **打开即全部 IPC 解析**（有缓存） |
| 远程图     | `getRemoteImageDisplaySrc` | lazy + 4 并发 + 50MB LRU ✅ | **打开即全部落盘**           |
| mermaid | 动态 import ✅                | –                        | **打开即全部渲染排队**         |
| math    | 动态 import ✅                | –                        | 打开即渲染                 |

结论：**库是懒的，块是急的**——mermaid/math 的代码是滚动到才 import（首见才下），但"渲染动作"在文档加载时对全部块一次性发起。对含大量图表/图片的长文，打开文档是集中式 CPU/IO 尖峰而非渐进式。

### 维度 5：多文档切换 ⚠️ 有同步全量成本，切走文档处理正确

- **延迟来源**：P0-2 的"序列化→解析→DOM 重建"同步三步。编辑器实例复用（不销毁重建）✅。
- **切走的文档**：`cancelPending()` 清掉未触发的防抖（`MarkdownEditor.vue:228`），旧 doc 与旧 DOM 随 setContent 被替换、由 GC 回收；image 路径缓存 clear；远程图 blob 全局复用不释放（设计使然）。无"切走的文档残留监听/定时器"问题。✅

### 维度 6：CSS 与布局层 ⚠️ 无灾难项，但缺大文档优化

| 项                                    | 结论                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| 滚动监听                                 | 仅 OutlinePanel 一处，RAF 合并 + passive ✅                                                |
| 每节点布局遍历                              | 无（scroll-spy 用二分）✅                                                                  |
| `content-visibility`/`contain`       | **无**（P0-1，最大缺失项）                                                                   |
| `text-rendering: optimizeLegibility` | 全局启用（`editor.css:82`），文本光栅化成本高                                                      |
| `will-change`                        | 无使用（合理，避免滥用）                                                                        |
| smooth scroll                        | 大纲/搜索跳转使用，长距离动画放大 P1-1                                                              |
| 全局动画/backdrop-filter                 | lightbox 打开时才生效，不常驻                                                                 |
| 代码块/表格布局                             | `pre-wrap + break-all`（`editor.css:544-546`）、`table-layout:fixed`——编辑期重布局成本高，滚动不受影响 |

---

## 四、修复方向（建议，仅排查不实施，待确认）

| 问题        | 建议方向                                                                                                                                                                           | 类型                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| P0-1      | 给编辑内容容器加 `content-visibility: auto` + `contain-intrinsic-size`（对整块文本/标题生效，离屏块跳过 layout+paint）；大代码块/mermaid 区域单独评估；可保留 `text-rendering: auto` 或仅在非 CJK 场景开 `optimizeLegibility` | 局部可修，需实测收益与选中/搜索兼容性 |
| P0-2      | 切换前用 `fileStore.currentFile.isDirty` 短路：`!isDirty` 时序列化结果必等于基线，直接走 setContent；必要时再做 `serializeMarkdown`                                                                        | 局部可修                |
| P0-3      | 图片路径解析改为 IntersectionObserver 触发（滚动接近视口才 IPC）；mermaid/math 渲染改为"视口内才 render"（NodeView 惰性渲染 + placeholder）                                                                      | 局部可修，改动面较大          |
| P1-1/P1-2 | scroll-spy 增加节流（如每 2 帧一次）或改用 IntersectionObserver 监听标题元素；smooth scroll 跳转期间抑制 scroll-spy（或改 instant）                                                                           | 局部可修                |

> 所有建议均为"确认后再实施"。P0-1 的 `content-visibility` 需在真实大文档下验证：选中（::selection）、搜索高亮（inline decoration）、跳转定位（scrollIntoView）与 IME 行为在跳过布局的容器上是否正常，是唯一有兼容性风险的改动。

 

# Dumate复审

报告读完。需要核实多个文件和机制，并行读取关键源码。

需要确认 mermaid NodeView 创建时是否立即调用 `renderMermaid`，以及 history 配置是否被覆盖。

所有关键代码已读完。逐一给出核实结论。

---

## 核实结论

### P0-1：编辑器无虚拟化 + 无 content-visibility/contain — **完全正确**

- `editor.css` 全篇 grep 仅命中 `text-rendering: optimizeLegibility`（第 82 行），无 `content-visibility`/`contain`/`will-change` ✅
- ProseMirror 为全部节点建 DOM、滚动不产生事务——标准行为 ✅
- `text-rendering: optimizeLegibility` 确实在 `.tiptap-editor` 基础样式中 ✅

**一个措辞修正**：报告说它"让文本光栅化更昂贵"——更准确说是增加了文本 **shaping/布局** 成本（ligature 和 kerning 计算），不是光栅化（rasterize）本身。两者是浏览器文本渲染管线的不同阶段，`optimizeLegibility` 主要影响 shaping 阶段。

### P0-2：多文档切换同步全量 — **正确，但修复建议需修正**

`MarkdownEditor.vue:217-238` 确认三步串行同步：

- 第 224 行 `serializeMarkdown(editor.value.state.doc)` — 全量序列化 ✅
- 第 229 行 `parseMarkdown(editor.value.schema, content)` — 全量解析 ✅
- 第 231 行 `editor.value.commands.setContent(doc.toJSON())` — 全量 DOM 重建 ✅

**但报告建议的"用 isDirty 短路"有一个逻辑问题需要修正：**

这个 watch 监听的是 `fileStore.currentFile.path`，触发时 `fileStore.currentFile.content` **已经是新文件的内容了**（store 响应式更新先于 watch 回调）。此时 `isDirty` 反映的是"编辑器内容与**当前文件基线**"的关系——但"当前文件"已经切到新文件了，`isDirty` 的语义在新文件上下文下没有意义。

不过报告的核心思路仍然成立：如果用户没修改旧文件（旧 isDirty\=false），编辑器内容 \= 旧文件基线，序列化编辑器 \= 序列化旧文件基线，这一步的数据不会丢失，可以跳过。但实现上不能直接用 `fileStore.currentFile.isDirty`（此时已指向新文件），需要在切换前**缓存**旧文件的 dirty 状态，或者用旧文件基线内容做比较。报告说的"直接走 setContent"方向对，但比报告暗示的"加一个 if"要复杂。

### P0-3：图片/嵌入内容"打开即全量加载" — **正确，mermaid 有一个细节需补充**

- `image.ts:294` 确认 `image.loading = 'lazy'` ✅
- `MarkdownEditor.vue:339-353` 确认 `setLocalSrcResolver` 在编辑器创建前设置，NodeView 创建时同步触发 IPC ✅
- `resolvedImageCache` 有缓存复用 ✅
- `mermaid-block.ts:484` 确认 NodeView 创建时立即 `renderMermaid(node.textContent)` ✅

**一个报告没提到的细节**：`renderMermaid` 是 `async function`（第 371 行），内部 `await getMermaid()` + `await mermaid.default.render()` 都是异步的。所以"所有 mermaid 块同时发起渲染"不等于"同步阻塞主线程"——它们是异步排队的。第一次 `getMermaid()` 触发动态 import，后续复用已加载模块；多个 `mermaid.render()` 调用会在 import 完成后集中执行。

报告说的"大文档多图表时首屏后有 CPU 尖峰"仍然成立——虽然异步，但多个 `render()` 调用集中执行确实会造成 CPU 尖峰。只是"集中爆发"的机制是"异步排队后集中执行"，不是"同步阻塞"。

### P1-1：OutlinePanel scroll-spy 每帧强制布局 — **基本正确，但"\~10-20 次强制布局"高估了**

`OutlinePanel.vue:24-55` 确认：

- RAF 合并 ✅（第 59 行）
- `passive: true` ✅（第 70 行）
- 二分查找 ✅（第 39-52 行）
- 每次迭代 `getBlockElFromPos` + `getBoundingClientRect().top` ✅

**但"每帧 \~10-20 次强制布局"的表述不够精确。**

`getBoundingClientRect()` 确实会触发 forced reflow（同步布局），但浏览器有**布局批处理优化**：在同一帧内、没有 DOM 写入的情况下，多次 `getBoundingClientRect()` 调用只会在第一次触发一次布局重计算，后续调用复用同一布局结果。

`updateActive` 函数只读取 DOM（`getBoundingClientRect`），不修改 DOM，所以一帧内所有 `getBoundingClientRect()` 调用共享同一次布局。准确说法是"1 次强制布局 + \~10-20 次 `getBoundingClientRect` 读取"——总开销比"10-20 次强制布局"小得多。

不过报告的结论方向仍然成立：即使只有 1 次强制布局，在滚动帧里做也是不必要的开销，用 IntersectionObserver 可以完全消除。只是量级被高估了。

### P1-2：smooth scroll 放大器 — **完全正确**

- `editor-dom.ts:47` 确认 `behavior: 'smooth'` ✅
- `useEditorSearch.ts:78` 确认 `behavior: 'smooth'` ✅
- smooth scroll 期间持续触发 scroll → 每帧一次 scroll-spy ✅

### P2-1：大文档双份内容 + history 100 组 — **正确，名称需更新**

- `file.ts:46` 确认 `currentFile.content` 常驻完整 markdown 字符串 ✅
- `editor-extensions.ts:131-136` 确认 StarterKit.configure 未覆盖 history/undoRedo ✅

**名称修正**：报告用的是旧版 TipTap 的 `@tiptap/extension-history` + `undoDepth: 100`。实际当前版本 StarterKit 用的是 `@tiptap/extensions` 的 `UndoRedo` 扩展（dist:636 确认 `depth: 100, newGroupDelay: 500`）。值是对的，但扩展名和配置项名变了——现在是 `UndoRedo` 扩展的 `depth` 选项，不是 `History` 扩展的 `undoDepth`。

### P2-2：缓存盘点 — **正确**

与 Step 2 核实结果一致，新增项也已确认：

- `resolvedImageCache` 文件切换时 `clear()`（第 220 行）✅
- remote image blob 文件切换不释放、`onBeforeUnmount` 释放（第 401 行）✅
- 50MB LRU 上限兜底 ✅

### P2-3：focus-mode opacity transition — **完全正确**

`editor.css:1402-1404` 确认 `transition: opacity 0.35s ease` ✅。opacity 走合成器不触发布局 ✅。

### 维度 1-6 — **全部正确**

六个维度的分析均已核实，与代码行为一致。报告自评的 ✅/⚠️ 标记准确。

---

## 总结

| 问题                         | 报告结论                           | 核实结果                                                            |
| -------------------------- | ------------------------------ | --------------------------------------------------------------- |
| P0-1 无虚拟化 + 无 CSS 优化       | 全篇无 content-visibility/contain | **完全正确**。措辞修正：optimizeLegibility 影响 shaping 不是 rasterize        |
| P0-2 多文档切换同步全量             | 三步串行、未修改也无法跳过                  | **正确**。但 isDirty 短路建议需修正：watch 触发时 store 已指向新文件，不能直接用当前 isDirty |
| P0-3 打开即全量加载               | 库懒加载但块急渲染                      | **正确**。补充：mermaid render 是 async 排队不是同步阻塞，但 CPU 尖峰结论仍成立         |
| P1-1 scroll-spy 强制布局       | 每帧 \~10-20 次强制布局               | **基本正确但高估**。布局批处理优化下实际 1 次强制布局 + N 次读取，不是 N 次强制布局               |
| P1-2 smooth scroll 放大      | 长距离跳转持续触发 scroll-spy           | **完全正确**                                                        |
| P2-1 双份内容 + history 100    | depth 默认 100                   | **正确**。名称更新：当前版本是 UndoRedo.depth 非 History.undoDepth            |
| P2-2 缓存盘点                  | 无泄漏                            | **正确**                                                          |
| P2-3 focus-mode transition | 良性                             | **正确**                                                          |

**整体评价**：这份报告的质量与 Step 2 持平——核心结论全部经代码实锤确认，修复方向正确。需要修正的都是精度层面：P1-1 的布局次数高估、P0-2 的 isDirty 短路实现细节、P0-3 的 mermaid 异步机制、P2-1 的扩展名称过时。这些不影响问题定位和修复优先级。

如果后续要动手修，**P0-1 的 **`content-visibility: auto` 收益最大但风险也最高（报告自己也在末尾标注了选中/搜索/IME 的兼容性风险，这是对的——`content-visibility: auto` 会让离屏元素的 `getBoundingClientRect` 返回 0 高度，可能破坏 scroll-spy 二分查找）。**P0-2 的 isDirty 短路收益确定、风险低**，但实现要小心 store 状态切换时序。P1-1 改 IntersectionObserver 是局部优化里性价比最高的。

 
