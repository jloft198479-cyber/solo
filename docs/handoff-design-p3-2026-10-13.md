---
title: 设计审核 P3 交接（2026-10-13）
type: guide
audience: agent
status: active
tags: [交接, 设置层, 设计审核, p3, 真机验收]
summary: P1/P2 已交付，P3 三项待办、真机验收环境与工作区注意事项
updates: [src/components/popover-shared.css, src/themes/presets/scholar-dark.json, src/themes/presets/cinnabar-dark.json, docs/agent-delivery-method.md]
---

# 设计审核 P3 交接（2026-10-13）

> **给豆包的第一句话**：2026-10-12 做了一次 UI 设计审核，问题分 P1/P2/P3 三档。
> P1（2 项）P2（4 项）已全部完成、真机验收、本地提交；剩下 **P3 三项**由你接手。
> 动手前必读 [AGENTS.md](../AGENTS.md)；执行手法照搬 [Agent 交付方法](./agent-delivery-method.md)（上一个执行者的 SOP，也是用户指定你要学的工作方法）。
> 审核原始 HTML 报告在 `outputs/design-audit/`（**该目录 gitignore，不入库**），所以本文自包含 P3 全部信息，不必去找原报告。

---

## 一、已完成部分（别重复做）

| 项 | 内容 | commit |
|---|---|---|
| P1-1 | 选区工具条靠右溢出视口 → 按实测宽度钳制 | `759d45e` |
| P1-2 | 崩溃兜底页渲染 `[object Object]` → 安全格式化 | `caa284b` |
| P2-1 | 设置五页 hero 摘要复读卡全删 | `3ab77b5` |
| P2-2 | 圆角统一：卡片/弹层 8px，文字标签回 4px 直角，拟物控件（开关/色点/圆钮）保持 999px | `3ab77b5` |
| P2-3 | hero 卡右上径向渐变（全库唯一装饰渐变）删除 | `3ab77b5` |
| P2-4 | 快捷键行 flex 防压碎 + ≤960px 顶对齐；编辑器两开关合卡；保存间隔去复读 | `3ab77b5` |
| 收尾 | 旧独立 About 弹窗移除，「关于」菜单直达设置中心关于页 | `90fd7b2` |

验收基线（你做完 P3 后也要对齐这个口径）：**1842 passed / 1 skipped，vue-tsc 0 错，lint 0 error（132 warnings 为存量基线，不得增加）**。

## 二、P3 待办三项

### P3-1 状态栏图标透明度 0.6 → 0.8~0.85（低成本，直接做）

- **位置**：[popover-shared.css](../src/components/popover-shared.css#L8-L28) 的 `.icon-btn`（L19 `opacity: 0.6`，L25 hover `opacity: 1`；L8 注释「克制透明度」一并改）。状态栏四个图标按钮（大纲/主题/复制格式/设置）共用此类，**改一处全覆盖，别加新类**。
- **问题**：16px 小描边图标在 60% 透明下辨识度不足，「主题」四宫格与「复制格式」空心方框不悬停看 title 难以第一反应认出。
- **修法**：默认透明度提到 **0.8~0.85**，hover 仍为 1（保留悬停反馈层级）。建议 0.85：与 `--text-secondary` 叠加后实测各主题可辨，且 hover 仍有可感知的提亮。
- **硬约束**：不许硬编码新数值之外的东西——opacity 是审核明确点名的数值调整，改常量值即可；亮/暗主题各截图一张确认。
- **验收**：真机看状态栏四图标不发灰、hover 仍有反馈；无主题下出现对比度翻车（尤其暗色两主题）。

### P3-2 暗色主题两套并存，且「夜读墨色」冷暖混搭（⚠️ 产品决策，先让用户拍板）

- **位置**：[scholar-dark.json](../src/themes/presets/scholar-dark.json)（夜读墨色，冷蓝调，主色 `#6f9fbf`）、[cinnabar-dark.json](../src/themes/presets/cinnabar-dark.json)（朱墨暗，暖红调，主色 `#e08177`）。
- **问题**：此前定调「暗色只保留一种」，现状两套都在；且夜读墨色同屏色温打架——logo、引用块左边用冷蓝，保存状态点却是暖橙。
- **修法（两选一，必须用户拍板，不许替用户决定）**：
  - a. 留夜读墨色 → 把状态点/引用边统一到冷色或中性色，一套暗色只许一种色温；朱墨暗下架（下架走主题可用性/删除 preset 的正规路径，先查注册表与配置迁移，别直接删文件）。
  - b. 留朱墨暗 → 反向处理，冷色元素统一暖调。
  - c. 用户也可能决定两套都留——那至少修掉夜读墨色内部的冷暖混搭。
- **你要做的第一件事**：把三个选项摆给用户（**二选一/三选一式提问**），回答前不改任何主题文件。

### P3-3 主题快捷弹层疑似被编辑器层裁切（存疑项，真机复核后销项）

- **现象（仅 mock 环境拍到）**：自动化浏览器里点状态栏主题格，弹层只露头部，列表疑似被面板裁切。源码层面 `position:absolute; bottom:calc(100% + 10px); z-index:300` 无 overflow 硬伤，审核方只列存疑不下结论。
- **已有进展**：2026-10-13 CDP 真机（1280×860）实测**大纲面板关闭态**：弹层完整，8 个主题全部可见、选中勾正常、容器 8px 圆角——该状态下已证伪。
- **你要做的**：真机补测**大纲面板打开态**（左侧 OutlinePanel 展开时点主题格）：
  - 完整 → 本项直接销项，在本文「验收记录」补一行结论；
  - 真被裁切 → 查层叠上下文（`transform`/`z-index`/`overflow` 链路），再提修法给用户确认。十分钟的事，**别大改**。

## 三、真机验收环境（重要：裸浏览器看不了设置弹窗）

纯浏览器开 `http://localhost:1420/` 会因 Tauri API 缺失连环报错（invoke/metadata undefined），编辑器走 defineAsyncComponent 崩溃进 ErrorBoundary，且改 Pinia state 不重渲弹窗。**必须用真实 solo.exe + CDP**。完整 SOP、踩坑与脚本骨架见 [Agent 交付方法 §5](./agent-delivery-method.md#五真机验收sop真实-tauri--cdp)，要点：

1. `bun run dev`（端口 1420，前端走 Vite 源码，**免 Rust 重编**）；
2. PowerShell 设 `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'` 后启动 `src-tauri/target/debug/solo.exe`（debug 构建默认支持 CDP）；
3. Python playwright `connect_over_cdp("http://localhost:9222")` 操作；
4. **先把窗口设成 1280×860**（`Browser.getWindowForTarget` + `setWindowBounds`）——窗口会恢复成 484px 窄尺寸，窄窗下快捷键行会物理性断行，不设窗口尺寸会误判布局 bug；
5. 断言用 DOM/computed style 读数（如 `getComputedStyle(...).borderRadius === '8px'`、`querySelectorAll('.settings-nav-btn--active').length === 1`），截图只做佐证。

已知坑：脚本里别按 Escape 退出快捷键编辑态（会被弹窗全局 Escape 监听捕获，直接关掉整个弹窗）；Python playwright 不支持 `get_by_role(name=lambda...)`，用 CSS 选择器。

## 四、工作区现状（⚠️ 保护用户的在制品）

截至交接时，工作区有一批**用户本人未提交的改动，与 P3 无关，一个都不许碰**（白名单 add，禁止 `git add -A`）：

`src/App.vue`（标题栏 X 改走原生关闭通道）、`src/composables/useAppWindowSession.ts`、`src/services/tauri/window.ts`、`src-tauri/src/commands/desktop.rs`、`src-tauri/src/lib.rs`、`docs/SECURITY.md`、`scripts/cdp-verify-ui.py`、未跟踪的 `scripts/perf-baseline.py`。

若你的 P3 改动与其中文件重叠，用 `git apply --cached` 补丁式部分暂存隔离（手法见 [Agent 交付方法 §4](./agent-delivery-method.md#四提交卫生白名单--部分暂存--不-push)）。

## 五、完成口径

- 验收结论写「用户怎么操作得到什么结果」，不写「N 条锁转绿」；
- 每个独立问题单独 commit（P3-1 / P3-2 / P3-3 分开），message 走 Conventional Commits，**只本地提交，不 push**（用户明确要求）；
- 三项全部销项后，把 P3-2 的产品决策结果与 P3-3 复核结论补进本文，然后将本文件归档（`status: active → archive` + INDEX 同步），P3 遗留问题（若有）登记 [KNOWN-ISSUES.md §二](./KNOWN-ISSUES.md)。

## 验收记录

- 2026-10-13：P3-3 大纲关闭态真机证伪（弹层完整）；大纲打开态待补测。
