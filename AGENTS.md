# solo 项目工作手册

> 给 AI 和开发者的快速入门 + 纪律约束 + 文档地图。

---

## 项目一句话

solo 是一个 **Tauri v2 桌面端 Markdown 编辑器**（Vue 3 + TipTap + Rust），纯本地、无后端、单文件编辑。

## 工作纪律（不可违反）

### 改代码前
- 先读实际代码行为，不以注释为准
- 确认影响范围：改了这个文件，还有哪些文件受影响？逐个检查

### 改 parser/serializer 后
1. `bun run test` — 所有 roundtrip 测试必须通过
2. `vue-tsc --noEmit` — 类型检查通过
3. `bun run build` — 前端构建通过

### 发版前（🛑 常见踩坑区）
1. **先升版本号**（3 个文件：[package.json](./package.json) / [Cargo.toml](./src-tauri/Cargo.toml) / [tauri.conf.json](./src-tauri/tauri.conf.json)）
2. **检查 `replaceAll`**：TS target ES2020，用 `.split().join()` 替代
3. 确认 tag 名与版本号一致（`v1.x.x`）
4. 完整流程见 [RELEASE_PROCESS.md](./RELEASE_PROCESS.md)

### 提交前
- 不要提交 secrets / key
- 不要提交 `node_modules` / `target`
- 先看 `git status` 再 commit

## 文档地图

| 读者 | 先读这个 | 再看这个 |
|------|----------|----------|
| **新接手** | [HANDOVER.md](./HANDOVER.md) | [AGENTS.md](./AGENTS.md) → [ARCHITECTURE.md](./ARCHITECTURE.md) |
| **找 bug / 定位问题** | [docs/defect-hotspots.md](./docs/defect-hotspots.md) | [docs/KNOWN-ISSUES.md](./docs/KNOWN-ISSUES.md) → [docs/debugging.md](./docs/debugging.md) |
| **查技术决策** | [.opencode/PROFILE.md](./.opencode/PROFILE.md) | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| **改 CJK 边界** | [docs/cjk-boundary.md](./docs/cjk-boundary.md) | [src/components/Editor/tiptap/markdown/parser.ts](./src/components/Editor/tiptap/markdown/parser.ts) / [src/components/Editor/tiptap/markdown/serializer.ts](./src/components/Editor/tiptap/markdown/serializer.ts) |
| **发新版本** | [RELEASE_PROCESS.md](./RELEASE_PROCESS.md) | [.github/workflows/release.yml](./.github/workflows/release.yml) |
| **编译不通过** | [BUILD_GUIDE.md](./BUILD_GUIDE.md) §7 故障排查 | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |
| **想贡献代码** | [CONTRIBUTING.md](./CONTRIBUTING.md) | [SECURITY.md](./SECURITY.md) / [.github/](./.github/) 模板 |

### 快速链接

| 用途 | 路径 |
|------|------|
| 接手入口（环境 + 真理源） | [HANDOVER.md](./HANDOVER.md) |
| 文档索引 + 术语表 | [docs/INDEX.md](./docs/INDEX.md) |
| 已知问题 + 技术债 | [docs/KNOWN-ISSUES.md](./docs/KNOWN-ISSUES.md) |
| bug 易发区地图 | [docs/defect-hotspots.md](./docs/defect-hotspots.md) |
| 调试指南 | [docs/debugging.md](./docs/debugging.md) |
| 版本变更史 | [CHANGELOG.md](./CHANGELOG.md) |
| 协作规范 | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| 安全披露政策 | [SECURITY.md](./SECURITY.md) |
| 项目档案（技术栈 + 架构决策 + 版本历史） | [.opencode/PROFILE.md](./.opencode/PROFILE.md) |
| 体系编译手册 | [BUILD_GUIDE.md](./BUILD_GUIDE.md) |
| 正式发布流程 | [RELEASE_PROCESS.md](./RELEASE_PROCESS.md) |
| 架构参考 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| CJK 标点加粗边界专题 | [docs/cjk-boundary.md](./docs/cjk-boundary.md) |

## 关键约束速查

- **TS target**: ES2020（禁止 `replaceAll`）
- **构建**: `bun run build`（vue-tsc + vite）→ `bunx tauri build`
- **测试**: `bun run test`（Vitest + happy-dom），测试数随用例增减，以实际输出为准
- **Rust**: 1.96.0，edition 2021，`CARGO_HOME=M:\rust\.cargo`
- **MSVC**: Build Tools v14.44，路径 `M:\VS\BuildTools`
- **Bun**: 1.3.14

## 积压待办

（暂无积压。阶段 1（图片 IPC 合并）与阶段 2（拖拽 bug 修复）已于 2026-07-19 完成，详见 `.archive/solo-v2-design/solo-v1-upgrade-roadmap.md`。）

## 历史经验沉淀

- **mermaid 全黑问题**（2026-07-19）：`securityLevel: 'strict'` 导致 DOMPurify 删主题 `<style>`，改为 `'loose'`。本地优先单文件编辑器，loose 安全风险可忽略。
- **拖拽单例互斥覆盖 bug**（2026-07-19）：[src/services/tauri/events.ts](./src/services/tauri/events.ts) 的 `activeDragDropHandler` 是单值变量，后注册覆盖前者。改为 `Set<DragDropHandler>` 广播分发。
- **图片 IPC 合并**（2026-07-19）：新增 `resolve_image_display` 命令，把“路径判别 + authorize”合并为单命令，[src/components/Editor/MarkdownEditor.vue](./src/components/Editor/MarkdownEditor.vue) 调用点从 5 行 if/else 简化为 1 行。
- **代码审查修复**（2026-07-20）：4 处问题修复，全部源自对 `7b8687d` 提交的审查。
  1. `main.rs` 启动清理 EBWebView 目录改回只删 >24h 残留——原实现无条件删全部，双开 solo 时新进程会删掉老进程活动目录导致崩溃。**教训**：清理「按进程隔离」的资源时，必须考虑多进程并存场景，staleness 守卫比「全删」更安全。
  2. `resolve_image_display` 恢复 `assets/` 守卫——合并时丢了「src 以 assets/ 开头走文档目录」的判断，导致设了 `imageStoragePath` 后 `![x](assets/y.png)` 解析错位。**教训**：合并重构时，原有守卫规则必须列出对照清单，逐条确认新逻辑覆盖；判别规则集中在 Rust 侧（真理源），前端不重复实现。
  3. `resolve_image_display` 补 containment 校验——相对路径必须落在基目录之内，防 `../../secret.png` 越权。**教训**：本地优先不等于无边界，路径授权接口都该断言 `starts_with(允许基目录)`；绝对路径放行是本地编辑器的合法用例（用户引用 D:/photos 这类外部图片）。
  4. `events.ts` 广播加 try/catch + Set 迭代复制——单个 handler 抛错会断后续广播。**教训**：广播/分发模式必加 per-handler try/catch，迭代时复制快照防「handler 在回调里动订阅集合」的边缘情况。
- **Slash 命令中文场景失效**（2026-07-20）：用户报告「`/` 命令发挥不出作用」，核实属实。根因是 TipTap Suggestion 的 `allowedPrefixes` 默认值 `[' ']`，只允许 `/` 出现在空格或行首之后——中文没有词间空格习惯，用户在「你好」或「hello」后敲 `/` 完全无反应。修复：`SlashCommands.configure` 显式传 `allowedPrefixes: null`。**教训**：接入第三方库时，对默认值要做「中文场景适用性」评估——很多库的默认假设（如「词间空格」「ASCII 标点」）对中文不成立。回归测试直接测库导出的 `findSuggestionMatch` 函数，避免起完整 editor 的复杂 mock。
- **Mermaid / 数学公式块无法删除**（2026-07-20）：用户反馈「创建了 mermaid 块但不知道怎么删除」。根因是两个块都用 `isolating: true` + `contentDOM: undefined`（为支持「点击进入 textarea 编辑」交互），副作用是标准 Backspace 在块外不删块、块内 textarea 又是原生 DOM——整个块没有删除入口。修复：textarea 内加 `Mod+Backspace` 快捷键删除整块，placeholder 同步提示。**教训**：选 `isolating: true` 这种「光标隔离」设计时，必须同步提供「显式删除入口」——快捷键、按钮或菜单任选其一，否则用户会陷入「能创建能创建不能删除」的死胡同。对比 code-block 用非 isolating + contentDOM=`<code>`，光标能进出、空行 Backspace 自然删块，没有这个问题。
- **体感丝滑优化（基于 workbuddy 方案审核后执行）**（2026-07-20）：
  1. **统一动效 token**（`main.css`）：把分散的 `0.15s ease` / `0.2s ease` / `0.25s ease` 收敛为 `--motion-fast: 120ms` / `--motion-base: 200ms` + `--ease-out: cubic-bezier(.2,.8,.2,1)`。**教训**：丝滑的核心不是「动效多」而是「一致」——Linear / Raycast 用同一时长、同一曲线贯穿全局，比「这儿弹那儿滑」的不一致感更跟手。统一 token 后再加任何交互都顺其自然用 token，不会出现新的偏差。
  2. **乐观保存**（`useDocumentSession.ts`）：原实现等 IPC 返回才清脏标，状态栏有可感知滞后。改为进 `saveCurrentDocument` 主分支后立即 `markSaved()`，IPC 飞行期间用户继续编辑则 `hasUserEdit=true`，成功后保留脏标仅更新 mtime；失败/conflict取消都回滚。**教训**：业界共识（Notion / Linear / Google Docs）「体感来自开始而非结束」——本地原子写几乎不败，乐观 UI 比真快更影响体感。但要补全所有失败回滚路径，包括 conflict 弹框取消这个中间态。
  3. **搜索/跳转命中脉冲**（`useEditorSearch.ts` 的 `pulseJumpTarget`）：跳转后给目标加 300ms 背景淡入淡出动画。**教训**：跳转后明确的视觉反馈比静默滚动更让用户「知道到这儿了」——这是 UX 研究硬结论。同一元素连续跳转要强制重排（`void el.offsetWidth`）让动画能再次触发，否则浏览器会跳过重复 animation。
  4. **主题/字体切换内容 crossfade**（`themes/manager.ts` 的 `triggerContentCrossfade`）：CSS 变量重绘会让内容「闪一下」，给 `.mk-editor` 加 200ms opacity 0.6→1 淡入抹平闪烁。**教训**：crossfade 不完全 opacity=0→1，从 0.6 起避免用户失去位置感（Notion / Linear 的做法）。helper 放在真理源模块（manager.ts）export，避免跨模块依赖反向。
  5. **FontFace `display:'swap'`**（`fontLoader.ts`）：JS API `new FontFace(family, url)` 加第三参数 `{display:'swap'}`。**教训**：FontFace JS API 不吃 CSS `@font-face` 的 `font-display` 属性——必须通过构造函数第三参数控制。显式声明意图比依赖默认行为更清晰。
  6. **`prefers-reduced-motion`**（`main.css`）：全局把动画时长降到 0.01ms。**教训**：动效优化时必须同步加无障碍底线，不能只考虑视觉而忽略用户的「减少动效」系统偏好（WCAG 标准）。

## 沟通风格

- 说人话，言简意赅
- 实事求是，不臆想不编造
- 先想后做，共识前置
- 完成自检再通报
- 被批评后经验必须沉淀到文档
