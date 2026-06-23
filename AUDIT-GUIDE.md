# MD Editor — 第三方代码审核指南

> **文档版本**：v1.0 | **项目版本**：见 `package.json` version 字段
> **编写日期**：2026-06-23
> **适用对象**：第三方代码审核人员
>
> 本文档旨在帮助审核人员快速理解产品定位、技术架构、代码质量现状及已完成的优化工作，以便出具系统、全面的审查报告。

---

## 一、产品概述

### 1.1 产品定位

**MD Editor** 是一款基于 Tauri 2.0 + Vue 3 的**桌面端 Markdown 编辑器**，核心差异化定位为：

| 维度 | 定位 |
|---|---|
| **设计风格** | 文艺/极简/克制，对标 Linear / Raycast / Notion 的审美标准 |
| **性能目标** | 极速响应：编辑器实例复用、防抖优化、懒加载组件 |
| **技术栈** | Rust 原生后端（Tauri 2.0）+ Vue 3 前端 + TipTap 富文本编辑器 |
| **目标用户** | 追求写作体验的中文 Markdown 用户 |

### 1.2 核心功能矩阵

```
┌─────────────────────────────────────────────────────┐
│                    编辑能力                          │
│  · TipTap 3.0 富文本编辑器                          │
│  · Markdown 实时解析/序列化（自研 parser/serializer） │
│  · 斜杠命令菜单 (/) + Emoji 菜单 (:)                │
│  · 气泡格式栏（BubbleMenu，右对齐）                  │
│  · 数学公式（KaTeX 行内/块级）                       │
│  · Mermaid 图表渲染                                 │
│  · 代码块语法高亮                                   │
│  · 表格 / 图片拖放粘贴                               │
│  · 上标/下标 / Wiki 链接                             │
│  · 语义化标题层级                                   │
├─────────────────────────────────────────────────────┤
│                    主题系统                          │
│  · 7 套预设主题（朱砂/书卷/素雅/暖杏/灰域等）        │
│  · 自定义主题编辑器（颜色组 + 实时预览）             │
│  · 6 种可选字体（思源宋体/微软雅黑 UI 等）           │
│  · 浅色/深色模式切换                                │
│  · 焦点模式（隐藏标题栏和状态栏）                    │
├─────────────────────────────────────────────────────┤
│                    导出能力                          │
│  · HTML 导出                                        │
│  · PDF 导出                                         │
│  · 微信富文本复制（4 套文学风主题）                  │
├─────────────────────────────────────────────────────┤
│                    桌面集成                          │
│  · 自定义标题栏（可自动隐藏）                        │
│  · 窗口自由缩放（8 方向手柄）                       │
│  · 原生菜单栏快捷键同步                              │
│  · 自动保存（可配置间隔）                            │
│  · 文件打开/保存/另存为                              │
│  · 启动时恢复上次文件                                │
└─────────────────────────────────────────────────────┘
```

---

## 二、技术架构

### 2.1 技术栈总览

| 层级 | 技术 | 版本 |
|---|---|---|
| **运行时** | Tauri (Rust) | 2.x |
| **前端框架** | Vue 3 | 3.x (Composition API + `<script setup>`) |
| **语言** | TypeScript | 5.x (strict mode) |
| **状态管理** | Pinia | 2.x |
| **构建工具** | Vite | 5.x |
| **CSS 方案** | Tailwind CSS 3.x + CSS Variables（主题驱动） |
| **编辑器引擎** | TipTap | 3.x (基于 ProseMirror) |
| **数学公式** | KaTeX | - |
| **图表** | Mermaid | - |
| **测试框架** | Vitest + happy-dom | - |
| **类型检查** | vue-tsc | - |

### 2.2 目录结构

```
src/
├── main.ts                          # 应用入口
├── App.vue                          # 根组件（~368 行，协调层）
│
├── stores/                          # Pinia 状态管理
│   ├── file.ts                      #   当前文档状态（路径/内容/脏标记）
│   └── settings.ts                  #   全局设置（主题/字体/快捷键/迁移）
│
├── composables/                     # 组合式函数（业务逻辑封装）
│   ├── useDocumentSession.ts        #   文档生命周期（新建/打开/保存/自动保存）
│   ├── useCommandDispatcher.ts      #   命令分发（菜单→操作映射）
│   ├── useAppEditorState.ts         #   编辑器状态桥接
│   ├── useAppDomEvents.ts           #   全局 DOM 事件监听
│   ├── useAppWindowSession.ts       #   窗口会话（标题/关闭确认/全屏）
│   ├── useMenuEvents.ts             #   原生菜单事件处理
│   ├── useMenuShortcutsSync.ts      #   快捷键同步到原生菜单
│   ├── useExportActions.ts          #   导出行为（HTML/PDF/微信）
│   ├── useImagePreview.ts           #   图片预览状态机
│   ├── useClickOutside.ts           #   点击外部检测（通用 composable）
│   └── useFloatingListMenu.ts       #   浮动列表菜单（SlashMenu/EmojiMenu 共享）
│
├── components/                      # Vue 组件
│   ├── icons/                       #   共享图标组件
│   │   ├── CloseIcon.vue            #     关闭图标（X）
│   │   └── CheckIcon.vue            #     勾选图标（✓）
│   │
│   ├── Layout/                      #   布局组件
│   │   ├── CustomTitlebar.vue       #     自定义标题栏（hover 显隐/内联重命名）
│   │   ├── WindowResizeHandles.vue  #     8 方向窗口缩放手柄
│   │   └── ErrorBoundary.vue        #     错误边界（onErrorCaptured slot 模式）
│   │
│   ├── Settings/                    #   设置面板（5 个 tab 页）
│   │   ├── SettingsModal.vue        #     设置弹窗容器
│   │   ├── EditorSettingsPanel.vue  #     编辑器行为设置
│   │   ├── AppearanceSettingsPanel.vue # 外观设置
│   │   ├── SaveSettingsPanel.vue    #     保存设置
│   │   ├── ExportSettingsPanel.vue  #     导出设置
│   │   ├── ShortcutSettingsPanel.vue#     快捷键设置
│   │   ├── ThemeEditor.vue          #     主题编辑器
│   │   ├── settings-shared.css      #     设置面板共享样式（消除 ~300 行重复）
│   │   └── ...                      #     子组件 ~15 个
│   │
│   ├── Editor/                      #   编辑器核心
│   │   ├── MarkdownEditor.vue       #     编辑器主组件（TipTap 初始化/实例复用）
│   │   ├── views/                   #     浮动视图
│   │   │   ├── SlashMenu.vue        #       斜杠命令菜单
│   │   │   ├── EmojiMenu.vue        #       Emoji 选择菜单
│   │   │   └── BubbleMenu.vue       #       气泡格式栏
│   │   └── tiptap/                  #     TipTap 扩展层
│   │       ├── extensions/          #       16 个自定义扩展
│   │       │   ├── code-block.ts    #         代码块
│   │       │   ├── image.ts         #         图片
│   │       │   ├── table.ts         #         表格
│   │       │   ├── math-block.ts    #         KaTeX 块公式
│   │       │   ├── math-inline.ts   #         KaTeX 行内公式
│   │       │   ├── mermaid-block.ts #         Mermaid 图表
│   │       │   ├── slash-commands.ts#         斜杠命令
│   │       │   ├── emoji-suggest.ts #         Emoji 建议
│   │       │   ├── wikilink.ts      #         Wiki 链接
│   │       │   ├── sub-sup.ts       #         上标/下标
│   │       │   ├── semantic-heading.ts #     语义化标题
│   │       │   ├── shortcuts.ts     #         快捷键绑定
│   │       │   ├── markdown-input.ts#         Markdown 输入规则
│   │       │   └── markdown-paste.ts#         Markdown 粘贴规则
│   │       ├── markdown/            #       Markdown 解析/序列化
│   │       │   ├── parser.ts        #         MD → ProseMirror Doc
│   │       │   ├── serializer.ts    #         ProseMirror Doc → MD
│   │       │   └── plugins/         #         解析插件
│   │       ├── editor-extensions.ts #       扩展注册表
│   │       ├── editor-commands.ts   #       编辑器命令集
│   │       ├── editor-image-drop.ts #       图片拖放处理
│   │       ├── editor-metadata.ts   #       元数据提取
│   │       └── useEditorAppearance.ts #     主题外观应用
│   │
│   ├── FontPopover.vue              #   字体选择弹出面板
│   ├── ThemePopover.vue             #   主题切换弹出面板
│   ├── ExportPopover.vue            #   导出操作弹出面板
│   └── StatusbarQuickActions.vue    #   状态栏快捷入口容器
│
├── services/tauri/                  # Tauri IPC 服务层
│   ├── client.ts                    #   IPC 客户端封装（invokeCommand 泛型）
│   ├── command-names.ts             #   命令名常量表（TAURI_COMMANDS）
│   ├── event-names.ts               #   事件名常量表
│   ├── window.ts                    #   窗口操作（全部走 TAURI_COMMANDS）
│   ├── dialog.ts                    #   对话框 API
│   ├── document.ts                  #   文件读写 API
│   ├── clipboard.ts                 #   剪贴板 API
│   ├── asset.ts                     #   资源管理
│   ├── opener.ts                    #   文件打开器
│   ├── os.ts                        #   操作系统检测
│   ├── store.ts                     #   持久化存储
│   ├── webview.ts                   #   Webview 控制
│   ├── window-state.ts              #   窗口状态持久化
│   └── events.ts                    #   事件监听封装
│
├── themes/                          # 主题系统
│   ├── types.ts                     #   主题类型定义
│   ├── index.ts                     #   主题加载与应用逻辑
│   ├── manager.ts                   #   主题 CRUD 管理
│   └── presets/                     #   7 个预设主题 JSON
│
├── utils/                           # 工具函数
│   ├── shortcuts.ts                 #   快捷键定义与匹配
│   ├── platform.ts                  #   平台检测
│   ├── export/                      #   导出管线
│   │   ├── build-export-tree.ts     #     ProseMirror → 导出树
│   │   ├── model.ts                 #     导出节点模型
│   │   ├── renderers/html.ts        #     HTML 渲染器
│   │   ├── renderers/wechat.ts      #     微信富文本渲染器
│   │   └── theme.ts                 #     导出主题适配
│   ├── wechat-themes.ts             #   微信导出 4 套文学风主题
│   └── wechat-renderer.ts           #   微信渲染入口
│
├── constants/fonts.ts               # 字体选项常量（FONT_OPTIONS）
└── assets/styles/main.css           # 全局样式与 CSS 变量定义
```

### 2.3 数据流架构

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Tauri/Rust  │◄──► │   services/tauri/ │◄──► │   Composables │
│  (原生后端)   │ IPC  │  (IPC 封装层)     │     │  (业务逻辑层)  │
└──────────────┘     └──────────────────┘     └──────┬───────┘
                                                          │
                    ┌─────────────────────────────────────┤
                    ▼                                     ▼
            ┌──────────────┐                      ┌──────────────┐
            │  Pinia Store │                      │  Vue 组件树   │
            │ file/settings│◄────────────────────►│ App → Editor  │
            └──────────────┘   reactive binding   └──────────────┘
                    │
                    ▼
            ┌──────────────┐
            │  tauri-store │  ← 持久化到 Rust 侧 KV 存储
            └──────────────┘
```

**关键设计决策**：
- **IPC 统一入口**：所有 Tauri invoke 调用通过 `client.ts` 的 `invokeCommand<T>()` 泛型函数，命令名集中维护在 `command-names.ts` 的 `TAURI_COMMANDS` 常量表中
- **Store 分离**：`file store`（文档状态，短生命周期）与 `settings store`（全局配置，长生命周期）职责清晰
- **Composable 解耦**：App.vue 不直接包含业务逻辑，全部委托给 composables（11 个），每个 composable 聚焦单一关注点

### 2.4 编辑器核心架构

```
用户输入 → markdown-input.ts（InputRule 匹配）
         → ProseMirror Schema 变更
         → editor update 事件（300ms debounce）
         → serializer.ts（ProseMirror Doc → Markdown）
         → fileStore.setContent()（Pinia store 更新）

文件切换 → watch(currentFile.path)
         → parser.ts（Markdown → ProseMirror Doc）
         → editor.commands.setContent(doc, { emitUpdate: false })
         → 复用同一 TipTap 实例（不重建）
```

---

## 三、代码质量现状

### 3.1 规模统计

| 维度 | 数值 |
|---|---|
| **Vue 组件数** | ~28 个 `.vue` 文件 |
| **TypeScript 源文件** | ~60+ 个 `.ts` 文件 |
| **Composables** | 11 个 |
| **TipTap 扩展** | 16 个 |
| **测试文件** | 24 个 `.spec.ts` |
| **测试用例总数** | **185 个**（全部通过） |
| **类型检查** | `vue-tsc --noEmit` 通过（strict mode） |
| **预设主题** | 7 套（JSON） |
| **Tauri IPC 命令** | ~20 个（集中在 command-names.ts） |

### 3.2 已完成的质量优化（分 4 个批次）

#### 批次 1：性能优化

| 优化项 | 影响 | 关键文件 |
|---|---|---|
| 编辑器实例复用（移除 `:key`，改用 `watch + setContent`） | 文件切换不再重建 TipTap 实例，零闪烁 | [MarkdownEditor.vue](src/components/Editor/MarkdownEditor.vue) |
| 光标信息 100ms 防抖 | 拖选时避免频繁遍历 doc 计算行号 | [MarkdownEditor.vue](src/components/Editor/MarkdownEditor.vue) |
| 编辑器更新 300ms 防抖 | 连续击键时减少序列化频率 | [MarkdownEditor.vue](src/components/Editor/MarkdownEditor.vue) |
| 设置深度监听拆分 | 主题变更独立监听，字体大小调整不触发 `applyCurrentTheme` | [settings.ts](src/stores/settings.ts) |
| `defineAsyncComponent` 懒加载编辑器 | 首屏不阻塞编辑器初始化 | [App.vue](src/App.vue) |

#### 批次 2：结构化重构

| 重构项 | 成果 |
|---|---|
| App.vue 拆分 | 598 行 → 368 行，抽取 CustomTitlebar / WindowResizeHandles / ErrorBoundary |
| StatusbarQuickActions 拆分 | 344 行 → 66 行，抽取 ThemePopover / FontPopover / ExportPopover |
| settings-shared.css | 消除 5 个设置面板间 ~300 行重复 CSS |
| popover-shared.css | 消除 3 个弹出面板间重复样式 |
| 死代码清理 | 删除 StatusBar.vue（未引用）、useAppUiState.ts（空壳函数） |

#### 批次 3：原子化与组件化

| 优化项 | 详情 |
|---|---|
| 字体常量集中 | [fonts.ts](src/constants/fonts.ts) — FONT_OPTIONS 单一数据源 |
| 类型修复 | sub-sup.ts `any` → `MarkType`（从 @tiptap/pm/model 导入） |
| 命令名常量化 | window.ts 6 处硬编码字符串 → TAURI_COMMANDS 常量表 |
| 魔法数字提取 | EDITOR_UPDATE_DEBOUNCE_MS(300)、CURSOR_INFO_DEBOUNCE_MS(100)、TITLEBAR_HIDE_DELAY_MS(300)、AUTOSAVE_STATUS_DISPLAY_MS(2000) |
| useClickOutside | 替代 StatusbarQuickActions 内联 document.addEventListener |
| CloseIcon / CheckIcon | 消除 5 处 SVG path 重复定义 |
| useFloatingListMenu | SlashMenu / EmojiMenu 共享键盘导航逻辑（~60 行去重） |
| 内联 style 清理 | 8 个文件 13 处静态 `style="..."` 改为 CSS class |
| 硬编码颜色修复 | ShortcutSettingsPanel 6 处十六进制 → CSS 变量；SettingsSwitch 深色主题适配；ExportPopover `--danger-color`（不存在变量）→ `--error-color`；App.vue fallback 值清理 |

#### 批次 4：测试补强

| 测试文件 | 用例数 | 覆盖范围 |
|---|---|---|
| [file.spec.ts](src/stores/__tests__/file.spec.ts) | 23 | dirty 状态机、displayName 派生（含 .md/.markdown/.txt 后缀）、markSaved/reset/setLoading/setDisplayName |
| [useClickOutside.spec.ts](src/composables/__tests__/useClickOutside.spec.ts) | 5 | 内部点击不触发、外部点击触发、null 安全降级、自定义事件名(mousedown)、挂载/卸载生命周期 |
| [useFloatingListMenu.spec.ts](src/composables/__tests__/useFloatingListMenu.spec.ts) | 13 | ArrowDown/Up 循环导航、Enter 选中、show/hide 定位、items 变化重置选中、空列表安全、未识别按键返回 false |

**vitest.config.ts coverage 配置**：
- Provider: v8
- 收集范围: stores / composables / services / commands / utils / themes / 编辑器扩展与 markdown 解析序列化
- 门槛: 语句 50% / 函数 50% / 分支 40% / 行 50%

### 3.3 设计规范遵循情况

| 规范项 | 状态 | 说明 |
|---|---|---|
| TypeScript strict mode | ✅ | tsconfig.json 开启 strict |
| 无 `any` 类型（业务代码） | ✅ | 已修复 sub-sup.ts 的 `type: any` |
| 无 `console.log` 残留 | ⚠️ | 需审核确认 |
| CSS 变量驱动主题 | ✅ | 全部使用 var(--xxx-color)，无硬编码主题色（除阴影 rgba） |
| 无内联静态 style | ✅ | 已清理 13 处，剩余均为动态 :style 绑定 |
| 命令名常量化 | ✅ | TAURI_COMMANDS 单一数据源 |
| 字体清单单一来源 | ✅ | FONT_OPTIONS in constants/fonts.ts |
| SVG 图标复用 | ✅ | CloseIcon / CheckIcon 组件化 |
| Composable 复用 | ✅ | useClickOutside / useFloatingListMenu 抽取 |
| Shared CSS | ✅ | settings-shared.css / popover-shared.css |
| 错误边界 | ✅ | ErrorBoundary slot 模式包裹编辑器 |
| 配置迁移机制 | ✅ | configVersion = 6，增量迁移新字段 |

---

## 四、建议审核重点领域

以下按优先级排列，供审核人员深入核实：

### P0 — 必须核实（正确性与安全性）

1. **Markdown 解析/序列化一致性**
   - 文件: [parser.ts](src/components/Editor/tiptap/markdown/parser.ts), [serializer.ts](src/components/Editor/tiptap/markdown/serializer.ts)
   - 关注: round-trip 是否保真？特殊字符（转义、HTML实体、Unicode）是否正确处理？
   - 现有测试: `parser.spec.ts`, `serializer.spec.ts`

2. **文件保存安全性**
   - 文件: [useDocumentSession.ts](src/composables/useDocumentSession.ts)
   - 关注: 大文件阈值（100K 字符）警告是否合理？自动保存竞态条件？
   - 现有测试: `useDocumentSession.spec.ts`

3. **Dirty 状态机完整性**
   - 文件: [file.ts](src/stores/file.ts)
   - 关注: 加载→编辑→保存→再编辑 的完整流转是否无遗漏？
   - 现有测试: `file.spec.ts`（23 个用例覆盖主要场景）

4. **Tauri IPC 安全性**
   - 文件: [client.ts](src/services/tauri/client.ts), [command-names.ts](src/services/tauri/command-names.ts)
   - 关注: 所有 invoke 调用是否都经过 client.ts 封装？是否有未走常量表的裸字符串？

### P1 — 应当核实（性能与健壮性）

5. **编辑器扩展注册顺序**
   - 文件: [editor-extensions.ts](src/components/Editor/tiptap/editor-extensions.ts)
   - 关注: 扩展间的依赖关系是否正确？InputRule / PasteRule 优先级是否合理？

6. **内存泄漏风险**
   - 关注: MutationObserver / setInterval / addEventListener 是否都有对应 cleanup？
   - 特别: useDocumentSession.ts 的 autoSaveTimer, CustomTitlebar.vue 的 hoverTimer, MarkdownEditor.vue 的 debounce cancel

7. **主题切换稳定性**
   - 文件: [index.ts](src/themes/index.ts), [manager.ts](src/themes/manager.ts)
   - 关注: 动态注入 CSS 变量后是否有残留？深浅模式切换是否完整？

8. **导出管线正确性**
   - 文件: `utils/export/` 目录
   - 关注: HTML/PDF/微信 三种导出的输出是否符合预期？特殊节点（表格/公式/代码块）是否正确降级？

### P2 — 建议核实（可维护性）

9. **App.vue 职责**
   - 当前 368 行，协调 11 个 composable + 事件绑定
   - 是否还有进一步拆分的空间？（如窗口控制逻辑、状态栏逻辑）

10. **测试覆盖率缺口**
    - vitest coverage 已配置但尚未实际跑过 `--coverage`
    - 建议执行 `npx vitest run --coverage` 查看实际覆盖率报告
    - 重点关注的低覆盖率模块: 编辑器扩展（extensions/）、工具函数（utils/）

11. **CSS 架构**
    - 当前混合使用: Tailwind utility classes + scoped styles + 全局 CSS variables + shared non-scoped CSS
    - 是否存在命名冲突风险？BEM 命名是否一致？

12. **错误处理策略**
    - ErrorBoundary 仅包裹编辑器区域
    - Tauri IPC 调用的错误传播链路是否完善？
    - 文件读写失败的 UX 反馈是否充分？

---

## 五、快速上手验证步骤

```bash
# 1. 克隆仓库
cd f:\fzz-Project\md-editor\md-editor

# 2. 安装依赖
npm install

# 3. 类型检查（应无错误）
npx vue-tsc --noEmit

# 4. 运行全部测试（预期 185 passed, 0 failed）
npx vitest run

# 5. 运行带覆盖率的测试（首次需安装 c8/v8 provider）
npx vitest run --coverage

# 6. 启动开发服务器
npm run tauri dev

# 7. 构建（Rust + 前端打包）
npm run tauri build
```

---

## 六、已知待改进项（供参考）

以下是目前已识别但尚未排期处理的改进方向：

| 编号 | 类别 | 描述 | 建议 |
|---|---|---|---|
| F-01 | 性能 | 大文档（>10万字符）的编辑体验可能下降 | 可考虑虚拟滚动或分段加载 |
| F-02 | 功能 | 缺少撤销/redo 堆栈可视化 | TipTap 内置支持，UI 未暴露 |
| F-03 | 可访问性 | 键盘导航在设置面板中的 Tab 顺序 | 审核 A11y 合规性 |
| F-04 | i18n | 当前界面文案全部硬编码中文 | 如需国际化需引入 i18n 框架 |
| F-05 | 插件 | 编辑器扩展目前全部内置 | 未来可考虑插件化架构 |
| F-06 | 图标 | App.vue 中设置按钮仍为内联 SVG（齿轮图标复杂，约 30 行 path） | 可抽取为 SettingsIcon.vue |
| F-07 | 测试 | 编辑器扩展（16 个）缺少单元测试 | parser/serializer 有测试，各 extension 独立测试不足 |
| F-08 | 文档 | 缺少 CONTRIBUTING.md / ARCHITECTURE.md | 建议补充开发者入门文档 |

---

## 七、关键文件索引

| 角色 | 文件路径 | 说明 |
|---|---|---|
| 入口 | `src/main.ts` | Vue 应用创建与 Pinia 注册 |
| 根组件 | `src/App.vue` | 应用布局与 composable 协调 |
| 文档状态 | `src/stores/file.ts` | 当前文件的路径/内容/脏标记 |
| 全局设置 | `src/stores/settings.ts` | 主题/字体/快捷键/配置迁移 |
| 编辑器主件 | `src/components/Editor/MarkdownEditor.vue` | TipTap 实例管理与防抖更新 |
| MD 解析器 | `src/components/Editor/tiptap/markdown/parser.ts` | Markdown → ProseMirror |
| MD 序列化器 | `src/components/Editor/tiptap/markdown/serializer.ts` | ProseMirror → Markdown |
| 文档会话 | `src/composables/useDocumentSession.ts` | 新建/打开/保存/自动保存 |
| IPC 客户端 | `src/services/tauri/client.ts` | Tauri invoke 封装 |
| 命令名表 | `src/services/tauri/command-names.ts` | TAURI_COMMANDS 常量 |
| 主题管理 | `src/themes/index.ts` | 主题加载与 DOM 注入 |
| 导出管线 | `src/utils/export/` | HTML/PDF/微信导出核心 |
| 测试配置 | `vitest.config.ts` | Vitest + Coverage 配置 |
| 类型配置 | `tsconfig.json` | TypeScript strict mode |

---

> **结语**：本项目已完成两轮系统性优化——第一轮聚焦功能与设计打磨（Phase 1），第二轮聚焦代码结构化、原子化、组件化与性能（Phase 2，本批次）。当前代码库处于**类型安全、测试通过、架构分层清晰**的状态。期待第三方审核人员从独立视角发现盲点，提出改进建议。
