# Solo v2 架构方案

> 减法设计 · 分级加载 · 极简极速

---

## 1. 核心哲学

**每个功能在启动路径上的权重，必须等于它在用户感知中的权重。**

- 不在启动路径上做的事，绝不在启动路径上做
- 每条 IPC 命令、每个插件、每个 watcher，都要回答一个问题：**用户看到窗口之前，你真的需要跑吗？**
- 答不出 = 砍掉或推迟

---

## 2. 启动管道（五级）

```
                                   用户双击
                                       │
                              ┌────────┴────────┐
                              │  阶段 0          │
                              │  <head> 内联     │  < 1ms
                              │  主题恢复 + 背景  │
                              └────────┬────────┘
                                       │
                              ┌────────┴────────┐
                              │  阶段 1          │
                              │  Rust run()      │  < 50ms
                              │  · env proxy     │
                              │  · CLI 参数      │
                              │  · 插件注册      │
                              └────────┬────────┘
                                       │
                              ┌────────┴────────┐
                              │  阶段 2          │
                              │  Rust setup()    │  < 150ms
                              │  · State 容器    │
                              │  · 菜单建一次    │
                              │  · WebView 创建  │
                              │  · 事件挂载      │
                              │  ✗ 端口探测      │
                              │  ✗ window.show() │
                              └────────┬────────┘
                                       │
                              ┌────────┴────────┐
                              │  阶段 3          │
                              │  Vue mount       │  < 200ms
                              │  · createApp     │
                              │  · Pinia         │
                              │  · settings L1   │
                              │    (theme/bg)    │
                              │  · startupReady  │
                              │    → window.show │
                              │                  │
                              │  ─── 用户看到窗口 ───
                              └────────┬────────┘
                                       │
                  ┌────────────────────┼────────────────────┐
                  │                    │                    │
          ┌───────┴───────┐  ┌────────┴────────┐  ┌───────┴───────┐
          │  阶段 4       │  │  阶段 5         │  │  阶段 6       │
          │  onMounted    │  │  操作触发        │  │  空闲后台      │
          │  · settingsL2 │  │  · 端口探测      │  │  · 字体缓存    │
          │  · 编辑器创建  │  │    (首次网络请求) │  │  · remote      │
          │  · 快捷键同步  │  │  · 自动更新      │  │    image 预取  │
          │  · 事件挂载   │  │    (手动触发)    │  │               │
          │  < 100ms      │  │                 │  │               │
          └───────────────┘  └─────────────────┘  └───────────────┘
```

---

## 3. IPC 合并

### 3.1 图片链路（当前 → 目标）

**当前：**
```
markdown src ("xxx.png")
  → resolveDocumentImagePath / resolveStorageImagePath (IPC #1)
    → authorizeImageAsset (IPC #2)
      → toAssetUrl (前端转换)
        → image.src = asset:// URL
```

**目标 — 单个命令：**
```rust
#[tauri::command]
fn resolve_image_display(
    document_path: String,   // 文档路径（文档相对路径时用）
    storage_dir: String,     // 存储目录（storage 模式时用）
    src: String,             // markdown 里的 src
) -> Result<String>          // 直接返回 asset:// URL
```

- Rust 内部分辨用哪个路径、做 canonicalize、authorize、返回 `asset://` URL
- 前端一次调用，没有中间态，不需要 data attr 去重
- 旧版 `asset://` URL 的直接传回自身

### 3.2 其他合并候选

| 当前 | 目标 |
|------|------|
| `save_clipboard_image` + `authorize_image_asset` | `save_clipboard_image` 内部调用 authorize |
| `import_document_image` + `authorize_image_asset` | `import_document_image` 内部调用 authorize |
| 每次 `syncView` 单独调 resolver | 编辑器层批量解析（`resolve_image_batch`） |

---

## 4. 缓存策略（单一路径）

废除所有零散缓存，统一到一个地方：

```
Rust 侧:  LazyCell<Client>        ← 网络客户端（含 proxy）
          LazyCell<HashSet<Path>>  ← 已授权的 asset 路径

前端侧:  Node 级不用缓存          ← 全靠 displayRequestId 去重
         settings 用 Pinia state   ← 已经是响应式
```

**删除的缓存/去重：**
- `image.dataset.prevRemoteSrc` — 不需要，`displayRequestId` 已覆盖
- `image.dataset.prevLocalSrc` — 同上
- `image.dataset.prevAssetSrc` — 同上
- `remoteImageCache` Map 里 pending/fulfilled 区分 — 简化
- `blobUrlRegistry` — 保持，但只由 `getRemoteImageDisplaySrc` 管理

---

## 5. 设置分级加载（Settings L1/L2）

```
L1 (阶段 3，同步可读):
  activeThemeId
  imageStoragePath          ← 启动就需要用于图片解析

L2 (阶段 4，异步加载):
  fontFamily, fontSize
  spellCheck, alwaysOnTop
  enableAutoUpdateCheck
  ... 其余全部
```

实现方式：Pinia store 的 `init()` 拆成 `initL1()` 和 `initL2()`。

---

## 6. 菜单策略

| 位置 | 操作 | 策略 |
|------|------|------|
| `setup()` | `app.set_menu(menu)` | 建一次，带默认快捷键 |
| `syncMenuShortcuts()` | 对比新旧 shortcuts | 不同才重建，相同直接跳过 |
| `refreshNativeMenuShortcuts` | Rust 命令 | 改为只更新 MenuItem 的 accelerator，不重建 |

---

## 7. 拖拽事件注册（去除双注册）

当前：
- `App.vue` 注册全局 drag/drop 拦截（防止导航）
- `MarkdownEditor.vue` 注册 Tauri `subscribeDragDrop` 事件（文件拖入）
- `useAppWindowSession` 又注册一次 `subscribeDragDrop`（.md 文件拖入打开）

**目标：**
- `App.vue` 只注册全局 drag/drop 拦截
- `MarkdownEditor.vue` 只注册图片拖入
- `useAppWindowSession` 只注册 .md 拖入打开
- **共用一个 Tauri 事件订阅**，在前端按 src 分发

---

## 8. 默认配置变更

| 配置 | 当前 | 目标 | 理由 |
|------|------|------|------|
| `enableAutoUpdateCheck` | `true` | `false` | 启动不触发网络请求 |
| 自动更新 | 默认启用 | 用户手动触发 | 见上 |

---

## 9. 目录结构（v2）

```
solo-v2/
├── ARCHITECTURE.md
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   └── src/
│       ├── main.rs           ← 五级启动管道
│       ├── commands/
│       │   ├── document.rs   ← 文档读写、图片（合并后）
│       │   ├── image.rs      ← fetch_remote_image
│       │   └── font.rs       ← 字体（OnceLock 保留）
│       ├── proxy.rs          ← 延迟初始化，首次网络请求时探测
│       ├── menu.rs           ← 一次构建，diff 更新
│       ├── models.rs
│       ├── error.rs
│       └── state.rs
├── src/
│   ├── main.ts
│   ├── App.vue               ← 分级挂载
│   ├── assets/styles/
│   ├── stores/
│   │   └── settings.ts       ← L1/L2 拆分
│   ├── components/
│   │   └── Editor/
│   │       ├── MarkdownEditor.vue
│   │       └── tiptap/
│   │           ├── extensions/
│   │           │   └── image.ts    ← 精简：无 data attr 去重
│   │           ├── markdown-paste.ts
│   │           └── editor-image-drop.ts
│   ├── composables/
│   │   └── useExportActions.ts
│   ├── services/
│   │   └── tauri/
│   │       ├── document.ts   ← 合并后命令
│   │       └── command-names.ts
│   └── utils/
└── index.html
```

---

## 10. 改造顺序

| # | 内容 | 风险 | 门 |
|---|------|------|----|
| 1 | 脚手架：Cargo.toml + tauri.conf.json + main.ts + App.vue 骨架 | 低 | 能编译、能显示白窗口 |
| 2 | 启动管道：Rust 五级 + frontend L1/L2 分级 | 中 | 从双击到窗口可见 < 800ms（纯本地，无网络） |
| 3 | IPC 合并：resolve + authorize → resolve_image_display | 中 | 图片粘贴/拖入/打开均正常 |
| 4 | 缓存清理：删除 data attr 去重 + 简化 remoteImageCache | 低 | 图片显示无回归 |
| 5 | 菜单优化：一次构建 + diff 更新 | 低 | 快捷键可配、菜单可点 |
| 6 | 拖拽去重：统一 Tauri 事件，前端按 src 分发 | 低 | .md 拖入打开 + 图片拖入正常 |
| 7 | 默认关闭自动更新 | 低 | 改一行 |
| 8 | 集成测试补全：Rust 命令 + IPC 契约 | 中 | 核心链路覆盖 |

---

## 11. 不做的（保持原样）

| 模块 | 理由 |
|------|------|
| Tiptap 核心编辑器 | 依赖太深，重写不值，只用精简扩展 |
| Markdown 解析器（parser.ts） | 无性能问题，且已做过 CJK 优化 |
| KaTeX / Mermaid 渲染 | 第三方库，不归我们管 |
| 导出渲染器（export-renderer） | 偶尔用，不影响核心体验 |
| 窗口状态（window_state 插件） | Tauri 插件，启动读一次 size/position 没问题 |
| 主题系统 | 已做过 theme-paint 优化，无冗余 |
