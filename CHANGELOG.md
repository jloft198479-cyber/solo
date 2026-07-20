# Changelog

All notable changes to **solo** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

> 本文件由真实 `git log` 整理而成（非臆想）。更早的 v1.1.x 历史可在仓库提交记录中查阅。
> 每个版本的权威测试数量以 `bun run test` 实际输出为准，本文不硬编码数字。

---

## [1.2.23] — 2026-07-19

### Added
- 粘贴来源自动嗅探：识别多种来源格式，自动选择最优转换策略。
- 更新进度可视化：粘贴 / 转换过程给出可见反馈。

### Changed
- `hasImage` 标记与 HTML 防重复：避免重复嵌入与重复渲染。

---

## [1.2.22] — 2026-07-18

### Fixed — 格式兼容性修复
- turndown HTML 粘贴转换优化。
- 代码块保护：粘贴时不破坏 fenced code。
- CRLF + Frontmatter 兼容。
- Callout 保留。
- 图片不再吞掉相邻文字。
- 粘贴门槛拓宽。
- 复制按钮增强。

---

## [1.2.21] ~ [1.2.18]

版本号同步与小修复（见对应提交 `bump version to 1.2.x`）。无功能性用户可见变更。

---

## [1.2.17] — 2026-07

### Fixed
- `asset://` 图片重开后裂图。
- 启动黑闪。

---

## [1.2.16] — 2026-07

### Fixed
- 编译修复：移除不存在的 `proxy()` 方法调用。
- 版本号同步（`package.json` + `tauri.conf.json`）。

---

## [1.2.15] — 2026-07

### Fixed
- 自动更新代理检测：4 优先级兜底（env / Git / 注册表 / 端口探测），跨平台注入 updater builder + `HTTPS_PROXY` 环境变量。

---

## [1.2.14] ~ [1.2.11]

- 图片粘贴保存为文件而非 base64 内嵌，统一路径策略。
- 字体缓存 IPC 重写；文档加载时待转换标题处理。
- 自动聚焦编辑器，创建即可输入。
- 修复字体缓存 asset protocol scope，回归 `convertFileSrc`。
- 各类编译告警清理。

---

## [1.2.10] — 2026-07

### Fixed
- Callout 斜杠命令：包裹选中文字而非插入空块。

---

## [1.2.9] — 2026-07

### Fixed
- NSIS 安装器路径修正（自定义 target triple）。

---

## [1.2.8] — 2026-07

### Added
- 自动更新（auto updater）支持。

---

## [1.2.7] — 2026-07

### Fixed
- CJK 加粗 / 斜体边界修复：ZWNJ 预处理解决中文标点与 `*_**` 定界冲突。

---

## [1.2.6] — 2026-07

### Fixed — roundtrip 稳定性
- 列表 / codespan / 标题 / fence / URL / 水平线 多处序列化往返修复。

---

## [1.2.5] — 2026-07

### Changed
- 移除单实例限制，多进程独立 WebView2 数据目录（每个窗口独立）。

---

## [1.2.3] — 2026-07

### Fixed
- NSIS 安装时注册表修复（无需启动即可生效）。
- 显示名修复（`solo文档`）。
- ShellNew 去重、中文显示名、图标索引、版本号同步。

---

## [1.2.2] — 2026-07

### Added
- 粘贴 Markdown 自动转换。
- 剪贴板复制（Copy as Markdown/HTML）。
- PDF 按钮重命名。

### Fixed
- P0 菜单事件、P1 Callout/注册表/重命名、性能优化。

---

## [1.2.1] — 2026-07

### Added
- 多窗口。
- 内存优化。
- 脚注（footnotes）。

### Fixed
- 失焦时不再销毁编辑器，保持内容可见。

---

## [1.2.0] — 2026-07

### Added
- 窗口置顶（Always on Top）。
- 字体按需下载（Rust reqwest 绕过 CSP/CORS），下载进度条。
- `.md` 文件图标与右键「新建 .md」注册。
- 启动闪烁修复：窗口先隐藏，状态恢复后显示。
- 多窗口内存优化（WebView2 `MemoryUsageTargetLevel`、失焦降内存、销毁链加固）。
- 主题切换行间距修复。
- Callout 多轮设计迭代（最终对齐 GitHub Markdown Alerts：左边框 + icon）。
- 表格 CSS 对齐 prosemirror-tables 官方设计，列拖拽独立调整。
- 文件名随 displayName 变更自动重命名。

---

## 更早版本

- **v1.1.x** — 极简 Markdown 编辑器起步阶段（含沉浸模式、置顶图标、Callout 早期设计等）。
  详细提交可在仓库 `git log` 中查阅。

---

## 版本号规则速记

| 变更类型 | 升哪位 | 示例 |
|---|---|---|
| 新增功能 / 非破坏性改进 | 次版本 | 1.2.8 → 1.2.9 |
| 仅修复 bug | 修订号 | 1.2.9 → 1.2.10 |
| 破坏性变更 | 主版本 | 1.x → 2.0 |

发版完整流程见 [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md)。
