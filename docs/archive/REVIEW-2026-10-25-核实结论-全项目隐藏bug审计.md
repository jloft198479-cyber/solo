---
title: 核实结论 — 对《全项目隐藏 bug 审计（2026-10-25）》的独立复核
type: review
audience: maintainer
status: active
tags: [审核, 复核, 数据安全, 表格, InputRule, round-trip]
summary: 2026-10-25 独立复核 zcode 的 5 分区审计。三项基线全部复现（lint 0 error/70 warning、vitest --mode full 96 files/2105 tests、cargo test --lib 106 passed）。P1/P2 九条中 8 条经真跑或源码链坐实；1 条（P2-3 多窗口设置覆盖）仅源码合理未实测。发现 2 处描述偏差（P1-3 实际是抛 RangeError 而非静默消失；「段首打正常」归因错，实际只有整段即匹配内容才正常），2 处实测比原报告更严重（P2-1 中文形态整段被吞成公式；P2-5 重开后 `[` 被转义成字面、二次不可逆）。未发现误报（false positive）。结论：报告可作为修复依据。
updates: [docs/archive/REVIEW-2026-10-25-全项目隐藏bug审计.md]
---

# 核实结论：全项目隐藏 bug 审计（2026-10-25）

> 被核对象：[REVIEW-2026-10-25-全项目隐藏bug审计.md](./REVIEW-2026-10-25-全项目隐藏bug审计.md)
> 复核方式：**不看结论看行为** —— 写临时 vitest 用例真跑 round-trip 与 InputRule 全链路、读安装版依赖源码、独立复跑三项基线。临时用例跑完即删，未改任何被审代码。

---

## 1. 基线：三项全部复现

| 检查 | 报告值 | 本次实测 | 判定 |
|---|---|---|---|
| `eslint src/` | 0 error / 70 warning | 0 error / 70 warning | ✅ 一致 |
| `vitest run --mode full` | 96 files / 2105 tests | 96 files / 2105 tests，20.58s | ✅ 一致 |
| `cargo test --lib` | 106 passed | 106 passed，0.08s | ✅ 一致 |

基线可信度无问题。报告结论「新发现全在 2105 条测试之外」也成立——本次 8 条实测用例全部是新写的，没有一条被现有测试覆盖。

---

## 2. P1 逐条核实（4/4 命中）

### P1-1 表格属性通道 `|` 裸写 —— ✅ 真，且损坏是**永久化**的

实测（`roundTrip`）：

```text
输入：| a | b |\n| --- | --- |\n| $p\|q$ 的值 | x |
首存：| a          | b   |\n| --- | --- |\n| $p|q$ 的值 | x   |     ← 裸 |
重开：| a   | b       |\n| --- | ------- |\n| $p  | q$ 的值 |           ← 切列，公式被劈成两列
```

互链同型：`[[甲\|乙]]` → `[[甲|乙]]`。

补充确认报告没写的一条：**不是「首存变字面文本」那么轻**——首存后文件已经变成非法表格，第二次打开时列结构就变了（`$p` 与 `q$ 的值` 落在不同单元格）。原内容再也拼不回来。

机理核对：读侧零问题（markdown-it `escapedSplit` 会把 `\|` 还原成 `|` 交给行内解析），**纯写出侧漏转义**，与报告判断一致。

### P1-2 `[![alt](img)](url)` 外链静默消失 —— ✅ 真

```text
输入：[![alt](i.png)](https://x.com)      输出：![alt](i.png)
输入：**![alt](i.png)**                    输出：![alt](i.png)
```

doc 结构实测：`paragraph > image`，**没有任何 mark**。与报告机理一致（`addNode` 未传第三参 marks，而 `closeNode` 传了）。

### P1-3 sub-sup InputRule 位置数学 —— ✅ 真，但**表现与报告不同**

报告写的是「内容静默消失、相邻字符被吃」并标 ⚠️待实测。实测结果不是静默：

```text
RangeError: Position 6 out of range
  at InputRule.handler (sub-sup.ts:110  tr.delete(innerEnd, closingEnd))
```

三处全炸：段首 `x^2^`、段中 `abc x^2^`、段中 `H~2~O`。

**这对用户意味着什么**（比"静默"更明确）：ProseMirror 的 `handleTextInput` 不 catch 异常（`prosemirror-view/dist/index.js:3241`），handler 抛错 ⇒ `view.dispatch(deflt())` 不执行 ⇒ **闭合符那个字符根本没进文档**，控制台留一条报错。结果就是：`^`/`~` 上下标**在段落中间彻底做不出来**（不是做出来但内容错了）。

**报告的一处归因错误**：报告说「段首打（index=0）才恰好正常」。实测不成立——`x^2^` 写在段首，`match.index` 是 1 而不是 0，照样抛 `RangeError`。真正正常的只有**整段内容恰好就是 `^2^`**（`rawStart === 0`）。所以「日常没踩爆」的真实原因不是"大家从段首打"，而是**这个语法本来就几乎没人用**。修的时候别拿"段首要能用"当验收标准。

### P1-4 改名只换路径触发旧基线回灌 —— ✅ 源码链闭合（未跑双窗真机）

链路逐跳核对，全部为真：

1. `file.ts:100-107` `renamePath` 只改 `path`/`displayName`/`originalBaseName`，**不碰 content**；
2. `useDocumentSession.ts:545` 跨窗改名跟随直接调它（只挡 `isSaving`/`isOpeningFile`，**无脏态判定**）；
3. `MarkdownEditor.vue:562-581` watch 里 `crossFileSwitch = true` 且 `cachedSerialize.doc !== currentDoc`（编辑还在 500ms/idle 窗口内）⇒ `currentMarkdown = null` ⇒ 跳过比对；
4. 接着 `cancelPending()` 作废挂起序列化 + `replaceDocumentWithoutHistory(fileStore.currentFile.content)` 灌回旧基线。

`useEditorSync.ts:121` 的空闲回调才是唯一同时更新 `cachedSerialize` 与 store 的地方——报告说「未序列化窗口内的编辑是唯一副本」，准确。

第二条路径（本窗改名保存失败 → `useDocumentSession.ts:399-403` catch 里 `renamePath`）同样成立：此时缓存新鲜、store 旧，比对必不等 ⇒ 回灌把 catch 注释承诺的「编辑保留」推翻。

唯一未做的是双窗真机复现——链路无断点，判为可信。

---

## 3. P2 抽查（4 真 / 1 未测）

| 条目 | 复核结论 |
|---|---|
| **P2-1** `computePairEscape` 只数文本 | ✅ 真，**且比报告举例更狠**（见下） |
| **P2-2** 跨型列表切换被劫持 | ✅ 真。`editor-commands.ts:56` / `:121` 都传 `'listItem'`，而有序/无序的项同为 `listItem` ⇒ 在 `1. 甲` 里点「无序列表」走 `demoteListItemToBlock` 托孤成正文 |
| **P2-3** 设置多窗口 last-writer-wins | ⚠️ 未实测。源码形态与描述相符（整快照写回、无写前重读），判为可信但未坐实 |
| **P2-4** `toPx` 解析 `clamp()` | ✅ 真。`external-styles.ts:92-97`：`endsWith('em')` 判据对 `clamp(1.5em, 2vw, 2.2em)` 失效 ⇒ `parseFloat` 得 1.5 ⇒ `1.5px`；`120%` ⇒ `120px`。前提（`injectTypography` 原样写 CSS 变量、设置 UI 只管 fontSize/lineHeight）也已核 |
| **P2-5** 入站 `<img>` 无协议白名单 | ✅ 真，**且二次不可逆**（见下） |

### P2-1 实测：中文形态比报告例子严重得多

报告举例 `a\$b$x$`，实测确认 doc 语义确实搬家：

```text
原始：text("a$b") + mathInline(latex="x")
重开：text("a") + mathInline(latex="b") + text("x$")
```

但真正会撞上的中文形态更糟：

```text
输入：价格\$5 对比 $x$ 公式
首存：价格$5 对比 $x$ 公式        ← \ 丢了
重开：text("价格") + mathInline(latex="5 对比 $x") + text(" 公式")
```

**整个「$5 对比 $x」被吞成一个公式**，不只是丢一个字符。这条该按 P1 的紧迫度对待。

报告说的镜像问题（计数又把行内 code 内容算进去）用 `\`a^b\` x^2^ y` 没复现，条件可能更窄，未坐实。

### P2-5 实测：退化成字面文本之后还会再坏一层

```text
输入：![](file:///D:/photos/cat.png)
输出：!\[\](file:///D:/photos/cat.png)
```

`file:` 被 markdown-it `validateLink` 拒绝 ⇒ 整串当文本；而 serializer 又把 `[` 转义成 `\[` ⇒ **第二次打开连"能手动改回去的原文"都没了**。报告说「图片退化成字面文本」，实际是「退化成被转义过的字面文本」。

---

## 4. 报告没漏同族

`range.from + match.index` 全仓只有 `sub-sup.ts:63` 与 `:101` 两处。其余自研 InputRule（`markdown-input.ts:103,116`、`wikilink.ts:114`、`list-input-guard.ts:53,58`）都用 `range.from`/`range.to` 正确。**P1-3 的范围是完整的**，修这两处即可，不必扫全场。

---

## 5. 复核结论

**没有误报（false positive）。** 9 条 P1/P2 中 8 条经真跑或源码链坐实，1 条（P2-3）源码合理未实测。4 条 P1 全部成立。

**4 处需要修正报告的地方**：

| # | 条目 | 修正 |
|---|---|---|
| 1 | P1-3 表现 | 不是「静默消失/相邻字符被吃」，是 **抛 RangeError、闭合符进不了文档、功能不可用**。性质从「静默数据错」变成「显式不可用」 |
| 2 | P1-3 归因 | 「段首打正常」错。只有整段内容 == `^2^` 才正常；段首写 `x^2^` 一样炸 |
| 3 | P2-1 严重度 | 中文形态会把整段吞进公式（`$5 对比 $x` 全变成 latex），建议升 P1 |
| 4 | P2-5 后果 | 退化后 `[` 被转义 ⇒ 二次打开不可逆，不是「退化成字面文本」那么轻 |

**未覆盖**：P3 全组（28 条）、P2-3、Rust 分区全部条目、运行时双窗/真机手感。报告自己也标了未覆盖运行时实测，口径一致。

---

## 5.5 补充：P2-2 的影响面被低估（简乐真机反馈，2026-10-25 追加）

简乐实测报：「选中 A/B/C 三项列表，点列表按钮，只有 A 取消格式，B/C 不动」。

复核结论：**真 bug，与 P2-2 同一处代码、同一根因**——`exitList()` 接管条件过宽，把本该交给 ProseMirror `toggleList` 的场景也劫持了。

实测对比（临时用例，`- A / - B / - C`，选区覆盖三项）：

| 场景 | 生产路径 `exitList` 劫持 | 原生 `toggleBulletList()` |
|---|---|---|
| 多选三项 → 点无序 | `A\n\n- B\n- C`（**只退 A**） | `A\n\nB\n\nC`（**整块退出** ✅） |
| 跨型多选：有序三项 → 点无序 | `A\n\n1. B\n2. C`（**只退 A**） | `- A\n- B\n- C`（**原地换标记** ✅） |
| 跨型单选：有序光标在 B → 点无序 | `1. A\n\nB\n\n1. C`（B 脱出成正文 ❌） | — |
| 光标在 B 单选 → 点无序 | `- A\n\nB\n\n- C`（✅ 正常） | — |
| 选 A 的文字（非空、单项） | `A\n\n- B\n- C`（✅ 正常） | — |
| #50：光标在项内、项含子列表 | `A\n\n- A1\n- B` | `A\n\n- A1\n\n- B`（差别只是多一空行 ⇒ 松散列表，非畸形） |

**结论修正**：P2-2 不该是 P2。它不是边缘场景——「选中几行列表项想一起取消」是最普通的操作，而且两种表现（多选只退第一项、跨型切换脱出成正文）用户都会立刻看到。建议升 **P1**。

**根因定位**（`editor-commands.ts:15-16`）：`exitList` 只判「光标所在项是不是 listItem」，于是：
- 有选区（跨多项）也照劫持 → 只处理 `selection.from` 那一项；
- 目标类型与当前容器类型不同也照劫持 → 本该原地换标记，被降级成托孤。

**修法（两个收窄判据，改一处即可同时修两条）**：
1. 选区跨了多个列表项（`innermostItemAt(from) !== innermostItemAt(to)`）⇒ 不接管，交原生 `toggleList`（实测整块退出/整块换标记都正确）；
2. 当前容器类型 ≠ 目标类型 ⇒ 不接管，交原生原地换标记。

单该项内（光标或选中项内文字）仍保留托孤路径——那是 #50 的正确修复，且实测无误。

**验证口径**：修完必须覆盖上表 6 行；反向校准 = 去掉收窄判据后「多选整块退出」「跨型换标记」两条必须转红。

---

## 6. 处置建议（按「用户能不能感知到数据坏」排序）

1. **P1-1**（表格内公式/互链）—— 写文件即坏且不可逆，优先级最高。5 个写出点加 `isInTableCell` 转义，读侧零改动。
2. **P2-1**（升级为 P1）—— 中文写作里 `\$` 是常见输入（价格、金额），一旦有个行内公式同段就被吞。与 P1-1 同属「序列化转义」族，建议**同批修**。
3. **P1-2**（图链）—— 修法最小（`addNode` 行内分支传 marks）。
4. **P1-3**（sub-sup）—— 两处对齐上游数学，顺带补 InputRule 回归锁（当前零测试）。
5. **P1-4**（改名回灌）—— 涉及会话状态机，单独一轮，和 #38 家族一起收。
6. P2-2 / P2-4 / P2-5 随后。
