# Changelog

All notable changes to **solo** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

> 本文件由真实 `git log` 整理而成（非臆想）。更早的 v1.1.x 历史可在仓库提交记录中查阅。
> 每个版本的权威测试数量以 `bun run test` 实际输出为准，本文不硬编码数字。

---

## [1.2.34] — 2026-07-23

> 注意：v1.2.33 记录的「CSS `@font-face` 注入方案」在**真实 WebView2** 下仍被 Tauri asset 协议（不返回 `Access-Control-Allow-Origin` 头）静默拦截——字体文件下载落盘成功，但 `FontFace` 加载字体强制走 CORS 模式，浏览器静默拒收、`document.fonts.check` 只悄悄返回 `false`。因此 v1.2.33 字体**实际仍未生效**。本版本改用 IPC 字节通道才真正修复。

### Fixed
- **字体真正生效：缓存渲染改走 IPC 字节通道**。原 `readCache` 用 `toAssetUrl()`（asset:// 协议）注入 `@font-face`，被 CORS 静默拦截。改为 `readFontBytes`（Rust 命令经 IPC 取字节）→ `new FontFace(family, bytes)` 同源加载，彻底绕开 asset 协议 CORS。Rust 侧 `read_font_bytes` 基础设施由 v1.2.32 写好但渲染层未接上，本版本接上。dev 窗口实测：切换下载型字体（思源宋体/汇文明朝/霞鹜文楷 等）正文即时变字形，Console 见 `registerFontFromBytes ... status="loaded", check=true`。
- **霞鹜文楷实为 Lite 轻便版（资源错配）**。`LXGWWenKai-Regular.ttf` 文件名标 Regular，但字体名表内部真实家族名为 `LXGW WenKai Lite`（霞鹜文楷轻便版），导致用户看到字形与预期不符。代码逻辑无误（四处 family 名自洽），问题在资源文件本身。修复：`src/constants/fonts.ts` 的 `value`→`'LXGW WenKai Lite'`、`label`→`'霞鹜文楷 Lite'`；`src/utils/fontStack.ts` 匹配分支同步对齐（不动 `fileName`，避免牵动 release/cache key）。用户若此前在设置里选过旧值「霞鹜文楷」，需重新选一次「霞鹜文楷 Lite」。

### Changed
- **字体 IPC 封装抽离为独立模块** `src/services/tauri/font.ts`：`fetchFontData` / `getCachedFontPath` / `readFontBytes` / `saveCachedFont` 从 `document.ts` 迁出，`fontLoader.ts` 的 import 改指 `./tauri/font`。字体相关逻辑收口到一个模块，便于后续排查（与文档/图片调用解耦）。`document.ts` 不再承载字体关注点。

### 经验沉淀
- **字体类「加载失败」第一步应验证资源本身**：本版本前多个 agent（含本人早期）都在查下载通道 / CSP / CORS / 代码逻辑，没人第一步解析字体文件内部 `name` 表确认它到底是不是声称的字体。霞鹜这一例正是「文件名 ≠ 文件内容」的资源错配。
- **单元测试绿 ≠ 字体真显示**：solo 测试是 Vitest + happy-dom（模拟浏览器），不模拟真实 WebView2 的 CORS 行为、也不渲染字体。字体修复必须 `bun run tauri dev` 起真窗口肉眼验证。

---

## [1.2.33] — 2026-07-22

### Fixed
- **字体不生效最终修复：改用 CSS `@font-face` 注入替代 FontFace API**。v1.2.31/v1.2.32 用 blob URL 绕过 FontFace API 的 CORS 限制，但 dev 模式实测仍失败（`FontFace.load()` 报 `NetworkError`，且 IPC 传输 `Vec<u8>` 有破坏字体数据的风险）。**根本原因**：JavaScript `FontFace API` 强制走 CORS 模式，无论用 asset URL 还是 blob URL 都有各种边缘问题。**修复方案**：改用 CSS `@font-face { src: url("assetUrl") }` 注入 `<style>` 标签——CSS `@font-face` 的 `url()` 加载字体**不走 CORS**（和 `<img src>` 一样，W3C 标准行为），用 `document.fonts.load()` 检测加载是否成功。同时移除了被 GitHub CDN CORS 拦截的前端 `fetch` 下载路径，直接用 Rust `fetch_font_data` 下载落盘后走 CSS @font-face 加载。**教训**：`FontFace API`（JavaScript）和 `@font-face`（CSS）是两套机制——前者强制走 CORS，后者不走。Tauri asset protocol 不返回 CORS 头，所以 `FontFace API` 必然失败，必须用 CSS `@font-face` 注入。
- **【根因追加】GitHub release `fonts-v1` 的字体文件全部被截断**（v1.2.33 深度排查发现）。通过 PowerShell 大端序解析 OTF/TTF 表目录，发现 5 个字体文件全部只有 1.4 MB 左右，但内部表（glyf、CFF、GPOS 等）的 offset 指向 800 万字节位置——文件被截断到只剩头部 + 表目录，表数据全部丢失。**这才是 v1.2.29 ~ v1.2.33 四个版本字体一直不生效的终极根因**——之前修 CSP、CORS、FontFace API 都是代码层面的正确修复，但文件本身就是坏的，再怎么修加载逻辑也没用。**教训**：遇到"资源加载失败"问题，第一步应该验证资源本身是否完整（检查文件大小、表目录偏移量），而不是从加载机制上猜原因。

### Added
- **互链跳转（最小可用版）**：`[[文档名]]` 单击跳转同目录目标文档；未保存文档点击时提示先保存；无扩展名自动补 `.md`；兼容 `\` 与 `/` 分隔符。涉及 `wikilink.ts`（`resolveWikilinkTarget` 纯函数 + 点击插件）、`editor-extensions.ts`、`MarkdownEditor.vue`、`App.vue`，含回归测试 `wikilink.spec.ts`。
- **粘贴质量兜底（P0）**：HTML 粘贴解析结果为「全白话段落、无 mark/结构」时，自动回退用 markdown 重新解析。双重保险门（`isLowQualityParse` + markdown 源检测）**不触碰现有正常路径**（豆包/DeepSeek 问答粘贴），含回归守卫测试 `markdown-paste.spec.ts`。

### Changed
- **字体下载硬化**：Rust 侧 `font.rs` 新增 `validate_font_bytes()`，下载后与写缓存前校验字体完整性（magic bytes + 表目录 offset/length 合法），从源头阻断坏字体落盘。

---

## [1.2.32] — 2026-07-22

### Fixed
- **字体不生效真正根因：FontFace API 的 CORS 限制**。v1.2.30 修了 CSP `font-src` 漏 `asset:` 协议，但只解决了 CSP 拦截问题，**没有解决 FontFace API 自身的 CORS 限制**。CSP 和 CORS 是两道独立的闸门：CSP = "是否允许发起请求"（v1.2.30 已修），CORS = "是否允许读取响应"（Tauri asset protocol 不返回 `Access-Control-Allow-Origin` 头，FontFace.load() 被拦截）。**为什么图片正常但字体不生效**：图片用 `<img src="assetUrl">`（不走 CORS），字体用 `new FontFace(family, "url('assetUrl')")`（**强制走 CORS**）。修复：新增 Rust 命令 `read_font_bytes` 读取字体字节，前端拿到字节后创建 `blob:` URL 加载 FontFace——blob URL 是同源，完全绕过 CORS。三条加载路径全部改用 blob URL：readCache（重启读缓存）、downloadAndCache 主路径（前端 fetch 成功）、downloadAndCache fallback（Rust 下载）。**教训**：CSP ≠ CORS，CSP 放行了请求不代表 CORS 放行了响应。FontFace API 默认走 CORS 模式，用 asset URL 加载字体必然失败，必须用 blob URL 绕过。**（注：此方案在 dev 实测中仍有边缘问题，v1.2.33 改用 CSS @font-face 彻底解决。）**
- **v1.2.31 CI 编译失败修复**：v1.2.31 新增 `read_font_bytes` 命令时，`commands/mod.rs` 的 re-export 列表漏了 `read_font_bytes`（只列了 `fetch_font_data, get_cached_font_path, save_font_cache`），导致 `lib.rs` 的 `generate_handler!` 找不到该函数，CI cargo check 报 `cannot find function read_font_bytes in this scope` + 连锁触发 never type fallback 错误，v1.2.31 因此未发布。修复：补全 re-export。**教训**：新增 Rust 命令时，除在 `font.rs` 定义函数 + `lib.rs` 的 `generate_handler!` 注册外，**必须同步更新 `commands/mod.rs` 的 re-export 列表**——三处缺一不可。

---

## [1.2.31] — 未发布（CI 编译失败）

v1.2.31 尝试用 blob URL 绕过 FontFace API 的 CORS 限制，但因 `commands/mod.rs` 漏了 `read_font_bytes` 的 re-export 导致 CI 编译失败，未发布。内容已并入 v1.2.32。

---

## [1.2.30] — 2026-07-22

### Fixed
- **字体不生效根因：CSP `font-src` 漏 `asset:` 协议**（历史遗留 bug）。v1.2.13 把字体加载从 IndexedDB + blob: URL 改为 `convertFileSrc` + asset.localhost URL，同时给 `assetProtocol.scope` 加了 font-cache 目录，但**忘了同步更新 CSP 的 `font-src`**——`img-src` 一直有 `asset:`，`font-src` 从第一天起就漏了。结果：首次下载用 `blob:` URL（CSP 允许）能临时生效，但重启读缓存用 `convertFileSrc` 转成 asset.localhost URL 时被 CSP 拦截，字体永不生效。v1.2.29 修了 reqwest system-proxy / 旧缓存兼容 / silent 参数透传等周边问题，但都没碰到核心；v1.2.30 才真正修复根因——CSP 的 `font-src` 加 `asset: http://asset.localhost`，与 `img-src` 完全对齐。**教训**：架构切换（加载方式变更）时必须同步审查 CSP/SSOT 等配置类真理源，不能只改代码不改配置。
- **SSOT 违规：`detect_proxy_for_update` 命令名硬编码**：`App.vue` 和 `AboutSettingsPanel.vue` 用 `invoke('detect_proxy_for_update')` 直接 invoke，违反「前端不直接 invoke」铁律。修复：`command-names.ts` 登记 `detectProxyForUpdate`，两处改用 `invokeCommand + TAURI_COMMANDS.detectProxyForUpdate`。与 v1.2.27 修 `read_clipboard_html` 是同类 SSOT 违规复发。
- **打印时 focus-mode 会丢段落**（bug 级）：focus mode 开着时打印，未聚焦段落 `opacity: 0.22` 仍生效，打印结果几乎丢段落。修复：`@media print` 强制 `html.focus-mode .paragraph-dimmed { opacity: 1 }`，同时隐藏代码块语言按钮、mermaid/math 删除按钮、frontmatter header 等编辑态 chrome，容器不限制宽度贴满 A4 printable area。

### Changed
- **排版设计系统性提升（对齐 iA Writer / Obsidian）**：
  - `line-height` 1.9 → 1.7（CJK 友好但不至于过松，iA Writer 1.5 / Obsidian 1.5）
  - 正文 `letter-spacing` 0.02em → 0（回归字体默认设计，不再二次放宽）
  - h1 `letter-spacing` 0.04em → -0.02em（标题应收紧而非放宽，对齐 iA Writer / Obsidian）
  - 容器宽度 760px → 720px（单行约 44 中文字符，符合 CJK 黄金行宽）
  - 段落间距 0.75em → 1em（段落不再抱团，层次分明）
  - h1 margin-top 1.4em → 2.4em，h2 1.2em → 1.8em，h3 1em → 1.2em（章节切换呼吸感）
  - blockquote 加 `font-style: italic`（西方引文排版传统，iA Writer 独创）
  - 代码块/mermaid/math/frontmatter 圆角 6px → 4px（去掉软糖感，Obsidian 4px 一致）
  - 图片移除 1px border（四款天花板全无，让图片沉浸内容流）
  - hr margin 1.5em → 2em（章节切换呼吸感）
  - 标题字号统一（h1-h6 在 editor.css + 7 主题预设间不再漂移，全部 1.5/1.3/1.2/1.05/1/0.9em）
- **图片体验提升**：
  - 新增 caption：图片下方显示 alt 文字，居中 muted 小字号（iA Writer 做法）
  - 新增 loading 占位：图片加载中显示 skeleton 动画背景，防视觉断层
- **可访问性提升**：
  - 全局 `:focus-visible` 焦点环（WCAG 2.4.7 合规，键盘导航有统一焦点环，鼠标点击不显示）
  - 列表 marker 颜色用 muted 色（iA Writer / Notion 一致，正文更突出）
  - `scroll-padding-top: 80px`（预防性修复，防未来 sticky header 遮挡跳转目标）

---

## [1.2.29] — 2026-07-22

### Fixed
- **首次启动仍弹「打开文件失败」错误框**：v1.2.26 曾修过此问题（`handleOpenPayload` 加了 os error 2 静默跳过逻辑），但修复不完整——`loadDocumentFromPath` 的内层 catch 会先 `await message(...)` 弹窗并 `return false`，错误被吃掉传不到外层 try/catch，静默逻辑形同虚设。修复：给 `loadDocumentFromPath` / `openDocumentWithPrompt` / `handleOpenFile` 加 `silent` 参数，启动链路传 `true`，遇到文件不存在时把错误抛给 `handleOpenPayload` 的静默跳过逻辑处理；用户主动打开（菜单/拖拽）仍走默认 `silent=false`，保留合理的错误提示。复查阶段发现并修复两个关键问题：①`handleOpenPayload` 用 `String(err)` 转换错误对象，但 `invokeCommand` 抛的是 `TauriAppError` 对象 `{code, message}`，`String()` 得到 `"[object Object]"`，正则无法匹配 os error 2——改为用 `normalizeTauriError(err).message` 正确提取 message；②非 os error 2 的错误 `throw err` 会中断 setup 函数，导致 `setupDragDrop()` 不执行、拖拽功能失效——改为弹窗提示但不 throw，避免中断后续启动步骤。
- **字体下载在网络受限环境失败**：`reqwest` 配 `rustls-tls`（不读系统证书库）但未开启 `system-proxy` feature，导致 rustls-tls 也不读系统代理，fallback 下载通道在网络受限环境失败。修复：`Cargo.toml` 加 `system-proxy` feature，reqwest 自动读环境变量 + Windows 注册表系统代理。同时修正 `fetch_font_data` 注释——v1.2.28 的注释说"无扩展名导致 Content-Type 推断失败"是错误的（v1.2.27 用 family 命名无扩展名文件能正常加载，反证了这一点）；真正原因是缓存 key 命名变更导致旧缓存失效 + reqwest 不读系统代理。
- **字体缓存兼容 v1.2.27 旧命名**：v1.2.28 改用 fileName（含扩展名）后，v1.2.27 用 family（无扩展名）留下的旧缓存无法识别。`get_cached_font_path` 增加兼容逻辑：先查新名，找不到再查旧名（family），找到则迁移为新名（`fs::rename`）。迁移后旧文件消失，后续都走新名，一次性升级无残留；迁移失败（权限/跨盘）时返回旧路径，字体仍可加载。
- **SSOT 违规：`read_clipboard_html` 命令名未登记**：`clipboard.ts` 用硬编码字符串 `invoke('read_clipboard_html')` 而非通过 `command-names.ts` 真理源。修复：`command-names.ts` 加 `readClipboardHtml`，`clipboard.ts` 改用 `invokeCommand + TAURI_COMMANDS.readClipboardHtml`。

### Changed
- **标题字号整体下调**：h1/h2 在 `editor.css` 默认值和全部 7 个主题预设中下调约 0.1em，让标题与正文的层级对比更克制（h3-h6 保持不变，已接近主流编辑器标准）。

---

## [1.2.28] — 2026-07-21

### Fixed
- **状态栏「已保存」文字颜色跟随主题主色**：此前「已保存」指示用了 `--success-color`（各预设多为绿色系差异极小，且 `scholar` 的 successColor 与 `main.css` 兜底值碰巧相同，掩盖了不跟随的真问题）。改为跟随 `--primary-color`——主题主色是什么，它就是什么，真正做到「颜色跟上主题」而非「拉开色值」。仅改 `App.vue` 两处（`statusbar-stat--success` / `statusbar-save-btn.is-clean`），`.is-dirty` 仍走 `--dirty-color` 不动。
- **正文字体下载失败（缓存文件名变更导致旧缓存失效）**：字体缓存落到 `$APPLOCALDATA/font-cache/` 时，v1.2.27 用 family 名（如 `Noto Serif SC`，无扩展名），v1.2.28 改用 URL 末段的 `fileName`（含 `.woff2` 等扩展名）。改名的本意是与前端 `FONT_OPTIONS.fileName` 字段对齐，避免 family 字符串与磁盘文件名的二次映射；但副作用是 v1.2.27 留下的旧缓存（family 命名）无法被新代码识别，被迫重新下载。`fetch_font_data` / `get_cached_font_path` / `save_font_cache` 三命令同步增 `file_name` 参数；前端 `fontLoader.ts` 下载落盘时补 MIME type。（后续 Unreleased 段补正：早期注释说"无扩展名导致 Content-Type 推断失败"是错误的——v1.2.27 用 family 命名无扩展名文件能正常加载，反证了这一点；真正原因是缓存 key 命名变更 + reqwest 不读系统代理。）
- **从 AI 工具（豆包 / 千问等）复制内容粘贴格式全丢**：此前粘贴来源嗅探只认「专有 markdown 语法」（`#` 标题、`**` 加粗等字面字符 `### 标题` / `**加粗**` 显示出来）。AI 工具常把 markdown 源包在 `pre`/`div` 壳里复制，源是纯 markdown 但被当成 HTML 解析，格式蒸发。扩展嗅探条件为「专有语法 **或** 通用 markdown 源（`looksLikeMarkdownSource`）」，覆盖豆包 / 千问 / 其他把 markdown 包壳复制的场景。新增 2 个回归测试（纯 markdown 源无 HTML / 通用 AI 工具壳场景）断言格式真保留。

---

## [1.2.27] — 2026-07-21

### Fixed
- **复制粘贴格式兼容性（入站）**：从网页 / Word / Notion / 微信等复制的富文本，粘贴事件常不带 `text/html`，导致格式退化成纯文本。原兜底 `navigator.clipboard.read()` 在桌面 webview 不可靠、且官方 `clipboard-manager` 插件并无 `readHtml` API。改为新增 Rust 命令 `read_clipboard_html`（复用项目已有的 `arboard` 依赖直接读系统剪贴板，零新增依赖），缺失 `text/html` 时异步兜底还原格式。回退了两处不存在的 `clipboard-manager:allow-read-html` 权限。
- **复制粘贴格式兼容性（出站）**：编辑器内 `Ctrl+C` 此前无自定义 `clipboardTextSerializer`，选区复制到外部 Markdown 编辑器（Obsidian / Typora）时，callout / 数学公式 / mermaid / wikilink / frontmatter / 脚注等 solo 扩展语法的 Markdown 标记全丢。新增 `serializeClipboardSlice`，将选区序列化为 Markdown 纯文本写入 `text/plain`；`text/html` 仍由 ProseMirror 默认生成（标准格式走 HTML 还原）。
- **状态栏保存按钮颜色不跟随主题**：`cinnabar` 与 `scholar` 预设的 `successColor` 同为 `#6b8e5a`（深色 `#8fb87a`），在两者间切换时「已保存」绿色不变，造成不跟随的错觉。已将 `cinnabar` 改为 `#7ba35a`、`cinnabar-dark` 改为 `#93c06f` 区分。

---

## [1.2.26] — 2026-07-21

### Fixed
- **启动时目标文件不存在不再弹错误框**：更新后重启或通过文件关联（双击 .md）启动 solo 时，若启动参数指向已删除/移动的文件，原行为弹「打开文件失败: 系统找不到指定的文件。(os error 2)」错误框。改为捕获 os error 2 / ENOENT 类错误后 `console.warn` 静默跳过；非文件缺失类错误（如权限问题）仍正常抛出。

---

## [1.2.25] — 2026-07-21

### Fixed
- **粘贴兼容性（核心特性）修复**：从网页 / Word / Notion / 微信 等富文本来源粘贴时格式全丢的问题。
  - **根因**：之前的「兼容性优化」只是给粘贴加了分发器，最常见那一路（富文本来源）直接 `return false` 甩回 ProseMirror 默认粘贴；默认粘贴要保住格式的前提是剪贴板带 `text/html`，在运行时常常没送到，于是退化成纯文本、格式蒸发。优化没碰这个真病根，所以「好像没什么用」。
  - **修复**：HTML 分支不再甩默认，改为用 ProseMirror DOMParser 显式解析 `text/html` 并插入（保格式可控、可测）；当粘贴事件无 `text/html` 时，`navigator.clipboard.read()` 异步从系统剪贴板再读一次 HTML 兜底（桌面端最稳）。
  - **附带修复**：`hasMarkdownOnlySyntax` 行内 `$...$` 误判——要求 `$` 之间不含空格，避免「$10 到 $20」类货币被误判为 markdown 源而走 markdown 解析丢格式。
  - **测试补强**：新增端到端用例，断言富文本 `<strong>`/`<h2>` 真还原加粗/标题节点（堵住此前「只测分发决策、不测格式是否真保住」的盲区）。

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

- **v1.2.18 导出系统移除**（用户可见）：删除 HTML/PDF/微信导出（净删约 2500 行代码），改用状态栏「复制为 HTML」按钮把渲染后 HTML 写入剪贴板。详见 [`ARCHITECTURE.md`](./ARCHITECTURE.md) §10.2。
- 其余为版本号同步与小修复（见对应提交 `bump version to 1.2.x`）。

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
