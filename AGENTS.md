# solo 项目工作手册

> 给 AI 和开发者的快速入门 + 纪律约束 + 文档地图。

---

## 项目一句话

solo 是一个 **Tauri v2 桌面端 Markdown 编辑器**（Vue 3 + TipTap + Rust），纯本地、无后端、单文件编辑。

## 工作纪律（不可违反）

> 工作原则与执行纪律（通用底线，不可违反）见 `docs/project_rules：工作原则和纪律.md`（真理源）；本节只列 solo 项目特有的操作纪律与导航。

### 改代码前
- 先读实际代码行为，不以注释为准
- 确认影响范围：改了这个文件，还有哪些文件受影响？逐个检查

### 改 parser/serializer 后
1. `bun run test` — 所有 roundtrip 测试必须通过
2. `vue-tsc --noEmit` — 类型检查通过
3. `bun run build` — 前端构建通过

### 代码验证（多层自检）
- 改动完成前按 **函数 / 集成 / 用户 / 异常** 四层自检，并**跨端互验**（改后端必验前端，改前端必验后端）——完整框架见团队通用《技术规范》。
- solo 特有必做：
  - **Rust 改动必跑 `cargo check`**：本机缺 MSVC 时不能跳过，CI 是最终闸门（曾因本地跳过导致发版编译失败）。
  - 改 parser/serializer 必跑上节三步（roundtrip + 类型 + 构建）。
  - **退化安全**：任何加载/优化必有 fallback（字体、图片、主题切换等），不假设环境永远正常。

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

### 经验沉淀（标注可复用）

> 通用纪律见 `docs/project_rules：工作原则和纪律.md` 二、执行纪律；以下为 solo 项目细化。

- 跑通的有效做法（无论源自别人验证还是自己验证），只要预判还会再用，就在收尾时标注可复用标签并归入分类记忆 / 技能库，方便下次检索复用。
- 重点标四类：跨任务通用模式、踩过的坑、项目特有约定、第三方库陷阱。
- 未验证的猜测不标——只有「看」到的、验证过的才配打标（连修多版都在「猜」原因的教训）。

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

### 五、改动即自查
- 每改一处，立刻复查语法、逻辑、交叉引用（死链）——不止改完才查。

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
- **SSOT 违规：`read_clipboard_html` 未登记命令名**（v1.2.29）：v1.2.27 新增 `read_clipboard_html` 命令时，`clipboard.ts` 用硬编码字符串 `invoke('read_clipboard_html')` 而非通过 `command-names.ts` 真理源。**教训**：新增 Rust 命令时，必须同步更新 `command-names.ts`（命令名真理源）+ `client.ts` 的 `invokeCommand` 调用方式——不能只在 Rust 侧注册命令就完事，前端调用侧也要走统一入口。
- **字体不生效根因：CSP `font-src` 漏 `asset:` 协议**（v1.2.30）：v1.2.13 把字体加载从 IndexedDB + `blob:` URL 改为 `convertFileSrc` + asset.localhost URL，同时给 `assetProtocol.scope` 加了 font-cache 目录，但**忘了同步更新 CSP 的 `font-src`**——`img-src` 一直有 `asset:`，`font-src` 从第一天起就漏了。结果：首次下载用 `blob:` URL（CSP 允许）能临时生效，但重启读缓存用 `convertFileSrc` 转成 asset.localhost URL 时被 CSP 拦截，字体永不生效。v1.2.29 修了 reqwest system-proxy / 旧缓存兼容 / silent 参数透传等周边问题，但都没碰到核心；v1.2.30 才真正修复根因。**教训**：架构切换（加载方式变更）时必须同步审查 CSP / assetProtocol scope / 命令名 SSOT 等**配置类真理源**——不能只改代码不改配置。CSP 的 `font-src` / `img-src` / `connect-src` 等协议白名单是「资源能加载的最后一道闸门」，代码改了加载方式，CSP 没改等于白改。审查这类问题时要从第一天起查 git log，不能只看近期改动——本 bug 从 v1.2.13 一直潜伏到 v1.2.30，跨越 17 个版本。
- **SSOT 违规复发：`detect_proxy_for_update` 命令名硬编码**（v1.2.30）：`App.vue` 和 `AboutSettingsPanel.vue` 用 `invoke('detect_proxy_for_update')` 直接 invoke，违反「前端不直接 invoke」铁律。与 v1.2.27 的 `read_clipboard_html` 是**同类 bug 复发**。**教训**：新增 Rust 命令后必须立即 grep 全代码库 `invoke('` 字符串，确认没有遗漏的硬编码调用点；CI 可加一条 lint 规则禁止 `from '@tauri-apps/api/core'` 的 `invoke` 直接调用（白名单 `invokeCommand`）。
- **打印时 focus-mode 会丢段落**（v1.2.30）：focus mode 开着时打印，未聚焦段落 `opacity: 0.22` 仍生效，打印结果几乎丢段落——这是数据丢失级别 bug。**教训**：`@media print` 必须显式覆盖所有运行时视觉状态类（focus-mode dimmed、selected、editing 等），不能假设打印时这些 class 不存在。打印样式是「最后一公里」，必须独立测试 focus mode 开 / 关两种场景下的打印输出。
- **排版设计系统性审查**（v1.2.30）：对照 iA Writer / Obsidian / Typora 做全面排版审查，发现 line-height 过松（1.9）、letter-spacing 正值反潮流（0.02em）、标题字距反人类（h1 0.04em 应为负值）、容器偏宽（760px 超过 CJK 黄金行宽）、段落间距偏紧（0.75em）等问题。**教训**：排版参数不能凭感觉定，要对照行业天花板产品的实测数据——iA Writer 的 640px / 18px / line-height 1.5 是基于阅读光学研究的硬结论，不是审美随意值。CJK 场景下 line-height 可略松（1.6-1.7），但不应超过 1.8；letter-spacing 应为 0 或负值（字体设计师已做视觉间距调整，正值等于二次放宽）。设计审查要分维度：节奏（字号差值均匀递减）/ 对比（h5 不应小于正文）/ 惯例（marker 用 muted 色、blockquote italic、图片无 border）三个维度缺一不可。
- **字体不生效真正根因：CSP ≠ CORS，FontFace API 强制走 CORS**（v1.2.32）：v1.2.30 修了 CSP `font-src` 漏 `asset:` 协议（只解决「是否允许发起请求」），但没解决 FontFace API 自身的 CORS 限制（「是否允许读取响应」）。**两道闸门是独立的**：CSP 放行请求不代表 CORS 放行响应。`new FontFace(family, "url('http://asset.localhost/...')")` 的 `fontFace.load()` **默认强制走 CORS 模式**，而 Tauri asset protocol 不返回 `Access-Control-Allow-Origin` 头，字体加载被拦截。**为什么图片正常但字体失败**：图片用 `<img src="assetUrl">`（不走 CORS），字体用 `new FontFace`（强制走 CORS）。修复：新增 `read_font_bytes` Rust 命令读取字体字节，前端用 `blob:` URL 加载 FontFace——blob URL 同源，完全绕过 CORS。三条加载路径（readCache / downloadAndCache 主路径 / fallback）全部改用 blob URL。**教训**：CSP 和 CORS 是两道独立的闸门，修了 CSP 不等于修了 CORS。FontFace API 默认走 CORS 模式，用 asset URL 加载字体必然失败，必须用 blob URL 绕过。排查「资源加载失败」时，先区分资源类型——`<img>`/`<script>`/`<link>` 是普通加载（不走 CORS），`fetch()`/`FontFace`/`XMLHttpRequest` 强制走 CORS；CORS 资源失败时检查响应头有没有 `Access-Control-Allow-Origin`，没有就用 blob URL 绕过。**更深层教训**：连续两版（v1.2.29 修 system-proxy / v1.2.30 修 CSP）都没修对根因，因为都在「猜」失败原因而非「看」失败原因——正确做法是先在 DevTools Network 面板看 FontFace 请求的实际报错（CORS 错误会有明确提示），再定位修复方向，而不是从代码层面推测可能的原因。
- **新增 Rust 命令必须同步三处**（v1.2.32）：v1.2.31 新增 `read_font_bytes` 命令时，只改了 `font.rs`（定义函数）和 `lib.rs`（`generate_handler!` 注册），**漏了 `commands/mod.rs` 的 re-export**，导致 CI cargo check 报 `cannot find function read_font_bytes in this scope` + 连锁触发 never type fallback 错误，v1.2.31 编译失败未发布。**教训**：新增 Rust 命令时三处缺一不可——①`commands/xxx.rs` 定义 `pub async fn`；②`commands/mod.rs` 的 `pub use xxx::{...}` re-export 列表加函数名；③`lib.rs` 的 `generate_handler!` 注册。本次还暴露一个发版流程漏洞：本地因缺 MSVC 环境没真正跑 `cargo check`，误判"已验证通过"——发版前必须真正跑通 `cargo check`，不能因本地环境受限就跳过 Rust 编译验证，CI 是最终闸门。
- **FontFace API vs CSS @font-face：blob URL 绕过 CORS 仍有边缘问题**（v1.2.33）：v1.2.32 用 blob URL 绕过 FontFace API 的 CORS 限制，但 dev 模式实测仍失败——`FontFace.load()` 报 `NetworkError`，且 IPC 传输 `Vec<u8>` 有破坏字体数据的风险（`OTS parsing error`）。**根本原因**：JavaScript `FontFace API` 强制走 CORS 模式，无论 asset URL 还是 blob URL 都有边缘问题；IPC 传输 1.4MB 字节可能被 JSON 序列化破坏。**最终修复**：改用 CSS `@font-face { src: url("assetUrl") }` 注入 `<style>` 标签——CSS `@font-face` 的 `url()` 加载字体**不走 CORS**（W3C 标准行为，和 `<img src>` 一样），用 `document.fonts.load()` 检测加载是否成功。同时移除被 GitHub CDN CORS 拦截的前端 `fetch` 下载路径，直接用 Rust `fetch_font_data` 下载落盘。**教训**：`FontFace API`（JavaScript）和 `@font-face`（CSS）是两套机制——前者强制走 CORS，后者不走。Tauri asset protocol 不返回 CORS 头，`FontFace API` 必然失败，**必须用 CSS `@font-face` 注入**。v1.2.29→v1.2.30→v1.2.32→v1.2.33 连修四版才修对，根因是每次都在「猜」失败原因（network-proxy → CSP → CORS → blob URL）而非「看」实际报错。正确做法：**先在 DevTools Console 加诊断日志看真实报错**，再定位修复方向。字体加载这类问题，第一步就应该试 CSS @font-face 注入（最简单、不走 CORS），而不是绕路用 FontFace API + blob URL。
- **字体不生效终极根因：GitHub release 字体文件被截断**（v1.2.33 深度排查）：v1.2.29→v1.2.33 四版分别修了 system-proxy / CSP / CORS / FontFace API，代码层面都修对了，但字体始终不生效。最终通过 PowerShell 大端序解析 OTF/TTF 表目录发现：GitHub release `fonts-v1` 的 5 个字体文件全部只有 1.4 MB 左右，但内部表（glyf、CFF、GPOS 等）的 offset 指向 800 万字节位置——**文件被截断到只剩头部 + 表目录，表数据全部丢失**。CJK 字体正常应为 8-15 MB。**这才是四版都没修对的终极根因**——文件本身就是坏的，再怎么修加载逻辑也没用。**教训**：遇到「资源加载失败」问题，**第一步应该验证资源本身是否完整**（检查文件大小、magic bytes、表目录 offset+length ≤ 文件大小），而不是从加载机制上猜原因。验证字体完整性：OTF 用 `OTTO` magic，TTF 用 `00 01 00 00` magic；表目录在偏移量 12 开始，每 16 字节一张表（4 字节 tag + 4 字节 checksum + 4 字节 offset + 4 字节 length），所有表 offset+length 必须 ≤ 文件大小。

## 沟通风格

- 说人话，言简意赅
- 实事求是，不臆想不编造
- 先想后做，共识前置
- 完成自检再通报
- 被批评后经验必须沉淀到文档
