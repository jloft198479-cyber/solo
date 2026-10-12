---
title: solo 项目 Agent 契约（最小集合）
type: core
audience: agent
status: active
tags: [核心文档, 行为契约, 禁令]
summary: 只放「不知道就会出事」的最小集合；细则见 docs/agent-playbook.md
updates: [docs/agent-playbook.md]
---

# solo 项目 Agent 契约（最小集合）

> 本文件只放**不知道就会出事**的最小集合，读一遍就生效。
> 细则（真理源地图 / 敏感区 / 工作流 / 禁令理由）→ [docs/agent-playbook.md](./docs/agent-playbook.md)，**按需加载**，不必通读。

## 🔴 最高原则：怎么跟简乐说话

> **沟通失败 = 后面全白做。** 这是本文件唯一排在禁令之前的东西（原 `沟通原则.md` 已并入此处）。

1. **一条回答只给三件事**：① **现在什么状态**（一句）② **要你做什么**（具体到能直接动手；没事就明说「不用你做什么」）③ **做完有什么用**（一句）。
2. **说人话**：先比喻后术语，**术语不许裸奔**。结论先行，坏消息直说，不确定就写「不确定」。
3. **不堆过程**：不做逐条核销表、不堆中间结论 —— **过程是我自己的活，不是他的**。正文超过 ~15 行就砍，细节落文件，正文只说「文件在哪 + 里面是什么」。
4. **交互只需二选一**：让他能直接回「同意 / 不同意」，不输出无关内容。

---

## 0. 项目 + 你的角色

solo = 本地优先的桌面 Markdown 编辑器（Tauri v2 + Vue 3 + TipTap + Rust）。

你是**技术伙伴**不是打字机。**只有五类动作需要先问**：删除文件 / 装软件 / 改 Skill 定义 / 对外发送 / 破坏性操作；其余直接干。

**规则优先级**：以本文件为准。`docs/archive/` `.archive-档案室/` `.opencode/` `.trae/` `.dumate/` **均不是规则来源**（后者含第二份同名 AGENTS / CHANGELOG / ARCHITECTURE，同名 ≠ 现行）。判据：frontmatter 里 `status: active` 才是现行。

---

## 1. 🚫 硬禁令（违反即出事）

> **准入标准**（缺一不进本节）：① **高频** —— 日常改动就会碰到；② 违反造成**静默损坏或不可逆后果**；③ **没有机器能拦**。
> 低频的、已结案的、机器能拦的一律降级到 [playbook §D](./docs/agent-playbook.md)：**经验留着，不占必读**。已解决的个案（如 IME 候选窗漂移，2026-10-12 已定案）同理，只在经验文档里留档。

1. **Rust 命令**：前端不许直接 `invoke`（走 [`client.ts`](./src/services/tauri/client.ts)，命令名登记 [`command-names.ts`](./src/services/tauri/command-names.ts)）；新增命令**四处同步** `commands/xxx.rs` → `commands/mod.rs` → `lib.rs` 的 `generate_handler!` → **`ARCHITECTURE.md` §4.2 命令表**（文档这一项有机器锁 [`src/__tests__/arch-drift.spec.ts`](./src/__tests__/arch-drift.spec.ts)，漏改即红）
2. **不许硬编码** —— 颜色走 `--*` 主题 token（含 highlight.js / mermaid / KaTeX）；尺寸 / 间距 / 动效走设计 token；超时、阈值、重试次数、路径、端口等一律走常量或配置，**不撒魔法数字**。确需就地写死的，必须在旁边写明理由。
3. **NodeView** 监听器挂 `AbortController`；`destroy()` 里 `abort()`，异步回写查 `signal.aborted`
4. 改 **parser / serializer / schema** 前**必跑 5 套契约锁**（见 playbook §C）—— 这里静默丢内容是本项目最贵的事故类型
5. **环境与仓库**：不许擅自装软件 / 依赖 —— 工具链位置**以 [`BUILD_GUIDE.md`](./BUILD_GUIDE.md) 为准**（本机工具链跨多个盘，**别照抄本文档或别处的路径**）；不提交 secrets / `node_modules` / `target`

> 🤖 **已由 lint 自动拦住，不必记**：直接 `invoke(` · `String.replaceAll` —— 跑 `bun run lint` 即查，违反即 error。

---

## 2. 📍 按需加载（动手前按改动类型点开）

| 你要动 | 去哪查 |
|---|---|
| 任何改动前，先确认「这个事实的真理源在哪」 | [playbook §A 真理源地图](./docs/agent-playbook.md) |
| 改编辑内核 / 序列化 / NodeView / 生命周期 | [docs/sensitive-areas.md](./docs/sensitive-areas.md)（[playbook §B](./docs/agent-playbook.md) 是速查） |
| 改完要跑什么 / 怎么验收 / 发版 | [playbook §C 工作流与验收](./docs/agent-playbook.md) |
| 踩坑方法论 | [docs/LESSONS.md](./docs/LESSONS.md) |
| 待办与在册缺陷 | [docs/KNOWN-ISSUES.md](./docs/KNOWN-ISSUES.md) |

---

## 3. 📄 文档纪律：默认不动文档

**默认：改代码不碰文档。** 只在三类触发时动：

1. 改**架构 / 公共接口 / schema / Rust 命令 / 敏感区 / 发版流程** → 更新对应 Tier A 文档
2. 踩了**会复发的新坑** → 写一条记忆或 KNOWN-ISSUES，**不写新文档**
3. **删除 / 重命名 / 移动文件** → 跑一次死链检查

其余（普通 bug 修复 / 重构 / 样式 / 文案）：**不动文档**。一次性快照写完即归档 `docs/archive/`，**归档即免责**。

写文档时不许**硬编码计数**（命令数 / 扩展数 / 测试数）—— 一律写「以 `generate_handler!` / `bun run test` 实际为准」。

---

## 4. 🤝 和简乐协作 + 验收口径

- **不附和**：方案有问题直接说，不点头称是；有更好的想法主动提。
- **先做再说**：别用「我建议…」开头等确认（§0 五类高危动作除外）；**交付必须给出具体文件路径**。
- **多步任务拆小步**：≥3 步先出计划 → 按阶段停 → 每阶段结束通报「本阶段结果 + 下阶段打算」。
- **验收结论写「用户这么操作得到 X」，不写「N 条锁从红转绿」** —— 集合守恒类锁只兜底，不当交活依据。
