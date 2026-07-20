<p align="center">
  <img src="./public/icon.png" width="160" alt="solo Logo" />
</p>

<h1 align="center">solo</h1>

<p align="center">
  <strong>로컬 우선, 미니멀 몰입형 Markdown 편집기</strong>
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

## 개요

solo는 "글을 위한 메스" — 즉시 실행되고, 로컬 `.md` 파일을 직접 편집하며, 필요 없으면 사라집니다. 노트 앱도, 지식 베이스도, 플랫폼도 아닙니다.

## 기능

- **WYSIWYG 편집** — TipTap / ProseMirror 기반. 입력 즉시 렌더링
- **멀티 윈도우** — 여러 파일을 별도 창에서 동시 편집. 포커스 전환 시 콘텐츠 유지
- **확장 구문** — KaTeX 수식, Mermaid 다이어그램, GFM 표, 각주, Frontmatter YAML, Callout(12색), WikiLink, 하이라이트, 위첨자/아래첨자
- **우아한 타이포그래피** — 3가지 테마(종이 흰색 / 먹색 / 벼루 청색), 폰트 온디맨드 다운로드
- **데스크톱 네이티브** — 프레임리스 창, 우클릭 새 .md 만들기, 제목 표시줄 더블클릭 최대화, 항상 위에 표시
- **메모리 절약** — 포커스 상실 시 WebView2 MemoryUsageTargetLevel 감소, 편집기 지연 초기화, 가벼운 설치 프로그램(시스템 WebView2 사용)
- **HTML 복사** — 원클릭으로 리치 HTML을 클립보드에 복사, 테마 따름, 보이는 그대로 출력
- **형식 충실도** — 완전한 Markdown 왕복 테스트 + CommonMark spec 안정성 검증(618 통과 / 34 설계 제약). Markdown 붙여넣기 자동 변환, Ctrl+C 시 소스도 클립보드에 복사

## 기술 스택

Tauri 2 (Rust) → Vue 3 + Pinia + TipTap/ProseMirror + Tailwind CSS 4

## 설치

[Releases](https://github.com/jloft198479-cyber/solo/releases)에서 최신 설치 프로그램을 다운로드하세요.

## 개발

```bash
bun install
bun run dev
bun run dev:tauri
bun run build:tauri
bun run test
```

Rust 1.96+ 및 MSVC Build Tools가 필요합니다.

## 연락처

- WeChat: fzz198479

## License

[Apache License 2.0](LICENSE)에 따라 오픈소스로 제공됩니다. [MarkLight](https://github.com/xiaodou997/marklight)에서 포크되었습니다.
