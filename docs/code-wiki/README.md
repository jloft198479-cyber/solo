---
title: 代码维基（Code Wiki）
type: guide
audience: dev
status: active
tags: [code-wiki, 架构, 模块, 函数, 依赖, 运行]
summary: 面向开发者的结构化代码导览：架构分层、模块职责、关键类与函数、依赖边界、数据流与构建运行
updates: [ARCHITECTURE.md, BUILD_GUIDE.md, docs/sensitive-areas.md, src/, src-tauri/src/]
---

# 代码维基（Code Wiki）

> **这是什么**：一套面向开发者的「代码导览」，回答四件事——项目怎么分层、每个模块负责什么、关键类/函数在哪、依赖与数据怎么流。
> **不是什么**：不替代真理源。架构事实以 [ARCHITECTURE.md](../../ARCHITECTURE.md) 为准，构建命令以 [BUILD_GUIDE.md](../../BUILD_GUIDE.md) 为准，改动安全网以 [sensitive-areas.md](../sensitive-areas.md) 为准。本维基负责「把事实串成能读懂的路线」，不复制会随代码漂移的计数。

---

## 1. 十分钟建立心智模型

**solo** 是一个本地优先的桌面 Markdown 编辑器：Tauri 2（Rust 原生核心）+ Vue 3 + Pinia + TipTap/ProseMirror + Tailwind CSS 4。无服务端，文件直接落在本地磁盘。

```
┌─────────────────────────────────────────────────────────────┐
│ Vue 前端 src/                                                │
│   main.ts → App.vue（协调层）                                 │
│        ├─ composables/ 业务编排（按关注点拆分）                │
│        ├─ stores/      Pinia 状态（file / settings）           │
│        ├─ components/  编辑器、设置、标题栏、命令面板           │
│        └─ commands/    命令注册表（命令/快捷键/菜单共用）        │
├─────────────────────────────────────────────────────────────┤
│ IPC 服务层 src/services/tauri/                                │
│   client.ts（唯一 invoke 入口）+ command-names.ts（命令名表）   │
│   document / session / window / dialog / clipboard / font ... │
├─────────────────────────────────────────────────────────────┤
│ Rust 核心 src-tauri/src/                                      │
│   lib.rs（启动/菜单/窗口/命令注册）                             │
│   commands/（文档、会话、图片、字体、剪贴板、窗口、桌面集成）    │
│   state.rs / models.rs / error.rs / events.rs / menu.rs       │
└─────────────────────────────────────────────────────────────┘
```

三条铁律：

1. 前端业务代码**不直接** `invoke` / `listen` / `emit`，一律走 `services/tauri/`。
2. Rust 命令返回**结构化 DTO**，错误统一为 `AppError { code, message }`。
3. 通用桌面能力优先用 Tauri 官方插件，不在项目里重复造壳。

---

## 2. 页面地图

| 页面 | 回答什么问题 | 适合什么时候读 |
|---|---|---|
| [01-系统架构.md](./01-系统架构.md) | 分层、技术栈、目录地图、横切机制、持久化位置 | 第一次接手，先建立全局图 |
| [02-Rust-后端.md](./02-Rust-后端.md) | Rust 模块、命令清单、状态、错误模型、启动竞态、关窗链 | 改文件/窗口/图片/字体相关逻辑 |
| [03-前端外壳.md](./03-前端外壳.md) | main/App、composables、file/settings store、命令系统、IPC 封装 | 改交互、快捷键、设置、窗口行为 |
| [04-编辑器内核.md](./04-编辑器内核.md) | MarkdownEditor、扩展体系、parser/serializer、剪贴板、主题字体 | 改编辑体验或 Markdown 保真 |
| [05-关键数据流.md](./05-关键数据流.md) | 启动、打开、编辑、保存、关窗、多窗口、图片、会话记忆 | 排查「为什么没保存/没刷新/关不掉」 |
| [06-依赖关系与边界.md](./06-依赖关系与边界.md) | 模块依赖方向、第三方依赖、机器锁、真理源地图 | 判断新代码该放哪、会不会破坏边界 |
| [07-构建运行与测试.md](./07-构建运行与测试.md) | 环境、命令、验证等级、测试网、排障入口 | 第一次跑起来、提交前自检 |
| [08-关键符号索引.md](./08-关键符号索引.md) | 类/函数/Store/命令 → 文件 → 职责速查 | 只知道名字，想快速定位 |

推荐路线：

- **新接手**：本页 → 01 → 05 → 03/04 → 07。
- **改一个功能**：01 找层 → 08 找符号 → 对应模块页 → 06 查边界。
- **排一个故障**：05 找数据流 → 07 找排查入口 → `docs/KNOWN-ISSUES.md`。

---

## 3. 项目速览

| 维度 | 事实 | 真理源 |
|---|---|---|
| 产品定位 | 本地优先、极简、所见即所得的 Markdown 编辑器 | [README.md](../../README.md) |
| 桌面框架 | Tauri 2 | `package.json` / `src-tauri/Cargo.toml` |
| 前端 | Vue 3 + TypeScript + Pinia + Vite | `package.json` |
| 编辑器 | TipTap / ProseMirror，单实例复用 | `src/components/Editor/MarkdownEditor.vue` |
| Markdown | markdown-it + 自研 parser / serializer | `src/components/Editor/tiptap/markdown/` |
| 样式 | Tailwind CSS 4 + CSS 变量主题 | `src/assets/styles/main.css`、`src/themes/` |
| 主要产物 | Windows NSIS 安装包（配置见 `bundle.targets`） | `src-tauri/tauri.conf.json` |
| 测试 | Vitest | `vitest.config.ts` |

> 版本号、命令数量、扩展数量、测试数量都以源码/命令输出为准，本维基不硬编码，避免二次漂移。

---

## 4. 最快跑起来

```bash
bun install
bun run dev:tauri     # 完整桌面开发
bun run test          # 单元/契约/roundtrip 测试
bun run lint          # ESLint
bun run build:tauri   # 构建安装包
```

环境要求、工具链路径、Windows 特有问题见 [BUILD_GUIDE.md](../../BUILD_GUIDE.md) 与 [07-构建运行与测试.md](./07-构建运行与测试.md)。

---

## 5. 读代码前必须知道的三条约束

1. **真理源唯一**：命令名在 `src/services/tauri/command-names.ts`，Rust 注册在 `lib.rs::generate_handler!`，文档表在 `ARCHITECTURE.md §4.2`，三处有机器锁。
2. **改动先架安全网**：`git status` 干净、盘点副作用、判断归属层。细则见 [agent-playbook.md §G](../agent-playbook.md)。
3. **parser / serializer / schema 是敏感区**：改动前先跑 5 套契约锁，详见 [07-构建运行与测试.md](./07-构建运行与测试.md) 与 [sensitive-areas.md](../sensitive-areas.md)。

---

## 6. 维护约定

- 本维基只写「稳定的结构与职责」，不写易漂移的数字（命令数、测试数、文件数）。
- 新增/删除 Rust 命令、扩展、Store 字段时，先改代码与真理源文档，再回写本维基对应页。
- 发现这里与代码不一致：**以代码为准**，并同步修正本页与 `ARCHITECTURE.md`。

---

## 7. 本次同步修正的既有文档漂移

建立本维基时对照源码，修正了 `ARCHITECTURE.md` 中以下已过期描述：

| 位置 | 旧描述 | 实际 |
|---|---|---|
| §2 / §3 / §6.3 / 附录 | composables 12 个 | 目录下实际 13 个，新增 `useFontStatus.ts` |
| §4.3 | 「2 个事件」+ `menu-event` 用 `app.emit` 广播 | Rust 定向事件含 `menu-event` / `window-close-requested` / `solo:editor-focus` / `solo:editor-blur`，全部 `emit_to`；另有两条前端跨窗口广播 `solo:wikilinks-synced` / `solo:file-renamed` |
| §7.1 | `file` store 只有 `reloadToken`，编辑器 watch `[path, reloadToken]` | 实际还有 `pathFollowToken`，编辑器 watch `[path, reloadToken, pathFollowToken]` |

这四处都是「读了会写错代码」的漂移，不只是措辞问题。
