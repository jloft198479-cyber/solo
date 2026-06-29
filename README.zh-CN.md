<p align="center">
  <img src="./public/icon.png" width="160" alt="solo Logo" />
</p>

<h1 align="center">solo</h1>

<p align="center">
  <strong>本地优先、极简沉浸的 Markdown 编辑器</strong>
</p>

<p align="center">
  <a href="./README.md">English</a>
  ·
  <a href="./README.zh-CN.md">简体中文</a>
  ·
  <a href="./README.ja-JP.md">日本語</a>
  ·
  <a href="./README.ko-KR.md">한국어</a>
</p>

## 产品定位

solo 是一把「专为文字而生的手术刀」——秒开秒关、书卷气质、本地文件、不作生态。不是笔记软件，不是知识库。

## 核心特性

- **所见即所得** — 基于 TipTap / ProseMirror，输入即渲染，告别分栏预览。
- **多窗口** — 同时打开多个文件，每窗口独立会话。切窗口内容不丢失，并排对照无压力。
- **扩展语法** — KaTeX 数学公式、Mermaid 图表、GFM 表格、脚注、Frontmatter YAML、Callout（12 色）、WikiLink、高亮、上下标。
- **文艺版面** — 3 套书卷气主题（纸白 / 墨黑 / 砚青），字体按需下载，精心调校行距与留白。
- **桌面原生** — 无边框窗口、系统菜单、右键新建 .md、双击标题栏最大化、置顶、自动保存。
- **内存克制** — 多窗口下 WebView2 MemoryUsageTargetLevel 自动降级，编辑器懒初始化，安装包仅 ~5MB。
- **HTML 导出** — 完整主题跟随导出，所见即所得。
- **格式保真** — 977 项 round-trip 测试 + 652 条 CommonMark spec 稳定性验证（618 通过 / 34 设计约束），粘贴 Markdown 自动转换，Ctrl+C 同时写入源码到剪贴板。

## 技术架构

Tauri 2（Rust）→ Vue 3 + Pinia + TipTap/ProseMirror + Tailwind CSS 4

* 前端业务层统一通过 `services/tauri/` 封装调用 Rust 命令
* Rust 侧返回结构化 DTO + `AppError`
* 通用能力优先使用 Tauri 官方插件

## 安装

从 [Releases](https://github.com/jloft198479-cyber/solo/releases) 下载最新安装包。支持自定义安装路径。

首次启动后可在设置中开启 Windows 文件关联（右键新建 .md）。

## 开发

```bash
bun install
bun run dev          # 纯前端
bun run dev:tauri    # 全栈开发
bun run build:tauri  # 构建安装包
bun run test         # 运行测试
```

需要 Rust 1.96+ 和 MSVC Build Tools。项目提供 `launch-dev.bat` 一键启动开发模式。

## 联系方式

- 微信：fzz198479

## License

solo 基于 [Apache License 2.0](LICENSE) 开源，基于 [MarkLight](https://github.com/xiaodou997/marklight) 重构而来。
