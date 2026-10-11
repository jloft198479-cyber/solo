# solo 文档减负方案（草案，待审批）

> 目标：把"每次改代码必同步 N 处文档"的强制税，降为"三类触发才动文档"。
> 原则：**护栏（自动化测试 + 核心契约）全留；人工同步税全砍。**
> 本文件是规划草案，不执行。批准后按阶段推进。

---

## 一、现状痛点（已取证）

| 事实 | 数据 |
|---|---|
| docs/ 一级 .md 文件 | ~50 个 |
| 其中"一次性快照/已结案" | REVIEW-* ≈20 + IME 3 + PROPOSAL-* 6 ≈ 30 个（占 60%） |
| docs/archive 已有 | 37 个（归档机制已存在） |
| 最大税源指令 | AGENTS.md 第 187 行"任意改动 → 全库 grep 死链扫描" |
| 次大税源 | 第 81 行"改后跑死链扫描"、第 189 行"事实不符就更新文档" |
| 记忆写入义务 | 每次实质改动后 append 工作记忆（累积税） |

**结论**：文档体感沉重，主因不是"核心文档多"，而是① 大量已结案快照没归档撑起了体量；② 几条 agent 指令把"代码改动"和"文档同步"绑死。

---

## 二、文档分级处置

### Tier A — 核心护栏（留，且是唯一真理源）
- 根：`AGENTS.md`、`ARCHITECTURE.md`、`BUILD_GUIDE.md`
- `docs/INDEX.md`、`docs/KNOWN-ISSUES.md`、`docs/sensitive-areas.md`、`docs/DOC-STANDARD.md`
- `docs/CHANGELOG.md`、`docs/SECURITY.md`
- `docs/project_rules：工作原则和纪律.md`、`docs/architecture：产品开发总原则.md`、`docs/solo产品精神.md`
- `docs/RELEASE_PROCESS.md`、`docs/PUBLISH_GUIDE.md`、`发布流程科普`
- `docs/FEATURE-MATRIX.md`、`docs/TROUBLESHOOTING.md`、`docs/debugging.md`、`docs/CONTRIBUTING.md`

### Tier B — 归档（移入 docs/archive/，不再维护）
- 全部 `REVIEW-*` 系列（≈20 个）—— 结论已吸收进 KNOWN-ISSUES / LESSONS / AGENTS
- IME 三件套（已终审封存）：`IME-ANCHOR-GUARD-2026-10-09`、`IME-CANDIDATE-WINDOW`、`IME-问题简报与资料汇编`
- 已落地的 `PROPOSAL-*`：cell-fidelity、list-* 系列（落地结论进 KNOWN-ISSUES 即可）
- `00-今日修改总览-2026-10-10.md`、`TODO-list-semantics-round2.md`、`REVIEW-PLAN-*`、`HANDOVER.md`、`ui-redesign-handover.md`

### Tier C — 合并精简（确认后处理）
- `paste-compat-decision` / `cjk-boundary` / `font-handling` / `network-proxy-guide`：技术决策记录，保留但核对是否仍准
- list 系列 PROPOSAL 5 份 → 结论合并进 KNOWN-ISSUES，原件归档

### Tier D — 可删（grep 确认无引用后）
- 经 `grep -rn "<文件名>" --include=*.md` 确认零引用的死文件

---

## 三、Agent 指令松绑清单（最值钱，零信息丢失）

| 位置 | 当前指令 | 问题 | 改为 |
|---|---|---|---|
| AGENTS §2 末（第 81 行附近） | "改前查此表，改后跑死链扫描" | 每次改动都扫全库 md | 改为"改前查表保留；**死链扫描仅在删/重命名文件时跑**" |
| AGENTS §5 第 187 行 | "任意改动 → grep 改动文件 --include=*.md，死链即 Bug" | 最大税源：每改一个文件顺引用链更新 N 处文档 | 改为"**仅删除/重命名文件时**跑死链扫描；纯内容改动不跑" |
| AGENTS §5 第 189 行 | "事实不符以代码为准并更新文档" | 软性累积税 | 保留原则，加"**仅更新 Tier A；Tier B/C 不维护**" |
| AGENTS §5 第 136 行"改完必跑表" | 多为自动化测试 + 文档动作 | 文档动作是税 | 保留测试项，删除表格里的文档同步动作 |
| 记忆系统指令 | "每次实质改动后 append 工作记忆" | 累积写入义务 | 改为"**仅踩新坑/改架构/新增敏感区时** append；普通 bug 修复不写" |

### 明确保留不动的护栏（便宜且值钱）
- 第 49 行：新增 Rust 命令后 `grep invoke('` —— 保留（防回归，成本极低）
- 第 56 行：改 parser/serializer/schema 必跑 5 套自动化测试 —— 保留（自动化，不手写）
- 记忆系统本身 —— 保留（最高频判例库），仅降低写入频率

---

## 四、新工作流（when-to-doc 规则）

一句话：**文档更新从"每次改动必同步"改为"三类触发才动"**

1. 动了架构 / 新增 Rust 命令 / 新增敏感区 → 更新 Tier A
2. 踩了会复发的新坑 → 写一条进记忆（不是写一份新 doc）
3. 删/重命名了文件 → 跑一次死链扫描

其余改动：**不碰文档**。真理源地图的价值是"改 X 去哪改"，不是"每改一次重抄一遍"。

---

## 五、执行步骤（分阶段，逐批批准）

- **阶段 0（最便宜、零丢失、立刻减负）**：改 AGENTS.md 上述 4 条指令 + 记忆写入频率。纯给自己松绑。
- **阶段 1**：把 REVIEW-* + IME + 已落地 PROPOSAL 移入 docs/archive/（归档机制已存在，git mv 即可）。
- **阶段 2**：合并同主题（list 系列）、删死文件（先 grep 确认）。
- **阶段 3**：核对 Tier C 技术决策文档是否仍准，过期则归档。

> 建议从**阶段 0** 开始——不改任何业务文档、不丢任何信息，先把"每次必同步"的绑死关系解开，你马上能感觉到文档时间下来。
