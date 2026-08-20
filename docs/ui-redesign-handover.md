# UI 改造交接文档（给 workbuddy）

> 目的：让接手方改 UI 时既能自由发挥设计，又不触断本轮重构建立的结构红线。
> 分支：`refactor/editor-decouple`。工作地主根：以本文件 + 代码为准，别看旧文档。

---

## 0. 一次性背景（先读这个）

本轮已对编辑器做了两处**只搬结构、不改行为**的安全重构，形成了稳定地基：

- `useEditorSync`（编辑器 → 字数/大纲/光标/序列化的同步中枢）
- `SearchPanel`（搜索面板从 MarkdownEditor 拆出为独立组件）

这两个 commit 是"能回滚的干净点"：

```
3b3edf8  基线
05499ce  useEditorSync 同步中枢
3c3ea17  搜索面板拆为独立组件  ← 当前地基
```

**如果 UI 改崩了，`git reset --hard 3c3ea17` 能退回这个稳定地基从头再来。放心大胆画，画崩了能退。**

---

## 1. 铁律（三条，违反必出 bug）

### 1.1 只许碰"纯展示壳"，别碰逻辑引擎

- **搜索面板**：只改 `src/components/Editor/views/SearchPanel.vue` 的模板 / 局部状态 / scoped 样式。
  - `useEditorSearch.ts`（搜索匹配/替换/高亮逻辑）**一行别动**。
  - 面板通过 props + 事件与父级通信，**别改成 direct import 编辑器**。
- **顶栏**：只改 `src/components/Layout/CustomTitlebar.vue` 的 scoped 样式。

### 1.2 全局样式冻结

颜色一律用现有 CSS 变量（`var(--bg-color)` 等），**不许新增全局变量 / 改 main.css**。
唯一例外：你确实需要一个新配色 token，先停下问，别自己加。

### 1.3 两个"看着像样式、其实是逻辑"的地方，乱删就废

- 搜索面板的 `v-show`（面板显隐命根子）、`@keydown.escape.stop`（Esc 关闭，贴在容器上，**别挪位置**）。
- 全局 `.search-match` 高亮样式在 MarkdownEditor 的**非 scoped** `<style>` 块里（搜索结果装饰，必须全局生效），别当成编辑器内部样式改掉。

---

## 2. 搜索面板单独嘱咐

- 面板和编辑器靠 7 个事件通信：`query / next / prev / replace / replaceAll / caseSensitive / close`，事件名别改。
- 全局 `.search-match` / `.search-match-active` 是 ProseMirror 装饰高亮，放编辑器 DOM 内，必须留在全局，不要 scoped 化。

---

## 3. 顶栏单独嘱咐（比搜索面板更微妙）

### 3.1 别碰窗口拖拽属性 —— 最容易被忽略的坑

- `.titlebar-title-area` 带 `data-tauri-drag-region`，是**整条可拖拽区**（窗口拖动靠它），别删、别改属性。
- `.titlebar-buttons` 是 `-webkit-app-region: no-drag`（按钮区不拖拽），保持。
- 改布局时顺手动了这些 → **窗口拖不动 / 拖拽误点按钮**。

### 3.2 别删自动隐藏的触发条

- `.titlebar-trigger`（顶部 12px 透明悬停条）是自动隐藏 / 焦点模式下唤出标题栏的入口，删了或挪层级，自动隐藏就废。

### 3.3 窗口控制按钮只改样式

- 最小化 / 最大化 / 关闭三个按钮是纯 `emit`，改 class 可以，改事件就破坏了窗口控制。

### 3.4 命名对齐参考稿

- `design-samples/solo-topbar-concept.html` 和 `design-samples/solo-topbar-redesign.html` 是你已经做好的顶栏设计概念稿，**以它们为视觉目标对齐**，别自创一套。

---

## 4. 审美硬约束（照抄，别发挥）

用户要的是：**少、快、轻、美**；书卷气、克制、不花哨。
- 暖白单色 + 碳黑点缀，极克制配色，圆角 ≤ 8px
- 文字选中背景**不要圆角**（像按钮，用户反感）
- letter-spacing 用 0 或负值，line-height 别超过 1.7
- 动效统一用 `--motion-fast` / `--motion-base` token，别新造时长
- 数字用 tabular-nums，加载/滚动用 perf 友好写法，不加多余 shadow

---

## 5. 性能红线（solo 刚做完性能优化）

不许动这些热区：字数 / 大纲 / 序列化的防抖、图片解析缓存、异步 IPC。
只许加**纯 CSS / Vite + scoped 渲染层**的东西，不许加防抖 / 缓存 / 全局 watcher。

---

## 6. 验证标准（三件套，全过才算完成）

```
bunx vue-tsc --noEmit
bun run test        # 31 文件 1029 用例
bun run build
```

- **Rust 零改动**，无需 cargo check。
- **本机跑不了 `tauri dev`，视觉效果你验证不了**——只能靠代码质量静态保证，**如实说，别声称已真机验证**。
- 顶栏是唯一"永远置顶"的浮层，改完需保证亮 / 暗主题都正常（只能静态推演）。

---

## 7. 完成清单

- [ ] 只动指定文件
- [ ] 全局样式未改 / 未加新变量
- [ ] 拖拽区 / 自动隐藏条 / 窗口控制逻辑完好
- [ ] 三件套全绿
- [ ] 如实报告视觉盲区，不夸大验证程度