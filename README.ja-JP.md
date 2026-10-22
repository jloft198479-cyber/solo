---
title: solo — ローカルファーストの Markdown エディタ
type: product
audience: user
status: active
tags: [产品导览, README]
summary: 製品紹介/インストール/開発セットアップ（日本語）
updates: [README.md, README.zh-CN.md, README.ko-KR.md, docs/solo产品精神.md]
---

<p align="center">
  <img src="./public/icon.png" width="160" alt="solo Logo" />
</p>

<h1 align="center">solo</h1>

<p align="center">
  <strong>ローカル優先、ミニマルで没入感のあるMarkdownエディタ</strong>
</p>

<p align="center">
  <a href="https://solo.weimabbs.com/">🌐 公式サイト</a>
  ·
  <a href="./README.md">English</a>
  ·
  <a href="./README.zh-CN.md">简体中文</a>
  ·
  <a href="./README.ja-JP.md">日本語</a>
  ·
  <a href="./README.ko-KR.md">한국어</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="ライセンス: Apache 2.0" />
  <img src="https://img.shields.io/badge/platform-Windows%2010%2B-0078D6.svg" alt="対応プラットフォーム: Windows 10 以降" />
  <img src="https://img.shields.io/github/v/release/jloft198479-cyber/solo.svg" alt="最新リリース" />
  <img src="https://img.shields.io/github/stars/jloft198479-cyber/solo.svg" alt="GitHub stars" />
</p>

## スクリーンショット

<p align="center">
  <img src="./docs/screenshots/screenshot-main.png" width="860" alt="solo メインエディタ画面 — 書巻気テーマ" />
</p>

<table align="center">
  <tr>
    <td><img src="./docs/screenshots/theme-night.png" width="270" alt="solo 夜読墨色ダークテーマ" /></td>
    <td><img src="./docs/screenshots/theme-elegant.png" width="270" alt="solo 素笺ライトテーマ" /></td>
    <td><img src="./docs/screenshots/theme-jade.png" width="270" alt="solo 黛青テーマ" /></td>
  </tr>
</table>

<p align="center">
  <img src="./docs/screenshots/compact-window.png" width="240" alt="solo コンパクトウィンドウ" />
</p>

## 概要

solo は「言葉のためのメス」——瞬時に起動し、ローカル `.md` ファイルを直接編集し、必要がなくなれば消える。ノートアプリでも知識ベースでもプラットフォームでもない。

## 機能

- **WYSIWYG 編集** — TipTap / ProseMirror 採用。入力が即座にレンダリングされる
- **マルチウィンドウ** — 複数ファイルを別ウィンドウで同時編集。フォーカス切替で内容消失なし
- **拡張構文** — KaTeX 数式、Mermaid 図、GFM テーブル、脚注、Frontmatter YAML、Callout（12タイプ）、WikiLink、ハイライト、上付き/下付き
- **美しい組版** — 3種類のテーマ（紙白 / 墨黒 / 硯青）、フォントはオンデマンドでダウンロード
- **デスクトップネイティブ** — フレームレスウィンドウ、右クリックで .md 新規作成、タイトルバーダブルクリック最大化、常に手前に表示
- **省メモリ** — フォーカス喪失時に WebView2 MemoryUsageTargetLevel 低減、エディタ遅延初期化、軽量インストーラ（システム WebView2 使用）
- **HTML コピー** — ワンクリックでリッチ HTML をクリップボードへ、テーマ準拠、見たままを出力
- **フォーマット忠実性** — 完全な Markdown ラウンドトリップテスト + CommonMark spec 安定性検証（テスト数は `bun run test` を参照）。Markdown貼り付け自動変換、Ctrl+C は整形済みのプレーンテキストをコピー（数式・図表・ウィキリンク等を含む選択時のみ Markdown ソース）。ソースが必要なときは **Copy as Markdown**（Mod+Shift+M）。

## 技術スタック

Tauri 2 (Rust) → Vue 3 + Pinia + TipTap/ProseMirror + Tailwind CSS 4

## インストール

[Releases](https://github.com/jloft198479-cyber/solo/releases) から最新インストーラをダウンロード。

## 開発

```bash
bun install
bun run dev
bun run dev:tauri
bun run build:tauri
bun run test
```

Rust 1.96+ と MSVC Build Tools が必要。

> **AI agents / contributors:** all project rules live in [`AGENTS.md`](./AGENTS.md) — read it before making changes.

## 連絡先

- 公式サイト: <https://solo.weimabbs.com/>
- WeChat: fzz198479

## License

[Apache License 2.0](LICENSE) の下でオープンソース。[MarkLight](https://github.com/xiaodou997/marklight) からフォーク。
