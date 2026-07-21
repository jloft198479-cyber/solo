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

### 环境 / 依赖纪律（铁律）
- **绝不擅自下载、安装软件**：任何软件 / 依赖安装前先查本机是否已有（Rust 在 `M:\rust`、MSVC 在 `M:\VS` 等，复用不重装）；需安装须先获明确同意，且尽量装到非系统盘（如 `M:` 盘）。
- **信息更新要及时**：最新信息通过 wiki / 互链保持同步，陈旧无用信息及时清理；改动及时留记录、及时 `git` 提交。

## 文档管理规范（SSOT + DRY + L2 减文件）

> 目标：每件事只在一处写真版，别处只引用不复制，根除信息冗余、版本不一致与 AI 读取无效上下文。

### 一、单一真实源（SSOT）
- 每个事实只在一处写（真理源），别处只放「一句指向它的话 + 链接」，不抄内容。
- 已知真理源地图：技术栈/版本 → `ARCHITECTURE.md`；发版流程 → `RELEASE_PROCESS.md`；bug 易发区 → `ARCHITECTURE.md §11`；问题排查 → `docs/debugging.md` + `docs/KNOWN-ISSUES.md`；文档索引 → `docs/INDEX.md`；版本历史 → `CHANGELOG.md`；代码真相 → 以代码为准（不以注释/文档/记忆）。
- 代码层面的 SSOT 细则（命令名/定义/字体/主题等真理源）见 `ARCHITECTURE.md` §11.6。

### 二、不要重复自己（DRY）
- 信息拆成原子可复用内容，全局统一引用而非复制。
- 纯指针/索引类文件（无独家内容）应并入真理源后删除，不留空壳。
- 多语言 README（zh-CN/ja-JP/ko-KR）是必要本地化，不算冗余，保留。

### 三、L2 减文件纪律（实操）
1. 合并/删文件前，先确认独有价值内容已存在于真理源。
2. 先把所有引用它的链接改指真理源。
3. 再删文件。
4. 删后用「含隐藏目录的递归 grep」跑死链扫描，确认零孤儿引用。
- **两层受众区分**：人类文档（README / CONTRIBUTING / SECURITY / 多语言 README）保持可读、不碎片化；agent 文档（ARCHITECTURE / AGENTS / HANDOVER / docs/*）可激进原子化以省 AI 上下文。
- **禁止为做「原子 include」引入构建工具/新脚本**（守「不擅自装软件」纪律）；Markdown 的 DRY 用链接引用实现，不引 preprocessor。

### 四、死链即 Bug
- 任何指向已删/已改名文件的链接都是 Bug，发现即修。
- 文档若与代码不符，以代码为准并更新文档（见 AGENTS 黄金法则 / CONTRIBUTING）。

---

## 文档地图

| 读者 | 先读这个 | 再看这个 |
|------|----------|----------|
| **新接手** | [HANDOVER.md](./HANDOVER.md) | [AGENTS.md](./AGENTS.md) → [ARCHITECTURE.md](./ARCHITECTURE.md) |
| **找 bug / 定位问题** | [ARCHITECTURE.md §11](./ARCHITECTURE.md)（敏感区速查表） | [docs/KNOWN-ISSUES.md](./docs/KNOWN-ISSUES.md) → [docs/debugging.md](./docs/debugging.md) |
| **查技术决策** | [.opencode/PROFILE.md](./.opencode/PROFILE.md) | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| **改 CJK 边界** | [docs/cjk-boundary.md](./docs/cjk-boundary.md) | [src/components/Editor/tiptap/markdown/parser.ts](./src/components/Editor/tiptap/markdown/parser.ts) / [src/components/Editor/tiptap/markdown/serializer.ts](./src/components/Editor/tiptap/markdown/serializer.ts) |
| **发新版本** | [docs/PLAYBOOK.md](./docs/PLAYBOOK.md) | [RELEASE_PROCESS.md](./RELEASE_PROCESS.md) → [.github/workflows/release.yml](./.github/workflows/release.yml) |
| **编译不通过** | [BUILD_GUIDE.md](./BUILD_GUIDE.md) §7 故障排查 | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |
| **想贡献代码** | [CONTRIBUTING.md](./CONTRIBUTING.md) | [SECURITY.md](./SECURITY.md) / [.github/](./.github/) 模板 |

### 快速链接

> 完整文档索引与术语表见 [docs/INDEX.md](./docs/INDEX.md)（唯一索引真理源，本文不再复述链接表）。

## 关键约束速查

- **TS target**: ES2020（禁止 `replaceAll`）
- **构建**: `bun run build`（vue-tsc + vite）→ `bunx tauri build`
- **测试**: `bun run test`（Vitest + happy-dom），测试数随用例增减，以实际输出为准
- **Rust**: 1.96.0，edition 2021，`CARGO_HOME=M:\rust\.cargo`
- **MSVC**: Build Tools v14.44，路径 `M:\VS\BuildTools`
- **Bun**: 1.3.14（工具链版本 / 环境变量 / 编译命令以 [BUILD_GUIDE.md](./BUILD_GUIDE.md) 为唯一真理源，本文仅摘要点）

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
- **首次启动弹窗 bug 修复不完整（v1.2.26 → Unreleased）**：v1.2.26 曾修过"启动时目标文件不存在弹错误框"，在 `handleOpenPayload` 加了 os error 2 静默跳过逻辑，但 `loadDocumentFromPath` 的内层 catch 先 `await message(...)` 弹窗并 `return false`，错误被吃掉传不到外层 try/catch，静默逻辑形同虚设。修复：给 `loadDocumentFromPath` / `openDocumentWithPrompt` / `handleOpenFile` 加 `silent` 参数，启动链路传 `true` 让错误透传给外层处理。**教训**：错误处理要分层——内层函数不知道调用场景（启动 vs 用户主动），不应该擅自决定是否弹窗；应该把错误抛给外层，由知道场景的调用方决定。修复 bug 时要追完整调用链，确认每一层的行为与预期一致，不能只改最外层。**复查阶段发现两个关键问题**：①`handleOpenPayload` 用 `String(err)` 转换错误对象，但 `invokeCommand` 抛的是 `TauriAppError` 对象 `{code, message}`，`String()` 得到 `"[object Object]"`，正则无法匹配 os error 2——**教训**：错误对象经过 `normalizeTauriError` 包装后是对象不是字符串，提取 message 必须用 `.message` 属性而非 `String()`；②非 os error 2 的错误 `throw err` 会中断 setup 函数，导致 `setupDragDrop()` 不执行、拖拽功能失效——**教训**：启动流程中的错误处理不能 throw 中断后续步骤，应该弹窗提示用户但不 throw，让 setup 继续执行。
- **字体下载回归：注释与代码不符 + reqwest 缺 system-proxy**（Unreleased）：v1.2.28 的 `font.rs` 注释说"无扩展名导致 Content-Type 推断失败"，但查 v1.2.27 源码发现用 family（无扩展名）命名缓存文件**能正常加载**，反证了注释的错误。真正原因是 v1.2.28 改了缓存 key 命名规则导致旧缓存失效 + reqwest 配 `rustls-tls` 未开 `system-proxy` feature 不读系统代理。**教训**：写注释/CHANGELOG 时要核实历史代码行为，不能凭推测写"原因"；`reqwest` 配 `default-features = false` + `rustls-tls` 时，`system-proxy` feature 不在 rustls-tls 里自动开启，需要显式加——否则 rustls-tls 既不读系统证书也不读系统代理，网络受限环境必败。
- **SSOT 违规：`read_clipboard_html` 未登记命令名**（Unreleased）：v1.2.27 新增 `read_clipboard_html` 命令时，`clipboard.ts` 用硬编码字符串 `invoke('read_clipboard_html')` 而非通过 `command-names.ts` 真理源。**教训**：新增 Rust 命令时，必须同步更新 `command-names.ts`（命令名真理源）+ `client.ts` 的 `invokeCommand` 调用方式——不能只在 Rust 侧注册命令就完事，前端调用侧也要走统一入口。

## 沟通风格

- 说人话，言简意赅
- 实事求是，不臆想不编造
- 先想后做，共识前置
- 完成自检再通报
- 被批评后经验必须沉淀到文档
