<p align="center">
  <img src="./public/icon.png" width="160" alt="solo Logo" />
</p>

<h1 align="center">solo</h1>

<p align="center">
  <strong>Local-first, minimalist Markdown editor for immersive writing</strong>
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

## What is solo?

solo is a "scalpel for words" — launches instantly, stays out of your way, and works directly on local `.md` files. It is not a note-taking app, not a knowledge base, and not a platform.

## Features

- **WYSIWYG editing** — TipTap / ProseMirror under the hood. Type and see it rendered instantly.
- **Multi-window** — Open multiple files in separate windows. Switch focus without losing content. Compare documents side-by-side.
- **Extended syntax** — KaTeX math, Mermaid diagrams, GFM tables, footnotes, Frontmatter YAML, Callouts (12 colors), WikiLinks, highlighting, superscript/subscript.
- **Elegant typography** — 3 hand-crafted themes (Paper White / Ink Black / Inkstone Cyan). Fonts downloaded on demand.
- **Desktop-native** — Frameless window, system menu, right-click "New .md", double-click titlebar to maximize, always-on-top, auto-save.
- **Memory-conscious** — WebView2 MemoryUsageTargetLevel on blur, lazy editor initialization, ~5MB installer.
- **HTML export** — Theme-following export, what you see is what you get.
- **Format fidelity** — 977 round-trip tests + 652 CommonMark spec stability checks (618 pass / 34 design constraints). Paste Markdown auto-converts. Ctrl+C writes Markdown source alongside HTML.

## Tech Stack

Tauri 2 (Rust) → Vue 3 + Pinia + TipTap/ProseMirror + Tailwind CSS 4

## Install

Download the latest installer from [Releases](https://github.com/jloft198479-cyber/solo/releases). Custom install path supported.

After first launch, enable Windows file association in Settings for right-click "New .md".

## Development

```bash
bun install
bun run dev          # Frontend only
bun run dev:tauri    # Full-stack with Tauri
bun run build:tauri  # Build installer
bun run test         # Run tests
```

Requires Rust 1.96+ and MSVC Build Tools.

## Contact

- WeChat: fzz198479

## License

solo is open-sourced under [Apache License 2.0](LICENSE), forked from [MarkLight](https://github.com/xiaodou997/marklight).
