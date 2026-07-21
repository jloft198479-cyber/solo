# docs/INDEX.md — 文档索引与术语表

> 接手者第一站（`HANDOVER.md`）之外的「地图」。所有文档按受众/状态列清，废弃项显式标出。

## 文档地图

> 本表每个路径均可点击。相对路径，仓库移动也不碎。

| 路径 | 受众 | 用途 | 状态 |
|---|---|---|---|
| [`README.md`](../README.md) / [`README.zh-CN.md`](../README.zh-CN.md) / [`README.ja-JP.md`](../README.ja-JP.md) / [`README.ko-KR.md`](../README.ko-KR.md) | 用户 | 产品介绍、安装、dev 起步 | 活跃（已对账 2026-07-20） |
| [`HANDOVER.md`](../HANDOVER.md) | 接手者/agent | **接手入口**（本批新增） | 活跃 |
| [`AGENTS.md`](../AGENTS.md) | AI/开发者 | 工作纪律 + 快速入门 | 活跃 |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | 开发者/agent | **权威架构地图**（代码真相） | 活跃（附录 C 固化差异） |
| [`BUILD_GUIDE.md`](../BUILD_GUIDE.md) | 开发者 | 编译手册 | 活跃 |
| [`TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) | 用户 | 运行时问题排查 | 活跃 |
| [`docs/PLAYBOOK.md`](./PLAYBOOK.md) | 维护者/agent | **发布全生命周期剧本（A–F 六阶段总纲）** | 活跃（2026-07-21 新增） |
| [`RELEASE_PROCESS.md`](../RELEASE_PROCESS.md) | 维护者 | 发版机制细节（PLAYBOOK 的 Phase E 子文档） | 活跃 |
| [`RELEASE-CHECKLIST.md`](../RELEASE-CHECKLIST.md) | 维护者 | 发版手动回归清单 | 活跃（导出章节已注记失效） |
| [`PUBLISH_GUIDE.md`](../PUBLISH_GUIDE.md) | 维护者 | 发布指南 | 活跃 |
| [`PROFILE.md`](../.opencode/PROFILE.md)（`.opencode/`） | 维护者 | 技术档案（含历史快照） | [警告] 可能滞后，以 ARCHITECTURE+代码为准 |
| [`docs/cjk-boundary.md`](./cjk-boundary.md) | 开发者 | CJK 加粗边界专题（历史过程记录） | 活跃（历史快照，勿当现状） |
| [`docs/network-proxy-guide.md`](./network-proxy-guide.md) | 维护者 | 更新检测代理 | 活跃 |
| [`docs/KNOWN-ISSUES.md`](./KNOWN-ISSUES.md) | 接手者/agent | **已知问题+技术债**（本批新增） | 活跃 |
| [`docs/defect-hotspots.md`](./defect-hotspots.md) | 接手者/agent | **bug 易发区地图**（本批新增） | 活跃 |
| [`docs/debugging.md`](./debugging.md) | 接手者/agent | **调试指南**（本批新增） | 活跃 |
| [`docs/INDEX.md`](./INDEX.md) | 接手者/agent | 本文（本批新增） | 活跃 |
| [`CHANGELOG.md`](../CHANGELOG.md) | 接手者/维护者 | **版本变更史**（P1 新增，由真实 git log 整理） | 活跃 |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | 开发者/agent | **协作规范 / 开发环境 / 提交纪律**（P1 新增） | 活跃 |
| [`SECURITY.md`](../SECURITY.md) | 维护者/安全研究员 | **安全披露政策 + 攻击面**（P1 新增） | 活跃 |
| [`.github/ISSUE_TEMPLATE/bug_report.md`](../.github/ISSUE_TEMPLATE/bug_report.md) | 用户/测试 | Bug 报告模板（强制环境 + 日志路径） | 活跃 |
| [`.github/ISSUE_TEMPLATE/config.yml`](../.github/ISSUE_TEMPLATE/config.yml) | 维护者 | 禁空白 Issue + 安全/讨论链接 | 活跃 |
| [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md) | 开发者 | PR 模板（验证清单） | 活跃 |
| [`docs/archive/`](./archive/) | 维护者 | 时点诊断快照（如 settings-audit-report.md） | 归档 |
| `.trae/documents/` | — | **旧架构文档（文件树/workspace watcher 等）** | [已废弃] 忽略 |

## 术语表（项目黑话）

| 术语 | 含义 |
|---|---|
| 脏态 (dirty state) | 文档相对磁盘是否被修改。`setContent()`（程序写回，不置脏）vs `markUserEdit()`（用户编辑，置脏）分离，防脏态闪烁。 |
| roundtrip | Markdown → 解析 → 序列化 → 再解析的保真测试。安全网：[`roundtrip.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/roundtrip.spec.ts) + [`commonmark.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/commonmark.spec.ts)。 |
| IPC 服务层 | [`src/services/tauri/`](../src/services/tauri/)，前端唯一 IPC 入口，绝不直接 `invoke`。 |
| capabilities 权限 | [`src-tauri/capabilities/`](../src-tauri/capabilities/)，最小权限白名单，新增 IPC 须登记。 |
| 原子写 | 先写 `.tmp` 再 `rename`（`MoveFileExW`），防写入中断损坏原文件。 |
| 规范化基线 | 编辑器加载后立即序列化写回 store，消除 parser/serializer 归一化差异导致的假脏态。 |
| 启动开打竞态 | 前端未 ready 就收到开文件请求；三层缓冲兜底（[`state.rs`](../src-tauri/src/state.rs) + [`lib.rs`](../src-tauri/src/lib.rs)）。 |
| 多窗口进程模型 | 每 `.md` 独立进程（v1.2.5+），关最后一窗默认不退出。 |
| 主题色彩映射 | [`src/themes/types.ts`](../src/themes/types.ts)`::CSS_VAR_MAP`，68 个颜色字段 → CSS 变量。 |
| 防抖分层 | 统计 50ms / 光标 100ms / 序列化 500ms，刻意分离。 |
| Markdown 保真 | 解析/序列化精确还原，不丢数据、不引入隐形字符。 |
