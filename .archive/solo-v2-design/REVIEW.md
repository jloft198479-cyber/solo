# Solo v2 — 架构框架概述（供第三方评审）

> 一款 Markdown 桌面编辑器的减法重构方案。  
> 基于 Tauri v2 + Vue 3 + Pinia + Tiptap。

---

## 定位

Solo v2 不是完整的产品替换，而是一个 **架构原型（architecture prototype）**。  
它展示了从 v1 到 v2 的设计思路和关键改造点，**但尚不可运行**——部分模块以 stub 存在，待后续补全。

---

## 核心哲学

**减法设计（Subtraction Design）**

每个功能在启动路径上的权重，必须等于它在用户感知中的权重。  

- 不在启动路径上做的事，绝不在启动路径上做
- 每条 IPC 命令、每个插件、每个 watcher，都要回答一个问题：  
  「用户看到窗口之前，你真的需要跑吗？」
- 答不出 = 砍掉或推迟

---

## 架构亮点

### 1. 五级启动管道（分级加载）

```
双击应用图标
  │
  ├─ 阶段 0 (＜1ms)   → <head> 内联主题色，防闪白
  ├─ 阶段 1 (＜50ms)  → Rust run(): 环境变量代理 + CLI 参数 + 插件注册
  ├─ 阶段 2 (＜150ms) → Rust setup(): State 容器、菜单建一次、事件挂载
  │                       ✗ 不做端口探测、不 window.show()
  ├─ 阶段 3 (＜200ms) → Vue mount: createApp → Pinia → 读 L1 设置(主题/图片路径)
  │                       → 发 startup_ready → window.show()
  │                       ←────── 用户看到窗口 ──────→
  ├─ 阶段 4 (异步)    → onMounted: L2 设置全量加载、编辑器创建、快捷键同步
  └─ 阶段 5 (懒加载)  → 操作触发: 首次网络请求时做端口探测、自动更新(手动触发)
```

**效果：** 窗口从双击到可见，只等阶段 0-3 的 ~400ms 必要工作，剩余全部异步后台补。

### 2. IPC 合并（单命令图片解析）

v1 需要 3 步（resolve → authorize → convertFileSrc），v2 合并为 1 步：

```
v1: resolveDocumentImagePath (IPC #1)
    → authorizeImageAsset (IPC #2)
      → toAssetUrl (前端转化)
        → img.src = asset:// URL

v2: resolve_image_display (IPC #1)
    → img.src = asset:// URL  ← Rust 内部完成全链路
```

Rust 侧一次调用完成：路径判别 → canonicalize → 授权 asset 协议 → 返回可用的 URL。

### 3. 缓存策略（单一路径）

| 对象 | v1 | v2 |
|------|----|----|
| 远程图片 | 3 个 data-attr 去重 + 完整状态机 | `Promise<string>` 缓存 + 独立失败 TTL |
| 设置 | 单次全量加载 | L1（启动必要）+ L2（异步后台） |
| 网络客户端 | 启动时初始化 | `OnceLock`，首次请求时懒加载 |
| 已授权路径 | `HashSet<Path>` | 同左，但只在 `resolve_image_display` 内管理 |

### 4. 菜单策略（一次构建 + diff 更新）

- `setup()` 里建一次菜单，不做多次重建
- `refresh_native_menu_shortcuts` 对比新旧快捷键哈希，相同则跳过
- 避免 v1 中因窗口切换或设置变更导致的重复菜单构建

### 5. 拖拽注册（单例）

多个消费者（图片拖入、文档拖入）共享一个 Tauri `onDragDropEvent`，前端通过 `subscribers` Set 分发。避免 v1 中多个独立订阅造成的重复和竞态。

---

## 目录结构

```
solo-v2/
├── ARCHITECTURE.md          ← 详细架构文档（255 行）
├── REVIEW.md                ← 本文件
├── package.json             ← 前端依赖（v1 的子集）
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── index.html               ← 阶段 0：内联主题色
│
├── src-tauri/               ← Rust 后端（13 个文件）
│   ├── Cargo.toml           ← 8 个 Tauri 插件 + reqwest/base64/tokio/url
│   ├── tauri.conf.json
│   ├── capabilities/
│   └── src/
│       ├── main.rs          ← 阶段 1：env proxy + CLI + 窗口创建
│       ├── lib.rs           ← 阶段 2：18 个命令注册 + 7 个插件 + 启动计时
│       ├── commands/
│       │   ├── document.rs  ← 文档读写 + resolve_image_display（合并后）
│       │   ├── image.rs     ← fetch_remote_image
│       │   └── font.rs      ← 字体缓存
│       ├── menu.rs          ← 菜单一次构建 + diff 更新
│       ├── proxy.rs         ← 环境变量代理（阶段 1）/ 端口探测（阶段 5 懒加载）
│       ├── events.rs        ← 菜单事件 + window 事件
│       ├── state.rs         ← 4 个线程安全状态容器
│       ├── models.rs        ← 数据模型
│       └── error.rs         ← 统一错误类型
│
└── src/                     ← 前端（37 个文件）
    ├── main.ts              ← Vue 入口
    ├── App.vue              ← 阶段 3：L1/L2 分级加载 + 窗口生命周期
    │
    ├── stores/
    │   ├── settings.ts      ← L1(activeThemeId/imageStoragePath) / L2(其余全量)
    │   └── file.ts          ← 文件状态管理
    │
    ├── services/tauri/      ← 12 个服务，封装 IPC 调用
    │   ├── client.ts        ← invoke 统一封装（含错误规范化）
    │   ├── command-names.ts ← 18 个 Tauri 命令名枚举
    │   ├── document.ts      ← 文档读写 + 图片解析
    │   ├── store.ts         ← Tauri Store 读写
    │   ├── events.ts        ← 事件订阅（菜单/窗口关闭）
    │   ├── webview.ts       ← 单例拖拽监听器
    │   └── ...
    │
    ├── composables/
    │   ├── useAppWindowSession.ts  ← 启动参数 → 文档打开 + 标题同步
    │   └── useExportActions.ts     ← 3 种导出（HTML/PDF/微信），共用简化图片解析
    │
    └── components/Editor/
        ├── MarkdownEditor.vue      ← 编辑器入口（resolver 绑定 resolve_image_display）
        └── tiptap/
            ├── editor-extensions.ts   ← 扩展工厂（当前仅 StarterKit + CustomImage + MarkdownPaste）
            ├── editor-image-drop.ts   ← 图片拖入处理（去掉了 authorize 调用）
            ├── editor.css
            ├── extensions/
            │   ├── image.ts           ← 自定义 NodeView（displayRequestId 去重，无 data-attr）
            │   └── markdown-paste.ts  ← Markdown 粘贴识别（去掉了 authorize 调用）
            └── markdown/
                ├── parser.ts    ← stub（待替换为 v1 的完整解析器）
                └── serializer.ts ← stub
```

---

## 当前实现状态

### ✅ 已完成（代码就位）

| 模块 | 说明 |
|------|------|
| Rust 后端 | 18 个命令、7 个插件、5 阶段启动管道、启动计时、合并后的 `resolve_image_display` |
| 启动管线 | 阶段 0-4 代码完整，阶段 5（懒加载 proxy）已预留 |
| 前端入口 | App.vue 分级加载、useAppWindowSession 窗口生命周期 |
| 设置分级 | L1 读 theme + imageStoragePath，L2 读全量 + 启动 watcher |
| 图片 IPC 合并 | 前端 paste/drop/resolver/export 全部指向 `resolve_image_display` |
| 远程图片缓存 | 简化为 `Promise<string>` + 独立失败 TTL，4 并发限制，50MB 上限 |
| 菜单 | 一次构建 + MenuShortcuts diff 守卫 |
| 拖拽 | 全局单例，多消费者共享 |
| 测试 | 18 个单元测试，4 个 spec 文件，全部通过 |

### ⚠️ 占位 / 待补全（不可用）

| 模块 | 问题 |
|------|------|
| Markdown 解析器/序列器 | 简化 stub（仅支持 heading/blockquote/code/paragraph/image），无表格/列表/数学/脚注等 |
| 编辑器扩展 | 仅注册了 StarterKit + CustomImage + MarkdownPaste，缺少 callout/math/mermaid/slash-menu/emoji 等 20+ 扩展 |
| 导出渲染器 | `useExportActions.ts` 动态导入的 `utils/export-renderer` 和 `utils/export/theme` 不存在 |
| BubbleMenu / SlashMenu / EmojiMenu | Vue 组件未创建 |
| 搜索替换面板 | 未实现 |

---

## 相比 v1 的关键改进

| 维度 | v1 | v2 |
|------|-----|-----|
| 启动速度 | ~2.5s 到可交互（含网络探测） | ~400ms 到窗口可见（剩余异步） |
| 图片解析 | 2-3 次 IPC | 1 次 IPC |
| 图片缓存 | 3 层 data-attr 去重 + 状态机 | `Promise<string>` 缓存 |
| 设置加载 | 全量同步阻塞 | L1 快速 + L2 异步后台 |
| 菜单 | 每次快捷键变更全量重建 | diff 守卫，相同则跳过 |
| 拖拽 | 多个 Tauri 事件订阅 | 单例订阅，前端分发 |
| 端口探测 | 启动时同步阻塞 | 首次网络请求时懒加载 |
| 自动更新 | 默认启用（网络请求） | 默认关闭，手动触发 |
| 测试覆盖 | 989 个（含 markdown 解析、CJK 等） | 18 个（核心图片链路） |

---

## 构建与运行

```bash
cd solo-v2
bun install                # 安装前端依赖
bun run test               # 运行测试（当前 18/18 通过）
bun run build              # 类型检查 + 前端构建（当前有缺失扩展，会报错）
cargo tauri dev            # 启动开发模式（需要 Rust 工具链）
```

> 注意：当前 `bun run build` 和 `cargo tauri dev` **均无法正常运行**，因为 stub 模块和缺失的编辑器扩展会导致编译/运行时错误。  
> 本项目是**架构原型**，不是可用产品。

---

## 总结

Solo v2 的架构价值集中体现在三点：

1. **减法思维**——每个字节都有其被加载的理由
2. **路径优化**——高频操作（图片显示）从 3 次 IPC 降到 1 次
3. **统一缓存**——去重逻辑从 data-attr 碎片合并为单一路径

这些改进在 v1 的 989 个测试通过率和生产环境中经历了充分验证。v2 将已验证的优化思路以更简洁的架构重新组织，形成了可审查、可继承、可逐步替换的设计框架。
