# Contributing to solo

感谢你（无论是人类开发者，还是另一个 AI agent）愿意接手或改进 solo。

> **黄金法则（适用于所有人，尤其是 AI agent）**
> **以代码为准，不以注释、文档或记忆为准。**
> 改代码前先读实际行为；引用文件路径前先确认它存在；测试数量以命令实际输出为准，不要硬编码。本仓库的 `.trae/documents/` 目录已废弃，不要把它当真理源。

---

## 0. 先读这些（按顺序）

| 顺序 | 文档 | 作用 |
|---|---|---|
| 1 | [`HANDOVER.md`](./HANDOVER.md) | 接手第一站：30 秒定位、环境、真理源文件 |
| 2 | [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 三层架构、决策阶梯、核心约束 |
| 3 | [`AGENTS.md`](./AGENTS.md) | 工作纪律 + 文档地图 |
| 4 | [`ARCHITECTURE.md §11`](./ARCHITECTURE.md) | 10 个 bug 易发区速查表，改前必看 |
| 5 | [`docs/KNOWN-ISSUES.md`](./docs/KNOWN-ISSUES.md) | 已知问题 / 技术债 |
| 6 | [`docs/debugging.md`](./docs/debugging.md) | 调试指南、环境坑位 |

---

## 1. 开发环境

### 1.1 必需工具链

| 工具 | 版本 / 路径 | 备注 |
|---|---|---|
| Bun | 1.3.14 | `bun install` / `bun run` |
| Node.js | 22（CI 用 22） | 作为 bun segfault 时的兜底 |
| Rust | 1.96.0，edition 2021 | `CARGO_HOME=M:\rust\.cargo`（本机） |
| MSVC Build Tools | v14.44.35207 | `M:\VS\BuildTools` + Windows SDK `10.0.26100.0` |
| Tauri | 2.x | 桌面框架 |

### 1.2 本机环境坑位（重要）

> 以下坑是**本机特有**，CI（GitHub windows-latest）不受影响。本地开发务必照做。

- **Rust / MSVC 不在默认 PATH**：编译前需手动加载 vcvars64 并设置 `CARGO_HOME=M:\rust\.cargo`、`RUSTUP_HOME=M:\rust\.rustup`。完整命令见 `RELEASE_PROCESS.md §4.3`。
- **bun 下 `vue-tsc` / `vite` / `vitest run <过滤>` 可能 segfault**：
  - 类型检查兜底：`node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`
  - 构建兜底：`node node_modules/vite/bin/vite.js build`
  - **测试必须全量跑**：`bun run test`（子集过滤会 segfault，全量不会）。

---

## 2. 常用命令

```bash
bun install                 # 安装 JS 依赖
bun run dev                 # 仅前端（Vite）
bun run dev:tauri           # 全栈（Rust + Vue）
bun run dev:tauri:inspect   # 启动时自动开 DevTools（SOLO_OPEN_DEVTOOLS=1）
bun run build               # vue-tsc --noEmit && vite build
bun run build:tauri         # 打包安装器
bun run test                # 全量 Vitest（happy-dom），必须 0 失败
bun run lint                # 静态检查
```

验证标准动作见 [`docs/debugging.md` §验证标准动作](./docs/debugging.md)。

---

## 3. 分支与提交

### 3.1 分支策略
- 主分支：`master`（CI 在 push / PR 到 `master` / `main` 时跑测试）。
- 功能 / 修复从 `master` 切出短生命周期分支，PR 回 `master`。

### 3.2 提交信息
- 用**中文**写 commit message（与历史一致），动词开头：`fix:` / `feat:` / `refactor:` / `chore:` / `docs:`。
- 一句话说清「改了什么、为什么」。例如：
  - `fix: 修复 asset:// 图片重开后裂图`
  - `refactor: Callout 极简化 — 单一类型、无 icon`
- 版本号提升用 `bump version to 1.x.x`（CI 识别语义）。

### 3.3 提交前强制检查
1. 跑 `bun run test` — **全量 0 失败**。
2. 跑 `bun run build` — 类型 + 构建通过。
3. 改了 Rust：本地 `cargo check`（按 §1.2 加载环境）必须过。
4. 确认没有 `replaceAll` / `replaceAllAsync`（TS target = ES2020，用 `.split().join()` 替代）。检查：`rg "replaceAll|replaceAllAsync" src/`
5. 先看 `git status` 再提交；**不提交 secrets、不提交 `node_modules` / `target`**。

---

## 4. 改代码的纪律（不可违反）

1. **先读实际代码行为**，不以注释为准。
2. **确认影响范围**：改了一个文件，还有哪些文件受影响？逐个检查。
3. **改 parser / serializer 后必须**：
   - `bun run test` 所有 roundtrip 测试通过；
   - `vue-tsc --noEmit` 通过；
   - `bun run build` 通过。
4. **动「真理源」文件要格外小心**（见 `HANDOVER.md` 真理源表）：命令名只在 `command-names.ts`、命令定义只在 `registry.ts`、字体清单 `fonts.ts`、字体栈 `fontStack.ts`、主题映射 `types.ts::CSS_VAR_MAP`、Rust 命令总数 `lib.rs::generate_handler!`。
5. **宁可少改，不要过度工程**（决策阶梯：YAGNI 优先）。

---

## 5. 报告问题 / 提 PR

- **Bug 报告**：请使用仓库的 Issue 模板（`bug_report.md`），必填：环境版本、复现步骤、日志路径（`%APPDATA%\solo\`、`startup-open.log`）。
- **PR**：请使用 PR 模板。说明「改了什么 / 为什么 / 测试如何验证」。
- 发版相关请先读 [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md)（版本号四源一致、tag 规则、CI 流程）。

---

## 6. 给 AI agent 的特别提示

- 不要信任 `.trae/documents/` 下的任何文档（已废弃，可能过时）。
- 不要臆想测试数量、命令数量、文件存在性——用 `bun run test`、`Glob`、`Grep` 核实。
- 改完务必跑全量测试 + 类型检查 + 构建，并把「坑位」记进 `docs/debugging.md`（若发现新坑）。
- 涉及 Rust：本机必须按 §1.2 加载 MSVC 环境，否则 `cargo check` 会因缺 `cl.exe` 失败。
