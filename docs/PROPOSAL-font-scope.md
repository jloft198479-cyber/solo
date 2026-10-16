---
title: 方案：字体切换的作用范围界定（正文字体 vs 界面字体）
type: proposal
audience: maintainer
status: active
tags: [方案, 字体, 主题, UI, 已落地]
summary: 现状是「切字体 = 整个界面跟着换」（`body` 直接用 `--font-text`）。业界共识（Obsidian / Notion / VS Code）是**正文字体与界面字体分离**。**2026-10-17 已按 A 方案落地**：界面字体固定为系统 UI 栈（`--font-ui`），不随正文字体变化。
updates: [docs/KNOWN-ISSUES.md]
---

# 字体切换的作用范围（界定稿 · 2026-10-17）

> **2026-10-17 已按 A 方案落地**（界面字体固定为系统 UI 栈，不给选项）。落地记录见 **§7**；上方 §1~§5 保留为界定与决策依据。

---

## 1. 现状：一处变量，两处用途

| 事实 | 位置 |
|---|---|
| 只有一个正文字体变量 `--font-text` | `src/assets/styles/main.css:6` |
| `body` 直接用它 ⇒ **全应用继承** | `src/assets/styles/main.css:304` |
| 编辑区也用它 | `src/components/Editor/tiptap/editor.css:76`（`.tiptap-editor`） |
| 切字体时一起改 | `src/components/Editor/tiptap/useEditorAppearance.ts:19` |
| 代码字体 `--font-mono` **已是独立的**，不受影响 | `main.css:5` |

**结论**：切「思源宋体 / 朱雀仿宋 / 汇文明朝 / 小赖」时，标题栏、侧栏、大纲、命令面板、设置弹窗、右键菜单、状态栏**全部跟着变成书法/宋体**。

反过来看，**字号与行高是对的** —— `--mk-font-size` / `--mk-line-height` 只在 `editor.css` 里被使用（`editor.css:78-79`），没有污染界面。所以本次要修的边界只有**字体家族**一项。

字体清单（`src/constants/fonts.ts`）：系统默认 / 微软雅黑 UI / 思源宋体 / 朱雀仿宋 / 小赖字体 / 霞鹜文楷 Lite / 汇文明朝 —— 后 5 款是**下载型文艺字体**，用在 12~13px 的菜单上尤其难读。

---

## 2. 同行怎么做（取证）

| 产品 | 做法 | 来源可信度 |
|---|---|---|
| **Obsidian** | 三字体**独立设置**：`Interface font`（所有 UI chrome：菜单 / 侧栏 / 按钮）、`Text font`（编辑与阅读视图的正文）、`Monospace font`（代码块 / frontmatter）。留空 = 系统默认 | 【高】官方 help `obsidian.md/help/settings` |
| **Notion** | 字体（Default / Serif / Mono）**只作用于页面内容**，且按页生效；**界面字体不可选**，跟随系统 | 【中】多第三方来源一致 |
| **VS Code** | `Editor: Font Family` 只作用于编辑器内容，工作台（UI）字体是另一套 | 【中·未逐字核】 |

**共同点**：**没有一款主流写作工具让「切正文字体」连带改变界面字体。** 界面字体要么固定为系统 UI 字体，要么单独给一个设置项。

第一性原理也指向同一结论：
- **正文字体 = 表达偏好**（我想让我的文章长什么样），千人千面，可以很个性。
- **界面字体 = 操作效率**（菜单、大纲要在 12px 下瞬间读清），要的是与系统一致、稳定、可预期。
把两者绑一起，等于「为了文章好看，牺牲操作界面的可读性」——艺术字体一上，菜单先废。

---

## 3. 结论：solo 应采用「正文 / 界面 / 代码」三分

- **正文字体**：用户可选（现有 7 款），只作用于文档内容。
- **界面字体**：默认 = 系统 UI 字体栈，**不随正文字体变化**。
- **代码字体**：`--font-mono` 现状已独立，**不动**。

### 判定规则（一句话）

> **这段字会不会被写进 `.md` 文件 / 会不会出现在导出与打印结果里？会 = 内容；不会 = 界面。**

### 归属表

| 区域 | 归属 | 说明 |
|---|---|---|
| 编辑器正文（段落 / 标题 / 引用 / 列表 / 表格 / callout） | **内容** | `editor.css:76` 已覆盖 |
| 行内代码 / 代码块 / 代码围栏 | **代码**（`--font-mono`） | 已独立 |
| Mermaid 图内文字、公式 | **内容** | 图表是文档的一部分；Mermaid 有自己的字体配置，改时需单独对齐（**待定**） |
| 打印 / 导出 PDF | **内容** | `main.css:392` 打印样式保留 `.tiptap-editor` |
| 自定义标题栏（含文件名、菜单） | **界面** | `Layout/CustomTitlebar.vue` |
| 侧栏 / 大纲面板 / 状态栏 | **界面** | `main.css:385` 提到的 `.sidebar` / `.outline-panel` |
| 命令面板、搜索面板、设置弹窗 | **界面** | `CommandPalette.vue` / `SearchPanel.vue` / `Settings/*` |
| 右键菜单 / Slash / Emoji / Bubble / Wikilink 菜单 | **界面** | `Editor/views/*` |
| 字体弹窗、主题弹窗、Toast、对话框 | **界面** | `FontPopover.vue` / `ThemePopover.vue` |
| **字体选择里的预览文字** | **内容**（用它自己预览自己） | 预览要显示该字体的真实样子 |
| 编辑器内的 UI 元素（placeholder、拖拽手柄、代码块语言标签与复制按钮） | **界面**（优先级低，可后做） | 这些是"贴在内容上的控件" |

---

## 4. 落地方案（待拍板后才动）

1. **新增 `--font-ui`**（`main.css`）：系统 UI 栈（`system-ui / -apple-system / 'Segoe UI' / 'Microsoft YaHei UI' / sans-serif`）。
2. **`body` 改用 `--font-ui`**（`main.css:304`）；`.tiptap-editor` 继续用 `--font-text`（已是）。
3. **编辑器内 UI 元素**显式声明 `font-family: var(--font-ui)`（placeholder / 菜单 / 按钮类）。
4. **文案**：设置里的「字体族」→**「正文字体」**；弹窗标题「字体」→「正文字体」。提示语说明只影响文章内容。
5. **数据迁移**：无。`settings.fontFamily` 语义不变（仍是你选的正文），只是作用范围收窄；默认 `'Microsoft YaHei UI'` 对正文依然合适。
6. **字体下载逻辑不变**（界面字体定为系统栈 ⇒ 无需下载，零新增加载成本）。

### 副作用盘点（§G 纪律）

| 风险点 | 结论 |
|---|---|
| 主题 preset 是否覆盖字体变量 | **不会** —— `src/themes/presets/*.json` 无 font 字段（`types.ts:121` 只有 `fontSize`） |
| crossfade（切字体时的淡入）会不会误伤 UI | **不会** —— 只作用于 `.mk-editor`（`themes/manager.ts:281`） |
| 字号 / 行高会不会跟着变 | **不会** —— 本来就只在编辑区生效 |
| 打印 / 导出 | **仍用正文字体**（`.tiptap-editor` 不受 body 改动影响） |
| 依赖 body 继承显示"内容文字"的地方 | **需逐个确认**：侧栏/大纲/搜索结果摘要显示的是文档标题文字，按 §3 表归界面（与 Obsidian 一致）；若你希望大纲跟随正文字体，需明确说 |
| 视觉变化 | 老用户升级后，界面从「你选的文艺字体」回到「系统字体」—— 这是**预期的修好**，但要在 CHANGELOG 里说明 |

---

## 5. 待你拍板（两个选项）

| 选项 | 界面字体 | 优点 | 代价 |
|---|---|---|---|
| **A（推荐）** | 固定为系统 UI 字体，不给选项 | 极简、符合产品定位、零新增设置项 | 想要"全站统一字体"的人没得选 |
| **B** | 设置里新增「界面字体」下拉（默认"跟随系统"，可选微软雅黑 UI 等） | 兼容"我就想全站一致" | 多一个设置项 + 字体下载逻辑要覆盖界面字体 + 更多测试面 |

> 个人建议 **A**：solo 的定位是"极简的个人读写工具"，界面字体固定是主流做法（Notion 连选项都不给）。若你属于"就想全站统一"，B 也不复杂。

---

## 7. 落地记录（2026-10-17）

**回滚锚点**：`git tag backup/20261017-0704`（保护已提交内容；未提交的 4 项文档改动未被本轮触碰）。

| 改动 | 文件 |
|---|---|
| 新增 `--font-ui`（系统 UI 栈：英文走系统 UI、中文落微软雅黑 UI） | `src/assets/styles/main.css` |
| `body` 由 `--font-text` 改为 `--font-ui` | `src/assets/styles/main.css:304` |
| 编辑区内 3 处提示文字固定 `--font-ui`（空段落占位 / 公式占位 / 图表占位） | `src/components/Editor/tiptap/editor.css` |
| 文案「字体」/「字体族」→「正文字体」+ 说明只影响正文 | `FontPopover.vue` / `SettingsFontSelect.vue` / `AppearanceSettingsPanel.vue` |

**未改**（经核查无需改）：
- 所有浮层（BubbleMenu / 右键菜单 / Slash / Emoji / Wikilink / 搜索面板）是 `.editor-shell` 的直接子元素、**不在 `.tiptap-editor` 内** ⇒ 继承 `body` ⇒ 自动跟随界面字体。
- 标题角标 H1–H6 已是 `--font-mono`；代码块无界面文字标签；`--mk-font-size` / `--mk-line-height` 本来就只在编辑区生效。
- 导出端（微信 / HTML）走 `buildFontStack(fontFamily)` ⇒ 仍是正文字体，不受影响。

**验证**：`vue-tsc --noEmit` 通过；`npx vitest run` 全绿（1862 passed / 0 failed）；`docs-lint` 通过。真机观感（切一遍字体看界面是否纹丝不动）待 debug 构建目视 / CDP 截图。

> 后续（2026-10-17 晚）：复查阶段发现的 3 条存量问题（导出端 mono 硬编码 / 字体状态逻辑重复 / `SYSTEM_FONTS` 冗余）已一并清理，处置与验证读数见 [REVIEW-2026-10-17-font-scope-recheck.md](../outputs/REVIEW-2026-10-17-font-scope-recheck.md) §五。

## 附：回滚与安全（按 `AGENTS.md` §1.6，落地前已执行）

- 动手前 `git status` 干净（当前有 4 项未提交，先处理）。
- 改动半径：跨模块（CSS 变量 + 设置文案 + 若干组件）⇒ 打 tag 锚点：`git tag backup/$(date +%Y%m%d-%H%M)`。
- 门禁：`vue-tsc` + 相关测试 + **CDP 真机截图自验**（`python scripts/cdp-verify-ui.py`，逐款字体切一遍看界面是否稳定）。
