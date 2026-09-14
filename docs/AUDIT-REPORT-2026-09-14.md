---
title: 全量审计报告 2026-09-14（功能/规范/结构/代码健康/Typora 对齐）
type: core
audience: agent
status: active
tags: [核心文档, 审计, 代码健康, 耦合, typora对比]
summary: 六维度全量审计快照：三闸门基线、逐项功能核查、耦合热点与解耦分级、Typora 差距决策单
updates: [ARCHITECTURE.md, docs/KNOWN-ISSUES.md, docs/FEATURE-MATRIX.md]
---

# 全量审计报告（2026-09-14）

> **基准**：`v1.2.54` · commit `bcbfd0f` 之后的工作区 · 分支 `master` · 2026-09-14
> **六维度**：功能可用性 / 规范性 / 逻辑清晰 / 结构稳定性与模块灵活性（高内聚低耦合）/ 代码健康（冗余·僵尸）/ Typora 对齐。
> **本文是快照**：可持续的真相（问题台账、功能状态）以 `KNOWN-ISSUES.md` 与 `FEATURE-MATRIX.md` 为准，本文提供证据与推理过程。

## 0. 结论速览

**总评：这是一个健康度异常高的代码库。** 三道闸门全绿；纪律类违规几乎为零（零 console.log / 零 replaceAll / 零 invoke SSOT 违规 / 零 TODO / 零注释代码尸体 / 零未引用导出）。真正的债不在「烂代码」，而在三处：**①文档与代码漂移（13 处，本次已修）**；**②结构债（composables→components 层级环、2 个多职责上帝文件、1 个跨层全局单例）**；**③与 Typora 相比缺几个「写作器高频刚需」（最近文件、阅读位置记忆），同时若干「刻意不做」需要拍板确认**。

| 维度 | 评级 | 一句话 |
| --- | --- | --- |
| 功能可用性 | **A** | 矩阵 ~90 项锚点全部实存，抽样 10/10 与代码一致；保真四网 1446 测试全绿 |
| 规范性 | **A-** | 四类硬纪律零违规；仅 1 处颜色硬编码（已登记例外）+ 文档漂移 13 处（已修） |
| 逻辑清晰 | **A-** | 数据流主干单一（打开→编辑→保存链路清晰）；`useDocumentSession` 7 类职责需拆 |
| 结构稳定性 | **A** | 原子写/冲突检测/错误边界/保真四网在位；Rust 侧 main/lib 分界清晰 |
| 模块灵活性（高内聚低耦合） | **B+** | 层级环 5 处（领域工具放错目录所致）；`document-scale` 跨层单例；两个上帝文件 |
| 代码健康（冗余/僵尸） | **A** | 僵尸代码仅 1 文件 1 类型（已删）；重复实现 2 组（已去重 1 组） |
| Typora 对齐 | **B+** | 核心写作体验对齐；缺最近文件/阅读位置记忆/打字机模式；若干减法待拍板 |

---

## 1. 基线闸门（审计前后各跑一遍，均全绿）

| 闸门 | 结果 |
| --- | --- |
| `bun run test` | **46 文件 / 1446 测试全过**（含 roundtrip / fixtures / fuzz / commonmark 保真四网） |
| `npx vue-tsc --noEmit` | 通过 |
| `bun run build` | 通过（13.5s） |

清理代码（删 `themes/index.ts`、收窄 `CommandSource`、basename 去重、CSS 注释）后复跑，结果不变。

## 2. 功能可用性逐项核查（以 FEATURE-MATRIX 为清单）

**方法**：按矩阵 §0 的核查三步执行代码层 + 测试层（行为层未起 GUI，见 §7 边界）。

- **锚点实存性**：矩阵 10 节全部「实现锚点」文件逐一核验，**全部实存**、无失效路径。
- **⛔ 论断全证实**（grep 零命中）：无打印入口 / 无最近文件（`recentFiles` 零命中）/ 无阅读位置记忆（`scrollPosition`/`restoreScroll` 零命中）/ 无跳转历史 / 无标题折叠。
- **关键 ✅ 抽样 10/10 证实**：自动保存默认关（`settings.ts:50`）+ 间隔 30s；查找/替换 `Mod-f`/`Mod-h`（`registry.ts:350/360`）；命令名真理源 26=26 双侧一致（`command-names.ts` ↔ `lib.rs generate_handler!`）；复制按钮双槽（`StatusbarQuickActions.vue:36-39`）；`escapeInline` clipboard 分流（`serializer.ts:271,286`）。
- **拼写检查已接线**（矩阵未列）：`MarkdownEditor.vue:332,735-737` 把 `settings.spellCheck` 同步到编辑器 DOM `spellcheck` 属性，默认开。
- **print CSS 判定**：`main.css:401-492` 的 `@media print` 区**不是死样式**——注释显示它在持续维护（focus-mode 丢段落修复、P5-02 content-visibility 修复）。但**当前没有任何显式打印入口**（无命令/菜单/快捷键；`Ctrl+P` 是否触发 WebView2 打印对话框未验证）。判定：**休眠保留**，可达性验证列为待办（§7）。
- **矩阵修正**：见 `FEATURE-MATRIX.md` 附录 B 本轮更新（B-2 波及面、B-3 措辞、新增 README auto-save / zh-CN 主题数两条）。

## 3. 规范性

| 检查项 | 结果 |
| --- | --- |
| TS target ES2020（禁 `replaceAll`） | **0 违规**（全 src 非测试文件零命中） |
| 前端 invoke 走 `client.ts` 统一入口 | **0 违规**（全仓唯一 `invoke(` 在 `client.ts:62`） |
| 命令名 SSOT（`command-names.ts`） | 前端 26 条 ↔ Rust `generate_handler!` 26 条，**集合完全一致** |
| 颜色走主题 token（§11.6） | token 定义层（main.css/manager.ts/presets）合规；散落违规仅 1 处（`editor.css` lightbox 白字），**判定为主题不变 scrim 例外**（`--modal-overlay` 明暗两套都是深色半透明，白字恒正确），已加注释登记；`mermaid-block.ts:182` 的 `'#888888'` 是 token 读取失败的**防御性兜底**，保留 |
| 图片扩展名三处一致 | `document.rs` / `editor-image-drop.ts` / `mime_to_extension` 一致（含 `.bmp/.ico`） |
| 文档 frontmatter + 索引 | wiki/docs 主体合规；`solo-tour.html` 内嵌快照漂移（见 §7） |
| NodeView 清理成对 | `nodeview-destroy.spec.ts` 6 测试全绿 |

**文档与代码不符（审计发现 → 本次全部已修）**：13 处，明细见 §6 修正清单。最高危是 wiki/FAQ/README 三处宣称「2 秒自动保存」而实际**默认关闭**——用户以为有自动保存实际没有，属**可能丢稿级**文档 bug。

## 4. 结构与耦合（高内聚低耦合）

### 4.1 实测分层图

```
main.ts → App.vue（唯一接线板：组装 7 个 composable + 分发命令）
  components/ → {stores, composables, services, commands, themes, utils}   ← 依赖一切的最上层
  composables/ → {commands, stores, services}  + ✗ components（5 处反向）
  stores/ → {themes, services}（file/settings 互不引用）
  services/ → {client, command-names}（零反向依赖，最干净的一层）
  themes/ → services
```

stores 之间零互引、composables 之间零互引（全靠 App.vue 组装）——这是**高内聚的好证据**；唯一的结构性问题是 composables→components 反向。

### 4.2 耦合热点 Top 5（附解耦分级）

| # | 热点 | 证据 | 分级方案 |
| --- | --- | --- | --- |
| 1 | **composables→components 层级环**（5 处反向 import） | `useEditorSync.ts:9-11`、`useDocumentSession.ts:20`、`useAppWindowSession.ts:5`、`useAppEditorState.ts:4`、`useFloatingListMenu.ts:2`——所引 `editor-metadata`/`document-scale`/`serializer`/`wikilink-drop`/`editor-extensions` 实为**无 UI 领域工具，放错目录** | **P1**：新建 `src/editor-core/`（或并入 utils）收编这 5 个无 UI 模块，components 保留纯 .vue+扩展，层环变单向 DAG。改动机械（挪文件+改 import），需全量回归 |
| 2 | **`document-scale.ts` 全局可变单例**被 6 个异层模块读写 | `document-scale.ts:24`（shallowRef）；`App.vue:34`、`useDocumentSession.ts:20`、`useEditorSync.ts:11`、`code-block.ts:17`、`paragraph-focus.ts:7`、`useEditorSearch.ts:4` | **P2**：收编进 file store 或经参数注入，消除「谁都能改档位」的隐式全局态 |
| 3 | **MarkdownEditor.vue 多职责**（832 行 / 41 imports） | 编辑器宿主 + 9 路菜单编排 + **wikilink 业务执行**（`:184-219` 直接调 `saveDocument`/`getFileMtime` 建档写文件）+ 命令门面（`:801`） | **P2**：wikilink 打开/建档业务下沉 `useDocumentSession`；组件只留宿主+编排 |
| 4 | **命令默认键位双份事实** | editor 作用域命令实际由 PM 内置 keymap 生效，`registry.defaultShortcut` 只服务展示/菜单/面板（`registry.ts:368-371` 注释 + `useAppDomEvents.ts:71-77` 的跳过逻辑为弥合分叉而存在）；**原另有 3 个注册表外固定键（`Ctrl+K`/`Ctrl+/`/`Escape`）——其中 `Ctrl+K` / `Ctrl+/` 已于 2026-09-14 收编进 registry（`fixedShortcut` 标记），仅 `Escape` 仍由 `useAppDomEvents` 直接处理** | **P3（文档化即可）**：在 registry 头注释声明「editor 命令行为真理源 = PM keymap，defaultShortcut 仅展示」 |
| 5 | **useDocumentSession(505 行) / settings store(430 行) 多职责** | 前者 7 类流程（打开/保存/另存/改名+互链/自动保存/冲突/外部修改）；后者 schema+持久化+主题应用+置顶+焦点模式 | **P2**：按「会话 / 改名互链 / 自动保存」拆 composable；settings 拆出主题应用 |

Rust 侧整体健康（main/lib 分界清晰、5 个 managed state 消费方固定、菜单事件定向分发）。两个小刺：`image.rs:1` 横向引用 `document.rs` 内部 `mime_to_extension`（应提到共享模块）；4 个命令定义滞留 `lib.rs`（`startup_ready`/`new_editor_window`/`refresh_native_menu_shortcuts`/`detect_proxy_for_update`/`reveal_startup_open_log`，应归位 commands/）。

### 4.3 逻辑清晰性正面清单（值得保持的设计）

- 命令执行**单一出口**：`useCommandDispatcher.executeCommand` 是全仓唯一执行器，菜单/快捷键/面板三源汇流。
- 服务层**零反向依赖**、脏态**唯一真相源**（`file.ts::syncEditedContent` 语义比对）、防抖**刻意分层**（150/100/500ms）。
- 拖拽 `Set<DragDropHandler>` 广播 + per-handler try/catch + 快照迭代——历史教训均已固化在代码里。

## 5. 代码健康（冗余 / 僵尸代码）

全量扫描（静态 import + 动态 import + defineAsyncComponent + CSS @import 全覆盖）：

- **僵尸代码**：仅 `src/themes/index.ts`（6 行 barrel，全仓零引用，**已删**）+ `CommandSource` 的 `'titlebar'|'ui'` 两个死成员（**已收窄**）。
- **未引用导出**：0。**注释掉的代码块**：0。**调试残留**：0。**TODO/FIXME**：0。
- **重复实现 2 组**：① `basename` ×2（wikilink-drop/wikilink-suggest）——**已去重**（drop 导出，suggest 引入）；② 双 markdown-it 管线（编辑器 `parser.ts` vs 预览 `utils/markdown-to-html.ts`，后者仅 `StatusbarQuickActions.vue` 一个消费者）——**评估后保留**：两者输出目标不同（PM doc vs HTML 字符串），合并非低风险，列为 P2 收敛候选（可共享插件装配清单）。
- **上帝文件**：`document.rs`(1534) / `MarkdownEditor.vue`(832) / `App.vue`(731) 三处多职责混杂；其余大文件（serializer 865 / markdown-input 742 / markdown-paste 678）均为单一职责的合理体量，**勿为拆而拆**。

## 6. Typora 对比与差距决策单

**约束**：`docs/solo互链方案-2026-09-11.md:33`——「单纯为对齐 Typora『人人都有』而加功能，违背产品精神，默认不加」。故本节产出**决策单**，不擅自实现。Typora 功能清单经官方文档核实（typora.io / support.typora.io）。

### 6.1 已对齐（无需动作）

WYSIWYG、大纲面板、焦点模式（solo 为段落级，Typora 为行/块级）、自动保存（**两者默认都关**）、拼写检查、数学/图表、代码块高亮、表格操作、字数统计、全屏、主题系统、按需字体。**solo 反超项**：WikiLink 全家桶（补全/跳转/建档/拖入成链）、Callout 12 色、Slash 命令、Emoji 补全、多进程多窗口、脚注/Frontmatter 节点。

### 6.2 决策单（Typora 有、solo 无）

| # | 差距 | Typora 行为 | 建议 | 理由（价值 × 成本 × 产品精神） |
| --- | --- | --- | --- | --- |
| 1 | **最近文件快开** | File → Recent Files | **建议做（P1）** | 高频刚需；纯体验补齐、不引入知识库结构，与产品精神相容；成本低（Rust 记最近路径 + 命令面板「最近文件」分组，即 §二 #4 原方案） |
| 2 | **阅读位置记忆** | 重开回到上次位置 | **建议做（P1-P2）** | 长文写作刚需；成本中（按文档路径持久化 scrollTop + 恢复时机要避开懒初始化竞态）；与产品精神相容 |
| 3 | **打字机模式** | 当前行垂直居中 | **可做（P2）** | 与「中文沉浸写作」定位契合；成本低（scrollToCursor 变体）；与焦点模式互补不冲突 |
| 4 | **打印 / PDF** | 完整导出系统 | **待拍板** | solo v1.2.18 刻意删除；但「存成 PDF/打印」是桌面编辑器合理预期。**轻量方案**存在：不加导出系统，只暴露打印通道（打印 CSS 已在位且持续维护）+ 另存 PDF。若拍板维持减法，则把 @media print 区删除或明确标注休眠理由 |
| 5 | **崩溃恢复/版本历史** | 系统级（macOS） | **暂不做** | solo 已有 `.tmp` 兜底 + 原子写；完整版本历史复杂度高、本地单文件场景收益边际；维持现状 |
| 6 | **TOC（`[toc]`）** | 支持 | **暂不做（P3）** | 大纲面板已覆盖导航需求；TOC 是导出场景功能，与减法方向冲突 |
| 7 | **查找正则** | 支持 | **可做（P3）** | 小成本补齐搜索能力，非刚需 |
| 8 | **表格列宽持久** | 导出保留列宽 | **已有台账（§二 #6，P2）** | GFM 无列宽语义，需私有扩展语法——注意 `|WxH` 图片私有语法的前车之鉴 |
| 9 | **源码模式** | View → Source Code Mode | **确认不做** | 产品定位即「所见即所得」；已有 `edit.copyAsMarkdown` 满足源码需求 |
| 10 | **文件树 / 工作区** | Files 侧栏 | **确认不做** | `docs/solo产品精神.md` 明言「不需要像知识库那样有侧边栏」——产品存在的理由本身 |
| 11 | **标题折叠** | Typora 同样没有 | **对齐，不做** | 与基准产品行为一致，无差距 |

## 7. 本次已执行修正清单

**文档一致性（13 处，全部「以代码为准」改文档）**：

1. `wiki/快速上手.md` / `wiki/图片与文档管理.md` / `wiki/常见问题FAQ.md`——「2 秒自动保存」→ 实情（默认关 / 设置开启 / 30s / 下限 5s）×3
2. `README.md:41` / `README.zh-CN.md:41`——auto-save 从开箱特性改为「可选（默认关闭）」×2
3. `wiki/快捷键速查.md`——查找 `Mod+G`→`Mod+F`、替换 `Mod+Shift+G`→`Mod+H`；补固定键位指引。**〔2026-09-14 已完成〕** 且 `Mod+K` / `Mod+/` 已收编进 registry，`updates` 只登记 `registry.ts`
4. `wiki/编辑器功能指南.md`——快捷键同步修正；焦点模式删打印从句；「复制为 HTML」改为双槽事实；「菜单打印」改为「已移除 + 替代路径」
5. `docs/TROUBLESHOOTING.md` §5——「导出 PDF 改名打印」失效条目改写为「打印/导出已移除 + 替代路径」
6. `ARCHITECTURE.md`——§7.2 重复段落去重；§10.2 标题与正文改「状态栏复制按钮（双槽）」；§12 对照表行同步
7. `README.md` / `README.zh-CN.md` / `README.ja-JP.md` / `README.ko-KR.md` / `wiki/Home.md`——硬编码测试数（618/34）→「以 `bun run test` 为准」×5（守 §二 #3 纪律）
8. `README.zh-CN.md:40`——主题数 6→8，主题名对齐 presets 真名（书卷气/夜读墨色/素笺/朱墨/朱墨暗/纸白/黛青/藕荷）
9. `src/commands/registry.ts:91`——「在 Finder 中」→「在系统文件管理器中」（Windows 文案残留）

**solo-tour.html（内嵌文档快照）**：**本次未做靶向替换**——该页 541KB 内嵌整份 README/ARCHITECTURE 旧快照，手改 `auto-save` / `618 测试数` 等靶向字串成本高、且会随源文档再次漂移，按「快照勿手改」原则**仅登记为已知风险、未手改**（见 §二 #16）；其余陈旧快照同此处理。

**代码清理（4 项落地 + 2 项登记取舍）**：

- 删 `src/themes/index.ts`（死 barrel）；`CommandSource` 删死成员 `'titlebar'|'ui'`
- `wikilink-suggest.ts` 删私有 `basename`，改用 `wikilink-drop.ts` 导出的共享实现
- `editor.css` lightbox `#fff` 加「主题不变 scrim 例外」注释（`mermaid-block.ts` `'#888888'` 为防御性兜底，保留）
- 双 markdown-it 管线评估后保留（输出目标不同），列 P2 收敛候选
- **台账登记（KNOWN-ISSUES.md §二）**：新增 #14（composables→components 层级环）/ #15（跨层全局单例 + 多职责上帝文件 + Rust 两小刺）/ #16（打印可达性未实测 + solo-tour 漂移 + 双 markdown-it 管线）三条结构债台账，与 §4.2 呼应

## 8. 后续路线建议

- **P0**：无（本次已清完；无数据丢失级未修项——§二 #10/#11 已修、#13 有 characterization 锁）。
- **P1**：最近文件快开（§二 #4 决策单已给方案）；阅读位置记忆；（可选）层级环拆解（§4.2 #1）。
- **P2**：document-scale 收编；MarkdownEditor wikilink 业务下沉；useDocumentSession/settings 拆分；表格列宽（§二 #6）；双管线收敛；Rust 两小刺；打印可达性实测（`dev:tauri` 按 Ctrl+P 一次即知）后决定 @media print 区去留。
- **P3**：打字机模式、查找正则、TOC（决策单）。

## 9. 审计边界（未覆盖项，如实声明）

- **行为层未起 GUI**：功能核查以代码 + 测试层为准；`dev:tauri` 手测（复制双槽体感、大文档输入、IME、打印可达性）不在本次范围。
- **Rust 编译**：本机跑 `cargo check` 需要 MSVC 环境（`M:\VS`），本次无 Rust 代码改动未触发；若后续动 Rust，CI 是最终闸门。
- **Typora 功能清单**：经官网核实核心项（焦点/打字机/导出/自动保存/拼写检查/源码模式），个别边缘项（如版本历史细节）以官方文档为准未深挖。

## See also

- [功能全表](./FEATURE-MATRIX.md)（核查清单与状态） · [已知问题与技术债](./KNOWN-ISSUES.md)（§二 #14-#16 为本次新增）
- [架构真相地图](../ARCHITECTURE.md) · [产品精神](./solo产品精神.md) · [互链方案（含 Typora 对比纪律）](./solo互链方案-2026-09-11.md)
- [项目工作手册](../AGENTS.md)（§七 联动矩阵）
