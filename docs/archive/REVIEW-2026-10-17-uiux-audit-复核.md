---
title: 复核：Qoder《UI/UX 与前端规范巡检报告 2026-10-17》
type: report
audience: maintainer
status: active
tags: [复核, UI, UX, 审计, 行号核销]
summary: 对 Qoder UI/UX 巡检报告（同目录 AUDIT-UIUX-2026-10-17.md）的独立复核——40+ 条断言逐条对代码取证。总评：数据可信度高（行号抽查全部精确，lint 132/96/10、any=4、对比度 4.71 等关键计数逐字命中）；发现 2 处事实性偏差（z-index 漏 201；「唯一真死变量」实为 12 个零消费变量）+ 6 处轻微口径/计数偏差。未改任何代码。
---

# 复核：Qoder《UI/UX 与前端规范巡检报告》（2026-10-17）

> **复核对象**：[`AUDIT-UIUX-2026-10-17.md`](./AUDIT-UIUX-2026-10-17.md)（同目录）
> **复核方式**：逐条对代码取证 —— 读行 / grep / 实跑 `npm run lint` / 脚本复算（对比度、CSS 变量消费、未引用 .vue 扫描）。**未改任何代码。**
> **结论先行**：**该报告的原始数据可信度高，可以拿来做决策** —— 抽查的 40+ 处行号引用**全部命中**，多处关键计数与实测**逐字一致**。发现的偏差集中在统计口径与两处事实边角，**均不推翻其任何一条结论**。

---

## 〇 · 总评

| 维度 | 复核结果 |
|---|---|
| 行号精确度 | 抽查 40+ 处，**全部命中**（含 `SettingsModal.vue:89/:90-92`、`CustomTitlebar.vue:176/:127-128`、`BubbleMenu.vue:26/33/47`、`editor.css` 排版全部数字、`useAppDomEvents.ts:97/104`、`SearchPanel.vue:279/317/338/362` 等） |
| 关键计数 | **完全一致**：`npm run lint` = **132 problems (0 errors)**、96 × `vue/html-indent`、10 × `no-console`、`any` = 4、icons 组件 = 2、对比度 muted 最低 = **4.71**（8 套全复算） |
| 事实性偏差 | **2 处**：① z-index 普查漏 `201` ⇒ 实为 **13** 个离散值；② D-3「`--radius-xl` 唯一真死变量」⇒ 实测 **12** 个零消费变量 |
| 轻微口径/计数 | 6 处（见 §三 对照表），均为小账，不影响条目结论 |
| 其自述「未复核」项 | 已独立补证 4 项（BubbleMenu 像素 ✓ / 行内 code·hr 行号 ✓ / 对比度 ✓ / D-6 lint 数 ✓）；余 2 项保持抽样状态 |

---

## 一 · 逐条核销

### §一 前端规范 / 框架

| 断言 | 判定 | 取证 |
|---|---|---|
| 依赖方向被打反（反向 import） | ✅ 成立（**唯一要更正的是计数口径**） | 表列 7 行行号**全部精确**：`markdown-to-html.ts:18`、`useEditorSync.ts:9/10/11`、`useDocumentSession.ts:21`、`useAppWindowSession.ts:5`、`useAppEditorState.ts:4`、`useFloatingListMenu.ts:2`、`App.vue:35` 逐行命中。计数：表列 = **9 条 from-import**（utils/composables 8 条 + App:35）；「11 处」以任何口径都凑不出（含 App 直引组件 :15/:16/:19 = 12 条，再加 :37 动态 import = 13 条）。建议口径改为 **8 条 = utils/composables 反向引用**（App→Editor 属正常组装，不算"反"） |
| `useEditorAppearance.ts` 在 Editor/tiptap、:50/:63 双写 | ✅ 事实成立 | :50 写 `--mk-font-size`、:63 写 `--mk-line-height`，逐行命中；"归属层错位"属主观判断（可议：它管的正是编辑器外观，放编辑器目录也自洽） |
| MarkdownEditor.vue 964 行 / App.vue 654 行 / 零测试 | ✅ 成立 | `wc -l` = 964 / 654 精确；`vitest.config.ts:14` `include: ['src/**/__tests__/**/*.spec.ts']` + coverage 清单只列 `.ts`（无 `.vue`）逐行命中 |
| 状态机制 4 套 + 字号/行高两条写入路径 | ✅ 成立 | `stores/file.ts:66`（syncEditedContent）、`settings.ts:279-283` 重放块、`useEditorAppearance.ts:50/63` watch —— 全部命中；"模块级单例 8 处"未逐个数（宽泛口径） |
| copy 与 paste 分属三层 | ✅ 基本成立 | `MarkdownEditor.vue:346/666-708`（复制相关）、`useAppDomEvents.ts:96`（document 级粘贴）、`markdown-paste.ts`（编辑器内）。细化：出站侧已有唯一出口 `clipboard-html.ts`（CP-20261011-002 收口）——"分三层"更准的描述是"三个环节、两条链路" |
| 良好项：invoke 被 lint 拦 / any=4 / NodeView 5/7 | ✅ 成立 | `eslint.config.js:38-52` 机器锁（invoke + replaceAll）命中；`any` 全仓 **4 处**（markdown-paste ×3 + markdown-to-html:32，逐字命中）；addNodeView 共 **7 个**，带 AbortController 的 **5 个**（callout/code-block/image/math-block/mermaid-block）精确；`nodeview-destroy.spec.ts` 只覆盖 code-block + image 精确 |

### §二 UI 与图标

| 断言 | 判定 | 取证 |
|---|---|---|
| **设置弹窗不是真模态（三连）** | ✅ 成立 | ① 遮罩 `z-50`（`SettingsModal.vue:89`）+ 标题栏 `z-index: 200`（`CustomTitlebar.vue:176`）、标题栏无 `v-if`（:11-16，v-if 只在 :4 的 12px 触发条）、visible 逻辑 :127-128、`titlebarAutoHide` 默认 false（`settings.ts:53`）——全部命中；#app 无层叠上下文 ⇒ z 可直接比较，结论有效。② Esc：handler 挂 :90-92 遮罩、无 focus() 调用、全局链（`useAppDomEvents.ts:75-92`）不含设置、`closeModal()` 全仓唯一调用点 = `SettingsModal.vue:52` —— 命中。**补充 nuance**：点击弹窗内任一可聚焦控件后，Esc 事件会冒泡到遮罩而**生效**；"打开即按 Esc"主路径确实失败。③ `role="dialog"`/`aria-modal` 全仓 **0 命中** ✓ |
| 图标 5 套来源 | ✅ 成立（计数微差） | icons 目录 = 2 个 ✓、实际引用 5 处 ✓、内联 SVG：**.vue 25 处 / 13 文件 + .ts 7 处 / 4 文件 = 32 处 / 17 文件**（报告 33/18，各多 1）；slash-commands **14 个**字符图标 ✓（¶ H1 H2 H3 • 1. ☐ ❝ ▎ <> — ⊞ ∑ ◈）；BubbleMenu B/I/A/`</>` ✓、mermaid `+ − 1:1 ×` :65-68 ✓、`⚠` ✓；对勾重复 ✓（`CheckIcon.vue:19` 与 `ThemeCard.vue:40` 同 path 同 sw1.5）；BubbleMenu 笔画不齐 ✓✓（:26/:33 sw1.5 vs :47 viewBox24+sw2 ⇒ 实渲染 1.33px，行号精确） |
| 浮层按钮 hover-only + 热区小 | ✅ 成立 | `editor.css:717/:1102` opacity:0、:724-726 / :1110 区 hover 揭示、尺寸 24×20（:709-710 / :1094-1095 / :1125-1126）全部**逐行命中**；`focus-visible` 全 editor.css **0 处**（比其"这三类没有"更强）；`focus-within` 亦为 0（补充）；反面范本 `popover-shared.css` .icon-btn 32×32 ✓、`CustomTitlebar.vue:259` 44×48 ✓ |
| z-index 12 个离散值、撞两次 | ⚠️ **漏 1 个（→13 个）** | 其列 12 值**逐行全部复现**（2/20/50/100/200/300/400/600/1000/2000/9999/10000）；**漏 `201`**（`CustomTitlebar.vue:378` 悬停触发条）；同值关系也更多：**5 组**（50×2 / 100×2 / **300×3** / 400×2 / 9999×2），其只标了 2 处；`BubbleMenu.vue:210` 注释命中 |
| 按钮三份 + cursor | ✅ 成立 | `.icon-btn` opacity .85（:19）、Statusbar .6、App .6 全部命中；小号文字按钮 ≥8 处（抽查 BubbleMenu:310/:325 精确）。cursor：三个按钮块确无 `cursor: pointer` ✓；**Tailwind v4.3 preflight 核查与我一致**（`node_modules/tailwindcss/preflight.css`：:238-244 `font: inherit`、:372-376 `appearance: button`、全文件无 cursor:pointer）✓✓；对照 `editor.css:715` ✓ |
| 硬编码尺寸清单 | ✅ 成立 | `SearchPanel.vue:362`(5px)/:279/:317/:338(4px)、`CommandPalette.vue:364`、`editor.css:741`/:716(3px)、`SettingsSwitch.vue:34-36`(0.18s×3)、`App.vue:526-527`(0.4s×2)/:396(duration-300)、`manager.ts:253`(200)/`:292`(220) —— 全部命中 |

### §三 编辑器排版

| 断言 | 判定 | 取证 |
|---|---|---|
| editor.css 全部排版数字 | ✅ 成立（**逐行精确**） | 1.7@:33、16px@:34、1em@:36、h1-h3 字号/margin@:37-39/:53-55、h4-h6@:40-42、blockquote@:394 + :61、列表 @:413/:419/:423、行内 code 0.875em@:605（其自述未复核，已补证 ✓）、hr 2em@:647（已补证 ✓）、pre padding@:742 / 字体 13px@:749 / lh 1.6@:750、阅读宽 clamp@:65、"h1 2.4em 打回"注释@:49-52 —— 全部命中 |
| 代码块 13px 是唯一断点 | ✅ 成立（可再精确） | **补充**：全仓 13px 共 **9 处**——内容层 3 处（pre:749、math textarea:1046、mermaid textarea:1182）= 真正要修的断点；其余 6 处为 UI（两个占位 :1026/:1162 + slash 菜单 :1531/:1543/:1559/:1566），不随字号缩放属合理。表格单元格 `padding: 6px 12px` 固定（:825-832）✓ |
| ThemeTypography 27 字段 + presets 0 声明 + 映射通道 | ⚠️ 字段数 26（其余成立） | `awk` 计 `?:` = **26**（其写 27）；presets 8 文件 grep typography/lineHeight/paragraphSpacing = **0** ✓；`manager.ts:175` 起 TYPOGRAPHY_VAR_MAP ✓ |
| types.ts JSDoc 与实测值漂移 | ✅ 成立（**且更广**） | 其列 4 项全中；**实测至少 15 项漂移**：lineHeight 1.9→1.7、letterSpacing 0.02em→0、paragraphSpacing 0.75→1em、h1Size 1.875→1.6、h2Size 1.5→1.3、h3Size 1.25→1.2、h4Size 1.1→1.05、h1-h6 margin 六项全漂（1.4/1.2/1/0.8/0.6/0.6 → 1.25/1/0.75/0.6/0.5/0.5）、h1/h2 letterSpacing 0.04/0.03em → -0.02/-0.01em。（h5/h6 字号、六项行高、quoteBorderWidth、markBorderRadius 一致） |
| 无 spacing scale | ✅ 成立 | `--space` / `--spacing` 全仓 0 命中 |

### §四 僵尸 / 冗余 / 疑似 bug / 证伪

| 断言 | 判定 | 取证 |
|---|---|---|
| D-1 `image-paste-warning` 僵尸但非静默失败（证伪他人） | ✅ **证伪链完全成立** | 注册 :97 / 摘除 :104、全仓（含 src-tauri/docs）无派发方（仅剩两行 + 两份归档文档提及）✓；`markdown-paste.ts:617-620` error 弹窗 ✓、:624-627 warning 确认框 ✓、`useAppDomEvents.ts:26-38` onPaste 兜底 ✓。结论"P3 僵尸、非 bug"同意 |
| D-2 仓库根产物 tracked | ✅ 成立（**逐字精确**） | `git ls-files`：outputs=**12** / design-samples=**6** / sig=**1**（1.2.22 版，现 1.2.60 ✓）/ icons/=6 / website/=2 / dist=**0**；`.gitignore` :77/:85/:93 三行精确；root icons/ 与 website/ 在 package.json/vite/scripts/index.html 均无引用（抽查范围） |
| D-3 `--radius-xl` **唯一**真死变量 | ❌ **「唯一」不成立 → 实测 12 个** | 全 src 三通道扫描（字面 `var()` + Tailwind 类名 + JS `getPropertyValue`）：**12 个零消费变量** —— `--btn-ghost-bg / --cancel / --code-border / --discard / --info-bg / --radius-xl / --save / --shadow-lg / --shadow-xl / --success-bg / --tag-bg / --tag-color`。分类：8 个在 `types.ts` 主题契约表里挂着（渲染侧从不用）；4 个（radius-xl / save / cancel / discard）连契约都没有。`--radius-xl` 本身确无消费者 ✓（Tailwind `rounded-xl` 有映射但类名零使用） |
| D-3 其余（plugin / getPresetTheme / 正面基线） | ✅ 成立 | `@tauri-apps/plugin-clipboard-manager` src 内 0 import ✓、`lib.rs:294` 仍注册 + Cargo.toml 依赖在 ✓（移除前须一并处理，其提醒正确）；`getPresetTheme` 仅测试引用 ✓；`console.log`/TODO/FIXME/HACK = **0** ✓；33 个 .vue **零未引用**（脚本扫描 33/0）✓ |
| D-4 debounce 两套 + 双管线 | ✅ 成立 | lodash：`useEditorSync.ts:2`、`useEditorSearch.ts:2`（后者在 `tiptap/` 下）；手写：`MarkdownEditor.vue:401/437`、`ime-anchor.ts:144/181` —— 命中 |
| D-5 无确证 bug + 一条脆弱写法 | ✅ 成立（结论类，抽查） | `useDocumentSession.ts:274-275` 找到 `_savePromise = null; return saveCurrentDocument(true);` 分支本体；"无确证 bug"属结论性判断，未逐条推翻 |
| D-6 132 条警告 / 0 error | ✅ **逐字精确** | `npm run lint`（= `eslint src/`）实测 **132 problems (0 errors, 132 warnings)**；规则分布 **96 × vue/html-indent + 10 × no-console**（完全一致）+ 7 any / 5 attributes-order / 5 unused-vars / 5 multiline…；CI `test.yml:26` 无 `--max-warnings` ✓；`@vue/eslint-config-prettier@^10.2.0` 已装（package.json:69）但 eslint.config.js 未引用 ✓；`.prettierrc` 存在 ✓。（注：直接 `npx eslint .` 会扫进 dist 产物得 2.7 万假问题，必须用项目脚本口径） |

---

## 二 · 其自述「未复核」项的独立补证

| 项 | 补证结果 |
|---|---|
| 对比度 8 套全达标（muted 最低 4.71） | ✅ **复算一致**：muted/bg 最低 = default-light **4.71**（8 套区间 4.71–6.27：cinnabar-dark 5.37 / cinnabar-light 5.53 / default-light 4.71 / elegant 5.42 / jade 5.30 / orchid 6.27 / scholar-dark 5.73 / scholar-light 5.68）；text/bg 全 ≥12.98 |
| §二 BubbleMenu 图标具体像素 | ✅ 行号与像素全部精确（见 §二 表） |
| §三 行内 code / hr 行号 | ✅ :605 / :647 命中 |
| D-6 的 132 条警告数 | ✅ 逐字一致（含规则分布） |
| §二 SearchPanel「遮顶带」 | ✅ 方向性复核：SearchPanel `z-index: 300`（:205）> 标题栏 200，不存在被标题栏遮挡问题 |
| 按钮类族「约 30 个」/ D-5 细节全链 | ⏸ 保持抽样状态（未逐条数） |

---

## 三 · 偏差对照表（全部 8 处）

| # | 报告说 | 实测 | 性质 |
|---|---|---|---|
| 1 | z-index **12** 个离散值 | **13** 个（漏 `201`，`CustomTitlebar.vue:378`）；同值 5 组非 2 处 | 漏项 |
| 2 | `--radius-xl` 是「**唯一**真死变量」 | **12 个**零消费变量（三通道扫描） | 低估 |
| 3 | ThemeTypography「**27** 个字段」 | **26** 个 | 计数 |
| 4 | 图标「**33** 处 / **18** 文件」 | **32** 处 / **17** 文件（.vue 25/13 + .ts 7/4） | 计数 |
| 5 | 反向 import「**11** 处」 | 表列 **9** 条；全量 12–13 条（视口径），"11"不可复现 | 口径 |
| 6 | 严重度「**4 / 8 / 7**」 | 正文标题 **5 / 8 / 5**（+D-1 裸写 P3 共 5） | 内部小账 |
| 7 | math-inline「**违反字面规则**」 | 该 NodeView **无任何监听器**（禁令不适用）；版本号守护恰是禁令"异步回写查 aborted"的等价实现 ⇒ 表述可商榷（其"语义等价"判断本身正确） | 表述 |
| 8 | types 漂移列 **4** 项 | 实际 **≥15** 项（清单见 §三） | 不完整（非错） |

---

## 四 · 复核边界（诚实声明）

- **未覆盖**：模块单例"8 处"精确数、"v-for 稳定 key"逐条、按钮类族约 30 个计数、D-5 保存竞态的完整推演、highlight.js/mermaid/KaTeX 主题化、prefers-reduced-motion"全局"程度、SearchPanel 完整视觉链。以上沿用报告原判或保持其自述的"未复核"状态。
- **判定尺度**：本复核只对**可核事实**（行号、计数、存在性、行为逻辑）给"成立/不成立"；对**设计判断**（"P1/P2 合理吗"、"归属层错位"）只标注其事实基础真伪，不替决策。
- **环境**：复核基于 `fac3a58`（本日 4 个提交后）；Qoder 报告基于 `909061f`——其间 `editor.css / main.css / FontPopover.vue` 等 18 文件有字体域改动，但其引用的 Editor 排版与 UI 行号**不受影响**（已逐条复验）。
