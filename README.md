<p align="center">
  <img src="./public/icon.png" width="160" alt="solo Logo" />
</p>

<h1 align="center">solo</h1>

<p align="center">
  <strong>本地优先的 Markdown 编辑器，面向中文沉浸式写作</strong>
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

solo 是一款极简、专注的本地 Markdown 编辑器。它不是笔记软件，不是知识库，而是一把「专为文字而生的手术刀」——足够轻、足够快、排版足够美。

## 特性

- **所见即所得编辑** — 基于 TipTap / ProseMirror，输入瞬间渲染，告别分栏预览
- **沉浸式界面** — 聚焦模式一键隐藏所有干扰，标题栏自动淡入淡出
- **文艺排版** — 内置 7 套书卷气主题，字体、行距、间距精心调校
- **本地优先** — 文件存本地，不捆绑云服务。拖入图片自动复制到 `assets/` 目录
- **桌面原生体验** — 无边框窗口、右键菜单、系统打印、开机还原窗口状态
- **微信 / HTML 导出** — 所见即所得，导出配色跟随编辑器主题
- **极速启动** — 安装包仅 ~5MB（字体按需下载），秒开秒关

## 技术栈

Tauri 2（Rust）+ Vue 3 + Pinia + TipTap/ProseMirror + Tailwind CSS 4

## 安装

从 [Releases 页面](https://github.com/jloft198479-cyber/solo/releases) 下载最新版安装包。支持自定义安装路径。

安装后可在桌面右键菜单创建 `.md` 文档。

## 从源码构建

```bash
# 安装依赖
bun install

# 开发模式（纯前端）
bun run dev

# Tauri 全栈开发模式
bun run dev:tauri

# 构建安装包
bun run build:tauri
```

构建需要 Rust 工具链 + MSVC Build Tools。详见 [产品需求说明](./产品需求说明.txt)。

## 开源

solo 基于 [Apache License 2.0](LICENSE) 开源，基于 [MarkLight](https://github.com/xiaodou997/marklight) 重构而来。
