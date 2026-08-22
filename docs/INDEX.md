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
> **frontmatter 标准定义见 `AGENTS.md` 文档管理规范 §六**；本文是每份文档 tag/摘要的落地清单。
> **修改联动规则见 `AGENTS.md` §七**（改 X 必查 Y 矩阵）。

## 文档地图（全量，含 tag/摘要）

> 本表每个路径均可点击。相对路径，仓库移动也不碎。`type`/`status` 与各文件 frontmatter 一致。

### 根目录（对外 + 核心 3 + 排查）

| 路径                                                   | type    | 受众      | 状态   | tag / 摘要                                                        |
| ------------------------------------------------------ | ------- | --------- | ------ | ----------------------------------------------------------------- |
| [`README.md`](../README.md)（+ zh-CN / ja-JP / ko-KR） | product | user      | active | 产品导览：介绍、安装、dev 起步。4 语言本地化，AGENTS §二 确认保留 |
| [`AGENTS.md`](../AGENTS.md)                            | core    | agent     | active | 工作手册：纪律 + 文档地图 + frontmatter/联动规范 + 历史经验沉淀   |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md)                | core    | dev/agent | active | 架构真相：技术栈版本/命令清单/目录树/§11 敏感区速查表             |
| [`BUILD_GUIDE.md`](../BUILD_GUIDE.md)                  | core    | dev       | active | 构建手册真理源：工具链/环境变量/编译命令/故障排查                 |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)           | guide   | user      | active | 用户侧运行时故障排查（症状→修法）                                 |

### docs/ 核心真理源

| 路径                                         | type  | 受众       | 状态   | tag / 摘要                                    |
| -------------------------------------------- | ----- | ---------- | ------ | --------------------------------------------- |
| [`INDEX.md`](./INDEX.md)                     | core  | agent      | active | 本文：文档索引 + 术语表                       |
| [`KNOWN-ISSUES.md`](./KNOWN-ISSUES.md)       | core  | agent      | active | 待办/已知坑真理源：§一 已修复、§二 待办       |
| [`CHANGELOG.md`](./CHANGELOG.md)             | core  | maintainer | active | 版本变更史（唯一真理源，由真实 git log 整理） |
| [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) | core  | maintainer | active | 发版流程真理源：Phase 定义/回滚/故障处理      |
| [`HANDOVER.md`](./HANDOVER.md)               | guide | agent      | active | 接手入口：30 秒定位 + 真理源文件表 + 环境搭建 |

### docs/ 指南与决策

| 路径                                                                                   | type  | 受众             | 状态   | tag / 摘要                                                |
| -------------------------------------------------------------------------------------- | ----- | ---------------- | ------ | --------------------------------------------------------- |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md)                                                 | guide | dev/agent        | active | 协作规范：开发环境/提交纪律/PR 流程                       |
| [`SECURITY.md`](./SECURITY.md)                                                         | guide | maintainer       | active | 安全披露政策 + 攻击面 + 当前版本号                        |
| [`PLAYBOOK.md`](./PLAYBOOK.md)                                                         | guide | maintainer/agent | active | 发布全生命周期剧本（A–F 六阶段总纲）                      |
| [`PUBLISH_GUIDE.md`](./PUBLISH_GUIDE.md)                                               | guide | maintainer       | active | 发版小白实操版（3 条命令），真理源 RELEASE_PROCESS        |
| [`发布流程科普（从写完代码到用户下载）.md`](./发布流程科普（从写完代码到用户下载）.md) | guide | user             | active | 发版原理大白话科普，真理源 RELEASE_PROCESS                |
| [`debugging.md`](./debugging.md)                                                       | guide | agent            | active | 开发者侧调试指南（DevTools/cargo/bun 兜底/快捷键拦截）    |
| [`cjk-boundary.md`](./cjk-boundary.md)                                                 | guide | dev              | active | CJK 加粗边界经验（parser/serializer 必读）                |
| [`font-handling.md`](./font-handling.md)                                               | guide | agent            | active | 字体处理手册：asset:// 首选 + 字节兜底/CORS 陷阱/排查树   |
| [`network-proxy-guide.md`](./network-proxy-guide.md)                                   | guide | maintainer       | active | 更新检测代理（环境变量/注册表/端口探测）                  |
| [`paste-compat-decision.md`](./paste-compat-decision.md)                               | guide | maintainer/agent | active | 粘贴兼容性决策备忘                                        |
| [`ui-redesign-handover.md`](./ui-redesign-handover.md)                                 | guide | agent            | active | UI 改造交接（活跃分支 refactor/editor-decouple）          |
| [`ui-typography-eval.md`](./ui-typography-eval.md)                                     | guide | agent            | active | 排版微调 + 文字变浅评估（设计决策留痕，§一 为改动前快照） |

### docs/ 原则、提案、归档

| 路径                                                                         | type      | 受众             | 状态     | tag / 摘要                                                               |
| ---------------------------------------------------------------------------- | --------- | ---------------- | -------- | ------------------------------------------------------------------------ |
| [`project_rules：工作原则和纪律.md`](./project_rules：工作原则和纪律.md)     | principle | agent            | active   | 最高准则：实事求是/第一性原理/共识前置/多层验证（通用底线真理源）        |
| [`architecture：产品开发总原则.md`](./architecture：产品开发总原则.md)       | principle | dev/agent        | active   | 技术设计原则：SSOT/高内聚低耦合/决策阶梯/绝不硬编码/退化安全             |
| [`solo产品精神.md`](./solo产品精神.md)                                       | principle | dev              | active   | 产品理念：极简/极速/优雅 + 灵活/高效/可拓展                              |
| [`solo外部文件监听方案.md`](./solo外部文件监听方案.md)                       | proposal  | maintainer/agent | proposal | 外部文件监听（Agent Sync）技术方案——**未执行**，待拍板                   |
| [`architecture/refactoring-report.md`](./architecture/refactoring-report.md) | archive   | agent            | archive  | 减法重构历史报告（22→17 命令等，**历史快照**，现状以 ARCHITECTURE 为准） |
| [`archive/settings-audit-report.md`](./archive/settings-audit-report.md)     | archive   | agent            | archive  | 设置面板排查历史报告（P0 死代码已清理，**历史快照**）                    |
| [`catpaw审核/丝滑体验优化复盘.md`](./catpaw审核/丝滑体验优化复盘.md)         | archive   | dev/agent        | archive  | 丝滑优化（P0-P3）全流程复盘：方案/实施/审查/回退/根因/教训               |
| [`solo-tour.html`](./solo-tour.html)                                         | product   | user             | active   | 产品功能导览 HTML 页（非 md，无 frontmatter）                            |

### 已退役 / 忽略

| 路径                          | 说明                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `.trae/documents/`            | 旧架构文档（文件树/workspace watcher 等），**一律忽略**，见 HANDOVER 警告                                                |
| `docs/performance` 等已删文档 | 性能优化修复方案 / ui-optimization-proposal / theme-eval / theme-color-audit / ColaMD对比solo —— 均已删，落地见 git 历史 |
| `.opencode/PROFILE.md`        | 技术档案（已与 ARCHITECTURE/CHANGELOG 去重，以二者为真理源），非本文范围                                                 |

## 文档联动表（快速查询）

> 完整矩阵与纪律见 `AGENTS.md` §七。此处为「想了解 X → 读哪份」的入口级速查。

| 想了解                       | 先读                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 项目是什么 / 怎么装          | `README.md` → `docs/solo产品精神.md`                                                                              |
| 接手项目从哪开始             | `docs/HANDOVER.md` → `AGENTS.md` → `ARCHITECTURE.md`                                                              |
| 代码结构 / 命令清单 / 敏感区 | `ARCHITECTURE.md`（§11 速查表）                                                                                   |
| 怎么编译 / 环境怎么配        | `BUILD_GUIDE.md`                                                                                                  |
| 有什么已知坑 / 待办          | `docs/KNOWN-ISSUES.md`                                                                                            |
| 怎么调 bug                   | `docs/debugging.md` → `TROUBLESHOOTING.md`（用户侧）                                                              |
| 怎么发版                     | `docs/PLAYBOOK.md` → `docs/RELEASE_PROCESS.md` → `docs/PUBLISH_GUIDE.md`（实操）/ `docs/发布流程科普*.md`（原理） |
| 字体 / 主题 / 排版           | `docs/font-handling.md` → `docs/ui-typography-eval.md` → `ARCHITECTURE.md`                                        |
| CJK 边界 / parser            | `docs/cjk-boundary.md` → `src/components/Editor/tiptap/markdown/parser.ts`                                        |
| 安全 / 漏洞报告              | `docs/SECURITY.md`                                                                                                |
| 历史版本都改了什么           | `docs/CHANGELOG.md`                                                                                               |
| 工作原则 / 技术原则          | `docs/project_rules：工作原则和纪律.md` → `docs/architecture：产品开发总原则.md`                                  |

## 术语表（项目黑话）

| 术语               | 含义                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 脏态 (dirty state) | 文档相对磁盘是否被修改。A1 重构后由 `file.ts::syncEditedContent()` 语义比对（规范化尾换行后比较）作为唯一真相源，`setContent` 仅设基线不置脏；旧 `markUserEdit`/交互门控已废弃。                                                                   |
| roundtrip          | Markdown → 解析 → 序列化 → 再解析的保真测试。安全网：[`roundtrip.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/roundtrip.spec.ts) + [`commonmark.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/commonmark.spec.ts)。 |
| IPC 服务层         | [`src/services/tauri/`](../src/services/tauri/)，前端唯一 IPC 入口，绝不直接 `invoke`（命令名走 `command-names.ts` 真理源）。                                                                                                                      |
| capabilities 权限  | [`src-tauri/capabilities/`](../src-tauri/capabilities/)，最小权限白名单，新增 IPC 须登记。                                                                                                                                                         |
| 原子写             | 先写 `.tmp` 再 `rename`（`MoveFileExW`），防写入中断损坏原文件。                                                                                                                                                                                   |
| 规范化基线         | 编辑器加载后立即序列化写回 store，消除 parser/serializer 归一化差异导致的假脏态。                                                                                                                                                                  |
| 启动开打竞态       | 前端未 ready 就收到开文件请求；三层缓冲兜底（[`state.rs`](../src-tauri/src/state.rs) + [`lib.rs`](../src-tauri/src/lib.rs)）。                                                                                                                     |
| 多窗口进程模型     | 每 `.md` 独立进程（v1.2.5+），关最后一窗默认不退出。                                                                                                                                                                                               |
| 主题色彩映射       | [`src/themes/types.ts`](../src/themes/types.ts)`::CSS_VAR_MAP`，68 个颜色字段 → CSS 变量。                                                                                                                                                         |
| 防抖分层           | 统计 50ms / 光标 100ms / 序列化 500ms，刻意分离。                                                                                                                                                                                                  |
| Markdown 保真      | 解析/序列化精确还原，不丢数据、不引入隐形字符。                                                                                                                                                                                                    |
| asset:// 字体首选  | 2026-08-14 起字体用 CSS `@font-face` + asset URL（不走 CORS）为首选，`readFontBytes` 字节通道为兜底（`fontLoader.ts::registerFontViaCss`）。                                                                                                       |
