---
title: 文档规范（SSOT + DRY + frontmatter 标准）
type: core
audience: agent
status: active
tags: [文档规范, ssot, frontmatter, 死链, 减文件]
summary: 全仓库文档的写法与治理规则：单一真源 / 不重复 / 减文件 / 死链即 Bug / frontmatter 字段标准
updates: [docs/INDEX.md, AGENTS.md]
---

# 文档规范

> **目标**：每件事只在一处写真版，别处只引用不复制 —— 根除冗余、版本不一致与 AI 读取无效上下文。
> 本文件是文档规范的**定义真理源**；文档全量清单与每份的 tag/摘要见 [docs/INDEX.md](./INDEX.md)。

## 一、单一真实源（SSOT）

- 每个事实只在一处写（真理源），别处只放「一句指向它的话 + 链接」，不抄内容。
- **代码级 SSOT**：命令名 → `src/services/tauri/command-names.ts`；命令定义/快捷键 → `src/commands/registry.ts`；字体 → `src/constants/fonts.ts` + `src/utils/fontStack.ts`；主题色彩 → `src/themes/types.ts::CSS_VAR_MAP`。完整地图见 [AGENTS.md §2](../AGENTS.md) 与 [ARCHITECTURE §11.6](../ARCHITECTURE.md)。
- **代码真相优先**：文档与代码不符时，**以代码为准并更新文档**（不以注释、不以记忆）。

## 二、不要重复自己（DRY）

- 信息拆成原子可复用内容，全局统一引用而非复制。
- 纯指针/索引类文件（无独家内容）应并入真理源后删除，不留空壳。
- 多语言 README（zh-CN / ja-JP / ko-KR）是必要本地化，**不算冗余，保留**。

## 三、L2 减文件纪律（实操顺序）

1. 合并/删文件前，先确认独有价值内容**已存在于真理源**。
2. 先把**所有引用它的链接改指**真理源。
3. 再删文件。
4. 删后用「含隐藏目录的递归 grep」跑死链扫描，确认**零孤儿引用**。

- **两层受众区分**：人类文档（README / CONTRIBUTING / SECURITY / 多语言 README）保持可读、不碎片化；agent 文档（ARCHITECTURE / AGENTS / HANDOVER / docs/\*）可激进原子化以省 AI 上下文。
- **禁止为做「原子 include」引入构建工具/新脚本**（守「不擅自装软件」纪律）；Markdown 的 DRY 用**链接引用**实现，不引 preprocessor。

## 四、死链即 Bug

- 任何指向已删/已改名文件的链接都是 Bug，**发现即修**。
- 删文件走 §三 顺序（先改引用再删）。

## 五、改动即自查

- 每改一处，立刻复查语法、逻辑、交叉引用（死链）—— 不止改完才查。
- 改代码前查目标文件相关文档 frontmatter 的 `updates` 字段，凡列了本文档的必须一起检查；改完跑 `grep -rn "<改动文件>" --include=*.md`。

## 六、frontmatter 标准（每份文档必带）

> 全仓库 markdown 文档（`README` 系列与测试 fixture 除外）顶部必须有 YAML frontmatter：

```yaml
---
title: 文档名（人类可读）
type: core | guide | principle | proposal | archive | product
audience: user | dev | agent | maintainer
status: active | proposal | archive | deprecated
tags: [主题标签，小写英文，逗号分隔]
summary: 一句话摘要（≤40 字，说明本文是什么、给谁用）
updates: [本文事实来源 / 联动对象——改这些代码或文档必须回查本文]
---
```

- `type` 取值：**core**（全项目真理源：ARCHITECTURE / BUILD_GUIDE / AGENTS / KNOWN-ISSUES / CHANGELOG / RELEASE_PROCESS / INDEX / DOC-STANDARD）· **guide**（指南 / 手册）· **principle**（原则 / 理念）· **proposal**（未执行提案）· **archive**（历史快照 / 归档）· **product**（对外产品导览）
- `audience`：**user**（终端用户）· **dev**（开发者）· **agent**（AI 代理）· **maintainer**（维护者 / 发布者）
- `status` 语义：描述**文档自身**的生命周期，**不用于标记内容里的未结项**。「里面还有待办」≠「文档还在维护」——把待办写进 `status` 会产出 `type: archive` + `status: active` 这种自相矛盾的组合。**未结项一律登记 [docs/KNOWN-ISSUES.md §二](./KNOWN-ISSUES.md)**（待办的唯一真理源）。
- **非法组合**：`type: archive`（历史快照）**不得**搭配 `status: active`（活跃维护）——二者语义互斥。已归档文档若仍有参考价值，用 `status: archive`，靠 INDEX 备注指明「未结项归口在哪」。
- **新增文档**：必须带完整 frontmatter + 在 [docs/INDEX.md](./INDEX.md) 登记一行 + 需要时在 [AGENTS.md](../AGENTS.md) 文档地图加一行。
- **事实变化时**：更新对应文档 `status`（如 active → archive）与 `summary`，不硬撑过期内容。
- **INDEX 与源文档必须逐字一致**：`docs/INDEX.md` 的 type/status 列是**照抄**源文档 frontmatter，不是独立判断。改任一侧，另一侧同步（曾出现索引写 `archive`、源文件是 `proposal` 的漂移）。

## See also

- [文档索引与术语表](./INDEX.md)
- [Agent 契约](../AGENTS.md)
