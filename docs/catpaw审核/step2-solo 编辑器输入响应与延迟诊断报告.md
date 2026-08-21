# solo 编辑器输入响应与延迟诊断报告（Step 2）

> 只读排查，未修改任何代码。排查日期：2026-08-21。
> 依据：以实际代码为准（含 node_modules 第三方实现），文档仅作参考。
> 核心问题：**用户按下一次键，到字符出现在屏幕上，中间有多少不必要的等待？**

---

## 一、核心结论（先答核心问题）

一次按键（**非 IME** 场景）从按下到上屏，主线程上发生了这些事：

```
keydown
 └─ PM handleKeyDown：遍历 ~10-20 个 keymap 插件做键位查找          → O(插件数)，可忽略
 └─ handleTextInput → inputrules：~14-16 条规则 × 光标前 500 字符上限  → 有界，可忽略
 └─ 默认插入事务 dispatch
     ├─ 各插件 state.apply
     │   ├─ code-block-lowlight：findChildren(oldDoc) + findChildren(newDoc)  ← ★ 2× 全文档 O(n)
     │   ├─ Suggestion ×2（/ 与 :）：对光标前文本节点跑 regex matchAll       → O(光标前文本)
     │   └─ 其余（历史/尾节点/占位符等）                                     → O(1)
     ├─ markdown-input appendTransaction：scanHeadings(newDoc)             ← ★ 全文档 O(n)
     └─ view.updateState
         ├─ 各插件 decorations(props) 全部重跑
         │   ├─ markdown-input：buildPendingHeadingDecorations(newDoc)      ← ★ 全文档 O(n)
         │   ├─ code-block-lowlight：getState → 已缓存 DecorationSet         → O(1) ✅
         │   ├─ paragraph-focus：focus 关→空；focus 开→全量顶层块遍历        → O(块数)/O(1)
         │   ├─ search-highlight：无匹配→空；有匹配→引用缓存                 → O(1) ✅
         │   └─ 其余                                                  → O(1)/null
         └─ DOM diff 渲染（真正必须做的工作）
```

**不必要的等待 \= 每次按键 4 次全文档 O\(n\) 遍历**（code-block-lowlight 贡献 2 次、markdown-input 贡献 2 次），全部因同一个机制失效——**每次事务都生成新的 doc 引用，以 doc 引用为 key 的 WeakMap 缓存必然 miss**。另有 1 个条件触发的全量重扫（focus mode 开启时）。防抖层（wordCount 150ms / outline 500ms / serialize 500ms）在连续打字时不触发，但在"停顿一下再打"的节奏下会把全文档序列化（全应用最贵的单次操作）塞进下一次按键前的主线程。

量级估算（非实测，供定位参考）：千节点文档单次 descendants 遍历约 0.3\~1ms，万节点大文档约 2\~8ms。4 次/按键 → 大文档 8\~30ms/按键，**直接打穿 16.7ms 帧预算**，表现为打字跟手度差、掉帧。中文 IME 场景事务被 PM 挂起到 compositionend 才批量落一次，该链每"词"触发一次而非每字符，感知弱得多——**P0 问题主要暴露在英文/代码输入**。

---

## 二、问题清单（按影响程度降序）

### P0-1【结构性】code-block-lowlight 每次事务无条件 2 次全文档遍历

**位置**：`node_modules/@tiptap/extension-code-block-lowlight/dist/index.js` LowlightPlugin `state.apply`（第 75\~107 行）

```js
const oldNodes = findChildren(oldState.doc, (node) => node.type.name === name); // 78 行
const newNodes = findChildren(newState.doc, (node) => node.type.name === name); // 79 行
```

`findChildren`（`@tiptap/core` dist/index.js:1277）是 `node.descendants()` 全量递归。这两行**无条件执行**——即使文档里一个代码块都没有、即使只是光标移动（selection 事务、docChanged\=false），也各跑一次全文档遍历。随后条件（第 80\~98 行）只在命中时才重新高亮，但**遍历本身每次都付**。

**叠加效应**：当条件命中（在代码块内输入）时，`getDecorations`（第 33\~52 行）先做**第三次** findChildren，再对**文档内所有代码块**逐个 `lowlight.highlight()` 重新分词——只改了一个代码块，却把全部代码块重新高亮一遍。多代码块、大代码块文档下这是每按键 O\(全部代码内容\) 的分词成本。

**结构性问题判定**：第三方扩展的 plugin 实现，项目内 `extensions/code-block.ts` 只包了节点定义与 NodeView，没有覆盖这个 plugin。属"第三方实现未做增量缓存"的架构级问题，但修法可以是局部的（见 §四）。

### P0-2【结构性】markdown-input 每次 docChanged 事务全文档 scanHeadings

**位置**：`src/components/Editor/tiptap/extensions/markdown-input.ts` `appendTransaction`（第 252\~264 行）

```js
const { emptyHeading, pendingHeading } =
  docChanged || pluginState?.forceCheck
    ? scanHeadings(newState.doc)   // 263 行
    : { emptyHeading: null, pendingHeading: null };
```

`scanHeadings`（第 463\~502 行）对 `newState.doc` 做 `doc.descendants` 全量遍历。`_scanCache` WeakMap 以 doc 引用为 key——每次按键产生新 doc，**缓存对击键永不生效**。唯一的提前退出条件是"找到一个空 heading 或 pending heading"；普通正文打字时两者都不存在，遍历走到底。

缓存并非完全无效：同一次按键内 `view.update` 钩子（第 183\~204 行）再调 `findPendingHeading(view.state.doc)` 时能命中 `appendTransaction` 刚写入的缓存——避免了同一 tick 内的第二次扫描。**但第一次扫描仍在，且每次按键都全量。**

### P0-3【结构性】markdown-input 每次 updateState 全文档重建 pending-heading decorations

**位置**：`markdown-input.ts` `decorations`（第 242\~249 行）+ `buildPendingHeadingDecorations`（第 552\~578 行）

```js
decorations(state) {
  if (state.doc === _cachedDoc && _cachedDecorations) return _cachedDecorations; // 缓存必然 miss
  _cachedDoc = state.doc;
  _cachedDecorations = buildPendingHeadingDecorations(state.doc); // 每次全量
  return _cachedDecorations;
}
```

已核实 prosemirror-view `updateState`（dist/index.js:4579 `viewDecorations`）在**每次状态更新**时对所有插件的 `props.decorations` 重跑。doc 引用变化 → 缓存 miss → 全文档 `descendants` 遍历 + 每个 paragraph 取 `node.textContent` 拼字符串跑正则。与 P0-2 是同一批数据、同一目的（找 pending heading），却独立遍历了两遍。

### P1-1【结构性，条件触发】focus mode 开启时每次按键重建全量块 decorations

**位置**：`src/components/Editor/tiptap/extensions/paragraph-focus.ts`（第 31\~65 行）

缓存命中条件含 `cachedDocSize === docSize`——**任何编辑都改变 docSize → miss** → `state.doc.forEach` 遍历全部顶层块 + `DecorationSet.create`。focus 关闭时提前返回 `DecorationSet.empty`（O\(1\)），默认不受影响；但 focus mode 是用户会长期开启的写作模式，开启时每次按键 O\(顶层块数\) 重建，与 P0 叠加。

### P2-1【局部，有界】两个 Suggestion 插件每次事务对光标前文本跑 regex

**位置**：`node_modules/@tiptap/suggestion/dist/index.js` `state.apply`（第 233\~291 行）；接入点在 `slash-commands.ts:211` 与 `emoji-suggest.ts:150`

每次事务（docChanged 与否）都会执行 `findSuggestionMatch`（第 6\~53 行）：对 `$position.nodeBefore.text`（光标前**整个文本节点**）做 `matchAll(regexp).pop()`。段落短时无感；**超长单段落**（如整篇粘贴进一个 paragraph、或很长的列表项）下为 O\(段落长度\) × 2 插件。是"悬在光标上的节点有多大"的局部问题，不随文档总长增长。

### P2-2【局部，有界】\~14-16 条 input rules 每次按键跑正则

prosemirror-inputrules 把匹配文本截断在光标前 500 字符（dist/index.js:56 `MAX_MATCH`，95 行 `textBetween`）。全部规则数约 14-16 条（StarterKit 4 条 + TaskList 1 + Highlight 1 + Bold 2 + Italic 2 + Strike 1 + Code 1 + Sup/Sub 2 + Wikilink 1 + MarkdownInput 2），单条成本微秒级，合计有界。✅ 不构成问题，仅记录在案。

### P3-1【防抖掩盖】serialize 500ms 防抖对"慢打字者"退化为每按键全文档序列化

**位置**：`src/composables/useEditorSync.ts`（第 54\~61 行，SERIALIZE_DEBOUNCE_MS\=500）

`debounce`（lodash trailing）语义：最后一次调用后停满 500ms 才执行。连续打字时永不执行（✅）；但**每次停顿 500ms 以上就执行一次**——慢打字、想一句想一会儿的打字节奏下，几乎每按键触发一次 `serializeMarkdown(ed.state.doc)`（全文档 markdown 序列化，全应用最贵单次操作，大文档 10\~100ms 量级），**同步阻塞主线程，期间的下一次按键被排队**。防抖"诚实"地保护了快打字者，却没保护慢打字者。

### P3-2【防抖掩盖】wordCount / outline 同构问题

`useEditorSync.ts` 第 44\~52 行：wordCount（150ms）与 outline（500ms）同为 trailing 防抖 + 全量计算（`getEditorWordCount` 全文档文本遍历、`extractEditorOutline` 全标题遍历），慢打字节奏下同样退化为每按键全量。且三条防抖链独立调度、不合并，可同帧撞车。

---

## 三、六维度明细

### 维度 1：按键后的 transaction 连锁反应链 ✅ 已梳理

完整链见 §一。要点：`onUpdate`（`MarkdownEditor.vue:187`）只踢 3 条防抖，`onSelectionUpdate`（第 192 行）走 `rafUpdateBubbleMenu`（RAF 合并，每帧最多一次，✅ 诚实）+ cursor 防抖（100ms）。`useAppDomEvents`（window keydown，第 47\~98 行）做键串化 + 命令线性查找，微秒级。**回调层干净，瓶颈全在插件层。**

### 维度 2：大文档 O\(n\) 全文遍历点盘点

| 遍历点                                      | 文件:行                     | 触发频率             | 能否复用现有缓存                                   |
| ---------------------------------------- | ------------------------ | ---------------- | ------------------------------------------ |
| `findChildren(oldDoc)`                   | 三方 lowlight:78           | 每次事务（含仅选区变化）     | ❌ 无条件，无缓存                                  |
| `findChildren(newDoc)`                   | 三方 lowlight:79           | 每次事务             | ❌ 同上                                       |
| `scanHeadings(newDoc)`                   | markdown-input.ts:263    | 每次 docChanged 事务 | ❌ doc 引用缓存对击键必 miss                        |
| `buildPendingHeadingDecorations(newDoc)` | markdown-input.ts:247    | 每次 updateState   | ❌ 同上                                       |
| `getDecorations` 全量重高亮                   | 三方 lowlight:34-51        | 代码块内输入时          | ❌ 每次全量分词                                   |
| paragraph-focus 顶层块重建                    | paragraph-focus.ts:49-63 | focus 开 + 每次编辑   | ❌ docSize 变化必 miss                         |
| `serializeMarkdown` 全文档                  | useEditorSync.ts:58      | 停顿 ≥500ms 一次     | ❌ 全量无增量                                    |
| `getEditorWordCount` 全文档                 | useEditorSync.ts:46      | 停顿 ≥150ms 一次     | ❌ 全量                                       |
| `extractEditorOutline` 全标题               | useEditorSync.ts:51      | 停顿 ≥500ms 一次     | ✅ WeakMap（state 引用），但 state 每按键换新，防抖内 miss |
| 搜索扫描 `findMatches`                       | useEditorSearch.ts:60    | 仅查询变化（120ms 防抖）  | ✅ 查询级防抖，非按键路径                              |

### 维度 3：IME 组合期间行为 ✅ 基本健康

- 组合期间 ProseMirror 挂起事务（`view.composing`），**每字符不打事务 → P0 全链不触发**，中文输入法不受影响。P0 只暴露在非 IME 路径。
- markdown-input 组合防护双保险：`compositionstart` 置 composing + `suppressUntil=∞`（第 214\~220 行），`appendTransaction` 第一行即 return（第 254\~255 行）；`compositionend` 置 50ms suppress + 定时 forceCheck（第 222\~238 行），上屏后一次 `scanHeadings` 兜底转换。设计正确。
- `view.update`（第 183\~204 行）组合中清 timer 不调度，防抖链也不在组合中触发。✅
- 唯一注意点：`compositionend` 后的 forceCheck 事务会再跑一次 P0-3 的 decorations 全量重建（每词一次，非每字符，可接受）。

### 维度 4：32 扩展隐性 per-transaction 开销盘点 ✅ 已逐个核对

| 扩展                                                                       | 插件                                                          | decorations            | input rules             | keymap        | 每按键开销           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------- | ----------------------- | ------------- | --------------- |
| StarterKit                                                               | keymap/inputrules/history/trailingNode/dropcursor/gapcursor | 无                      | 4（heading/codeBlock 已关） | \~25          | 有界 ✅            |
| CustomCodeBlock                                                          | lowlight                                                    | 缓存 getState            | 无                       | Tab/Enter 等   | **★ P0-1**      |
| SemanticHeading                                                          | 无                                                           | –                      | 空（已关）                   | –             | 无 ✅             |
| MarkdownInput                                                            | 自研                                                          | **★ P0-3**             | mathBlock+mermaid       | –             | **★ P0-2/P0-3** |
| MarkdownPaste                                                            | handlePaste/clipboardTextParser                             | 无                      | 无                       | –             | 仅粘贴 ✅           |
| ParagraphFocus                                                           | decorations                                                 | **★ P1-1**（focus 开）    | –                       | –             | 条件触发            |
| SearchHighlight                                                          | decorations                                                 | 引用缓存/空                 | –                       | –             | O\(1\) ✅        |
| SlashCommands/EmojiSuggest                                               | Suggestion×2                                                | 仅激活时                   | –                       | 激活时接管 keydown | **P2-1**        |
| Wikilink                                                                 | handleClickOn                                               | –                      | 1                       | –             | 有界 ✅            |
| LinkOpen                                                                 | handleClick                                                 | –                      | –                       | –             | 仅点击 ✅           |
| Link/TaskList/TaskItem/Highlight/Bold/Italic/Strike/Code/Sup/Sub         | 各 input rules/keymap                                        | –                      | 共 \~9                   | 少量            | 有界 ✅            |
| Table（三方）                                                                | table 插件                                                    | 仅 cell selection       | 无                       | Tab/方向键       | O\(1\) ✅        |
| Placeholder                                                              | decorations                                                 | 空 doc 才建               | –                       | –             | O\(1\) ✅        |
| Frontmatter/Callout/MathBlock/MathInline/MermaidBlock/Image/Footnote/Dim | 均无插件                                                        | NodeView 仅节点变化时 update | 无                       | –             | 无 ✅             |

### 维度 5：Vue 响应式意外触发 ✅ 干净，无意外

- `MarkdownEditor.vue` 模板（第 1\~31 行）：`EditorContent v-if="editor"` 只随 shallowRef 变化；编辑内容不进任何 Vue 响应式数据。✅
- `useEditorSync` 的 stats 经 `@update` → `useAppEditorState.handleEditorUpdate`（reactive 对象）→ Statusbar/OutlinePanel。全部走防抖，非按键路径。✅
- `syncEditedContent` 标脏 → titlebar `displayName` 计算属性 → CustomTitlebar 重渲染，发生在 serialize 防抖 tick（500ms），可接受。✅
- 无任何 watcher 监听 editor doc 变化做同步渲染。✅

### 维度 6：防抖机制诚实度

**诚实的部分**：防对了对象——docChange 踢 3 路（wordCount/outline/serialize），selectionChange 踢 cursor，互不串扰；文件切换 `cancelPending()` 清尾（`MarkdownEditor.vue:228`）；搜索 120ms 只防抖查询、不防抖编辑（正确，编辑期间高亮不做实时重扫）；cursor 100ms 防抖的对象 `getEditorCursorInfo` 本就是 O\(深度×兄弟\) 的廉价计算；bubble menu 用 RAF 合并而非 setTimeout（跟手）。✅

**不诚实的部分**：trailing 防抖的"停顿才执行"语义对慢打字者退化（P3-1/P3-2）；serialize 每次全量、无增量/脏区间；wordCount/outline/serialize 三条独立链同一事件流触发、各自计时，可同帧碰撞；无输入流水线预算（无"打满 16.7ms 帧"的度量手段，无法自查）。

---

## 四、修复方向（建议，仅排查不实施，待确认）

| 问题        | 建议方向                                                                                                                                                                                       | 类型              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| P0-2/P0-3 | 把 scanHeadings 从"全文档找 pending/empty heading"改为**增量**：缓存按 doc 版本 + 修改区间重扫，或改为只扫"光标所在段落 ± 邻近段落"（pending heading 只可能出现在光标附近）；decorations 与 appendTransaction 共享同一份扫描结果（两处已分别缓存、可合一）           | 局部可修            |
| P0-1      | ① 文档无代码块时短路（schema 有 codeBlock 类型 ≠ 文档有 codeBlock 节点，需先探测，但可用"首层块级遍历"代替全量 descendants，或维护模块级"是否见过代码块"标志）；② 有代码块时把两次 findChildren 合并为一次按 mapping 复用旧结果；③ 高亮只重算被修改的代码块，其余块沿用旧 decorations 映射 | 局部可修（wrap 三方插件） |
| P1-1      | paragraph-focus 改为按"光标所在顶层块"单块重建，或把缓存 key 从 docSize 换成"顶层块数组引用"                                                                                                                            | 局部可修            |
| P2-1      | Suggestion 的 apply 先做"nodeBefore 是否含触发字符"的 O\(1\) 探测再跑 regex                                                                                                                               | 局部可修            |
| P3-1/P3-2 | ① serialize 引入"内容 hash/长度哨兵"——非文档级变化（纯光标、纯格式无关变更）跳过；② 或把 serialize 从"停顿触发"改为"节流触发"（throttle leading，击键时才开始、期间不重跑），使慢打字者也能均摊；③ 合并三条防抖链为一条调度                                                 | 局部可修            |
| 度量        | 增加 `performance.mark/measure` 埋点（onUpdate 到下一帧 rAF），或 dev 下打印每次按键的 transaction 耗时，作为后续优化的验收手段                                                                                              | 建议              |

> 以上方向的共同点：**P0 三项都是"每事务全量重扫 + 缓存 key 选错（doc 引用必然 miss）"**，本质是把"内容级缓存"换成"变更区间级增量"，是编辑器性能问题的经典解，不涉及架构重构。

 

# dumate复审

报告读完了。现在逐一核实各个问题点。需要并行读取几个关键源码文件和第三方实现。

现在核实第三方库的实际实现——P0-1 的核心论据是 lowlight 插件无条件 2 次 findChildren。

第三方源码已确认。再快速核实 `findChildren` 的实现和 Suggestion 插件。

所有关键代码已读完。逐一给出核实结论。

---

## 核实结论

### P0-1：code-block-lowlight 每次事务无条件 2 次全文档遍历 — **完全正确**

第三方源码 `index.js:75-79` 实锤：

```js
apply: (transaction, decorationSet, oldState, newState) => {
  const oldNodeName = oldState.selection.$head.parent.type.name;
  const newNodeName = newState.selection.$head.parent.type.name;
  const oldNodes = findChildren(oldState.doc, (node) => node.type.name === name);  // 78 行
  const newNodes = findChildren(newState.doc, (node) => node.type.name === name);  // 79 行
```

`findChildren`（`@tiptap/core` dist:1277）内部是 `node.descendants()` 全量递归——确认无误。这两行在 `apply` 的最顶部，**没有任何前置短路条件**（不检查 `docChanged`、不检查文档是否含代码块）。即使纯光标移动（docChanged\=false），也会执行两次全文档遍历。

报告还提到"叠加效应"：当条件命中时 `getDecorations`（第 34 行）再做第三次 `findChildren` 并对**所有**代码块重新 `lowlight.highlight()`。这也准确——第 80-98 行的条件判断通过后调用 `getDecorations`，其内部第 34 行又跑一次 `findChildren`。

**有一个细节报告没提但值得补充**：第 106 行 `return decorationSet.map(transaction.mapping, transaction.doc)` ——当条件不命中时，走的是 `map` 路径（O\(旧 decoration 数量\)），这条路径本身开销不大，但两次 `findChildren` 已经付掉了。

### P0-2：markdown-input 每次 docChanged 全文档 scanHeadings — **正确，但缓存描述需修正**

代码核实：

- `appendTransaction`（第 257-263 行）：`docChanged` 为 true 时调用 `scanHeadings(newState.doc)` ✅
- `scanHeadings`（第 463-502 行）：内部 `doc.descendants` 全量遍历 ✅
- WeakMap `_scanCache` 以 doc 引用为 key（第 455-461 行）✅

**报告说"每次按键产生新 doc，缓存对击键永不生效"——这个结论正确，但原因描述不够精确。**

ProseMirror 的 doc 是不可变的（immutable），任何编辑操作（即使只改一个字符）都会生成新的 doc 对象引用。所以以 doc 引用为 key 的 WeakMap 在**任何编辑场景下**都必然 miss，不只是"每次按键"——这是 immutable 数据模型的固有特性，不是什么特殊 bug。报告的结论方向对，但把"immutable 模型下引用缓存必然 miss"这个普适问题表述得像是一个特定缺陷。

**报告关于 **`view.update` 命中缓存的描述准确：第 184 行 `if (view.state.doc.eq(previousState.doc)) return;` 先做结构相等检查，如果 doc 没变就跳过；如果变了，第 192 行 `findPendingHeading(view.state.doc)` 会调用 `scanHeadings`——但此时 `appendTransaction` 刚刚已经用同一个 `newState.doc` 调过一次并存入 WeakMap，所以这里命中缓存，不会二次全量遍历。✅

但有一个报告没提到的点：`scanHeadings` 有提前退出（第 475 行 `if (emptyHeading || pendingHeading) return false;`）——找到第一个就停。普通正文打字时两者都不存在，确实走到底。但如果文档开头就有一个 pending heading（比如用户刚打了 `# ` 还没敲空格后的内容），遍历会很快退出。报告说的"普通正文打字时遍历走到底"是对的，但没提这个提前退出机制。

### P0-3：markdown-input 每次 updateState 全文档重建 decorations — **正确**

`decorations`（第 242-249 行）实锤：

```js
decorations(state) {
  if (state.doc === _cachedDoc && _cachedDecorations) return _cachedDecorations;  // 缓存
  _cachedDoc = state.doc;
  _cachedDecorations = buildPendingHeadingDecorations(state.doc);  // 全量
  return _cachedDecorations;
}
```

同样以 `state.doc` 引用为 key，编辑必然 miss → `buildPendingHeadingDecorations`（第 552-578 行）做 `doc.descendants` 全量遍历。✅

**报告说 P0-2 和 P0-3 是"同一批数据、同一目的，却独立遍历了两遍"——这个判断需要修正。**

实际上两者目的不完全相同：

- `scanHeadings`（P0-2）找的是 **empty heading**（空标题）和 **pending heading**（待转换的 `# xxx` 段落），有提前退出
- `buildPendingHeadingDecorations`（P0-3）找的是 **所有** 匹配 `^(#{1,6})\s` 的段落，用于渲染 CSS class，**没有提前退出**，必须遍历到底

所以 P0-3 的遍历在"文档有很多 pending heading"时比 P0-2 更贵（P0-2 找到第一个就停，P0-3 要全部找完）。两者确实有重叠但不是"同一目的"，合并优化的可行性需要考虑这个差异。

### P1-1：focus mode 开启时每次按键重建全量块 decorations — **完全正确**

`paragraph-focus.ts:31-65` 实锤：

```js
decorations(state) {
  if (!isFocusModeActive()) return DecorationSet.empty;  // focus 关 → O(1)
  const activeBlock = state.selection.$head.before(1);
  const docSize = state.doc.content.size;
  if (cachedActiveBlock === activeBlock && cachedDocSize === docSize && ...) {
    return cachedDecorations;  // 缓存命中
  }
  // 缓存 miss → 全量重建
  state.doc.forEach((node, offset) => { ... });
```

缓存 key 含 `cachedDocSize === docSize`——任何编辑都改变 docSize → 必然 miss → `state.doc.forEach` 遍历全部顶层块。✅

报告说"focus 关闭时 O\(1\)"准确（第 32 行提前返回 `DecorationSet.empty`）。报告也正确指出这是**条件触发**——只有用户开了 focus mode 才生效。

**一个小修正**：报告说缓存 key 是 `docSize`，实际上 key 是 `activeBlock + docSize` 两个条件。光标在同一块内移动时 `activeBlock` 不变，但如果同时编辑了内容（docSize 变了），缓存仍然 miss。所以对于编辑场景，`docSize` 是决定性因素——报告的结论正确，只是表述上省略了 `activeBlock`。

### P2-1：两个 Suggestion 插件每次事务对光标前文本跑 regex — **基本正确，但触发条件需补充**

Suggestion 插件 `state.apply`（第 229 行起）实锤：

```js
apply(transaction, prev, _oldState, state) {
  const { selection } = transaction;
  const { empty, from } = selection;
  // ...
  if (isEditable && (empty || editor.view.composing)) {  // 第 247 行
    const match = findSuggestionMatch2({ ... $position: selection.$from });
```

`findSuggestionMatch2`（第 6 行起）对 `$position.nodeBefore.text` 做 `Array.from(text.matchAll(regexp)).pop()`。✅

**报告说"每次事务（docChanged 与否）都会执行"——需要修正。**

实际触发条件是 `isEditable && (empty || editor.view.composing)`：

- `empty` 指选区是否为空（光标而非选中文本）
- 所以**非空选区**（如选中一段文字）不会触发 `findSuggestionMatch`
- 但纯光标移动（选区为空、docChanged\=false）**确实会触发**——这点报告说对了

报告说"每次事务都执行"在"空选区"这个常见场景下成立（打字和光标移动都是空选区），但如果用户选中了文本，这个路径不会走。报告表述为"每次事务"略有夸大，但对"打字场景"的结论正确。

### P2-2：\~14-16 条 input rules — **报告自己标注了 ✅ 不构成问题**

无需核实，报告自评正确。

### P3-1/P3-2：防抖对慢打字者退化 — **正确**

`useEditorSync.ts:26-32` 确认：

```js
const WORD_COUNT_DEBOUNCE_MS = 150;
const OUTLINE_DEBOUNCE_MS = 500;
const SERIALIZE_DEBOUNCE_MS = 500;
const CURSOR_INFO_DEBOUNCE_MS = 100;
```

三条防抖链（wordCount 150ms / outline 500ms / serialize 500ms）各自独立 debounce，用的是 lodash trailing 语义。✅

报告说的"连续打字不触发、停顿 ≥500ms 触发一次全量序列化"准确。`serializeMarkdown` 是全文档遍历、无增量——这个在之前的性能优化（AGENTS.md #7 字数统计）中已有类似分析。

**一个报告没提到的缓解因素**：`debouncedSerialize` 内部有 `if (ed.isDestroyed) return;`（第 56 行）和文件切换时的 `cancelPending()`（`MarkdownEditor.vue:228`），所以不会在文件切换后写错文件。但这不影响"慢打字者每停顿触发一次全量序列化"的核心结论。

### 维度 3（IME 行为）— **正确**

报告说 IME 组合期间 ProseMirror 挂起事务、P0 链不触发——这是 ProseMirror 的标准行为。`markdown-input.ts` 的组合防护（第 214-238 行 `compositionstart`/`compositionend` 处理）也已核实，设计正确。

### 维度 5（Vue 响应式）— **正确**

`MarkdownEditor.vue` 模板确实只有 `EditorContent v-if="editor"`，编辑内容不进 Vue 响应式——之前核实第一份报告时已确认。报告判断"回调层干净，瓶颈全在插件层"准确。

---

## 总结

| 问题                      | 报告结论              | 核实结果                                                             |
| ----------------------- | ----------------- | ---------------------------------------------------------------- |
| P0-1 lowlight 2× 全文档遍历  | 无条件执行，每次事务        | **完全正确**。第三方源码实锤，无任何前置短路                                         |
| P0-2 scanHeadings 全文档遍历 | doc 引用缓存对击键必 miss | **正确**。补充：这是 immutable 模型的固有特性，非特定缺陷；有提前退出机制但普通打字走不到             |
| P0-3 decorations 全文档重建  | 与 P0-2 同批数据独立遍历两遍 | **正确但需修正**：两者目的不同（P0-2 找到第一个就停，P0-3 遍历到底），合并优化需考虑差异              |
| P1-1 focus mode 全量块重建   | docSize 变化必 miss  | **完全正确**。缓存 key 实际是 `activeBlock + docSize`，但编辑场景下 docSize 是决定因素 |
| P2-1 Suggestion regex   | 每次事务执行            | **基本正确但略有夸大**：非空选区不触发；空选区（打字/移动）确实触发                             |
| P3-1/P3-2 防抖退化          | 慢打字者每停顿触发全量       | **完全正确**。三条独立链、trailing 语义、全量计算                                  |
| 维度 3 IME                | 组合期挂起事务           | **正确**                                                           |
| 维度 5 Vue 响应式            | 干净无意外             | **正确**                                                           |

**整体评价**：这份报告的技术分析质量明显高于第一份启动报告。核心论点（P0-1 的第三方无条件遍历、P0-2/P0-3 的缓存 key 选错、P1-1 的条件触发）全部经代码实锤确认。需要修正的都是细节层面的精确度问题，不影响结论方向和修复优先级排序。

如果后续要动手修，**P0-1 收益最确定**——第三方插件每次事务无条件 2 次 `descendants` 是最硬的问题，且修法明确（wrap 或 fork 后加短路条件）。P0-2/P0-3 的增量优化方向也对，但要注意两者目的不同不能简单合并。
