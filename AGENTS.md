# AGENTS.md — CJK Markdown 经验沉淀

> 本文件记录 markdown-it 对 CJK 标点后 `**`/`*` 关闭失效的根因、方案决策和关键约束。
> 下次接手的 AI 或开发者必须优先阅读此文件，避免重复踩坑。

---

## 问题

CommonMark 的 delimiter flanking 规则以英文视角设计：

```
right_flanking = !isLastWhitespace && (!isLastPunctChar || isNextPunctChar || isLastWhitespace)
```

CJK 文本中，`，**继续` 场景：
- `isLastPunctChar = true`（`，` 是标点）
- `isNextPunctChar = false`（`继` 不是标点/空白）
- → `right_flanking = false` → `can_close = false` → `**` 无法关闭加粗

类似问题也出现在开启侧：`嘿**「` → `isLastPunctChar = false`（`嘿` 不是标点），`isNextPunctChar = true`（`「` 是标点）→ `left_flanking = false` → `can_open = false`。

## 方案选择

| 方案 | 思路 | 优缺点 |
|------|------|--------|
| **A. 预处理 ZWNJ（已采用）** | 在 `**` 前后插入零宽连字符 U+200C，改变 flanking 判断 | 外围打补丁，不动引擎；兼容性好；但略显 hacky |
| **B. 改 markdown-it scanDelims** | monkey-patch `State.prototype.scanDelims`，让 CJK 标点不阻塞 flanking | 更优雅；但依赖内部方法，升级有风险 |
| **C. `markdown-it-cjk-friendly` 插件** | 方案 B 的封装版，VitePress 2.x 已内置 | 现成可用；但 ESLM-only，与现有插件栈有集成风险 |

**选 A 的原因**：改动范围最小，不引入新依赖，能通过全部 829 个测试。

## 关键约束

1. **Roundtrip 稳定性**：parse → serialize → re-parse 结果必须一致
2. **CommonMark 兼容**：618 个标准用例不能受影响
3. **`**` 和 `*` 都要处理**（不包括 `_`）
4. **`***`（加粗+斜体混合）也要处理**，不能只匹配 `\*{1,2}`
5. **不能干扰 markdown 语法字符**：`~`（删除线）、`` ` ``（代码）、`=`（高亮）、`[` `]`（链接）等 ASCII 标点是语法字符，不能插入 ZWNJ

## 实现决策

### 预处理正则（parser.ts:438-462）

**关闭方向**（punct → `**` → word）：
```
(?<!\*)(?<=[\p{P}\p{S}])(\*+)(?=[^\s\p{P}\p{S}])
```
- `\*+` 而非 `\*{1,2}`：兼容 `***`（加粗+斜体混合）
- 排除 ASCII 标点 `[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]`：防误伤 `~` `` ` `` `=` `[` `]` `(` `)` 等 markdown 语法字符
- `(?<!\*)` 放首位而非末尾：JS 的 lookbehind 在末尾时检查的是匹配结束前位置，不是匹配开始前位置

**开启方向**（word → `**` → punct）：
```
(?<!\*)(?<=[^\s\p{P}\p{S}])(\*{1,2})(?=[\p{P}\p{S}])(?!\*)
```
- `(?!\*)` 防止匹配到关闭 `**` 的第一个 `*`（否则 `**hello**` 会被拆成 `*\u200C*`）
- 同样排除 ASCII 标点

### 顺序必须固定
先处理关闭方向，再处理开启方向。颠倒会导致互踩。

### 序列化器（serializer.ts）

- ZWNJ 只在解析阶段使用，序列化时从文本中剥离
- 删除原有的 `_delimiterBoundaryUnsafe` ZWNJ 插入逻辑（由预处理统一接管）

## 测试覆盖（829 个用例）

| 测试文件 | 用例数 | 覆盖场景 |
|----------|--------|----------|
| `commonmark.spec.ts` | 618 | CommonMark 标准合规 |
| `roundtrip.spec.ts` | 81 | parse→serialize→re-parse 闭环 |
| `fuzz.spec.ts` | 100 | 随机输入稳定性 |
| `fixtures.spec.ts` | 19 | 预设文件对比 |
| `_cjk-diag.spec.ts` | 8 | CJK 边界用例专项 |

## CJK 边界用例目录

以下是用例的完整集合，不依赖具体实现，任何引擎均可直接使用：

### 纯加粗
```
**「hello world」**                    → bold
**「网页转电脑软件的超级瘦身工具」**    → bold
**「hello」** world                    → bold
hello **「world」**                    → bold
嘿**「你好」**                        → bold
嘿，**「你好」**。                    → bold
嘿 **「你好」** 吗                    → bold
**「你好」**吗                        → bold
```

### 加粗 + 标点边界
```
**沉浸式体验，**继续                   → bold（逗号后关闭）
*沉浸式体验，*继续                     → italic（逗号后关闭）
***你好，***继续                       → bold+italic（逗号后关闭）
```

### 混合 mark + CJK
```
**粗体 *斜体* 混合，**                → bold with italic inside
**（沉浸式体验），**                   → bold（括号后关闭）
**他说“你好”**                         → bold（引号后关闭）
**第一段，****第二段。**               → 跨段落加粗
```

### Unicode 符号
```
*hello™*world                          → italic（™ 后关闭）
```

### ZWNJ 剥离验证
```
**沉浸式体验，\u200C**继续             → 输出不含 ZWNJ
*沉浸式体验，\u200C*继续               → 输出不含 ZWNJ
***你好，\u200C***继续                 → 输出不含 ZWNJ
```

### 不应受影响的场景（负例）
```
`code **not bold**`                    → code 内 ** 不做加粗
~~**hello**~~                          → strike(bold)，不做 ZWNJ 插入
==**bold highlight**==                 → highlight(bold)
[**bold link**](https://example.com)   → bold inside link
**hello world.**                       → 句号末尾，无后续文本
**hello, world,**                      → 逗号末尾
**hello!**                             → 感叹号末尾
**hello?**                             → 问号末尾
```

---

## 关联文件

- `src/components/Editor/tiptap/markdown/parser.ts` — ZWNJ 预处理（关键入口）
- `src/components/Editor/tiptap/markdown/serializer.ts` — ZWNJ 剥离（出口）
- `src/components/Editor/tiptap/editor.css` — `ime-mode: active`（IME 助手）
- `src/components/Editor/tiptap/markdown/__tests__/_cjk-diag.spec.ts` — CJK 诊断测试
- `src/components/Editor/tiptap/markdown/__tests__/roundtrip.spec.ts` — 闭环测试

---

## 会话日志

### 2026-06-29 会话 #1 — CJK 标点修复 + IME 优化

**目标**：解决 markdown-it 因 CJK 标点边界导致 `**`/`*`/`***` 无法正确关闭或打开的问题。

**完成项**：
- [x] parser.ts preprocessor：插入 ZWNJ 处理关闭方向（punct→`**`→word）和开启方向（word→`**`→punct）
- [x] 排除 ASCII 标点（`~` `` ` `` `=` `[` `]` `(` `)` 等），只对非 ASCII `\p{P}\p{S}` 加 ZWNJ
- [x] `\*+` 兼容 `***`（加粗+斜体混合）
- [x] `(?<!\*)` 放首位而非末尾（JS lookbehind 位置陷阱）
- [x] serializer.ts：删除 `_delimiterBoundaryUnsafe` ZWNJ 插入逻辑，改由预处理统一接管
- [x] serializer.ts：`escapeInline` 中 strip ZWNJ，保证输出干净
- [x] `editor.css`：添加 `ime-mode: active` 缓解微软拼音浮动候选框
- [x] 更新 roundtrip 测试期望值（CJK 边界从转义恢复到正确解析）
- [x] 前端构建通过（`bun run build`）
- [ ] Tauri 打包未完成（缺 Rust 工具链）

**测试结果**：978 全过（27 个测试文件），markdown 相关 829 全过（6 个文件）
**经验沉淀**：本文件 + `parser.ts` 注释索引

**未完成任务**（留给下次）：
1. 在用户环境执行 `bun run build && bun run tauri build` 打包
2. 验证 `ime-mode: active` 对微软拼音浮动框的实际缓解效果；如效果不佳，考虑在 Tauri Rust 层加 WebView2 TSF 标志
