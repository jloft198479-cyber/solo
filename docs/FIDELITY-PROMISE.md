---
title: 保真承诺 —— solo 会 / 不会对你的文件做什么
type: core
audience: user
status: active
tags: [保真, 承诺, 文件, BOM, 换行, 用户可见]
summary: 用户可见的文件行为承诺：什么情况下一个字节不变、编辑后会变成什么样、哪些做不到。每条都挂着跑得起来的测试
updates: [README.md, README.zh-CN.md, docs/FEATURE-MATRIX.md, docs/PROPOSAL-file-fidelity.md]
---

# solo 对你的文件做了什么

> 这份文档只回答一个问题：**solo 会不会偷偷改我的文件？**
> 每条都挂着能跑的测试（见 §五）。发现承诺没兑现就是 bug，请按 §六 反馈。

## 一、打开、不看、关掉 —— 文件一个字节都不变

**成立的条件**（三个都要满足）：

1. 用 solo 打开这个文件；
2. 一个字都没改（打一个字再删掉也算没改——判的是内容，不是动作）；
3. 正常关闭或切走。

**不成立的情况**（这几条不是承诺的漏洞，是边界）：

- 另一个程序同时在改这个文件 → solo 会弹「文件已被外部修改」，你选「强制覆盖」＝你同意了用内存里的版本覆盖它；
- solo 崩溃 → 只留 `.tmp` 残留兜底，不保证；
- 你在**别的**编辑器里改的 → solo 只对「自己保存的那一刻写下的字节」负责。

> 这条为什么能做到：solo 打开文件时不会把「磁盘原文」当作比对基准，而是把「编辑器处理后的样子」当基准。所以哪怕文件用的是 Windows 换行，只要你不编辑，它就认为「什么都没变」，一次都不写盘。
> ⚠️ 维护者注意：这个机制在 [`MarkdownEditor.vue`](../src/components/Editor/MarkdownEditor.vue) 的载入 / 切文档两处（把基线设成 `serializeMarkdown(doc)` 并 `markSynced()`）。**改那两行 = 这条承诺失效**，见 [PROPOSAL-file-fidelity.md](./PROPOSAL-file-fidelity.md) §1 F7。

## 二、改了一个字再保存 —— 只有你碰的部分变

**会变的**：你改的那处。
**不会变的**：文件的编码习惯（有没有隐形标记 BOM、用哪种换行）—— 打开时记下来，保存时照着写回去。

但要诚实说清一件事：solo 保存时是**整篇重新生成**的，不是只改那几行。只是没被碰的部分会渲染回一模一样的文本，所以字节上看起来只有你改的地方变了。

## 三、这几种写法会被统一（不是 bug）

同一个意思有好几种写法，编辑器内存里只保留一种。所以存回来时会被统一成标准形式——**内容一个字不丢，只是写法变了**（表里 `⏎` 表示换行）。

<!-- rewrite-list:begin -->

| 你写的 | 存完变成 | 说明 |
| --- | --- | --- |
| `_斜体_` | `*斜体*` | 下划线写法统一为星号 |
| `<https://auto.link>` | `[https://auto.link](https://auto.link)` | 转为标准链接写法 |
| `[文本][ref]⏎⏎[ref]: https://example.com` | `[文本](https://example.com)` | 转为行内式，定义行不再保留 |
| `标题⏎===` | `# 标题` | setext 写法统一为 # 形式 |
| `+ 甲⏎+ 乙` | `- 甲⏎- 乙` | 列表符号统一为 - |
| `\| a \| b \|⏎\| --- \| --- \|⏎\| 1 \| 2 \|` | `\| a   \| b   \|⏎\| --- \| --- \|⏎\| 1   \| 2   \|` | 按列宽重新对齐（补空格） |
| `---⏎title: x⏎---⏎正文` | `---⏎title: x⏎---⏎⏎正文` | 结束符后补一个空行 |

<!-- rewrite-list:end -->

**这份清单由测试向量生成，不是手写的**（数据源：[`syntax-vectors.ts`](../src/components/Editor/tiptap/markdown/__tests__/vectors/syntax-vectors.ts)，每条都在跑测试，并同步生成 [FEATURE-MATRIX.md](./FEATURE-MATRIX.md) §4.5 的支持度表）。支持面扩大时它会自动跟着变。

另外两条同源行为：

- **混着用两种换行的文件**：编辑保存后会统一成**占多数**的那一种（不逐行保留——收益为零，成本不为零）；
- **表格对齐**：只有你改的那一格所在列会重新计算宽度。

## 四、明确做不到的（不假装）

| 做不到 | 实际会发生什么 |
|---|---|
| 保住 UTF-16 编码 | 记事本用「Unicode」另存的 .md，solo 能正常打开，但保存后会变成普通 UTF-8。**这是有意的归一**，不是丢失 |
| 逐行保留混合换行 | 统一成占多数的那一种（见 §三） |
| 保住非标准写法的原始形态 | 见 §三的清单。想在别家编辑器里保持一模一样，请用标准 Markdown 写法 |

## 五、这些承诺靠什么保证（可核）

| 承诺 | 测试 |
|---|---|
| §一 不编辑不写盘 | `src/composables/__tests__/useDocumentSession.spec.ts`（承重版 + 反证两条） |
| §二 换行 / BOM 还原 | `src-tauri/src/commands/document.rs` 的 `save_document_keeps_crlf_file_crlf` / `save_document_writes_bom_back` / `w1_end_to_end_frontend_json_roundtrip` |
| §三 统一清单 | `src/components/Editor/tiptap/markdown/__tests__/vectors/syntax-vectors.spec.ts` + `roundtrip.spec.ts` |
| §四 边界 | `read_text_file_*` 系列（UTF-16 解码 / BOM 剥除）+ `layout_of_counts_dominant_ending_and_mixed` |

自己跑：

```bash
npx vitest run src/components/Editor/tiptap/markdown/__tests__/vectors/
npx vitest run src/composables/__tests__/useDocumentSession.spec.ts
# Rust 侧需先激活 MSVC（见 BUILD_GUIDE.md）
# cargo test --lib
```

## 六、如果承诺没兑现

那说明有真 bug，不是文档过时。记进 [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) §二，并补一条能复现的测试——**不要让这份文档变成一张说了不算的纸**。

> 维护者：改任何影响「保存字节」的代码（parser / serializer / `save_document` / 打开时的基线），都要回来核对这份文档。文档与代码不一致时，**以测试为准**，然后改文档。
