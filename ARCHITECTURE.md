# solo 架构文档

> **目标**：让任何开发者（人或 AI）在 15 分钟内建立完整、准确的心智模型，并能定位到任意功能的改动入口。
> **写作基准**：一切以**实际代码行为**为准，不依据注释或历史文档。版本对应 `package.json` v1.2.23。

---

## 0. 一分钟读懂

**solo** 是一款**本地优先**的桌面 Markdown 编辑器，面向中文沉浸式写作，审美对标 Linear / Raycast / Notion。

技术栈一句话：**Tauri 2（Rust 原生核心）+ Vue 3 + Pinia + TipTap/ProseMirror + Tailwind CSS 4**。

### 产品哲学

**核心定位**：纯粹的文字创作与阅读空间，非代码编写工具。

**减法原则**：摒弃文件树、结构化目录、侧边栏等冗余设计。"一个文件就是一个文件"，像打开 `.txt` 一样纯粹。桌面右键即可创建 `.md` 文档，双击即开。

**性能底线**：秒开、零卡顿。排斥 Electron 套壳臃肿，追求极小内存占用和安装包体积。Tauri 2 + Rust 原生渲染保障。

**编辑体验**：所见即所得（WYSIWYG），Markdown 语法自动隐藏并即时呈现排版。拒绝左右分屏预览。编辑时界面元素最小化，焦点全在文字。

**排版美学**：书卷气、文艺感，非代码编辑器冰冷风格。对字体（衬线体优先）、行距、段间距要求苛刻。

**粘贴还原**：从网页粘贴时正确还原标题层级、加粗、链接、图片，复杂表格降级接受。

三层结构：

```
Rust 核心 (src-tauri/)   ──20 个命令 + 2 类事件──▶  文件/图片/窗口/字体/注册表
        ▲ invoke / emit
IPC 服务层 (src/services/tauri/)  ──契约封装，前端不直接碰 invoke
        ▲
Vue 前端 (src/)   App.vue 协调层 ──委托──▶ 10 个 composables + 2 个 Pinia store + TipTap 编辑器
```

> ⚠️ 仓库内同时存在 `README.md` 及 `.trae/documents/` 下的早期文档，它们描述了**文件树、workspace watcher、`fs.rs`/`watch.rs`/`config.rs`** 等结构——**这些在当前代码中已不存在**。请一律以**本文档 + 实际代码**为准（差异清单见附录 C）。新入手的 AI 开发者先读 `AGENTS.md`（工作手册）+ `.opencode/PROFILE.md`（技术档案）。

---

## 1. 技术栈实测表

| 层 | 技术 | 版本 | 备注 |
|---|---|---|---|
| 桌面框架 | Tauri | 2.x | 无边框窗口、自定义标题栏、CLI（多进程）、OS-open |
| 原生核心 | Rust | — | thiserror + serde + reqwest + winreg(Windows) |
| 前端框架 | Vue 3 | 3.5 | Composition API + `<script setup>` |
| 语言 | TypeScript | ~6.0 | strict 模式 |
| 状态管理 | Pinia | 3.x | 2 个 store：file / settings |
| 构建 | Vite | 8.x | |
| 样式 | Tailwind CSS 4 + CSS 变量 | 4.3 | 主题靠 CSS 变量驱动 |
| 编辑器 | TipTap / ProseMirror | 3.26 | 实例复用，不随文件切换重建 |
| Markdown | markdown-it + 自研 parser/serializer | 14.2 | 自研链路，非 prosemirror-markdown |
| 数学/图表 | KaTeX / Mermaid | 0.17 / 11.x | KaTeX 懒加载，不进解析器热路径 |
| 测试 | Vitest + happy-dom | 4.x | spec 文件数与测试数随用例增减，以 `bun run test` 输出为准 |
| 包管理 | bun | 1.3.14 | |

**命名说明**：
- 项目正式名称 = **solo**
- `tauri.conf.json` 的 `productName` = `solo`（安装包/窗口标题显示名）
- `identifier` = `com.solomarkdown`（注册表/Bundle 唯一标识）

---

## 2. 三层架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                       Vue 前端 (src/)                            │
│                                                                  │
│   main.ts ──createApp──▶ App.vue (协调层，~370 行，无业务逻辑)    │
│                              │                                  │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│         composables      Pinia stores     组件树                │
│         (10 个，按       ┌─ file.ts       App ▸ Editor           │
│          关注点拆分)     └─ settings.ts   ▸ Settings(15)         │
│                                                ▸ Layout 等       │
└──────────────────────┬──────────────────────────────────────────┘
                       │ 只调服务层，绝不直接 invoke/listen/emit
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                  IPC 服务层 (src/services/tauri/)                │
│                                                                  │
│   client.ts ── invokeCommand<T>() ── 唯一入口                    │
│   command-names.ts ── TAURI_COMMANDS ── 命令名集中表              │
│   document/window/dialog/clipboard/... ── 按领域封装              │
│   normalizeTauriError() ── 把 Rust AppError 解析成 {code,message} │
└──────────────────────┬──────────────────────────────────────────┘
                       │ Tauri IPC 边界
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Rust 核心 (src-tauri/src/)                     │
│                                                                  │
│   lib.rs ── run() ── 插件注册 / 启动开打 / 菜单 / 关闭拦截        │
│   commands/ ── document/font/window/desktop ── 20 个 #[command]  │
│   models.rs ── DTO（camelCase 序列化）                            │
│   error.rs ── AppError 枚举（5 变体 + 结构化序列化）              │
│   events.rs ── 2 个事件常量                                      │
│   menu.rs / state.rs ── 菜单构建 / 启动开打竞态处理              │
└─────────────────────────────────────────────────────────────────┘
```

**三条铁律**（来自 `architecture.md`，代码已贯彻）：
1. 前端业务逻辑**不直接**调 `invoke`/`listen`/`emit`，全部走 `services/tauri/`。
2. Rust 命令返回**结构化 DTO** 和 `AppError`，不返回裸字符串。
3. 通用桌面能力**优先用 Tauri 官方插件**（store / window-state / dialog / opener / cli / clipboard）。

---

## 3. 目录结构

```
md-editor/
├── src/                          # 前端
│   ├── main.ts                   #   入口：createApp + Pinia + main.css（极简，仅此）
│   ├── App.vue                   #   协调层：接线 composables + 视图模式切换
│   │
│   ├── stores/                   #   Pinia 状态（仅 2 个）
│   │   ├── file.ts               #     文档状态：path/content/脏标记/displayName
│   │   └── settings.ts           #     全局设置：主题/字体/快捷键/迁移/防抖持久化
│   │
│   ├── composables/              #   业务逻辑封装（10 个）
│   │   ├── useDocumentSession.ts #     新建/打开/保存/自动保存（含互斥锁）
│   │   ├── useCommandDispatcher.ts #   命令分发：菜单/快捷键/UI → 动作
│   │   ├── useAppDomEvents.ts    #     全局键盘事件 → 命令
│   │   ├── useAppEditorState.ts  #     编辑器状态桥接（stats/update）
│   │   ├── useAppWindowSession.ts#     窗口会话：标题/关闭确认/全屏
│   │   ├── useMenuEvents.ts      #     原生菜单事件 → dispatcher
│   │   ├── useMenuShortcutsSync.ts#    快捷键变更 → 同步到原生菜单
│   │   ├── useImagePreview.ts    #     图片预览视图模式状态机
│   │   ├── useFloatingListMenu.ts#     SlashMenu/EmojiMenu 共享的浮动菜单
│   │   └── useClickOutside.ts    #     点击外部检测（通用）
│   │
│   ├── commands/
│   │   └── registry.ts           #   命令集中注册表（定义/查找/快捷键/冲突检测）
│   ├── utils/shortcuts.ts        #   registry 的薄封装（re-export）
│   │
│   ├── components/
│   │   ├── Editor/               #   编辑器核心
│   │   │   ├── MarkdownEditor.vue#     TipTap 实例 + 防抖序列化 + 视图
│   │   │   ├── ImagePreviewView.vue / ImageFullscreenOverlay.vue
│   │   │   ├── views/            #     SlashMenu / EmojiMenu / BubbleMenu
│   │   │   └── tiptap/           #     TipTap 扩展层
│   │   │       ├── editor-extensions.ts  # 扩展注册表
│   │   │       ├── editor-commands.ts    # 编辑器命令执行
│   │   │       ├── editor-image-drop.ts  # 图片拖放
│   │   │       ├── editor-metadata.ts    # 大纲/字数/光标提取
│   │   │       ├── useEditorAppearance.ts# 字体/主题/代码高亮注入
│   │   │       ├── useEditorSearch.ts    # 编辑器内搜索替换
│   │   │       ├── editor.css            # 编辑区排版（消费 --mk-* 变量）
│   │   │       ├── extensions/           # 14 个自定义扩展
│   │   │       └── markdown/             # parser / serializer / plugins
│   │   ├── Settings/             #   设置面板（15 个 .vue）
│   │   ├── Layout/               #   CustomTitlebar / WindowResizeHandles / ErrorBoundary
│   │   ├── icons/                #   CloseIcon / CheckIcon
│   │   ├── FontPopover.vue / ThemePopover.vue
│   │   └── StatusbarQuickActions.vue
│   │
│   ├── services/
│   │   ├── tauri/                #   IPC 服务层
│   │   │   ├── client.ts         #     invokeCommand<T> + normalizeTauriError
│   │   │   ├── command-names.ts  #     TAURI_COMMANDS 常量表
│   │   │   ├── event-names.ts    #     事件名常量
│   │   │   ├── document.ts / window.ts / webview.ts / events.ts
│   │   │   ├── dialog.ts / clipboard.ts / opener.ts / os.ts
│   │   │   ├── store.ts          #     tauri-plugin-store 封装
│   │   │   └── window-state.ts
│   │   └── fontLoader.ts         #   内嵌字体按需加载（FontFace）
│   │
│   ├── themes/                   #   主题系统
│   │   ├── types.ts              #   Theme / ThemeColors / ThemeTypography
│   │   ├── manager.ts            #   applyTheme：注入颜色 + 排版变量
│   │   └── presets/              #   7 套预设 JSON
│   │
│   ├── utils/
│   │   ├── export/               #   导出管线（见 §10）
│   │   │   ├── index.ts          #     统一出口
│   │   │   ├── build-export-tree.ts #  ProseMirror → ExportDocument IR
│   │   │   ├── model.ts          #     IR 类型定义
│   │   │   ├── theme.ts          #     主题 → 导出色彩 tokens
│   │   │   ├── renderers/html.ts #     HTML 渲染器
│   │   │   ├── renderers/wechat.ts#    微信渲染器
│   │   │   └── utils.ts
│   │   ├── export-renderer.ts    #   导出管线对外门面（re-export）
│   │   ├── wechat-themes.ts      #   微信 4 套文学风主题
│   │   ├── wechat-renderer.ts    #   微信渲染入口（兼容旧路径）
│   │   ├── fontStack.ts          #   buildFontStack：统一字体栈（编辑器+导出共享）
│   │   └── platform.ts           #   isMac 检测
│   │
│   ├── constants/fonts.ts        #   FONT_OPTIONS：7 种字体清单
│   └── assets/styles/main.css    #   全局样式 + CSS 变量默认值
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               #   仅调用 lib::run()
│   │   ├── lib.rs                #   run()：插件/启动/菜单/命令注册（见 §4）
│   │   ├── state.rs              #   StartupOpenRequests / LoadedWindows
│   │   ├── models.rs             #   所有 DTO
│   │   ├── error.rs              #   AppError + 结构化序列化
│   │   ├── events.rs             #   3 个事件常量 + emit 函数
│   │   ├── menu.rs               #   原生菜单构建 + attach_menu_events
│   │   └── commands/
│   │       ├── mod.rs            #     命令汇总导出
│   │       ├── document.rs       #     open/save/图片导入/路径/资产授权
│   │       ├── image.rs          #     fetch_remote_image
│   │       ├── window.rs         #     print/reveal/背景色/关闭拦截
│   │       └── desktop.rs        #     register/unregister_shell_new（Windows）
│   ├── capabilities/             #   权限配置
│   │   ├── main-window.json      #     主窗口权限白名单
│   │   └── secondary-window.json #     多窗口（main-* label）权限
│   ├── tauri.conf.json           #   Tauri 配置（productName=solo）
│   └── Cargo.toml
│
├── docs/                         # 项目文档（CJK/网络代理/重构报告等）
├── AGENTS.md                      # 工作手册（AI 快速入门 + 纪律约束）
├── ARCHITECTURE.md                # ← 本文档（代码真相，权威）
├── RELEASE_PROCESS.md             # 正式发布流程
├── BUILD_GUIDE.md                 # 编译手册
├── TROUBLESHOOTING.md             # 故障排查
```

---

## 4. Rust 核心层

### 4.1 入口 `lib.rs::run()`

按顺序做四件事：

1. **注册插件**：opener、dialog、clipboard-manager、cli、store、window-state（持久化 SIZE/POSITION/MAXIMIZED）。
2. **`setup()`**：管理 state → 回收早期开打请求 → 解析 CLI/raw args → 建菜单 → 挂关闭拦截 →（macOS）设置窗口背景。
3. **`invoke_handler`**：注册 **20 个命令**（以 `lib.rs` 实际 `generate_handler!` 为准）。
4. **`run()` 回调**：macOS/iOS 的 `Opened { urls }` 事件转成开打请求。

### 4.2 命令清单（实际 20 个）

> 以 `src-tauri/src/lib.rs` 的 `generate_handler!` 宏为唯一真相源。新增/改名必须同步更新此表。

| 命令 | 文件 | 职责 |
|---|---|---|
| `open_document` | document.rs | 读文件内容 + 返回 mtime |
| `save_document` | document.rs | **原子写** + mtime 冲突检测（见 §11.2） |
| `rename_file` | document.rs | 重命名文件（去后缀、防冲突、大小写敏感） |
| `import_document_image` | document.rs | 图片复制到 `assets/`，同名自动加后缀 |
| `save_clipboard_image` | document.rs | 解析 data URL → base64 解码 → 写入 assets |
| `authorize_image_asset` | document.rs | 把图片加入 asset 协议作用域（**带安全校验**） |
| `resolve_image_display` | document.rs | 路径判别（storage/相对/绝对）+ authorize 一步到位（v1.2.23 新增） |
| `fetch_remote_image` | image.rs | 下载远程图片（≤10MB）→ base64 data URL |
| `fetch_font_data` | font.rs | 远程字体下载（返回 base64） |
| `get_cached_font_path` | font.rs | 字体缓存路径查询 |
| `save_font_cache` | font.rs | 字体缓存写入磁盘 |
| `set_window_background_color` | window.rs | macOS 窗口背景（NSColor） |
| `register_shell_new` | desktop.rs | Windows 右键"新建 Markdown"注册表 |
| `unregister_shell_new` | desktop.rs | Windows 右键"新建 Markdown"注销 |
| `refresh_native_menu_shortcuts` | lib.rs | 自定义快捷键 → 同步原生菜单（仅 set_accelerator，不重建） |
| `startup_ready` | lib.rs | 前端 ready 信号，触发窗口显示 + 启动开打请求回放（原 `consume_startup_open_request`） |
| `new_editor_window` | lib.rs | 创建新编辑器窗口（原子递增 label） |
| `reveal_startup_open_log` | lib.rs | 返回 startup-open.log 路径（调试启动开打竞态） |
| `exit_app` | lib.rs | 退出整个应用（多窗口场景） |
| `detect_proxy_for_update` | proxy.rs | 检测系统代理（给自动更新用） |

> **共 20 个命令**。

### 4.3 事件（2 个）

| 事件名 | 方向 | 载荷 |
|---|---|---|
| `menu-event` | Rust→前端 | 菜单项 id 字符串 |
| `window-close-requested` | Rust→前端 | `()`（关闭被拦截，交前端确认） |

### 4.4 错误模型 `AppError`

5 个变体（`Validation`/`Conflict`/`Io`/`Network`/`Native`），每个有稳定 `code`（如 `document_conflict`）。**自定义 Serialize** 输出 `{ code, message }`，前端 `normalizeTauriError()` 据此解析。`From<io::Error>`/`From<reqwest::Error>`/`From<tauri::Error>` 自动转换。

### 4.5 启动文件开打的竞态处理（`state.rs` + `lib.rs`）

"前端还没 ready 就来了开文件请求"是真实竞态。两层缓冲兜底：
- **`StartupOpenRequests`**（managed state）：setup 阶段解析 CLI args 后存入。
- **`PendingWindowPaths`**（managed state）：`create_editor_window` 创建新窗口时存入，按 window label 索引。

`startup_ready()` 先查 `PendingWindowPaths`（新窗口专属），无则回退 `StartupOpenRequests`（主窗口启动请求）。请求来源三类：`Cli`/`OsOpen`/`NewWindow`。
所有过程写 `startup-open.log`（`reveal_startup_open_log` 命令可定位此文件）。

---

## 5. IPC 服务层（`src/services/tauri/`）

### 5.1 统一入口

```ts
// client.ts
invokeCommand<T>(command: TauriCommandName, args?): Promise<T>
```
- 包裹 `@tauri-apps/api/core` 的 `invoke`，`catch` 后用 `normalizeTauriError()` 转成 `{ code, message }` 抛出。
- `command` 参数被 `TauriCommandName` 类型约束，**只能传 `command-names.ts` 里登记的名字**——拼写错误编译期即暴露。

### 5.2 命令名集中表

`command-names.ts` 导出 `TAURI_COMMANDS` 常量对象（键 = 前端方法名，值 = Rust 命令名字符串）。**真理源自一处**：任何新增/改名都要在此登记。

### 5.3 按领域封装

`document.ts`（open/save/图片）、`window.ts`、`dialog.ts`、`clipboard.ts`、`opener.ts`、`os.ts`、`store.ts`（tauri-plugin-store）、`webview.ts`、`events.ts`。每个文件只调 `invokeCommand`，对上层隐藏 IPC 细节。

### 5.4 能力权限（`capabilities/`）

`main-window.json` / `secondary-window.json` 是**最小权限白名单**：只放行实际用到的 core 权限 + 插件权限（event/window/dialog/store/clipboard 等）。新增需要 IPC 能力的功能，要同步在此登记。

---

## 6. 前端架构

### 6.1 `main.ts`（极简）

```ts
const app = createApp(App);
app.use(createPinia());
app.mount('#app');
```
仅此。所有逻辑在 App.vue 与 composables。

### 6.2 `App.vue` —— 纯协调层（~370 行）

**自身不含业务逻辑**，只做接线：
- 初始化 `settingsStore`、`windowSession`、`syncMenuShortcuts`。
- 把各 composable 的能力组合进 `useCommandDispatcher` 的 options。
- 模板：`CustomTitlebar` + `<main>`（按 `activeViewMode` 切 editor/image）+ 状态栏 + `SettingsModal` + 图片全屏浮层。
- 拖放：app 级文件 drop → `documentSession.openDocumentWithPrompt`。

视图模式 `activeViewMode`：`'editor'` | `'image'`，外加独立的 `isFullscreenPreview`。

### 6.3 Composables 职责表（10 个）

| composable | 职责 | 关键点 |
|---|---|---|
| `useDocumentSession` | 文档生命周期 | 自动保存递归调度 + `isSaving` 互斥锁 + 标题改名走另存为 |
| `useCommandDispatcher` | 命令分发 | scope=editor 转发编辑器，scope=app 走 switch |
| `useAppDomEvents` | 全局键盘 | `findCommandByShortcut` → dispatcher |
| `useAppEditorState` | 编辑器状态桥接 | 字数/大纲/光标/选区 stats |
| `useAppWindowSession` | 窗口会话 | 关闭确认、标题、全屏 |
| `useMenuEvents` | 菜单事件 | 监听 `menu-event` → dispatcher |
| `useMenuShortcutsSync` | 快捷键同步 | 自定义快捷键变更 → Rust 菜单 diff 更新（仅 set_accelerator，不重建） |
| `useImagePreview` | 图片预览 | 视图模式状态机 |
| `useFloatingListMenu` | 浮动菜单 | SlashMenu/EmojiMenu 共享逻辑 |
| `useClickOutside` | 点击外部 | 通用 composable |

---

## 7. 两个 Pinia Store

### 7.1 `stores/file.ts` —— 文档状态（短生命周期）

```
currentFile: { path, content, isDirty, lastModifiedTime, displayName, originalBaseName }
hasUserEdit: boolean   # 内部标志
```

**核心机制：脏态分离**（这是整个文档流的安全基石，详见 §11.1）：
- `setContent(content)` —— 编辑器把规范化内容写回时调用；**只在 `hasUserEdit` 为真时才置脏**。
- `markUserEdit()` —— 用户真实编辑时调用；置 `hasUserEdit = true` 且置脏。

为什么分开？因为编辑器加载后会立即序列化回 store 建立"规范化基线"（见 §8），那是一次**程序性**写回，不是用户编辑，不能误判为脏。

`displayName` / `originalBaseName`：`setDisplayName()` 会置脏；保存时若 `displayName !== originalBaseName`（标题被改过）→ 走另存为（这是最近一次提交 `af292cb` 的逻辑）。

### 7.2 `stores/settings.ts` —— 全局设置（长生命周期）

13 个设置项（activeThemeId / customThemes / fontSize / fontFamily / autoSave / autoSaveInterval / spellCheck / titlebarAutoHide / lineHeight / customShortcuts / alwaysOnTop / imageStoragePath / shellIntegration / enableAutoUpdateCheck / configVersion）。

实际共 **15 个字段**（含上述 13 + `customThemes` 与 `customShortcuts` 细分）。

- **持久化**：tauri-plugin-store（经 `services/tauri/store.ts`）。焦点模式用 `focus-mode` class（`<html>` 上 toggle）。
- **迁移**：`configVersion`（当前 **12**）。加载时若存储的版本 ≠ 当前版本 → 规范化后**回写**，一次性升级。
- **防抖写入**：设置变更后 300ms 防抖落盘。
- **`normalizeSettings()`**：合并默认值 + 强制 `autoSaveInterval ≥ 5s` + 刷版本号。
- **主题回退**：`ensureThemeId()` 在主题 id 失效时按当前外观回退到 `scholar-dark`/`default-light`。

---

## 8. 编辑器核心

### 8.1 TipTap 实例复用

`MarkdownEditor.vue` 创建**单个** TipTap 实例（`shallowRef`），切文件时只 `setContent`，**不 destroy 重建**——这是响应快的关键。

### 8.2 文档加载→编辑→保存 数据流

```
加载: openDocument(Rust) → fileStore.setFile()
    → parseMarkdown() → ProseMirror Doc
    → editor.commands.setContent(doc)
    → ★立即 serializeMarkdown() 写回 store 建立规范化基线（消除脏态闪烁）

编辑: keystroke → ProseMirror Schema 变更
    → editor update 事件
    → 50ms 防抖：字数/大纲/光标 stats 更新
    → 100ms 节流：光标行号
    → 500ms 防抖：serializeMarkdown() → fileStore.setContent()（触发 markUserEdit 置脏）

保存: fileStore.markSaved(result.lastModifiedMs)
    → 自动保存：递归 setTimeout（间隔 ≥5s），保存完才排下一次，避免并发
```

> 三档防抖分离是刻意的：统计要"几乎实时"（50ms），序列化要"停顿后"（500ms）。**改任何防抖值前先理解这个分层**。

### 8.3 扩展（14 个，`editor-extensions.ts`）

`SemanticHeading` / `CustomCodeBlock` / `CustomTable(+Row/Header/Cell)` / `CustomImage` / `MathBlock` / `MathInline` / `MermaidBlock` / `MarkdownInput`(InputRule) / `MarkdownPaste` / `Superscript` / `Subscript` / `Wikilink` / `SlashCommands` / `EmojiSuggest`。

StarterKit 内置的 `codeBlock`/`link`/`heading` **被禁用**，改用自定义版以保 Markdown 保真度与 IME 行为。

复杂渲染用 `addNodeView()` **内联在扩展文件里**，不拆独立 Vue 文件。

### 8.4 Markdown 解析链（`tiptap/markdown/`）

- `parser.ts`：MD → ProseMirror Doc。基于 markdown-it（commonmark + table + strikethrough + task-lists + mark + sub + sup + texmath）。**frontmatter / callout / `$$`数学块在 markdown-it 之前先抽取占位，之后还原**。texmath 传**空壳 KaTeX 引擎**（解析器只分词不渲染），让真正的 KaTeX 可懒加载、不进热路径。
- `serializer.ts`：ProseMirror Doc → MD。自研，精确控制输出。**强制末尾恰好一个换行**。
- `plugins/` + `compat-schema.ts`：解析插件与兼容处理。
- `__tests__/roundtrip.spec.ts`：**Markdown 保真度的主要安全网**——动 parser/serializer 前先看它。
- `__tests__/commonmark.spec.ts`：CommonMark spec 652 条全量 roundtrip 验证（618 pass + 34 skip 设计约束）。

---

## 9. 命令系统

### 9.1 集中注册表 `commands/registry.ts`

所有命令在此**声明式定义**：`{ id, title, scope, group, defaultShortcut, menuSection, palette }`。提供查找/快捷键计算/冲突检测/Tauri accelerator 转换等纯函数。`WINDOW_TITLEBAR_MENUS` 也引用这里的 id。

`utils/shortcuts.ts` 是 registry 的薄 re-export（保持旧导入路径兼容）。

### 9.2 分发 `useCommandDispatcher`

```
来源(menu/shortcut/palette/ui) → executeCommand(id, source)
   ├─ scope === 'editor'  → editorRef.executeCommand(id)  (快捷键需编辑器有焦点)
   └─ scope === 'app'     → switch(id) { ... 调对应 composable handler }
```

**单一入口**：原生菜单（`useMenuEvents`）、全局快捷键（`useAppDomEvents`）、状态栏按钮都汇流到 `executeCommand`。`edit.find`/`edit.replace` 虽是 app scope 但转发给编辑器。

---

## 10. 主题与导出

### 10.1 主题系统（色彩 + 排版双注入）

`themes/manager.ts::applyTheme(theme)` 做三件事：

1. **外观**：`applyDarkClass` 切 `<html>.dark`；同步原生窗口主题/背景色（macOS）。
2. **色彩**：`injectColors` —— 按 `CSS_VAR_MAP`（types.ts）把 `ThemeColors` 的 68 个颜色字段写进 `--bg-color` / `--text-color` 等 CSS 变量。
3. **排版**：`injectTypography` —— 先清空再注入 `--mk-*` 变量（`--mk-line-height` / `--mk-font-size` / `--mk-heading1~6-size` / `--mk-paragraph-spacing` / `--mk-letter-spacing` / `--mk-quote-border-width`）。

`editor.css` **已全部 `var(--mk-*)` 消费**（13 处）。所以"不同主题可定制不同排版"**已支持**——加一个主题只需在 JSON 里填 `typography` 字段。

预设 7 套（`presets/`）：scholar / scholar-dark / elegant / cinnabar / cinnabar-dark / default / gray-domain。支持自定义主题 CRUD、导入导出、旧格式（light/dark 双色）迁移。

### 10.2 复制为 HTML（v1.2.18 减法重构后）

> 原导出系统（HTML/PDF/微信，独立 IR 层 `buildExportTree` + HTML/Wechat 渲染器 + `wechat-themes.ts`）已于 v1.2.18 删除（净删 ~2500 行）。现以状态栏 Copy 按钮（`StatusbarQuickActions.vue`）替代：调用 `utils/markdown-to-html.ts::renderMarkdown` 生成富文本 HTML，写入剪贴板 `ClipboardItem({'text/html': ...})`。字体栈仍走 `buildFontStack` 与编辑器共享。

### 10.3 字体系统

- `constants/fonts.ts`：`FONT_OPTIONS`（7 种：思源宋体/微软雅黑 UI/朱雀仿宋/小赖字体/霞鹜文楷/汇文明朝/系统默认）。
- `utils/fontStack.ts`：`buildFontStack(primary)` —— 按字体类型生成带中文 fallback 的完整 font-family 栈，**编辑器与导出端共享**，消除两端不一致。
- `services/fontLoader.ts`：远程字体按需下载 + IndexedDB 缓存 + FontFace 注册，系统字体跳过，已加载缓存复用，加载中去重。

---

## 11. 关键约束（改前必读）

### 11.1 脏态机制不可随意改动

`file.ts` 的 `setContent()` vs `markUserEdit()` 分离是**有意的**（见 §7.1）。编辑器加载后立即序列化写回是**建立规范化基线**，消除 parser/serializer 归一化差异导致的假脏态。**动了它就会重新引入脏态闪烁。**

### 11.2 保存冲突检测在 Rust 侧

`save_document(path, content, expected_last_modified_ms, force)`：
- 非 force 时对比传入的 expected mtime 与磁盘当前 mtime，不符 → 返回 `AppError::Conflict`（code `document_conflict`）。
- 前端 `useDocumentSession` 收到 conflict → 弹"强制覆盖"确认 → 递归调用（先释放 `isSaving` 锁防死锁）。
- `atomic_write`：先写 `.tmp` 再 `rename`，跨平台原子覆盖（Windows 用 `MoveFileExW` + REPLACE，**不做先删后改名**以免引入竞态窗口）。

### 11.3 序列化总是规范化尾换行

`serializeMarkdown()` 强制输出**恰好一个**尾换行。roundtrip 测试同样规范化预期值。**"多了一个换行"先查 serializer，别改测试。**

### 11.4 图片资产安全

`validate_image_asset_path`：先 `canonicalize`（解析符号链接/`..`）再校验扩展名，**防 `evil.png → /etc/passwd` 绕过**。只在 6 种图片扩展名白名单内放行。

### 11.5 启动开打是竞态敏感的

`StartupOpenRequests` + `PendingWindowPaths` + `LoadedWindows` 两层缓冲（见 §4.5）。动启动事件顺序前务必理解 `startup_ready` 的分支。

### 11.6 真理源自一处

- 命令名只在 `command-names.ts` 登记。
- 命令定义只在 `registry.ts`。
- 字体清单只在 `fonts.ts`，字体栈只在 `fontStack.ts`。
- 主题色彩映射只在 `types.ts::CSS_VAR_MAP`。

---

## 附录 A：命令速查（编辑器内常用）

| 动作 | 命令 id | 快捷键（默认） |
|---|---|---|
| 新建 | `file.new` | Mod+N |
| 打开 | `file.open` | Mod+O |
| 保存 | `file.save` | Mod+S |
| 另存为 | `file.saveAs` | Mod+Shift+S |
| 查找 | `edit.find` | Mod+F |
| 替换 | `edit.replace` | Mod+H |
| 焦点模式 | `view.focusMode` | Mod+Shift+F |
| 全屏 | `view.fullscreen` | Mod+Ctrl+F / F11 |
| 设置 | `settings.open` | Mod+, |

（Mod = macOS Cmd / 其它 Ctrl；完整列表见 `registry.ts`）

---

## 附录 B：常见任务起点导航

| 我想改… | 从这里入手 |
|---|---|
| 编辑器行为 bug | `MarkdownEditor.vue` + 对应 `extensions/*.ts` |
| Markdown 保真度 | `parser.ts` / `serializer.ts` → 先看 `roundtrip.spec.ts` |
| 文件打开/保存 bug | `useDocumentSession.ts` + `commands/document.rs` |
| 菜单/快捷键行为 | `registry.ts` + `useCommandDispatcher.ts` + Rust `menu.rs` |
| 搜索/替换 | `useEditorSearch.ts` + `extensions/search-highlight.ts` + 搜索面板模板（`MarkdownEditor.vue`） |
| 主题/外观 | `stores/settings.ts` + `themes/manager.ts` + `editor.css` |
| 导出（HTML） | `utils/markdown-to-html.ts` + `StatusbarQuickActions.vue` |
| 图片拖入/处理 | `editor-image-drop.ts` + Rust `commands/document.rs` + `services/tauri/asset.ts` |
| 字体 | `constants/fonts.ts` + `fontStack.ts` + `fontLoader.ts` + `useEditorAppearance.ts` |
| 启动开打 | Rust `lib.rs`（§4.5）+ `useAppWindowSession.ts` |
| IPC 新增命令 | `command-names.ts` 登记 + `services/tauri/` 封装 + Rust `commands/` 实现 + `lib.rs` 注册 + `capabilities/` 加权限 |

---

## 附录 C：文档与代码差异（防止被旧文档误导）

下列内容在 `.trae/documents/` 中被描述为存在/未解决，但**当前代码实际状态**如下：

| 旧文档说法 | 实际现状 |
|---|---|
| 存在文件树 / workspace watcher / `useFileTree.ts` / `useFileOperations.ts` | **已移除**。`useDocumentSession.ts` 内有 `// workspace 功能已移除` 注释 |
| `fs.rs` / `watch.rs` / `config.rs` | **不存在**。文件操作在 `commands/document.rs`，无 watcher，设置用 tauri-plugin-store |
| 6 个字体 | **7 个**（系统默认 + 微软雅黑 UI + 5 款远程下载字体） |
| emoji 补全未实现 | **已实现**（`emoji-suggest.ts` + `EmojiMenu.vue`，`:` 触发） |
| 编辑区排版硬编码、不随主题切换 | **已解决**。主题 `typography` → `--mk-*` 变量 → `editor.css` 消费 |
| 字体依赖本地安装 | **已解决**。改为按需远程下载 + IndexedDB 缓存，安装包不再内嵌字体文件 |
| 字体栈分散 | **已收口**到 `fontStack.ts::buildFontStack`，编辑器+导出共享 |
| 序列化防抖 300ms | **实际 500ms**（序列化）/ 50ms（统计）/ 100ms（光标）三档 |
| Rust 命令 ~20 个 | **实际 20 个**（见 `lib.rs::invoke_handler!`，v1.2.23 含 `resolve_image_display`） |
| 快捷键表 / 发布清单列有「导出 HTML / PDF / 微信」 | **已移除**（v1.2.18）。复制为 HTML 用状态栏「复制为 HTML」按钮，无导出命令 |

> 若你发现本附录与代码不符，**以代码为准并更新本表**——这是这份文档保持可信的唯一方式。

---

## 开发命令速查

```bash
bun install              # 装依赖
bun run dev              # 纯前端 dev
bun run dev:tauri        # Tauri 全栈 dev（含 Rust）
bun run build            # 前端构建（含 vue-tsc 类型检查）
bun run build:tauri      # 打安装包
bun run test             # Vitest
bun run lint             # ESLint
bun run format           # Prettier
cargo check --manifest-path src-tauri/Cargo.toml   # Rust 编译检查
```

代码风格：Prettier（单引号/分号/尾逗号/2 空格/100 列/LF），ESLint（`no-explicit-any` 与 `no-unused-vars` 为 warn，`_` 前缀参数豁免，禁 `console.log` 但允许 `warn`/`error`）。
