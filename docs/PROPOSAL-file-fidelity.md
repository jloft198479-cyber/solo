---
title: 方案：文件字节诚实（BOM/换行保留）+ 测试向量生成文档 + 保真承诺清单
type: proposal
audience: maintainer
status: draft
tags: [方案, 保真, BOM, CRLF, 编码, 测试向量, FEATURE-MATRIX, 承诺清单, OpenMarkdown调研]
summary: 整合 2026-11-22 双路调研（本方远程核查 + workbuddy 源码级 REVIEW）的可落地项。W1 修「编辑过的保存丢 BOM、归一换行」的真实缺陷；W2 用测试向量自动生成 FEATURE-MATRIX（治假锁+文档漂移）；W3 把保真承诺写成可核清单。C 档（换内核/逐字节/砍语法）明确不做。rev1（2026-11-22 评审）补编码维度、三个 layout 边界、另一条写盘路径，降级 F4 为待证，并纠正 §6-1 理由。待拍板项见 §6，修订留痕见 §7。
updates:
  [
    src-tauri/src/commands/document.rs,
    src-tauri/src/commands/mod.rs,
    src-tauri/src/lib.rs,
    ARCHITECTURE.md,
    src/stores/file.ts,
    src/services/tauri/command-names.ts,
    src/composables/useDocumentSession.ts,
    docs/FEATURE-MATRIX.md,
    docs/KNOWN-ISSUES.md,
    docs/INDEX.md,
  ]
---

# 方案：文件字节诚实 + 测试生成文档 + 保真承诺清单

> 来源：2026-11-22 对 [OpenMarkdown editor](https://github.com/OpenMarkdown-dev/OpenMarkdown-editor) 的双路调研——workbuddy 源码级对比 [outputs/REVIEW-2026-11-22-OpenMarkdown-对比调研.md](../outputs/REVIEW-2026-11-22-OpenMarkdown-对比调研.md)（下称「REVIEW」）+ 本方远程核查（含 solo 现状取证）。本文只写**可落地项**，调研结论不在此复制。
> 状态：**draft，待简乐拍板**（拍板项见 §6）。rev1 修订见 §7。

## 0. 一句话

三件事：**W1 让 solo 不再弄脏用户文件**（修真实缺陷）、**W2 让保真测试自动生成文档**（治假锁 + 文档漂移）、**W3 把「solo 对你的文件做了什么」写成用户看得懂的承诺清单**。全部不动内核。

## 1. 现状取证（已核实，2026-11-22；rev1 补 F1 编码维度、F6，F4 降级）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 读文件时剥掉 BOM 即丢弃，`DocumentOpenResult` 不带任何布局元数据。**剥的不止 UTF-8 BOM**：`read_text_file` 有三个分支——`.` `EF BB BF`（UTF-8）→ 按 UTF-8 解码；`FF FE`（UTF-16 LE）→ 按 UTF-16 解码；`FE FF`（UTF-16 BE）→ 按 UTF-16 解码 | `commands/document.rs` `read_text_file` |
| F2 | `save_document` 直接 `atomic_write(content.as_bytes())`，无 BOM 回写、无换行处理 | `document.rs` `save_document` |
| F3 | 全仓无 CRLF 保留 / 主导换行判定逻辑；ProseMirror 内部换行恒为 `\n` ⇒ 编辑过的保存必然归一为 LF | 全仓 grep 无果 + serializer 输出口径 |
| F4 | 「未编辑不写盘」**在刚打开时成立，但依赖一个未验证的前提**：`evaluateDirtyFromEditor()` 的快路径 `isSyncedWithStore()` 比的是**代际**（`editGeneration === syncedGeneration`），不是内容；且脏态比对 `syncEditedContent` 只归一**尾部换行**（`\n+$`），不归一 `\r`。⇒ 只要打开后有任何 doc 变更事务（PM 自动规范化、扩展 appendTransaction），代际追上即判脏 → 自动保存 → 全文重写。**必须先写钉子测试证实，不可按推断开工**（rev1） | `src/composables/useDocumentSession.ts` `evaluateDirtyFromEditor` / `src/composables/useEditorSync.ts` `isSyncedWithStore` / `src/stores/file.ts` `syncEditedContent` |
| F5 | 自动保存默认存在 ⇒ **用户只要真编辑过，下一次保存（自动或手动）就会全文重写**：BOM 永久丢失 + CRLF→LF。⚠️ 原稿把「风格统一」也列在此条，属串场——那是 serializer 的必然结果，**W1 治不了，也不该拿 W1 的预期去暗示能治**（rev1） | `useDocumentSession.ts` 自动保存递归 + F2/F3 |
| F6 | **另一条写盘路径**：重命名文档时批量改写其它文件里的 wikilink，走 `fs::read_to_string` + `atomic_write`。它**目前天然保住 CRLF**（全程不解码规范化、只换 wikilink 文本），但两个隐患：① `read_to_string` 是严格 UTF-8，带 BOM 的文件读出来首字符是 `U+FEFF` 留在正文里（是否影响 wikilink 正则待验）；② 将来谁把它「统一口径」成 `read_text_file` + layout 回写，这条路径立刻破。（rev1 新增） | `document.rs` `scan_and_rewrite_dir` |
| F7 | **「不改就不写盘」的唯一支点**：载入时 `MarkdownEditor.vue` 把基线设成**序列化产物**而非磁盘原文（`setContent(serializeMarkdown(doc))`），紧接 `markSynced()` 锚定代际。归因：存原文会让零编辑文档比对永不等，Windows 下 CRLF 必误提示保存。⇒ 换来「不写盘」，代价是**内存里永远没有原始换行**。（rev2 新增，阶段 0 实测） | `src/components/Editor/MarkdownEditor.vue` 载入 / 切文档两处；`useEditorSync` `markSynced` |

> **阶段 0 已证实 F4**（rev2）：LF 与 CRLF 文件「打开不动 → 保存」都不写盘，静置跨过自动保存也不写（自动保存的 if 条件是 `isDirty && path`）。F4 成立**完全依赖 F7 那两行契约**，W1 不得改动它们，并须加锁：载入后 `isSyncedWithStore() === true`。
> **归一发生在解析**（阶段 0 实测）：CRLF 进 `parseMarkdown` 出来就是 LF（markdown-it 做的）。⇒ 「保存时回写换行」这条路走不通，因为没有数据可用；`layout` 只能在**打开时**记录。方案 §2.1 方向被证实。

**用户视角的后果**（W1 的靶子）：记事本「UTF-8 带 BOM」另存的文件、Windows 记事本默认 CRLF 换行的文件，用 solo 编辑一次并保存——BOM 没了、换行全变。文件内容不丢，但外部工具链（依赖 BOM 识别编码的、按换行做 diff 的）会感知到「文件被 solo 动过了」。

**靶子的真实频率**（rev1 补，用于预期管理）：CRLF 是高频（Windows 记事本至今默认 CRLF，且 `OPEN_EXTENSIONS` 含 `.txt`，记事本存的 .txt 极常见）；UTF-8 BOM 中低频（记事本自 Win10 1903 起默认无 BOM，主要来自 PowerShell `Out-File`、VS 另存为）；UTF-16 低频但**存在**（记事本「Unicode」另存），且现状是被静默转成 UTF-8。⇒ W1 的价值主要在 CRLF 那一半，BOM 顺手做，UTF-16 必须显式表态（见 §2.1 与 §6-5）。

## 2. W1：文件字节诚实（BOM / 换行 / 编码保留）

### 2.1 设计

编辑器内部换行恒为 `\n`、不含 BOM（ProseMirror 固有，不动）。**布局信息（BOM、换行、原编码）由 Rust 端收口**，前端只透传元数据。

> rev1 关键修订：原稿的 `layout{bom: bool}` **表达不了编码维度**。`read_text_file` 会解码 UTF-16，若只按 bool 补 `EF BB BF`，一个 UTF-16 另存的 .md 会被静默写成「UTF-8 + BOM」——比现在的「UTF-8 无 BOM」更混乱（读者以为是同一个文件，字节已经换族）。故 layout 必须是三态编码枚举。

1. **打开侧**：`read_text_file` 处新增纯函数 `layout_of`，返回：

   ```
   DocumentLayout {
     encoding: Utf8 | Utf8Bom | Utf16,   // 三分：UTF-16 的 LE/BE 不必区分（都不回写，只标记「原非 UTF-8」）
     ending:   "\n" | "\r\n" | "\r",     // 主导 = 最频繁；平局取文件中先出现者；无换行 → "\n"
     mixed:    bool,                     // 两种及以上并存
   }
   ```

   `DocumentOpenResult` 增加 `layout` 字段。换行统计在**解码后**的 String 上做（UTF-16 文件也一样，解码后才有 `\n`）。

2. **前端**：`src/stores/file.ts` 打开时随 content 存下 layout；保存时透传。三处边界必须同时定死（rev1 新增，原稿漏）：
   - **新建文档** → `{ encoding: Utf8, ending: "\n", mixed: false }`。**保持现状写 LF，不跟平台切 CRLF**（改行为要单独拍板，不夹带在本次）。
   - **另存为 / 改名保存** → **继承当前文档的 layout**（另存为是同内容换路径，不该顺手改字节风格）。
   - **同路径重载（外部修改后重新打开）** → **刷新 layout**，以新读到的磁盘状态为准（外部工具把 LF 改成了 CRLF，solo 要跟着认）。

3. **保存侧**：`save_document` 增加可选参数 `layout: Option<DocumentLayout>`。写盘前按 `encoding` 决定 BOM，按 `ending` 展开行尾：

   | encoding | 落盘行为 |
   |---|---|
   | `Utf8` | UTF-8 无 BOM（= 现状） |
   | `Utf8Bom` | UTF-8 + `EF BB BF` |
   | `Utf16` | **UTF-8 无 BOM**（= 现状行为，明确登记为「有意归一」，不静默假装还给它 UTF-16） |

   `ending != "\n"` → 按行尾展开为主导换行；`mixed == true` 且本次编辑过 → 统一为主导换行（与 OpenMarkdown 同口径；未编辑走不到这里，前提是 F4 钉测通过）。

4. **不加新命令**：只改 `save_document` 签名与 `DocumentOpenResult` 结构。同步清单（硬禁令 1 四处）：`commands/document.rs` → `commands/mod.rs` → `lib.rs` 的 `generate_handler!`（命令名不变）→ `ARCHITECTURE.md` §4.2 命令表；`arch-drift.spec.ts` 若锁参数结构需同步。

5. **F6 那条路径（wikilink 批量改写）—— 不改，但要钉住**（rev1 新增）：它现状天然保 CRLF，属于「碰巧安全」。本次**不动它的实现**，但必须在测试里加一条：带 CRLF 的笔记 A 被改名、B 里含指向 A 的 wikilink ⇒ B 改写后换行仍是 CRLF。理由：防将来「统一口径」时无声破坏。顺带验一下带 BOM 的 B 读进来 `U+FEFF` 是否影响 wikilink 匹配，是则单独记 KNOWN-ISSUES。

### 2.2 测试与验收

- **实施第一步：写现状钉子测试**（rev1 强化，原稿已有此意，此处列明必须覆盖的 5 个场景）。因为 F1/F2 是读码结论，**F4 是推断**，不钉住就开工等于按猜测改：
  1. LF 文件 → 打开不动 → 保存 → 是否写盘、盘上字节有无变化；
  2. CRLF 文件 → 打开不动 → 保存 → 盘上换行、`isDirty` 的真实取值；
  3. CRLF 文件 → 打开后静置（跨过序列化防抖窗口）→ 是否被判脏、是否触发自动保存；
  4. 带 UTF-8 BOM 的文件 → 打开不动 → 保存 → 盘上 BOM；
  5. UTF-16 LE 文件 → 打开 → 保存 → 盘上编码变成什么。
  若 3 的结果是「会写盘」，则 W1 的范围要扩一条：先修脏态比对口径（`\r` 归一），再谈字节回写。
- Rust 单测 `layout_of`：三种 encoding、三种 ending、主导平局取先、mixed 判定、无换行。
- Rust 集成：编辑过 + `layout{Utf8Bom}` → 落盘以 `EF BB BF` 开头；CRLF 文件编辑过 → 落盘仍 CRLF；mixed 文件编辑过 → 统一为主导换行；UTF-16 文件编辑过 → 落盘为 UTF-8 无 BOM（**且 W3 承诺清单要说明这一条**）。
- 前端钉子：CRLF 语料打开不动 → 不写盘（依赖 F4 钉测结论）。
- 验收口径（用户操作得到什么）：
  1. 带 BOM 的文件 → 改一个字 → 保存 → 别的编辑器打开正常，BOM 还在；
  2. Windows 换行文件 → 改一个字 → 保存 → 还是 Windows 换行；
  3. 什么都不改 → 无论自动/手动保存多少次 → 盘上文件不变。
     **⚠️ 这一条 rev1 降级**：对 LF 文件是必然；对 **CRLF 文件依赖 §2.2 场景 2/3 的钉测结论**，钉不住就先修脏态，不把它写进验收。

### 2.3 范围外（明确不做）

- 不追「未编辑字节级原样退回」——语义短路已覆盖语义层，字节层留待真有诉求再说。
- **不回写 UTF-16**：UTF-16 的 .md 打开后保存即成 UTF-8，这是**有意归一**，写进 W3 承诺清单，不静默。
- 不做 per-line 混合换行精细保留——编辑过的 mixed 文件统一为主导换行（拍板项 §6-1）。
- 不改动 F6 那条 wikilink 批量改写路径的实现（只加测试钉住，见 §2.1-5）。

## 3. W2：测试向量 → FEATURE-MATRIX 自动生成（REVIEW A1）

### 3.1 设计

- **必须先答一个前置问题**（rev1 新增，原稿最大缺口）：仓库已有 `roundtrip.spec.ts` + `SOLO_FIDELITY_SCAN=1` 的全仓保真体检。新建 `vectors/` 就是**第二套语料**，重复造轮子风险高。而且两者回答的不是同一个问题：
  - `FEATURE-MATRIX` 答「这个语法**支持不支持**」——功能维度；
  - 保真体检答「读进来再写出去**对不对**」——保真维度。

  ⇒ 三个可选口径，开工前拍板（§6-6）：
  - **(a) 单源语料（推荐）**：向量表只做一件事——**生成支持度矩阵**；保真断言继续留在 roundtrip / fidelity-scan，但让它们**读同一批语料文件**，不各存一份。
  - (b) 向量表兼管两件事：支持度 + 保真一起断言。代价是向量条目要同时带「期望序列化输出」和「病灶标签」，条目变重。
  - (c) 完全独立两套。**不推荐**——必然漂移。
- 向量表（若选 a/b）：每条含 `{ 扩展, 输入 markdown, 期望序列化输出, 病灶标签 }`。**向量必须带病灶形状**（REVIEW 对治「假锁」的核心要求：否则向量本身是无效用例）。记忆里记着的判据同样适用：只断言 `输入 → 输出` 相等，只证「稳定」不证「内容对」——含高危标签（callout / footnote / wikilink / table / math）的向量**必须同时断言重开后的屏幕文本**。
- 生成：跑测试产出 `docs/FEATURE-MATRIX.md` 的表格段，文件头标注「由 vectors 自动生成，勿手改」；`docs-lint.spec.ts` 加一致性检查——提交的 FEATURE-MATRIX 与向量生成的结果不同步即红。
- 范围控制（§6-3）：第一批只覆盖 20 个扩展的主路径 + KNOWN-ISSUES 里 serializer 相关病灶；不追求一次全量。

### 3.2 验收

- 删掉 FEATURE-MATRIX 里一行表格 → `bun run test` 红，提示跑生成刷新；
- 每条已知病灶（如「格首 `-` 被加反斜杠」类）在向量表中有对应条目，行为变了（修好或回潮）向量即红；
- 撤掉一条修复 → 对应向量必须红（**反向校准**：不红说明那条向量不承重）。

## 4. W3：保真承诺清单（REVIEW A2 + 本方调研第 3 件）

- 落点：`docs/` 新建承诺清单（名字待定，如 `docs/FIDELITY-PROMISE.md`）；README 只放一句 + 链接；官网版本等发版再说。
- 内容两句 + 例外清单：
  1. 「在 solo 里打开、不编辑、关闭，文件不变」——**条件要写全**（rev1）：仅当 solo 是唯一写者、且未触发「外部修改冲突后强制覆盖」时成立。否则这句话有洞，用户拿它当依据会被打脸。
  2. 「编辑时只有你碰的部分在**语义**上变」——**必然改写清单**逐条列出（`_`→`*`、`+`→`-`、setext→ATX、表格重排对齐等），每条挂守它的测试名。⚠️「语义」二字不可省：solo 实际是**整篇重新序列化**，文本层整篇都被重写，只是大部分字节恰好一样。写成「只有你碰的部分变」会被理解为字节级局部改写。
  3. 补一条编码事实（rev1）：UTF-16 的 .md 打开后保存会变成 UTF-8；mixed 换行文件编辑后统一为主导换行。
- 素材：fidelity-scan 基线 + roundtrip 已知结果 + KNOWN-ISSUES；**排序在 W1/W2 之后**，避免承诺完就改口。
- 文档纪律：不硬编码计数（测试数、扩展数写「以实际为准」）。

## 5. 顺序与安全网

| 阶段 | 内容 | 性质 | 安全网 |
|---|---|---|---|
| 0 ✅ | **现状钉子测试**（§2.2 五个场景）——**已完成 2026-11-22**，结果见 [阶段 0 体检报告](../outputs/REVIEW-2026-11-22-阶段0-文件字节体检.md)：F4 成立、归一发生在解析、原 M-03 锁是弱锁（已补承重与反证两条）、新增 4 处钉子 | 只写测试，不改实现 | 已完成；**结论未推翻 F4，不需要先修脏态** |
| 1 ✅ | W1 文件字节诚实 ——**已完成 2026-11-22** | 小，Rust+前端两层 | 起步打了 `backup/2026-11-22-w1-prefile` 锚点；`cargo test --lib` 116 绿 / 前端 2204 绿 / `vue-tsc` 净 / eslint 0 error |
| 2 | W2 向量生成文档 | 测试侧，不碰内核 | **先拍板 §6-6 口径**；纯加法；docs-lint 一致性锁防漂移；阶段末通报 |
| 3 | W3 承诺清单 | 文档 | 依赖 1/2 的实际行为定稿；死链检查 |

## 6. 待拍板项

1. **mixed 换行文件编辑后**：统一为主导换行（推荐，OpenMarkdown 同口径）还是保持混合？
   - **推荐理由修订（rev1）**：原稿写「后者无法实现行尾归一」——**理由不成立**，per-line 记录技术上完全能实现。正确理由是：保留 mixed 的**收益为零**（用户几乎不可能刻意维护混合换行），**成本不为零**（多一套 per-line 元数据 + 每条编辑路径都要维护）。理由错会被后人当依据，故改。
2. **`\r`（老 Mac）主导**的文件：照转（推荐，纯函数统一处理）还是视为异常按 `\n` 处理？
3. **W2 第一批范围**：主路径 + 已知病灶（推荐）还是全量 20 扩展？
4. **W3 落点**：`docs/FIDELITY-PROMISE.md` 先行、README 只放链接（推荐），还是直接进 README？
5. **UTF-16 另存的 .md（rev1 新增）**：按 §2.1 归一到 UTF-8 无 BOM（推荐，简单且是修正而非破坏）还是真回写 UTF-16（要多编码器 + 多分支测试）？
6. **W2 与现有保真体系的口径（rev1 新增，见 §3.1）**：单源语料 (a，推荐) / 向量兼管 (b) / 两套独立 (c)？

## 7. 评审修订记录（rev1，2026-11-22）

> 留痕不删改：下列每条都是「原稿怎么写的 → 为什么改 → 改到哪」。被推翻的结论保留原样。

| # | 原稿 | 问题 | 处置 |
|---|---|---|---|
| R1 | `layout{bom: bool}` 二态 | `read_text_file` 解码 UTF-16，bool 表达不了；实现时必写成「有 BOM 就补 EF BB BF」⇒ UTF-16 文件被静默变 UTF-8+BOM | §2.1 改为三态 encoding 枚举；UTF-16 → UTF-8 无 BOM 明确登记为有意归一；新增拍板项 §6-5 |
| R2 | 只写「打开时随 content 存下 layout」 | 新建 / 另存为 / 重载三个边界的 layout 未定，会串味 | §2.1-2 三处边界定死 |
| R3 | 未提 wikilink 批量改写路径 | `scan_and_rewrite_dir` 也写盘（改别的文件），现状碰巧保 CRLF 但无人知道，将来「统一口径」会破 | §1 新增 F6；§2.1-5 加测试钉住；§2.3 明确不改实现 |
| R4 | 「未编辑不写盘已成立」（F4 断言） | `isSyncedWithStore` 比代际不比内容；`syncEditedContent` 只归一尾部换行不归一 `\r` ⇒ 打开后任何 doc 事务都会判脏→自动保存 | F4 降级为「待钉测」；§2.2 列 5 个钉子场景；验收第 3 条降级；§5 加阶段 0 |
| R5 | 「风格统一」混在 F5 里 | 那是 serializer 的必然，W1 治不了，混在一起会让读者以为 W1 能治 | F5 就地加注；范围不动 |
| R6 | §6-1 理由「无法实现行尾归一」 | 理由错（技术上可实现），错理由会被后人当依据 | 改为「收益为零、成本不为零」 |
| R7 | W2 直接新建 `vectors/`，未提现有 roundtrip / fidelity-scan | 第二套语料 ⇒ 重复造轮子 + 必然漂移；且支持度矩阵与保真断言是两个维度 | §3.1 加前置口径选择；新增拍板项 §6-6；向量必须同时断言重开后屏幕文本 |
| R8 | W3 承诺措辞 | 「打开不编辑关闭文件不变」缺适用条件；「只有你碰的部分变」易被读成字节级 | §4 补条件、强调「语义」、补编码事实一条 |
| R9 | F4 标「待钉测」；未记录基线机制 | 阶段 0 实测：F4 成立，但成立靠 `MarkdownEditor.vue` 那两行（基线=序列化产物 + markSynced），原方案完全没提 ⇒ 将来改这两行，W1 静默失效且无锁会红 | §1 新增 F7 + 阶段 0 结论注；F4 状态已在正文注明；§5 阶段 0 标完成；承重锁与反证锁已补（见体检报告 §五） |
| R10 | W1 实施（2026-11-22） | 与原设计的偏差与顺带收获，供复核 | ① `read_text_file` 改为 `read_text_with_layout` 并**删掉薄包装**（改完无调用点，留它就是死代码）② `save_document` 新增第 5 参 `layout: Option<DocumentLayout>`，**缺省 = 历史行为**，故 5 处旧测试只需补 `None`、主题导出与「互链跳转建新档」两个既有调用点零改动 ③ 三处 `setFile` 全部对齐：载入传 `document.layout`、另存为/改名保存**继承**、同路径重载**刷新** ④ `ARCHITECTURE.md` §4.2 命令表 + `docs/sensitive-areas.md` §11.2 已同步（含「别动基线那两行」的警告）|

**认可、不改的部分**：布局信息由 Rust 收口；不加新命令只改签名；W1→W2→W3 的排序；先写现状钉子测试再开工。
