# 编辑区排版评估与优化方案

> 日期：2026-08-21 · 范围：编辑区内文本排版 + 「文字变浅」功能可行性
> 状态：排版微调**已执行**（2026-08-21）；「文字变浅」可行但成本为"中"，未实施，待排期

---

## 一、现状数据（取自代码，非推断）

来源：`src/components/Editor/tiptap/editor.css` 排版变量（`:root` 默认值，可被主题/设置覆盖）

| 元素 | 当前值 |
|---|---|
| 容器宽度 | `.mk-editor-inner` max-width **720px**（<720px 满宽） |
| 正文字号 | `--mk-font-size` **16px** |
| 行高 | `--mk-line-height` **1.7** |
| 字距 | `--mk-letter-spacing` **0** |
| 段距 | `--mk-paragraph-spacing` **1em**（无首行缩进，现代无缩进风格） |
| H1 | 1.5em / lh 1.35 / margin 2.4em 0 0.6em / ls **-0.02em** |
| H2 | 1.3em / lh 1.4 / margin 1.8em 0 0.5em / ls -0.01em |
| H3 | 1.2em / lh 1.45 / margin 1.2em 0 0.4em |
| H4–H6 | 1.05/1.0/0.9em，lh 1.5 |
| 标题间距比 | margin-top:bottom ≈ **4:1**（黄金节奏 ✓） |
| 引用块 | 2px 主色左边框、padding 0.75em 1em、**斜体**、`--text-secondary` 色、右侧 4px 圆角 |
| 链接 | 主色 + 40% 主色**伪下划线**（非默认下划线）、hover 加深、Ctrl+Click 跳转 |
| 列表 | ul 缩进 1.5em + disc，margin 0.4em |
| 焦点模式 | 未聚焦段淡化 `--mk-focus-dimmed-opacity 0.22`（**已有"临时变浅"机制**） |
| 标题 gutter | H1/H2 左侧 1.9rem 徽标槽（hover 显示 H1/H2） |
| CJK | line-break strict、antialiased、optimizeLegibility |

---

## 二、「文字变浅」功能可行性评估

### 2.1 结论：**高可行**，建议做

### 2.2 依据

1. **架构有先例**：solo 已有非标准 markdown 扩展的完整链路——高亮 `==text==`（markdown-it-mark → `<mark>`）、上/下标（markdown-it-sub/sup），含 parser/serializer/roundtrip。「变浅」是同类工作，走同一套架构即可，无新风险面。
2. **当前无颜色类 mark**：`compat-schema.ts` 只注册了 highlight/sub/sup 等，`editor-extensions.ts` 无 TextColor。需新增一枚 mark，不与现有冲突。
3. **视觉直接复用现有 token**：效果图 `p.dim` 用的就是 `--text-muted`（亮 #8c8375 / 暗 #847b6e），主题已自带，无需新配色。
4. **与焦点淡化语义互补**：焦点模式的 0.22 淡化是"临时的沉浸遮罩"；新功能是"用户主动标记的永久弱化"，两级不冲突。

### 2.3 方案要点（A 案推荐）

| 环节 | 方案 A（推荐） | 方案 B（备选） |
|---|---|---|
| Markdown 语法 | 内联 HTML `<span class="mk-dim">文字</span>` | 自定语法 `%%文字%%` |
| 解析 | markdown-it 原生能产出 html_inline，但 solo 的 parser 翻译层需补识别逻辑（见 2.5，**非零插件**） | 需自写 markdown-it 规则 + parser token 映射 |
| 序列化 | 需在 serializer 的 markDelimiter 补 Dim 输出规则（**非原样保真**） | 自写 serializer 规则 |
| 兼容性 | Obsidian 同款做法；其它编辑器打开显示 HTML 源码（可接受） | 其它编辑器完全不识别，更糟 |
| 工作量 | 中（Mark + CSS + UI ×2 + parser 识别 + serializer 规则 + roundtrip 测试） | 中大（语法设计 + 规则 + 测试） |

**选 A**：兼容性最好标准；但非"零插件零成本"（spike 实证，见 2.6）。

### 2.4 落地清单（若批准）

1. 新增 TipTap Mark `Dim`：`toDOM → ['span', { class: 'mk-dim' }, 0]`；parseDOM 认 `span.mk-dim`
2. CSS：`.tiptap-editor .mk-dim { color: var(--text-muted); }`（比 opacity 可控，亮暗主题自动适配）
3. UI 入口 ×2：BubbleMenu 加「变浅/恢复」切换按钮；命令面板（Ctrl+K）加 toggle 条目；可选快捷键
4. `parser.ts` 的 `html_inline` handler 需新增分支：识别 `<span class="mk-dim">` 包裹范围 → 生成真实 Dim mark 节点（当前该 handler 对非 checkbox/非 `<br>` 的内联 HTML 一律 `addText` 当纯文本，见 2.6）
5. `serializer.ts` 的 `markDelimiter` 增加 `case 'dim'`，输出 `<span class="mk-dim">` / `</span>`（当前 default 返回 `''` 会丢样式只留文本）
6. 复制为 HTML：TipTap 走 `toDOM`（`span.mk-dim`）+ DOMSerializer，随 mark 定义自动生效，无需单独文件
7. 测试：parser/serializer roundtrip 用例 + 嵌套 mark（如 `**变浅加粗**`）用例

### 2.5 风险

- 复制为 HTML 随 mark 的 `toDOM` 自动带样式（由第 6 点覆盖）
- 嵌套 mark 边界（如浅色+高亮同段）需 roundtrip 测试覆盖
- **parser/serializer 属编解码链改动**，按项目纪律必须跑全量 roundtrip + 类型检查 + 构建
- 无性能/无脏态影响（纯 mark，不碰 sync 逻辑）

### 2.6 spike 实证（2026-08-21）

用真实 `parseMarkdown` + `serializeMarkdown` 走完整链路，验证 `<span class="mk-dim">`（脚本 `scripts/spike-dim-html.ts`，验证后已删除）：

| 输入 | 解析产物 | 序列化输出 | roundtrip |
|---|---|---|---|
| `这是<span class="mk-dim">变浅</span>文字` | 单个 text，`<span>` 被当纯文本（`addText`） | `这是\<span class\="mk-dim"\>变浅\</span\>文字\n` | ❌ 样式丢失，且被转义加反斜杠 |
| 高亮 `这是==变浅==文字`（参照） | text + `[highlight]` mark + text | 同输入 + 尾部 `\n` | 归一化后真（样式由 mark 承载） |

**结论（修正 2.2/2.3 旧认知）**：
1. 「markdown-it 原生支持内联 HTML、零插件」**不成立于 solo**——markdown-it 只产出 html_inline token，真正决定 roundtrip 的是 solo 的 parser 翻译层，它当前把非 checkbox/非 `<br>` 的内联 HTML 全降为纯文本并随后被 serializer 转义。**方案 A 的能力断言必须推翻，工作量确认为「中」而非「小」。**
2. 高亮方案证明路径可行（mark 承载样式、normalize 后 roundtrip 真），方案 A 落地需补 2.4 的第 4、5 两步——**功能仍可行，但成本高于文档初版估算**。

---

## 三、排版规范性调研（对照行业最佳实践）

参照系：Butterick's Practical Typography / iA Writer / Medium / Notion / 中文排版规范 / Web typography 通则。

### 3.1 达标项（维持，不动）

| 项 | 现状 | 最佳实践 | 判定 |
|---|---|---|---|
| 行高 | 1.7 | 中文正文 1.6–1.8 | ✓ 达标 |
| 段距 | 1em，无首行缩进 | 现代无缩进风格（Medium/Notion 同） | ✓ 达标 |
| 标题间距比 | 上:下 ≈ 4:1 | 3–4:1 黄金节奏 | ✓ 达标 |
| 标题字距 | H1 -0.02em / H2 -0.01em | 大字号负字距 | ✓ 达标 |
| 链接 | 伪下划线 + 主色 | 现代做法（比默认下划线克制） | ✓ 达标 |
| 对齐 | 左对齐 | 中文 justify 有标点挤压风险，left 更安全 | ✓ 达标 |
| 正文字距 | 0 | 中文 0 或微正 | ✓ 达标 |
| CJK 渲染 | line-break strict + 抗锯齿 | 中文最佳实践 | ✓ 达标 |

### 3.2 建议优化项（按优先级）

**P1 · 引用块：去斜体 + 去右侧圆角**
- 现状：`font-style: italic` + `border-radius: 0 4px 4px 0`
- 问题：① 中文没有斜体，浏览器机械倾斜字形，中文引文阅读感差、观感"廉价"；② 右侧 4px 圆角与全 app 直角语言（顶栏/状态栏已定稿全直角）不一致
- 建议：引用去斜体（保留 `--text-secondary` 色 + 2px 主色左边框即可）；`border-radius: 0`；可选字号 0.95em 弱化层级

**P2 · 行长微收：720px → 680px**
- 现状：720px @16px ≈ 42 个中文字/行
- 最佳实践：中文舒适行长 30–40 字（英文 45–75 字符的对应换算）
- 建议：容器收到 680px（≈39 字/行），更接近"书卷气"的阅读节奏；代价是每行少约 2 字

**P2 · 标题层级再拉开：H1 1.5em → 1.6em**
- 现状：H1 24px vs 正文 16px（1.5×）
- 最佳实践：正文→H1 建议 1.6–2.0×，层级对比才明显
- 建议：H1 提到 1.6em（25.6px），H2 维持 1.3em——只动一级，克制且有效

**P3 · 正文字号 16px → 17px（可选）**
- 现状：16px 是中文桌面阅读下限
- 建议：可选提至 17px（iA Writer 同级），但这是全局字号，会影响所有排版变量的相对感——**如无明确不适不建议动**（16px + 1.7 行高已达标）

**P3 · 列表/引用/代码块的行距一致性**
- 现状：列表行高继承正文 1.7，但 margin 仅 0.4em（小于段距 1em）
- 建议：保持即可（列表紧凑是惯例）；不列为必改

### 3.3 明确不动项

- 正文 16px / 行高 1.7 / 段距 1em：全部在最佳实践区间
- 链接伪下划线、标题 4:1 间距、无缩进风格：均为现代标杆做法
- 焦点模式淡化机制：与「变浅」功能互补，保留

---

## 四、结论

1. **「文字变浅」：可行，推荐按 2.3 方案 A 实施**（HTML span + 自定义 Mark），但 **工作量确认为「中」**（spike 实证见 2.6：需补 parser 识别 + serializer 规则两层，非"零插件零成本"）。已拆独立任务，待排期。
2. **排版**：3 处建议改动（引用去斜体去圆角、行长收至 680px、H1 微增）**已在 2026-08-21 全部落地**，测试通过、纯 CSS 未碰编解码链。
3. （排版部分已执行；「文字变浅」待独立排期实施。）
