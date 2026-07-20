# Solo 设置面板深度排查报告

> 排查范围：`src/components/Settings/`（22 个 Vue + 3 个 TS = 25 个文件） + `src/stores/settings.ts` 13 个配置项
> 排查方式：逐个文件审计 + 全量引用追踪（Grep 工具）

---

## 总览：配置项-UI 映射矩阵

| # | 配置项 | Store 定义 | 设置面板入口 | 实际生效 | 状态 |
|---|--------|-----------|-------------|---------|------|
| 1 | `activeThemeId` | ✅ | Appearance → ThemeSelector | ✅ 主题切换 | ✅ |
| 2 | `customThemes` | ✅ | Appearance → ThemeEditor | ✅ CRUD | ✅ |
| 3 | `fontSize` | ✅ | Appearance → RangeField | ✅ --mk-font-size | ✅ |
| 4 | `fontFamily` | ✅ | Appearance → FontSelect | ✅ buildFontStack | ✅ |
| 5 | `lineHeight` | ✅ | Appearance → RangeField | ✅ --mk-line-height | ✅ |
| 6 | `autoSave` | ✅ | Save → Switch | ✅ 自动保存 | ✅ |
| 7 | `autoSaveInterval` | ✅ | Save → RangeField | ✅ 保存间隔 | ✅ |
| 8 | `spellCheck` | ✅ | Editor → Switch | ✅ spellcheck attr | ✅ |
| 9 | `titlebarAutoHide` | ✅ | Editor → Switch | ✅ CustomTitlebar | ✅ |
| 10 | `wechatTheme` | ✅ | Export → ThemeSelector | ✅ 复制微信时用 | ✅ |
| 11 | `customShortcuts` | ✅ | Shortcuts → Panel | ✅ 快捷键自定义 | ✅ |
| 12 | **`customEditorCSS`** | ✅ | ❌ **无面板入口** | ✅ injectCustomCSS | ⚠️ |
| 13 | **`alwaysOnTop`** | ✅ | ❌ **无面板入口** | ✅ 标题栏按钮 | ⚠️ |
| — | `configVersion` | ✅ | 内部使用 | ✅ 迁移用 | — |

**核心发现**：13 个配置项中，11 个有完整的面板入口 → 生效链路。2 个（`customEditorCSS`、`alwaysOnTop`）在 store 中定义且实际生效，但在设置面板中**完全没有 UI 入口**。

---

## 一、问题清单

### 🔴 P0 — 死代码（零引用、无任何作用）

#### 1.1 `SettingsTabWidthSelector.vue` — 完全孤立的死组件

```
文件：src/components/Settings/SettingsTabWidthSelector.vue
行数：50 行
```

**证据**：全量 Grep `SettingsTabWidthSelector` 在整个 `src/` 目录命中 **0 次**。这个组件没有被任何文件 import。

**它做了什么**：提供一个 tab 宽度选择器（2 空格 / 4 空格），但这对应的 `tabWidth` 配置项**在 settings store 中都不存在**。这是从原项目源码中 fork 过来后残留下来的死文件，对应的功能（也可能是编辑器缩进宽度设置）在 Solo 分支中已被砍掉。

**判定**：100% 死代码，可直接删除。

#### 1.2 `handleWorkspaceChange` — 死函数

```
文件：src/composables/useDocumentSession.ts (L238-239)
```

代码本身自带了免责声明：
```ts
async function handleWorkspaceChange(_payload: { rootPath: string; kind: string; paths: string[] }) {
  // workspace 功能已移除，保留接口兼容
```

**证据**：全量 Grep `handleWorkspaceChange` 在整个 `src/` 目录中**只在 useDocumentSession.ts 内部出现**（定义 + 导出），没有任何调用方。导出一个无人调用的函数，典型的"忘记删"场景。

**判定**：死函数，可删除。

#### 1.3 `openShortcuts: () => {}` — 空实现命令

```
位置1：src/App.vue L105 — openShortcuts: () => {},
位置2：src/commands/registry.ts L350-352 — 注册了 help.shortcuts 命令
位置3：src/composables/useCommandDispatcher.ts L103-104 — case 'help.shortcuts': options.openShortcuts();
```

**发生了什么**：
- 命令注册表里有一个 `help.shortcuts` 命令（描述："打开快捷键帮助窗口"）
- 命令分发器 `useCommandDispatcher` 正确地路由了它
- 但 App.vue 中传入的 handler 是 **`() => {}`（空函数）**
- 有一个测试文件验证了这个空函数"被调用了"，但没有验证任何用户可见的行为

**判定**：功能未实现但命令已注册。要么实现它（例如打开设置面板直接跳到快捷键页），要么从命令注册表中移除这个命令。

---

### 🟡 P1 — 隐藏配置（生效但用户无法发现）

#### 2.1 `customEditorCSS` — 无面板入口

```
Store: settings.ts L37, L55
生效: useEditorAppearance.ts L51 — watch → injectCustomCSS()
```

这个配置项**确实在工作**——`useEditorAppearance.ts` 监听 `settings.customEditorCSS` 的变化，实时注入 `<style>` 标签到 DOM。但用户**完全无法通过设置面板配置它**。

**现状**：这是一个隐藏的"开发者功能"。用户只有在直接编辑 localStorage 或配置文件时才能设置它。普通用户永远不会发现它。

**优化方向**：
- **选项 A（推荐）**：删除此配置项。对于"极简记事本"定位的 Solo，用户不应该有"编辑自定义 CSS"的需求
- **选项 B**：在 Editor 面板添加一个"高级：自定义 CSS"折叠区块，默认收起

#### 2.2 `alwaysOnTop` — 有标题栏按钮但无面板项

```
Store: settings.ts L39, L56, L313-321, L364-370
标题栏按钮: CustomTitlebar.vue L42
App.vue: L174 — :always-on-top="settingsStore.settings.alwaysOnTop"
```

这个配置项在标题栏有一个实际可用的切换按钮（📌），功能完整。但它**没有出现在任何设置面板中**。

**设计意图判断**：这可能是一个有意的设计决策——置顶是一个"即时操作"而非"持久偏好"，通过标题栏按钮即可。但它被存入 store 并持久化（`initAlwaysOnTop` 在启动时恢复），说明产品把它当作持久设置。

**优化方向**：
- **选项 A（推荐）**：保持现状——标题栏按钮足够了，不需要进设置面板。但建议评估是否需要持久化（可能用户每次启动都恢复置顶状态不是期望行为）
- **选项 B**：在 Editor 面板添加一个开关

---

### 🟡 P2 — 文案与实际功能不匹配

#### 3.1 EditorSettingsPanel 的误导性描述

```
EditorSettingsPanel.vue L14: "控制行号、拼写检查等核心编辑体验。"
```

**事实**：该面板只有两个设置项——拼写检查 + 标题栏自动隐藏。**没有行号功能**。

这是从原项目 fork 时的残留文案。原项目可能有行号显示功能，但在 Solo 中已被砍掉。

**判定**：文案需修正。

---

### 🟢 P3 — 结构冗余（功能合理但组件拆分过细）

#### 4.1 设置面板文件树分析

```
Settings/
├── SettingsModal.vue               ← 主容器（协调器）
├── SettingsSidebarNav.vue          ← 侧边导航（5 个 tab）
├── SettingsModalHeader.vue         ← 弹窗标题 + 关闭按钮
├── SettingsModalFooter.vue         ← 底部按钮（恢复默认 / 完成）
├── SettingsPageHeader.vue          ← 每页标题 + 描述 + badge
│
├── AppearanceSettingsPanel.vue     ← 外观面板（组合了下面 4 个）
├── ThemeSelector.vue               ← 主题卡片网格
├── ThemeCard.vue                   ← 单个主题卡片
├── ThemePreview.vue                ← 主题卡片内的小预览图
├── ThemeEditor.vue                 ← 主题编辑器（含导入/导出）
├── ThemeEditorHeader.vue           ← 编辑器标题栏
├── ThemeEditorPreview.vue          ← 编辑器实时预览
├── ThemeColorGroups.vue            ← 颜色分组编辑器
│
├── EditorSettingsPanel.vue         ← 编辑器面板
├── ExportSettingsPanel.vue         ← 导出面板
├── WechatThemeSelector.vue         ← 微信主题选择器
├── SaveSettingsPanel.vue           ← 保存面板
├── ShortcutSettingsPanel.vue       ← 快捷键面板
│
├── SettingsSwitch.vue              ← 原子组件：开关
├── SettingsRangeField.vue          ← 原子组件：滑块
├── SettingsFontSelect.vue          ← 原子组件：字体选择
├── SettingsTabWidthSelector.vue    ← ⚠️ 死代码（见 P0）
│
├── settings-shared.css             ← 共享样式
├── theme-editor-types.ts           ← 主题编辑器类型
├── useThemeEditor.ts               ← 主题编辑器 composable
└── useShortcutSettings.ts          ← 快捷键 composable
```

**冗余评估**：

| 组件 | 行数 | 必要性 | 说明 |
|---|---|---|---|
| `SettingsModalHeader.vue` | 52 | ⚠️ 可内联 | 只是一个 `<h2>设置</h2>` + 关闭按钮，可以直接放在 SettingsModal 中 |
| `SettingsModalFooter.vue` | 49 | ⚠️ 可内联 | 2 个按钮，内联到 SettingsModal 就足够 |
| `SettingsPageHeader.vue` | 60 | ⚠️ 可内联 | 显示标题+描述，只有 SettingsModal 使用 |
| `ThemePreview.vue` | 256 | 可保留 | 确实有视觉价值，但行数不少 |
| `ThemeEditorPreview.vue` | 64 | ⚠️ 可合并 | 与 ThemePreview 功能相似但更简单，考虑合并 |
| `ThemeColorGroups.vue` | 112 | 可保留 | 颜色编辑器需要独立组件 |
| `SettingsSwitch.vue` | 63 | ✅ 复用合理 | 被 3 个面板使用 |
| `SettingsRangeField.vue` | 85 | ✅ 复用合理 | 被 2 个面板使用 |
| `SettingsFontSelect.vue` | 110 | ✅ 独立复杂度合理 | 字体加载检测逻辑较多 |
| `SettingsTabWidthSelector.vue` | 50 | ❌ 死代码 | **零引用** |

**结论**：结构冗余主要来自两个方向：
1. **header/footer 过度拆分**（3 个小文件各 50-60 行，可内联到 SettingsModal）
2. **主题编辑器体系过重**（ThemeEditor + ThemeEditorHeader + ThemeEditorPreview + ThemeColorGroups + theme-editor-types.ts + useThemeEditor.ts = 6 个文件 ≈ 500 行，服务于一个对"记事本"来说过于复杂的功能）

#### 4.2 ThemeEditor 体系的"功能-定位"不匹配

主题编辑器提供了：
- 复制当前主题
- 重命名
- 36 个颜色变量逐个编辑（7 个分组）
- 实时预览
- 导出 JSON / 导入 JSON
- 保存为自定义主题（CRUD）

这是一套"设计工具"级别的功能。对 Solo 的"Windows 记事本"定位来说，3-5 套精心挑选的预设主题 + 字体/字号/行高调整就够了。**不需要主题编辑器**。

---

### 🟢 P4 — Mermaid 代码残留（额外发现）

虽然 Mermaid 是懒加载（不影响启动速度），但它通过 4 个入口渗透到了代码中：

| 入口 | 文件 | 作用 |
|---|---|---|
| TipTap 扩展 | `editor-extensions.ts` | 注册 MermaidBlock 节点 |
| markdown-it 插件 | `markdown/plugins/mermaid.ts` | 解析 markdown 中的 mermaid 代码块 |
| 导出渲染器 | `export/renderers/html.ts` | HTML 导出时渲染 mermaid |
| 编辑器外观 | `useEditorAppearance.ts` | 主题切换时同步 Mermaid 主题 |

移除 Mermaid 将一次性精简这 4 个入口 + 1 个扩展文件 + 1 个 markdown 插件 + `package.json` 依赖。

---

### 🟢 P5 — 微信导出 4 套主题

```
src/utils/wechat-themes.ts — 4 套主题（书卷墨色/素雅米白/暖杏书香/经典蓝）
```

4 套主题、每套 14 个颜色变量、总共 ~130 行代码。对于微信导出这个辅助场景，1 套默认主题已经足够。

**判定**：可精简为 1 套（书卷墨色），删除其余 3 套。

---

## 二、优化方案建议

### 方案 A：最小改动（仅清理死代码）— 推荐立即执行

| # | 操作 | 影响 | 收益 |
|---|---|---|---|
| 1 | 删除 `SettingsTabWidthSelector.vue` | 1 个文件 | 零引用死文件 |
| 2 | 删除 `handleWorkspaceChange` | 函数定义 + 导出 | 死函数 + 相关类型 |
| 3 | 修正 EditorSettingsPanel 文案 | 1 行文字 | 去掉"行号"误导 |
| 4 | 决定 `help.shortcuts` 命令去留 | 要么实现，要么删除注册 | 完成缺失功能或去掉空壳 |

### 方案 B：中等力度（精简冗余结构）— 建议下个迭代

| # | 操作 | 说明 |
|---|---|---|
| 5 | 内联 SettingsModalHeader/Footer/PageHeader | 合并 3 个 50-60 行的小组件到 SettingsModal → `-3 文件` |
| 6 | 移除 `customEditorCSS` 配置项 | 从 store + useEditorAppearance 删除，对普通用户无意义 |
| 7 | 移除 `alwaysOnTop` 持久化 | 改为临时状态（不写 store），标题栏按钮仍然可用但重启后不恢复 |
| 8 | 微信导出精简为 1 套主题 | 保留书卷墨色，删除其余 3 套 → `wechat-themes.ts` 从 130 行降到 30 行 |

### 方案 C：大胆瘦身（回归"记事本"定位）— 重大版本

| # | 操作 | 说明 |
|---|---|---|
| 9 | 移除 ThemeEditor 体系（6 个文件） | 删除 ThemeEditor.vue + ThemeEditorHeader.vue + ThemeEditorPreview.vue + ThemeColorGroups.vue + theme-editor-types.ts + useThemeEditor.ts + store 中 customThemes CRUD actions |
| 10 | 主题预设精简为 3 套 | 保留 scholar / scholar-dark / default，删除 cinnabar/cinnabar-dark/elegant/gray-domain 4 套预设 JSON |
| 11 | 移除 Mermaid | 4 个入口 + 1 个扩展文件 + 1 个 markdown 插件 + package.json 依赖 |

---

## 三、综合建议

**立即执行**（方案 A，< 30 分钟）：
- 删 1 个死文件 + 1 个死函数 + 修 1 行文案
- 解决 `help.shortcuts` 空实现

**下一个迭代**（方案 B，< 2 小时）：
- 3 个小组件内联 → Settings 目录从 22 降到 19
- 砍掉 `customEditorCSS` 配置项
- 微信导出 4→1 套主题

**规划讨论**（方案 C，需用户决策）：
- 是否接受"去掉主题编辑器"带来的简化？
- 如果保留主题编辑器，是否需要这么大的配置粒度（36 个颜色变量）？
