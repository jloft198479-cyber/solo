---
title: 方案：速度与丝滑执行方案（Qoder × Trae 双审查合并稿 v1.1）
type: proposal
audience: maintainer
status: active
tags: [方案, 性能, 丝滑, 执行计划, 双审查合并]
summary: 性能流畅度执行稿 v1.1：14 任务按依赖排序，含门禁验收
updates: [docs/KNOWN-ISSUES.md, docs/BENCHMARK-editing-experience.md]
---

# 速度与丝滑执行方案（双审查合并稿 · 2026-11-18）

> **⛔ 2026-11-18 已收手，本方案不执行。** 当日落地的诊断基建 / 分包 / 字体改动已全部回滚，
> 原因与三条实测结论见 [收手决策](./archive/DECISION-2026-11-18-性能优化收手与结论.md)。
> 本文件仅作历史留档，**任何人不要再照此开工**。

> **给任何执行者（人或 agent）**：本方案自包含。开工前按顺序读：
> ① 本文件「全局红线」与「任务总览」→ ② 你要做的那个任务全文 → ③ 任务里列出的「先读」文件原文。
> **证据基线**（论断出处，争议时回查）：
> - [Qoder 审查](./archive/REVIEW-2026-11-18-性能与流畅度审查.md)（S1–S10，每键热路径为主）
> - [Trae 审查](./archive/REVIEW-2026-11-18-速度与丝滑体感审查.md)（平台/感知层为主）
> - [交叉核实](./archive/REVIEW-2026-11-18-Trae体感审查-独立核实.md)（采纳/未采纳的裁决依据）
>
> **执行纪律**：优先用 subagent 逐任务执行；若环境提供 `superpowers:executing-plans` 则用它，
> **没有就按本文件手工推进，不构成阻塞**。每个任务独立提交、独立验收；
> **阶段闸口（G1/G2/G3）处停下向简乐通报「本阶段结果 + 下阶段打算」，等点头再继续**。
> 「已修复」必须由改动者以外的人按最小复现重跑（playbook §C），AI 自称修好不算证据。
>
> **P0 前置（一次性，开工前）**：三份证据基线文档当前是未跟踪状态（磁盘有、git 没有），
> 换机 clone 后本文件链接会失效：`git add docs/archive/REVIEW-2026-11-18-*.md` 后单独提交一次。

### v1 → v1.1 变更（2026-11-18 复审后）

| # | 变更 | 理由 |
|---|---|---|
| 1 | T0 增「按键→上屏 p95」，写明双 rAF 采集与两条回退 | 只测「事务落地」量不到用户真实感受 |
| 2 | T6 把「PR 论证」升级为**随机编辑 fuzz 锁**；明确 60s 全扫是保险丝、保留 | 论证靠不住，锁才靠得住；全扫不是发现路径 |
| 3 | T3 行内公式改「可见区同步、其余空闲」 | 全空闲会让首屏公式晚一拍出现，观感倒退 |
| 4 | T10 中档阈值 10 万 → **5 万**，并注明 1–5 万字靠 T6/T7/T9 | 覆盖用户日常文档区间 |
| 5 | 残余登记新增「打开文件链路」并写**数值立项门槛** | 本批确实没有任务认领，必须署名 |
| 6 | 运维修正：PowerShell tag 命令、构建例外区分 `tauri dev`/`bun run build`、技能引用改可选 | 原稿照抄会直接报错或阻塞 |

**目标**：消除「中文打字黏、停顿间歇顿、打开/滚动不够跟手」的已证实来源，全程不伤已有功能。

**架构判断**：大头优化 2026-09 已完成（序列化 O(n)、四层防抖、空闲调度、重库懒加载）。
本轮全部是**残留缝**：每键级重复工作（S1/S2）、停顿窗主线程独占（S3）、无内容比对的重渲染（S5）、
关而不停的派生计算（S6）、启动分包失误（S7）、平台合成疑似项（A/B 定性）。**不动编辑器内核架构**。

**技术栈**：Tauri v2 / Vue 3 / TipTap 3 (ProseMirror) / Pinia / Rust / WebView2（Windows 主战场）。

---

## 全局红线（每个任务 implicit 包含，违反即停手）

1. **安全网**（playbook §G）：起步 `git status` 必须干净，脏先 `git stash -u`；
   T6/T7/T8/T9/T11/T12 动手前打 tag（PowerShell）：
   `git tag "backup/$(Get-Date -Format yyyyMMdd-HHmm)"`。
2. **门禁分流**（playbook §C）：小改动 `bun run test:changed`；任何前端改动加 `bunx vue-tsc --noEmit`；
   **动 parser/serializer/schema（T9/T11/T12）必跑 `bun run test`（全量）+ `bun run test:full`（保真体检）**；
   时序/IME/UI 改动（T6/T7/T8）加**真机手感**（人工或 playbook §F 的 CDP 探针）。
3. **composition-freeze 铁律**：组字期间任何装饰只 map 平移、不重建；任何新调度不得在组字中改 doc。
   回归必跑 `composition-freeze.spec.ts`、`markdown-input-ime.spec.ts`、`ime-anchor.spec.ts`。
4. **不本地构建安装包**：`tauri build`/`cargo build --release` 一律交 CI。
   例外仅两处且**须先向简乐说明并获同意**：T2 的 `bun run build`（仅前端构建，看分包结果）、
   T1 的 `bun run tauri dev`（A/B 测量，不产出安装包）。
   本机 bun 有已知坑，先读 `RELEASE_PROCESS.md §10.2/§10.3`，别自己发明绕法。
5. **不硬编码**：新阈值/延迟一律命名常量并写理由注释；颜色/尺寸走主题 token。
6. **不装依赖**：本方案所有任务零新增依赖。需要装 = 方案错了，停下报告。
7. **新锁必做反向校准**：撤掉修复确认锁转红；不转红 = 假绿，按 playbook §C 三种假绿排查。
8. **验收写产品行为**：「用户这么操作得到 X」，不写「N 条锁绿了」。
9. **文档纪律**：除本方案勾选状态与 KNOWN-ISSUES 必要登记外不动文档；动文件搬家跑 docs-lint。
10. **写错立刻停手**：只做现状陈述 + 可还原路径，不打补丁掩盖，等简乐开口。

## 任务总览与依赖

| # | 任务 | 来源 | 风险 | 依赖 |
|---|---|---|---|---|
| T0 | 测量基建（五个数） | 双报告共识 | 零 | — |
| T1 | 零风险 A/B 批（透明窗/optimizeLegibility/焦点模式） | Trae Step1（修正版） | 零（临时改测完还原） | T0 |
| T2 | 启动分包：Vue 独立 chunk | Qoder S7 | 极低 | — |
| T3 | NodeView 内容相等守卫 + math-inline 空闲化 | Qoder S5 | 低 | — |
| T4 | 大纲关面板停算 + 壳层减订阅 | Qoder S6 + Trae Step2.2 | 低 | — |
| T5 | 图片尺寸运行时缓存（防顶动） | Qoder S8 + Trae Step2.4（修正版） | 低 | — |
| T6 | markdown-input 增量化 + 段拷贝上限 | Qoder S1 | **中（敏感区）** | tag |
| T7 | 代码块编辑期防抖 + 大块门控 | Qoder S2 | 中 | tag |
| T8 | 搜索装饰预算 | Qoder S4 + Trae Step3.2 | 中 | tag |
| T9 | 序列化分片（可让出） | Qoder S3 | **中（敏感区）** | tag |
| T10 | 字数中档降频 | Qoder S3 + Trae Step2.2 | 低 | — |
| T11 | 表格 cellToText 缓存 | Qoder S8 | 中（serializer） | tag |
| T12 | 粘贴多遍 parse 收敛 | Qoder S8 | 中（parser 侧） | tag |
| T13 | 字体开屏抖动：先测后预载 | Trae 场景A（修正版） | 低 | T0 |

依赖图：`T0 → T1`、`T0 → T13`；其余互相独立，可并行派工（**但 T6–T9 同碰装饰/事务层，串行做，避免互踩**）。
阶段闸口：**G1 = T0+T1 完成**（拿到数字与平台层定性）→ **G2 = T2–T5+T10+T13 完成**（快赢批）→ **G3 = T6–T9+T11+T12 完成**（热路径批）。

---

## T0 · 测量基建（先修仪表，再修车）

**为什么第一个**：两份审查的所有排序都是推理，没有实测。此后每个任务的「值不值得」都用这里的数字说话。

**Files:**
- Create: `src/services/perf-diagnostics.ts`
- Modify: `src/main.ts`（启动打点）、`src/components/Editor/MarkdownEditor.vue`（编辑器就绪/按键打点）、`src/composables/useDocumentSession.ts`（打开完成打点）
- Test: `src/services/__tests__/perf-diagnostics.spec.ts`

**行为契约：**
- 默认**完全惰性**：仅当 `localStorage.getItem('solo-perf') === '1'` 时启用；关闭时所有导出函数是直接 return 的空操作，零计时器零监听。
- 启用时收集五个数：① 冷启动→可输入 ② 打开文件→可输入 ③ 按键→事务落地 p95 ④ **按键→上屏 p95** ⑤ 滚动帧率；另加序列化耗时（`performance.mark/measure` 包住 `useEditorSync.ts:120` 的 serializeMarkdown 调用）。
- ③ 用 PM 插件测：`handleDOMEvents.keydown` 记时 → 下一个 `docChanged` 事务的 view.update 记差值，环形缓冲留最近 200 个样本，`console.table` 输出 p50/p95（**p95 用排序取位，不许拿区间上界冒充**）。
- ④「上屏」采集定义：keydown 记 t0 → dispatch 后连等两次 `requestAnimationFrame`（第二帧覆盖样式/布局/绘制）记 t1，样本进同一环形缓冲。
  **回退一**：连续输入下双 rAF 被合并、采样率 <80% 时，改用 `PerformanceObserver('event')` 的 `processingEnd` 加首帧时间；
  **回退二**：仍不可用则只报 ③，并在基线备注「上屏指标不可用」，**严禁用 ③ 冒充 ④**。
- 输出走 console + 可选状态栏诊断角标；**不写文件、不发 IPC、不改任何渲染行为**。

**Steps:**
- [ ] 写失败测试：关闭态调用任何 API 不产生 performance 条目；启用态 mark/measure 成对、p95 计算正确（构造已知样本断言精确值）
- [ ] 实现模块 + 三处接线（每处 ≤3 行，全部包在 isEnabled() 判断里）
- [ ] `bun run test:changed` + `bunx vue-tsc --noEmit`
- [ ] 真机：`solo-perf=1` 打开 1 万 / 5 万 / 20 万字三份文档（20 万字可用 docs/ 语料拼接生成到临时目录，**不碰真实用户数据**），回读五个数，记录进本文件「基线记录」小节
- [ ] 反向校准：关掉开关确认零 performance 条目
- [ ] 提交 `feat(perf): 诊断模式测量基建（默认惰性）`

**验收（用户视角）**：普通用户毫无感知；诊断模式下打开三份文档能回读五个数字。
**基线记录**（执行者填写）：冷启动__ms / 打开5万字__ms / 按键事务p95__ms / 按键上屏p95__ms / 滚动__fps / 序列化5万字__ms。

## T1 · 零风险 A/B 批（平台层定性，测完还原）

**Files:** `src-tauri/tauri.conf.json:24`（transparent）、`src/components/Editor/tiptap/editor.css:88`（text-rendering）、设置里的焦点模式开关。

**三个 A/B（每个用 T0 的同一份 5 万字文档、同一段操作脚本）：**
- [ ] **A1 透明窗**：`transparent: true → false` 临时改，dev 构建对比滚动 fps 与按键 p95。
      ⚠️ 这不是「零风险改法」是「零风险测量」：自绘标题栏/圆角/阴影依赖透明窗，**测完必须还原**；
      若差异 >10% 且要转正，另立任务评审窗口外观方案（含 IME 重锚护栏回归），不在本批。
- [ ] **A2 optimizeLegibility**：注释掉 `editor.css:88` 一行，对比长文滚动 fps。中文 ligature 作用小，预期差异小；>10% 才转正（转正=删该行，属样式改动，跑 test:changed）。
- [ ] **A3 焦点模式**：仅当简乐日常开着焦点模式才有意义（默认关，`stores/settings.ts:159`）；开/关各测一轮打字 p95。
- [ ] 每项记录：改前数字 / 改后数字 / 差异% / 结论（锁定主因 or 排除）。**差异 ≤10% 一律判「不是主因」并还原**，不许恋战。
- [ ] 全部还原后 `git status` 确认与测前一致（除测量记录），提交记录文档。

**产出**：平台层（透明合成/字体渲染/焦点装饰）到底占多少的**实测定性**，写进 G1 通报。
**注意**：Trae 原文把 TSF 禁用说成「当年修 IME 的既定取舍」——核实稿已证伪该因果（定案修法是 blur→focus 重锚，
TSF flag 有效性从未验证）。**本批不碰 TSF**，见「未采纳清单」第 4 条。

## T2 · 启动分包：把 Vue 从 tiptap-core 里摘出来

**证据**：`vite.config.ts:35-41` 的 manualChunks 把 Vue 运行时 hoist 进 `tiptap-core`（dist 实测 426,768 B），
入口静态依赖 + modulepreload ⇒ 窗口显示前被迫解析 ~579KB JS，懒加载被架空。

**Files:** Modify `vite.config.ts:35-48`。

**改法（确切代码）：**
```ts
manualChunks: (id: string) => {
  if (id.includes('node_modules/vue/') || id.includes('node_modules/@vue/')) {
    return 'vue';
  }
  if (id.includes('@tiptap/vue-3') || id.includes('@tiptap/pm') || id.includes('@tiptap/core')) {
    return 'tiptap-core';
  }
  // …其余分支原样保留，尤其 mermaid 不手动分包的注释约束（:44-47）一个字不动
```

- [ ] 改配置
- [ ] **向简乐说明并获同意后**跑一次 `bun run build`（仅前端构建，playbook §C 明示的例外情形），确认：
      ① `dist/assets/tiptap-core-*.js` 不再含 `createApp`（grep 零命中）② vue 独立 chunk 存在
      ③ `dist/index.html` 的 modulepreload 列表变化符合预期
- [ ] 真机冒烟：冷启动、打开文档、mermaid/katex 懒链各触发一次（图表/公式正常渲染）、主题切换正常
- [ ] `bunx vue-tsc --noEmit`；构建产物验证后按红线 4 清理或保留由简乐定
- [ ] 提交 `perf(build): vue 独立分包，解除入口对 tiptap-core 的静态重依赖`

**验收**：冷启动→可输入比 T0 基线快（数字说话）；全部既有功能冒烟无异常。
**回滚**：单文件 `git checkout -- vite.config.ts`。

## T3 · NodeView 内容相等守卫 + math-inline 空闲化

**证据**：`mermaid-block.ts:518-524`、`math-block.ts:234-240`、`math-inline.ts:59,64-68`。

**Files:** Modify 上述三文件；Test `extensions/__tests__/mermaid.spec.ts`、`mermaid-math-exit.spec.ts` 追加用例。

**行为契约：**
- 三处 `update(updatedNode)` 在重渲前比对内容：mermaid/math-block 比 `updatedNode.textContent === node.textContent`（**先比再赋值 node**），math-inline 比 `attrs.latex`；相等 ⇒ 只更新 node 引用、`return true`，不 render。
- **主题切换路径不受守卫影响**：`rerender()` 句柄（mermaid-block.ts:508-511）直调 renderMermaid，不走 update，保持强制重渲。
- math-inline 初始渲染（:59）改「可见区同步、其余空闲」：视口内公式同步渲染（不进 idle，避免首屏空窗），
  视口外公式排 `scheduleIdleRender`（与 math-block:225 同款，注意 destroyed 守卫）；可见性用块 rect 与滚动容器交集判定。
- math-block 重渲闪烁（先 replaceChildren 再 await）：渲染到 detached 容器、完成后一次性替换（对齐 mermaid 双缓冲）。

**Steps:**
- [ ] 先写失败测试：同内容 update 不触发 render（spy renderToString/renderMermaid 调用次数）；异内容照常渲染；主题句柄仍强制重渲
- [ ] 实现三处守卫 + idle 化 + 双缓冲
- [ ] `bun run test:changed`（含 mermaid-math-exit/nodeview-destroy）+ `bunx vue-tsc --noEmit`
- [ ] 反向校准：撤掉任一守卫，对应测试必须红
- [ ] 真机：打开含 50 个行内公式的临时文档首帧更快；公式/图表编辑、退出编辑、主题切换、lightbox 全正常
- [ ] 提交 `perf(editor): NodeView 内容未变跳过重渲，行内公式初始渲染空闲化`

**验收**：公式/图表显示与交互和以前完全一样；含公式文档打开不再「卡一下」，且首屏公式不出现空窗。

## T4 · 大纲关面板停算 + 壳层减订阅

**证据**：`useEditorSync.ts:74`（只挡 heavy+关）、`OutlinePanel.vue:172-184`（关了仍 v-for）、`App.vue:381`（全文当 prop）。

**Files:** Modify `src/composables/useEditorSync.ts`、`src/components/Editor/OutlinePanel.vue`、`src/App.vue`、`src/components/Editor/MarkdownEditor.vue:112,802`。

**行为契约与改法：**
- `skipOutline` 改为 `() => !outlineOpen()`（去掉 `isHeavyDocument() &&`）。**补算链路已存在无需新建**：
  `MarkdownEditor.vue:952-959` 的 watch 在面板打开瞬间调 `emitOutlineNow`（useEditorSync.ts:165）。
- OutlinePanel 内容区（header 以下的 nav/empty）包 `v-if="isOpen"`；scroll-spy 已有停止逻辑不动。
- **壳层减订阅（子步 b，可单独提交）**：App.vue 不再传 `:initial-content`；MarkdownEditor 删该 prop，
  `createEditor` 只读 `fileStore.currentFile.content`（:802 现状已是 `fileStore... || props.initialContent`，删后半截）。
  改前 grep `initialContent|initial-content` 全仓确认无第三处消费（当前仅 App.vue:381 与 MarkdownEditor.vue:112,802）。
  全文字符串从此不进 App 模板依赖图；isDirty 等轻信号保留。

**Steps:**
- [ ] 先写失败测试：normal 档 + 面板关闭 ⇒ doc 变化后 outline 不更新；打开面板 ⇒ 立即拿到完整大纲（驱动 useEditorSync 单测，现有 `composables/__tests__/` 有同类基建）
- [ ] 实现 a（停算+v-if）→ 跑门禁 → 提交
- [ ] 实现 b（删 prop）→ `bun run test:changed` + vue-tsc + 真机冒烟（新建/打开/切档/图片模式往返）→ 提交
- [ ] 反向校准：还原 skipOutline 旧式，测试红
- [ ] 真机验收：大纲关闭时打字，状态栏字数照常；打开大纲瞬间内容完整、点击跳转正常

**验收**：大纲关着=零成本；打开瞬间一切如旧。

## T5 · 图片尺寸运行时缓存（防顶动，不改文件）

**证据**：`image.ts:457-464` 仅 markdown 带 `|WxH` 才预留。

**Files:** Modify `src/components/Editor/tiptap/extensions/image.ts`；Test `extensions/__tests__/image.spec.ts` 追加。

**行为契约：**
- 模块级 LRU（上限 500，对齐远程图缓存量级）：key=解析后的最终 src，value={w,h}。
- `img.onload` 时记录 naturalWidth/Height；NodeView 创建时若 attrs 无尺寸且 LRU 命中 ⇒ 先设 width/height 占位。
- **绝不把尺寸写回 node attrs / 文件**——那会改变用户文件字节（保真红线）；本任务只消「重复打开同一文档」的顶动，
  首次打开仍会跳一次，属已知残余，写进验收备注。
- 加载失败不缓存；attrs 已有尺寸的路径一个字节不动。

**Steps:**
- [ ] 失败测试：二次创建同 src NodeView 命中缓存预留尺寸；attrs 带尺寸时不走缓存；LRU 淘汰正确
- [ ] 实现 → `bun run test:changed` + vue-tsc → 反向校准 → 提交 `perf(image): 自然尺寸运行时缓存，重复打开不再顶动`

**验收**：同一图文文档第二次打开，滚动到图片位置内容不再被顶动；文件内容零变化。

## T6 · markdown-input 增量化（中文打字主诉，敏感区）

**证据**：`markdown-input.ts:262-270`（上屏 50ms 后置 forceCheck）→ `:300-301`（全 doc scanHeadings，:522）；
`:406,:466`（每键两次段内光标前全文拷贝）。**已有基建**：`scanHeadingsInRange`（:557）、
`scanChangedRanges`（:597）、pending heading 装饰增量维护（:158-174）——本任务是接线，不是发明。

**Files:** Modify `extensions/markdown-input.ts`；Test `extensions/__tests__/markdown-input.spec.ts`、`markdown-input-ime.spec.ts` 追加。
**先读**：markdown-input.ts 全文 + `composition-freeze.ts` + `docs/sensitive-areas.md` 对应条目。

**行为契约（三条，逐条独立提交）：**
- [ ] **a. forceCheck 不再无条件全扫**：优先扫「pending heading 装饰集覆盖的块 ∪ 上次检查以来变更区间」
      （装饰集是增量维护的，pending heading 在哪装饰就在哪，用 `decorations.find()` 取位置后
      `scanHeadingsInRange` 逐块扫）；**保留低频全扫兜底**：距上次全扫 >30s（命名常量）或切文档后首次，
      仍走 scanHeadings。heavy 档取消周期全扫、只走区间扫。
      正确性不靠 PR 论证，靠**随机编辑 fuzz 锁**：生成 2000 组含 `# `/`## `/`- ` 等未完成标记的随机编辑序列，
      每组逐步执行后比对「增量路径」与「同 doc 全扫 scanHeadings」的转换结果，必须逐字相等；
      fuzz 红即回退到全扫、只做 b/c。
- [ ] **b. 段内拷贝上限**：`findPendingInlineMark`（:406）与 `convertPendingLink`（:466）的 textBetween 结果
      超过 `INLINE_SCAN_MAX_CHARS = 2000` 时只取**末尾** 2000 字符（所有 finder 正则均 `$` 锚定光标前末尾，
      :82-92 与 :448 逐个核对后才许动；match 偏移换算回全段坐标，:384 的 fullStart 计算同步修正）。
      超长行内 code span（>2000 字符）不再即时转换属可接受残余，登记 KNOWN-ISSUES。
- [ ] **c. heavy 门控**：forceCheck 路径接入 `isHeavyDocument()`（document-scale.ts），heavy 档全扫降频到 60s。
      60s 是防漂移保险丝、不是转换发现路径（装饰增量维护见 :158-174），**保留，不得删除或降级为调试断言**。

**门禁**：`bun run test`（全量）+ vue-tsc + composition-freeze/markdown-input-ime/ime-anchor 三套件 +
**真机中文手感**：20 万字文档微软拼音连续输入 5 分钟——候选窗不漂、`# ` 直输转标题、`**加粗**` 直输、
组字中撤销/切窗一切如旧。每条新锁反向校准。
**验收**：长文档中文打字词间停顿消失（T0 按键 p95 对比）；上述直输语法一个不少。
**回滚**：tag 锚点；a/b/c 独立提交可单条撤。

## T7 · 代码块编辑期防抖 + 大块门控

**证据**：`code-block.ts:359-366`（每事务同步整块重染）、`:176`（规模门只管 auto 检测）。

**Files:** Modify `extensions/code-block.ts`；Test `extensions/__tests__/code-block.spec.ts` 追加。
**先读**：code-block.ts 全文（尤其 apply/queueSweep/mergeChunks 与 HIGHLIGHT_CHUNK_META 通道）。

**行为契约：**
- [ ] **a. 编辑期防抖**：apply 的 docChanged 分支对受影响块不再同步 highlightBlock，改为
      map 平移旧装饰 + 登记 dirty 块 + 排 120ms trailing 定时器（命名常量），到点 dispatch 带
      HIGHLIGHT_CHUNK_META 的 meta 事务走既有 mergeChunks 回填。**组字期（tracker.isFrozen）只 map 不排期**，
      解冻后首个事务照常触发（现有 :330 语义保持）。打开/切文档的整篇替换路径（:352-356）不动。
- [ ] **b. 大块门控**：`SYNC_HIGHLIGHT_MAX_CHARS = 20000`——标注语言的块超此限也跳过同步重染、
      直接进空闲补算队列（把 :176 的门从「仅 auto」扩为「auto 3000 / 标注语言 20000」两级，注释写清理由）。
- [ ] 失败测试先行：块内输入后 120ms 内装饰只 map 不重建、到点回填正确；组字期零重建；20k+ 块走空闲。
- [ ] 门禁：test:changed + vue-tsc + composition-freeze 套件 + 真机（500 行 JS 块内连续打字跟手、
      高亮 ≤200ms 跟上、组字期候选窗不漂）。反向校准。
- [ ] 提交 `perf(code-block): 编辑期高亮防抖与超大块空闲化`

**验收**：大代码块里打字按键跟手；高亮短暂延迟后跟上；打开文档的高亮行为不变。

## T8 · 搜索装饰预算

**证据**：`useEditorSearch.ts:66-67,90,104`（编辑触发全扫+空事务）、search-highlight 全量重建。

**Files:** Modify `tiptap/useEditorSearch.ts`、`extensions/search-highlight.ts`；Test 对应 spec 追加。

**行为契约：**
- [ ] 匹配总数 ≤ `SEARCH_DECORATION_BUDGET = 2000`：行为与现状完全一致。
- [ ] 超预算：装饰只挂「当前索引 ±200」窗口；**匹配计数与跳转导航不受影响**（currentMatches 全量保留，
      跳转落窗外时重建窗口）。搜索面板关闭时不挂装饰（现状若已如此则核对确认）。
- [ ] 空事务（:90）改为仅 search 插件识别的 meta 事务，减少无关插件 apply 空转——**先验证各插件 apply
      对 meta 事务的行为不变**（逐个 grep getMeta 分支），验不动就保留空事务、只做预算。
- [ ] 门禁：test:changed + vue-tsc + 真机（40 万字文档搜「的」数千命中：输入不卡、计数准、上一个/下一个全可达）。
- [ ] 反向校准 + 提交 `perf(search): 超大命中数装饰预算化`

**验收**：开着搜索改大文档不再卡；命中数、跳转、替换与以前一致。

## T9 · 序列化分片（停顿窗不再独占，敏感区）

**证据**：`useEditorSync.ts:104-127`（rIC 回调一次性跑完，续打保护只覆盖 didTimeout 分支）；
`serializer.ts:1152-1160`（入口 = state.renderNode(doc) 一把梭）。

**Files:** Modify `markdown/serializer.ts`（新增分片入口，**同步入口原样保留**）、`src/composables/useEditorSync.ts`；
Test serializer 既有套件 + 新增分片等价锁。
**先读**：serializer.ts 的 MarkdownSerializerState.renderNode 全文 + useEditorSync.ts 全文 + sensitive-areas 脏态条目。

**行为契约：**
- [ ] 新增 `serializeMarkdownChunked(doc, budget)`：把**顶层块循环**拆成可续跑（每片 ≤50 个顶层块，
      命名常量），片间让出；跨片状态（列表嵌套/脚注收集等 renderContent 依赖）必须完整保持——
      **若读码发现顶层块间存在跨块状态依赖导致无法安全分片，停手报告，改做「仅 didTimeout 保护扩展到真空闲分支
      （timeRemaining()<10ms 即续排）」的保守版**，不许硬拆。
- [ ] **字节等价锁**：对 fixtures 全量 + 构造的表格/脚注/列表嵌套形态，chunked 与同步产物逐字节相等（A 级行为锁）。
- [ ] useEditorSync 的空闲回调改用 chunked；**代际契约不变**（:92-98）：每片执行前校验 editGeneration，
      变了即弃整批重排；`flushPendingSerialize`/关窗/保存闸口**仍走同步入口**，绝不等分片。
- [ ] 门禁：**动 serializer ⇒ `bun run test` 全量 + `bun run test:full` 保真体检** + vue-tsc +
      真机（20 万字慢节奏打字 10 分钟无周期顿挫；刚敲一字马上 Ctrl+S 立即落盘；关窗脏提示准确）。
- [ ] 反向校准（撤分片让出逻辑，长任务锁红）+ 提交 `perf(serializer): 空闲序列化分片让出，闸口同步路径不变`

**验收**：慢节奏打字不再有 0.1–0.3s 的周期性顿挫；保存/关窗/脏标记行为一个字节不差。

## T10 · 字数中档降频

**Files:** Modify `src/composables/useEditorSync.ts:34,145`、`src/components/Editor/document-scale.ts`（新增中档阈值常量）。

**行为契约：**
- [ ] 新常量 `WORD_COUNT_MID_CHARS = 50000`：文档 >5 万字且非 heavy 时，字数防抖 150ms → 1000ms；
      heavy 档现状（停实时字数）不动；≤5 万字一切不变。**不动 HEAVY_DOC_CHARS=50 万阈值本身**（IME 暴露面结论）。
- [ ] **覆盖说明**：1–5 万字的体感改善主力是 T6/T7/T9，本任务对该区间零收益；若 T0 显示小文档也慢，优先查 T6。
- [ ] 失败测试：三档各断言防抖档位；门禁 test:changed + vue-tsc；真机：8 万字文档停笔 1 秒内字数更新。
- [ ] 提交 `perf(stats): 五万字档字数降频`

**验收**：状态栏字数最多迟 1 秒，打字期间背景开销下降；小文档体验不变。
（Trae 提的「增量计数」未采纳：delta 维护要侵入事务链路，降频用 1/10 的成本拿到 80% 收益，见未采纳清单 6。）

## T11 · 表格 cellToText 缓存

**证据**：`serializer.ts:933,943` 同一 cell 两遍 cellToText（各建子 state 全量渲染）。

**Files:** Modify `markdown/serializer.ts` 表格渲染段；Test 表格既有套件 + fixture。

**行为契约：**
- [ ] 单次 serialize 调用内用 `Map<PMNode, string>` 缓存 cellToText 结果（cell 节点引用在同一次调用内稳定）；
      调用结束即弃，**不做跨调用缓存**（doc 变了引用也变，跨调用缓存是脏读源）。
- [ ] 字节等价：表格 fixture 逐字节 diff 为零。门禁：**全量 + test:full 保真体检** + vue-tsc。
- [ ] 真机：含大 CJK 表格文档保存一次，耗时对比 T0 基线。反向校准 + 提交。

**验收**：表格保存更快；打开→保存往返字节不变。

## T12 · 粘贴多遍 parse 收敛（先取证后动）

**证据**：`markdown-paste.ts:316,354,377,460` 四个分支各自 parseMarkdown。

**行为契约：**
- [ ] **第一步只取证**：给四处 parse 加临时计数（诊断模式），真机粘贴 10 种形态（纯文本/表格/混合/代码/
      wikilink/图片/脚注/公式/超长/嵌套列表），记录每种实际 parse 次数。**若最坏 ≤2 遍，判「无需改」登记结案**。
- [ ] 若证实 ≥3 遍：重构为「先轻量判定形态、再单次 parse」，判定逻辑不得改变任何分支的既有结果——
      `markdown-paste.spec.ts`（88 条）+ `table-paste-matrix.spec.ts`（23 条）**一条不许红**，新形态回灌用例。
- [ ] 门禁：动 parser 侧 ⇒ 全量 + test:full + vue-tsc + 真机粘贴矩阵手验。提交。

**验收**：粘贴大段内容顿挫减轻；所有粘贴形态结果与以前完全一致。

## T13 · 字体开屏抖动：先测后预载（Trae 修正版）

**Files:** 可能 Modify `src/services/fontLoader.ts`、`src/App.vue`（空闲预载挂钩）。

- [ ] 用 T0 诊断 + 录屏判定：当前字体（缓存命中场景）开屏 swap 抖动是否可感知
      （现有 crossfade 机制 `useEditorAppearance.ts` applyFontFamily 已抹平一部分）。
- [ ] 不可感知 ⇒ 登记「已核查无需改」结案。可感知 ⇒ 应用挂载后的空闲期预载**当前一款**字体的磁盘缓存
      （走既有 registerFontViaCss 路径，不新增 IPC），远程字体不预载（流量）。
- [ ] **绝不阻塞首帧**（见未采纳清单 1）。门禁 test:changed + vue-tsc + 真机开屏对比。提交或结案登记。

---

## 未采纳清单（Trae 原建议 → 裁决与原因）

| # | Trae 原建议 | 裁决 | 原因（核实稿依据） |
|---|---|---|---|
| 1 | Step2.3 字体就绪再显示（fonts.ready / font-display:block） | **不采纳** | 把「一次性抖动」换成「首帧白等」：solo 有 5 款远程字体，离线/弱网时编辑器卡死在空白。现状 swap+crossfade 是有意设计。替代=T13 预载 |
| 2 | Step2.1 序列化移 Worker（低风险 1–2 天） | **不采纳原样；T9 分片为替代** | serializer 无 DOM 依赖确可进 Worker，但①主线程 toJSON+结构化克隆仍 O(n)，「停顿消失」说过头；②脏态代际契约假设执行时读当前 doc，Worker 往返引入过期产物，须代际守卫+闸口同步兜底——是中风险不是低风险。分片在主线程拿到同等收益且不碰跨线程契约。Worker 版留档：若 T9 实测仍不达标再按中风险评审 |
| 3 | Step3.1 条件式 content-visibility（组字开始全局撤下） | **暂缓，入观察项** | compositionstart 瞬间撤 contain = 在最敏感时刻触发全篇离屏块强制布局，恰是 IME 光标矩形最易失锚的时点（IME 经验卡全篇为证）。须先有 T0 数字证明滚动是主诉大头，再立专项+全套组字回归，不进本批 |
| 4 | Step4 评估恢复 TSF | **默认不动** | 历史归因已被证伪：定案修法是 blur→60ms→focus 重锚护栏（10-12），TSF flag（09-14）有效性从未验证。恢复 flag 的收益未知、回归成本极高（IME 全套）。若 T1 后中文输入仍是主短板且 T6 已修完，再立 A/B 专项 |
| 5 | Step2.4 图片固定比例骨架占位 | **修正后采纳=T5** | 固定比例与真实比例不符时仍跳；运行时尺寸缓存更稳。写回 attrs 的方案另被否：会改用户文件字节，触保真红线 |
| 6 | Step2.2 字数增量统计 | **修正后采纳=T10 降频** | 增量计数须侵入每个事务维护 delta，成本/风险高于降频；降频已拿大部分收益。增量版留作 T10 实测不达标时的后备 |
| 7 | 「前三层是架构取舍，抠代码消不掉」总结论 | **不采纳** | 与已证实的每键热路径（T6/T7）矛盾——那些恰是纯代码可修项。平台层（透明合成等）交 T1 实测定性，不预先下结论 |
| 8 | 虚拟化 / 下调 HEAVY 阈值 | **不采纳（两份报告+9月结论一致）** | 虚拟化=重写 ProseMirror；下调阈值放大 IME 失锚暴露面。中档需求用 T10 的「行为分档」满足，不动阈值 |

## 残余登记（不在本批，防「以为漏了」）

来源审查里以下条目**有意不排进本批**，执行者不必补做；将来立项时回查原报告：

- **打开文件链路（parse + 基线序列化 + NodeView 构建）**：本批 T3/T5/T7 只覆盖局部，未立项分片。
  立项门槛（T0 标定后判定）：5 万字文档「打开→可输入」> 500ms，或序列化占该链路耗时 > 30%，
  且 T2/T3/T5 落地后复测仍超标；满足再立专项（parse 分片须过保真红线评审，基线序列化不得推后）。
- **字体切换 IPC 字节膨胀**（Qoder S9：`font.rs` read_font_bytes 的 Vec<u8> 经 JSON 数字数组传输）：
  低频（仅切换字体时一次），改 base64/分块属 Rust 命令改动（四处同步），收益/半径比不划算，挂账。
- **Qoder S10 全部低频小项**：打开时 .tmp 目录扫描、主题切换两次强制重排、idle 批不看 deadline、
  滚动停 800ms 的 session 碎 IPC、CommandPalette mousemove 重渲——单次成本低或频率低，
  待 T0 数字证明某项进入用户感知前列再立项。
- **Trae 场景 E「气泡菜单追光标」**：核实稿已证伪其打字成本（空选区早退，`MarkdownEditor.vue:635-639`），
  仅「带选区滚动」时发生，属交互设计取舍，不改。

## 收尾验收（G3 之后，全部任务完成时）

用 T0 同一套诊断复测三份文档，对照基线记录出数字；另按下列清单真机手验（每项写「操作→结果」）：

1. 20 万字中文文档微软拼音连续输入 5 分钟：词间无顿、候选窗不漂、`# `/`**`/`[链接](url)` 直输照常。
2. 500 行代码块内连续打字：跟手，高亮 ≤200ms 跟上。
3. 慢节奏打字 10 分钟：无周期性顿挫；刚敲一字马上 Ctrl+S 立即落盘；关窗脏提示准确。
4. 开着搜索（数千命中）编辑大文档：不卡，计数/跳转/替换准确。
5. 大纲关→开：瞬间完整；关闭期间打字状态栏照常。
6. 含 50 公式 + 10 图表文档：打开首帧快，编辑/退出/主题切换/lightbox 如旧。
7. 图文文档二次打开：图片不顶动；文件字节零变化。
8. 粘贴矩阵 10 形态、表格往返、复制全文：保真不变（test:full 体检背书 + 手验）。
9. 冷启动→可输入：优于基线。
10. `bun run test:full` 全绿；每个新锁的反向校准记录在案。

**任何一项不过 = 该任务回滚重做，不带病进下一阶段。**

## See also

- [Qoder 审查](./archive/REVIEW-2026-11-18-性能与流畅度审查.md) · [Trae 审查](./archive/REVIEW-2026-11-18-速度与丝滑体感审查.md) · [交叉核实](./archive/REVIEW-2026-11-18-Trae体感审查-独立核实.md)
- [agent-playbook §C 门禁 / §G 安全网](./agent-playbook.md) · [sensitive-areas](./sensitive-areas.md) · [BENCHMARK](./BENCHMARK-editing-experience.md)