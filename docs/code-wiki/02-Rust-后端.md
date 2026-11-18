---
title: 代码维基 · Rust 后端
type: guide
audience: dev
status: active
tags: [code-wiki, rust, tauri, 命令, 状态, 错误模型, 窗口]
summary: Rust 核心的模块职责、命令清单、managed state、DTO/错误模型、启动竞态、关窗链与关键函数
updates: [src-tauri/src/lib.rs, src-tauri/src/commands/, src-tauri/src/state.rs, src-tauri/src/models.rs, src-tauri/src/error.rs, src-tauri/src/events.rs]
---

# 02 · Rust 后端

> 命令清单的机器锁在 `src/__tests__/arch-drift.spec.ts`：本页表格与 `lib.rs::generate_handler!` 双向比对。新增命令必须四处同步：实现 → `commands/mod.rs` → `generate_handler!` → `ARCHITECTURE.md §4.2`。

---

## 1. 模块职责

| 文件 | 职责 |
|---|---|
| `main.rs` | 进程入口：准备独立 WebView2 用户数据目录，调用 `solo_lib::run()`；退出后清理 |
| `lib.rs` | 应用装配：插件、setup、菜单、启动开打、窗口创建、命令注册、更新代理检测 |
| `state.rs` | 5 类 managed state：启动请求、待打开路径、已加载窗口、焦点窗口、关窗看门狗 |
| `models.rs` | 所有 IPC DTO，统一 `camelCase`；`AppOpenSource` 用 `kebab-case` |
| `error.rs` | `AppError` 五变体 + 稳定错误码 + 自定义 `Serialize` |
| `events.rs` | 定向事件常量与 `emit_to` 辅助（`menu-event` / `window-close-requested`） |
| `menu.rs` | 原生菜单构建、菜单事件、快捷键更新（只 `set_accelerator`，不重建菜单） |
| `updater.rs` | 更新代理检测（环境变量 / 注册表 / 常见端口探测） |
| `native_resize.rs` | Windows 原生边缘缩放子窗（Win32 子类化，不能单测） |
| `commands/document.rs` | 文档打开/保存/改名/互链同步/图片导入/资产授权 |
| `commands/session.rs` | 最近文件与阅读位置持久化 |
| `commands/image.rs` | 远程图片下载与磁盘缓存清理 |
| `commands/font.rs` | 字体下载、缓存路径、缓存写入、字节读取 |
| `commands/clipboard.rs` | 绕开 WebView 读取系统剪贴板 HTML |
| `commands/window.rs` | 窗口关闭链、应用退出、背景色、内存档位 |
| `commands/desktop.rs` | Windows 右键「新建 Markdown」注册/注销 |

---

## 2. 命令清单

> 数量以 `lib.rs::generate_handler!` 为准，不在文档里硬编码。下表按领域分组，覆盖当前注册的全部命令。

### 2.1 文档与图片（`commands/document.rs`）

| 命令 | 前端封装 | 职责 |
|---|---|---|
| `open_document` | `document.ts::openDocument` | 校验扩展名，读 UTF-8/UTF-16 内容，返回路径与 mtime |
| `save_document` | `document.ts::saveDocument` | 原子写（tmp + rename）+ mtime 冲突检测 |
| `get_file_mtime` | `document.ts::getFileMtime` | 读取文件修改时间（互链跳转前存在性检查） |
| `reveal_document_in_folder` | `document.ts::revealDocumentInFolder` | 在系统文件管理器中定位当前文档（先查存在性，再调 `opener.reveal_item_in_dir`） |
| `list_markdown_files` | `document.ts::listMarkdownFiles` | 扫描当前文档目录树，返回 `.md` 相对路径；`truncated` 表示清单可能不完整 |
| `rename_file` | `document.ts::renameFile` | 去后缀、防冲突、大小写敏感的重命名 |
| `sync_wikilinks_on_rename` | `document.ts::syncWikilinksOnRename` | 改名后同步「指向本文档」的 `[[旧名]]`，返回被改写文件的绝对路径 |
| `import_document_image` | `document.ts::importDocumentImage` | 把外部图片复制到 `assets/`，同名自动加后缀 |
| `save_clipboard_image` | `document.ts::saveClipboardImage` | data URL → base64 解码 → 写入 `assets/` |
| `authorize_image_asset` | `document.ts::authorizeImageAsset` | 把图片加入 asset 协议作用域，含安全校验 |
| `resolve_image_display` | `document.ts::resolveImageDisplay` | 判别 storage/相对/绝对路径，并一步完成授权 |

### 2.2 远程图片（`commands/image.rs`）

| 命令 | 前端封装 | 职责 |
|---|---|---|
| `fetch_remote_image` | `document.ts::fetchRemoteImageData` | 下载远程图片到 `remote-image-cache/`，返回缓存路径 |

约束：单张 ≤ 10MB；缓存总量 ≤ 200MB，超限按 mtime 从旧到新淘汰；启动时后台清理，近期写入有 10 分钟宽限。

### 2.3 字体（`commands/font.rs`）

| 命令 | 前端封装 | 职责 |
|---|---|---|
| `fetch_font_data` | `font.ts::fetchFontData` | 下载字体并写入 `font-cache/`，返回缓存路径 |
| `get_cached_font_path` | `font.ts::getCachedFontPath` | 查询已缓存字体路径 |
| `save_font_cache` | `font.ts::saveCachedFont` | 把字体字节写入缓存 |
| `read_font_bytes` | `font.ts::readFontBytes` | 通过 IPC 读取字体字节（CSS `@font-face` 失败后的兜底） |

约束：单文件 ≤ 32MB；缓存文件名必须与 `FONT_OPTIONS.fileName` 一致；阻止 `../` 路径逃逸。

### 2.4 剪贴板与会话

| 命令 | 前端封装 | 职责 |
|---|---|---|
| `read_clipboard_html` | `clipboard.ts::readClipboardHtml` | 从系统剪贴板读取 HTML 富文本 |
| `record_document_session` | `session.ts::recordDocumentSession` | 记录最近文件（去重置顶）与可选阅读比例 |
| `read_document_session` | `session.ts::readDocumentSession` | 读取最近文件与阅读位置 |

### 2.5 窗口与生命周期

| 命令 | 前端封装 | 职责 |
|---|---|---|
| `startup_ready` | `window.ts::startupReady` | 前端就绪信号：显示窗口 + 回放启动开打请求 |
| `new_editor_window` | `window.ts::newEditorWindow` | 创建新编辑器窗口（label 原子递增） |
| `refresh_native_menu_shortcuts` | `window.ts::refreshNativeMenuShortcuts` | 自定义快捷键同步到原生菜单 |
| `reveal_startup_open_log` | `window.ts::revealStartupOpenLog` | 返回启动开打日志路径，供排查 |
| `request_app_quit` | `window.ts::requestAppQuit` | 向所有已加载窗口发关闭请求，全部关闭后退出 |
| `report_window_close` | `window.ts::reportWindowClose` | 前端回报关闭链状态：`ack` / `abort` |
| `set_window_background_color` | `window.ts::setCurrentWindowBackgroundColor` | 设置窗口背景色（macOS 走 NSColor） |

### 2.6 桌面集成与更新

| 命令 | 前端封装 | 职责 |
|---|---|---|
| `register_shell_new` | `window.ts::registerShellNew` | Windows 右键「新建 Markdown」注册（幂等） |
| `unregister_shell_new` | `window.ts::unregisterShellNew` | 注销右键菜单 |
| `detect_proxy_for_update` | `update.ts::checkUpdateAvailability` | 检测系统代理供更新使用（定义在 `lib.rs`，没有 `proxy.rs`） |

---

## 3. Managed State

`lib.rs::setup` 逐个 `app.manage(...)`：

| 类型 | 作用 | 关键方法 |
|---|---|---|
| `StartupOpenRequests` | setup 阶段收到的启动开打请求（单 payload，可合并去重） | `merge(payload)` / `take()` |
| `PendingWindowPaths` | 新窗口创建时按 label 暂存的待打开路径 | `insert(label, payload)` / `take(label)` |
| `LoadedWindows` | 已加载完成的前端窗口 label 集合 | `mark_loaded` / `remove` / `contains` |
| `FocusedWindow` | 当前焦点窗口 label，用于菜单事件定向 | `set` / `clear` / `get` |
| `CloseGuard` | 每窗口一条待处理关闭请求的看门狗 | `evaluate(label, grace)` / `clear(label)` |

`startup_ready` 的查找顺序：先查 `PendingWindowPaths`（新窗口专属），没有则回退 `StartupOpenRequests`（主窗口启动请求）。

---

## 4. 错误模型

```rust
pub enum AppError {
    Validation(String), // validation_error
    Conflict(String),   // document_conflict
    Io(String),         // io_error
    Network(String),    // network_error
    Native(String),     // native_error
}
```

- 自定义 `Serialize` 输出 `{ code, message }`。
- 实现 `From<io::Error>` / `From<reqwest::Error>` / `From<tauri::Error>`，命令里可直接 `?`。
- 前端 `normalizeTauriError()` 兼容字符串、结构化对象、`Error` 实例；`withErrorHint()` 只在展示层给 Windows `os error N` 补操作建议，**不改变原始错误码匹配**。

---

## 5. DTO

| 结构 | 字段 | 备注 |
|---|---|---|
| `DocumentOpenResult` | `path` / `content` / `lastModifiedMs` | camelCase |
| `DocumentSaveResult` | `path` / `lastModifiedMs` | camelCase |
| `DocumentImageImportResult` | `relativePath` / `absolutePath` | camelCase |
| `ImageAssetAuthorizationResult` | `path` | camelCase |
| `DocumentRenameResult` | `path` | camelCase |
| `MarkdownFileList` | `files` / `truncated` | `truncated` 是正确性字段，不是提示 |
| `AppOpenPathsPayload` | `paths` / `source` | `source` 为 kebab-case：`cli` / `os-open` / `new-window` |

---

## 6. 事件

### 6.1 Rust 发出的定向事件

| 事件名 | 方向 | 载荷 | 发送点 |
|---|---|---|---|
| `menu-event` | Rust → 当前窗口 | 菜单项 id | `menu.rs` |
| `window-close-requested` | Rust → 被关窗口 | `()` | `commands/window.rs` |
| `solo:editor-focus` | Rust → 当前窗口 | `()` | `commands/window.rs`（窗口获得焦点） |
| `solo:editor-blur` | Rust → 当前窗口 | `()` | `commands/window.rs`（窗口失去焦点） |

**只能用 `emit_to(window.label(), ...)`**。Tauri 2 的 `Emitter::emit` 是全局广播，`window.emit(...)` 名字像定向、行为却是广播；历史上曾导致「关 B 窗口把 A 也关掉」。回归锁：`src/__tests__/event-dispatch-target-lock.spec.ts`。

### 6.2 前端跨窗口广播

| 事件名 | 语义 | 消费方行为 |
|---|---|---|
| `solo:wikilinks-synced` | 别的窗口改名后改写了这些文档 | 若正开着被改文件 → 提示/重载 |
| `solo:file-renamed` | 文档换了路径 | 只跟随路径，**不重载内容** |

这两条由前端 `emit` 全局广播，因为改动方与受影响方不是同一个窗口，定向事件到不了。

---

## 7. 启动竞态处理

「前端还没 ready 就来了开文件请求」是真实竞态，缓冲层是 5 类 state：

```
CLI / OS-open / NewWindow
        │
        ▼
StartupOpenRequests / PendingWindowPaths
        │  前端 startup_ready
        ▼
emit 回放 → 前端 useAppWindowSession 打开文档
```

- 所有过程写 `startup-open.log`；`reveal_startup_open_log` 可定位。
- 窗口先 `visible(false)`，前端 ready 后 `show()`，避免黑闪。
- 新窗口路径按 label 独立存放，避免主窗口请求被新窗口抢走。

---

## 8. 关窗链与退出

### 8.1 单窗口关闭

```
用户点 X / Alt+F4
  → Rust WindowEvent::CloseRequested
  → CloseGuard.evaluate(label, 3s)
      ├─ Prompt  : prevent_close + emit window-close-requested
      ├─ Waiting : prevent_close（确认框已在屏上，吞掉重复请求）
      └─ Force   : 放行原生关闭（前端 JS 线程疑似被占死）
  → 前端 handleCloseRequest()
      → reportWindowClose('ack')（fire-and-forget，必须先发）
      → 停自动保存 → flush 设置 → flush 阅读位置
      → 脏态确认（save / discard / cancel）
      → 需要则保存
      → 保存窗口状态
      → destroyCurrentWindow()
```

- `ack` 必须在序列化之前发出；否则大文档把 JS 线程占死，Rust 等不到应答。
- 关闭链异常时发 `abort`，让 `CloseGuard` 复位，避免窗口「再也关不掉」。
- 标题栏 X 先走原生 `closeCurrentWindow()`；失败回退前端关闭链；再失败才 `destroyCurrentWindow()`。

### 8.2 应用退出

`request_app_quit` 向所有已加载窗口定向发 `window-close-requested`，每个窗口各自确认/保存后关闭，全部关闭后进程自然退出。它不是强杀进程，避免多窗口丢未保存内容。

---

## 9. 关键函数

### 9.1 文档

| 函数 | 作用 |
|---|---|
| `read_text_file(path)` | 读取 UTF-8 / UTF-16（含 BOM），编码不支持时返回可操作的中文错误 |
| `validate_document_extension(path, allowed, action)` | 打开/写入前校验扩展名，拒绝非文档文件 |
| `collect_markdown_files(root, budget)` | 目录树扫描 `.md`，浅层优先，受文件数与目录数双闸门限制 |
| `save_document(...)` | 原子写 + mtime 冲突检测；写前清理陈旧 tmp |
| `rename_file(old_path, new_name)` | 改名并防目标已存在；大小写敏感 |
| `sync_wikilinks_on_rename(...)` | 扫改名文档本层 + 向上两层，按各层真实写法改写互链 |
| `rewrite_wikilink_targets` / `replace_targets_in_line` | 只改目标部分，保留别名/锚点等写法 |
| `import_document_image` / `save_clipboard_image` | 图片落盘到 `assets/`，同名自动加后缀 |
| `parse_data_url` | 拆分 MIME 与 base64，拒绝非法 data URL |
| `authorize_image_asset` / `resolve_image_display` | 路径判别 + 授权；`resolve_image_src` 处理相对/绝对/storage |
| `validate_image_asset_path` | 规范化 + 符号链接解析，阻止越界读取 |

### 9.2 会话与缓存

| 函数 | 作用 |
|---|---|
| `record_document_session` | 读全文 → 内存改 → 原子写回；最近文件去重置顶、阅读位置按时间淘汰 |
| `read_document_session` | 损坏/被手改时视为空状态重建，不报错 |
| `session_file(app)` | `app_local_data_dir/session/document-session.json` |
| `fetch_remote_image` | 下载 + 类型/大小校验 + URL 哈希命名缓存 |
| `cleanup_remote_image_cache` | 启动后台清理，按 mtime 淘汰，保留近期写入 |
| `fetch_font_data` / `save_font_cache` / `read_font_bytes` | 字体缓存读写，全部限制在 `font-cache/` 内 |

### 9.3 窗口与菜单

| 函数 | 作用 |
|---|---|
| `attach_window_events(window, app)` | 挂 `CloseRequested` / `Focused` / `Destroyed` 三类窗口事件 |
| `evaluate_close_request(handle, label)` | 返回 `Prompt` / `Waiting` / `Force` |
| `request_app_quit(app)` | 应用级退出：逐窗口发关闭请求 |
| `report_window_close(window, phase)` | 前端回报 `ack` / `abort`，驱动看门狗状态 |
| `setup_menu(app)` / `attach_menu_events(app)` | 构建原生菜单、绑定菜单项事件 |
| `update_menu_shortcuts(app, shortcuts)` | 只更新 accelerator，不重建菜单 |
| `create_editor_window(app, path)` | 创建窗口、记录待打开路径、挂事件、启动显窗看门狗 |

---

## 10. 关键常量

| 常量 | 值 | 文件 |
|---|---|---|
| `OPEN_EXTENSIONS` | `md` / `markdown` / `txt` | `commands/document.rs` |
| `WRITE_EXTENSIONS` | `md` / `markdown` / `txt` / `json` | `commands/document.rs` |
| `IMAGE_EXTENSIONS` | png/jpg/jpeg/gif/webp/svg/bmp/ico | `commands/document.rs` |
| `WIKILINK_SCAN_DEPTH` | 2 | `commands/document.rs` |
| `WIKILINK_SCAN_LIMIT` | 500 | `commands/document.rs` |
| `WIKILINK_SCAN_MAX_DIRS` | 2000 | `commands/document.rs` |
| `MAX_REMOTE_IMAGE_BYTES` | 10 MB | `commands/image.rs` |
| `MAX_REMOTE_IMAGE_CACHE_BYTES` | 200 MB | `commands/image.rs` |
| `RECENT_CACHE_GRACE` | 10 分钟 | `commands/image.rs` |
| `MAX_FONT_BYTES` | 32 MB | `commands/font.rs` |
| `RECENT_FILES_LIMIT` | 10 | `commands/session.rs` |
| `POSITIONS_LIMIT` | 50 | `commands/session.rs` |
| `CLOSE_ACK_GRACE` | 3 秒 | `commands/window.rs` |

> 改这些值前先确认下游：互链扫描上限影响「死链标红」的正确性，图片/字体上限影响用户可感知的失败提示，`CLOSE_ACK_GRACE` 影响关窗逃生舱。

---

## 11. 平台差异

| 平台 | 差异 |
|---|---|
| Windows | 原生边缘缩放（`native_resize.rs`）；WebView2 失焦降内存档位；右键「新建 Markdown」注册表 |
| macOS | 窗口背景色走 NSColor；`RunEvent::Opened` 处理 Finder 打开文件；`WindowResizeHandles.vue` 生效 |
| 其他 | 无原生缩放子窗，使用前端缩放把手 |
