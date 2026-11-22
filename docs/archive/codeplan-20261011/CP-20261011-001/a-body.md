---
plan_id: CP-20261011-001
revision: 3
reviewers: [B1]
---

# 剪贴板出站链路优化方案

> 来源：合并审核稿与复审稿，A 独立从磁盘 + 跑真实依赖实测逐条验证。**revision 3 据第 2 轮审核收敛范围**：把 P1-4（出站 HTML 失真）从「改法」移出、单列待拍板——因其字符串级预处理会误伤代码块、KaTeX 无逐式回落会拖垮整篇复制、判据复用来源未导出，做错了比现状更伤内容；本方案本轮只把 P1-1/P1-2/P1-3 钉成可直接执行。P1-1 的根因（`fromString` 数字强转）是**属性通道通用崩溃类**，故加一处 `stripZwnj` 总兜底。本文件是方案正文与执行依据，只由 A 写。

## 问题

四条出站路径（`Ctrl+C` 普通选区 / `Ctrl+C` 单元格选区 / Mod+Shift+M「复制为 Markdown」/「复制全文」按钮 / solo→solo 粘贴）的缺陷：

**本方案本轮修（P1）**：
1. **P1-1 脚注经 HTML 往返后崩序列化（属通用类）**：粘贴/往返后 `label` 由字符串变数字，`stripZwnj(数字)` 抛 `TypeError`。`serializeMarkdown` 在四处被裸调，连带失效：① 防抖脏检查静默罢工（脏标不更新、自动保存不再存）；② 卸载前 `flushPendingSerialize` 抛则跳过 `editor.destroy()` ⇒ NodeView/监听器泄漏；③ 手动存盘脏门禁在 try 外；④ 关窗链抛被 `useAppWindowSession` try 接住、表现为「窗口关不掉」（非静默丢）。同一 `fromString` 强转对**任何无 `parseHTML` 的字符串属性**成立（图片 alt/title/src 同形），不止脚注。
2. **P1-2 脚注引用 solo→solo 丢失**：`footnoteRef`（`sup[data-footnote-ref]`）被 superscript mark（`sup`）抢先命中，atom 不创建，退化成上标字面 `[^1]`。依赖 P1-1（修好后其 label 同样强转，须一并锁）。
3. **P1-3 整表选区丢 GFM 源码**：`isTableInternal` 误含 `'table'`，`stripOpenLayers` 对闭合整表也无条件剥 ⇒ Mod+Shift+M 拿到逐格散字而非 `| … |`。

**登记但不并入本轮（P2）**：P2-1 text/plain 表格走 `textBetween('\n\n')` 逐格竖排、与 CellSelection 的 TSV 不一致（独立决策，不被 P1-3 顺带修掉）。

**移出本方案、单列待拍板**：P1-4「复制全文」按钮 text/html 对 callout/wikilink/数学/mermaid 四种失真——见「不改什么」与末尾「P1-4 另案」。

**不改（仅记录）**：P2-2 CellSelection 丢格内行内格式（#9 既定取舍）。

> 双管道（C2）：text/html 有两个生产者——`Ctrl+C` 走 PM `DOMSerializer`（renderHTML）、按钮走 markdown-it。本方案 P1-1/P1-2 影响两路共用的 parse/序列化；P1-4（按钮的 markdown-it 路）另案。

## 代码仓

B 只从下列路径读代码、以磁盘当前内容为准：

- 待改：`serializer.ts`、`markdown/plugins/footnote.ts`、`extensions/footnote.ts`、`extensions/sub-sup.ts`、`zwnj.ts`、`MarkdownEditor.vue`、`editor-commands.ts`、`composables/useEditorSync.ts`、`composables/useDocumentSession.ts`（均在 `src/components/Editor/tiptap/...` 或 `src/...` 对应目录）
- P1-1 闸口/调用方（核 try/catch 与传播）：`App.vue`、`composables/useAppWindowSession.ts`
- P1-4 另案相关（本轮不改，但执行/复核时可能引用）：`utils/markdown-to-html.ts`、`components/StatusbarQuickActions.vue`、`markdown/plugins/callout.ts`、`markdown/plugins/wikilink.ts`、`markdown/plugins/frontmatter.ts`、`extensions/math-block.ts`
- 参照（只读、不改）：`markdown/__tests__/clipboard-serializer.spec.ts`
- 依赖层取证（只读）：`node_modules/@tiptap/core/dist/index.js`（`fromString` 约 1437-1473、`injectExtensionAttributesToParseRule`）、`node_modules/prosemirror-model/dist/index.js`（`matchTag` 约 2600、`schemaRules` 约 2642-2672、`addElement` 约 2842、`Fragment.textBetween` 约 117-134、node `isLeaf` 约 2125/2439）

## 现状

- **P1-1**：抛点 `zwnj.ts:33`（`text.includes` 对非字符串抛）。通用根因：`@tiptap/core/dist/index.js:1460`「属性无 `parseHTML` 才走 `fromString`」+ `:1439` 纯数字串 `Number()` ⇒ 任何 `attr="5"` 往返后变 `5`。脚注取值点 `plugins/footnote.ts:43`（`node.attrs.label || ''`）与 `:57`（`stripZwnj(node.attrs.label as string)`）；`extensions/footnote.ts` 的 `label` 仅 `{ default: '' }`（FootnoteRef `:12-15`、FootnoteDef `:55-58`）无 parseHTML ⇒ 中招。**同形属性通道**：`serializer.ts:727/728/730/742`（image alt/title/src）与 `markDelimiter` 的 link href/title 也调 `stripZwnj(node.attrs...)`，数字往返即炸（与 `zwnj.ts:16-17` 自陈的属性通道清单一致）。四处裸调 `serializeMarkdown`：`useEditorSync.ts:120`（防抖脏检查，无 try/catch）、`:199 flushPendingSerialize`（无 try/catch，`:194` 注释「必须在 `editor.destroy()` 之前调用」⇒ 抛则跳过销毁=禁令 7 泄漏）、`useDocumentSession.ts:143 evaluateDirtyFromEditor`、`MarkdownEditor.vue:910 getContent`。关窗链调用方是否有 catch 由 B 复核 `useAppWindowSession.ts`；markdown 解析路 label 取字符串（`plugins/footnote.ts:14/:27` `token.meta.label`），A 探针复证「仅 HTML 往返变数字」。
- **P1-2**：`extensions/footnote.ts:19` `{tag:'sup[data-footnote-ref]'}` vs `sub-sup.ts:19` `{tag:'sup'}`。`schemaRules`（prosemirror-model `:2653-2670`）先 marks 后 nodes、默认 priority 50；带 tag 的 mark 规则进**同一个按 priority 排序的一维 `this.tags`**（`:2557-2559`），`matchTag`（`:2600`）首个命中即 return ⇒ `sup` 恒先命中。`addElement`（`:2842`）一元素只消费一条 rule；footnoteRef 无 `content` ⇒ `isLeaf`（`:2125`）⇒ 修好后只出 atom、不塞子节点/多余 mark。
- **P1-3**：`serializer.ts:1055-1058` `isTableInternal` 含 `'table'`；`:1033` 单子守卫对 table 恒失效、`:1044` 多子 `peel` 无条件剥 table。但 `:750` `nodeSerializers.table` 是完整序列化器（仅 `:808-810` row/header/cell 空 handler）⇒ 函数头注释 `:1016-1017`、`:1022-1024`、`:1041-1043` 与序列化器文档注释 `:1061`（"边界容器只到 textblock 为止"）四处均误把 table 当不可独立序列化。入口 `editor-commands.ts:152-160`（NodeSelection/AllSelection 得闭合 slice）。`Fragment.textBetween`（`:117-134`）⇒ P1-3 修复前后 text/plain 逐字不变（分隔符来自格内 paragraph）。
- **P2-1**：`serializer.ts:1087-1105` 白名单含 table/row/header/cell ⇒ `:1139 textBetween('\n\n')`；对照 `MarkdownEditor.vue:692-695` TSV。
- **P2-2**：`MarkdownEditor.vue:688 cell.textContent`，动机注释 `:660-668`。

## 改法

> 按 P1 排序，可独立提交。动 parser/serializer/schema ⇒ 验收见 §4 全量保真体检 + 死链扫描。敏感区：P1-1 #23/#16、P1-2 #15/#16、P1-3 #15——改前先读对应行。

- **P1-1（脚注强转崩溃 + 通用属性通道类，敏感区 #23/#16）**——三层，前两层都做、第三层为通用兜底：
  1. 总兜底（一处收口整个类，对齐 `zwnj.ts:16-17` 清单，避免在 11 个属性点各加守卫=禁令 11 的减法门控）：`zwnj.ts:32` `stripZwnj` 开头加非字符串短路 `if (typeof text !== 'string') return text == null ? '' : String(text);`。热路径只多一次 `typeof`，非字符串才走 `String()`。这同时护住 image/link 等同形属性通道。
  2. 治本（脚注语义锁回字符串）：`extensions/footnote.ts` 给 `FootnoteRef.label` 与 `FootnoteDef.label` 加 `parseHTML: (el) => el.getAttribute('label') ?? ''`（绕开 `fromString`）。
  3. 口径统一：`plugins/footnote.ts:43/:57` 与 `extensions/footnote.ts:23` renderHTML 的取值统一为 `?? ''`；显式声明 `label === 0` 由旧 `|| ''`（洗成空串）变为 `'0'`（更正确），回归锁钉死该期望。
  - 说明：第 1 层使四处裸调点都不再因脚注抛 ⇒ 连带解除脏检查罢工/销毁跳过/存盘失败/关窗异常；故本轮**不**再单独给 `useEditorSync`/`useDocumentSession`/按钮补 try/catch（根修后无此抛；按钮 `getContent` 在 try 外属既有健壮性瑕疵，留 P1-4 另案一并评估）。
  - 回归锁：① 脚注 HTML 往返（`DOMSerializer.serializeFragment`→`PMDOMParser.parse`→`serializeMarkdown`）不抛 + 两轮收敛；② **不经 HTML、直接构造 `label` 为数字的 footnoteDef/Ref → `serializeMarkdown` 不抛**（验第 1 层兜底独立生效）；③ 断言 label 为字符串、含 `label===0` 期望。
- **P1-2（脚注引用退化，敏感区 #15/#16）**——首选唯一：
  - `extensions/footnote.ts:19` footnoteRef 解析规则加 `priority: 100`（`schemaRules.insert` 按降序插到 superscript 之前 ⇒ `matchTag` 先命中 atom）。不改 renderHTML/CSS/superscript。注释标「>50 即够，勿盲目加大（别处也写 100 会退化成注册序竞争）」。
  - 备选（**仅当** `vue-tsc` 判 `priority` 类型不过、或实测 footnoteRef 仍丢时才用）：`sub-sup.ts:19` 改 `{ tag: 'sup:not([data-footnote-ref])' }`。
  - 依赖 P1-1。回归锁：脚注引用 HTML 往返后 `footnoteRef` 在、序列化还原 `[^1]`（非上标字面）。
- **P1-3（整表丢 GFM，敏感区 #15）**：
  - `serializer.ts:1055-1058` `isTableInternal` 去掉 `'table'`（只留 row/header/cell）；同步改口径注释 `:1016-1017`、`:1022-1024`、`:1041-1043`、`:1061` 四处。
  - 回归锁（三条一起）：① 闭合整表 `serializeClipboardSlice` → 含 `|` 合法 GFM；② **同一闭合整表 `serializeClipboardText` 输出逐字不变**（仍 `\n\n` 竖排，护住 #9 取舍与 P2-1 登记）；③ **多 child 闭合形态（段落+表+段落，走 `:1044` 剥循环）→ 表格还原为 GFM、非格内散字**。现有 `clipboard-serializer.spec.ts:111-130`（开口 1,1）应保持绿。
- **P2-1（text/plain 表格 TSV）**——**默认不并入**，登记。要做则 `serializeClipboardText` 非回落分支对 table 特判 TSV（格内 `\t`、行间 `\n`，对齐 onEditorCopy）。
- **P2-2**：**不改**。

## 不改什么

- **P1-4（复制全文按钮 text/html 四种失真）本轮不改、单列另案**（详见末尾）。理由：① 字符串级预处理（`sanitizeForExternal`）改写 `[[`/`[!`/`$` 会误伤 ``` 代码块与 `` ` `` 行内码——比现状更伤内容；② KaTeX 无逐公式回落，一条坏 latex 让整篇复制失败（违退化安全）；③ callout/wikilink 判据复用来源未导出（`plugins/callout.ts`/`plugins/wikilink.ts`）、且吃 Token，字符串预处理与 token 级判据互斥。**需 简乐先定方向**（A 编辑器自身 `DOMSerializer` 统一两路 / B markdown-it 规则化 + fence-aware 预处理 + 逐式回落），再出 P1-4 子方案。
- **mermaid 出站**随 P1-4 一并另案（现状保留 `<pre><code>` 源码块，非本轮改动项，勿挂为待修缺陷）。
- **文件落盘序列化（`serializeMarkdown` 文件模式）零改动**——保真红线；P1-3 只动 `stripOpenLayers`/`isTableInternal`。
- **两套转义（clipboard 轻量 vs 文件严格）不合并**；`createChild` 继承 clipboard 模式正确。
- **CellSelection 双槽压平（#9）不改**（含 P2-2）。
- **已实测对称的 solo→solo 往返不动**：frontmatter、图片 width/height/title、callout(type/title/fold)、wikilink(target/alias)、数学 latex、mermaid、表格。

## 验收

1. **程序化探针**（临时 spec，跑完删；真实 schema；输入用**文件模式 `serializeMarkdown` 产物**或真实 DOMSerializer 输出，勿手工拼 HTML）：① 脚注 HTML 往返 → 不抛、`footnoteRef` 在、label 为字符串（含 `label===0`）、两轮收敛；② 直造数字 label 的 footnoteDef/Ref → `serializeMarkdown` 不抛（验 `stripZwnj` 兜底）；③ 整表闭合 → `serializeClipboardSlice` 含 `|`、`serializeClipboardText` 逐字不变、多 child 形态走 `:1044` 也还原 GFM。
2. **回归锁入库**：上述补进 `clipboard-serializer.spec.ts` 及脚注相关 spec；不退化「格内选字/引用块内选字/链接不回落/ZWNJ 不出站」。
3. **必跑命令**（AGENTS §4/§5）：`bun run test`（fixtures + roundtrip Phase E/F + schema-contract + mark-matrix + mark-delimiter-coverage）+ `vue-tsc --noEmit`（含 `priority` 透传的类型校验）+ `bun run build` + `SOLO_FIDELITY_SCAN=1 bunx vitest run …/fidelity-scan.spec.ts` + **死链扫描** `grep -rn "<改动文件名>" --include=*.md`（serializer/footnote/zwnj 被文档高频引用，改注释须同步台账）。
4. **真机 WebView2 冒烟**（粘贴=时序+异步，§4 真机是通行证）：① 脚注 solo→solo 复制粘贴；② 粘带脚注内容后立刻「打开另一文件」「关窗」，确认脏态/关窗/销毁不再因抛异常失效（P1-1 四处闸口）；③ 整表 Mod+Shift+M 粘记事本/Excel。
5. **未验证/范围外显式保留**：P1-4 全部、远程/data-uri 图片出站、大选区（1MB）同步序列化性能、`Ctrl+C` 路数学/mermaid。

## P1-4 另案（待 简乐拍板方向，不在本轮执行）

出站 HTML 失真是**双管道不统一**的老问题：`Ctrl+C`（PM `DOMSerializer`，callout/wikilink 已较干净、数学/mermaid 原始 source）与「复制全文」按钮（markdown-it，四种漏原始标记）产出不同。两个候选方向：
- **A：按钮改复用编辑器自身的 HTML 序列化（PM `DOMSerializer`）**——一次统一两路（根治 C2），callout/wikilink 不再漏原始标记、无代码块误伤风险；但数学/mermaid 仍是原始 source、且需验标准元素（表格/任务列表）不被换生产者搞坏、改 `sanitizeForExternal` 私有标签剥离逻辑。改动面较大、属重构。
- **B：保留 markdown-it，但 fence-aware 预处理 + 逐式 KaTeX 回落**——只补按钮路；须跳过代码区（复用解析侧 `protectCodeRegions` 等价能力，禁新抄正则）、每条公式 `try/catch` 回落原始 latex、`katex` 走现有 `Promise.all` 动态 import。判据复用来源（`plugins/callout.ts`/`plugins/wikilink.ts`）需先导出或指明唯一出处。

建议 A/B 择一后另立 `CP-…-002`，含各自真机粘 Word/公众号 的可读性验收。**本方案 CP-…-001 不含 P1-4 执行。**
