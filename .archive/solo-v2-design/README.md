# solo-v2 设计文档归档

**归档时间**: 2026-07-19
**归档原因**: solo-v2 是不可运行的架构原型，价值在思路而非代码。用户决定"一个项目"，v2 优化点逐步合入 v1。本归档保留 v2 的设计文档供查阅，原 `solo-v2/` 目录的 stub 代码和 node_modules 将删除。

## 归档内容

| 文件 | 来源 | 说明 |
|------|------|------|
| `ARCHITECTURE.md` | solo-v2/ARCHITECTURE.md | v2 五级启动管道、IPC 合并、缓存策略等架构方案 |
| `REVIEW.md` | solo-v2/REVIEW.md | v2 架构框架概述（供第三方评审） |
| `solo-v1-upgrade-roadmap.md` | 外层 solo-v1-upgrade-roadmap.md | v2 优化点逐步合入 v1 的 4 阶段实施规划 |

## 原目录处置

- `solo-v2/src/` — stub 代码，删除
- `solo-v2/src-tauri/` — Rust 原型，删除
- `solo-v2/node_modules/` — 删除
- `solo-v2/package.json` / `tsconfig.json` / `vite.config.ts` / `vitest.config.ts` / `index.html` — 工程脚手架，删除
- `solo-v2/` 整目录 — 删除

## 使用方式

阅读本归档了解 v2 的设计思路，但**实施以 v1 代码为基础**。具体落地步骤见 `solo-v1-upgrade-roadmap.md`。

v1 已自发吸收 v2 多数思想（菜单 diff、自动更新手动、asset 极简），真正待实施仅 2 项：
1. 图片 IPC 合并（resolve + authorize → resolve_image_display 单命令）
2. 拖拽事件单例（多消费者共享一个 Tauri 事件订阅）
+1 项可选：设置 L1/L2 分级加载
