# solo 项目档案

> 每次新会话先读此文件，立即进入工作状态。

## 快速启动

```bash
# 开发（前端 + Tauri）
cd F:\fzz-Project\md-editor\md-editor
bun run dev:tauri

# 完整打包（含安装包）
M:\temp\build_solo_tauri.bat

# 只编译 Rust（不打包）
M:\temp\build_solo_full.bat
```

## 项目路径

`F:\fzz-Project\md-editor\md-editor`

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面框架 | Tauri | 2.11.2 |
| 原生核心 | Rust | 1.96.0 |
| 前端框架 | Vue 3.5 + Pinia + TS | — |
| 编辑器 | TipTap v3 (ProseMirror) | 3.26 |
| Markdown 解析 | markdown-it | — |
| 构建 | Vite 7 + vue-tsc 3.3 | — |
| 包管理 | Bun | 1.3.14 |
| 样式 | Tailwind CSS 4 | 4.3 |
| 打包格式 | NSIS (安装包 .exe) | — |

## 环境变量（强制）

```bash
# MSVC 环境必须最先激活
call M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat

# Rust（必须用 .bat 设置，避免 PowerShell 尾随空格）
set CARGO_HOME=M:\rust\.cargo
set RUSTUP_HOME=M:\rust\.rustup
set PATH=M:\rust\.cargo\bin;%PATH%
```

## 关键文件

| 用途 | 路径 |
|---|---|
| Tauri 配置 | `src-tauri/tauri.conf.json` |
| Rust 入口 | `src-tauri/src/lib.rs` |
| Rust 窗口事件 | `src-tauri/src/commands/window.rs` |
| Rust 文档命令 | `src-tauri/src/commands/document.rs` |
| Rust 状态管理 | `src-tauri/src/state.rs` |
| Rust 菜单 | `src-tauri/src/menu.rs` |
| Rust 注册表关联 | `src-tauri/src/commands/desktop.rs` |
| NSIS 安装钩子 | `src-tauri/nsis-hooks.nsh` |
| 前端入口 | `src/main.ts` |
| 编辑器组件 | `src/components/Editor/MarkdownEditor.vue` |
| 文档生命周期 | `src/composables/useDocumentSession.ts` |
| 窗口会话 | `src/composables/useAppWindowSession.ts` |
| IPC 服务层 | `src/services/tauri/window.ts` |
| 粘贴检测 | `src/components/Editor/tiptap/extensions/markdown-paste.ts` |
| 导出弹窗 | `src/components/ExportPopover.vue` |
| 命令注册 | `src/commands/registry.ts` |
| **Parser** | `src/components/Editor/tiptap/markdown/parser.ts` |
| **Serializer** | `src/components/Editor/tiptap/markdown/serializer.ts` |
| **测试工具** | `src/components/Editor/tiptap/markdown/__tests__/test-utils.ts` |
| **Fixture 测试** | `src/components/Editor/tiptap/markdown/__tests__/fixtures.spec.ts` |
| **Fuzz 测试** | `src/components/Editor/tiptap/markdown/__tests__/fuzz.spec.ts` |
| **Roundtrip 测试** | `src/components/Editor/tiptap/markdown/__tests__/roundtrip.spec.ts` |
| **Fixture 文档** | `src/components/Editor/tiptap/markdown/__tests__/fixtures/*.md`（17 个） |

## 架构决策（不可违反）

### v1.2.x 系列修复摘要

**窗口生命周期**：
- `on_window_event` 只能注册一个回调 → 所有逻辑合并到 `attach_window_events()`（close 拦截 + focus/blur + destroyed 清理）
- `window.set_focus()` 受 Windows 前台锁限制，不一定成功 → 前端 `setTimeout(50ms)` 兜底
- `LoadedWindows` / `FocusedWindow` 在 destroyed 时清理，防止内存泄漏

**编辑器懒加载**：
- 窗口获得焦点前不创建 TipTap 实例，节省内存
- blur 时 destroy 编辑器，focus 时重建
- `@click.self` → `@click`（编辑器未创建时 target 不是 editor shell）
- `MemoryUsageTargetLevel=Low` blur 时降低内存

**保存与退出**：
- `isSaving` 锁保护并发保存，close 时等待 ≤1s 而非直接放弃
- `handleCloseRequest` 先停 auto-save 再弹对话框
- `app.exit(0)` 必须通过 IPC 命令调用（Rust `#[tauri::command]`），不能在主线程调

**StateFlags**：移除 `FULLSCREEN`（GH bug #3215，全屏后窗口尺寸不恢复）

### 文件关联（v1.2.3 关键修复）

**问题**：Tauri 的 `fileAssociations` 只写 ProgID/UserChoice，不写 ShellNew（新建菜单）和 DefaultIcon `,0`（图标索引）。Rust 的 `register_shell_new` 虽然补全了这些，但**只在 app 启动时执行**，用户安装后首次打开前关联不生效。

**方案（NSIS installerHooks）**：`src-tauri/nsis-hooks.nsh` 在安装阶段写入：
- `HKCU\Software\Classes\.md\ShellNew` + `NullFile`（右键新建）
- 删除 `HKCU\Software\Classes\.markdown\ShellNew`（消除旧版重复项）
- DefaultIcon 追加 `,0`
- `SHChangeNotify(0x08000000)` 刷新 Explorer

`tauri.conf.json` 配置：
```json
"nsis": {
  "installerHooks": "./nsis-hooks.nsh"
}
```

**效果**：安装即生效，无需启动 app。Rust `register_shell_new` 保留为 Settings 重注册保底。

### Markdown parser/serializer roundtrip 修复（ffa2d2a）

**问题一：嵌套列表序列化结构丢失**

| 步骤 | 现象 |
|------|------|
| 编辑器中创建 `- parent` + indent `- child` | 视觉上正确 |
| save（serialize） | `- parent\n\n- child`（空行隔开了！） |
| reopen（parse） | 变成两个独立列表，嵌套丢失 |

**根因**：`serializer.ts::renderContent()` 在所有块级子节点之间插入 `blankLine()`，listItem 内含 paragraph + bulletList 时，子列表前被加了空行。同时 `renderList()` 对嵌套层级的 `- ` 前缀不做缩进。

**修复**（`serializer.ts`）：
- 新增 `listDepth` 计数器，`renderList` 自增，退出恢复
- `renderList` 每项前缀加 `'   '.repeat(savedDepth)` 缩进（3sp/级）
- `renderContent` 在 `inTightList` 时用 `ensureNewline()` 替代 `blankLine()`

**问题二：任务列表 roundtrip 内容丢失**

| 步骤 | 现象 |
|------|------|
| `- [x] done` → parse | 开 `bulletList` + `taskItem{checked:true}` |
| serialize | `- [x] done` ✓ 但 `[ ]` 每次多 1 个空格 |
| 再 parse | checked 丢光，空格膨胀 |

**根因**：
1. `bullet_list_open` 始终开 `bulletList`，不接受 `taskItem` 子节点 → `createAndFill` 退化到空段落
2. `checked` 状态在 markdown-it-task-lists 的 `html_inline` token 里（`<input checked="" type="checkbox">`），不在 `li_open` class 中。原 parser 跳过了所有 checkbox
3. checkbox 被删除后，文本 `" done"` 前导空格残留，与 serializer delimiter 空格叠成双空格

**修复**（`parser.ts`）：
- `bullet_list_open`：前看 token 检测 `task-list-item` class → 开 `taskList`
- `html_inline`：检测 `checked=""` → 在 stack 中找 parent `taskItem` 设置 `attrs.checked = true`
- `inline`：checkbox 后相邻文本去掉 1 个前导空格

**测试策略**：fixtures.spec.ts 每次读 `.md` 文件跑 `parse→serialize→parse→serialize`，两轮输出一致才算通过。不依赖精确输入/输出匹配（serializer 会归一化空格/缩进）。新增 fixture 只需在 `fixtures/` 放一个 `.md` 文件，零代码改动。

### blockquote（引用）vs callout（重点）视觉差异化

**原则**：引用可以带边线底色，重点（callout）不允许任何边线——纯背景色卡片。blockquote 是唯一带边线的元素。

**blockquote（引用）**：左边框 + 微底色 + 灰文字 + 右侧圆角。保留原始设计。

**callout（重点）**：纯卡片，无 `border`，无 `border-left`，无 `border-radius`（`border-radius: 0` 匹配其他 UI 组件）。`::before` 显示类型标签（NOTE/TIP/WARNING...），大写 0.7em weight 700，颜色按 type 使用主题变量。

**背景色浓度**：light 主题 `calloutNoteBg` opacity 0.08→0.11，dark 0.10→0.12（v1.2.4 调重）。

### 主题 highlight 样式硬编码问题与 serializer 双 escape 模式
- **文件保存**（`clipboard=false`）：严格转义 14 个字符，保证 roundtrip fidelity
- **剪贴板**（`clipboard=true`）：仅转义 `\` `` ` `` `*` + 行首 `#+-.>=`，避免 `\=` `\?` `\!` 等多余符号

### Roundtrip 修复 — `!` `?` 过度转义 + CJK 标点加粗边界（2026-06-29）

**背景**：v1.2.5 后 roundtrip 测试（parse→serialize→parse→serialize）共 75 项，3 项失败：
1. `**hello!**` → roundtrip 后 `\*…\*`（`!` 被 seq2 误转义）
2. `**hello?**` → 同上（`?`）
3. `**沉浸式体验，**继续` → 解析器无法识别 CJK 标点 `，` 后的 `**` 关闭符

**根因分析**：

**Fix A（`!`/`?` 过度转义）**：serializer `escapeInline` 正则 `/([\\`\*_{}\[\]()#+\-.!?~|<>])/g` 包含 16 个字符，其中 `!` 和 `?` 在 CommonMark 中无特殊语义，序列化时多余。直接删去即消除 2 个失败。

**Fix B（CJK 标点后 `**` / `*` 边界）**：markdown-it 的 `scanDelims` 中，当 delimiter `**`/`*` 前字符为 Unicode 标点且后字符非空白非标点时，`right_flanking` 判定为 false → `canClose=false` → 强调标记无法关闭。影响 `**` bold 和 `*` italic 两种强调标记。

**Fix B 方案**（serializer.ts）：
- 新增 `_isUnicodePunctOrSym(c: string)` → `\p{P}|\p{S}` Unicode 类别判断
- 新增 `_delimiterBoundaryUnsafe(mark, text, nextText)` → 检测 closing `**`/`*` 前是否：文本以 Unicode 标点结尾 && 后文非空且首字符非空白非标点
- `renderMarks` closing 分支：当 `boundaryUnsafe` 时，在 delimiter 前插入 ZWNJ（U+200C）→ 解析器 `right_flanking=true` → 正确关闭加粗/斜体
- 作用于 bold `**` 和 italic `*` 两种强调标记
- ZWNJ 属于 Unicode Cf（Format），不影响渲染，不触发边界，不会级联退化

**方案对比**：
- `a)` 改 markdown-it 内部 `right_flanking` 规则 → 风险高，破坏 CommonMark 合规性
- `b)` `<strong>` 标签兜底 → parser 当前 `html: false` 会丢弃标签
- `c)` 开启 `html: true` → 改变 HTML 块处理行为，副作用不可控
- `d)` **ZWNJ 插入（采用）** → 零副作用，仅影响 editor→file→editor 回环

**方案对比**：
- `a)` 改 markdown-it 内部 `right_flanking` 规则 → 风险高，破坏 CommonMark 合规性
- `b)` `<strong>` 标签兜底 → parser 当前 `html: false` 会丢弃标签
- `c)` 开启 `html: true` → 改变 HTML 块处理行为，副作用不可控
- `d)` **ZWNJ 插入（采用）** → 零副作用，仅影响 editor→file→editor 回环

**测试更新**：
- `!` 转义测试：移去 `\!` 预期 → 不转义
- CJK 边界测试：分两个 case — 纯 markdown roundtrip 退化 `\*\*…\*\*` 预期；含 ZWNJ 的 reopen 场景保真

### 全进程卡死根因修复 — 单实例拆除 + 多进程独立 WebView2 数据目录（v1.2.5）

**问题**：solo 在长时间使用后偶发全进程卡死（所有窗口无响应）。重启后短期恢复但最终复发。

**根因（架构级）**：
1. 所有窗口共享同一个 WebView2 EBWebView 目录 → LevelDB 锁竞争（IndexedDB 锁文件残留）
2. 窗口创建（`WebviewWindowBuilder::build()` + `.show()`）在主线程同步执行 → 锁等待直接卡死消息泵
3. `tauri-plugin-single-instance` 将新文件打开路由到已卡死的老进程 → 新进程也陷入死等

**方案**：拆除 `tauri-plugin-single-instance`，改为纯多进程架构。每个 .md 双击启动独立 solo.exe，互不依赖。

**改动文件**：
- `src-tauri/Cargo.toml`：删除 `tauri-plugin-single-instance = "2"`
- `src-tauri/src/main.rs`：新增 `setup_webview2_data_dir()`，启动时通过 `WEBVIEW2_USER_DATA_FOLDER` 环境变量为每个进程分配独立临时目录（`%TEMP%\com.solomarkdown\EBWebView-{PID}-{ms}`），并清理 24h 前过期目录
- `src-tauri/src/lib.rs`：删除 `EARLY_OPEN_REQUEST` static、`store_early_open_request`、`take_early_open_request`、`dispatch_or_store_open_request`、single-instance 插件注册、setup 早期请求恢复；`RunEvent::Opened` 改为直接 `create_editor_window`
- `src-tauri/src/models.rs`：`AppOpenSource` 删除 `Startup` / `SingleInstance` 变体

**内存变化**：~80MB/进程，3 进程 ≈ 240MB（之前 150MB），16GB 机器无感。

**关键约束**：
- `Settings`（tauri-plugin-store JSON + 文件锁）多进程读写安全
- `StartupOpenRequests` / `PendingWindowPaths` / `LoadedWindows` / `FocusedWindow` state 保留，每个进程独立

### CommonMark spec roundtrip 修复（v1.2.6，2026-06-29）

**目标**：fix CommonMark spec roundtrip failures，保持 977 tests all green。

**6项修复（全在 `serializer.ts`）**：

1. **List item block separation**（`renderContent`:260-268）：移除 `inTightList` 判断，所有块间统一 `blankLine()`。Fix Ex 254,263,264,270,271,286-290,300。

2. **Code span backtick delimiter**（`_codeSpanDelims()`:115-148）：计算相邻 code text 中最长 backtick run → N+1 分隔符，首尾字符为 backtick 时加 space padding。Fix Ex 17,329,330,339。

3. **ATX heading trailing # escape**（`:315-322`）：heading inline 后扫描 trailing space+# → 插入 `\` 防 ATX closing marker。Fix Ex 76。

4. **Code fence adaptive delimiter**（`:362-376`）：fence 长度取 content 最长 backtick run，language 含 backtick 时自动切 `~~~` fence。新增 `_maxCharRun()` / `_lineClash()` helpers（`:462-477`）。Fix Ex 123,124,127,134,146。

5. **URL parenthesis escaping**（`:201-203`）：link href 中 `(`→`\(`，`)`→`\)`。Fix Ex 492,498,499,500。

6. **Consecutive HR blank line suppression**（`:270-277`）：相邻 `horizontalRule` 间用 `ensureNewline()` 而非 `blankLine()`。Fix Ex 98。

**测试状态**：
- 27 files / 977 tests all green
- CommonMark spec: 618 pass + 34 skip（设计约束：entity non-re-encoding、setext→ATX、nested emphasis PM limitation、list normalization 等）
- SKIP table（`commonmark.spec.ts`）: 34 entries with documented reasons

**其他**：
- CJK punctuation + bold/italic delimiter boundary protection（ZWNJ insertion）+ ZWNJ dedup from previous session
- 创建 `SOLO_BUILD_PROMPT.md` 用于 Claude Code handoff

## 编译须知

### 版本号同步修改

改版本时需同步 3 处：
- `src-tauri/Cargo.toml` — `[package] version`
- `src-tauri/tauri.conf.json` — `version`
- `package.json` — `version`

### 自动化脚本

| 脚本 | 作用 | 耗时 |
|---|---|---|
| `M:\temp\build_solo_full.bat` | 前端 + Rust 编译（不打包） | ~1m |
| `M:\temp\build_solo_tauri.bat` | 完整打包（含 NSIS 安装包） | ~2m30s |
| `M:\temp\build_solo_frontend.bat` | 仅前端（vue-tsc + vite） | ~15s |

产出：`src-tauri\target\release\bundle\nsis\solo_1.x.x_x64-setup.exe`

### 踩坑速查

| 症状 | 原因 | 解决 |
|---|---|---|
| `link.exe` 找不到 | MSVC 未激活 | 先执行 `vcvars64.bat` |
| `rustup` 找不到工具链 | `RUSTUP_HOME` 尾随空格 | 用 `.bat` 设变量，不用 PowerShell |
| `makensis` 找不到 | 缺 NSIS | `bunx tauri build` 自带 |
| `bunx tauri build` 报错 | 目录不对 | 必须在项目根目录执行 |

### 文件关联验证

安装后检查注册表：

```
# 应该有：
HKCU\Software\Classes\.md\ShellNew\  (默认) = ""
# 不应该有：
HKCU\Software\Classes\.markdown\ShellNew\  （旧版残留，安装时已删）
# 必须以 ,0 结尾：
HKCU\Software\Classes\solo.markdown\DefaultIcon\  (默认) = "C:\...\solo.exe,0"
```

## 测试

### 测试命令

```bash
bun run test       # 全量测试（vitest + happy-dom）
vue-tsc --noEmit   # 类型检查
vite build         # 前端构建验证
```

### roundtrip 测试

所有 Markdown 解析/序列化相关的改动必须通过 roundtrip 验证。

**策略**：两轮稳定性（parse→serialize→parse→serialize，round1 输出 === round2 输出）。
不依赖精确输入↔输出匹配，因为 serializer 会归一化空格/缩进/标记顺序。

**套件**：
| 套件 | 文件 | 数量 | 内容 |
|------|------|------|------|
| Fixture | `fixtures.spec.ts` | 17 | 预置 .md 文件，覆盖 empty/chinese/mixed/marks/headings/lists/blockquotes/code-blocks/table/links-images/footnotes/frontmatter/callouts/math/mermaid/wikilinks/edge-cases/real-world/lists(含嵌套+任务列表) |
| Fuzz | `fuzz.spec.ts` | 100 | 随机生成 bold/italic/strike/highlight/code 组合 |
| Roundtrip | `roundtrip.spec.ts` | 75 | 原有 roundtrip 用例 |
| CommonMark | `commonmark.spec.ts` | 652 | 全量 CommonMark spec（618 pass + 34 skip） |

**新增 fixture**：只需在 `fixtures/` 放一个 `.md` 文件，自动被发现，零代码改动。

### 修改 parser/serializer 后的验证步骤

```
1. bun run test              # roundtrip 全过
2. vue-tsc --noEmit          # 类型检查通过
3. vite build                # 前端构建通过
4. 手动打开 solo 验证真实编辑场景
```

## parser/serializer 内部约定（新接手必读）

### 处理路径

```
保存: Editor state → serializer.ts serializeMarkdown(doc) → .md 文件
剪贴板: Editor state → serializer.ts serializeMarkdownForClipboard(doc) → 系统剪贴板
打开: .md 文件 → parser.ts parse(markdown, schema) → Editor state
粘贴: 剪贴板文本 → markdown-paste.ts 检测 → parser.ts parse(...) → 插入编辑器
```

### escapeInline 双模式（serializer.ts:136-150）

```typescript
// clipboard = false（文件保存）: 严格模式
\_\*`\[\]()~^!?|$<>{}#+-.=

// clipboard = true（剪贴板）: 轻量模式
\` \* 行首 # - + . > =
```

### 任务列表流程（parser.ts）

```
bullet_list_open:
  ├─ 前看"task-list-item" class? → open taskList node
  └─ 否则 → open bulletList node

html_inline:
  ├─ 内容匹配 <input checked="" type="checkbox">?
  │   → 在 stack 中找 parent taskItem, 设 checked=true
  └─ 否则 → 跳过

inline:
  ├─ 前一个兄弟是 checkbox?
  │   → 文本去掉 1 个前导空格
  └─ 否则 → 正常处理
```

## 版本历史

| 版本 | 主要变更 |
|------|----------|
| 1.2.6 | **CommonMark spec roundtrip 6项修复**：code span delimiter、list item blank line、ATX heading # escape、code fence adaptive delimiter、URL parenthesis escaping、consecutive HR blank line suppression。CommonMark skip table 45→34、977 tests all green。 |
| 1.2.5 | **拆除 `tauri-plugin-single-instance`，改为多进程独立架构**：每个 .md 双击启动独立 solo.exe，独立 WebView2 数据目录（`%TEMP%\com.solomarkdown\EBWebView-{PID}-{ms}`），消除 LevelDB 锁竞争导致的全进程卡死。启动时自动清理 24h 前过期目录。 |
| 1.2.4 | callout 去圆角+加重底色，7主题预设 calloutNoteBg 同步；发布 solo_1.2.4_x64-setup.exe |
| 1.2.3 | 文件关联移入 NSIS installerHooks；word count 切换文件修复；highlight mark 主题化；markdown 导出多余转义修复；roundtrip 测试框架 |
| 1.2.2 | 粘贴检测 + Ctrl+C 带源码 + PDF→打印 |
| 1.2.1 | 窗口生命周期全面修复 + 编辑器懒加载 + 保存退出流程 |

## 待办

- P3: 崩溃 `.tmp` 残留清理（搁置）
- TBD: 修改 parser/serializer 前先读 fixture 文件确认预期行为

## 开发习惯

- 任何改动前先读相关文件确认代码实际行为，不以注释为准
- `vue-tsc --noEmit` + `vite build` + `cargo build --release` 逐级验证
- 改了后端（Rust）必须验证前端（`window.ts` / composables 调用方），反之亦然
- 改了 parser/serializer 必须 `bun run test`，全部 roundtrip 通过才算完成
- 每次版本发布先清 `node_modules` + `cargo clean` 再全量构建
