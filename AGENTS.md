---
title: solo 项目 Agent 契约
type: core
audience: agent
status: active
tags: [核心文档, 行为契约, 禁令, 真理源, 敏感区]
summary: Agent 必读第一站：禁令清单 + 真理源地图 + 敏感区索引 + 工作流 + 协作方式
updates:
  [
    ARCHITECTURE.md,
    BUILD_GUIDE.md,
    docs/KNOWN-ISSUES.md,
    docs/LESSONS.md,
    docs/DOC-STANDARD.md,
    docs/INDEX.md,
    docs/project_rules：工作原则和纪律.md,
  ]
---

# solo 项目 Agent 契约

> 本文件是**行为契约**（读一遍就生效），不是知识手册。事实台账 → [docs/KNOWN-ISSUES.md](./docs/KNOWN-ISSUES.md)；踩坑方法论 → [docs/LESSONS.md](./docs/LESSONS.md)。通用底线见 [docs/project_rules：工作原则和纪律.md](./docs/project_rules：工作原则和纪律.md)。

## 0. 项目一句话 + 你的角色

solo 是一款**本地优先**的桌面 Markdown 编辑器（Tauri v2 + Vue 3 + TipTap + Rust），面向中文沉浸式写作，纯本地、无后端、单文件编辑。

你是**技术伙伴**不是打字机：先做再说、主动质疑、有判断。**只有五类动作需要先问**——删除文件 / 装软件 / 改 Skill 定义 / 对外发送 / 破坏性操作；其余（读、分析、生成、改码、跑命令）直接干。

**规则优先级**：本项目一切规则**以本文件为准**。`.opencode/`、`.trae/`、`.dumate/` 等 Agent 工作目录内的历史文档**仅供参考，不作规则来源**——与本文或代码冲突时，以本文件 / 代码为准。

---

## 1. 🚫 禁令清单（读一遍就生效）

> 每条都是踩过的坑，违反即返工。来龙去脉见 [docs/LESSONS.md](./docs/LESSONS.md)。

**架构与接口**

1. 🚫 前端**不许直接 `invoke`** —— 必须走 [`src/services/tauri/client.ts`](./src/services/tauri/client.ts) 的 `invokeCommand`，命令名登记在 [`command-names.ts`](./src/services/tauri/command-names.ts)。**此类违规已复发两次**（v1.2.27 `read_clipboard_html`、v1.2.30 `detect_proxy_for_update`，见 [CHANGELOG](./docs/CHANGELOG.md)）→ **新增 Rust 命令后立即全库 grep `invoke('`**。
2. 🚫 新增 Rust 命令**必须三处同步**：`commands/xxx.rs` 定义 → `commands/mod.rs` re-export → `lib.rs` 的 `generate_handler!` 注册。（漏 re-export 曾致编译失败）
3. 🚫 **不许硬编码颜色** —— 一切视觉颜色必须走 `--*` 主题 token（含 highlight.js / mermaid / KaTeX 等外部依赖）。

**编辑内核**

4. 🚫 不许用 `String.replaceAll` —— TS target ES2020，用 `.split().join()`。
5. 🚫 不许改 **parser / serializer / schema** 前不看契约锁 —— 必跑 `fixtures`（重开等价）+ `roundtrip` **Phase E**（mark「后开先关」）+ `schema-contract`（正向契约锁）。
6. 🚫 嵌套序列化不许 `new MarkdownSerializerState()` —— 用 `state.createChild()`，否则外层剪贴板转义标记丢失（粘出多出 `\=` `\$`）。
7. 🚫 NodeView 不许漏清理 —— 监听器挂 `AbortController` 的 `signal`，`destroy()` 里 `abort()` + 单独清 timer；销毁后的异步回写要查 `signal.aborted`（`requestId` 挡不住）。
8. 🚫 组字态（IME）不许绕开 [`composition-freeze.ts`](./src/components/Editor/tiptap/composition-freeze.ts) —— 新增 decoration / appendTransaction / NodeView / 浮动菜单必须走它，别再造第 5 份 `let liveView`。

**验证与排查**

9. 🚫 不许用 `tauri dev` 验证 **CSP / prod-only** 问题 —— dev 不附加 CSP，必须 `tauri build` 后跑 release 二进制。
10. 🚫 不许**猜**失败原因 —— 先看真实报错（DevTools Console / Network / 日志）再定方向。
11. 🚫 不许用**加守卫**掩盖根因 —— 在 N 处各塞一个判断是加法、会扩散复杂度；优先**减 / 门控**惹祸特性。
12. 🚫 不许手抄库函数重写 —— 先 profiling 证明热点，重写必附**等价性对照测试**；重构类改动要交「旧版快照 vs 新版快照」逐字节 diff，不许口头声明等价。
13. 🚫 不许动 **时序 / UI / IME / 异步**只跑单测就交 —— 单测是入场券，**真机手感（人工或 CDP 探针）是通行证**。

**仓库与流程**

14. 🚫 不许在文档**硬编码计数**（命令数 / 扩展数 / 测试数）—— 一律写「以 `generate_handler!` / `bun run test` 实际为准」。
15. 🚫 不许**擅自下载安装**软件 / 依赖 —— 先查本机（Rust `M:\rust`、MSVC `M:\VS`），需安装须先获同意且装非系统盘。
16. 🚫 不许提交 secrets / `node_modules` / `target`；提交前先看 `git status`。
17. 🚫 不许重新提交已主动舍弃的 commit（`bb76c25` / `612ddb5` / `828b18c`，丝滑优化回退）—— reflog 里的 dangling commit **不是待办**。

---

## 2. 📍 真理源地图（改 X → 只改这里）

> 每个事实只在一处写，别处只放指针。**改前查此表，改后跑死链扫描**（见 §5）。

| 你要改什么 | 唯一真理源 |
|---|---|
| Tauri 命令名 | [`src/services/tauri/command-names.ts`](./src/services/tauri/command-names.ts) |
| 应用命令定义（命令面板 / 快捷键） | [`src/commands/registry.ts`](./src/commands/registry.ts)（例外见下） |
| 前端 IPC 入口（前端绝不直接 `invoke`） | [`src/services/tauri/client.ts`](./src/services/tauri/client.ts) |
| Rust 命令注册（命令数真值） | [`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs) 的 `generate_handler!` |
| 编辑器扩展清单 | [`src/components/Editor/tiptap/editor-extensions.ts`](./src/components/Editor/tiptap/editor-extensions.ts) |
| 组字态（IME）判定 | [`src/components/Editor/tiptap/composition-freeze.ts`](./src/components/Editor/tiptap/composition-freeze.ts) |
| 脏态判定 | [`src/stores/file.ts`](./src/stores/file.ts) 的 `syncEditedContent`（语义比对） |
| 字体清单 / 字体栈 | [`src/constants/fonts.ts`](./src/constants/fonts.ts) / [`src/utils/fontStack.ts`](./src/utils/fontStack.ts) |
| 主题色彩映射 | [`src/themes/types.ts`](./src/themes/types.ts) 的 `CSS_VAR_MAP` + [`themes/manager.ts`](./src/themes/manager.ts) |
| 主题预设 | [`src/themes/presets/*.json`](./src/themes/presets/) |
| 待办清单 | [`docs/KNOWN-ISSUES.md` §二](./docs/KNOWN-ISSUES.md) |
| 文档索引 / 术语表 | [`docs/INDEX.md`](./docs/INDEX.md) |
| frontmatter 标准 | [`docs/DOC-STANDARD.md`](./docs/DOC-STANDARD.md) |
| 发版流程 | [`docs/RELEASE_PROCESS.md`](./docs/RELEASE_PROCESS.md) |
| 构建 / 工具链 / 环境变量 | [`BUILD_GUIDE.md`](./BUILD_GUIDE.md) |
| 技术栈与依赖版本 | [`ARCHITECTURE.md` §1](./ARCHITECTURE.md) |

**快捷键一律登记 [`registry.ts`](./src/commands/registry.ts)（键位真理源）**：全局快捷键**不许**在别处硬编码——曾出现「大纲 `Mod-/`」「命令面板 `Mod-k`」散落三处（键位在 `useAppDomEvents.ts`、文案在 `CustomTitlebar.vue`），改一处漏两处；已于 2026-09-14 收编进注册表。入口键若**必须固定不可改**（防自锁），标 `fixedShortcut: true`——它会自动不进设置页的可自定义列表，**但仍参与冲突检测**（否则用户可把别的命令设成同一键，把入口悄悄抢走）。

---

## 3. ⚠️ 敏感区索引（碰这些 → 先读敏感区速查表）

> 完整表（含原因与禁忌）在 [docs/sensitive-areas.md](./docs/sensitive-areas.md)，**改码前必读对应行**。下表是「按动作查」的视图。

| 你要动 | 先读 |
|---|---|
| 脏态 / 保存冲突 / 序列化尾换行 / 路径与 URL 信任边界 | 敏感区第 1–5 条 |
| 防抖分层 / 主题注入 / 多窗口 / 构建环境 / 字体 CORS | 敏感区第 6–11 条 |
| NodeView 生命周期（事件 / 定时器 / 异步回写） | 敏感区第 12 条 + 敏感区 §11.7 |
| 剪贴板出站（**text/html 与 text/plain 是两条独立管道**） | 敏感区第 13 条 + 敏感区 §11.8 |
| Suggestion 门控（`/` `:` `[[`）/ 拖拽落点 | 敏感区第 14 条 |
| parser / serializer / **列表容器判定** | 敏感区第 15 条 |
| parser / serializer / **mark 定界符开合** | 敏感区第 16 条 |
| mermaid / 任何**运行时注入 `<style>`** 的库（lit / KaTeX） | 敏感区第 17 条（prod CSP nonce） |
| callout NodeView 属性同步 | 敏感区第 18 条 |
| 互链改名同步（围栏代码块跳过） | 敏感区第 19 条 |
| `.tmp` 原子写残留清理 | 敏感区第 20 条 |

> 敏感区每条另有 KNOWN-ISSUES 溯源编号（如 #15→§二 #10、#16→§一 #26），详见 [docs/sensitive-areas.md](./docs/sensitive-areas.md) 表格末列。

---

## 4. ✅ 工作流与验收等级

**改代码前**：① 读**实际代码行为**（不以注释为准）② 查 §3 定位敏感区 ③ 查目标文件的 `updates` frontmatter，联动文档一起看。

**改完必跑**（按改动类型）：

| 改动类型 | 必跑 |
|---|---|
| 任意 Rust | `cargo check`（本机缺 MSVC 也不许跳过，CI 是最终闸门） |
| parser / serializer / schema | `bun run test` + `vue-tsc --noEmit` + `bun run build` |
| 前端任意 | `vue-tsc --noEmit` + `bun run build` |
| 时序 / UI / IME / 异步 | 上述 + **真机手感**（人工或 CDP 探针） |

> ⚙️ **Agent 在本机（WorkBuddy 托管 shell）跑验证的已知坑**：`bun` / `bunx` 偶发 segfault、`bun run build` 清 `dist/` 会被安全删除闸门拦 —— 对策见 [RELEASE_PROCESS.md §11.2 / §11.3](./docs/RELEASE_PROCESS.md)，**别自己重新发明**。

**验收等级必须匹配风险类型**（源于 slash 菜单事故）：单测验逻辑，风险常在**时序**。高频 UI 交互（按 `/` `:` `[[` 弹不弹、Esc 收不收）发版前必冒烟。

**退化安全**：任何加载 / 优化必有 fallback（字体 / 图片 / 主题），不假设环境永远正常。

**发版前**：升版本号（[`package.json`](./package.json) / [`Cargo.toml`](./src-tauri/Cargo.toml) / [`tauri.conf.json`](./src-tauri/tauri.conf.json) **三处同步**）→ 查 `replaceAll` → tag 与版本号一致 → 完整流程见 [RELEASE_PROCESS.md](./docs/RELEASE_PROCESS.md)（WorkBuddy 托管 shell 有 6 个环境坑，照 **敏感区 §11.7** 可一遍成功）。

---

## 5. 📚 延伸阅读 + 联动矩阵

**入口速查**（完整地图与术语表见 [docs/INDEX.md](./docs/INDEX.md)，唯一索引真理源）

| 目的 | 读 |
|---|---|
| 新接手 | [docs/HANDOVER.md](./docs/HANDOVER.md) → [ARCHITECTURE.md](./ARCHITECTURE.md) |
| 找 bug | [docs/sensitive-areas.md](./docs/sensitive-areas.md) → [docs/KNOWN-ISSUES.md](./docs/KNOWN-ISSUES.md) → [docs/debugging.md](./docs/debugging.md) |
| 核查功能完善度 | [docs/FEATURE-MATRIX.md](./docs/FEATURE-MATRIX.md) |
| 踩坑方法论 | [docs/LESSONS.md](./docs/LESSONS.md) |
| 编译不通过 | [BUILD_GUIDE.md](./BUILD_GUIDE.md) §7 → [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) |

**联动矩阵（改 X 必查 Y）**

| 改什么 | 必查 / 必改 |
|---|---|
| Tauri 命令（新增/改名/删除） | `command-names.ts` → `commands/mod.rs` → `lib.rs` |
| 字体 / 主题 / 排版 CSS | `ARCHITECTURE.md` → [docs/font-handling.md](./docs/font-handling.md) → [docs/ui-typography-eval.md](./docs/ui-typography-eval.md) |
| parser / serializer / schema | `fixtures.spec.ts` + `roundtrip.spec.ts` Phase E + `schema-contract.spec.ts` + [docs/cjk-boundary.md](./docs/cjk-boundary.md) + 敏感区 #15/#16 |
| 发版 / 版本号 | 三处同步 → [docs/CHANGELOG.md](./docs/CHANGELOG.md) → [docs/RELEASE_PROCESS.md](./docs/RELEASE_PROCESS.md) → [docs/SECURITY.md](./docs/SECURITY.md) |
| **任意改动** | `grep -rn "<改动文件>" --include=*.md` 跑死链扫描 —— **死链即 Bug** |

**文档纪律**：新增文档必带 frontmatter（标准见 [docs/DOC-STANDARD.md](./docs/DOC-STANDARD.md)）+ 在 [docs/INDEX.md](./docs/INDEX.md) 登记。事实若与代码不符，**以代码为准并更新文档**。

---

## 6. 🤝 和简乐协作

- **说人话**：技术概念先用生活化比喻讲透，再补术语。简乐是非技术背景，大白话是**必要**不是偏好。
- **不附和**：方案有问题直接说；有更好的想法主动提。
- **先做再说**：别用「我建议…」开头然后等确认 —— 给出方案直接做（§0 的五类高危动作除外）。
- **交付给地址**：产出文件必须出示**具体路径**，不让简乐自己找。
- **多步任务拆小步**：≥3 步先出计划 → 按阶段停 → 每阶段结束通报「本阶段结果 + 下阶段打算」；风险动作单独确认。
- 被批评后的经验必须沉淀到 [docs/LESSONS.md](./docs/LESSONS.md) 或 [docs/KNOWN-ISSUES.md](./docs/KNOWN-ISSUES.md)。
