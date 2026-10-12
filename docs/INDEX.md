---
title: 文档索引与术语表
type: core
audience: agent
status: active
tags: [核心文档, 索引, 导航, 术语表]
summary: 全仓库文档唯一索引：每份的 tag/摘要/状态/联动对象，AI 识别文档的第一站
updates: [AGENTS.md, docs/KNOWN-ISSUES.md, docs/HANDOVER.md]
---

# docs/INDEX.md — 文档索引与术语表

> 接手者第一站（`HANDOVER.md`）之外的「地图」。所有文档按受众/状态列清，废弃项显式标出。
> **frontmatter 标准定义见 [`DOC-STANDARD.md`](./DOC-STANDARD.md)**；本文是每份文档 tag/摘要的落地清单。
> **事实在哪改：见 [`docs/agent-playbook.md`](./agent-playbook.md) §A 真理源地图。什么时候才动文档：见 [`AGENTS.md`](../AGENTS.md) §3**（默认不动，三类触发才动）。

## 文档地图（全量，含 tag/摘要）

> 本表每个路径均可点击。相对路径，仓库移动也不碎。`type`/`status` 与各文件 frontmatter 一致。

### 根目录（对外 + 核心 3 + 排查）

| 路径                                                   | type    | 受众      | 状态   | tag / 摘要                                                        |
| ------------------------------------------------------ | ------- | --------- | ------ | ----------------------------------------------------------------- |
| [`README.md`](../README.md)（+ zh-CN / ja-JP / ko-KR） | product | user      | active | 产品导览：介绍、安装、dev 起步。4 语言本地化，DOC-STANDARD §二 确认保留 |
| [`AGENTS.md`](../AGENTS.md)                            | core    | agent     | active | Agent 契约**最小集合**：角色权限 + 硬禁令 + 按需加载指针 + 文档纪律。**必读** |
| [`docs/agent-playbook.md`](./agent-playbook.md)        | core    | agent     | active | AGENTS.md 的**展开层**（按需加载）：真理源地图 / 敏感区速查 / 工作流与验收 / 禁令理由 |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md)                | core    | dev       | active | 架构真相：技术栈版本/命令清单/目录树（敏感区速查见 ./sensitive-areas.md）             |
| [`docs/sensitive-areas.md`](./sensitive-areas.md) | core | dev | active | 敏感区安全网：易错区速查表 + §11.1–§11.8 详解（改码前必读） |
| [`BUILD_GUIDE.md`](../BUILD_GUIDE.md)                  | core    | dev       | active | 构建手册真理源：工具链/环境变量/编译命令/故障排查                 |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)           | guide   | user      | active | 用户侧运行时故障排查（症状→修法）                                 |
| [`CLAUDE.md`](../CLAUDE.md)                            | guide   | agent     | active | Agent 入口指路牌（Claude Code）：仅指向 AGENTS.md，不复制规则内容 |
| [`.cursor/rules/solo.mdc`](../.cursor/rules/solo.mdc)  | —       | agent     | active | Agent 入口指路牌（Cursor）：仅指向 AGENTS.md，不复制规则内容。⚠️ **豁免 DOC-STANDARD frontmatter** —— `.mdc` 用 Cursor 规定的 `description`/`globs`/`alwaysApply`，故三列是派生登记而非源 |

### docs/ 核心真理源

| 路径                                         | type  | 受众       | 状态   | tag / 摘要                                    |
| -------------------------------------------- | ----- | ---------- | ------ | --------------------------------------------- |
| [`INDEX.md`](./INDEX.md)                     | core  | agent      | active | 本文：文档索引 + 术语表                       |
| [`KNOWN-ISSUES.md`](./KNOWN-ISSUES.md)       | core  | agent      | active | 待办/已知坑真理源：§一 已修复、§二 待办       |
| [`CHANGELOG.md`](./CHANGELOG.md)             | core  | maintainer | active | 版本变更史（唯一真理源，由真实 git log 整理） |
| [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) | core  | maintainer | active | 发版流程真理源：Phase 定义/回滚/故障处理      |
| [`HANDOVER.md`](./HANDOVER.md)               | guide | agent      | active | 接手入口：30 秒定位 + 真理源文件表 + 环境搭建 |
| [`FEATURE-MATRIX.md`](./FEATURE-MATRIX.md)             | core  | agent      | active | 功能全表：逐项功能 × 实现锚点 × 状态 × 缺口（供 Agent 核查完善程度） |
| [`DOC-STANDARD.md`](./DOC-STANDARD.md)                 | core  | agent      | active | 文档规范真理源：SSOT/DRY/减文件/死链即 Bug/frontmatter 字段标准      |
| [`LESSONS.md`](./LESSONS.md)                           | guide | agent      | active | 踩坑方法论库：从历史事故提炼的可复用思维模式（按模式聚类，索引台账） |

### docs/ 指南与决策

| 路径                                                                                   | type  | 受众             | 状态   | tag / 摘要                                                |
| -------------------------------------------------------------------------------------- | ----- | ---------------- | ------ | --------------------------------------------------------- |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md)                                                 | guide | dev        | active | 协作规范：开发环境/提交纪律/PR 流程                       |
| [`SECURITY.md`](./SECURITY.md)                                                         | guide | maintainer       | active | 安全披露政策 + 攻击面 + 当前版本号                        |
| [`PLAYBOOK.md`](./PLAYBOOK.md)                                                         | guide | maintainer | active | 发布全生命周期剧本（A–F 六阶段总纲）                      |
| [`PUBLISH_GUIDE.md`](./PUBLISH_GUIDE.md)                                               | guide | maintainer       | active | 发版小白实操版（3 条命令），真理源 RELEASE_PROCESS        |
| [`发布流程科普（从写完代码到用户下载）.md`](./发布流程科普（从写完代码到用户下载）.md) | guide | user             | active | 发版原理大白话科普，真理源 RELEASE_PROCESS                |
| [`debugging.md`](./debugging.md)                                                       | guide | agent            | active | 开发者侧调试指南（DevTools/cargo/bun 兜底/快捷键拦截）    |
| [`cjk-boundary.md`](./archive/cjk-boundary.md)                                                 | guide | dev              | archive | CJK 加粗边界经验（parser/serializer 必读）                |
| [`font-handling.md`](./font-handling.md)                                               | guide | agent            | active | 字体处理手册：asset:// 首选 + 字节兜底/CORS 陷阱/排查树   |
| [`network-proxy-guide.md`](./network-proxy-guide.md)                                   | guide | maintainer       | active | 更新检测代理（环境变量/注册表/端口探测）                  |
| [`paste-compat-decision.md`](./archive/paste-compat-decision.md)                               | guide | maintainer | archive | 粘贴兼容性决策备忘                                        |
| [`ui-redesign-handover.md`](./archive/ui-redesign-handover.md)                                 | guide | agent            | archive | UI 改造交接（活跃分支 refactor/editor-decouple）          |
| [`ui-typography-eval.md`](./archive/ui-typography-eval.md)                                     | guide | agent            | archive | 排版微调 + 文字变浅评估（设计决策留痕，§一 为改动前快照） |
| [`BENCHMARK-editing-experience.md`](./BENCHMARK-editing-experience.md)                 | guide | agent            | active | 编辑体验行业对标基线：三种编辑形态 + 逐项基准 × solo 差距 + 下一优先建议（「所有问题先对标」方针的常驻挂靠点） |
| [`00-今日修改总览-2026-10-10.md`](./archive/00-今日修改总览-2026-10-10.md)                     | archive | maintainer      | archive | 2026-10-10 当日 39 个提交的系统梳理（时间线 / 解决与未解决 / 可控性评估）；**一次性快照**，未结项一律以 [`KNOWN-ISSUES.md`](./KNOWN-ISSUES.md) 为准 |
| [`agent-delivery-method.md`](./agent-delivery-method.md) | guide | agent | active | 任务交付 SOP：计划/改码/提交卫生（白名单+部分暂存）/静态三层/真机 CDP 验收/沟通，设计审核两轮实战固化 |
| [`handoff-design-p3-2026-10-13.md`](./handoff-design-p3-2026-10-13.md) | guide | agent | active | 设计审核 P3 交接：P1/P2 已交付（含 commit），P3 三项待办+真机验收环境+工作区在制品保护；销项后归档 |

### docs/ 原则、提案、归档

| 路径                                                                         | type      | 受众             | 状态     | tag / 摘要                                                               |
| ---------------------------------------------------------------------------- | --------- | ---------------- | -------- | ------------------------------------------------------------------------ |
| [`project_rules：工作原则和纪律.md`](./project_rules：工作原则和纪律.md)     | principle | agent            | active   | 最高准则：实事求是/第一性原理/共识前置/多层验证（通用底线真理源）        |
| [`architecture：产品开发总原则.md`](./architecture：产品开发总原则.md)       | principle | dev        | active   | 技术设计原则：SSOT/高内聚低耦合/决策阶梯/绝不硬编码/退化安全             |
| [`solo产品精神.md`](./solo产品精神.md)                                       | principle | dev              | active   | 产品理念：极简/极速/优雅 + 灵活/高效/可拓展                              |
| [`solo外部文件监听方案.md`](./archive/solo外部文件监听方案.md)                       | archive   | maintainer | archive  | 外部文件监听（Agent Sync）技术方案——**未执行**，已归档           |
| ✅ [`PROPOSAL-cell-fidelity.md`](./PROPOSAL-cell-fidelity.md) | proposal | maintainer | active | **表格单元格的保真缺口**（台账 §二 #61 + #60 + #63）：**⚠️ 部分落地**（2026-10-11）。**#61** = `serializer.atBlockStart()` 把**格首**判成「块内容起点」⇒ 格首 `-`/`+`/`>`/`#`/`1.` 被加平白反斜杠——**已修，但只覆盖第一行**（`:570-571` 两条按 `\n` 的规则不受守卫管辖 ⇒ 多行代码块仍 R1≠R2，见 §10）；**#60** = 格内块级结构存不住 ⇒ **已拍平成行内文本，但只做到格的直接子块这一层**（容器内部的兄弟块仍黏连、`checked`/`start` 等 attrs 输入消失，见 §10）；**#63** = 格内换行用的 `<br>` **只写不读**（`html:false` ⇒ 重开是字面标签）——**产品级，待拍板** |
| [`PROPOSAL-list-outline-experience.md`](./archive/PROPOSAL-list-outline-experience.md) | proposal | maintainer       | archive | 列表区幕布式大纲体验（只改列表、非列表区零改动；不改格式不引依赖）：**阶段 1-2 已实现**（折叠 / 悬停箭头 / 嵌套引导线，待真机验收），**阶段 3-4 决定不做**；§九 为落地记录 |
| [`PROPOSAL-list-row-drag.md`](./PROPOSAL-list-row-drag.md) | proposal | maintainer       | proposal | 列表行**拖拽换位（仅同层）**：鼠标抓把手上下拖整行换位、一次撤销可还原、格式零改动；含难易评估与四决策（建议独立把手）、分阶段验收；**跨层/圆点即把手暂不做**；未执行 |
| [`PROPOSAL-list-structure-fix.md`](./archive/PROPOSAL-list-structure-fix.md) | proposal | maintainer | archive | 列表结构与回退行为修复：**列表项开头按 Backspace 会把列表劈成两段并留下孤立段落**（实测确认，是 `Alt+↑/↓` 挪不动的真因）；含三处根因、三方案对比、影响面评估与 Phase 0–4 计划；**方案未执行**——2026-10-10 追加独立复审（§十）：诊断成立，但方案 A 的 `joinBackward` 预判被实测推翻、`Mod-Backspace` / `Shift-Tab` / 引用块同罪未覆盖，另牵出 KNOWN-ISSUES §二 #25–#29 |
| [`PROPOSAL-list-semantics.md`](./PROPOSAL-list-semantics.md) | proposal | maintainer | active | **列表语义契约（规则来源）**：Markdown 里没有树、只有缩进 ⇒「清除格式」不得重排树，「转普通段落 / toggle 第二次」才处理层级且直属下级减一级；含动词表、业界依据（Word / Notion / Obsidian / Typora）与已知边界。改列表相关命令前先读它 |
| [`TODO-list-semantics-round2.md`](./archive/TODO-list-semantics-round2.md) | proposal | maintainer | archive | **#50 第二轮修复执行清单**：🔴A（待办 toggle 出 `- [ ] - 乙`）与 🔴B（段落缩进残留）已修完并经真机验收；🔴C（嵌套项转段落 relocate 顺序代价）已拍板「接受」；含验收闸门与「断言必须能红」的三查判据 |
| [`REVIEW-PLAN-第三方全面审查-2026-10-09.md`](./archive/REVIEW-PLAN-第三方全面审查-2026-10-09.md) | proposal | maintainer | proposal | 第三方全面审查**作业书**（宏观→微观，对标 Typora/Obsidian）：目标口径/差分定位（不重复既有 4 轮审查）/交底材料包/三层审查法/交付物与红线；**仅方案，未执行** |
| [`architecture/refactoring-report.md`](./architecture/refactoring-report.md) | archive   | agent            | archive  | 减法重构历史报告（22→17 命令等，**历史快照**，现状以 ARCHITECTURE 为准） |
| [`archive/settings-audit-report.md`](./archive/settings-audit-report.md)     | archive   | agent            | archive  | 设置面板排查历史报告（P0 死代码已清理，**历史快照**）                    |
| [`catpaw审核/丝滑体验优化复盘.md`](./archive/catpaw-2026-08-21/丝滑体验优化复盘.md) | archive | dev/agent | archive | 丝滑优化（P0-P3）全流程复盘（整批 13 份已归档至 archive/catpaw-2026-08-21/） |
| [`large-document-performance.md`](./archive/large-document-performance.md)            | archive   | dev              | archive  | 大文档卡顿根因清单与分阶段方案（**P0/P1 已实施、P2 已砍、P3 简化**，已归档） |
| [`optimization-plan-2026-09-06.md`](./archive/optimization-plan-2026-09-06.md)        | archive   | maintainer       | archive  | 全面审查优化方案：30 条发现（已逐条核实，交互/兼容/性能）+ P0-P3 分批路线图（**执行待拍板**，已归档） |
| [`project-plan-2026-08-29.md`](./archive/project-plan-2026-08-29.md)                  | archive   | maintainer       | archive  | 产品演进建议清单（**非强制任务**，逐项可执行可不执行，已归档）            |
| [`solo互链方案-2026-09-11.md`](./archive/solo互链方案-2026-09-11.md)                  | archive   | agent | archive  | 互链一期方案（v5 定稿，已实施）：修 `[[`/`![` + 拖入即在落点成链（含审核收口） |
| [`执行记录-互链方案-2026-09-11.md`](./archive/执行记录-互链方案-2026-09-11.md)        | archive   | maintainer       | archive  | 互链一期执行/自检/回滚记录（执行人 qianwen；含落点收口补记；拖拽坐标待真机验证 → 未结项见 KNOWN-ISSUES §二 #9） |
| [`执行记录-剪贴板纯文本范式-2026-09-12.md`](./archive/执行记录-剪贴板纯文本范式-2026-09-12.md) | archive | maintainer | archive | 剪贴板范式改造执行记录：复制默认改「干净纯文本」+ 显式源码入口；决策依据/证据链/回滚点/残余风险/评审清单（**供第三方评审**） |
| [`solo深度审查报告-2026-09-11.md`](./archive/solo深度审查报告-2026-09-11.md)          | archive   | maintainer       | archive  | 四层只读审查（渲染/交互/速度/结构）：8 条发现 + 逐条处置记录（5 修 3 缓）        |
| [`architecture-review-2026-09-12.md`](./archive/architecture-review-2026-09-12.md)   | archive   | maintainer       | archive  | 核心逻辑与结构架构审查：四维度结论 + P0-P2 建议（**已被 09-14 审计/09-15 评估覆盖**，已归档） |
| [`PERF-AND-THEME-SUGGESTIONS-2026-09-18.md`](./archive/PERF-AND-THEME-SUGGESTIONS-2026-09-18.md) | archive | maintainer | archive | 性能/主题再优化空间评估：A 低风险 / B 中风险 / C 不建议三级（**未动代码，建议留档**，已归档） |
| [`AUDIT-REPORT-2026-09-14.md`](./archive/AUDIT-REPORT-2026-09-14.md) | archive   | agent            | archive  | 六维度全量审计快照（v1.2.54）：三闸门基线 · 逐项功能核查 · 耦合热点与解耦分级 · Typora 差距决策单（**结论已进 KNOWN-ISSUES §二 #14-#16**，已归档） |
| [`solo输入法合成冻结总闸方案-2026-09-13.md`](./archive/solo输入法合成冻结总闸方案-2026-09-13.md) | archive | agent | archive | 千问「合成冻结总闸」历史提案（**部分前提已被证据推翻**，作留痕用）；现况以 [IME-结案经验卡](./archive/IME-结案经验卡-2026-10-12.md) 为准 |
| [`IME-CANDIDATE-WINDOW.md`](./archive/IME-CANDIDATE-WINDOW.md) | proposal | agent | archive | ⭐ **IME 候选窗失锚·主题唯一入口**（2026-09-30 由 4 份蒸馏合并，原件入 `archive/`）：🛑 已封存 + 5 条封存结论 · 锚点实测台账 · 已排除/死路清单 · 鼠标注入补丁三版全败史 · 外部 5 份建议评估 · 重启执行顺序 · 档案索引；**2026-10-12 已蒸馏为 [IME-结案经验卡](./archive/IME-结案经验卡-2026-10-12.md)，现况以其为准** |
| [`archive/IME-CANDIDATE-WINDOW-*.md`](./archive/IME-CANDIDATE-WINDOW-PLAN.md) | archive | agent | archive | 同上主题的 **4 份历史原件**（PLAN / REPORT / SOLUTION / 观点对照），2026-09-30 蒸馏后归档，仅作留痕、不再维护 |
| [`REVIEW-2026-09-15-体验与代码评估.md`](./archive/REVIEW-2026-09-15-体验与代码评估.md) | proposal    | maintainer            | active   | 系统性评估（体验/保真/性能/代码）：12 类问题 + 逐条修复与实测收口（§7 行动清单含状态列、§9 复核结果；头号发现序列化 O(n²) 已修） |
| [`REVIEW-2026-10-09-第三方全面审查-批1-宏观与对标.md`](./archive/REVIEW-2026-10-09-第三方全面审查-批1-宏观与对标.md) | proposal | maintainer | active | 按 [`REVIEW-PLAN`](./archive/REVIEW-PLAN-第三方全面审查-2026-10-09.md) 执行的**批 1 交付**（只读，未改码）：09-15「已修 6 项」验收口（5 成立 / 2 项无回归防线）· 入口四源一致性 11 条问题（Ctrl+H 与死菜单项撞键待实测）· 对标差距决策单。**一次性快照，结论未进台账** |
| [`REVIEW-2026-10-09-第三方全面审查-批2-中观层.md`](./archive/REVIEW-2026-10-09-第三方全面审查-批2-中观层.md) | proposal | maintainer | active | 同计划的**批 2 交付**（只读）：结构债 5 热点复审（1 项恶化）· **可复现性能新基线**（50 万字 124ms；固定字符块数 ×17.6 而耗时 ×1.26 ⇒ k=0.08，O(n²) 已死的量化证明）· 保真四网强度复核（硬判据确实在位 + 5 类新盲区）· 稳定安全 12 条（GBK 打不开 / 注册表越界删 / 崩溃恢复素材已在位）· 粘贴兼容性。**结论未进台账**；测量脚本 [`review-artifacts/perf-baseline-2026-10-09.ts`](./archive/review-artifacts/perf-baseline-2026-10-09.ts) |
| [`REVIEW-2026-10-09-第三方全面审查-批3-微观层.md`](./archive/REVIEW-2026-10-09-第三方全面审查-批3-微观层.md) | proposal | maintainer | active | 同计划的**批 3 交付**（只读，**收官**）：三闸门全绿（1547 / vue-tsc 0 错 / build 16.76s）· 代码健康实测 + **对上轮 2 处结论的更正** · **复制为 HTML 对 4 种自家语法失真** · 幽灵依赖 7 个 + mac 臂漏 re-export（§一 #32 同型复发）· 文档漂移逐条（B-1/B-2/B-5 未清根 + 6 条真死链 + 薛定谔归档）· 账龄表 · **折叠×换位实测互斥**。**结论未进台账**；探针 [`review-artifacts/`](./archive/review-artifacts/) |
| ⭐ [`REVIEW-2026-10-09-第三方全面审查-问题总账.md`](./archive/REVIEW-2026-10-09-第三方全面审查-问题总账.md) | report | agent | active | **三轮审查的单一入口**（供其他 Agent 复查）：41 条编号问题（P1×7 / P2×19 / P3×15）· **§2 勘误表：8 条批间互相推翻的结论** · §6 「已验证无需动作」13 组（防重复上报）· §7 待实测定级 4 条含可复制步骤 · §8 **每条该落进哪个权威文件的工单映射**。冲突时**以本表为准** |
| [`solo互链改名同步方案-2026-09-11.md`](./archive/solo互链改名同步方案-2026-09-11.md)  | archive   | maintainer | archive  | 互链改名同步方案：改文件名后同步指向本文档的 `[[链接]]`（同目录、先列清单确认再原子改写），**代码已随 v1.2.53 落地** |
| [`REVIEW-2026-10-09-qoder审查-独立核实结论.md`](./archive/REVIEW-2026-10-09-qoder审查-独立核实结论.md) | proposal | agent | active | 对问题总账的**独立核实**（只核不修）：逐条回第一现场取证（重跑 grep / 读实现原文 / 数实例）——基线 4/4 准 · P1×7 全静态成立 · P2 18 成立 + 1 待实测 · P3 抽样全成立 · §6 硬禁令抽核全准 · **无一条被证伪**；并记录报告自身 4 处计数/行号偏差，文末附**决策记录**（各项修/不修与理由）。修复落账见 [`CHANGELOG`](./CHANGELOG.md) `[Unreleased]` |
| ⭐ [`REVIEW-2026-10-10-保真链路修复审核材料.md`](./archive/REVIEW-2026-10-10-保真链路修复审核材料.md) | report | maintainer | active | **2026-10-10 会话的完整审核底稿**（供第三方独立审核）：7 提交 / 15 文件 / 4 个问题（**2 修 · 2 改判为设计取舍**）/ 3 项护栏与纪律 / **3 处自我订正** / 6 项未验证披露；含复现命令与「请重点挑战的 7 个问题」 |
| ⭐ [`REVIEW-2026-10-10-保真链路修复-第三方审核结论.md`](./archive/REVIEW-2026-10-10-保真链路修复-第三方审核结论.md) | report | maintainer | active | 对上述底稿的**独立复审结论**（只审不改，原稿未动）：两处代码修复判定正确可合入 · **「ZWNJ 覆盖已闭环」不成立——实测漏掉「属性携带的文本」一整类，6 个落点把 U+200C 写进用户文件**（本仓 0 命中，属潜在）· 体检工具对四类问题结构性全盲且只报告不断言 · §11 七问逐条作答 · 另查出 4 处计数/行号断言失效 · 性能实测 11.6 万字 parse 46.5ms 无阻塞；探针 [`review-artifacts/zwnj-attrs-probe-2026-10-10.ts`](./archive/review-artifacts/zwnj-attrs-probe-2026-10-10.ts) |
| ⭐ [`REVIEW-2026-10-10-属性通道补口-复审.md`](./archive/REVIEW-2026-10-10-属性通道补口-复审.md) | report | maintainer | active | 对补口提交 `d1b7cd7`+`510d04b` 的**第二轮复审**：**本方 §八「潜在落点」判定被实测证伪**（未闭合 `**`+标点当下即落盘，已在原报告标注订正）· 8 条 Phase A4 锁经**反向校准为真锁**（`stripZwnj` 改恒等 ⇒ 22 红）· 6 项文档订正全部落地对账 · **但 `href`/`src` 仍是落点**（1 处 `escapeLinkDestination` 可收口）· attrs 只锁落盘、内存与 DOM 侧仍脏（与 math 的入口路线不对称）· 建议改走「遍历 schema 字符串属性」的集合锁防第四次 |
| ⭐ [`REVIEW-2026-10-10-第三方审核结论-独立核实.md`](./archive/REVIEW-2026-10-10-第三方审核结论-独立核实.md) | report | maintainer | active | **对第三方结论的逐条独立复现**（不采信自述、自写探针）：**11 条全部成立、无一条被证伪**（唯一微差：F-5 行号 62→63）；加值**排除 2 个候选落点**（互链 target/alias、callout.title）把 F-1 清单钉成"完整"；**我方待订正 6 处**（含 1 处实质否定：材料 §4「已闭环」不成立）；未复测对方性能数字（已标注） |
| ⭐ [`REVIEW-2026-10-10-数据安全线复审-二次核实.md`](./archive/REVIEW-2026-10-10-数据安全线复审-二次核实.md) | report | maintainer | active | 对「文档保存数据安全线」的**只读审核合并底稿**：首审 9 条 + 第三方逐条推翻 + 本方再核（认错 4 处 / 补正 3 处）+ 终核净结果；**P2-④ 死代码证伪**、P1-② 双方均未复现、台账 §二 #20 过期已更正；未改任何代码 |
| ⭐ [`REVIEW-2026-10-11-单元格保真收口复查.md`](./archive/REVIEW-2026-10-11-单元格保真收口复查.md) | report | maintainer | active | 对 `536fd07`（#61 + #60 B1 落地件）的**独立复查**（被审文档与代码一字未动）：**方向全部证实**（块语法确实一个不进单元格、格首确实不再加反斜杠），**但三条口径证伪**——① 拍平只到**格的直接子块**这一层（容器内部兄弟块仍黏连 `买奶写码`）；② `checked` / `start` 这类 **attrs 里的用户输入整体消失**；③ 格内换行用的 `<br>` **solo 读不回来**（`html:false`）⇒ 多块格子的默认落盘形态重开是字面标签。另证伪「`\n` 不对称是合成形态不可达」：**多行 `codeBlock` 就是含 `\n` 的文本节点且可达**（`toggleCodeBlock` 实测 `true`）⇒ R1≠R2。**我方已独立复跑证实全部三条**（含既有锁 `roundtrip.spec.ts`「table cell hard break as br」断言字面 `<br>`、我方 Phase N 那条多行锁按构造恒真）。含 §6 三小刀 + 换尺子建议与 §7 五条挑战回话 |
| ⭐ [`REVIEW-2026-10-11-编辑器交互内核线审核.md`](./archive/REVIEW-2026-10-11-编辑器交互内核线审核.md) | review | maintainer | active | **编辑器交互内核线只读审核**（组字态中枢 / 列表操作 / Suggestion 门控 / NodeView 生命周期）：6 问题 + 12 项实测无反例；happy-dom 探针 + **真实 Chromium(CDP) 实锤**；**已过 Qoder 复审并按 §5 订正 11 处**。**落地**：**F1/F2/F4/F5 已修**（各有反向校准 + 真机读数，§5.1/§5.2），**F3 交 qoder**、**F6 不做** |
| ✅ [`PROPOSAL-list-shifttab.md`](./archive/PROPOSAL-list-shifttab.md) | proposal | maintainer | archive | 列表内 **Shift+Tab 语义收编**：**已按方案 B 落地并真机复核**（顶层项内一律 no-op、门槛只看在不在项内；反向校准 5 条转红；嵌套项仍收一级）。**A 案（接到托孤落点）已实测证伪**（产物与现状 offset>0 四格逐字相同）；有选区两格（D2）拍板「暂不行动」，用现状登记锁住 |
| ⭐ [`REVIEW-2026-10-11-编辑器交互内核线-二批落地复查.md`](./archive/REVIEW-2026-10-11-编辑器交互内核线-二批落地复查.md) | report | maintainer | active | 对上面那份审核 **§5.1/§5.2 两批落地**的复查（被审文档一字未动）：F1/F2/F4/F5 **四条修复全部证实**、**四处反向校准逐条实跑复现**（5 红 / 1 红 / 1 红 / 1 红）；新查出 **§二 #60**（单元格里**能落进 9 种块、其中 8 种 R1≠R2**——独立复跑订正：`callout` **原稿表内已有**、错的是同段散文写「7 个块型」，非漏列；`heading` 已修）、**§二 #61**（更深一层根因：`atBlockStart()` 把格首当块首 ⇒ **第三方手写表格「保存即被改写」**，与斜杠菜单无关；含**全仓保真体检实跑读数**与「打开不会改、保存才改」的前提核实）与 **§二 #62**（嵌套加粗掉格式，扁平 mark 模型的结构性限制，**登记不修**）与 F4 一处残留误报（附一行补丁）；订正交接里「F3 在 happy-dom 测不到」（实为可调 PM 的 `handleTextInput` prop）与「`[ ] ` 规则在 TaskList」（实在 **TaskItem**）。**含 F3 落地记录**：新增 `list-input-guard.ts`、11 条锁、反向校准 6 红、全量 1789 绿 |
| ⭐ [`REVIEW-2026-10-11-编辑器交互内核线审核-复审.md`](./archive/REVIEW-2026-10-11-编辑器交互内核线审核-复审.md) | report | maintainer | active | 对上面那份审核的**独立复审**（自写探针复跑，被审文档一字未动）：F1–F4 **证实**（F1 逐字复现，但形态是**四种**不是两种）、F5 代码成立**计数错**（7 处非 6 处）、F6 代码前提全对而**承重前提（摘 DOM 是否派发 blur）未证**；新增**有选区 Shift-Tab 更坏**（单项内照旧劈 / 跨项选区**整张列表归零**）、单元格标题的序列化落点在 `cellToText` 的 `renderNode` 分支（只改入口堵不住）、F4 的放大因子是 `allowedPrefixes:null`；订正 3 处行号/包名、指出台账 #26 矛头指错一句；**最重：证伪原稿修复方向①＝方案 A 案**（`demoteListItemToBlock` 中间项产物与「劈开」落盘串逐字相同 ⇒ 零疗效），B 案维持但理由须换，并点名方案 §2 与 §8 自相矛盾、契约 `:48` 与 #26 同形两判 |
| ⭐ [`REVIEW-2026-10-11-单元格保真收口复查.md`](./archive/REVIEW-2026-10-11-单元格保真收口复查.md) | report | maintainer | active | 对 `536fd07`（#61 一行守卫 + #60 决策二 B1 拍平）的复查（**未改任何代码**、被审文档一字未动）：**方向与落点证实**（块语法一个不进格子、格首不再平白加反斜杠），但按第一性原理**证伪三条口径**——① 拍平的分分隔只加在**格的直接子块**层（`serializer.ts:883`），`:296` 递归下钻**不插分隔** ⇒ 列表两项黏成 `买奶写码`（键入 / HTML 粘贴两条通道实测都黏，且 R1===R2 全绿：**收敛≠保真**）；② `checked`/`start` 这类 attrs 里的**用户数据**整体消失；③ 分隔符 `<br>` 在打开路径**读不回来**（`parser.ts:113` `html:false` ⇒ `:683-684` 是死代码、既有锁 `roundtrip:413-417` 就断言它是字面文本）⇒ 重开是一串 `<br>` 字符。**#61 只修了第一行**：`:570-571` 两条按 `\n` 的规则不受守卫管辖 ⇒ 格内多行代码块仍 R1≠R2（台账「合成形态、产不出」的判定**证伪**：`codeBlock`/`mermaidBlock`/`mathBlock` 的多行文字本就是含 `\n` 的文本节点）。**§7 五条挑战逐条回话**（§7.3 我实测代答：粘贴不丢字、丢边界；B2 确未做，`table.ts` 不在改动清单 ⇒ 格内四个命令照旧接管=true）。附「锁为什么看不见自己的洞」体检表 + 换尺子的判据建议 + 另三条尾巴核实（#57 修法**优于**我上轮补丁） |
| [`IME-ANCHOR-GUARD-2026-10-09.md`](./archive/IME-ANCHOR-GUARD-2026-10-09.md) | guide | agent | active | IME 重锚护栏的**修复档案**（可追溯）：分支/回滚点/验收判据（问题概率性 ⇒ 改为被动探针对账）/阶段记录/退出条件；触发面按真机反馈修订为「窗口移动 + 缩放」 |
| [`IME-问题简报与资料汇编.md`](./archive/IME-问题简报与资料汇编.md) | archive | user | archive | IME 候选窗失锚的**第三方统筹简报**（2026-09-30 已归档）：问题是什么 / 试过什么 / 卡在哪 / 给第三方的起点建议 + 4 份原始文档全文附录；现况以 [IME-结案经验卡](./archive/IME-结案经验卡-2026-10-12.md) 为准 |
| [`solo-tour.html`](./solo-tour.html)                                         | product   | user             | active   | 产品功能导览 HTML 页（非 md，无 frontmatter）                            |

### wiki/（用户知识库）

> 面向**使用者**的浏览型知识库（Home + 7 页），细节指向真理源不复制。入口 [`wiki/Home.md`](../wiki/Home.md)。

| 路径                                             | type  | 受众 | 状态   | tag / 摘要                                                         |
| ------------------------------------------------ | ----- | ---- | ------ | ------------------------------------------------------------------ |
| [`wiki/Home.md`](../wiki/Home.md)                | guide | user | active | Wiki 首页：功能速览 + 页面导航                                     |
| [`wiki/快速上手.md`](../wiki/快速上手.md)        | guide | user | active | 安装、首次启动、文件关联、多窗口、自动保存                         |
| [`wiki/编辑器功能指南.md`](../wiki/编辑器功能指南.md) | guide | user | active | 扩展语法写法、slash 命令、查找替换、焦点模式、复制为 HTML           |
| [`wiki/快捷键速查.md`](../wiki/快捷键速查.md)    | guide | user | active | 全部默认快捷键一览（真理源 `src/commands/registry.ts`）            |
| [`wiki/主题与字体.md`](../wiki/主题与字体.md)    | guide | user | active | 8 套主题、7 款字体、自定义主题、按需下载                           |
| [`wiki/图片与文档管理.md`](../wiki/图片与文档管理.md) | guide | user | active | 图片粘贴/拖拽/存储路径、自动保存、崩溃恢复、设置数据位置           |
| [`wiki/常见问题FAQ.md`](../wiki/常见问题FAQ.md)  | guide | user | active | 常见问题速答，完整排查指向 TROUBLESHOOTING（真理源）               |
| [`wiki/开发者入口.md`](../wiki/开发者入口.md)    | guide | dev  | active | 开发环境、接手必读、三条铁律速记（细节指向 BUILD_GUIDE/ARCHITECTURE） |

### 已退役 / 忽略

| 路径                          | 说明                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `.trae/documents/`            | 旧架构文档（文件树/workspace watcher 等），**一律忽略**，见 HANDOVER 警告                                                |
| `docs/performance` 等已删文档 | 性能优化修复方案 / ui-optimization-proposal / theme-eval / theme-color-audit / ColaMD对比solo —— 均已删，落地见 git 历史 |
| `.opencode/PROFILE.md`        | 技术档案（已与 ARCHITECTURE/CHANGELOG 去重，以二者为真理源），非本文范围                                                 |

## 文档联动表（快速查询）

> 事实真理源地图见 `docs/agent-playbook.md` §A；文档纪律见 `AGENTS.md` §3。此处为「想了解 X → 读哪份」的入口级速查。

| 想了解                       | 先读                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 项目是什么 / 怎么装          | `README.md` → `docs/solo产品精神.md`                                                                              |
| 接手项目从哪开始             | `docs/HANDOVER.md` → `AGENTS.md` → `ARCHITECTURE.md`                                                              |
| 代码结构 / 命令清单 / 敏感区 | `ARCHITECTURE.md`（总览）+ `./sensitive-areas.md`（速查表）                                                                                   |
| 怎么编译 / 环境怎么配        | `BUILD_GUIDE.md`                                                                                                  |
| 有什么已知坑 / 待办          | `docs/KNOWN-ISSUES.md`                                                                                            |
| 同类坑怎么想 / 踩坑方法论     | `docs/LESSONS.md`（思维模式）→ `AGENTS.md` §1（禁令清单）                                                          |
| 有哪些功能 / 各做到什么程度  | `docs/FEATURE-MATRIX.md` → `docs/KNOWN-ISSUES.md`                                                                 |
| 怎么调 bug                   | `docs/debugging.md` → `TROUBLESHOOTING.md`（用户侧）                                                              |
| 怎么发版                     | `docs/PLAYBOOK.md` → `docs/RELEASE_PROCESS.md` → `docs/PUBLISH_GUIDE.md`（实操）/ `docs/发布流程科普*.md`（原理） |
| 字体 / 主题 / 排版           | `docs/font-handling.md` → `docs/archive/ui-typography-eval.md` → `ARCHITECTURE.md`                                        |
| CJK 边界 / parser            | `docs/sensitive-areas.md` #23（ZWNJ 契约）→ `src/components/Editor/tiptap/markdown/parser.ts`                                        |
| 安全 / 漏洞报告              | `docs/SECURITY.md`                                                                                                |
| 历史版本都改了什么           | `docs/CHANGELOG.md`                                                                                               |
| 三层原则（为什么做/怎么做人/怎么写码） | `docs/solo产品精神.md`（产品定位·取舍准绳）→ `docs/project_rules：工作原则和纪律.md`（工作原则+执行纪律）→ `docs/architecture：产品开发总原则.md`（技术决策·决策阶梯）。**三份分工不同，不要合并** |

## 术语表（项目黑话）

| 术语               | 含义                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 脏态 (dirty state) | 文档相对磁盘是否被修改。A1 重构后由 `file.ts::syncEditedContent()` 语义比对（规范化尾换行后比较）作为唯一真相源，`setContent` 仅设基线不置脏；旧 `markUserEdit`/交互门控已废弃。                                                                   |
| roundtrip          | Markdown → 解析 → 序列化 → 再解析的保真测试。安全网：[`roundtrip.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/roundtrip.spec.ts) + [`commonmark.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/commonmark.spec.ts)。 |
| IPC 服务层         | [`src/services/tauri/`](../src/services/tauri/)，前端唯一 IPC 入口，绝不直接 `invoke`（命令名走 `command-names.ts` 真理源）。                                                                                                                      |
| capabilities 权限  | [`src-tauri/capabilities/`](../src-tauri/capabilities/)，最小权限白名单，新增 IPC 须登记。                                                                                                                                                         |
| 原子写             | 先写 `.tmp` 再 `rename`（`MoveFileExW`），防写入中断损坏原文件。                                                                                                                                                                                   |
| 规范化基线         | 编辑器加载后立即序列化写回 store，消除 parser/serializer 归一化差异导致的假脏态。                                                                                                                                                                  |
| 启动开打竞态       | 前端未 ready 就收到开文件请求；两层缓冲兜底（`PendingWindowPaths` + `StartupOpenRequests`，[`state.rs`](../src-tauri/src/state.rs) + [`lib.rs`](../src-tauri/src/lib.rs)，详见 `./sensitive-areas.md` §11.5）。                                                          |
| 多窗口进程模型     | 每 `.md` 独立进程（v1.2.5+），关最后一窗默认不退出。                                                                                                                                                                                               |
| 主题色彩映射       | [`src/themes/types.ts`](../src/themes/types.ts)`::CSS_VAR_MAP`，主题颜色 token 全量映射 → CSS 变量（**数量以 `CSS_VAR_MAP` 实际为准，勿硬编码**）。                                                                                                  |
| 防抖分层           | 字数 150ms / 光标 100ms / 大纲 500ms / 序列化 500ms，刻意分离（见 [`useEditorSync.ts`](../src/composables/useEditorSync.ts)）。                                                                                                                                 |
| Markdown 保真      | 解析/序列化精确还原，不丢数据、不引入隐形字符。                                                                                                                                                                                                    |
| asset:// 字体首选  | 2026-08-14 起字体用 CSS `@font-face` + asset URL（不走 CORS）为首选，`readFontBytes` 字节通道为兜底（`fontLoader.ts::registerFontViaCss`）。                                                                                                       |
