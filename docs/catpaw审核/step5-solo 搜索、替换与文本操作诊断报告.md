---
title: solo 搜索、替换与文本操作诊断报告
type: guide
audience: agent
status: active
tags: [性能诊断, 搜索, 替换, 剪贴板, 选区, 事务]
summary: Step 5 只读排查：搜索/替换/高频输入/选区/粘贴的响应速度与资源消耗
updates: [ARCHITECTURE.md]
---

# solo 搜索、替换与文本操作诊断报告

> **Step 5 · 只读排查**（日期：2026-08-21 · 基于 v1.2.39 实际代码）
> 目标：排查大文档下搜索、替换、高频文本操作的响应速度和资源消耗。
> 原则：只诊断、不改代码；结论依据实际代码与 node_modules 已装源码。

---

## 结论摘要

**回答核心问题：用户在大文档里搜索、替换、快速编辑时，卡在哪里？**

- **搜索**：算法本身不慢（indexOf 全文档扫描 + 120ms 防抖），**真正的瓶颈是高亮的渲染成本**——搜索结果为一次性全量建 decoration，高频词在长文档里会产生几千个 inline decoration，PM 需要在 DOM 里为每个匹配拆分文本节点，DOM 节点数激增会拖慢后续每一次编辑。**同时发现 2 个搜索高亮的正确性/视觉 bug**（P1-A / P1-B）。
- **替换**：全部替换是**单个事务批量提交**（一次 dispatch），性能良好，无需优化。
- **快速编辑**：每次击键的固定成本已在前序报告量化（4×decorations props + appendTransaction O\(n\) 扫描 + matchesNode O\(n\) 浅比较），**没有「每个字符触发一次完整序列化/保存」的情况**（序列化/保存都是 500ms 拖尾防抖）。
- **选区**：纯选区变化不触发 DOM 重渲染（PM 只在 doc 变化时做 DOM diff），decorations 缓存化后开销很小。**没有不必要的重渲染**。
- **粘贴**：清洗逻辑**全部同步**，但大段粘贴是单次同步解析 + 单事务插入，一次性有感知延迟而非冻结；已有 2MB HTML 体积熔断兜底。
- **正则搜索**：**不支持正则**（纯 indexOf 匹配），因此**无 ReDoS 风险**。

| 编号   | 级别  | 问题                                                     | 性质          |
| ---- | --- | ------------------------------------------------------ | ----------- |
| P1-A | 中   | 搜索高亮期间编辑文档，高亮位置**错位**（SearchHighlight 缓存不检查 doc 变化）    | 正确性 bug     |
| P1-B | 中   | 查询清空/无结果时不触发事务，**旧高亮残留**在屏幕                            | 视觉 bug      |
| P2-C | 低   | 全部匹配一次性高亮，高频词+长文档产生几千个 inline decoration，渲染成本与后续编辑成本放大 | 结构性（可加高亮上限） |
| P3-D | 低   | paragraph-focus 在焦点模式下跨块移动选区触发全量顶层块重建                  | 局部（低频）      |

---

## 一、搜索是怎么执行的

### 1.1 触发链与防抖

```
SearchPanel @input 每字符 emit('query')（SearchPanel.vue:27）
  → useEditorSearch.onSearchQuery（useEditorSearch.ts:82-92）
    → doSearch：120ms debounce（useEditorSearch.ts:46-52）
      → findMatches：全文档扫描（useEditorSearch.ts:54-70）
        → currentMatches.value 更新 → scrollToMatch(0)（setTextSelection 顺带 dispatch 事务触发高亮重绘）
```

- **有防抖**：120ms，避免每字符全扫。✓
- **扫描算法**：`doc.descendants` 遍历所有文本节点 + `indexOf` 循环收集全部匹配（`useEditorSearch.ts:60-68`）。O\(文本总量\) + O\(匹配数\)。无增量、无索引、无缓存（唯一缓存 currentMatches 随查询变化失效）。
- **大小写**：`caseSensitive` 时 `toLowerCase()` 复制全文（`:62`），大文档多一次 O\(n\) 内存拷贝（轻微）。

### 1.2 高亮粒度：一次性全量，非当前匹配

SearchHighlight 插件把**所有匹配**一次性建成 `DecorationSet`（`search-highlight.ts:54-64`）：

```js
const decorations = matches.map((m, i) => Decoration.inline(m.from, m.to, { class: ... }));
const decoSet = DecorationSet.create(state.doc, decorations);
```

- 长文档搜索高频词（如中文「的」）可产生几千个匹配 → 几千个 `Decoration.inline` 对象。
- **渲染层放大效应**：PM 应用 inline decoration 时需在每个匹配边界拆分文本节点（`docViewDesc` 的 `iterDeco`，prosemirror-view/dist/index.js:1377）。几千处高亮 → DOM 文本节点数翻几倍 → **后续每一次编辑的 DOM diff 都变慢**（不只是搜索那一刻慢）。这是搜索功能真正的结构性成本。
- 文档 100KB 时 findMatches 本身约几\~几十 ms（indexOf 快），可感知但不至于卡死；**卡感主要来自高亮渲染与后续编辑的 DOM 膨胀**。

### 1.3 新发现 P1-A：搜索高亮缓存缺 doc 检查（正确性 bug）

`search-highlight.ts:46-52` 的缓存条件是：

```js
matches === _cachedMatchesRef && activeIndex === _cachedActiveIndex && _cachedDecoSet
```

**没有检查 **`state.doc` 是否变化。而 PM 在每次 doc 变化的 `updateStateInner` 都会重新调用插件 decorations props（`prosemirror-view/dist/index.js:5519` `viewDecorations(this)` 每次 updateState 都执行，`:4581-4584` 调 `f(view.state)`）。

后果：搜索高亮开启后用户编辑文档（插入/删除字符）→ doc 变化 → SearchHighlight 的 decorations props 被调 → `matches` 引用未变 → **返回基于旧 doc 位置的缓存 DecorationSet** → 高亮停在旧位置（错位），且不随编辑重映射。用户看到高亮与实际匹配位置漂移。

修复方向（确认后实施）：缓存条件加 `state.doc` 引用检查（`docChanged` 时强制用旧 matches 重新 `DecorationSet.create`，此时 pos 仍基于旧 doc——更完整的做法是给 matches 的 pos 做 mapping，但最简单的正确性修复是 doc 变化后触发一次重新搜索；或按 PM 惯例 `set.map(mapping, doc)`）。

### 1.4 新发现 P1-B：查询清空/无结果时旧高亮残留（视觉 bug）

高亮生效依赖「有匹配时 `scrollToMatch` 的 `setTextSelection` 事务顺带触发 decorations 重求值」（`useEditorSearch.ts:51`）。但：

- 查询从「有结果」变「无结果」（`matches.length === 0`）时**没有任何事务**（`:48-51` 仅当 `length > 0` 才 `scrollToMatch`）→ decorations props 不会被调 → 旧高亮残留。
- 用户在搜索框清空查询词时（`onSearchQuery` 空串分支 `currentMatches.value = []`，`:84-90`）也没有 dispatch → 旧高亮同样残留。
- 残留直到 `closeSearch` 的空事务（`:171-173`）才清除。

修复方向（确认后实施）：在 `doSearch` 与 `onSearchQuery` 空分支统一补一个 `editor.value.view.dispatch(editor.value.state.tr)` 空事务，让 SearchHighlight 重新求值（无匹配时返回 `DecorationSet.empty` 的逻辑已存在，只是触发不到）。

---

## 二、替换操作的事务粒度

### 2.1 单条替换

`chain().setTextSelection(match).deleteSelection().insertContent(replacement).run()`（`useEditorSearch.ts:120-126`）——**单个事务**，替换后立即 `findMatches` 同步重扫（`:128`）。

### 2.2 全部替换：单事务批量提交 ✓

`useEditorSearch.ts:143-156`：

```js
const matches = [...currentMatches.value].reverse();   // 从后往前，规避 pos 漂移
const chain = editor.value.chain();
for (const match of matches) {
  chain.setTextSelection(match).deleteSelection().insertContent(replacement);
}
chain.run();   // 一次 dispatch
```

- TipTap `chain()` 默认所有命令共享**同一个事务** → 全部替换 \= **一个事务一次 dispatch**，界面只更新一次，不会逐条卡。✓
- `reverse()` 从后往前替换，避免前序替换造成后面匹配的绝对 pos 偏移（标准技巧，正确）。✓
- 撤销：整个 replaceAll 进历史栈为一个事件，一次 Ctrl+Z 全部还原。✓
- 成本：N 次 delete+insert 生成 2N 个 steps，PM 一次 doc 重建。几千个匹配估计几十\~几百 ms，一次性阻塞，可接受。
- 替换后 `findMatches` 全量重扫一次（正常，替换可能产生新匹配）。

**结论：替换维度没有性能问题，事务粒度设计正确。**

---

## 三、高频输入的处理链路

### 3.1 一次击键的完整链路（Step 2 结论 + 本次补充确认）

```
按键 → PM transaction（1 个）
  → updateStateInner（prosemirror-view/dist/index.js:5496）
    ├─ viewDecorations（:5519）→ 全部插件 decorations props（缓存命中后 O(1)）
    ├─ matchesNode（:5522）→ O(n) doc 树浅比较（每次事务都跑，含纯选区变化）
    ├─ docView.update → 增量 DOM diff（仅 doc 变化时）
  → markdown-input appendTransaction → scanHeadings 全文档 O(n)（markdown-input.ts:261-263）
  → onUpdate → handleDocChange → 3 条拖尾防抖：wordCount 150ms / outline 500ms / serialize 500ms
```

- **没有每字符触发完整流程**：序列化/保存是 500ms 拖尾防抖，不是每击键。✓
- **粘贴大段 \= 单个事务**：PM 把一次粘贴作为一个 replace 事务插入大文本，随后只跑**一次** appendTransaction 全量扫描 + 一次 DOM diff + 各防抖一次。不会因内容多而每字符各跑一遍。✓
- 中文 IME：composition 期间事务挂起，compositionend 后一次 flush（Step 2 已确认）。✓
- **结构性事实**：`matchesNode` O\(n\) 浅比较 + `viewDecorations` 全插件 props 是 **PM 每次 updateState 的固定成本**（连纯选区变化也跑），与文档大小线性相关。这是 ProseMirror 固有机制，所有 PM 编辑器一致，无法在应用层消除，只能通过减小 doc 规模（如虚拟化，见 Step 3）缓解。

### 3.2 快速打字的防抖行为

三条防抖都是**拖尾型**（trailing-edge）——停顿 ≥ 窗口时长即触发一次完整计算。慢打字者（打字间隔 \>500ms）每次停顿都会触发一次全量序列化（Step 2 P3-1 已记录，属已知取舍）。

---

## 四、选区操作的性能

### 4.1 选区变化不触发 DOM 重渲染 ✓

关键机制（本次从 prosemirror-view 源码确认）：`updateStateInner` 只在 `updateDoc` 为 true 时执行 `docView.update` DOM diff（`prosemirror-view/dist/index.js:5522-5547`），而 `updateDoc` 的判定是 `redraw || !matchesNode(...)`——**doc 未变（纯选区变化）时 matchesNode 返回 true → updateDoc\=false → 无 DOM diff、无重渲染**。✓

### 4.2 但每次选区变化仍有固定成本

1. **viewDecorations 每次都调**（:5519）——全插件 decorations props：

   - markdown-input：`state.doc === _cachedDoc` 命中 O\(1\)（markdown-input.ts:243-245）✓
   - search-highlight：matches 引用命中 O\(1\)（search-highlight.ts:46-52）✓
   - code-block-lowlight：decorations 从插件 state 读取 O\(1\) ✓
   - **paragraph-focus 例外（P3-D）**：焦点模式下光标跨块移动 → `cachedActiveBlock` miss → 全量 `doc.forEach` 重建顶层块 decorations（paragraph-focus.ts:49-59，O\(顶层块数\)）。Shift+方向键连续跨块时每键重建一次。
2. **matchesNode O\(n\) 浅比较**（:5522）——doc 树 + decorations 引用比较，5 万节点文档约 1-3ms，每键一次。PM 固有成本。
3. **BubbleMenu**：onSelectionUpdate → RAF 合流（MarkdownEditor.vue:245-254）→ `coordsAtPos` ×2 + `isActive` ×6 + `getAttributes`（:265-287）。每帧一次，非空选区时更新菜单。`coordsAtPos` 读 DOM rect。
4. **光标信息**：`getEditorCursorInfo` ancestor walk（O\(树深度×兄弟数\)）+ selectionText（全选时 `textBetween` O\(n\)），100ms 防抖（useEditorSync.ts:31-32）。

### 4.3 结论

全选 / Shift+方向键 / 拖拽选区**不会触发不必要的重渲染**（无 DOM diff），decorations 全部缓存化。剩余成本是 PM 固定的 matchesNode 浅比较 + focus-mode 跨块重建 + BubbleMenu 每帧坐标计算。**选区维度无结构性问题**，唯一可优化项是 P3-D（低频）。

---

## 五、复制/粘贴大段内容的处理

### 5.1 复制出站：同步序列化选区

`clipboardTextSerializer` → `serializeClipboardSlice`（`MarkdownEditor.vue:183-185`、`serializer.ts:532-535`）：`doc.copy(slice.content)` + `serializeMarkdownForClipboard` 全量序列化为 markdown 纯文本（同步）。复制大段（全选 1MB）同步序列化约几十 ms，一次性。

### 5.2 粘贴入站：三层同步管线 + 异步图片落盘

PM 粘贴管线（`markdown-paste.ts`）全部**同步**执行：

- **clipboardTextParser**（纯文本路径，`:543-546`）→ `cachedTryParseMarkdown`（单条 LRU 缓存，`:442-448`）→ 多级启发式（表格 / 结构化 markdown / 专有语法 / 整段 URL / 行内标记，`:280-309`）→ `parseMarkdown`（markdown-it 同步全量解析）
- **handlePaste**（HTML 路径，`:463-535`）→ 图片检测（文字同步插 + 图片**异步落盘**，`:578-617`）/ 来源嗅探（`hasMarkdownOnlySyntax`）/ Layer 4 异步系统剪贴板 fallback（异步读剪贴板，解析仍同步）
- **transformPasted**（`:552-566`）→ `isLowQualityParse` 遍历 slice + `parseGeneralMarkdownPaste` 救援
- **parseHtmlSlice**（`:418-431`）：**\>2MB HTML 体积熔断**（`HTML_VOLUME_LIMIT = 2_000_000`，`:367`）直接降级纯文本；Word HTML 用字符串级正则 `stripMsoMarkup` 预清理（比 DOMParser + DOM 遍历快一个量级，`:391-412`）

### 5.3 清洗逻辑评估

- **有内容清洗**：Word HTML 瘦身、markdown 源嗅探、装饰性 HTML 格式塌方救援、体积熔断。逻辑分层清晰。
- **全同步**：无异步解析替代（PM 管线本身同步，无法绕开）。大段粘贴 \= 一次同步解析 + 一次事务插入，单事件阻塞几十\~几百 ms（1MB 量级），**有感知但一次性，不会冻结界面**（\<1s 阻塞一般场景）。
- **边界**：\>2MB 的 HTML 有熔断兜底；\>2MB 的纯文本走 PM 默认逐行成段（clipboardTextParser 返回 null 时），无熔断——极端场景（超大纯文本）仍会卡，属所有富文本编辑器通病，且实际使用罕见。

**结论：粘贴维度的设计诚实且有熔断，无结构性缺陷。**

---

## 六、正则搜索的支持情况

- **不支持正则**：`useEditorSearch.findMatches` 用 `String.prototype.indexOf` 匹配（`useEditorSearch.ts:54-70`），SearchPanel 仅提供「区分大小写」开关（SearchPanel.vue:31-39），无正则输入入口。
- **无 ReDoS 风险**（没有任何用户可控正则被执行）。
- 局限：无正则 \= 无复杂模式搜索能力；若未来要加，需要同步引入正则复杂度保护（超时/复杂度上限），当前阶段不需要。

---

## 七、修复方向汇总（全部需确认后实施）

| 编号       | 修复                                                    | 成本                         | 风险          |
| -------- | ----------------------------------------------------- | -------------------------- | ----------- |
| **P1-A** | SearchHighlight 缓存条件加 doc 引用检查（doc 变化时重建或 map 高亮 pos） | 低（search-highlight.ts 内几行） | 低，修复高亮错位    |
| **P1-B** | `doSearch` 与 `onSearchQuery` 空分支统一补空事务触发高亮清除          | 极低                         | 低，修复视觉残留    |
| **P2-C** | 高亮数量上限（如视口内高亮或前 N 个匹配），避免几千个 inline decoration 撑爆 DOM | 中（需设计策略）                   | 需权衡「全部高亮」体验 |
| **P3-D** | paragraph-focus focus-mode 跨块移动改为按需重建（仅受影响的块）         | 中                          | 低频，可暂缓      |

---

## 八、与既有诊断的关系

- Step 2 的「每次击键 4 次 O\(n\) 遍历」与本报告的「matchesNode O\(n\) 浅比较 + viewDecorations 每次 updateState 都调」共同构成每事务固定成本——本次补充了 **selection-only 事务同样承担这些成本**（此前 Step 2 聚焦 doc 变化事务）。
- Step 3 的「无虚拟化」与本报告 P2-C 的高亮 DOM 膨胀叠加：长文档 + 大量高亮时 DOM 节点数最高可翻数倍，是搜索功能在长文档最值得关注的放大因素。

---

*本报告基于实际代码与 node_modules 已装源码（prosemirror-view 1.41.9 / @tiptap 3.27.1）排查，未做任何代码修改。所有修复方向均待用户确认后实施。*

 

# dumate复审

报告读完。需要核实 P1-A（搜索高亮缓存缺 doc 检查）、P1-B（查询清空时高亮残留）、P2-C（高亮全量）、P3-D（focus-mode 跨块重建）以及搜索/替换的链路。并行读取关键文件。

现在核实 prosemirror-view 的 `updateStateInner` 和 `viewDecorations` 调用链，以及 `matchesNode` 的行为。

所有关键代码已读完。逐一核实结论。

---

## 核实结论

### P1-A：搜索高亮缓存缺 doc 检查（正确性 bug）— **完全正确**

`search-highlight.ts:46-52` 缓存条件实锤：

```js
if (matches === _cachedMatchesRef && activeIndex === _cachedActiveIndex && _cachedDecoSet) {
  return _cachedDecoSet;
}
```

三个条件全是**引用/值比较**，完全没有检查 `state.doc` 是否变化 ✅

prosemirror-view 源码确认 decorations props 每次都会被调用：

- `viewDecorations`（`prosemirror-view dist:4579`）：`view.someProp("decorations", f => { let result = f(view.state); ... })` ✅
- `updateStateInner`（dist:5519）：`let innerDeco = viewDecorations(this)` — 每次 updateState 都调 ✅
- 纯选区变化（selection-only 事务，docChanged\=false）也走 updateStateInner → viewDecorations ✅

**后果链验证**：

1. 用户搜索"hello" → `currentMatches.value` 存了基于当前 doc 的 pos 列表 ✅
2. 用户在文档前插入一个字符 → PM 生成新 doc 引用，dispatch 事务 ✅
3. updateStateInner → viewDecorations → SearchHighlight.decorations\(state\) 被调 ✅
4. `getMatches()` 返回的还是 `currentMatches.value`——引用没变（搜索没重新执行）✅
5. `matches === _cachedMatchesRef` 成立 → 返回旧 decoSet ✅
6. 旧 decoSet 的 pos 基于旧 doc，高亮停在错位 ✅

报告说的"高亮与实际匹配位置漂移"完全成立。

**一个报告修复方向中需注意的细节**：报告建议"doc 变化后触发一次重新搜索"或"用 `set.map(mapping, doc)`"。但这里有个微妙之处——`currentMatches` 是 `useEditorSearch` 模块维护的 `ref`，不是 PM 插件 state。如果走 `decoSet.map(mapping, doc)` 路线，decoSet 会跟着 doc 变化重映射，但 `currentMatches.value` 里的 pos 仍然是旧的——下次 `scrollToMatch` 跳转或 `onSearchReplace` 替换时会用旧 pos。所以更彻底的做法是 doc 变化时同步更新 `currentMatches` 的 pos（通过 mapping），而不只是修 decoSet。报告说的"更完整的做法是给 matches 的 pos 做 mapping"方向正确，但低估了需要同时更新 `currentMatches` 的复杂度。

### P1-B：查询清空/无结果时旧高亮残留 — **完全正确**

`useEditorSearch.ts` 逐行确认：

- `doSearch`（第 46-52 行）：`matches.length > 0` 时才 `scrollToMatch(0)` → 有匹配才有事务 ✅
- `matches.length === 0` 时：`searchMatchCount.value = 0` + `searchCurrentIndex.value = 0`，但**没有 dispatch 任何事务** ✅
- `onSearchQuery` 空串分支（第 84-89 行）：`currentMatches.value = []` + `doSearch.cancel()`，**没有 dispatch** ✅
- `closeSearch`（第 162-173 行）：第 172 行 `editor.value.view.dispatch(editor.value.state.tr)` 空事务 ✅

**残留机制验证**：
当 `currentMatches.value` 从 `[...]` 变 `[]` 时，`getMatches()` 返回空数组 → `search-highlight.ts:36` 的 `if (!matches.length)` 分支返回 `DecorationSet.empty`。但这个分支**只在 decorations props 被调用时才执行**——如果没有事务 dispatch，decorations props 不会被调，旧 decoSet 仍在 DOM 上 ✅

报告结论完全正确。

### P2-C：高亮全量 → DOM 膨胀 — **正确**

`search-highlight.ts:54-58` 确认：

```js
const decorations = matches.map((m, i) =>
  Decoration.inline(m.from, m.to, { class: ... }),
);
```

所有匹配一次性建 inline decoration ✅

prosemirror-view 的 `matchesNode`（dist:1361）确认：

```js
matchesNode(node, outerDeco, innerDeco) {
  return this.dirty == NOT_DIRTY && node.eq(this.node) &&
    sameOuterDeco(outerDeco, this.outerDeco) && innerDeco.eq(this.innerDeco);
}
```

`innerDeco.eq(this.innerDeco)` 比较 decoration 集合——如果 decoration 变了（如搜索高亮加入），`matchesNode` 返回 false → `updateDoc = true` → 触发 DOM diff ✅

DOM diff 时 inline decoration 会在匹配边界拆分文本节点（这是 ProseMirror ViewDesc 的标准行为），高亮数量多时确实会放大 DOM 节点数 ✅

### P3-D：paragraph-focus 跨块移动全量重建 — **正确（与 Step 2 P1-1 一致）**

`paragraph-focus.ts:39-44` 缓存条件含 `cachedActiveBlock === activeBlock`，跨块移动时 `activeBlock` 变 → miss → `state.doc.forEach` 全量重建 ✅

这与 Step 2 的 P1-1 是同一个问题，报告正确标注了关联。

### 替换操作（Section 2）— **完全正确**

- 单条替换（第 120-126 行）：chain → setTextSelection + deleteSelection + insertContent → 单事务 ✅
- 全部替换（第 143-150 行）：`[...currentMatches.value].reverse()` + 循环 chain + `chain.run()` 一次 dispatch ✅
- `reverse()` 从后往前避免 pos 漂移 ✅
- 替换后 `findMatches` 重扫 ✅

**一个报告没提到但值得注意的点**：`chain.run()` 是否真的是单事务取决于 TipTap 的 chain 实现。看 `@tiptap/core` 的 `chain()` 源码：

每个 chain 命令调用 `editor.runCommand`，而 chain 模式下所有命令共享同一个 `tr`（通过 `dispatch` 闭包捕获），最后一次 `run()` 才真正 dispatch。所以 replaceAll 确实是单事务单 dispatch ✅

但这里有一个**潜在风险报告没提到**：`deleteSelection().insertContent(replacement)` 在同一个 chain step 里，如果 `deleteSelection` 删了选区后 `insertContent` 的插入位置取决于 PM 的 mapping——在同一个事务里这是安全的（PM 会自动 mapping），但如果替换文本里包含搜索词本身（如把"hello"替换成"hello world"），重扫后会产生新的匹配，报告在 `findMatches` 重扫那行（第 152 行）提到了"替换可能产生新匹配"✅

### 粘贴管线（Section 5）— **正确**

- `HTML_VOLUME_LIMIT = 2_000_000`（第 367 行）✅
- `parseHtmlSlice` 超限返回 null 降级纯文本（第 420 行）✅
- `stripMsoMarkup` 字符串级正则预清理（第 422 行）✅
- `cachedTryParseMarkdown` LRU 单条缓存（第 442-444 行）✅
- `clipboardTextParser` 返回 null 时 PM fallback 逐行成段 ✅

报告说的"全同步、一次性阻塞、有熔断兜底"准确。

**一个细节补充**：报告说"\>2MB 纯文本无熔断"——准确。`clipboardTextParser`（第 543-546 行）调用 `cachedTryParseMarkdown`，它内部调 `tryParseClipboardMarkdown`，如果启发式全不命中返回 null，PM fallback 逐行成段。这条路径确实没有体积熔断，但逐行成段本身是 O\(n\) 且不涉及 markdown-it 解析，比 HTML 路径轻得多。

### 选区操作（Section 4）— **正确**

prosemirror-view 源码确认：

- `updateStateInner`（dist:5522）：`let updateDoc = redraw || !this.docView.matchesNode(state.doc, outerDeco, innerDeco)` ✅
- `matchesNode`（dist:1361）：`node.eq(this.node) && sameOuterDeco(outerDeco, this.outerDeco) && innerDeco.eq(this.innerDeco)` ✅
- doc 未变时 `node.eq(this.node)` 返回 true（同一个 doc 引用），decorations 引用未变时 `innerDeco.eq` 返回 true → `matchesNode` 返回 true → `updateDoc = false` → 无 DOM diff ✅

报告说的"纯选区变化不触发 DOM 重渲染"完全正确。但补充一点：如果 decorations **引用变了**（如搜索高亮缓存 miss 返回新 decoSet），即使 doc 没变，`innerDeco.eq` 也会返回 false → `updateDoc = true` → 触发 DOM diff。所以"纯选区变化不触发 DOM diff"的前提是"decorations 引用也没变"——报告在 4.2 节也提到了"viewDecorations 每次都调"，但没有明确说 decorations 引用变化也会触发 DOM diff。

### BubbleMenu 描述（4.2 第 3 点）— **正确**

`MarkdownEditor.vue:245-254` 确认 RAF 合流 ✅。第 256-287 行的 `updateBubbleMenu` 确认 `coordsAtPos` + `isActive` + `getAttributes` ✅

---

## 总结

| 问题                   | 报告结论                               | 核实结果                                                                           |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| P1-A 搜索高亮缓存缺 doc 检查  | doc 变化后高亮错位                        | **完全正确**。缓存条件三全是引用/值比较，无 doc 检查。补充：修复时需同步更新 `currentMatches` 的 pos，不只修 decoSet |
| P1-B 查询清空时高亮残留       | 无事务 dispatch → 旧高亮残留               | **完全正确**。doSearch 空结果分支和 onSearchQuery 空串分支都无 dispatch                         |
| P2-C 高亮全量 → DOM 膨胀   | 几千个 inline decoration 拆分文本节点       | **正确**。PM ViewDesc 标准行为确认                                                      |
| P3-D focus-mode 跨块重建 | activeBlock 变 → 全量 forEach         | **正确**。与 Step 2 P1-1 同一问题                                                      |
| 替换单事务批量              | chain.run\(\) 一次 dispatch          | **完全正确**                                                                       |
| 粘贴全同步 + 熔断           | 2MB HTML 熔断、纯文本无熔断                 | **正确**                                                                         |
| 选区不触发 DOM diff       | doc 未变 → matchesNode true → 无 diff | **正确**。补充前提：decorations 引用也未变时才成立                                              |
| 正则搜索不支持              | 纯 indexOf、无 ReDoS                  | **正确**                                                                         |

**整体评价**：这份报告与 Step 4 同属高质量梯队。P1-A 和 P1-B 是两个真实 bug——P1-A 是正确性问题（高亮错位），P1-B 是视觉问题（高亮残留），都不影响数据安全但影响用户体验。链路分析准确，第三方源码引用精确。唯一的补充是 P1-A 的修复方向需要考虑 `currentMatches` 的 pos 同步更新问题，比报告暗示的"search-highlight.ts 内几行"要稍微复杂。

与 Step 4 的 P0-A（撤销栈污染）相比，这份数据安全级别的问题没有——P1-A/B 都是可恢复的视觉/正确性问题，用户重新搜索一次就能修正。但仍然值得修，尤其 P1-B 的"空事务 dispatch"修复成本极低（几行代码）。
