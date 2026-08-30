---
title: solo 架构文档
type: core
audience: dev
status: active
tags: [核心文档, 架构, 技术栈, 命令清单, 敏感区]
summary: 代码真相权威地图：技术栈版本/命令清单/目录树/§11 敏感区速查表
updates: [package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json, src-tauri/src/lib.rs, BUILD_GUIDE.md, docs/font-handling.md, docs/KNOWN-ISSUES.md]
---

# solo 架构文档

> **目标**：让任何开发者（人或 AI）在 15 分钟内建立完整、准确的心智模型，并能定位到任意功能的改动入口。
> **写作基准**：一切以**实际代码行为**为准，不依据注释或历史文档。版本对应 `package.json` v1.2.39。

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
Rust 核心 (src-tauri/)   ──22 个命令 + 2 类事件──▶  文件/图片/窗口/字体/剪贴板/注册表/代理
        ▲ invoke / emit
IPC 服务层 (src/services/tauri/)  ──契约封装，前端不直接碰 invoke
        ▲
Vue 前端 (src/)   App.vue 协调层 ──委托──▶ 12 个 composables + 2 个 Pinia store + TipTap 编辑器
```

> ⚠️ 仓库内同时存在 `README.md` 及 `.trae/documents/` 下的早期文档，它们描述了**文件树、workspace watcher、`fs.rs`/`watch.rs`/`config.rs`** 等结构——**这些在当前代码中已不存在**。请一律以**本文档 + 实际代码**为准（差异清单见附录 C）。新入手的 AI 开发者先读 `AGENTS.md`（工作手册）+ `.opencode/PROFILE.md`（技术档案）。

---

## 1. 技术栈实测表

| 层 | 技术 | 版本 | 备注 |
|---|---|---|---|
| 桌面框架 | Tauri | 2.11.2 | 无边框窗口、自定义标题栏、CLI（多进程）、OS-open |
| 原生核心 | Rust | 1.96.0 | edition 2021, opt-level=3；thiserror + serde + reqwest + winreg(Windows) |
| 前端框架 | Vue 3 | 3.5 | Composition API + `<script setup>` |
| 语言 | TypeScript | ~6.0 | strict 模式 |
| 状态管理 | Pinia | 3.x | 2 个 store：file / settings |
| 构建 | Vite | 7.x | |
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
│   main.ts ──createApp──▶ App.vue (协调层，无业务逻辑)              │
│                              │                                  │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│         composables      Pinia stores     组件树                │
│         (12 个，按       ┌─ file.ts       App ▸ Editor           │
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
│   document/window/dialog/clipboard/font/asset/events/store ── 按领域封装 │
│   normalizeTauriError() ── 把 Rust AppError 解析成 {code,message} │
└──────────────────────┬──────────────────────────────────────────┘
                       │ Tauri IPC 边界
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Rust 核心 (src-tauri/src/)                     │
│                                                                  │
│   lib.rs ── run() ── 插件注册 / 启动开打 / 菜单 / 关闭拦截        │
│   commands/ ── document/font/clipboard/window/desktop ── 22 个 #[command]  │
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

### 决策阶梯（写代码前必过）

来自《产品开发总原则》。从第一级开始，**停在第一个成立的层级**：

1. 这东西需要存在吗？（YAGNI，推测性需求 = 不做）
2. 标准库 / 运行时能做吗？
3. 平台原生功能能覆盖吗？（CSS 能做的别写 JS）
4. 已安装的依赖能解决吗？
5. 能一行搞定吗？
6. 以上都不行 → 写最少能工作的代码

> 阶梯是反射动作，不是研究课题。两级都成立 → 取更高级。

### 绝不简化掉的清单（安全 / 鲁棒底线）

刻意简化时不得省略：信任边界的输入校验（用户输入、外部数据）、防止数据丢失的错误处理、安全措施（路径遍历防护、XSS 防护）、用户明确要求保留的功能。简化用 `simp:` 注释标记：`simp: <已知上限>, <升级触发条件>`。

### 产品哲学关键词

**极简 · 极速 · 优雅 · 灵活 · 高效 · 可拓展**（详见 `docs/产品精神` 母本）。

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
│   ├── composables/              #   业务逻辑封装（12 个）
│   │   ├── useDocumentSession.ts #     新建/打开/保存/自动保存（含互斥锁）
│   │   ├── useCommandDispatcher.ts #   命令分发：菜单/快捷键/UI → 动作
│   │   ├── useAppDomEvents.ts    #     全局键盘事件 → 命令
│   │   ├── useAppEditorState.ts  #     编辑器状态桥接（stats/update）
│   │   ├── useAppWindowSession.ts#     窗口会话：标题/关闭确认/全屏
│   │   ├── useMenuEvents.ts      #     原生菜单事件 → dispatcher
│   │   ├── useMenuShortcutsSync.ts#    快捷键变更 → 同步到原生菜单
│   │   ├── useImagePreview.ts    #     图片预览视图模式状态机
│   │   ├── useFloatingListMenu.ts#     SlashMenu/EmojiMenu 共享的浮动菜单
│   │   ├── useOutline.ts         #     大纲提取/导航
│   │   ├── useEditorSync.ts      #     编辑器↔store 同步（脏态 A1 核心，4 档防抖）
│   │   └── useClickOutside.ts    #     点击外部检测（通用）
│   │
│   ├── commands/
│   │   └── registry.ts           #   命令集中注册表（定义/查找/快捷键/冲突检测）
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
│   │   │       ├── extensions/           # 21 个自定义扩展（详见 §8.3）
│   │   │       └── markdown/             # parser / serializer / plugins
│   │   ├── Settings/             #   设置面板（15 个 .vue）
│   │   ├── Layout/               #   CustomTitlebar / WindowResizeHandles / ErrorBoundary
│   │   ├── icons/                #   CloseIcon / CheckIcon
│   │   ├── FontPopover.vue / ThemePopover.vue
│   │   └── StatusbarQuickActions.vue
│   │
│   ├── services/
│   │   ├── tauri/                #   IPC 服务层（10 个文件）
│   │   │   ├── client.ts         #     invokeCommand<T> + normalizeTauriError
│   │   │   ├── command-names.ts  #     TAURI_COMMANDS 常量表
│   │   │   ├── document.ts       #     打开/保存/图片 API 封装
│   │   │   ├── window.ts         #     窗口控制封装
│   │   │   ├── dialog.ts         #     系统对话框封装
│   │   │   ├── clipboard.ts      #     剪贴板封装
│   │   │   ├── events.ts         #     menu-event / window-close 事件监听封装
│   │   │   ├── font.ts           #     字体 IPC 封装（fetch/getCache/save/readBytes）
│   │   │   ├── asset.ts          #     图片资产协议作用域封装
│   │   │   └── store.ts          #     tauri-plugin-store 封装
│   │   └── fontLoader.ts         #   内嵌字体按需加载（FontFace 字节通道）
│   │
│   ├── themes/                   #   主题系统
│   │   ├── types.ts              #   Theme / ThemeColors / ThemeTypography
│   │   ├── manager.ts            #   applyTheme：注入颜色 + 排版变量
│   │   └── presets/              #   8 套预设 JSON（见 §10.1）
│   │
│   ├── utils/
│   │   ├── fontStack.ts          #   buildFontStack：统一字体栈（编辑器+导出共享）
│   │   ├── markdown-to-html.ts   #   复制为 HTML 渲染（StatusbarQuickActions 调用）
│   │   └── platform.ts           #   isMac 检测
│   │
│   ├── constants/fonts.ts        #   FONT_OPTIONS：7 种字体清单（见 §10.3）
│   └── assets/styles/main.css    #   全局样式 + CSS 变量默认值
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               #   仅调用 lib::run()
│   │   ├── lib.rs                #   run()：插件/启动/菜单/命令注册（见 §4）
│   │   ├── state.rs              #   StartupOpenRequests / LoadedWindows
│   │   ├── models.rs             #   所有 DTO
│   │   ├── error.rs              #   AppError + 结构化序列化
│   │   ├── events.rs             #   2 个事件常量 + emit 函数
│   │   ├── menu.rs               #   原生菜单构建 + attach_menu_events
│   │   └── commands/
│   │       ├── mod.rs            #     命令汇总导出
│   │       ├── document.rs       #     open/save/图片导入/路径/资产授权
│   │       ├── image.rs          #     fetch_remote_image
│   │       ├── font.rs           #     fetch_font_data / get_cached_font_path / save_font_cache
│   │       ├── clipboard.rs      #     read_clipboard_html（绕开 webview 读系统剪贴板 HTML）
│   │       ├── window.rs         #     print/reveal/背景色/关闭拦截
│   │       └── desktop.rs        #     register/unregister_shell_new（Windows）
│   ├── capabilities/             #   权限配置
│   │   ├── default.json          #     默认权限基座
│   │   ├── main-window.json      #     主窗口权限白名单
│   │   └── secondary-window.json #     多窗口（main-* label）权限
│   ├── tauri.conf.json           #   Tauri 配置（productName=solo）
│   └── Cargo.toml
│
├── docs/                         # 项目文档（CJK/网络代理/重构报告/发版流程等）
├── AGENTS.md                      # 工作手册（AI 快速入门 + 纪律约束）
├── ARCHITECTURE.md                # ← 本文档（代码真相，权威）
├── BUILD_GUIDE.md                 # 编译手册
├── docs/TROUBLESHOOTING.md        # 故障排查（用户侧，已归 docs/）
```

---

## 4. Rust 核心层

### 4.1 入口 `lib.rs::run()`

按顺序做四件事：

1. **注册插件**：opener、dialog、clipboard-manager、cli、store、window-state（持久化 SIZE/POSITION/MAXIMIZED）、updater（自动更新，见 `autoCheckForUpdate`）。
2. **`setup()`**：管理 state → 回收早期开打请求 → 解析 CLI/raw args → 建菜单 → 挂关闭拦截 →（macOS）设置窗口背景。
3. **`invoke_handler`**：注册 **22 个命令**（以 `lib.rs` 实际 `generate_handler!` 为准）。
4. **`run()` 回调**：macOS/iOS 的 `Opened { urls }` 事件转成开打请求。

### 4.2 命令清单（实际 22 个）

> 以 `src-tauri/src/lib.rs` 的 `generate_handler!` 宏为唯一真相源。新增/改名必须同步更新此表。
> 注：`detect_proxy_for_update` 定义在 `lib.rs`（**不存在 `proxy.rs`**，勿被旧文档误导）。

| 命令 | 文件 | 职责 |
|---|---|---|
| `open_document` | document.rs | 读文件内容 + 返回 mtime |
| `save_document` | document.rs | **原子写** + mtime 冲突检测（见 §11.2） |
| `rename_file` | document.rs | 重命名文件（去后缀、防冲突、大小写敏感） |
| `import_document_image` | document.rs | 图片复制到 `assets/`，同名自动加后缀 |
| `save_clipboard_image` | document.rs | 解析 data URL → base64 解码 → 写入 assets |
| `read_clipboard_html` | clipboard.rs | 从系统剪贴板读 HTML 富文本（绕开 webview `clipboardData` 空值问题，外部应用/跨源粘贴保格式） |
| `authorize_image_asset` | document.rs | 把图片加入 asset 协议作用域（**带安全校验**） |
| `resolve_image_display` | document.rs | 路径判别（storage/相对/绝对）+ authorize 一步到位（v1.2.23 新增） |
| `fetch_remote_image` | image.rs | 下载远程图片（≤10MB）→ base64 data URL |
| `fetch_font_data` | font.rs | 远程字体下载（返回 base64） |
| `get_cached_font_path` | font.rs | 字体缓存路径查询 |
| `save_font_cache` | font.rs | 字体缓存写入磁盘 |
| `read_font_bytes` | font.rs | 读取字体字节（经 IPC 取字节 → FontFace 同源加载；**字节通道兜底**，首选 CSS @font-face 注入 asset:// URL，见 §10.3） |
| `set_window_background_color` | window.rs | macOS 窗口背景（NSColor） |
| `register_shell_new` | desktop.rs | Windows 右键"新建 Markdown"注册表 |
| `unregister_shell_new` | desktop.rs | Windows 右键"新建 Markdown"注销 |
| `refresh_native_menu_shortcuts` | lib.rs | 自定义快捷键 → 同步原生菜单（仅 set_accelerator，不重建） |
| `startup_ready` | lib.rs | 前端 ready 信号，触发窗口显示 + 启动开打请求回放（原 `consume_startup_open_request`） |
| `new_editor_window` | lib.rs | 创建新编辑器窗口（原子递增 label） |
| `reveal_startup_open_log` | lib.rs | 返回 startup-open.log 路径（调试启动开打竞态） |
| `request_app_quit` | window.rs | 应用级退出：向所有已加载窗口定向发 `window-close-requested`，各窗口自行确认/保存后关闭，全部关闭后进程自然退出（原 `exit_app` 强杀进程，多窗口丢未保存内容） |
| `detect_proxy_for_update` | lib.rs | 检测系统代理（给自动更新用，见 `autoCheckForUpdate`） |

> **共 22 个命令**。

### 4.3 事件（2 个）

| 事件名 | 方向 | 载荷 |
|---|---|---|
| `menu-event` | Rust→前端（**定向到当前焦点窗口**） | 菜单项 id 字符串 |
| `window-close-requested` | Rust→前端 | `()`（关闭被拦截，交前端确认） |

> `menu-event` 由 `menu.rs` 经 `app.emit(MENU_EVENT, id)` 广播，但**仅当前 `FocusedWindow` 对应窗口的前端会消费**——前端侧按窗口各自监听，避免多窗口重复执行同一菜单动作（见 §4.5 的 `FocusedWindow`）。

### 4.4 错误模型 `AppError`

5 个变体（`Validation`/`Conflict`/`Io`/`Network`/`Native`），每个有稳定 `code`（如 `document_conflict`）。**自定义 Serialize** 输出 `{ code, message }`，前端 `normalizeTauriError()` 据此解析。`From<io::Error>`/`From<reqwest::Error>`/`From<tauri::Error>` 自动转换。

### 4.5 启动文件开打的竞态处理（`state.rs` + `lib.rs`）

"前端还没 ready 就来了开文件请求"是真实竞态。**四类 managed state** 兜底（均在 `state.rs` 定义）：
- **`StartupOpenRequests`**：setup 阶段解析 CLI args / OS-open 后存入（单 payload，可合并去重）。
- **`PendingWindowPaths`**：`create_editor_window` 创建新窗口时存入，按 window label 索引（HashMap）。
- **`LoadedWindows`**：已加载完成的窗口 label 集合（标记窗口已就绪）。
- **`FocusedWindow`**：当前焦点窗口 label（用于 `menu-event` 定向分发，见 §4.3）。

`startup_ready()` 先查 `PendingWindowPaths`（新窗口专属），无则回退 `StartupOpenRequests`（主窗口启动请求）。请求来源三类：`Cli`/`OsOpen`/`NewWindow`。
所有过程写 `startup-open.log`（`reveal_startup_open_log` 命令可定位此文件）。窗口先 `visible(false)` 后由前端 `startup_ready` 触发 `show()` 避免黑闪。

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

`document.ts`（open/save/图片）、`window.ts`、`dialog.ts`、`clipboard.ts`、`font.ts`（字体 IPC）、`asset.ts`（图片资产作用域）、`events.ts`（菜单/关闭事件监听）、`store.ts`（tauri-plugin-store）。每个文件只调 `invokeCommand`，对上层隐藏 IPC 细节。

> 旧文档提到的 `opener.ts` / `os.ts` / `webview.ts` / `window-state.ts` / `event-names.ts` **均不存在**——Tauri 官方插件（opener/dialog/clipboard/window-state）已由各封装文件直接调用，无需额外薄封装层。

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

### 6.3 Composables 职责表（12 个）

| composable | 职责 | 关键点 |
|---|---|---|
| `useDocumentSession` | 文档生命周期 | 自动保存递归调度 + `_savePromise` 互斥锁 + 标题改名走另存为 |
| `useCommandDispatcher` | 命令分发 | scope=editor 转发编辑器，scope=app 走 switch |
| `useAppDomEvents` | 全局键盘 | `findCommandByShortcut` → dispatcher |
| `useAppEditorState` | 编辑器状态桥接 | 字数/大纲/光标/选区 stats |
| `useAppWindowSession` | 窗口会话 | 关闭确认、标题、全屏 |
| `useMenuEvents` | 菜单事件 | 监听 `menu-event` → dispatcher |
| `useMenuShortcutsSync` | 快捷键同步 | 自定义快捷键变更 → Rust 菜单 diff 更新（仅 set_accelerator，不重建） |
| `useImagePreview` | 图片预览 | 视图模式状态机 |
| `useFloatingListMenu` | 浮动菜单 | SlashMenu/EmojiMenu 共享逻辑 |
| `useOutline` | 大纲 | 大纲提取与导航（OutlinePanel） |
| `useEditorSync` | 编辑器↔store 同步 | **脏态 A1 核心**，4 档防抖（字数150/大纲500/序列化500/光标100），`onUpdate` 单出口 → `fileStore.syncEditedContent`；heavy 档且大纲面板关闭时跳过全文大纲提取（面板打开时补算）；空闲序列化超时兜底撞上续打时推迟回防抖，不在输入中途硬跑大序列化 |
| `useClickOutside` | 点击外部 | 通用 composable |

> 旧文档提到的 `utils/shortcuts.ts` **已删除**：registry 内联 `getShortcut`/`getShortcutCommands`，全仓无 `shortcuts` 引用。命令源 `CommandSource` 含 `shortcut`/`menu`/`palette`/`titlebar`/`ui`，`CommandScope` 为 `app`/`editor`。

---

## 7. 两个 Pinia Store

### 7.1 `stores/file.ts` —— 文档状态（短生命周期）

```
currentFile: { path, content, isDirty, lastModifiedTime, displayName, originalBaseName }
```

**核心机制：脏态以"语义比对"为唯一真相源（A1 改造，详见 §11.1）**：
- `setContent(content)` —— **仅同步基线内容，不标脏**。编辑器加载后建立规范化基线时调用。
- `syncEditedContent(content)` —— **脏标记唯一真相源**：先把内容与基线都 `replace(/\n+$/, '')` 规范化，若**语义不同** → 更新内容并置 `isDirty=true`；若相同 → 直接 `return false`，不改动不标脏。
  - 由此同时根治**漏标脏**（拖入图片等非键盘交互，过去 `markUserEdit` 收不到）与**误标脏**（Mermaid 等后台事务触发序列化但内容未变）。
  - 不再区分"程序性写回 vs 用户编辑"——通过语义比对判定，消除 `hasUserEdit` 标志的歧义。
- `setDisplayName(name)` —— 置脏（标题被改）。
- `markSaved(lastModifiedMs)` —— 清脏，并把 `displayName` 重置回 `originalBaseName`。
- `renamePath(newPath)` —— 重置 `displayName` 与 `originalBaseName`（实际文件重命名在保存时经 save-as 流程完成，见 `useDocumentSession.handleRename`）。
- `reset()` —— 回到空文件状态。

> 旧文档的 `markUserEdit()` + `hasUserEdit` 双函数模型**已于 A1 重构中废弃**，切勿再按旧模型理解或改动。

### 7.2 `stores/settings.ts` —— 全局设置（长生命周期）

**15 个字段**（全部 true 真理源，改任何设置前先读此 store）：

`activeThemeId`（默认 `scholar-light`）/ `customThemes` / `fontSize`（null=用主题默认）/ `fontFamily`（`Microsoft YaHei UI`）/ `autoSave` / `autoSaveInterval`（默认 30s，下限 5s）/ `spellCheck` / `titlebarAutoHide` / `lineHeight`（null=用主题默认）/ `customShortcuts` / `alwaysOnTop` / `imageStoragePath` / `shellIntegration` / `enableAutoUpdateCheck` / `configVersion`（固定 **12**）。

- **持久化**：tauri-plugin-store（经 `services/tauri/store.ts`）。焦点模式用 `focus-mode` class（`<html>` 上 toggle）。
- **迁移**：`configVersion`（当前 **12**）。加载时若存储版本 ≠ 当前 → 规范化后回写，一次性升级。v12 迁移把 `fontSize`/`lineHeight` 从硬编码（16/1.6）改为 `null` 用主题默认。
- **防抖写入**：设置变更后 300ms 防抖落盘；关窗链调用 `flushPendingSettings()` 强制落盘，防抖窗口内关窗不丢最后一次改动。
- **`normalizeSettings()`**：合并默认值 + 强制 `autoSaveInterval ≥ 5s` + 刷版本号（`CURRENT`）。
- **主题回退**：`ensureThemeId()` 在主题 id 失效时按当前外观回退到 `scholar-dark`/`default-light`。
- **启动两阶段**（见 `App.vue` `onMounted`）：`initThemeOnly`（只读 `activeThemeId` 并 `applyCurrentTheme`，不触发 watcher，避免黑闪）→ `initFull`（读全部设置 + focusMode，版本不符则回写）。`startWatchers` 精确 watch 13 个顶层字段 + `activeThemeId` watcher（重注入 CSS）+ focusMode watcher。

- **持久化**：tauri-plugin-store（经 `services/tauri/store.ts`）。焦点模式用 `focus-mode` class（`<html>` 上 toggle）。
- **迁移**：`configVersion`（当前 **12**）。加载时若存储的版本 ≠ 当前版本 → 规范化后**回写**，一次性升级。
- **防抖写入**：设置变更后 300ms 防抖落盘。
- **`normalizeSettings()`**：合并默认值 + 强制 `autoSaveInterval ≥ 5s` + 刷版本号。
- **主题回退**：`ensureThemeId()` 在主题 id 失效时按当前外观回退到 `scholar-dark`/`default-light`。

---

## 8. 编辑器核心

### 8.1 TipTap 实例复用 + 懒初始化

`MarkdownEditor.vue` 创建**单个** TipTap 实例（`shallowRef`），切文件时只 `setContent`，**不 destroy 重建**——这是响应快的关键。

**懒初始化**：编辑器不在挂载时立即创建——无焦点不建，等获得焦点 / `solo:editor-focus` 事件 / 50ms 兜底后才初始化，避免后台标签页空耗资源。切换文件时若序列化结果相同则跳过 `setContent`，避免无谓重渲染。

### 8.2 文档加载→编辑→保存 数据流

```
加载: openDocument(Rust) → fileStore.setFile()
    → parseMarkdown() → ProseMirror Doc
    → editor.commands.setContent(doc)
    → fileStore.setContent(serializeMarkdown())  // 建立规范化基线（A1 后不标脏）

编辑: keystroke → ProseMirror Schema 变更
    → editor update 事件（useEditorSync 单出口 onUpdate）
    → 防抖分层：
        150ms 防抖：字数 stats
        100ms 防抖：光标行号
        500ms 防抖：大纲更新
        500ms 防抖：serializeMarkdown() → fileStore.syncEditedContent()（语义比对置脏，见 §7.1）
    → emitImmediateStats 手动补发（切换文件等场景）

保存: fileStore.markSaved(result.lastModifiedMs)
    → 自动保存：递归 setTimeout（保存完才排下一次，避免并发/跳过），immediate:true，下限 ≥5s
    → 关窗前 useDocumentSession.evaluateDirtyFromEditor() 强制用编辑器实时内容评估脏态（绕开 500ms 序列化防抖，避免编辑后 <500ms 关窗误判已保存）
```

> 防抖分层是刻意的：统计要"几乎实时"（150ms），序列化要"停顿后"（500ms）。**改任何防抖值前先理解这个分层**（详见 §6.3 `useEditorSync`）。

### 8.3 扩展（`editor-extensions.ts` 注册 **21 个**，`extensions/` 目录 21 个文件）

注册列表（按 `editor-extensions.ts` `createEditorExtensions` 实际顺序）：

`StarterKit`(禁用内置 `codeBlock`/`link`/`heading`) / `Frontmatter` / `FootnoteRef` / `FootnoteSection` / `FootnoteDef` / `SemanticHeading` / `CustomCodeBlock` / `CustomTable`(+`CustomTableRow`/`CustomTableHeader`/`CustomTableCell`) / `CustomImage` / `Callout` / `Highlight`(multicolor:false) / `ParagraphFocus` / `SearchHighlight` / `Link`(openOnClick:false) / `LinkOpen` / `TaskList` / `TaskItem`(nested) / `Placeholder` / `MathBlock` / `MathInline` / `MermaidBlock` / `MarkdownInput` / `MarkdownPaste` / `Superscript` / `Subscript` / `Dim` / `Wikilink` / `SlashCommands` / `EmojiSuggest`。

> 共 **21 个扩展**（旧文档写的 14 个已过时——漏计了 Frontmatter/Footnote×3/Callout/ParagraphFocus/SearchHighlight/Link/LinkOpen/Dim 及 Table 拆分的 3 个子节点）。

StarterKit 内置的 `codeBlock`/`link`/`heading` **被禁用**，改用自定义版以保 Markdown 保真度与 IME 行为。

**IME 友好细节**：`SlashCommands` 与 `EmojiSuggest` 的 suggestion 均设 `allowedPrefixes: null`（支持中文「你好/」「标题/」后唤出菜单，默认 `allowedPrefixes:[' ']` 会过滤掉无空格前缀，对中文场景致命）。

复杂渲染用 `addNodeView()` **内联在扩展文件里**，不拆独立 Vue 文件。浮动菜单定位抽成纯函数 `computeMenuPosition`（`editor-extensions.ts`，`MENU_MAX_HEIGHT=340` / `MENU_MIN_WIDTH=240` / `VIEWPORT_MARGIN=8`）。

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

（旧文档称 `utils/shortcuts.ts` 是 registry 的薄 re-export——**该文件已删除**，registry 内联了 `getShortcut`/`getShortcutCommands`。）

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

1. **外观**：`applyDarkClass` 切 `<html>.dark`；同步原生窗口主题/背景色（失败静默）。
2. **色彩**：`injectColors` —— 按 `CSS_VAR_MAP`（types.ts）把 `ThemeColors` 字段写进 `--bg-color` / `--text-color` 等 CSS 变量。
3. **排版**：`injectTypography` —— **先全部 `removeProperty` 再注入** `--mk-*` 变量（`--mk-line-height` / `--mk-font-size-in-...` 等：`--mk-line-height` / `--mk-font-size` / `--mk-heading1~6-size` / `--mk-paragraph-spacing` / `--mk-letter-spacing` / `--mk-quote-border-width`）。

`editor.css` **已全部 `var(--mk-*)` 消费**（13 处）。所以"不同主题可定制不同排版"**已支持**——加一个主题只需在 JSON 里填 `typography` 字段。

**主题三层结构（2026-08-21 确立）**：
- **范式层**：`types.ts::CSS_VAR_MAP`（token 全集）+ `manager.ts::SHARED_LIGHT/DARK_COLORS`（共享默认值：功能色/圆角/markBg/btnGhostBg/modalOverlay）+ `editor.css :root` 排版默认值。
- **实例层**：**8 套 preset JSON**（`presets/`）：`scholar-light` / `scholar-dark` / `elegant` / `cinnabar` / `cinnabar-dark` / `default` / `jade` / `orchid`（**无 `gray-domain`**——旧文档列 7 套已过时）。每套**只写性格差异字段**，共享值一律收进 `SHARED_LIGHT/DARK_COLORS`，禁止复制进各主题。
- **消费层**：所有渲染层只引用 `var(--x)`。

支持自定义主题 CRUD、导入导出、旧格式（light/dark 双色文件）迁移（`importTheme` 兼容现代与 legacy）。`applyTheme` 附带 `.theme-transitioning` 200ms + 编辑区 `triggerContentCrossfade` 220ms 淡入 + 透传到 localStorage `solo-theme-paint`。

### 10.2 复制为 HTML（v1.2.18 减法重构后）

> 原导出系统（HTML/PDF/微信，独立 IR 层 `buildExportTree` + HTML/Wechat 渲染器 + `wechat-themes.ts`）已于 v1.2.18 删除（净删 ~2500 行）。现以状态栏 Copy 按钮（`StatusbarQuickActions.vue`）替代：调用 `utils/markdown-to-html.ts::renderMarkdown` 生成富文本 HTML，写入剪贴板 `ClipboardItem({'text/html': ...})`。字体栈仍走 `buildFontStack` 与编辑器共享。

### 10.3 字体系统

- `constants/fonts.ts`：`FONT_OPTIONS`（**7 项**）：系统默认（`system-ui`）/ 微软雅黑 UI / 思源宋体(`NotoSerifSC-Regular.otf`) / 朱雀仿宋(`ZhuqueFangsong-Regular.ttf`) / 小赖字体(`XiaolaiSC-Regular.ttf`) / 霞鹜文楷 Lite(`LXGWWenKai-Regular.ttf`) / 汇文明朝(`Huiwen-mincho-Regular.otf`)。**有 `fileName` = 下载型字体；`undefined` = 系统字体**（`FontPopover` 与 `SettingsFontSelect` 共用此清单）。
- `utils/fontStack.ts`：`buildFontStack(primary)` —— 按字体类型生成带中文 fallback 的完整 font-family 栈，**编辑器与导出端共享**，消除两端不一致。
- `services/fontLoader.ts`：远程字体按需下载 + 文件系统缓存 + **CSS @font-face 注入（首选）** + 字节通道（兜底）。首选 `registerFontViaCss` 调 `toAssetUrl` 注入 `@font-face{src:url(asset://...)}`（浏览器内核直读磁盘，不走 CORS）；失败回退 `readFontBytes` IPC 取字节 → `new FontFace(family, bytes)` 同源加载。系统字体跳过，已加载缓存复用，加载中去重。
- 字体系统深度专题与踩坑总结见 [`docs/font-handling.md`](./docs/font-handling.md)（含 CORS 陷阱、资源错配、验证方法论、排查决策树）。

---

## 11. 关键约束（改前必读）

> **敏感区速查表**（原 `docs/defect-hotspots.md` 已并入此处，避免两处漂移）：改代码前先对照下表定位「易错区 → 关键文件 → 详解」。

| # | 敏感区 | 关键文件 | 详解 |
|---|--------|----------|------|
| 1 | 脏态机制（A1 语义比对） | [`src/stores/file.ts`](./src/stores/file.ts)（`setContent`/`syncEditedContent`） | §11.1 |
| 2 | 保存冲突检测 | [`src-tauri/src/commands/document.rs`](./src-tauri/src/commands/document.rs) + [`useDocumentSession.ts`](./src/composables/useDocumentSession.ts) | §11.2 |
| 3 | 序列化尾换行 | [`serializer.ts`](./src/components/Editor/tiptap/markdown/serializer.ts) | §11.3 |
| 4 | IPC 路径 / URL 信任边界（扩展名白名单、图片资产、远程 URL） | [`src-tauri/src/commands/document.rs`](./src-tauri/src/commands/document.rs) + [`image.rs`](./src-tauri/src/commands/image.rs) + [`font.rs`](./src-tauri/src/commands/font.rs) | §11.4 |
| 5 | 启动开打竞态 | [`src-tauri/src/state.rs`](./src-tauri/src/state.rs) + [`lib.rs`](./src-tauri/src/lib.rs) | §11.5 |
| 6 | 防抖分层（字数150/光标100/大纲500/序列化500） | [`useEditorSync.ts`](./src/composables/useEditorSync.ts) | §6.3 |
| 7 | 命令名 / 定义真理源 | [`command-names.ts`](./src/services/tauri/command-names.ts) + [`registry.ts`](./src/commands/registry.ts) | 附录 B |
| 8 | 主题色彩/排版注入（三层结构） | [`themes/manager.ts`](./src/themes/manager.ts) + [`types.ts`](./src/themes/types.ts) | §10.1 |
| 9 | 多窗口进程模型 | [`lib.rs`](./src-tauri/src/lib.rs) | — |
| 10 | 构建环境 | 见 [`docs/debugging.md`](./docs/debugging.md) + [`docs/HANDOVER.md`](./docs/HANDOVER.md) | — |
| 11 | 字体渲染 CORS + 资源错配 | [`fontLoader.ts`](./src/services/fontLoader.ts) + [`font.rs`](./src-tauri/src/commands/font.rs) | [字体手册](./docs/font-handling.md) |
| 12 | NodeView 事件/定时器成对清理 | [`extensions/code-block.ts`](./src/components/Editor/tiptap/extensions/code-block.ts) + [`image.ts`](./src/components/Editor/tiptap/extensions/image.ts) | §11.7 |
| 13 | 文件 vs 剪贴板两种转义模式，嵌套 state 必须继承 | [`serializer.ts`](./src/components/Editor/tiptap/markdown/serializer.ts) | §11.8 |

### 11.1 脏态机制不可随意改动（A1 语义比对模型）

`file.ts` 的 `setContent()`（仅同步基线，不标脏）与 `syncEditedContent()`（语义比对为唯一脏真相源）分离是**有意的**（见 §7.1）。编辑器加载后立即 `setContent(serializeMarkdown())` 建立**规范化基线**，消除 parser/serializer 归一化差异导致的假脏态。

**改动铁律**：
- 不要把基线写回（程序性）误判为脏——必须用 `syncEditedContent` 的语义比对，而非 `hasUserEdit` 式标志。
- 不要在 `syncEditedContent` 里对 `normalizedNew === normalizedBase` 分支做任何"标脏"动作，否则 Mermaid 后台事务会误标脏、拖入图片会漏标脏。
- **动了它就会重新引入脏态闪烁。**

### 11.2 保存冲突检测在 Rust 侧

`save_document(path, content, expected_last_modified_ms, force)`：
- 非 force 时对比传入的 expected mtime 与磁盘当前 mtime，不符 → 返回 `AppError::Conflict`（code `document_conflict`）。
- 前端 `useDocumentSession` 收到 conflict → 弹"强制覆盖"确认 → 递归调用（先释放 `isSaving` 锁防死锁）。
- `atomic_write`：先写 `.tmp` 再 `rename`，跨平台原子覆盖（Windows 用 `MoveFileExW` + REPLACE，**不做先删后改名**以免引入竞态窗口）。

### 11.3 序列化总是规范化尾换行

`serializeMarkdown()` 强制输出**恰好一个**尾换行。roundtrip 测试同样规范化预期值。**"多了一个换行"先查 serializer，别改测试。**

### 11.4 IPC 路径 / URL 信任边界

前端传入的路径与 URL **不可直接采信**：恶意文档内容（如构造的 `image src`）能诱导命令越权读写文件或向内网发请求。当前闸门：

- **扩展名白名单**（`validate_document_extension`，大小写不敏感）：读 `md/markdown/txt`（与 `lib.rs` 的 `supported_open_path` 同源，新增可编辑类型两处都要改）；写多一个 `json`——「导出主题模板」复用 `save_document` 写 `.json`。本地绝对路径本身是合法用例（用户引用 `D:/docs/x.md`），故**只卡扩展名，不做目录约束**。
- `validate_image_asset_path`：先 `canonicalize`（解析符号链接/`..`）再校验 `is_file` 与扩展名，**防 `evil.png → /etc/passwd` 绕过**。只在 8 种图片扩展名白名单内放行（`png/jpg/jpeg/gif/webp/svg/bmp/ico`；v1.2.27 从 6 种扩到 8 种补齐 `.bmp/.ico`，此前文档写「6 种」已滞后）。`import_document_image` 的 source 也走它，防止把任意文件拷进资产目录。**这 8 种是三处硬编码**——Rust `IMAGE_EXTENSIONS`、前端 `editor-image-drop.ts` 的 `supportedImageExtensions`、Rust `mime_to_extension` 的返回值必须一致，否则会出现「能保存但显示失败」（`.bmp/.ico` 当初就是这么踩到的）。
- `validate_remote_image_url`：限 http/https + 拦截**字面量**内网主机（回环/私有/链路本地/组播、`localhost`/`.local`/`.internal`、云元数据 `169.254.169.254`，含 IPv4 内嵌 IPv6 形式）。
- `validate_font_url`：限 https，**刻意不做主机白名单**——GitHub release 会 302 跳到 `objects.githubusercontent.com`，白名单会打断下载（字体链路有「连修四版才修对」的历史，不再引入新失效面）。

**改动铁律**：
- **校验什么就请求什么**——校验后必须用规范化 URL 建请求（含 `Referer`），不能拿原始输入去 fetch，否则校验形同虚设。
- 缓存 key 仍哈希**原始输入**，避免加固后既有 `remote-image-cache` 全部失效。
- 残留风险（DNS rebinding：域名解析后指向内网）见 [`docs/KNOWN-ISSUES.md` §二 #5](./docs/KNOWN-ISSUES.md)。

### 11.5 启动开打是竞态敏感的

`StartupOpenRequests` + `PendingWindowPaths` + `LoadedWindows` 两层缓冲（见 §4.5）。动启动事件顺序前务必理解 `startup_ready` 的分支。

### 11.6 真理源自一处

- 命令名只在 `command-names.ts` 登记。
- 命令定义只在 `registry.ts`。
- 字体清单只在 `fonts.ts`，字体栈只在 `fontStack.ts`。
- 主题色彩映射只在 `types.ts::CSS_VAR_MAP`：**任何要跟随主题切换的颜色，必须同时在 `ThemeColors` 接口与 `CSS_VAR_MAP` 登记，禁止只在 `main.css` 写死某个颜色**——否则切预设主题时该色不随主题变化（参考 2026-07-21「状态栏未保存指示不随主题」bug：`--dirty-color` 漏登记导致始终回退书卷气默认值）。
- **设计体系规则（2026-08-21 确立，全格式覆盖）**：solo 之内的一切视觉颜色都必须来自主题 token（`--*` CSS 变量），**按产品设计定义，不按依赖关系**——外部依赖（highlight.js / mermaid / KaTeX 等）只要渲染在 solo 界面内，其颜色同样必须走 token 映射，禁止加载外部主题或硬编码色值：
  - 主题三层结构：范式（token 全集，`types.ts::CSS_VAR_MAP` + `editor.css :root` 排版默认 + `manager.ts::SHARED_LIGHT/DARK_COLORS` 共享默认）→ 实例（8 个 preset JSON，只写性格 token）→ 消费（渲染层只引用 `var(--x)`）。
  - 代码语法高亮：`editor.css` 的 `.hljs-*` → 主题 token 映射（**禁止**加载 highlight.js 外部配色，见 `useEditorAppearance.ts`）。
  - Mermaid 图表：`mermaid-block.ts::buildMermaidConfig` 用 `getComputedStyle` 读当前主题 CSS 变量注入 `themeVariables`（theme: 'base'，**禁止** mermaid 内置 default/dark 主题与硬编码提亮）。
  - 新增任何"带颜色的格式"时先回答：它的颜色进 token 全集了吗？进不了就拒绝实现或收编。
  - 主题 JSON 只允许存在"性格差异"字段，共享值（radius/功能色/markBg/遮罩/幽灵按钮）一律进共享默认层（SHARED_LIGHT/DARK_COLORS），禁止复制进各主题。

### 11.7 NodeView 事件与定时器必须成对清理

NodeView 的 `dom` 由 ProseMirror 直接增删，**不走 Vue 的生命周期**，所以 `addEventListener` / `setInterval` / `setTimeout` 没有任何东西替你收尾——节点销毁后监听器和整条闭包仍存活，频繁增删同类节点的长会话会线性积累内存与幽灵回调。

**仓库统一套路**（`AbortController`，勿另发明）：

```ts
const eventController = new AbortController();      // 建 DOM 时先声明
el.addEventListener('click', onClick, { signal: eventController.signal });  // 每个监听器都带 signal
destroy() {
  eventController.abort();                           // 一次摘掉全部监听
  if (timer) clearTimeout(timer);                    // 定时器不在 signal 管辖内，单独清
}
```

现役实现：[`code-block.ts`](./src/components/Editor/tiptap/extensions/code-block.ts) / [`image.ts`](./src/components/Editor/tiptap/extensions/image.ts) / [`math-block.ts`](./src/components/Editor/tiptap/extensions/math-block.ts) / [`mermaid-block.ts`](./src/components/Editor/tiptap/extensions/mermaid-block.ts)。回归锁：[`extensions/__tests__/nodeview-destroy.spec.ts`](./src/components/Editor/tiptap/extensions/__tests__/nodeview-destroy.spec.ts)。

**易漏的第二半**：销毁后的**异步回写**也要守卫。图片 src 解析是异步的，`requestId` 闭包变量活在同一个已销毁的闭包里、晚到的响应仍会自匹配——**单靠 requestId 挡不住**，必须额外查 `eventController.signal.aborted` 再碰 DOM。

### 11.8 两种转义模式：文件 vs 剪贴板

`escapeInline`（[`serializer.ts`](./src/components/Editor/tiptap/markdown/serializer.ts)）按 `clipboard` 标记分两套转义，两者**故意不同，别互相"修正"**：

| 模式 | 入口 | 行内转义集 | 行首额外转义 |
|---|---|---|---|
| 文件落盘（严格） | `serializeMarkdown()` | `` ` [ ] ( ) * ~ ^ = \| $ < > { } `` | `# + - .` |
| 剪贴板（轻量） | `serializeMarkdownForClipboard()` | `` ` * `` | `# + - . > =` |

**改动铁律**：块处理器需要**嵌套序列化**（引用块内部、表格单元格文本）时，必须用 `state.createChild()` 拿内层 state，**不要 `new MarkdownSerializerState()`**——默认构造是文件模式，会把外层 clipboard 标记丢掉，导致粘到外部编辑器的内容多出 `\=` `\$`。只有上面两个真入口允许直接构造。

另一处坑：表格的**列宽统计**与**内容输出**必须调同一个 `cellToText(state, cell)`，否则 `padEnd` 对齐用的长度与实际写入的字符串不是同一份，表格会错位。

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

下列内容在 `.trae/documents/` 或**本文档旧版本**中被描述为存在/未解决，但**当前代码实际状态**如下：

| 旧文档说法 | 实际现状 |
|---|---|
| 存在文件树 / workspace watcher / `useFileTree.ts` / `useFileOperations.ts` | **已移除**。`useDocumentSession.ts` 内有 `// workspace 功能已移除` 注释 |
| `fs.rs` / `watch.rs` / `config.rs` | **不存在**。文件操作在 `commands/document.rs`，无 watcher，设置用 tauri-plugin-store |
| 6 个字体 | **7 个**（系统默认 + 微软雅黑 UI + 5 款远程下载字体），见 §10.3 |
| emoji 补全未实现 | **已实现**（`emoji-suggest.ts` + `EmojiMenu.vue`，`:` 触发） |
| 编辑区排版硬编码、不随主题切换 | **已解决**。主题 `typography` → `--mk-*` 变量 → `editor.css` 消费 |
| 字体依赖本地安装 | **已解决**。改为按需远程下载 + 文件系统缓存，安装包不再内嵌字体文件 |
| 字体栈分散 | **已收口**到 `fontStack.ts::buildFontStack`，编辑器+导出共享 |
| 序列化防抖 300ms | **实际分层**：150ms（字数）/ 100ms（光标）/ 500ms（大纲+序列化），见 §8.2 / §6.3 |
| Rust 命令 ~20 个 | **实际 22 个**（见 `lib.rs::generate_handler!`，含 `resolve_image_display`/`read_clipboard_html`/`read_font_bytes`/`detect_proxy_for_update`） |
| 快捷键表 / 发布清单列有「导出 HTML / PDF / 微信」 | **已移除**（v1.2.18）。复制为 HTML 用状态栏「复制为 HTML」按钮，无导出命令；`utils/export/` 整个目录已删除 |
| 脏态用 `setContent` + `markUserEdit` 双函数（按 hasUserEdit 标志判定） | **A1 重构**：改为 `setContent`（仅基线）+ `syncEditedContent`（语义比对唯一真相源），`hasUserEdit`/`markUserEdit` 已废弃，见 §7.1 / §11.1 |
| composables 10 个 / `utils/shortcuts.ts` 存在 | **实际 12 个**；`utils/shortcuts.ts` **已删除**（registry 内联 `getShortcut`/`getShortcutCommands`） |
| `services/tauri/` 含 `event-names.ts`/`webview.ts`/`opener.ts`/`os.ts`/`window-state.ts` | **均不存在**。实际 10 个文件：`client`/`command-names`/`document`/`window`/`dialog`/`clipboard`/`events`/`font`/`asset`/`store`，见 §3 / §5.3 |
| 主题 7 套（含 `gray-domain`） | **实际 8 套**：`scholar-light`/`scholar-dark`/`elegant`/`cinnabar`/`cinnabar-dark`/`default`/`jade`/`orchid`，见 §10.1 |
| 编辑器扩展 14 个 | **实际 21 个**（含 Frontmatter/Footnote×3/Callout/ParagraphFocus/SearchHighlight/Link/LinkOpen/Dim 等），见 §8.3 |
| Tauri 插件 6 个 | **实际 7 个**（多 `updater`，见 `autoCheckForUpdate`） |
| `proxy.rs` 定义 `detect_proxy_for_update` | **不存在 `proxy.rs`**；该命令定义在 `lib.rs`，见 §4.2 |
| 启动竞态两层缓冲 | **实际四类 managed state**：`StartupOpenRequests`/`PendingWindowPaths`/`LoadedWindows`/`FocusedWindow`，见 §4.5 |

> 若你发现本附录与代码不符，**以代码为准并更新本表**——这是这份文档保持可信的唯一方式。

---

## 开发命令速查

> 所有构建 / 开发 / 测试 / 清理命令以 **BUILD_GUIDE.md §8.5（常用命令速查）** 为唯一真理源，本文不再复述，避免命令与参数在两处漂移。

代码风格：Prettier（单引号/分号/尾逗号/2 空格/100 列/LF），ESLint（`no-explicit-any` 与 `no-unused-vars` 为 warn，`_` 前缀参数豁免，禁 `console.log` 但允许 `warn`/`error`）。
