---
title: 大文档（4–10MB）卡顿根因排查与优化方案
type: proposal
audience: dev
status: proposal
tags: [performance, editor, tiptap, large-document]
summary: 大文档打开/编辑/关闭卡死的全链路热点清单与分阶段优化方案（P0/P1 已实施，P2 已砍，P3 简化）
updates:
  [
    src/components/Editor/MarkdownEditor.vue,
    src/components/Editor/tiptap/markdown/parser.ts,
    src/components/Editor/tiptap/markdown/serializer.ts,
    src/components/Editor/tiptap/editor-metadata.ts,
    src/composables/useEditorSync.ts,
    src/composables/useDocumentSession.ts,
    src/stores/file.ts,
  ]
---

# 大文档卡顿：根因与方案

> 状态：**P0 / P1 已实施（2026-08-30），P2 已砍，P3 简化落地**。本文是执行蓝图 + 实施留痕，不是纯现状描述。
> 排查基线（2026-08-29）：4–10MB 文档打开后主线程长时间独占，UI 冻结，连关闭按钮都点不动。
>
> **实施对照表**（对照下文 §三 的阶段划分）
>
> | 阶段 | 状态       | 落地 commit / 文件                                                                                                 |
> | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
> | P0-1 | ✅ 已实施  | 关闭路径免序列化：`useEditorSync` 的 `editGeneration` / `syncedGeneration`（即本文的 docVersion 方案）+ `isSyncedWithStore()` 闸口 |
> | P0-2 | ✅ 已实施  | 关窗逃生舱：`state.rs` 的 `CloseGuard` + `window.rs` 的 `CLOSE_ACK_GRACE`（3s）+ `report_window_close` 命令           |
> | P0-3 | ✅ 已实施  | 打开阈值分层：`document-scale.ts`（50 万 / 200 万字符阈值，与本文表格一致）                                          |
> | P0-4 | ⚠️ 部分    | 仅落地 loading 指示条（`App.vue` + `.loading-bar`），**「打开过程可取消」未做**（parse 未切片、无取消按钮）            |
> | P1   | ✅ 已实施  | 编辑器热路径四项优化（paragraph-focus 只维护 2 条装饰 / code-block 按需高亮 / 大纲面板关闭时跳过提取 / 序列化缓存复用） |
> | P2   | ❌ 已砍    | 分块装载与虚拟滚动**不做**——与「不追超长文档」的定位冲突，超长文档应交由其他工具（见产品定位共识）                   |
> | P3   | 🔶 简化    | 不做只读渲染；改为 extreme 档「打开前用户确认才进可编辑模式」（`document-scale.ts` 的 `EXTREME_DOC_CHARS`）            |

---

## 一、一句话根因

**ProseMirror 是「全文档常驻 DOM」模型，而 solo 在 打开 / 每次击键 / 关闭 三个环节各埋了一处 O(n) 全量计算。**
文档从 4 万字符涨到 400 万字符，这些 O(n) 从 3ms 变成 3s，且全部跑在主线程同一个同步块里，浏览器连重绘的机会都没有。

已有的 `content-visibility: auto`（editor.css:113，P5-02）只省掉**屏外块的 layout/paint**，
**不省 DOM 创建、style 计算、插件装饰、全量遍历**——所以它能治滚动，治不了打开和关闭。

---

## 二、热点清单（已逐条核对代码，含行号）

### 打开阶段（一次性同步阻塞，不可中断）

| #   | 热点                                                              | 位置                                    | 复杂度                  |
| --- | ----------------------------------------------------------------- | --------------------------------------- | ----------------------- |
| H1  | ZWNJ 插入：两次全量正则，带 lookbehind + `\p{P}\p{S}` Unicode 属性 | `markdown/parser.ts:511-531`            | O(n)，4M 上估计秒级 ×2  |
| H2  | markdown-it 全量分词，产出海量 token 对象                         | `markdown/parser.ts:534`                | O(n) 对象分配           |
| H3  | 全量构建 PM doc + 一次性 replace 建出全部 DOM                     | `MarkdownEditor.vue:222-223`            | O(块数) DOM 创建        |
| H4  | paragraph-focus `init` **无条件**为每个顶层块建一条 Decoration     | `extensions/paragraph-focus.ts:95-97`   | O(块数) Decoration      |
| H5  | code-block `init` 全量高亮所有代码块；无语言走 `highlightAuto`（17 种语言逐个检测） | `extensions/code-block.ts:168-169,126-128` | O(代码总长 × 语言数) |
| H17 | 所有 NodeView（代码块/图片/frontmatter/callout/math/mermaid）无条件创建 | 各扩展 `addNodeView`                 | O(块数) DOM             |

### 编辑阶段（每次击键都付一遍）

| #   | 热点                                                       | 位置                                  | 复杂度        |
| --- | ---------------------------------------------------------- | ------------------------------------- | ------------- |
| H6  | 两个插件每次事务各做一次 `DecorationSet.map`（O(装饰数)）  | `paragraph-focus.ts:114`、`code-block.ts:173` | O(n)/击键 |
| H7  | 字数统计全量 `descendants` + 每个文本节点一次正则          | `editor-metadata.ts:15-25`            | O(n)，150ms 防抖 |
| H8  | 大纲全量 `descendants`                                     | `editor-metadata.ts:31-49`            | O(n)，500ms 防抖 |
| H9  | 全量序列化：`output +=` 累加 + 每个文本节点 5 次正则转义   | `serializer.ts:512`、`231-260`        | O(n)，500ms 防抖 |
| H11 | `syncEditedContent` 两次全量 `replace(/\n+$/)` + 全量比较  | `stores/file.ts:57-66`                | O(n)，每次序列化后 |
| H16 | 行号计算遍历光标前所有顶层兄弟块                           | `editor-metadata.ts:60-91`            | O(光标前块数) |

### 关闭 / 切文档阶段（「关不掉」的直接原因）

| #   | 热点                                                                        | 位置                                | 复杂度     |
| --- | --------------------------------------------------------------------------- | ----------------------------------- | ---------- |
| H10 | 关窗时 `evaluateDirtyFromEditor` **无条件**调 `getContent()` → 没编辑也全量序列化 | `useDocumentSession.ts:117-122`、`MarkdownEditor.vue:462-473` | O(n) |
| H12 | 切文档 watch：先 `serializeMarkdown` 比内容，再 `parseMarkdown` 重建          | `MarkdownEditor.vue:239-262`        | 2× O(n)    |
| H20 | 销毁编辑器时数万 DOM 节点同步移除                                            | `MarkdownEditor.vue:406-408`        | O(n)       |
| H19 | `MarkdownEditor` 用 `v-if` 挂载，看图返回时编辑器整个重建                     | `App.vue:310`                       | 全量重来   |

### 搜索（大文档上是放大器）

| #   | 热点                                                                | 位置                          | 复杂度            |
| --- | ------------------------------------------------------------------- | ----------------------------- | ----------------- |
| H13 | `findMatches` 全量遍历 + 每节点 `toLowerCase()` 复制；结果塞进 `ref` 触发深代理 | `useEditorSearch.ts:78-94,43` | O(n) + 10 万对象代理 |
| H14 | 为**每一个** match 建 Decoration                                     | `search-highlight.ts:68-76`   | O(match 数)       |
| H15 | 替换全部：逐条 `setTextSelection`+`delete`+`insert` 串在一个 chain   | `useEditorSearch.ts:171-184`  | O(n²)             |

---

## 三、优化方案（分阶段，按性价比排序）

### P0 · 保命线：先让「打得开、关得掉」不再失守

> 目标：即使慢，**不再冻结到无法操作**。预计 0.5–1 天。

1. **关闭路径免序列化**
   引入 `docVersion` 计数器（`onUpdate` 时 +1，序列化成功后把版本号记到 `serializedVersion`）。
   `evaluateDirtyFromEditor()` 先判 `!isDirty && docVersion === serializedVersion` → 直接返回 `false`，**一次 `getContent()` 都不调**。
   治 H10，也是「打开 4M 文档后直接关闭也卡死」的直接解药。

2. **关窗逃生舱**
   `handleCloseRequest` 起手就注册「强制关闭」通道：二次点击关闭 / 3 秒无响应 → 无条件 `destroyCurrentWindow()`。
   即使 JS 主线程被占死，也要给用户一条退路。

3. **打开阈值分层**（现在 `LARGE_DOC_THRESHOLD = 100_000` 字符太敏感，正常文档也弹窗，失去意义）

   | 规模             | 行为                                              |
   | ---------------- | ------------------------------------------------- |
   | < 50 万字符      | 全功能，静默                                      |
   | 50 万 – 200 万   | 全功能，自动关闭：自动语言检测、焦点模式装饰、实时字数 |
   | \> 200 万字符    | 默认进**只读预览模式**，需用户确认才进可编辑模式   |

4. **打开过程可取消**：把 parse + setContent 切成可 yield 的片段，配 loading 进度与取消按钮。

### P1 · 治「打字卡」：把每次击键的 O(n) 拆掉

> 目标：大文档下击键响应回到 16ms 内。预计 1–2 天。**收益/成本比最高的一段。**

1. **paragraph-focus 重构**（H4 + H6 的一半）
   - `init` 时非焦点模式直接返回 `DecorationSet.empty`，不再建 N 条装饰；
   - 焦点模式下也只维护 **2 条**装饰（当前 active + 上一个），而不是 N 条。

2. **code-block 高亮按需化**（H5 + H6 的另一半）
   - `init` 不全量高亮，改由 `IntersectionObserver` 在块进入视口时触发；
   - `highlightAuto` 加内容长度上限（建议 20KB），超限不高亮；
   - 无语言标注的代码块**默认不高亮**（现在会傻跑 17 种语言检测，这是隐藏的性能炸弹）。

3. **字数统计增量**（H7）
   维护 `baseCount`，事务里用 `tr.steps` 的 insertion/deletion 算 delta；
   仅 `setContent` / 大范围粘贴等无法增量判定时才全量重算。

4. **大纲增量**（H8）
   维护 heading 的 pos 有序索引，事务里用 `tr.mapping` 平移已有 pos，
   只对变更区间内的块重新判定是否新增/删除标题。

5. **行号 O(1)**（H16）：缓存顶层块数量的前缀和。

6. **`syncEditedContent` 快路径**（H11）：先比长度，再分段比对（头 4KB + 尾 4KB），避免两次全量 `replace`。

### P2 · 治「打开卡」：分块装载 + NodeView 懒创建

> 目标：4MB 文档 2 秒内可交互。预计 3–5 天。**必须在 P1 之后做**，否则 append 事务仍被插件拖住。

1. **分块装载（chunked hydration）**— 推荐主方案
   - 打开时只解析并装载首屏（约前 200 个顶层块），立刻可编辑；
   - 剩余内容在后台按 chunk（每批约 100 块）经 `requestIdleCallback` 追加到 doc 尾部；
   - 配套：进度指示、装载完成前大纲/搜索标注「仍在加载」。

2. **NodeView 懒创建**（H17）
   代码块 / 图片 / math / mermaid / callout / frontmatter 的 NodeView，
   不在视口内时只放一个带 `contain-intrinsic-size` 的占位 div，进入视口再实例化。

3. **切文档不再双重全量**（H12）：`watch(path)` 里去掉「先 serialize 当前 doc 再比较」这一步，
   改由调用方显式传 `forceReload` 标记；另存为等已知相同内容的场景直接跳过。

4. **视图切换不重建编辑器**（H19）：`App.vue` 的 `v-if` 改 `v-show` + 保留实例，看图返回不再重来一遍。

### P3 · 兜底：只读模式

> 目标：10MB 文档也永远不卡死。预计 0.5 天。

超过阈值时进只读模式：Rust 读文件 → 前端只渲染静态高亮文本（不建 PM doc），
顶部提示「文档过大，已按只读模式打开 · 仍要编辑」。
体验降级，但**永不失守**——这是最后一道防线。

### 明确不做

| 不做                       | 原因                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| 真正的虚拟滚动（只保留视口块） | 需要深度定制 PM 的 DOM 同步层，风险与维护成本远超收益，P2 的分块装载已能覆盖诉求 |
| 增量文件保存               | `atomic_write` 全量写 4MB 只要几十毫秒，根本不是瓶颈                  |
| 迁移到 Web Worker          | ProseMirror 强依赖 DOM，搬不动                                        |
| 搜索结果节流到 1000 条     | 应作为 H13/H14 的一部分顺带做，不单列                                 |

---

## 四、验收标准

| 指标                | 现状         | 目标                       |
| ------------------- | ------------ | -------------------------- |
| 4MB 文档打开到可编辑 | 冻结（>30s） | < 2s（P2 后）              |
| 击键响应            | 明显掉帧     | < 16ms（P1 后）            |
| 点击关闭到窗口消失  | 冻结（>30s） | < 1s（P0 后）              |
| 10MB 文档           | 完全不可用   | 只读模式，3s 内可见（P3 后）|

### 验证方法

1. **造样本**：生成 1MB / 4MB / 10MB 三档 markdown，混合标题、长段落、代码块（含无语言标注的）、表格、列表，贴近真实文档结构。
2. **埋点**：在 `parseMarkdown`、`replaceDocumentWithoutHistory`、各插件 `init`、`serializeMarkdown` 前后打 `performance.mark`，开发模式下输出到 console。
3. **逐阶段复测**：每完成一个 P，用同一样本复测三档，数据进 CHANGELOG。
