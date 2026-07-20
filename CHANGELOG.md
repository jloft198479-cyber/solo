# Changelog

All notable changes to **solo** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

> 本文件由真实 `git log` 整理而成（非臆想）。更早的 v1.1.x 历史可在仓库提交记录中查阅。
> 每个版本的权威测试数量以 `bun run test` 实际输出为准，本文不硬编码数字。

---

## [1.2.24] — 2026-07-20

### Added
- **统一动效语言 token**：`main.css :root` 新增 `--motion-fast: 120ms` / `--motion-base: 200ms`
  / `--ease-out: cubic-bezier(.2,.8,.2,1)` 三个变量 + `.smooth-enter` 工具类。
  把现有 `mk-menu` 入场、`theme-transitioning` 过渡、SettingsModal 入场动效的
  `ease` 曲线统一替换为 `var(--ease-out)`，时长统一为 token 值。Linear / Raycast
  丝滑的核心不是动效多，而是「一致」——同一时长、同一曲线贯穿全局。
- **`prefers-reduced-motion` 全局关动画**：尊重用户系统偏好（WCAG 无障碍底线），
  所有 `*` / `*::before` / `*::after` 的动画与过渡时长降到 0.01ms，scroll-behavior 改 auto。
- **搜索命中 / 大纲跳转的 300ms 高亮脉冲**：跳转后给目标元素加 `.mk-jump-target`
  类触发 `mk-jump-pulse` 动画（背景色淡入淡出）。UX 研究结论：跳转后明确的视觉反馈
  比静默滚动更能让用户「知道到这儿了」。同一元素连续跳转时强制重排让动画可再次触发。
  Helper `pulseJumpTarget` 从 `useEditorSearch.ts` 导出，`scrollToMatch` 和
  `MarkdownEditor.scrollToPos` 共用，避免重复实现。
- **主题 / 字体切换时编辑区内容 crossfade**：CSS 变量重绘会让内容「闪一下」。
  新增 `triggerContentCrossfade()` helper（在 `themes/manager.ts` 导出），
  切换瞬间给 `.mk-editor` 加 `mk-content-crossfade` 类，200ms 内 opacity 从 0.6 淡入到 1
  （不完全消失，保留用户位置感，参考 Notion / Linear）。主题切换 (`applyTheme`) 和
  字体切换 (`applyFontFamily`) 都调用，连续切换时强制重排让动画可再次触发。
- **字体加载 `font-display: swap`**：`fontLoader.ts` 的 `new FontFace(family, url)`
  加第三参数 `{ display: 'swap' }`。字体加载期间用系统同族字体先顶上，到位无感替换，
  对应 Web Vitals 的「消灭 FOUT（字体切换闪烁）」目标。FontFace JS API 默认行为
  接近 swap，但显式声明意图更清晰。

### Changed
- **乐观保存（Ctrl+S 立刻显示「已保存」）**：原实现等 IPC 返回才清脏标，本地写也有
  几十毫秒延迟，状态栏会有可感知的「未保存→已保存」滞后。改为进入 `saveCurrentDocument`
  主分支后立即 `fileStore.markSaved()`（不带 mtime 参数，不动 lastModifiedTime），
  IPC 飞行期间若用户继续编辑 → `hasUserEdit=true` → 成功后保留脏标等下次保存、仅更新 mtime
  防下次 conflict 误报；失败 / conflict 弹框取消时调 `fileStore.markUserEdit()` 回滚脏标
  并还原 mtime。业界共识（Notion / Linear / Google Docs）：体感来自「开始」而非「结束」。

### Tests
- `useDocumentSession.spec.ts` 补全 fileStore mock：新增 `markUserEdit` / `hasUserEdit`
  / `setContent`，`markSaved` mock 同步重置 `hasUserEdit`（与真实 store 行为一致），
  `beforeEach` 重置新字段。
- `manager.spec.ts` 补全 document mock：加 `querySelector: vi.fn(() => null)` 让
  `triggerContentCrossfade` 在测试环境（无 `.mk-editor`）安全跳过。

---

## 命令面板 + 大纲面板

### Added
- **命令面板（Command Palette）**：新增 `CommandPalette.vue`，快捷键唤起全局命令面板，集中暴露
  新建 / 打开 / 保存 / 切换主题 / 跳转设置等常用操作，减少菜单寻路成本；`CustomTitlebar.vue`
  提供触发入口，`src/commands/registry.ts` 注册可检索命令并按分组展示。
- **大纲面板（Outline Panel）**：新增 `OutlinePanel.vue` + `composables/useOutline.ts`，基于
  文档标题结构实时生成大纲，支持 scroll-spy 高亮当前章节，点击跳转对应位置并复用
  `pulseJumpTarget` 高亮脉冲给出落点反馈；默认收起，沉浸式写作时编辑区保持干净。

---

## 代码审查修复

### Fixed
- **`main.rs`：EBWebView 目录启动清理恢复 staleness 守卫（>24h）**。
  原实现无条件删除所有 `EBWebView-*` 目录，用户双开 solo（两个独立进程）时
  新进程会删掉老进程正在使用的 WebView2 数据目录，导致老进程崩溃。
  改为只删除 24 小时前的残留；拿不到修改时间的目录保守跳过。
- **`resolve_image_display`：恢复 `assets/` 相对引用走文档目录的守卫**。
  原实现只要 `storage_dir` 有值就优先 join，导致设了全局 `imageStoragePath` 后
  `![x](assets/diagram.png)` 被错误解析到 `storagePath/assets/diagram.png`。
  守卫规则集中在 Rust 侧（前端不重复实现），新增 5 个单元测试覆盖路径判别不变量。
- **`resolve_image_display`：补 containment 校验**。
  相对路径解析后必须落在基目录（文档目录或 storage_dir）之内，
  防止 `../../secret.png` 越权授权文档目录之外的文件。
  绝对路径放行（solo 是本地编辑器，用户有权引用 `D:/photos/cat.png` 等外部图片）。
- **Slash 命令菜单在中文/英文文字后不触发**。
  TipTap Suggestion 的 `allowedPrefixes` 默认值是 `[' ']`，即只允许 `/` 出现在
  空格或行首之后。中文没有词间空格习惯——用户在「你好」或「hello」后直接敲 `/`
  完全无反应，菜单不弹出。`editor-extensions.ts` 里 `SlashCommands.configure`
  显式传 `allowedPrefixes: null` 关闭前缀检查，让 `/` 在任意前缀后都能触发。
  新增 9 个回归测试锁死该契约。
- **Mermaid / 数学公式块无法删除**。
  两个块都用 `isolating: true` + `contentDOM: undefined`（为了实现「点击进入
  textarea 编辑」的交互），副作用是标准 Backspace 在块外不删块、块内 textarea
  又是原生 DOM——整个块没有删除入口。修复：顶部加一条 header 顶栏，左侧块类型
  标识（mermaid / math），右侧 × 删除按钮——hover 整块时按钮淡入显示，点击直接
  删整块。textarea 内同时保留 `Mod+Backspace` 作为键盘删除快捷键。
- **Slash / Emoji 菜单被视口边缘遮挡**。
  原定位逻辑只算 `rect.bottom + 4, rect.left`，光标在编辑器下方或右边缘时菜单
  会超出视口。抽出 `computeMenuPosition(rect, viewport)` 纯函数做边界检测：
  下方放不下且上方放得下 → 翻转到光标上方；上下都放不下 → 钉视口顶部靠菜单
  自身 scroll；右侧超出 → 向左收缩；左侧超出 → 钉视口左边。SlashMenu /
  EmojiMenu 共用同一函数。新增 7 个单测覆盖各边界场景。

### Changed
- **`events.ts`：拖拽广播加 try/catch + Set 迭代复制**。
  单个 handler 抛错不再阻断后续 handler 收到事件（遵循「一处崩溃不影响全局」原则）；
  迭代时复制成数组，规避 handler 在回调里 unsubscribe 其他 handler 导致 Set 跳过元素的边缘情况。
  新增 2 个测试用例覆盖以上不变量。

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
