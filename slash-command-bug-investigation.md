# `/` 斜杠命令失效 — 排查报告

> **文档目的**：供其他智能体接手调试时阅读，包含完整的前因后果、排查过程和后续建议。
>
> **排查日期**：2026-06-25
>
> **当前状态**：`/` 斜杠命令已恢复可用（临时措施），但根因尚未完全修复。

---

## 一、问题背景

### 1.1 项目概况

- **项目名**：solo（Tauri productName），**非 MarkLight**（package.json name="marklight" 为历史遗留）
- **技术栈**：Tauri 2 + Vue 3 + TipTap（ProseMirror）+ TypeScript
- **编辑器核心**：TipTap 富文本编辑器，通过 `@tiptap/suggestion` 插件驱动 `/` SlashMenu 和 `:` EmojiMenu

### 1.2 问题表现

用户输入 `/` 字符后，**SlashMenu 弹出菜单不再出现**。同时 `:` EmojiMenu 是否受影响未明确验证（但排查过程中未见相关问题报告）。

### 1.3 触发条件

问题出现在 **AI 助手 Qoder** 对项目进行了 6 项功能改动之后。改动均为未提交的本地修改（working tree dirty）。

---

## 二、Qoder 的 6 项改动清单

以下是 Qoder 对编辑器相关的全部改动，按功能模块分类：

### 改动 1：新增 Callout 块扩展（TipTap Node）

| 项目 | 详情 |
|------|------|
| **新建文件** | `src/components/Editor/tiptap/extensions/callout.ts`（未跟踪） |
| **功能** | GitHub / Obsidian 风格的 `> [!TYPE]` 提示块，支持 8 种类型 |
| **Schema** | `name: 'callout'`, `group: 'block'`, `content: 'block+'`, `defining: true` |
| **NodeView** | `addNodeView()` 返回 `{ dom, contentDOM: body }`，手写 DOM 构建 |

**关键代码特征**：
```typescript
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',     // ← 允许包含任意数量的块级子节点
  defining: true,        // ← 标记为定义节点
  // ...
  addNodeView() {
    return ({ node }) => {
      // 手写 DOM：div.mk-callout > div.mk-callout-title + div.mk-callout-body
      return { dom, contentDOM: body };
    };
  },
});
```

**注册方式**：在 `editor-extensions.ts` 的 extensions 数组中添加 `Callout,`（位于 `CustomImage` 之后、`Highlight` 之前）。当前此行已被我临时移除。

### 改动 2：新增 Callout Markdown 插件

| 项目 | 详情 |
|------|------|
| **新建文件** | `src/components/Editor/tiptap/markdown/plugins/callout.ts`（未跟踪） |
| **功能** | 解析 `> [!TYPE]` 语法为 callout 节点，序列化 callout 节点回 Markdown |
| **实现方式** | 有状态 `tokenInterceptor`，使用闭包变量 `skipUntilClose` / `skipLevel` |

**在 `markdown/plugins/index.ts` 中注册**：`calloutMarkdownPlugin` 被添加到 `markdownSyntaxPlugins` 数组的**首位**（在 math、mermaid、wikilink 之前）。

### 改动 3：SlashMenu 新增 Callout 命令项

| 项目 | 详情 |
|------|------|
| **修改文件** | `src/components/Editor/tiptap/extensions/slash-commands.ts` |
| **内容** | 新增 4 个 callout 命令（提示/建议/警告/重要），调用 `insertContent({ type: 'callout', attrs: { calloutType: ... } })` |
| **附加改动** | 将「段落」改名为「正文」 |

### 改动 4：表格可拖拽调整列宽

| 项目 | 详情 |
|------|------|
| **修改文件** | `src/components/Editor/tiptap/extensions/table.ts` |
| **内容** | `CustomTable` 配置：`resizable: false` → `resizable: true`，新增 `handleWidth: 5`, `cellMinWidth: 50` |

### 改动 5：代码块复制按钮

| 项目 | 详情 |
|------|------|
| **修改文件** | `src/components/Editor/tiptap/extensions/code-block.ts` |
| **内容** | 在 CodeBlock NodeView 的 header 中新增 SVG 复制按钮，使用 `navigator.clipboard.writeText()`，2 秒绿色对勾反馈 |

### 改动 6：BubbleMenu 增强 + 编辑器样式调整

| 子项 | 文件 | 内容 |
|------|------|------|
| BubbleMenu 新增按钮 | `views/BubbleMenu.vue` | 无序列表按钮 + 清除格式按钮 |
| 对应命令 | `editor-commands.ts` | 新增 `case 'bulletList'` 和 `case 'clearFormat'` |
| 宽度估算 | `MarkdownEditor.vue` | `BUBBLE_MENU_ESTIMATED_WIDTH` 从 320→360 |
| 引用块样式 | `editor.css` | padding 改为 `0.4em 0 0.4em 1em`，加 `border-radius`，首尾子元素 margin 置零 |
| 复制按钮样式 | `editor.css` | `.mk-code-block-copy-button` 相关 CSS |
| 列拖拽样式 | `editor.css` | `.column-resize-handle` 相关 CSS |

---

## 三、排查过程

### 3.1 静态分析（全部通过）

| 检查项 | 结果 |
|--------|------|
| `vue-tsc` 类型检查 | ✅ 通过 |
| `vitest` 单元测试 | ✅ 201/201 全部通过 |
| 模块加载检查（`bun run build`） | ⚠️ 失败，但失败原因是 vite.config.ts 的 `manualChunks` 问题（**已有预存 bug，与本次改动无关**） |

**结论**：问题不是编译时/静态问题，是**运行时问题**。

### 3.2 Git Stash 整体隔离

```
git stash push -u    # 暂存所有 Qoder 改动（含新文件）
```

**结果**：`/` 斜杠菜单**恢复正常** ✅

```
git stash pop        # 恢复所有改动
```

**结果**：`/` 斜杠菜单**再次失效** ❌

**结论**：问题确实由 Qoder 的改动引入，排除环境/配置因素。

### 3.3 逐步排除法

由于 stash 隔离已确认问题在 Qoder 改动中，进一步做了**最小化手术测试**：

**操作**：仅在 `editor-extensions.ts` 的 extensions 数组中**移除 `Callout,` 这一行**（保留 import 语句，保留 callout.ts 文件本身，保留所有其他改动）。

```
// editor-extensions.ts 扩展数组中，移除此行：
Callout,    // ← 删除这一行即可恢复 / 命令
```

**结果**：`/` 斜杠菜单**恢复正常** ✅

**结论**：
- ✅ 问题**精确定位**到 `Callout` TipTap Node 扩展的**注册**
- ✅ 排除了 Markdown 插件（`markdown/plugins/callout.ts`）的影响
- ✅ 排除了 SlashMenu 命令项（`slash-commands.ts` 中新增的 4 个 callout 项）的影响
- ✅ 排除了 BubbleMenu / code-block / table / CSS 等所有其他改动的影响

---

## 四、根因分析（推断）

### 4.1 已确认的事实

1. **Callout Node 扩展一旦注册到 TipTap Editor 的 extensions 数组中，`/` 斜杠菜单就无法弹出**
2. 移除注册后一切恢复正常
3. 问题仅在**运行时**出现，所有静态分析均通过

### 4.2 可能的根因方向

以下是按照可能性从高到低排列的推测，**均未验证**，供接手者参考：

#### 方向 A：ProseMirror Schema 冲突（可能性：高）

Callout 的 Schema 定义：
```typescript
group: 'block',
content: 'block+',    // 可包含任意块级节点
defining: true,
```

`content: 'block+'` 意味着 callout 可以包含 paragraph、heading、codeBlock 等任何块级节点。当 TipTap 构建 ProseMirror Schema 时，这可能影响了 Suggestion 插件所依赖的文档结构约束。

`@tiptap/suggestion` 在用户输入 `/` 时需要：
1. 创建一个临时 decoration（用于定位弹出菜单位置）
2. 追踪一个 `Range`（`from` 到 `to`）
3. 触发 `render.onStart` 回调

如果 Schema 的变化导致 Suggestion 插件的 `createDecorationSet` 或 ` decorations` 映射失败（不抛错但返回空），菜单就不会显示。

#### 方向 B：`defining: true` 的副作用（可能性：中）

`defining: true` 告诉 ProseMirror 当将此节点的子节点包裹到同类型节点时，应将属性复制到新节点。这可能影响 ProseMirror 的节点匹配/包裹算法，间接影响 Suggestion 的文本范围计算。

#### 方向 C：NodeView 与 Decoration 的交互（可能性：中）

Callout 使用了手写的 `addNodeView()`，返回 `{ dom, contentDOM: body }`。TipTap/ProseMirror 的 `NodeView` 实现可能与 Suggestion 插件使用的 `Decoration` 产生冲突——特别是 `Decoration.widget` 或 `Decoration.inline` 在特定 NodeView 中的渲染可能被阻止。

#### 方向 D：Plugin 执行顺序（可能性：低）

TipTap 注册扩展时，ProseMirror Plugin 的顺序可能影响 Suggestion 插件能否正确接收 `appendTransaction` 或 `handleKeyDown` 事件。新增一个 Node 扩展可能改变了 Plugin 数组的顺序。

---

## 五、建议的排查步骤（供接手者）

### 步骤 1：浏览器 DevTools 调试

在应用运行时打开 DevTools Console，在 Suggestion 插件的关键位置打断点或添加日志：

```typescript
// 文件：node_modules/@tiptap/suggestion/dist/index.cjs (或 .mjs)
// 在 Suggestion 函数内部，关注以下逻辑：
// 1. view.update 回调中 decorations 的计算
// 2. props() 函数的返回值
// 3. 是否有异常被静默捕获
```

具体检查：
- 输入 `/` 后，`Suggestion` 的 `view.update` 是否被调用？
- `props()` 返回的对象中 `suggestion` 字段是否正确？
- `clientRect` 回调是否能正确获取到位置？

### 步骤 2：最小化 Callout Schema 测试

尝试以下修改，逐一验证：

**测试 A — 移除 `content`**：
```typescript
content: '',  // 不允许子内容
```

**测试 B — 移除 `defining`**：
```typescript
defining: undefined,  // 或直接删除此字段
```

**测试 C — 移除 `addNodeView`**：
```typescript
// 注释掉整个 addNodeView() 方法，使用默认渲染
```

**测试 D — 使用最简 Schema**：
```typescript
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph',  // 仅允许一个段落
  // 不设 defining，不设 addNodeView
  addAttributes() { /* ... */ },
  parseHTML() { return [{ tag: 'div.callout' }] },
  renderHTML({ HTMLAttributes }) { return ['div', HTMLAttributes, 0] },
});
```

每次修改后验证 `/` 是否恢复，以确定是 Schema 哪个属性导致问题。

### 步骤 3：检查 Plugin Key 冲突

```typescript
// slash-commands.ts 中定义了：
const slashPluginKey = new PluginKey('slashCommands');

// 确认 Callout 扩展没有创建同名或冲突的 PluginKey
// 检查所有 extension 的 addProseMirrorPlugins() 是否有 name 冲突
```

### 步骤 4：逐步添加复杂度

在确认最小 Schema 可工作后，逐步添加功能：
1. 添加 `content: 'block+'`
2. 添加 `defining: true`
3. 添加 `addNodeView()`
4. 添加 `parseHTML()` / `renderHTML()`

每一步都验证 `/` 菜单，精确定位是哪个特性触发了问题。

---

## 六、当前工作区状态（重要）

### 6.1 editor-extensions.ts 的当前状态

```
当前状态：Callout 的 import 存在，但未注册到 extensions 数组
```

具体来说：
- ✅ `import { Callout } from './extensions/callout';` — **存在**（第 18 行）
- ❌ `Callout,` 在 extensions 数组中 — **已被移除**（我的手术测试）

这意味着：
- `/` 斜杠命令当前可用（因为 Callout 未注册）
- 但 Callout 功能完全不工作（未注册）
- 所有其他 Qoder 改动仍然生效（table resizable、code-block copy、BubbleMenu、CSS 等）

### 6.2 待修复后需要做的事

1. 将 `Callout,` 添加回 `editor-extensions.ts` 的 extensions 数组（`CustomImage` 之后）
2. 验证 `/` 斜杠命令仍然正常
3. 验证 Callout 的完整功能（Markdown 解析/序列化、SlashMenu 插入、NodeView 渲染）

### 6.3 额外发现：vite.config.ts 预存 Bug

**这是独立于 `/` 命令问题之外的已有 bug，与 Qoder 本次改动无关。**

```
错误信息：TypeError: manualChunks is not a function
```

**原因**：`vite.config.ts` 中 `build.rollupOptions.output.manualChunks` 使用了**对象语法**，但 Vite 8 的 rolldown 后端要求使用**函数语法**。此外还引用了项目中不存在的包（`@tiptap/extension-underline`、`@tiptap/extension-text-align`、`@tiptap/extension-typography`）。

**修复方案**：
```typescript
// 将对象语法改为函数语法：
manualChunks: (id: string) => {
  if (id.includes('@tiptap/vue-3') || id.includes('@tiptap/pm') || id.includes('@tiptap/core')) {
    return 'tiptap-core';
  }
  if (id.includes('@tiptap/extension-')) {
    return 'tiptap-extensions';
  }
  // ... 其他分包逻辑
},
```

---

## 七、改动文件索引

| 文件路径 | 状态 | 与 `/` 命令 bug 的关系 |
|----------|------|------------------------|
| `src/components/Editor/tiptap/extensions/callout.ts` | 新建（未跟踪） | ⚠️ **直接相关** — 核心嫌疑 |
| `src/components/Editor/tiptap/editor-extensions.ts` | 已修改 | ⚠️ **直接相关** — Callout 注册位置 |
| `src/components/Editor/tiptap/markdown/plugins/callout.ts` | 新建（未跟踪） | ✅ 已排除 |
| `src/components/Editor/tiptap/markdown/plugins/index.ts` | 已修改 | ✅ 已排除 |
| `src/components/Editor/tiptap/extensions/slash-commands.ts` | 已修改 | ✅ 已排除 |
| `src/components/Editor/tiptap/extensions/table.ts` | 已修改 | ✅ 未排查（静态分析无异常） |
| `src/components/Editor/tiptap/extensions/code-block.ts` | 已修改 | ✅ 未排查（静态分析无异常） |
| `src/components/Editor/tiptap/editor.css` | 已修改 | ✅ 未排查（仅 CSS，不影响逻辑） |
| `src/components/Editor/views/BubbleMenu.vue` | 已修改 | ✅ 已排除 |
| `src/components/Editor/tiptap/editor-commands.ts` | 已修改 | ✅ 已排除 |
| `src/components/Editor/MarkdownEditor.vue` | 已修改 | ✅ 已排除（仅宽度常量） |
| `src/components/Editor/tiptap/markdown/__tests__/plugins.spec.ts` | 已修改 | ✅ 测试适配 |
| `vite.config.ts` | 已修改 | ⚠️ 独立问题（预存 bug） |

---

## 八、核心架构参考

### 8.1 Suggestion 插件工作原理

```
用户输入 "/" → InputRule/ProseMirror 捕获 → Suggestion plugin 计算 Range
→ 触发 render.onStart → SlashMenu 组件显示 → 用户选择 → command 执行
```

关键文件：
- `slash-commands.ts`：Suggestion 配置 + 命令项定义
- `SlashMenu.vue`：菜单 UI 组件
- `MarkdownEditor.vue`：协调层，持有 `slashMenuRef` / `slashMenuItems` / `slashMenuCommand`

### 8.2 扩展注册流程

```
createEditorExtensions(options)
  → 返回 extensions 数组
    → StarterKit（内置基础扩展）
    → 各自定义扩展（按数组顺序注册）
    → SlashCommands（Suggestion 插件）
    → EmojiSuggest（Suggestion 插件）
  → 传入 useEditor({ extensions })
    → TipTap 内部按顺序初始化每个扩展
      → 构建 ProseMirror Schema
      → 收集所有 ProseMirror Plugins
      → 创建 EditorView
```

### 8.3 相关架构文档

- `F:\fzz-Project\md-editor\ARCHITECTURE.md` — 项目完整架构文档（564 行）
- `F:\fzz-Project\md-editor\project_rules.md` — 工作方法和决策原则
