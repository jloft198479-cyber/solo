---
title: 复核之复核：对 WorkBuddy《UI/UX 巡检复核 2026-10-17》的逐条取证（2026-10-17）
type: archive
audience: both
status: archive
doc-life: frozen
review-by: —
owner: 简乐
tags: [复核, 审计, 行号核销, Tailwind, CSS变量]
summary: WorkBuddy 8 条偏差里 5 条成立（含抓到我两处真错）、2 条它自己算错、1 条口径可议；另发现我们俩都漏的死配置 tailwind.config.js；原报告需更正 7 处，产品结论一条不倒
updates: [docs/archive/AUDIT-UIUX-2026-10-17.md, docs/archive/REVIEW-2026-10-17-uiux-audit-复核.md]
---

# 复核之复核：WorkBuddy 复核件的逐条取证（2026-10-17）

> **被审对象**：`REVIEW-2026-10-17-uiux-audit-复核.md`（WorkBuddy 出品，08:08）· 上游为 `AUDIT-UIUX-2026-10-17.md`（我的巡检报告，07:56）
> **本文规则**：两份原件**一个字没动**（档案区写完即冻结），所有更正集中在本文；要落到原报告需另点头。
> **基准**：HEAD `800eb55` · 工作树 · 2026-10-17。取证方式 = 逐行开原文 + grep 复算 + 查 `node_modules/tailwindcss/preflight.css` 与构建管道本体。

---

## 〇 · 结论先行（三句话）

1. **WorkBuddy 这份复核可以采信**：它抽查的 40+ 行号确实全中，我原报告的数据盘子没塌，**没有任何一条 P1/P2 结论被推翻**。
2. **它抓到我的两处是真错，我认**：z-index 漏了 `201`（更难看的是——那一行就在它上一轮我自己贴出的 grep 结果里，是我抄漏的）；图标计数把 `src/assets/vue.svg` 当成内联图标算了进去。另有 4 处计数/表述它比我准。
3. **但它自己有两处算错，还漏了一件我们俩都该发现的问题**：它数的「12 个零消费变量」里 **3 个根本不是 CSS 变量**（是 `.unsaved-btn--save` 这类 BEM 类名，它恰好踩了第一轮巡检明确排除过的那个假阳性）；而真正的雷是 —— **`tailwind.config.js` 是从未接线的死配置**（详见 §三），这条我原报告判断反了，它也没查。

---

## 一 · 它对我原报告的 8 条偏差，逐条裁定

| # | 它的裁定 | 我复验到 | 判定 |
|---|---|---|---|
| 1 | z-index 12→**13** 个，漏 `201`（`CustomTitlebar.vue:378`） | 该文件 :378 确有 `z-index: 201`，且在我上一轮的 grep 输出里已打印出来 | ✅ **它对，我错** |
| 2 | 「唯一真死变量」→ **12 个**零消费变量 | 真数是 **9 个**：`--btn-ghost-bg --code-border --info-bg --success-bg --tag-bg --tag-color --shadow-lg --shadow-xl --radius-xl`（声明处 `main.css:98/107/108/113/119/124/125/131/153` + 深色重声明 :221-270，消费侧 `var()`、Tailwind 类名两条通道**均 0 命中**）。它列的 `--save / --cancel / --discard` **不存在**——匹配到的是 `main.css:627/636/646` 的 `.unsaved-btn--save` 等 BEM 类名和 `useAppWindowSession.ts:58-60` 的按钮 class | ⚠️ **方向对、数字错**：我的「唯一」确实错，但它多算了 3 个假阳性 |
| 3 | ThemeTypography **26** 字段（我写 27） | 逐项开 `types.ts:117-170`：4（正文）+6（标题字号）+6（标题行高）+6（标题 margin）+2（字间距）+1+1 = **26** | ✅ 它对 |
| 4 | 图标 **32 处 / 17 文件**（我写 33/18） | 我的 grep 把 `src/assets/vue.svg` 这个文件本体算成 1 处内联 SVG；扣掉即 32/17 | ✅ 它对，原因已定位 |
| 5 | 反向 import「11 处」不可复现，表列 9 条 | 实测生产代码 **9 条**（utils 1 + composables 7 + `App.vue:35` 1），其余命中在测试文件里。"11" 是上游子代理口径，我没复核就写进正文 | ✅ 它对，我抄漏核 |
| 6 | 严重度小账「4/8/7」对不上正文 | 我原报告带标签的小节实测 = **P1 5 / P2 8 / P3 4**；把 D-1 正文那句 P3 也算上 = 5/8/5，与它一致。首页「4/8/7」是我自己写错的汇总数 | ✅ 它对 |
| 7 | `math-inline` 不该判「违反字面规则」 | 开 `math-inline.ts:35-59`：`addNodeView()` 内**没有任何事件监听器**，禁令前提（监听器挂 AbortController）不适用；:39/:42/:47/:54 的 `renderVersion` 比对正是「异步回写查 aborted」的等价实现 | ✅ 它对，我表述过重 |
| 8 | types 漂移「≥15 项」（我只列 4 项） | 抽查它列的三条：`heading3Size` 注释 1.25em vs `editor.css:39` 实 1.2em ✓；`letterSpacing` 注释 0.02em vs `editor.css:35` 实 `0` ✓；`heading1LetterSpacing` 注释 0.04em vs `editor.css:59` 实 `-0.02em`（**符号相反**）✓ | ✅ 它对，且比我写得更狠 |

**小结**：8 条里 **6 条成立、1 条半对（数字错）、1 条（#2）它自己也算错**。它的总评「数据可信度高、不推翻任何结论」我复验后同意。

---

## 二 · 它两处需要点名的取证缺陷（不是挑刺，是同类错误会复发）

**① §二 那条「SearchPanel 方向性复核」答的是另一个问题。**
没有任何一方说"面板被标题栏挡住"；原话是"面板压住标题栏"。它验了 z-300 > z-200 便判"不存在遮挡问题"——**恰好把方向读反了**。我把机制重新开了一遍：

- `SearchPanel.vue:200-205` 是 `position:absolute; top:0; z-index:300`，挂在 `MarkdownEditor.vue:3` 的 `.editor-shell relative` 上；
- 全仓**没有任何 48px 留位**：`grep padding-top|--titlebar|48px` 在布局层 0 命中（`editor.css:13` 的 `padding: 72px 0 48px` 是正文上下呼吸区，不是让位）；标题栏 `CustomTitlebar.vue:169` 是 `position:fixed` → **脱离文档流，内容区从窗口 0px 起铺**；
- 反证在 WorkBuddy 自己引用的地方：`BubbleMenu.vue:100` 注释写「顶部菜单栏高度（CustomTitlebar 48px）+ 菜单自身高度约 44px + 缓冲，低于此阈值时向下翻转」—— 说明**标题栏那条带子本来就是浮在内容之上的**，才需要浮层给它让路。

⇒ 真实后果（比"遮挡"两个字具体）：`Ctrl+F` 一开，搜索面板盖住标题栏正中的品牌字与文件名（面板 420–520px 居中），并且盖住 `data-tauri-drag-region`（`CustomTitlebar.vue:17`）→ **查找状态下拖不动窗口**。而 `:212` 的 `border-top: none` 说明"贴顶"是有意设计，只是没给标题栏让位。定级 **P3（设计未让位，非 bug）**。

**② 它「环境」那段的因果链反了。**
它写"Qoder 报告基于 `909061f`，其间 18 文件有字体域改动，但行号不受影响（已逐条复验）"。前半句错：我的行号是 **07:35–07:55 现场读的**，而字体那批改动（`fac3a58`）的文件 mtime 是 `editor.css 07:05`、`main.css 07:27`，**都在我读取之前**；真正错的是我报告首页「基准」那行照抄了会话快照的 HEAD —— 那是我的标注错，不是我的取证错。结论两边一致（行号可用），但**理由是反的**：不是"改了很多但侥幸没影响"，而是"改动本就在我读之前"。这条要写清楚，否则下一个人会以为字体域改动和风险无关，跳过复验。

---

## 三 · 我们俩都漏的一条（原报告还判反了）：`tailwind.config.js` 是从未接线的死配置 [P2]

**管道实测**（三份文件本体都开过）：

- `postcss.config.js`：只挂了 `'@tailwindcss/postcss': {}`，**无任何 options**；
- `src/assets/styles/main.css:1`：只有一行 `@import 'tailwindcss';`，**全仓 `grep @config|@theme` = 0 命中**；
- `vite.config.ts:9`：`plugins: [vue()]`，没有 Tailwind 插件；
- 反向引用查：`grep -rln "tailwind.config"` 扫 `src / src-tauri / scripts / index.html / vite.config.ts / postcss.config.js / package.json` → **0 命中**。

Tailwind v4 **不自动读** v3 式 JS 配置，必须 `@config` 显式挂。⇒ 这个文件 **99 行全部惰性**：`:10-96` 把 `colors / borderRadius / boxShadow / fontFamily` 转发到 `--*` 的整套映射、以及 `:7` 的 `darkMode: 'class'`，**一次都没生效过**。

**为什么没出事故**（这点要说，别把它渲染成灾难）：全仓**没有任何一处使用依赖该映射的语义类** —— `grep "bg-background|text-foreground|border-border|text-muted|bg-sidebar|dark:<variant>"` = **0 命中**。组件实际用的是 v4 原生工具类（`z-50`、`inset-0`、`p-8`、`w-6 h-6`、`shadow-2xl`）加手写 CSS，颜色靠 `--*` 直接 `var()` 走。所以**产品上没有可见症状，他不必修任何东西**。

**真正的代价是两个**：

1. **我原报告的一处正面结论判反了**。我写的"Tailwind 全量转发 `--*`，单一真源（好）"是错的。真实机制更脆：v4 自带默认主题变量落到 `:root`，项目 `:root` 里后声明的 `--radius-lg`/`--shadow-*` **恰好同名**，才让 `rounded-lg` 这类工具间接吃到项目值；换个 v4 没同名的语义（`bg-background`）就是**静默无样式**。同名巧合 ≠ 单一真源。
2. **它是教科书级"同名 ≠ 现行"陷阱**（AGENTS.md §0 专门防这个）。下一个照 `tailwind.config.js` 写 `text-muted` 的人（含未来的我），拿到的是 v4 默认灰、**不报错也不塌**。而 §一 #2 那 9 个死变量正是这套映射的孤儿 —— 它只在**这份死配置**里被 `:74/82/87/88` 引用过（`--btn-ghost-bg`→`btn.ghost-bg`、`--radius-xl`→`rounded.xl`、`--shadow-lg/xl`→`shadow.lg/xl`）。**换句话说：那 9 个变量"看似有消费者"的唯一去处，本身是没接线的文件。** 两处发现是同一处。

---

## 四 · 原报告需要更正的清单（7 条，交活用；两条原件我都未改动）

| # | 原报告位置 | 改成 |
|---|---|---|
| 1 | 首页「基准 commit `909061f`」 | `fac3a58`（读取时工作树）；会话快照 HEAD 不等于读取时基线 |
| 2 | 首页「P1 4 / P2 8 / P3 7」 | **P1 5 / P2 8 / P3 4**（带标签小节实测；D-1 正文那句另计） |
| 3 | §一 表头「11 处」 | **9 条**生产反向 import（采 8 条口径亦可，须注明 `App.vue:35` 算不算"反"） |
| 4 | §一 良好项「Tailwind 转发单一真源（好）」 | **删掉并整段替换**为本文 §三（死配置 + 同名巧合） |
| 5 | §二「z-index 12 个离散值 / 撞两次」 | **13 个**（补 `201`，`CustomTitlebar.vue:378`）；同值 **5 组**：50×2 / 100×2 / 300×3 / 400×2 / 9999×2 |
| 6 | §二 图标「33 处 / 18 文件」 | **32 处 / 17 文件**（`.vue` 25/13 + `.ts` 7/4；`assets/vue.svg` 不算内联图标） |
| 7 | §三「ThemeTypography 27 个字段」+ §四 D-3「唯一真死变量」 | **26 个字段**；死变量 **9 个**（不是 1 个，也不是 12 个），并按 §三 说明它与死配置同源 |

另需补登一条：**§二 SearchPanel 一条从「未复核」升级为已核验**，措辞按本文 §二 ① 改（盖住品牌字 + 拖拽区）。

---

## 五 · 不需要改的两条（防它被当成错账重提）

1. **`--radius-xl` 本身确无消费者** —— 它和我的结论一致，只是"唯一"这个限定词错。
2. **`getPresetTheme` 仅测试引用 / `@tauri-apps/plugin-clipboard-manager` src 内 0 import / `console.log`+TODO = 0 / 33 个 .vue 零未引用 / 根产物 tracked 数（12/6/1/6/2/0）/ `.gitignore` 行号 77·85·93 / lint 132(0 errors)·96·10 / `any` 4 处 / 对比度 muted 最低 4.71** —— 这一批它逐字复算过，我抽查其中 6 项（tracked 数、版本号 1.2.60 vs sig 1.2.22、icons 组件数 2、`nodeview-destroy.spec.ts` 覆盖面、eslint 锁行号、pre-flight 无 cursor）与它一致，**照单收下**。

---

## 六 · 拍板项（只有两件，回「同意 / 不同意」即可）

1. **要不要给原报告打更正补丁**：按档案区规矩「写完即冻结」，我一个字没动，更正全在本文。**我的建议：不打补丁，把本文当唯一更正源**，原报告首页加一行指向本文即可（一行改动）。
2. **死配置 `tailwind.config.js` 怎么处置**：三个选项 —— ① 先登记进 KNOWN-ISSUES 不动手（**我推荐这个**，产品无症状，但必须让人看得见）；② 删掉文件（要他批准，属删文件高危类）；③ 补 `@config` 把线接上（**不推荐**：接上后 v4 语义会覆盖原生默认值，等于给全仓 UI 做一次静默重排，收益为零风险非零）。
