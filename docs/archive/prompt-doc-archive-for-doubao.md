# 给豆包的任务指令：solo 项目文档系统归档（第二轮收尾）

> 使用方法：把本文件**全文**复制给豆包。它没有我们的对话上下文，本文是自包含的。

---

## 一、你是谁、在干什么

你是来执行一次性文档归档任务的执行者。项目：**solo**，一个本地优先的桌面 Markdown 编辑器（Tauri v2 + Vue3 + Rust），仓库在 `F:\fzz-Project\md-editor`（Windows，Git Bash 可用）。

**先读 `AGENTS.md`**（项目行为契约，2 分钟），再读 `docs/INDEX.md`（文档总目录）。你的所有动作遵守 AGENTS.md 的硬禁令。

## 二、背景：今天已经做了什么（不要重复做、不要推翻）

2026-10-12 刚完成第一轮文档减负，**以下成果已存在，禁止回退**：

1. 24 份 REVIEW/IME 历史文档已 `git mv` 进 `docs/archive/`（现共 48 份），归档区声明为「默认不读、查询才进」
2. `AGENTS.md`（根级）已从 202 行精简为最小行为契约；细则拆入 `docs/agent-playbook.md`——**playbook 是 AGENTS 的按需加载层，不是重复文档，禁止合并/删除**
3. 死链检查器 `src/__tests__/docs-lint.spec.ts` 已建立
4. 保真扫描器已把 `docs/`、`wiki/`、archive 排除出扫描范围（改这些目录不影响保真测试）

## 三、本轮目标

把日常接触面压到最小：**docs/ 一级 35 份 + 根级散件 + outputs/ 区做最终整理**。已过时、已处理、一次性的文档归档；活核心留下。

## 四、绝对不动清单（碰了就是事故）

| 位置 | 文件 | 为什么 |
|---|---|---|
| 根级 | `AGENTS.md` / `ARCHITECTURE.md` / `BUILD_GUIDE.md` / `CLAUDE.md` / `README*.md`（4 语言） | 入口契约 + 架构 + 构建指南 |
| docs/ | `INDEX.md` / `KNOWN-ISSUES.md` / `sensitive-areas.md` / `CHANGELOG.md` / `LESSONS.md` / `agent-playbook.md` / `DOC-STANDARD.md` / `RELEASE_PROCESS.md` / `TROUBLESHOOTING.md` / `SECURITY.md` | 活真理源 + 操作手册 |
| docs/ | `solo产品精神.md` / `project_rules：工作原则和纪律.md` / `architecture：产品开发总原则.md` | **三层原则，2026-07-22 用户亲自定立的宪法层** |
| `wiki/` 全部 8 份 | 快速上手/快捷键/FAQ/主题字体/图片管理等 | **用户说明书，是产品功能不是档案** |
| `src/` / `src-tauri/` / 配置 | 一切代码与配置 | 本任务只动文档 |

## 五、归档判据（三条，占二即可归档；只占一条的要标注「待核」）

1. **无人引用**：`docs/INDEX.md`、`AGENTS.md`、`ARCHITECTURE.md` 都不引用它
2. **一次性快照**：文件名带日期，或内容是「总览/报告/复盘/交接」性质
3. **状态过期**：文档写的「待办/未修」在 `KNOWN-ISSUES.md` 里已经是「已修」

## 六、已知归档候选（逐份核对后执行，不许不经核对批量移动）

docs/ 一级里疑似候选（**必须逐份先核对再动**）：

- `00-今日修改总览-2026-10-10.md`、`TODO-list-semantics-round2.md` —— 带日期快照，判据②
- `HANDOVER.md` —— 交接文档，先核对内容是否已被 ARCHITECTURE/playbook 覆盖
- `PLAYBOOK.md` —— **重点核对**：可能与 `agent-playbook.md` 重复（后者是活的，若是旧版则归档前者并去引用）
- `PROPOSAL-list-structure-fix.md` / `PROPOSAL-list-shifttab.md` —— 已修复，核对结论已进 KNOWN-ISSUES（§二 #26/#55）后可归档
- `PROPOSAL-cell-fidelity.md` —— **活决策单**（KNOWN-ISSUES #60/#61 引用它），保留
- `PROPOSAL-list-outline-experience.md` / `PROPOSAL-list-semantics.md` / `PROPOSAL-list-row-drag.md` —— 逐份核对状态
- `BENCHMARK-editing-experience.md` / `ui-typography-eval.md` / `ui-redesign-handover.md` —— 专题快照，核对后归档
- `cjk-boundary.md` / `font-handling.md` / `network-proxy-guide.md` / `paste-compat-decision.md` —— 单点专题，若结论已进敏感区/KNOWN-ISSUES 则可归档，否则保留
- `发布流程科普（从写完代码到用户下载）.md` / `CONTRIBUTING.md` / `PUBLISH_GUIDE.md` —— 核对与 RELEASE_PROCESS 的覆盖关系
- `FEATURE-MATRIX.md` —— 核对是否还在维护（更新频率），是则保留

根级散件：

- `REVIEW-2026-10-11-code-review-solo.html` —— 第三方审核报告，**先核对结论是否已全部进入 KNOWN-ISSUES §二 #52–#63**，是则归档，否则先摘录结论再归档

**待用户拍板项（先汇报，不动手）**：`outputs/` 目录整体（一次性审阅产物：方案/审计/日志/截图）——建议将其加进 `.gitignore` 定性为「本机审阅区，不进仓库」，等简乐确认后再动。

## 七、执行步骤（严格按序）

1. **盘点**：把上述候选逐份打开核对，产出三张清单：保留 / 归档 / 待核
2. **汇报待核项**（遇到判据只占一条的、或状态不清的，停下来汇报，不要猜）
3. **核对结论吸收**：对每个拟归档文档，grep 其关键结论是否已存在于 `KNOWN-ISSUES.md` / `LESSONS.md` / `CHANGELOG.md`；没有 ⇒ 先把结论摘录进台账再归档（归档的从来不是信息，只是位置）
4. **移动**：一律 `git mv <文件> docs/archive/`（保留 git 历史），禁止新建副本
5. **修引用**：全局 grep 被移动文件名的引用（重点：`INDEX.md`、`AGENTS.md`、`agent-playbook.md`、`KNOWN-ISSUES.md`、其他 .md），把相对链接 `./X.md` 改为 `./archive/X.md`
6. **验证**（必跑，全绿才算完）：
   - `npx vitest run src/__tests__/docs-lint.spec.ts`（死链器，必须 0 死链）
   - `bun run test:full`（全量回归，确认没碰坏任何锁）
   - `bun run lint`（0 error）
7. **提交**：按「文档类归档」做 1–3 个 scoped 小提交，**不 push**；commit message 写清「哪几份、为什么、结论在哪」
8. **汇报**：一张表——文件 | 保留/归档 | 判据①/②/③ | 结论已吸收到哪

## 八、汇报格式（最后交差用这个）

```
## 归档结果
| 文件 | 动作 | 判据 | 结论落点 |
## 保留清单及理由
## 待拍板项
## 验证读数（三条命令的实际输出）
```

## 九、纪律（违反任何一条即返工）

- 只动文档，不碰代码/配置/测试（修引用导致的测试文件变动除外，且需说明）
- 不删任何文件——归档 = 移动，不是删除
- 不确定的一份就停，问完再动；**不许「估计没事」批量处理**
- 每个归档决定都必须能说出「它的结论现在住在哪」
