---
title: UI/UX 与前端规范巡检报告 2026-10-17（规范结构 / 图标 / 排版 / 僵尸冗余）
type: archive
audience: both
status: archive
doc-life: frozen
review-by: —
owner: 简乐
tags: [审计, UI, UX, 图标, 排版, token, 僵尸代码]
summary: 四路并行巡检 + 逐行复核后的设计侧快照：结构底子稳但两个最大组件零测试；模态弹窗不是真模态；图标 5 套来源；排版 token 有接口无人用；附 1 条被证伪的他人论断
updates: [docs/KNOWN-ISSUES.md, docs/BENCHMARK-editing-experience.md]
---

# UI/UX 与前端规范巡检报告（2026-10-17）

> **基准**：solo v1.2.60 · 分支 `master` · 工作区（会话起步 HEAD `909061f`；仓库配了 content filter，工作树洁净度未采集）
> **范围**：① 前端规范/框架/结构稳定性 ② UI 与图标（含编辑器段距等排版）③ 顺带发现的 bug / 僵尸代码 / 冗余
> **性质**：只排查，未改任何文件。行号均为本次实际打开核对过的行；未复核项已在 §六 标明。

---

## 〇 · 一页看懂

**底子比预期好**：全仓无死组件文件、无 `v-html`、无 `@ts-ignore`、无裸 `invoke`（被 lint 硬拦）、Tailwind 尺寸/颜色全部转发到 `--*` 变量（单一真源）、8 套主题对比度实测达标、`prefers-reduced-motion` 已全局关停、highlight.js / mermaid / KaTeX 三方配色都吃主题。**这不是一个烂尾的前端。**

**拉分的是三件事**，都是他每天用都会碰到的：

| # | 一句话 | 他现在能感觉到的 |
|---|---|---|
| 1 | 设置弹窗**不是真模态** | 打开设置时顶部 48px 标题栏还亮着、还能点；按 Esc 关不掉 |
| 2 | **图标没有统一来源** | 工具条里并排的图标笔画粗细不一样；部分图标在中文 Windows 有变豆腐块风险 |
| 3 | **代码块字号被焊死 13px** | 把正文字号调到 20px，正文变大了，代码块还是 13px |

严重度分布：**P1 4 条 / P2 8 条 / P3 7 条**。最贵的不是 bug —— 没找到用户能触发的确证 bug —— 而是「两个最大的编排组件零测试」+「排版 token 有接口但没人接」。

---

## 一 · 前端规范 / 框架 / 结构稳定性

**判断：稳，不是漂。** 但有三处结构性风险。

### [P1] 依赖方向被打反：下层反向 import Editor 内部（11 处，实测）

真理源在 `src/components/Editor/**`，却被 `utils` / `composables` / `App` 反向引用：

| 引用方 | 被引的 Editor 内部 | 行 |
|---|---|---|
| `src/utils/markdown-to-html.ts` | `Editor/tiptap/markdown/plugins/frontmatter` | :18 |
| `src/composables/useEditorSync.ts` | `editor-metadata` / `markdown/serializer` / `document-scale` | :9-11 |
| `src/composables/useDocumentSession.ts` | `Editor/document-scale` | :21 |
| `src/composables/useAppWindowSession.ts` | `tiptap/extensions/wikilink-drop` | :5 |
| `src/composables/useAppEditorState.ts` | `tiptap/editor-metadata`（type） | :4 |
| `src/composables/useFloatingListMenu.ts` | `tiptap/editor-extensions`（type） | :2 |
| `src/App.vue` | `Editor/document-scale` 等 | :35 |

**代价**：`tiptap/` 目录内任何改名或搬文件，波及面直接打到 App 和 utils；Editor 事实上变成全局底层，无法独立复用或替换。`useEditorAppearance.ts` 本身就躺在 `src/components/Editor/tiptap/` 里（:50/:63），一个 composable 住在编辑器内核目录，归属层错位。

### [P1] 两个最大的编排壳，一行测试都没有

- `src/components/Editor/MarkdownEditor.vue` **964 行**、约 9 类职责（互链跳转、拖拽落点换算、阅读位置落盘/恢复、切文档 watch、BubbleMenu rAF 定位、表格右键菜单、单元格复制压平、图片拖拽上传、懒初始化）。
- `src/App.vue` **654 行**（已下沉到 7 个 composable，比 Editor 壳健康）。
- `vitest.config.ts` `include: ['src/**/__tests__/**/*.spec.ts']`（:14 区段）+ coverage 清单只列 `.ts`，**不含任何 `.vue`** —— 组件层没有任何机器兜底，回归只能靠他手点。

### [P2] 状态机制并存 4 套

Pinia（`stores/file.ts:66` 脏标记唯一权威，健康）+ 模块级单例缓存 8 处 + Tauri 事件 + **裸 window 自定义事件**。最后这套是第四真理源，且已有一条空转（见 §四 D-1）。另外 `--mk-font-size` / `--mk-line-height` 有**两条写入路径**：`stores/settings.ts:279-283`（切主题后重放）与 `Editor/tiptap/useEditorAppearance.ts:50,63`（设置页 watch）—— 同源同值，目前不打架，但任一侧改动就出现漂移。

### [P2] copy 与 paste 分属三层

`MarkdownEditor.vue`（复制）、`useAppDomEvents.ts:96`（document 级粘贴）、`tiptap/extensions/markdown-paste.ts`（编辑器内粘贴）。剪贴板出站/入站口径没有单一出口 —— 这条与 10-11 剪贴板外发线的台账同源，属已知在办。

### 已核验的良好项（不是客套，是他花的钱）

`invoke` 被 eslint 拦在 `client.ts`（`eslint.config.js:41-52`）；全仓 `any` 仅 4 处（集中在 `markdown-paste.ts`）；`v-for` 用稳定 key；NodeView AbortController 硬禁令 5/7 合规（`math-inline.ts:35` 用版本号比对替代，语义等价但违反字面规则，且 `nodeview-destroy.spec.ts` 只锁了 code-block 与 image 两个 —— 新 NodeView 漏 abort 不会被拦）。

---

## 二 · UI 与图标设计

### [P1] 设置弹窗不是真模态（三件事叠加，全部实测）

1. **被标题栏压在下面**：遮罩 `class="fixed inset-0 z-50 ..."`（`SettingsModal.vue:89`，Tailwind z-50）vs 标题栏 `position: fixed; z-index: 200`（`CustomTitlebar.vue:176`）。标题栏元素本身**没有 `v-if`**（:11-16，`v-if` 只挂在 12px 悬停触发条上），且 `titlebarVisible = (autoHide||focusMode) ? hovered : true`（:127-128）而 `titlebarAutoHide` 默认 `false`（`stores/settings.ts:53`）→ **常态下标题栏恒亮**：设置遮罩顶部漏出 48px 一条，标题栏按钮在"模态"里照样可点。
2. **Escape 实际不生效**：`@keydown` 挂在 `tabindex="-1"` 的遮罩上（`SettingsModal.vue:90-92`，处理函数 :76-80），但组件内**没有任何 `focus()` 调用**；点齿轮打开时焦点还在齿轮上。全局 Escape 处理链（`useAppDomEvents.ts:75-92`）只管全屏预览/图片查看/焦点模式，**不含关闭设置**；`settingsStore.closeModal()` 全仓只在 `SettingsModal.vue:52` 被调。→ Esc 关不掉设置。
3. **无 dialog 语义、无焦点陷阱**：全仓 `role="dialog"` / `aria-modal` 命中 **0 次**（含 `CommandPalette.vue:173-175`）；Tab 能从弹窗一路走回编辑器和标题栏。

### [P1] 图标没有统一来源 —— 视觉重量不齐的根因

实测图标来源 **5 套并存**：

| 来源 | 实测 |
|---|---|
| 组件库 | `src/components/icons/` 只有 **2 个**（CheckIcon / CloseIcon），全仓共 5 处引用 |
| 内联 SVG | **33 处 / 18 个文件**（`.vue` 26 处 + `.ts` 的 innerHTML 7 处：`code-block.ts` 3、`mermaid-block.ts` 2、`list-fold.ts` 1、`math-block.ts` 1） |
| 排版字符当图标 | `slash-commands.ts` 14 个（`¶ H1 • 1. ☐ ❝ ▎ <> — ⊞ ∑ ◈`），`☐ ⊞ ◈` 在中文 Windows 字体覆盖差，**易出豆腐块**；`BubbleMenu.vue:14-23` 的 `B/I/A/</>`；`mermaid-block.ts:65-68` 的 `+ − 1:1 ×` |
| 符号 | `ErrorBoundary.vue:7` 的 `⚠` |
| Tailwind 尺寸类 | `ImageFullscreenOverlay.vue:28` 的 `w-6 h-6` |

`package.json` 无任何图标库、无图标字体。**同一概念重复绘制**（已逐行核到）：
- **对勾**：`CheckIcon.vue:19` 的 `d="M5 13l4 4L19 7"` 与 `ThemeCard.vue:40` **同一条路径、同 sw 1.5 被重新内联一遍**（同目录已有组件不用）；另有 `code-block.ts:464`、`StatusbarQuickActions.vue:127`。
- **关闭 X / 复制 / 放大镜**各 3-5 份（`CustomTitlebar.vue:81`、`SearchPanel.vue:55-66`、`mermaid-block.ts:316`、`math-block.ts:75` 等）。
- **同一个 BubbleMenu 里笔画不齐**：link/bulletList 用 16/16 sw1.5（实渲染 1.5px，`BubbleMenu.vue:26/33`），清除格式用 24/24 sw2（实渲染 1.33px，:47）—— 并排就能看出粗细不同。

### [P1] 编辑器浮层按钮：只有悬停才显形，且热区偏小（实测）

`editor.css:717` 与 `:1102` 区段：`.mk-code-block-copy-button`、`.mk-block-delete-button`、`.mk-block-zoom-button` 都是 `opacity: 0`，只在祖先 `:hover` 时变 1（:724-726、:1109-1112），**这三类都没有 `:focus-visible` 规则** → 键盘 Tab 过去了也看不见。尺寸同时是 `width: 24px; height: 20px`（:709-710、:1094-1095、:1125-1126），高度低于 24px 舒适线。
反面范本也有：`popover-shared.css:13` 的 `.icon-btn`、`CustomTitlebar.vue:259` 的 44×48 都做得对。

### [P2] z-index 没有刻度，12 个离散值，还撞了两次

实测值：`2`（editor.css:864）、`20`（:850）、`50`（main.css:673 / `SettingsModal.vue:89`）、`100`（main.css:365/378）、`200`（CustomTitlebar.vue:176）、`300`（`BubbleMenu.vue:211`、`SearchPanel.vue:205`、`popover-shared.css:46`）、`400`（`App.vue:509`、`ContextMenu.vue:125`）、`600`（CommandPalette.vue:239）、`1000`（editor.css:1481）、`2000`（`ImageFullscreenOverlay.vue:20` 的 `z-[2000]`）、**`9999` 两处同值**（main.css:503 缩放手柄 / editor.css:1364 mermaid lightbox）、`10000`（main.css:576）。
`BubbleMenu.vue:210` 的注释已经在承认遮挡问题（"高于 CustomTitlebar(z-index:200)，避免第一行编辑时被顶部菜单栏遮挡"）—— 说明这条带子已经为让路打过补丁。焦点提示 400 与右键菜单 400 同值平局。违反自有铁律"定义 z-index 标度、不用魔法数"。

### [P2] 按钮没有共享实现：同一个按钮写了 3 遍

"32×32 幽灵图标按钮"三份：`popover-shared.css:9`（opacity .85）、`StatusbarQuickActions.vue:151`（.6）、`App.vue:631`（.6），差别只剩透明度。"小号文字按钮"另写 ≥8 遍（`BubbleMenu.vue:310/325`、`SearchPanel.vue:358`、`SettingsModal.vue:285/292`、`SaveSettingsPanel` 的 storage-path-btn、`AppearanceSettingsPanel` 的 settings-reset-btn、`AboutSettingsPanel:128`）。
表单控件反而健康：switch / range / select 各 1 个组件。

### [P2] 弹窗里最关键的三个按钮，悬停是箭头不是手型

`.settings-close-btn`（`SettingsModal.vue:232-239`）、`.settings-footer-reset`（:285-290）、`.settings-footer-done`（:292-300）三段样式都没有 `cursor: pointer`，元素本身是原生 `<button>`（:101/:159/:160）。**而 Tailwind v4（实装 `^4.3.0`）的 preflight 已不再给 button 加 `cursor: pointer`** —— 我直接查了 `node_modules/tailwindcss/preflight.css`，button 规则只剩 `font: inherit`（:238-244）与 `appearance: button`（:372-376），无 cursor。所以这三个按钮悬停确实显示箭头，而同项目几乎所有其它按钮类都手写了 `cursor: pointer`（如 `editor.css:715`）。

### [P3] 硬编码尺寸仍违反自有铁律（颜色已干净）

`.vue` 组件里 hex **0 处**（颜色层已彻底 token 化，这条铁律守得住）。残留的是尺寸/动效：`border-radius: 5px`（`SearchPanel.vue:362`，而 token 只有 3/4/8/10）、`4px`（:279/317/338、`CommandPalette.vue:364`、`editor.css:741`）、`3px`（`editor.css:716`）、`0.18s`×3（`SettingsSwitch.vue:34-36`）、`0.4s`×2（`App.vue:526-527`）、`duration-300`（`App.vue:396`）、`manager.ts` 里 JS 硬编码 `setTimeout(200)`/`220`。
遮罩配方 4 套并存：`bg-black/30 + blur-sm`（SettingsModal:89）、`--modal-overlay + blur(3px)`（CommandPalette:239）、`bg-black/90 + blur-md`（ImageFullscreen:20）、`--modal-overlay` 无模糊（editor.css:1368）。

---

## 三 · 编辑器排版实测（他点名的「段距」在这里）

### 实测数字（`src/components/Editor/tiptap/editor.css`，`--mk-*` 定义于 :33-65）

| 属性 | 实际值 | 出处 | 是否随字号缩放 |
|---|---|---|---|
| 正文字号 | 16px | :34 | —（基准） |
| 正文行高 | **1.7**（无单位） | :33 | 是 |
| **段距** | **1em**（=16px） | :36 → 应用 `p{margin: var(--mk-paragraph-spacing) 0}` :157 | **是**（em，跟着字号走） |
| 列表 ul/ol/li | `0.4em`/`0.4em`/`0.2em`，均按段距比例算 | :413/:419/:423 | 是 |
| h1 字号 / 段前段后 | 1.6em / `1.25em 0 0.6em` | :37 / :53 | 是 |
| h2 字号 / margin | 1.3em / `1em 0 0.5em` | :38 / :54 | 是 |
| h3 字号 / margin | 1.2em / `0.75em 0 0.4em` | :39 / :55 | 是 |
| h4-h6 字号 | 1.05 / 1.0 / 0.9em | :40-42 | 是 |
| blockquote | margin 1em、border 2px | :394 / :61 | 是 |
| **代码块 `pre`** | **font-size 13px（固定 px）**、lh 1.6、padding 12px 16px | :749 / :750 / :742 | **否** ← 唯一断点 |
| 行内 code | 0.875em | :605（未复核） | 是 |
| hr | margin 2em 0 | :647（未复核） | 是 |
| 阅读宽度 | `clamp(680px, 52vw, 960px)` | :65 | 否（按视口） |

**关于段距的两条结论，一条是好消息一条是坏消息：**

- 好消息：**段距体系本身是对的**。全用 em、列表和引用块都按段距比例推导、相邻 margin 折叠协调；而且标题段前距在 10 月已被他本人打回过一次 —— `editor.css:49-52` 的注释写着旧值 `h1 2.4em ≈ 1.4 行` 让他觉得"像多打了空行"，已收敛到 `1.25em`（台账 §二 #30）。**所以"把段距调大"这类建议要他亲测手感再定，我不当作缺陷报。** 行高 1.7 对 CJK 偏紧、段距 1em 略挤，属口味级，改前先给样张。
- 坏消息：**代码块是被焊死的孤岛**。`pre{font-size: 13px}`（:749）+ 数学/mermaid 编辑框 13px + 表格单元格 padding 固定 px，字号调到 20px 时正文 20px、代码仍 13px。建议 `13px → 0.8125em`（等效 16px 下 13px），断点即消。

### [P2] 排版 token「有接口、无人接」+ 文档已漂移（本次最结构性的发现）

- `src/themes/types.ts:117-170` 定义了 **ThemeTypography 共 27 个可选字段**（行高/字号/段距/6 级标题字号/6 级标题行高/6 级标题 margin/字间距/引用边框/高亮圆角），`themes/manager.ts:176-180` 也写好了到 `--mk-*` 的映射通道。
- 但 `src/themes/presets/` 里 **8 套预设声明 typography 的数量为 0**（grep `typography|lineHeight|paragraphSpacing` 在 presets 目录无命中）。→ 通道通着，没人发过货：换主题只换色，**排版完全不由主题决定**。
- 且 `types.ts` 的 JSDoc「默认值」和 `editor.css` 实测值**已经对不上**：lineHeight 写 1.9（实 1.7）、paragraphSpacing 写 0.75em（实 1em）、heading1Size 写 1.875em（实 1.6em）、heading1Margin 写 1.4em 0 0.6em（实 1.25em 0 0.6em）。这正是文档生命周期规则里判得最重的病：**过期但看起来很新**，会主动误导下一个照它实现的人（含未来的我）。

### [P2] 通用间距标度缺失（真正的 token 空洞）

颜色有约 100 个 token，圆角有 4 档（`main.css:128-131`），动效有 3 档（:27-30），排版有 `--mk-*`；**但没有任何 spacing scale**（grep `--space|--spacing` = 0）。所以 §二 里那批 `5px/4px/3px/0.18s` 散落值无处可归 —— 不是没人守规矩，是规矩里没有这一格。

---

## 四 · 顺带发现：僵尸 / 冗余 / 疑似 bug / 证伪

### D-1 [已证伪他人论断] `image-paste-warning` 是僵尸接线，但**不是**静默失败

四路巡检里有一路报"全仓无 `dispatchEvent`，故粘贴图片失败静默无声"。**前半句成立，后半句被我把原文开坏了**：
- 成立：`useAppDomEvents.ts:97` 注册、`:104` 摘除，全仓（含 src-tauri）只有这两行 + 一份归档文档提及该事件名，**没有任何派发方** → 处理函数 `:41-45` 永不执行。
- 不成立：编辑器**内部**粘贴图片失败已有错误弹窗 —— `markdown-paste.ts:617-620` 是 `message(粘贴图片失败：…, {kind:'error'})`，前置条件不满足时 :624-627 还有 warning 确认框；**编辑器外部**的粘贴由 `useAppDomEvents.ts:26-38` 的 onPaste 直接调 `showImagePasteWarning`。→ 用户不会静默吃亏。
- 结论定级：P3 僵尸代码（一条永远不响的门铃），不是 P2 bug。**不必修，但可以从 KNOWN-ISSUES 候选里划掉。**

### D-2 [P2] 仓库根产物：`.gitignore` 声明了，却仍在 git 跟踪里（实测 `git ls-files`）

| 路径 | tracked | .gitignore | 判定 |
|---|---|---|---|
| `outputs/` | **12** | 第 93 行已列 `outputs/` | 声明却没 `git rm --cached` → 忽略规则形同虚设 |
| `design-samples/` | **6** | 第 77 行已列 | 同上，agent 样机不该入库 |
| `solo_1.2.22_x64-setup.sig` | **1** | 第 85 行已列 | **且版本陈旧**：文件名 1.2.22，`package.json` 实为 **1.2.60** → 留着会误导签名核对 |
| `icons/`（根） | 6 | 未列 | 与构建真正使用的 `src-tauri/icons/` 重复；根 `icons/` 在 scripts/docs/vite/package/index.html 无引用 → 疑似源图存档 |
| `website/` | 2 | 未列 | 未被构建/脚本引用 → 疑似孤儿站点稿 |
| `dist/` | **0** | 已忽略 | 健康，正面对照 |

### D-3 [P3] 代码侧僵尸（整体极干净，只有零星）

- `main.css:131` 的 `--radius-xl: 10px` **全仓无 `var()` 消费者** → 唯一真死变量。
- JS 依赖 `@tauri-apps/plugin-clipboard-manager`（`^2.3.2`）在 `src` 内 **0 处 import**；剪贴板实际走 `services/tauri/clipboard.ts` + Rust arboard。移除前需确认 Rust 侧 crate（`src-tauri/src/lib.rs` 仍注册插件）。
- `manager.ts:297 getPresetTheme()` 仅测试引用，生产无调用。
- 正面基线（值得知道）：生产代码 `console.log` = 0、TODO/FIXME/HACK = 0、无 >5 行注释掉的代码、src 内 33 个 `.vue` **零未引用文件**、devDependencies 全被脚本引用。

### D-4 [P3] 重复实现两处（长期项，不是现在）

- **debounce 两套**：`lodash-es` 的 `debounce`（`useEditorSync.ts`、`useEditorSearch.ts`）vs 手写 `setTimeout`+`clearTimeout`（`MarkdownEditor.vue:401/437`、`ime-anchor.ts:144/181`）。
- **Markdown→HTML 双管线**：权威是 `tiptap/markdown/parser.ts`+`serializer.ts`；`utils/markdown-to-html.ts` 只被 `StatusbarQuickActions.vue:85` 用，头注释自述已降级为回落出口 —— 属已定取舍，勿当新账提。

### D-5 bug 侧结论：**没有找到用户能实际触发的确证 bug**

保存/自动_save_竞态三重闸（`useDocumentSession.ts` 的 `isSaving`+`_savePromise`+`reloadToken`）、监听器摘除、`localStorage` try/catch（`themes/manager.ts:234`）、Windows 路径正反斜杠归一（`wikilink-drop.ts:21`）都已被反复加固。
唯一留档的一条**脆弱写法**（非现网 bug）：`saveCurrentDocument` 冲突分支在 IIFE 内 `_savePromise = null; return saveCurrentDocument(true)`，当前靠 `await` 恰好正确，后续改动易回归。

### D-6 [P3] 132 条 lint 警告 / 0 error，CI 不拦（子代理实测，我未复核）

`.github/workflows/test.yml` 无 `--max-warnings`；96 条是 `vue/html-indent`、10 条 `no-console`。根因：`eslint.config.js` 没 extends 已装的 `@vue/eslint-config-prettier`，与 `.prettierrc` 双头 —— 格式规则两套说了算，这类警告清了也会长回来。

---

## 五 · 建议的处理顺序（**未执行，等拍板**）

按「他手上的体感 ÷ 改动风险」排：

1. **把设置弹窗做成真模态** —— z-index 定一版刻度（SettingsModal 提到标题栏之上）+ `role="dialog"`/`aria-modal` + 打开即 focus + 焦点陷阱 + Esc 兜底。改 2 个文件，体感立刻可见。
2. **代码块 `13px → 0.8125em`（editor.css:749）+ 修 types.ts 排版默认值漂移 + 字号写入收敛成一条路径** —— 一行 CSS 加一次文档同步，把"调到 20px 代码还是 13px"这个断点消掉。
3. **图标建唯一出口** —— `src/components/icons/` 补齐 12 个 24×24 / sw 1.5 组件，替换 33 处内联与 `slash-commands.ts` 的 14 个字符图标。一次同时修掉笔画不齐、重复定义、豆腐块风险。
4. **hover-only 按钮补 `:focus-visible`、热区 20 → 24/28** —— editor.css 三处 + ThemeCard 一处。
5. **仓库根产物 `git rm --cached`**（outputs / design-samples / 陈旧 .sig）—— 纯元数据、零代码风险，但属仓库对外状态改动，**要他点头我才动**。
6. **拆 MarkdownEditor.vue + 给组件层上测试** —— ≥3 步、要排期，且属于"做错不影响结论"以外的高成本项，放最后。

---

## 六 · 核验说明（诚实边界）

- **我逐行开过原文**：§一 全部行号与 11 处反向 import、§二 的 SettingsModal/CustomTitlebar/z-index/cursor/CheckIcon 重复/图标来源计数、§三 的 editor.css 全部数字、`types.ts:117-170`、presets 无 typography、§四 D-1/D-2/D-3 与 Tailwind v4 preflight（查的是 `node_modules/tailwindcss/preflight.css` 本体）。
- **来自并行巡检、我未逐条复核**（用到前先复验）：§二 的 SearchPanel 遮顶带、BubbleMenu 图标具体像素、按钮类族"约 30 个"、§三 的行内 code/hr/表格 padding 行号、§四 D-5 保存分支细节、D-6 的 132 条警告数、以及"对比度 8 套全达标（muted 最低 4.71）"—— 后者我按对方给的两色复算过方向一致，但没逐套重跑。
- **口味级、需他亲测**：行高 1.7→1.8、段距 1em→1.15em、标题级差改模数 1.25。这三条我不写进任何"待修"，因为他 10 月刚把标题段距**往小**打回过一次（`editor.css:49-52`）。

---

## 七 · 需要他拍板的三件事

1. **段距/行高要不要动**：技术上能调，但他上次的手感结论是"别空出一行"。要动的话我先出 A/B 两张样张给他看，不直接改。→ 回「要样张」/「不用」。
2. **图标走哪条路**：自建 12 个组件（不加依赖，改动可控）vs 引入图标库（要装依赖，属高危动作，得他批准）。→ 我推荐**自建**。
3. **MarkdownEditor.vue 那 964 行拆不拆**：拆是纯重构、不碰 parser/serializer 内核，但要排期补测试；不拆就是接受每次动编辑器都在 964 行里找。→ 我推荐**先不拆，只给它补组件级测试**，等下一次真动到它时顺手拆。
