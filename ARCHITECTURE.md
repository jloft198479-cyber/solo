---
title: solo 架构文档
type: core
audience: dev
status: active
tags: [核心文档, 架构, 技术栈, 命令清单, 敏感区]
summary: 代码真相权威地图：技术栈版本/命令清单/目录树（敏感区安全网见 docs/sensitive-areas.md）
updates: [package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json, src-tauri/src/lib.rs, src-tauri/src/native_resize.rs, src-tauri/src/commands/, src-tauri/src/state.rs, src/commands/registry.ts, src/components/Editor/tiptap/editor-extensions.ts, src/components/Editor/document-scale.ts, src/composables/, src/stores/, src/services/tauri/, src/themes/presets/, BUILD_GUIDE.md, docs/font-handling.md, docs/KNOWN-ISSUES.md, docs/sensitive-areas.md]
---

# solo 架构文档

> **目标**：让任何开发者（人或 AI）在 15 分钟内建立完整、准确的心智模型，并能定位到任意功能的改动入口。
> **写作基准**：一切以**实际代码行为**为准，不依据注释或历史文档。版本号以 `package.json` 为唯一真相源；**会随代码漂移的计数（命令数 / 测试数 / 文件数 / 快捷键）一律不在此硬编码**，指向源码（`generate_handler!` / `bun run test` / 目录 `ls` / `registry.ts`）。

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
Rust 核心 (src-tauri/)   ──命令 + 事件──▶  文件/图片/窗口/字体/剪贴板/注册表/代理
        ▲ invoke / emit
IPC 服务层 (src/services/tauri/)  ──契约封装，前端不直接碰 invoke
        ▲
Vue 前端 (src/)   App.vue 协调层 ──委托──▶ 12 个 composables + 2 个 Pinia store + TipTap 编辑器
```

> 除上述三层纵向结构外，还有**三条横切机制**不属于任何一层、又影响多层行为：**会话记忆（最近文件 + 阅读位置）**、**大文档分档降级**、**Windows 原生窗口缩放** —— 见 §12。

> ⚠️ 仓库内同时存在 `README.md` 及 `.trae/documents/` 下的早期文档，它们描述了**文件树、workspace watcher、`fs.rs`/`watch.rs`/`config.rs`** 等结构——**这些在当前代码中已不存在**。请一律以**本文档 + 实际代码**为准（差异清单见附录 C）。新入手的 AI 开发者先读 [`AGENTS.md`](./AGENTS.md)（行为契约 + 真理源地图）。**规则一律以 `AGENTS.md` 与本文为准**；`.opencode/`、`.trae/`、`.dumate/` 等 Agent 工作目录内的历史文档仅供参考、**不作规则来源**（如 `.opencode/PROFILE.md` 自称「每次新会话先读」但内容已过期）。

---

## 1. 技术栈实测表

| 层 | 技术 | 版本 | 备注 |
|---|---|---|---|
| 桌面框架 | Tauri | 2.11.2 | 无边框窗口、自定义标题栏、CLI（多进程）、OS-open |
| 原生核心 | Rust | 1.96.0 | edition 2021, opt-level=3；thiserror + serde + reqwest + winreg(Windows) + arboard + tokio + base64 + url；Windows 另挂 `webview2-com` / `windows 0.61`（见 §12.3） |
| 前端框架 | Vue 3 | 3.5 | Composition API + `<script setup>` |
| 语言 | TypeScript | ~6.0 | strict 模式 |
| 状态管理 | Pinia | 3.x | 2 个 store：file / settings |
| 构建 | Vite | 7.x | |
| 样式 | Tailwind CSS 4 + CSS 变量 | 4.3 | 主题靠 CSS 变量驱动 |
| 编辑器 | TipTap / ProseMirror | 3.31 | 实例复用，不随文件切换重建 |
| Markdown | markdown-it + 自研 parser/serializer | 14.2 | 自研链路，非 prosemirror-markdown |
| 数学/图表 | KaTeX / Mermaid | 0.17 / 11.x | KaTeX 懒加载，不进解析器热路径 |
| 测试 | Vitest 4.x + happy-dom 20.x | Vitest 4.1 / happy-dom 20.10 | spec 文件数与测试数随用例增减，以 `bun run test` 输出为准 |
| 包管理 | bun | 1.3.14 | |

> ⚠️ 上表版本号为**撰写时快照**，会随依赖升级漂移；以 `package.json` / `src-tauri/Cargo.toml` 为准，发现不一致请以源码为准并回报。

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
│          关注点拆分)     └─ settings.ts   ▸ Settings(13)         │
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
│ commands/ ── document/font/clipboard/window/desktop/image（§4.2） │
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

### 绝不简化掉的清单（安全 / 鲁棒底线）

刻意简化时不得省略：信任边界的输入校验（用户输入、外部数据）、防止数据丢失的错误处理、安全措施（路径遍历防护、XSS 防护）、用户明确要求保留的功能。简化用 `simp:` 注释标记：`simp: <已知上限>, <升级触发条件>`。

（详见 [`docs/solo产品精神.md`](./docs/solo产品精神.md) 母本）。

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
│   │   ├── CommandPalette.vue     #   命令面板（含「最近文件」分组，直读会话记忆）
│   │   ├── FontPopover.vue / ThemePopover.vue
│   │   ├── StatusbarQuickActions.vue
│   │   ├── popover-shared.css     #   浮层通用样式
│   │   ├── Editor/               #   编辑器核心
│   │   │   ├── MarkdownEditor.vue#     TipTap 实例 + 防抖序列化 + 视图
│   │   │   ├── ImagePreviewView.vue / ImageFullscreenOverlay.vue
│   │   │   ├── OutlinePanel.vue   #     大纲面板（可拖动重排 + 跳位）
│   │   │   ├── document-scale.ts  #     大文档分档（normal/heavy/extreme，见 §12.2）
│   │   │   ├── views/            #     SlashMenu / EmojiMenu / BubbleMenu / WikilinkMenu / ContextMenu / SearchPanel
│   │   │   └── tiptap/           #     TipTap 扩展层
│   │   │       ├── editor-extensions.ts  # 扩展注册表（真理源，见 §8.3）
│   │   │       ├── editor-commands.ts    # 编辑器命令执行
│   │   │       ├── editor-image-drop.ts  # 图片拖放
│   │   │       ├── editor-metadata.ts    # 大纲/字数/光标提取
│   │   │       ├── clipboard-html.ts      # 整篇 → 对外 HTML 的唯一出口（DOMSerializer + 归一）
│   │   │       ├── externalize-html.ts    # 出站 HTML 归一层（剥私有保通用；禁换私有标签/属性）
│   │   │       ├── external-styles.ts     # 出站内联样式（公众号只认行内 style；读 --mk-* 与屏幕同源）
│   │   │       ├── composition-freeze.ts # 组字态（IME）真相源：isFrozen / mapFrozenDecorations
│   │   │       ├── list-demote.ts      # 列表项托孤式降级（子列表上位）
│   │   │       ├── list-move.ts        # 列表行/子树位移（行897 + moveListItem）
│   │   │       ├── transaction-shape.ts# 事务形态判定（整篇替换 → 跳过装饰重算）
│   │   │       ├── zwnj.ts             # ZWNJ 常量与剥离唯一来源（见敏感区 23）
│   │   │       ├── ime-anchor.ts       # Windows 窗口缩放后重锚编辑焦点（IME 护栏）
│   │   │       ├── editor-dom.ts         # 编辑器 DOM 工具
│   │   │       ├── useEditorAppearance.ts# 字体/主题/代码高亮注入
│   │   │       ├── useEditorSearch.ts    # 编辑器内搜索替换
│   │   │       ├── editor.css            # 编辑区排版（消费 --mk-* 变量）
│   │   │       ├── extensions/           # 自定义扩展（数量以源码为准，见 §8.3）
│   │   │       └── markdown/             # parser / serializer / plugins
│   │   ├── Settings/             #   设置面板（13 个 .vue）
│   │   ├── Layout/               #   CustomTitlebar / WindowResizeHandles（仅非 Windows）/ ErrorBoundary
│   │   └── icons/                #   CloseIcon / CheckIcon
│   │
│   ├── services/
│   ├── services/
│   │   ├── tauri/                #   IPC 服务层（12 个文件，数量以 `ls src/services/tauri` 为准）
│   │   │   ├── client.ts         #     invokeCommand<T> + normalizeTauriError
│   │   │   ├── command-names.ts  #     TAURI_COMMANDS 常量表（与 lib.rs 宏一致，有机器锁）
│   │   │   ├── document.ts       #     打开/保存/图片 API 封装
│   │   │   ├── session.ts        #     会话记忆：最近文件 + 阅读位置（见 §12.1）
│   │   │   ├── window.ts         #     窗口控制封装
│   │   │   ├── dialog.ts         #     系统对话框封装
│   │   │   ├── clipboard.ts      #     剪贴板封装
│   │   │   ├── events.ts         #     menu-event / window-close 事件监听封装
│   │   │   ├── font.ts           #     字体 IPC 封装（fetch/getCache/save/readBytes）
│   │   │   ├── asset.ts          #     图片资产协议作用域封装
│   │   │   ├── update.ts         #     更新检查（探代理 → check）
│   │   │   └── store.ts          #     tauri-plugin-store 封装
│   │   └── fontLoader.ts         #   字体按需加载（CSS @font-face 优先，字节通道兜底）
│   │
│   ├── themes/                   #   主题系统
│   │   ├── types.ts              #   Theme / ThemeColors / ThemeTypography
│   │   ├── manager.ts            #   applyTheme：注入颜色 + 排版变量
│   │   └── presets/              #   9 套预设 JSON（见 §10.1）
│   │
│   ├── utils/
│   │   ├── fontStack.ts          #   buildFontStack：统一字体栈（编辑器+导出共享）
│   │   ├── markdown-to-html.ts   #   复制为 HTML 的**回落**管道（编辑器不在时才用；正统出口见 tiptap/clipboard-html.ts）
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
│   │   ├── updater.rs            #   更新代理检测（detect_github_proxy）
│   │   ├── native_resize.rs      #   Windows 原生边缘缩放（Win32 子窗，见 §12.3）
│   │   └── commands/
│   │       ├── mod.rs            #     命令汇总导出
│   │       ├── document.rs       #     open/save/图片导入/路径/资产授权
│   │       ├── session.rs        #     会话记忆落盘（record/read，见 §12.1）
│   │       ├── image.rs          #     fetch_remote_image
│   │       ├── font.rs           #     fetch_font_data / get_cached_font_path / save_font_cache / read_font_bytes
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
3. **`invoke_handler`**：注册命令（**数量以 `lib.rs` 的 `generate_handler!` 为准，勿在文档硬编码**）。
4. **`run()` 回调**：macOS/iOS 的 `Opened { urls }` 事件转成开打请求。

### 4.2 命令清单

> 以 `src-tauri/src/lib.rs` 的 `generate_handler!` 宏为唯一真相源。新增/改名必须同步更新此表。
> 注：`detect_proxy_for_update` 定义在 `lib.rs`（**不存在 `proxy.rs`**，勿被旧文档误导）。

| 命令 | 文件 | 职责 |
|---|---|---|
| `open_document` | document.rs | 读文件内容 + 返回 mtime |
| `save_document` | document.rs | **原子写** + mtime 冲突检测（见 docs/sensitive-areas.md §11.2） |
| `get_file_mtime` | document.rs | 读文件 mtime（互链跳转前的存在性检查） |
| `list_markdown_files` | document.rs | 列当前文档**目录树**内的 .md 相对路径（互链 `[[` 补全候选；深度 `WIKILINK_SCAN_DEPTH`、上限 500 且凑满即停、浅层优先） |
| `rename_file` | document.rs | 重命名文件（去后缀、防冲突、大小写敏感） |
| `sync_wikilinks_on_rename` | document.rs | 改名后同步「指向本文档」的互链：扫**改名文档本层 + 向上两层**目录（引用方只可能在这三层，见 `rename_scan_dirs`），按各层真实写法原子改写 `[[旧名]]`→`[[新名]]`，返回被改动文件的**绝对路径**（不预览、不询问，见 KNOWN-ISSUES §一 #23） |
| `import_document_image` | document.rs | 图片复制到 `assets/`，同名自动加后缀 |
| `save_clipboard_image` | document.rs | 解析 data URL → base64 解码 → 写入 assets |
| `read_clipboard_html` | clipboard.rs | 从系统剪贴板读 HTML 富文本（绕开 webview `clipboardData` 空值问题，外部应用/跨源粘贴保格式） |
| `authorize_image_asset` | document.rs | 把图片加入 asset 协议作用域（**带安全校验**） |
| `resolve_image_display` | document.rs | 路径判别（storage/相对/绝对）+ authorize 一步到位（v1.2.23 新增） |
| `fetch_remote_image` | image.rs | 下载远程图片（单张 ≤10MB）→ 落盘 `remote-image-cache` 返回路径（前端转 asset URL）。缓存总量上限 200MB，超限按 mtime 从旧到新淘汰；启动时 `cleanup_remote_image_cache` 后台清理（近期写入有 10min 宽限，避免误删正在拉取的图片） |
| `fetch_font_data` | font.rs | 远程字体下载（落盘缓存，返回路径） |
| `get_cached_font_path` | font.rs | 字体缓存路径查询 |
| `save_font_cache` | font.rs | 字体缓存写入磁盘 |
| `read_font_bytes` | font.rs | 读取字体字节（经 IPC 取字节 → FontFace 同源加载；**字节通道兜底**，首选 CSS @font-face 注入 asset:// URL，见 §10.3） |
| `set_window_background_color` | window.rs | macOS 窗口背景（NSColor） |
| `register_shell_new` | desktop.rs | Windows 右键"新建 Markdown"注册表（**幂等**：已一致则不发 `SHChangeNotify`，见敏感区 21） |
| `unregister_shell_new` | desktop.rs | Windows 右键"新建 Markdown"注销（**已知越界删除整扩展名键**，见 KNOWN-ISSUES §二 #22） |
| `refresh_native_menu_shortcuts` | lib.rs | 自定义快捷键 → 同步原生菜单（仅 set_accelerator，不重建） |
| `startup_ready` | lib.rs | 前端 ready 信号，触发窗口显示 + 启动开打请求回放（原 `consume_startup_open_request`） |
| `new_editor_window` | lib.rs | 创建新编辑器窗口（原子递增 label） |
| `reveal_startup_open_log` | lib.rs | 返回 startup-open.log 路径（调试启动开打竞态） |
| `request_app_quit` | window.rs | 应用级退出：向所有已加载窗口定向发 `window-close-requested`，各窗口自行确认/保存后关闭，全部关闭后进程自然退出（原 `exit_app` 强杀进程，多窗口丢未保存内容） |
| `report_window_close` | window.rs | 窗口处理完 `window-close-requested`（已保存/已放弃）后回报，app 侧据此放行该窗口关闭 |
| `detect_proxy_for_update` | lib.rs | 检测系统代理（给自动更新用，见 `autoCheckForUpdate`） |
| `record_document_session` | session.rs | 记一次「打开 / 阅读」：最近文件去重置顶 + 可选写阅读比例（见 §12.1） |
| `read_document_session` | session.rs | 读会话记忆：命令面板「最近文件」分组 + 打开文档后恢复阅读位置 |

> **命令数量以 `lib.rs::generate_handler!` 为唯一真相源，此处不硬编码**（曾三处数字漂移，见 KNOWN-ISSUES §二 #3）。
> 🤖 **本表与代码的同步有机器锁**：`src/__tests__/arch-drift.spec.ts` 断言上表集合 == `generate_handler!` 集合（双向：少一个/多一个都红），防止再次只同步代码不同步文档。

### 4.3 事件（2 个）

| 事件名 | 方向 | 载荷 |
|---|---|---|
| `menu-event` | Rust→前端（**定向到当前焦点窗口**） | 菜单项 id 字符串 |
| `window-close-requested` | Rust→前端 | `()`（关闭被拦截，交前端确认） |

> `menu-event` 由 `menu.rs` 经 `app.emit(MENU_EVENT, id)` 广播，但**仅当前 `FocusedWindow` 对应窗口的前端会消费**——前端侧按窗口各自监听，避免多窗口重复执行同一菜单动作（见 §4.5 的 `FocusedWindow`）。

### 4.4 错误模型 `AppError`

5 个变体（`Validation`/`Conflict`/`Io`/`Network`/`Native`），每个有稳定 `code`（如 `document_conflict`）。**自定义 Serialize** 输出 `{ code, message }`，前端 `normalizeTauriError()` 据此解析。`From<io::Error>`/`From<reqwest::Error>`/`From<tauri::Error>` 自动转换。

### 4.5 启动文件开打的竞态处理（`state.rs` + `lib.rs`）

"前端还没 ready 就来了开文件请求"是真实竞态。**五类 managed state** 兜底（均在 `state.rs` 定义，`lib.rs::setup` 逐个 `app.manage`）：
- **`StartupOpenRequests`**：setup 阶段解析 CLI args / OS-open 后存入（单 payload，可合并去重）。
- **`PendingWindowPaths`**：`create_editor_window` 创建新窗口时存入，按 window label 索引（HashMap）。
- **`LoadedWindows`**：已加载完成的窗口 label 集合（标记窗口已就绪）。
- **`FocusedWindow`**：当前焦点窗口 label（用于 `menu-event` 定向分发，见 §4.3）。
- **`CloseGuard`**：关窗看门狗——前端确认链被大文档序列化占死（`close-requested` 无人应答）时，「第二次关闭请求」成为一条纯 Rust 的退路（见 docs/sensitive-areas.md §11.2）。

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

`document.ts`（open/save/图片）、`session.ts`（会话记忆）、`window.ts`、`dialog.ts`、`clipboard.ts`、`font.ts`（字体 IPC）、`asset.ts`（图片资产作用域）、`events.ts`（菜单/关闭事件监听）、`store.ts`（tauri-plugin-store）、`update.ts`。每个文件只调 `invokeCommand`，对上层隐藏 IPC 细节。

> **已知的既有例外（现状记录，非规范）**：会话记忆不走 composable —— `CommandPalette.vue` 直接 `readDocumentSession()` 取最近文件、`MarkdownEditor.vue` 直接记录/恢复阅读位置（数据只在少数两处用、且要「随手写随时读」，见 §12.1）。除此之外的 IPC 一律经 composable 或 store；**新增领域数据时先想清楚要不要进 store，别默认复制这条捷径**。

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

### 6.2 `App.vue` —— 协调层 + 少量界面编排（如实描述，2026-10-13 修订）

> 旧版本节自称「自身不含业务逻辑、只做接线」，与实际不符，已改为如实描述。**目标是「协调为主」而非「零业务」**：下面第二组那几条属**界面编排**（与 UI 展示直接耦合的流程控制），保留在 App.vue 是有意为之——抽成空壳 composable 只是换个地方放同样的代码，反而多一层间接。真正在增长、且值得抽走的是跨复用的通用能力，届时单开 composable。

**协调职责**（主体，占绝大多数）：
- 初始化 `settingsStore`、`windowSession`、`syncMenuShortcuts`。
- 把各 composable 的能力组合进 `useCommandDispatcher` 的 options。
- 模板：`CustomTitlebar` + `<main>`（按 `activeViewMode` 切 editor/image）+ 状态栏 + `SettingsModal` + 图片全屏浮层。
- 拖放：app 级文件 drop → `documentSession.openDocumentWithPrompt`。

**界面编排**（少量，与 UI 强耦合）：
- **焦点模式提示的状态机**：进入后 3.5s 引导条、退出后 2s 提示，含定时器成对清理（App.vue:100-142）。
- **启动编排**：`initThemeOnly` → `windowSession.setup()` → `settingsStore.init()` + `syncMenuShortcuts` + `autoCheckForUpdate`（App.vue:275-295）。
- **窗口关闭降级链**：标题栏 X 先走原生关闭通道，失败回退前端关闭链，再失败才 `destroyCurrentWindow`（App.vue:258-273）。
- **外部修改重载**：状态栏告警被点击 → `openDocumentWithPrompt(path)`（内含脏态确认，不会静默丢编辑）。
- **大文档降级提示文案**：状态栏按 `isHeavyDocument()` 显示约号与悬停说明（见 §12.2）。
- **Shell 集成副作用**：watch `shellIntegration` → 调用 register/unregister（**注意另有第二个入口**，见 §12.4）。

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

> 旧文档提到的 `utils/shortcuts.ts` **已删除**：registry 内联 `getShortcut`/`getShortcutCommands`，全仓无 `shortcuts` 引用。命令源 `CommandSource` = `shortcut` | `menu` | `palette`（**3 个**），`CommandScope` = `app` | `editor`。

---

## 7. 两个 Pinia Store

### 7.1 `stores/file.ts` —— 文档状态（短生命周期）

```
currentFile: { path, content, isDirty, lastModifiedTime, displayName, originalBaseName }
isLoading: boolean                  // 读盘/解析期间的状态栏加载条
reloadToken: number                 // 仅 setFile() 递增，编辑器据此换文档（见下）
```

**核心机制：脏态以"语义比对"为唯一真相源（A1 改造，详见 docs/sensitive-areas.md §11.1）**：
- `setContent(content)` —— **仅同步基线内容，不标脏**。编辑器加载后建立规范化基线时调用。
- `syncEditedContent(content)` —— **脏标记唯一真相源**：先把内容与基线都 `replace(/\n+$/, '')` 规范化，若**语义不同** → 更新内容并置 `isDirty=true`；若相同 → 直接 `return false`，不改动不标脏。
  - 由此同时根治**漏标脏**（拖入图片等非键盘交互，过去 `markUserEdit` 收不到）与**误标脏**（Mermaid 等后台事务触发序列化但内容未变）。
  - 不再区分"程序性写回 vs 用户编辑"——通过语义比对判定，消除 `hasUserEdit` 标志的歧义。
- `setDisplayName(name)` —— 置脏（标题被改）。
- `markSaved(lastModifiedTime = null, content?)` —— 清脏，`displayName` 重置回 `originalBaseName`；传 `content` 时**基线同步为实际落盘内容**（基线的唯一安全更新时机：只在保存成功后，否则失败/冲突取消会把未保存编辑洗白）。
- `renamePath(newPath)` —— 重置 `displayName` 与 `originalBaseName`（实际文件重命名在保存时经 save-as 流程完成，见 `useDocumentSession.handleRename`）。
- `reset()` —— 回到空文件状态。

> **`reloadToken` 是「编辑器何时换文档」的唯一触发器**（`MarkdownEditor.vue` watch `[path, reloadToken]`）：只看 `path` 时，同路径的外部修改重载会被漏掉（旧 doc 的延迟序列化还会把旧内容写回 store）；直接 watch `content` 更不行——编辑期 `syncEditedContent` 也在写 `content`，store 一滞后就会把正在编辑的内容回退成旧基线。动编辑器换文档逻辑前先理解这个 token。

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

---

## 8. 编辑器核心

### 8.1 TipTap 实例复用 + 懒初始化

`MarkdownEditor.vue` 创建**单个** TipTap 实例（`shallowRef`），切文件时只 `setContent`，**不 destroy 重建**——这是响应快的关键。

**懒初始化**：编辑器不在挂载时立即创建——无焦点不建，等获得焦点 / `solo:editor-focus` 事件 / `requestAnimationFrame` 兜底（延迟到首帧绘制后创建，**非定时器**）后才初始化，避免后台标签页空耗资源。切换文件时若序列化结果相同则跳过 `setContent`，避免无谓重渲染。

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

### 8.3 扩展（数量与清单以 `editor-extensions.ts` 的 `createEditorExtensions` 返回数组为唯一真相源）

注册列表按 `createEditorExtensions` 实际顺序（**机器校验区**，每行第一列必须与源码一致，`arch-drift.spec.ts` 双向比对，见 §4.2 同款锁）：

<!-- SOLO:EXT-LIST:START -->

```text
StarterKit                 StarterKit.configure：被显式关闭的内置成员见下方「禁用清单」
Frontmatter
FootnoteRef
FootnoteSection
FootnoteDef
SemanticHeading
CustomCodeBlock
CustomTable
CustomTableRow
CustomTableHeader
CustomTableCell
CustomImage
Callout
Code                      Code.extend：放开 excludes，须与 bold/italic 共存（敏感区 #16）
Highlight                  multicolor:false
Paragraph                  Paragraph.extend：Mod-0 键位对齐注册表
Blockquote                 Blockquote.extend：Mod-Shift-q 键位对齐注册表
Strike                     Strike.extend：Mod-Shift-x 键位对齐注册表
ParagraphFocus
ListFold                   列表折叠/展开（幕布式），折叠态按文档路径记忆，进程内存不落盘
SearchHighlight
Link                       openOnClick:false
LinkOpen
BulletList                 BulletList.extend：content 放开为 (listItem|taskItem)+（敏感区 #15）
OrderedList                OrderedList.extend：同上
TaskList
ListItem                   ListItem.extend：首格放开为 block+（台账 §二 #30）
TaskItem                   TaskItem.extend + configure({nested:true})：[ ] 输入规则挂这里
ListEnterGuard             回车「新建同级项」守卫：父项行尾回车不再把子列表甩给新项
ListBackspaceGuard         行首退格「永不劈开列表」守卫
CellContentGuard           入站 path（粘贴/insertContent/拖拽）的表格结构守卫
Placeholder
MathBlock
MathInline
MermaidBlock
MarkdownInput
MarkdownPaste
Superscript
Subscript
Dim
Wikilink
WikilinkExistence
SlashCommands
EmojiSuggest
WikilinkSuggest
```

<!-- SOLO:EXT-LIST:END -->

**StarterKit 禁用清单**（`xxx: false` 才能在下方换成 extend 版本，否则重复注册报 duplicate 警告）：

<!-- SOLO:STARTERKIT-DISABLED:START -->

```text
codeBlock
link
heading
code
bulletList
orderedList
listItem
paragraph
blockquote
strike
underline
```

<!-- SOLO:STARTERKIT-DISABLED:END -->

> 改这套清单前先读源码注释（每一行都写了**为什么**）。四个「承接改造」的名字（`BulletList` / `OrderedList` / `ListItem` / `TaskItem`）是 docs/sensitive-areas.md **#15 列表容器契约**的载体，`Code` 是 **#16 mark 定界符**的载体——2026-10-13 前本清单曾漏列它们，导致 Agent 在敏感区里找不到对应扩展；现由机器锁兜住。
> `underline` 必须**显式关闭**：它是 StarterKit 默认成员，而 CommonMark/GFM **没有下划线语法**（详见敏感区 #16b）。

**IME 友好细节**：`SlashCommands` / `EmojiSuggest` / `WikilinkSuggest` 三个 suggestion 均设 `allowedPrefixes: null`（支持中文「你好/」「标题/」「你好[[」后唤出菜单，默认 `allowedPrefixes:[' ']` 会过滤掉无空格前缀，对中文场景致命）。

复杂渲染用 `addNodeView()` **内联在扩展文件里**，不拆独立 Vue 文件。浮动菜单定位抽成纯函数 `computeMenuPosition`（`editor-extensions.ts`），对齐业界 `size` + `flip`：高度**不是常量**，取「当侧可用空间」并夹在 `[MENU_MIN_HEIGHT=120, MENU_IDEAL_HEIGHT=340]` 内（有上限，否则菜单会随窗口高度忽高忽低），经 CSS 变量 `--menu-max-height` 下发给滚动区；上翻时改用 `bottom` 定位使菜单底边贴住光标（`position: fixed` 下可免去「先渲染再测高」的一帧抖动）。Slash / Emoji / 互链三个菜单共用此函数。

### 8.4 Markdown 解析链（`tiptap/markdown/`）

- `parser.ts`：MD → ProseMirror Doc。基于 markdown-it（commonmark + table + strikethrough + task-lists + mark + sub + sup + texmath + footnote）。**frontmatter / callout / `$$`数学块在 markdown-it 之前先抽取占位，之后还原**。texmath 传**空壳 KaTeX 引擎**（解析器只分词不渲染），让真正的 KaTeX 可懒加载、不进热路径。
- `serializer.ts`：ProseMirror Doc → MD。自研，精确控制输出。**强制末尾恰好一个换行**。
- `plugins/`：解析插件（`frontmatter` / `callout` / `math` / `mermaid` / `wikilink` / `footnote` / `fence` + `index.ts` 汇总），承载扩展语法的 token 与序列化钩子。
- `__tests__/roundtrip.spec.ts`：**Markdown 保真度的主要安全网**——动 parser/serializer 前先看它。
- `__tests__/fixtures.spec.ts`：19 个 fixture 的**保真回归**——「重开等价」（参照系是 markdown-it，抓内容丢失）+ 字节保真（差异须登记在 `KNOWN_FIDELITY_GAPS`）；未登记缺口与「登记项已修好」都会红（**双向锁**）。
- `__tests__/fuzz.spec.ts`：随机**结构块**组合压测（标题/列表/嵌套/任务列表/代码围栏/引用/表格/转义竖线表格/脚注/块级数学/分隔线 + 行内样式，含 **mark 套 mark**），断言重开等价 + 收敛。**随机源种子化**（同种子 → 同序列，失败可原样重放；`FUZZ_SEED` 可覆盖）。**词表本身就是判据的一部分**——历史上 #35 的病根就是「该组合不在词表里」。
- `__tests__/commonmark.spec.ts`：CommonMark spec 全量 roundtrip 验证（**条数与 pass/skip 分档以 `bun run test` 输出为准，不在此硬编码**）。**只验收敛，不是保真防线**——收敛 ≠ 内容不丢。跳过表在 `__tests__/commonmark-skips.ts`（与 `safety-net.spec.ts` 共用，避免两处漂移）；2026-10-10 已清掉 22 条陈旧条目（**跳过表不会自己收缩**）。
- `__tests__/mark-matrix.spec.ts`：**行为级 mark 矩阵**——构造 → 落盘 → 重开，比两个 PM doc 的「文本 ⊕ mark 集合」。为什么不能只靠 `mark-delimiter-coverage`：那是从源码正则抠 `case 'xxx'` 名，只证明「有分支」，证明不了「写出去能重开」。
- `__tests__/safety-net.spec.ts`：**安全网自检 + 登记锁**——证明判据本身能抓东西（反向校准：关掉判据该转红）、并对已知缺口（CommonMark 5 条丢格式 SKIP、脚注重复标签）做双向锁。
- `__tests__/test-utils.ts`：测试共享工具。`reopenDrift` 有**三条**判据：可见文字多重集、块结构直方图、**正向包含**（原始内容字符 ⊆ 输出，专抓「参照系两侧同丢」的隐形丢失）。
- `__tests__/fidelity-scan.spec.ts`：**全仓保真体检引擎**（`SOLO_FIDELITY_SCAN=1` / `bun run test:full` 才跑，日常不参与）。扫 `fixtures/` 真实用户文档，三条硬断言：ZWNJ 不出站 / 二轮收敛只降不升 / 变化签名棘轮。**动 parser/serializer/schema 必须显式跑它**，命令见 playbook §C。
- `__tests__/serializer-perf-guard.spec.ts`：序列化**复杂度护栏**（曾有 O(n²) 事故），防止再次退化。
- `__tests__/clipboard-serializer.spec.ts` / `__tests__/table-ops.spec.ts` / `__tests__/plugins.spec.ts`：clipboard 转义、表格操作、解析插件的定点回归。

> **跑哪些 / 什么时候跑，以 [playbook §C](./docs/agent-playbook.md) 为唯一真理源**（按改动半径分级）——本节只做「这些网存在，各自防什么」的索引，不重复维护跑法与耗时。

---

## 9. 命令系统

### 9.1 集中注册表 `commands/registry.ts`

所有命令在此**声明式定义**：`{ id, title, description, icon?, scope, group, defaultShortcut?, menuSection?, palette?, fixedShortcut? }`（字段以 `CommandDefinition` 接口为准）。提供查找/快捷键计算/冲突检测/Tauri accelerator 转换（`toTauriAccelerator`）等纯函数。

**谁消费它**（改字段前先想清楚这几处）：`CommandPalette.vue`（面板列表）、`Settings/useShortcutSettings.ts`（设置页改键 + 冲突检测）、`useAppDomEvents.ts`（全局 keydown 查表）、`useMenuShortcutsSync.ts`（同步原生菜单加速器）、`CustomTitlebar.vue`（按钮提示文案派生）。

（旧文档称 `utils/shortcuts.ts` 是 registry 的薄 re-export——**该文件已删除**，registry 内联了 `getShortcut`/`getShortcutCommands`。）

### 9.2 分发 `useCommandDispatcher`

```
来源(shortcut / menu / palette) → executeCommand(id, source)
   ├─ scope === 'editor'  → editorRef.executeCommand(id)  (快捷键需编辑器有焦点)
   └─ scope === 'app'     → switch(id) { ... 调对应 composable handler }
```

**单一入口**：原生菜单（`useMenuEvents`）与全局快捷键（`useAppDomEvents`）都汇流到 `executeCommand`。**状态栏按钮不走这条路**——`StatusbarQuickActions.vue` 直接调 `editorRef.getContent()` 写剪贴板（见 §10.2）。`edit.find`/`edit.replace` 虽是 app scope 但转发给编辑器。

---

## 10. 主题与导出

### 10.1 主题系统（色彩 + 排版双注入）

`themes/manager.ts::applyTheme(theme)` 做三件事：

1. **外观**：`applyDarkClass` 切 `<html>.dark`；同步原生窗口主题/背景色（失败静默）。
2. **色彩**：`injectColors` —— 按 `CSS_VAR_MAP`（types.ts）把 `ThemeColors` 字段写进 `--bg-color` / `--text-color` 等 CSS 变量。
3. **排版**：`injectTypography` —— **先全部 `removeProperty` 再注入** `--mk-*` 变量（`--mk-line-height` / `--mk-font-size-in-...` 等：`--mk-line-height` / `--mk-font-size` / `--mk-heading1~6-size` / `--mk-paragraph-spacing` / `--mk-letter-spacing` / `--mk-quote-border-width`）。

`editor.css` 的排版属性**已全部走 `var(--mk-*)` 消费**（不再硬编码；处数以 `grep -c "var(--mk-" editor.css` 为准）。所以"不同主题可定制不同排版"**已支持**——加一个主题只需在 JSON 里填 `typography` 字段。

**主题三层结构（2026-08-21 确立）**：
- **范式层**：`types.ts::CSS_VAR_MAP`（token 全集）+ `manager.ts::SHARED_LIGHT/DARK_COLORS`（共享默认值：功能色/圆角/markBg/btnGhostBg/modalOverlay）+ `editor.css :root` 排版默认值。
- **实例层**：**9 套 preset JSON**（`presets/`，数量以 `ls src/themes/presets` 为准）：`scholar-light` / `scholar-dark` / `elegant-light` / `cinnabar-light` / `cinnabar-dark` / `default-light` / `jade-light` / `orchid-light` / `graphite-light`（**部分文件名无后缀、但 JSON 内 `id` 均带 `-light`；无 `gray-domain`**——旧文档列 7 套已过时）。每套**只写性格差异字段**，共享值一律收进 `SHARED_LIGHT/DARK_COLORS`，禁止复制进各主题。
- **消费层**：所有渲染层只引用 `var(--x)`。

支持自定义主题 CRUD、导入导出、旧格式（light/dark 双色文件）迁移（`importTheme` 兼容现代与 legacy）。`applyTheme` 附带 `.theme-transitioning` 200ms + 编辑区 `triggerContentCrossfade` 220ms 淡入 + 透传到 localStorage `solo-theme-paint`。

### 10.2 状态栏复制按钮（v1.2.18 减法重构后）

> 原导出系统（HTML/PDF/微信，独立 IR 层 `buildExportTree` + HTML/Wechat 渲染器 + `wechat-themes.ts`）已于 v1.2.18 删除（净删 ~2500 行）。现以状态栏 Copy 按钮（`StatusbarQuickActions.vue`）替代，写**双槽**剪贴板：`text/plain` = **全量** Markdown 源码（`editorRef.getContent()` → `serializeMarkdown()`，即**文件模式严格转义**），`text/html` = 富文本（`tiptap/clipboard-html.ts` 直出 → `tiptap/externalize-html.ts` 归一；**编辑器不在时**（图片预览模式）回落到 `utils/markdown-to-html.ts::renderMarkdown`）。字体栈仍走 `buildFontStack` 与编辑器共享。
>
> **别混淆**：`serializeClipboardText()`（选区感知 / 轻量转义，见 docs/sensitive-areas.md §11.8）是**编辑器内 `Ctrl+C`** 的路径，**不是**状态栏按钮。
>
> **两条通道共用出站归一（2026-10-21）**：`text/html` 有两个入口，都进 `tiptap/externalize-html.ts`，只有档位（`ExternalizeTarget`）不同——
> - 状态栏按钮：`serializeDocumentHtml()` → 档位 `document`。删**全部** frontmatter、拆 `div.tableWrapper`（整篇出站、不回读，这样 Word / 公众号拿到的表格不带布局壳）。
> - 编辑器内 `Ctrl+C`：`editorProps.clipboardSerializer = createSelectionClipboardSerializer()` → 档位 `selection`。**只删第一块** frontmatter（Ctrl+A 整篇复制到公众号时 YAML 会显示在顶部；从中间选一段时它不在选区里，规则不误伤）、**永不拆 tableWrapper**（拆了顶层节点身份就变，而 `data-pm-slice` 是 PM 在归一层返回**之后**才打在「第一个顶层元素」上的，标记会落错对象、slice 还原错位）。
>
> **标题与图片的两处双向约定**：① callout 标题出站时**同时**写进 `data-title` 属性与正文首段（`<p data-solo-injected-title=""><strong>…</strong></p>`）——外部消费者只认正文，solo 只认属性；回读时 `markdown-paste.ts::stripInjectedCalloutTitles` 只删**带来源标记**的那一段。**判据必须是标记，不能是「首段加粗且文字等于标题」**：用户自己写的那一段在节点层完全同形，靠内容猜会把合法正文当标题删掉。② 图片 `src` 解析统一走 `image.ts::pickImageSrc`（`data-src` 优先、排除 `data:`/`blob:` 占位、相对/绝对择优、`//` 归一成 `https:`）——公众号 / 知乎 / 简书是懒加载图，只认 `src` 会写入空白占位或整张丢图。
>
> **内联样式是「层级」的唯一载体（2026-10-21）**：公众号剥掉全部 `class` / `<style>` / `id`，只留白名单内的行内 `style` ⇒ 屏幕上的标题梯度、段间距、代码底色**一条都过不去**，粘出来是一篇「结构完整但全篇同号字」的文章。所以归一层最后一步 `external-styles.ts::inlineReadingStyles()` 把阅读形态逐条内联到元素上（业界同一解法：doocs/md 用打补丁的 juice）。**两把尺子**：字号/行高/间距运行时读 `--mk-*`（主题与设置页写的就是这些，与屏幕同源）；颜色固定为 `EXTERNAL_TINT` 中性灰（外部无主题，跟主题走会把深色底带进白底文章）。**不许出现 `var(--…)`**（微信丢弃 CSS 变量），`external-styles.spec.ts` 锁住这条与「字重必须与 `editor.css` 一致」。

### 10.3 字体系统

- `constants/fonts.ts`：`FONT_OPTIONS`（**7 项**）：系统默认（`system-ui`）/ 微软雅黑 UI / 思源宋体(`NotoSerifSC-Regular.otf`) / 朱雀仿宋(`ZhuqueFangsong-Regular.ttf`) / 小赖字体(`XiaolaiSC-Regular.ttf`) / 霞鹜文楷 Lite(`LXGWWenKai-Regular.ttf`) / 汇文明朝(`Huiwen-mincho-Regular.otf`)。**有 `fileName` = 下载型字体；`undefined` = 系统字体**（`FontPopover` 与 `SettingsFontSelect` 共用此清单）。
- `utils/fontStack.ts`：`buildFontStack(primary)` —— 按字体类型生成带中文 fallback 的完整 font-family 栈，**编辑器与导出端共享**，消除两端不一致。
- `services/fontLoader.ts`：远程字体按需下载 + 文件系统缓存 + **CSS @font-face 注入（首选）** + 字节通道（兜底）。首选 `registerFontViaCss` 调 `toAssetUrl` 注入 `@font-face{src:url(asset://...)}`（浏览器内核直读磁盘，不走 CORS）；失败回退 `readFontBytes` IPC 取字节 → `new FontFace(family, bytes)` 同源加载。系统字体跳过，已加载缓存复用，加载中去重。
- 字体系统深度专题与踩坑总结见 [`docs/font-handling.md`](./docs/font-handling.md)（含 CORS 陷阱、资源错配、验证方法论、排查决策树）。

---

## 11. 关键约束（改前必读）

> **本安全网已独立成 [`docs/sensitive-areas.md`](./docs/sensitive-areas.md)**。
> 易错区速查表 + §11.1–§11.8 详解（含「为什么 / 改动铁律 / KNOWN-ISSUES 溯源」）全在那里。
> **改码前先去那里读对应行**——本文档只保留总览，安全网细节不在这里重复。

---

## 12. 三条横切机制（不属于任何一层，但影响多层）

> 2026-10-13 加入。这三条是**后期长出来的能力**：各自持有独立的持久化通道 / 全局开关 / 原生窗口通道，只在 §3 目录树里露个名字是不够的——改错会产生「界面上看不见的数据变化」，故单列一节。三者同样登记在 `docs/sensitive-areas.md` 速查表。

### 12.1 会话记忆：最近文件 + 阅读位置

**是什么**：重开 solo 能回到上次读到的位置，命令面板里有「最近文件」分组。

```
编辑器（滚动/切文件/关窗）  ──record_document_session(path, ratio?)──▶  Rust commands/session.rs
        ▲                                                                   │
        └──────────────────read_document_session()──────────────────────────┘
                                                                            ▼
                                             app_local_data_dir/session/document-session.json
```

- **通向处**：Rust `commands/session.rs`（读写都走「读全文 → 内存改 → 原子写回 tmp+rename」）｜前端 `services/tauri/session.ts`｜两条命令见 §4.2。
- **记什么**：`recentFiles`（上限 10，去重置顶）+ `readingPositions`（上限 50，按 `updated_ms` 淘汰最久未读）。滚动位置记**比例不记像素**（窗口尺寸变了比例仍成立）。
- **上限与容错**：比例 `clamp(0,1)`、非有限值丢弃；文件损坏/被手改 → 视为空状态重建、不报错；空路径（未命名文档）不记录。
- **并发语义（有意为之）**：多窗口写走 `spawn_blocking` 串行 + **最后一次为准**，不做跨进程锁——「少记一条最近文件」可接受，这份数据不值得弹框。
- **消费点（例外条款，见 §5.3）**：`CommandPalette.vue` 直接读（面板「最近文件」）、`MarkdownEditor.vue` 直接写/恢复（滚动记录 800ms 防抖 + 切文件/卸载 flush）。**这份数据刻意不进 Pinia**：它跨窗口、由 Rust 落盘、且读写都是一次性动作。

> ⚠️ **已知取舍**：`recentFiles` 只存路径字符串、**不校验文件是否还存在** ⇒ 用户删掉的文件仍会显示在面板里，点了才失败。要改就在**读取侧**过滤，别在写入侧加 IO。

### 12.2 大文档分档降级（`document-scale.ts`）

**是什么**：文档大到一定程度，自动让掉几个「锦上添花但很贵」的特性，保住输入手感。

| 档 | 门槛（字数，剔除 base64 图片后） | 行为 |
|---|---|---|
| `normal` | < 50 万 | 全功能 |
| `heavy` | ≥ 50 万 | 实时字数按打开时基线（状态栏显示约号 + 悬停说明）、代码块自动语言检测暂停、焦点模式段落淡化暂停、`<html>` 加 `doc-heavy` 类启用 `content-visibility` |
| `extreme` | ≥ 200 万 | 打开前需用户确认才进可编辑模式 |

- **分档由 `useDocumentSession.loadDocumentFromPath` 触发**（`countVisibleChars` → `resolveDocumentTier` → `setDocumentTier`），新建文档复位为 `normal`。
- **⚠️ 与 IME 的耦合**：`doc-heavy` 启用的 `content-visibility` 会干扰 WebView2 的组字光标矩形（IME 候选窗失锚变形，该问题 2026-09-24 已封存为「宿主行为、进程内不可达」）。**门槛下调 = 让更多文档暴露在已知风险下**，改 `HEAVY_DOC_CHARS` 前务必回读 `document-scale.ts` 头注释与 `docs/IME-CANDIDATE-WINDOW.md`。

### 12.3 Windows 原生窗口缩放（`native_resize.rs`）

**是什么**：Windows 上窗口边缘/四角的拖拽缩放不由前端完成，而是 Rust 创建的**原生子窗**负责。

- **为什么**：`decorations(false)+transparent+shadow` 下，tauri 的无边框缩放只留顶部一条命中带（左右下内缘全无）；前端 8 个透明 div 走 `startResizeDragging` 异步 IPC 存在竞态 ⇒ 「拉一次不动、连试几次才中」。
- **怎么做**：父窗上铺一个 `WS_CHILD` 覆盖子窗，用窗口区域镂空成边框（四边 ~8px、四角 12 逻辑像素，随 DPI 缩放），`WM_NCHITTEST` 直接返回 `HTLEFT/HTTOPLEFT/...`，`WM_NCLBUTTONDOWN` 转发父窗进入系统原生缩放模态循环——**零 JS、零 IPC、零竞态**。
- **后果**：`WindowResizeHandles.vue` **只在非 Windows 渲染**（`App.vue` 模板里有 `v-if="!isWindows"`）。改缩放相关前端代码前先确认平台。
- **守卫**：全屏 / 最大化时区域清空、命中穿透（tao 会移除父窗 `WS_SIZEBOX`）。
- **验收口径**：`#![cfg(target_os="windows")]` + 10 处 `unsafe`（Win32 子类化），**无法单测**；改动必须真机验：Windows + 100/125/150% 三档 DPI + 四角与四边拖拽 + 双击最大化 + Aero 吸附。文件头注释记有「v1 子类化父窗」的失败教训（静态扫描给了假绿灯，真实鼠标命中的是 WebView2 子窗）。

### 12.4 待收口的既有例外（记录在案，暂不改）

| 例外 | 现状 | 为什么不现在动 |
|---|---|---|
| **Shell 集成注册双入口** | `App.vue` watcher（设置变更时）与 `useAppWindowSession.setup()`（启动时）都会调 `registerShellNew` | 靠 Rust 侧 `association_is_current` 幂等兜住，重复调用不发 `SHChangeNotify`（无 Explorer 闪烁），**当前无用户可感缺陷**；收口到一处属纯整洁化，需回归 Windows 注册表行为，找单独一轮做 |

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
| 复制为 Markdown（源码） | `edit.copyAsMarkdown` | Mod+Shift+M |
| 焦点模式 | `view.focusMode` | Mod+Alt+F |
| 全屏 | `view.fullscreen` | Mod+Shift+F（mac）/ F11（win） |
| 大纲开合 | `view.toggleOutline` | Mod+/（可在设置中自定义） |
| 命令面板 | `view.commandPalette` | Mod+K（**固定键位，不可自定义**——防自锁） |
| 设置 | `settings.open` | Mod+, |

（Mod = macOS Cmd / 其它 Ctrl。**默认快捷键以 `registry.ts` 的 `defaultShortcut` 为唯一真相源**，可在设置中自定义（固定键位除外）；完整清单见 [`wiki/快捷键速查.md`](./wiki/快捷键速查.md)。）

---

## 附录 B：常见任务起点导航

| 我想改… | 从这里入手 |
|---|---|
| 编辑器行为 bug | `MarkdownEditor.vue` + 对应 `extensions/*.ts` |
| Markdown 保真度 | `parser.ts` / `serializer.ts` → 先看 `roundtrip.spec.ts` + `fixtures.spec.ts`（`KNOWN_FIDELITY_GAPS` 是已知缺口台账）；schema 侧的**正向契约锁**在 `schema-contract.spec.ts`（列表容器 / `code` 互斥 / 信息载体 attrs / **无 markdown 载体的 mark**）；**mark 的 markdown 载体全覆盖**在 `mark-delimiter-coverage.spec.ts`（schema marks ⟷ `markDelimiter()` case 名的全量集合比对，**新增 mark 漏接载体立刻红，无需先登记**） |
| 文件打开/保存 bug | `useDocumentSession.ts` + `commands/document.rs` |
| 菜单/快捷键行为 | `registry.ts` + `useCommandDispatcher.ts` + Rust `menu.rs` |
| 搜索/替换 | `useEditorSearch.ts` + `extensions/search-highlight.ts` + 搜索面板模板（`MarkdownEditor.vue`） |
| 主题/外观 | `stores/settings.ts` + `themes/manager.ts` + `editor.css` |
| 出站 HTML（复制全文） | `tiptap/clipboard-html.ts` + `tiptap/externalize-html.ts`（单一出口）+ `StatusbarQuickActions.vue`；`utils/markdown-to-html.ts` 仅为无编辑器时的回落 |
| 图片拖入/处理 | `editor-image-drop.ts` + Rust `commands/document.rs` + `services/tauri/asset.ts` |
| 字体 | `constants/fonts.ts` + `fontStack.ts` + `fontLoader.ts` + `useEditorAppearance.ts` |
| 启动开打 | Rust `lib.rs`（§4.5）+ `useAppWindowSession.ts` |
| IPC 新增命令 | `command-names.ts` 登记 + `services/tauri/` 封装 + Rust `commands/` 实现 + `lib.rs` 注册 + **`ARCHITECTURE.md` §4.2 表加一行**（机器锁会拦：漏改即红） |
| 最近文件 / 阅读位置 | Rust `commands/session.rs` + `services/tauri/session.ts` + `CommandPalette.vue` / `MarkdownEditor.vue`（§12.1） |
| 大文档降级 / 性能档位 | `components/Editor/document-scale.ts`（§12.2）；**改门槛前先读 IME 耦合那一段** |
| Windows 窗口缩放不灵敏 | Rust `native_resize.rs`（§12.3，**Win32 实操、不能单测，须真机验**） |

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
| Rust 命令 ~20 个 | 旧数量已过时；**当前命令数以 `lib.rs::generate_handler!` 为唯一真相源，勿在文档硬编码**（§4.2） |
| 快捷键表 / 发布清单列有「导出 HTML / PDF / 微信」 | **已移除**（v1.2.18）。复制走状态栏按钮（双槽：`text/plain` = Markdown 源码 + `text/html` = 富文本，见 §10.2），无导出命令；`utils/export/` 整个目录已删除 |
| 脏态用 `setContent` + `markUserEdit` 双函数（按 hasUserEdit 标志判定） | **A1 重构**：改为 `setContent`（仅基线）+ `syncEditedContent`（语义比对唯一真相源），`hasUserEdit`/`markUserEdit` 已废弃，见 §7.1 / docs/sensitive-areas.md §11.1 |
| composables 10 个 / `utils/shortcuts.ts` 存在 | **实际 12 个**；`utils/shortcuts.ts` **已删除**（registry 内联 `getShortcut`/`getShortcutCommands`） |
| `services/tauri/` 含 `event-names.ts`/`webview.ts`/`opener.ts`/`os.ts`/`window-state.ts` | **均不存在**。当前 12 个文件（数量以 `ls` 为准）：`client`/`command-names`/`document`/`session`/`window`/`dialog`/`clipboard`/`events`/`font`/`asset`/`update`/`store`，见 §3 / §5.3 |
| 窗口缩放靠前端透明 div（`WindowResizeHandles`） | **Windows 已改走原生子窗**（`src-tauri/src/native_resize.rs`），前端组件仅 macOS / 其他平台生效，见 §12.3 |
| 无「最近文件 / 阅读位置」 | **已实现**（`commands/session.rs` + `services/tauri/session.ts` + 2 条命令），见 §12.1 |
| 主题 7 套（含 `gray-domain`） | **实际 9 套**：`scholar-light`/`scholar-dark`/`elegant-light`/`cinnabar-light`/`cinnabar-dark`/`default-light`/`jade-light`/`orchid-light`/`graphite-light`，见 §10.1 |
| 编辑器扩展 14 个 | **已过时**：数量以 `editor-extensions.ts` 的 `createEditorExtensions` 返回数组为准（勿硬编码），见 §8.3 |
| Tauri 插件 6 个 | **实际 7 个**（多 `updater`，见 `autoCheckForUpdate`） |
| `proxy.rs` 定义 `detect_proxy_for_update` | **不存在 `proxy.rs`**；该命令定义在 `lib.rs`，见 §4.2 |
| 启动竞态两层缓冲 | **实际五类 managed state**：`StartupOpenRequests`/`PendingWindowPaths`/`LoadedWindows`/`FocusedWindow`/`CloseGuard`（前两者才是缓冲层），见 §4.5 |

> 若你发现本附录与代码不符，**以代码为准并更新本表**——这是这份文档保持可信的唯一方式。

---

## 开发命令速查

> 所有构建 / 开发 / 测试 / 清理命令以 **BUILD_GUIDE.md §8.5（常用命令速查）** 为唯一真理源，本文不再复述，避免命令与参数在两处漂移。

代码风格：Prettier（单引号/分号/尾逗号/2 空格/100 列/LF），ESLint（`no-explicit-any` 与 `no-unused-vars` 为 warn，`_` 前缀参数豁免，禁 `console.log` 但允许 `warn`/`error`）。
