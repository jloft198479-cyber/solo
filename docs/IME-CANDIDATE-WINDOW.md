---
title: IME 候选窗失锚（封存档 · 主题唯一入口）
type: record
audience: agent
status: active
tags: [ime, 输入法, 候选窗, webview2, tauri, 封存, 档案]
summary: IME 候选窗失锚的唯一入口文档（2026-09-30 由 4 份蒸馏合并）：封存结论 + 现象台账 + 已排除/死路清单 + 补丁三版全败史 + 第三方与跨 agent 建议评估 + 重启执行顺序 + 档案索引。问题本身已封存（2026-09-24），本文档作为可重启档案继续维护。
updates: [docs/KNOWN-ISSUES.md, docs/INDEX.md, .workbuddy/memory/topics/ime-candidate-window.md, .workbuddy/memory/MEMORY.md]
---

# IME 候选窗失锚 — 封存档（主题唯一入口）

> **本文由 4 份旧文档蒸馏合并而成（2026-09-30）**，原件归档在 [`docs/archive/`](./archive/)：
> `IME-CANDIDATE-WINDOW-PLAN.md` · `-REPORT.md` · `-SOLUTION-2026-09-23.md` · `-观点对照-2026-09-24.md`。
> 原始取证流水（证据真理源）仍在 [`.workbuddy/memory/topics/ime-candidate-window.md`](../.workbuddy/memory/topics/ime-candidate-window.md)。

---

## 🛑 0. 状态：已封存（2026-09-24）

**状态**：`外部缺陷 · 观测已完成 · 停止投入 · 转观察`。
用户于 2026-09-24 明确终止：**不再配合任何测试**。规划动作（R0/R1/R1b/R2/M1/L）**全部撤销**——不再要求用户手工操作、不启动新实验、不追加取证、不为它再写代码。

**重启条件（仅此三类）**：
1. 上游 WebView2 / Windows 发布相关修复；
2. 微软回复本族任一 issue（`#1611` / `#2241` / `#5675` / `#5625`）；
3. 产品形态变更（更换运行时策略或窗口形态）。

除此之外不要开新实验、不要让用户测。

### 封存时已确定的硬事实（可复用，勿重测）

1. **锚点＝屏幕绝对坐标常数**，同一会话内恒定不动（2026-09-24 实测 `(782±1, 706±1)`，4 批次 / 45 帧零位移），**与窗口位置、光标位置均无关**（窗口挪 668px、光标挪 901px，锚点不动）。
2. 用户感知的「有时在页面内、有时跑到页面外」＝ **锚点不动 + 窗口移动**的视觉结果，**不是候选窗行为变化**。
3. 触发时机：resize / 焦点切换 / 切对象后的**首次**组字；发作后**任何鼠标事件立即清除** ⇒ 自动化抓不住，**测试动作本身污染被测对象**。热键取证器同样抓不到组字现场（按热键即打断组字）。
4. 同机同时段自然对照：**OpenCode 终端（Chromium）打字正常 / solo 打字恒失锚**。
5. **已排除，勿重走**：contentEditable、DOM 复杂度、DPI（100% 单屏也发作）、JS 层抑制 DOM 变更、依赖升级、`MoveFocus(PROGRAMMATIC)`、`NotifyParentWindowPositionChanged()`、`EditContext`、透明输入代理层（裸 `<input>` 也复现）、**换输入法**（2026-09-24 用户换豆包输入法后症状完全相同）。

**仍不能确定**：根因（哪一行、哪个时序）。可用观测通道只有屏幕像素 / DevTools / 源码；WebView2 内部无接口可入。

---

## 1. 三十秒版

- **是什么**：Windows 11 上，Tauri v2（wry）+ WebView2 应用里用中文输入法打字，**候选窗偶发脱离光标、被钉在屏幕固定点**，形态完全正常（7 候选词 + 工具栏齐全），只是位置错。**不丢数据**。
- **何时发**：偶发（实测约 **16% 会话命中**，2/12 会话段），集中在「进入应用 / 切换文档 / 窗口位移」后的**第一次**组字。
- **怎么好**：任何鼠标移动或点击立即清除；会话跑久后也不再出现（现场实测 21 分钟后全部正常）。
- **谁的锅**：**不是 solo 编辑器代码**。上游 `MicrosoftEdge/WebView2Feedback#5675` 用 **stock Tauri + 裸 `<input>`** 就能复现 ⇒ 缺陷在 WebView2 宿主层 / 其 TSF 集成。微软对该族 **0 回复**。
- **为什么 solo 看起来更频繁**：solo 是「高频中文写作 + 高频窗口操作」的**高使用量场景**，触发机会多。**与 DOM 复杂度无因果关系**。
- **最大困局**：无法在自动环境触发 ⇒ **任何修法无法 A/B 证真**。

---

## 2. 现象与观测台账

### 2.1 标准问题陈述（只有可观测事实，不含因果推断）

> 在 Tauri v2（wry）宿主 + WebView2 Runtime 应用中，使用微软拼音等输入法组字时，候选窗**偶发脱离文本光标锚点**，被渲染到一个**远离光标的屏幕固定点**（2026-09-13/14 基线实测右下角 `(1340,996)`；2026-09-24 复测 `(782,706)`；**同一会话内为常数**，跨期差异与 Runtime 152→153 变更混淆、不可归因；与窗口/光标位置均无关），约 16% 会话命中；触发集中在**宿主窗口 resize / 焦点切换 / 切换编辑对象后的首次组字**；**任何鼠标事件立即清除**，故自动化无法稳定复现；同机同输入法下 **Edge 本体与纯 `<textarea>` 均不出现**（1606 帧采样中 21 帧失锚全部落在该应用内）。**根因未定位。**

**检索关键词**：`WebView2` · `TSF / IMM32` · `IME candidate window mispositioning` · `composition anchor` · `composition rect` · `wry / Tauri v2 host`

### 2.2 关键观测（逐条可复核）

| # | 观测 | 来源 |
|---|---|---|
| O1 | 候选窗**形态完全正常**，仅位置错 | 现场帧 `crop-A-full.png` / `crop-C-cand.png` |
| O2 | 全量 **1606 个候选窗帧**中真失锚仅 **21 帧**，该批次内坐标一字不差全为 `(1340,996,1396,1032)`（⚠️ 非跨期恒定） | `.sandbox-ime/scan.py` |
| O3 | 失锚帧**全部**在 solo 内；那一刻窗口内干净、无候选窗 | 同上 |
| O4 | 失锚时光标真实位置 ≈ `(226,626)` ⇒ 离候选窗约 **1100px** | `caret-locate.py` 两帧差分 |
| O5 | 命中率 **2/12 会话段 ≈ 16%** | 63 分钟探针日志 |
| O6 | 现场两次失锚 t=52.7s / t=63.5s（间隔 11s，坐标相同）；**21 分钟后（t=1404s+）再打字全部正常** | `logs/ime-watch-20260913-195550.log` |
| O7 | **对照组零失锚**：WorkBuddy 756 帧 / Edge 70 / DuMate 74 / doubao 9 / explorer 8 / powershell 6 / zcode 4 | 同一批全量采样 |
| O8 | 本机为**单显示器 1920×1080、工作区 1920×1040、96 DPI（100%）、DPR=1** | `win-probe.py` |
| O9 | 微软拼音候选窗由 **`TextInputHost.exe` 的 UWP 合成层**绘制，**无独立 HWND**，`EnumWindows` / UIA 都拿不到 ⇒ **只能屏幕像素取证** | 本机窗口枚举 |
| O10 | Chromium 系窗口 `hwndCaret = None`（自绘光标，`GetCaretPos` 拿不到） | 同上 |

> ⚠️ **已被推翻的旧表述**：早期文档写「第一次失锚、**第二次自愈**」——**过简且不准**。真值是**初期易发、随会话推进消失**（同一场编辑内出现过两次失锚，间隔 11s）。

### 2.3 锚点实测表（2026-09-24，首次拿到精确锚点）

数据来源：solo 内嵌取证器 `src-tauri/src/commands/forensic.rs`（**实验资产、未提交**，`SOLO_IME_FORENSIC=1` 门控，热键 `Ctrl+Alt+Shift+D`）。样本 84 png / 50 json。

| 批次 | 时间 | solo 窗口 (x,y) 607×769 | 光标屏幕估算 | 候选窗 bbox | 窗口覆盖锚点? | 锚点−光标 |
|---|---|---|---|---|---|---|
| ~~孤立帧~~ | ~~01:50（5 帧）~~ | 无 json | — | ~~(180,617)~~ | — | ❌ **已撤销**：裁剪核实＝**OpenCode 终端自身**的候选窗（正确定位） |
| ~~孤立帧~~ | ~~01:53（1 帧）~~ | 无 json | — | ~~(181,613)~~ | — | ❌ **已撤销**：同上 |
| A | 01:56（5 帧） | (1004,203) | (1058,278) | **无候选窗** | — | — |
| B | 02:02（7 帧） | (1175,154) | (1494,402) | **(783,707)**-(952,750) 169×43 | 否 | Δ(−711,+305) |
| C | 02:05（13 帧） | (967,71) | (1069,249) | **(783,707)**-(880,750) 97×43 | 否 | Δ(−286,+458) |
| D | 02:09（17 帧） | (573,97) | (723,307) | **(781,705)**-(952,750) 171×45 | 是 | Δ(+58,+398) |
| E | 02:22（8 帧） | (507,116) | (593,191) | **(783,707)**-(898,750) 115×43 | 是 | Δ(+190,+516) |

- **锚点恒定 `(782±1, 706±1)`**：窗口位移 668px、光标位移 901px，锚点不动。
- 候选窗**宽度随候选词内容变化**（97 / 115 / 169 / 171）⇒ 每次组字**新建**的活候选窗，非静态残留。
- **帧数口径（防重复推导）**：84 帧中检出 bbox 者 **51 帧**＝**solo 45 帧** + **非 solo 6 帧**（属 OpenCode 终端）。宽度只取 solo 的 4 档，`61/79` 是别家的窗。
- **该批数据的已知局限**：① 全部 `renderer.composing == false`（没抓到组字进行中的帧）；② 测到的是「热键之后的**残留**候选窗」，其位置是否等于组字期位置**本批无法自证**；③ 跨期坐标差 `(1340,996)`→`(783,707)` 与 Runtime 152→153 **两因混淆，不可归因**。
- **可复核性受损**：取证器原始落盘目录 `%LOCALAPPDATA%\com.solomarkdown\logs\forensics\`（原 84 png / 50 json / 约 71 MB）**现已为空**，清空原因不明 ⇒ 只能依赖 `.sandbox-ime/wb-cand-out/` 内的裁图。

### 2.4 ⚠️ 两个症状必须分开（最容易走偏的地方）

| | **A. 候选窗飘角**（本项目主诉） | **B. contentEditable 吃字 / 标点双按** |
|---|---|---|
| 上游 | `#5675` | `#5625` |
| 与 `contentEditable` | **无关**——裸 `<input>` 也复现 | **有关**——同页 `textarea` 完全正常 |
| 症状 | 候选窗位置错 | 第一个 CJK 字符被吞、中文标点要敲两遍 |
| 输入法差异 | 跨输入法（上游韩文 / 我方中文） | 搜狗重、微软轻 |
| JS 侧缓解 | —— | **已被提交者实测证明「组字期抑制 DOM 变更」无效** |

> **为什么必须分开**：有人同时用「`textarea` 正常 ⇒ 病灶在 `contentEditable`」和「裸 `input` 也复现 ⇒ 与 `contentEditable` 无关」论证，**这两句互斥**。真相是同一子系统（WebView2 TSF 集成）下的**两个不同缺陷**，不可互推。

---

## 3. 机制（**推断，非定论**）

光标矩形上报为空（`RenderWidgetHostViewAura::GetCaretBounds()` 在 `!active_widget` 时返空矩形 ⇐ renderer 报 `TEXT_INPUT_TYPE_NONE`）⇒ TSF 拿不到位置 ⇒ 系统回退屏幕默认角位。

**辅助推断**：恒定的角位＝输入法的「**无锚点回退位**」——微软拼音拿不到有效 anchor 时的默认位在右下角附近，韩文输入法（`#5675`）在左上角。**「我们右下 / 上游左上」不是矛盾，是同一机制在两种输入法下的不同表现。** 由此可排除一切「偏移一个位移量」类假说（坐标缓存过期等）——它解释不了角位恒定。

⚠️ `#5675` 提交者另有一套类似但**自称未经验证**的 TSF 链路推断。**微软均未确认。**

### 3.1 宿主层源码事实（wry 0.55.1，排查 Windows 行为唯一可读的源码）

路径：`M:\rust\.cargo\registry\src\mirrors.tuna.tsinghua.edu.cn-4dc01642fd091eda\wry-0.55.1\src\webview2\mod.rs`

| 行号 | 消息 / 配置 | 行为 |
|---|---|---|
| `:452-454` | `transparent` | 仅 `SetDefaultBackgroundColor(0,0,0,0)`；**未走** CompositionController / `WS_EX_LAYERED` / `NOREDIRECTIONBITMAP` |
| `:1206` | `parent_bounds()` | `GetClientRect` → **PhysicalSize**（未见逻辑/物理像素混用） |
| `:1224` | `WM_SIZE` | → `SetBounds` + `SetWindowPos(SWP_ASYNCWINDOWPOS)` |
| `:1254-1257` | `WM_SETFOCUS` \| `WM_ENTERSIZEMOVE` | → `MoveFocus(PROGRAMMATIC)` |
| `:1259-1262` | `WM_MOVE` \| `WM_MOVING` | → **已调用** `NotifyParentWindowPositionChanged()`（**全 crate 唯一调用点**） |
| **全库零命中** | `WM_WINDOWPOSCHANGED` / `WM_DPICHANGED` / `WM_DISPLAYCHANGE` | **完全未处理**（缺口真实，但同族动作已被上游实测证伪，补它需 fork wry 且无法验证） |

### 3.2 可复用的源码级事实（改窗口事件前必查）

**Windows 上鼠标拖动窗口不发 `WM_SIZE` ⇒ 不产生 tao 的 `Resized`，只发 `WM_WINDOWPOSCHANGED` → tao 的 `Moved`。**
映射 `tao-0.35.3/src/platform_impl/windows/event_loop.rs:1036 / 1210 / 1227`；转发 `tauri-runtime-wry-2.11.3/src/lib.rs:510-512`。

---

## 4. 上游 issue 族（均已核对存在性）

| issue | 症状 | 关键事实 |
|---|---|---|
| **`#5675`** ⭐ | 候选窗飘角（resize 后） | **stock Tauri 默认配置 + 裸 `<input>`** 即复现；韩文 IME / 左上角；**鼠标一动即清除**；页末「*No response*」；提交者自列已排除：子窗口几何（28ms 内已更新）、主线程阻塞、页面侧 caret rect、`MoveFocus(PROGRAMMATIC)`、`NotifyParentWindowPositionChanged()`×10 |
| **`#5625`** | contentEditable 吃字 / 标点双按 | Runtime 149；同页 `textarea` 正常；**JS 侧缓解无效** |
| `#1611` | 候选窗不随窗口**移动** | 日文 IME，WPF，微软「opened it on our backlog」，至今无修复 |
| `#2241` | 微软拼音，WinUI/Win11 | 缩放>100% 恒错位；报案人原话「拖窗时不点 WebView2 控件，它就显示在旧位置」 |
| `#5570` | RDP + composition 模式 | ⚠️ 前提（**composition 模式**）在 solo **不成立**（wry 走 windowed controller，全仓 `grep -i composition` 零命中） |
| `#1610` | 同族旧账 | 2024 关闭，当前运行时仍可复现 |
| `tauri#15436` | Windows WebView2 IME/TSF 首焦点冻结 | 2026-05 开 |

**微软官方 workaround（`#2290`，Eilon[MSFT]）**：`Margin ±1px` → `UpdateLayout()` → 还原。作用＝让打开的弹层自动关闭。**用户实测有效但会抖/闪** ⇒ 与本项目「丝滑」铁律冲突。
⚠️ 该 workaround 对象是 **HTML `<select>` 下拉窗 + XAML 托管层**，对 wry **无移植性**，只能作「同族有先例」论据。

---

## 5. 已落地改动（2 项，均在 `origin/master`）

| 项 | 提交 | 有效性 |
|---|---|---|
| `src/components/Editor/tiptap/composition-freeze.ts`（组字态唯一真相源，导出 `isFrozen` / `mapFrozenDecorations` / `createCompositionTracker`） | `21a028b` | 对「组字期 DOM 干净」有效；**对飘角不是解药**（`#5625` 已证 JS 层抑制 DOM 无效） |
| `src-tauri/tauri.conf.json:27` 加 `"additionalBrowserArgs": "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,TSFImeSupport"`（回退 IMM32） | `9a27bad` | **无任何证据**（见下） |

**硬约束**：wry 的规则是**一旦设置 `additionalBrowserArgs` 就完全替换其默认值** ⇒ 必须自带 `msWebOOUI,msPdfOOUI,msSmartScreenProtection` 三个，否则 mini-menu / PDF / SmartScreen 行为回归。

> ⚠️ **`TSFImeSupport` 有效性至今无任何证据**。A/B 测量台（测候选窗相对光标的偏移向量）产出 `ime-ab-baseline.json` 与 `ime-ab-imm32.json` **除 `label` 外逐字段完全相同** ⇒ 对「flag 是否生效」**零分辨力**（未触发失锚时两条链路画出来本就一样）。**唯一事实是「flag 进了进程命令行」**。

---

## 6. 已排除（勿重复验证）

| 假设 | 排除依据 |
|---|---|
| DPI / 多屏换算 | 实测**单显示器 1920×1080 / 96 DPI（100%）**仍发作 |
| `content-visibility` | 已门控在 `html.doc-heavy`（50 万字符阈值），小文档不启用 |
| 「焦点空窗」 | 切走→切回，`document.hasFocus()` 仅 **<10ms** 一跳即恢复 |
| 「光标跑到视口外」 | `focus('start')` 会同步滚动到光标；**2893 采样点 0 例外** |
| 切窗口 / 切文档 / 移窗口（含组合）后立刻打字 | **35 次对照实验零复现**；且候选窗坐标**精确跟随窗口移动**（窗动 22px、候选窗同步动 22px） |
| 千问「窗口移动 → 坐标缓存过期」 | n=2 且不自洽（移动 +265px 后 5.3s 组字**正常**；移动 −202px 后 12.6s 组字**失锚**）；且 stale 原点只能造成「偏移一个位移量」，解释不了角位恒定 |
| 「候选窗超出应用窗口 = bug」 | **不是 bug**：长候选词正常溢出，系统只保证不出屏 |
| 组字期装饰重建是元凶 | 源码级证伪：`prosemirror-view` 的 `InlineType.eq` = `compareObjs(attrs) && compareObjs(spec)`（**值比较**）⇒ spec/attrs 相同的装饰「移除后原样加回」**不会重建 DOM** |
| 换输入法 | 2026-09-24 用户换豆包输入法后**症状完全相同** ⇒ 病根在宿主给的坐标，不在输入法 |

---

## 7. 已证伪的死路（别再走）

| 死路 | 证伪方式 |
|---|---|
| `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` **env 注入** flag | WebView2 环境崩溃（复现 3 次），`wmic` 证实 flag **从未**进进程命令行 ⇒ 只能走 `tauri.conf.json` |
| `NotifyParentWindowPositionChanged()` | wry **已在** `WM_MOVE\|WM_MOVING` 调它；上游提交者手动 **×10（0~1100ms）无效** |
| `MoveFocus(PROGRAMMATIC)` | 上游实测无效 |
| JS 层「组字期抑制 DOM 变更」当解药 | `#5625` 作者实测**无效** |
| 宿主层 `ImmSetCandidateWindow` 钳制候选窗 | **前提不成立**：候选窗无 HWND ⇒ 只能像素采样；且与已落地 `TSFImeSupport` 路径交互 |
| 高 DPI / 多屏坐标归一化 | 与自家取证（100% 单屏仍发作）**自相矛盾** |
| 透明输入代理层（隐藏 textarea 当锚） | 对飘角无效（裸 input 也中）；只对「吃字」可能有意义 |
| 升级 Tauri / wry 依赖 | wry **已与上游复现环境同版本 0.55.1**；运行时已到 153（且 153 自带输入冻结 bug）⇒ 无收益有反向风险 |
| 换 Electron / CEF | 仍是 Chromium，同族风险不减；体积/维护代价大 |
| 换掉 WebView2 | wry 在 Windows **只有 WebView2 一种引擎** ⇒ 物理不成立 |
| 长期挂任何无证据的开关 | 项目纪律：测不出差别就撤 |

---

## 8. 补丁历史：「鼠标注入重锚」三版全部实测无效（已终审封存）

> 「任何鼠标事件立即清除失锚」是本案**唯一有观测疗效**的机制（上游提交者 + 我方多次观测 + 35 次自动对照零复现的反证）。于是把解药自动化：由 Rust 注入合成鼠标事件。

| 版本 | 设计 | 结果 |
|---|---|---|
| **v1 `2ab8776`** | 挂 `Resized` + `Focused(true)`，注入零位移 `SendInput` | **无效**——Windows 拖窗不发 `WM_SIZE` ⇒ `Resized` **从未开火**（见 §3.2） |
| **v2 `bed5f3b`** | ① 触发器补 `WindowEvent::Moved`；② 注入改为「移开 1px → 停 15ms → 移回原坐标」；③ 鼠标按键空闲门控（2s 上限）；④ 去抖 200→120ms | **无效**——触发器开火了也没用。**⭐ 由此定性：事前注入防不住**，失锚发生在组字开始那一刻，而解药只在候选窗**已存在之后**才有效 |
| **v3 `001f358`** | 治疗层：前端 `composition-freeze.ts::track` 挂 `compositionstart` → invoke `ime_nudge_soon`；Rust 侧仅当 15s 内动过窗口几何/切过焦点才响应，在 **+250ms / +900ms** 各注入一次。日志自诊断 `%LOCALAPPDATA%\com.solomarkdown\logs\ime-nudge.log` | **无效（日志铁证）**：`composition armed → delay=250 ok=true → delay=900 ok=true` 全部开火且全部成功，候选窗照样钉死 |

**⭐ 终审结论（2026-09-24 04:34，用户令收工）**：v3 日志证明**注入期间组字活跃、注入全部成功、候选窗仍钉死** ⇒ 「合成鼠标输入能治愈失锚」**终证为伪**。结合手动晃鼠标能自愈 ⇒ 治愈依赖**真实硬件级输入**，从 solo 进程内部（SendInput / SetCursorPos）**不可达**。**输入注入通道穷尽，此路封死。**

- **遗留瑕疵（已登记不修）**：`compositionstart` 监听在多插件实例上重复挂载 ⇒ 每次组字触发 **4 次 armed / 8 次注入**。1px 净零位移、肉眼不可见、无功能影响。
- **整体撤销命令**：`git revert 001f358 bed5f3b 2ab8776`。
- **教训（本档早已写明却未回读）**：触发规律就写在 §0 第 3 条与 topics 里；选触发器时没回查 ⇒ 漏了 `Moved`。**动本模块前先通读本档。**

---

## 9. 四道系统性障碍（为什么查了这么多仍定位不了）

| # | 障碍 | 说明 |
|---|---|---|
| 1 | **不可观测** | 候选窗由 `TextInputHost.exe` 的 UWP 合成层绘制、无 HWND；UIA 路线被本机安全策略拦；Chromium 自绘光标（`hwndCaret=None`）⇒ **只能截屏数像素**（判据＝选中项高亮 `#A6D8FF` + 形状约束） |
| 2 | **不可复现** | 触发窗口极窄 + 「鼠标一动即自愈」⇒ 自动化里先动鼠标＝自己把 bug 擦了。实测 **35 次对照零复现**、**14 试次 / 120 次键盘注入零复现** |
| 3 | **不可证真** | 由 2 直接推出：任何修法无法 A/B 验证。**测试跑绿 ≠ 修好了**；每次「修」本质上都是赌 |
| 4 | **环境漂移** | WebView2 是 Evergreen 运行时：全部历史实验跑在 `152.0.4191.66`，本机已漂到 `153.0.4234.x`（09-17 记 `.32`、09-23 实测 `.48`，**同一 153 内小版本也在漂**）。且微软已承认 **Edge 153 存在「输入/交互冻结」bug**（2026-09-16；临时方案回退 152）。⚠️ 153 的已确认症状是**冻结**，与**飘角**不同 ⇒ 153 是**嫌疑非已证原因** |

> **版本号一律当场实测，勿抄本文档**：`C:\Program Files (x86)\Microsoft\EdgeWebView\Application\` 下的版本目录，或注册表 `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-…-E4C5}` 的 `pv`。

---

## 10. 外部建议评估（5 份，均未采纳为主体方案）

> **处置纪律**：外部建议只作为**线索来源**，采纳前一律回第一现场取证；对第三方陈述**只给观测、不给推断**。
> **五份的共同缺口**：都没有回答「**怎么知道修好了**」——正撞 §9 障碍 3。

| 份 | 主张 | 判定 |
|---|---|---|
| ① | 候选窗位置由 `composition rect` 决定；短期焦点 resync；长期推上游加 IME 接口桥接 | 仅**术语层可吸收**（`composition rect` 比「光标矩形」规范）。「100% 符合」不可证伪；焦点 resync **撞上游已排除项**；**WebView2 现有 API 无任何 IME / candidate rect 接口**（焦点相关仅 `MoveFocus` / `MoveFocusRequested`）⇒ 属**诉求非解法** |
| ②（桌面 `md-solo.md`，分层防御） | P0 升级 + 补 `NotifyParentWindowPositionChanged`；P1 前端 resync；P2 宿主层 `ImmSetCandidateWindow` 钳制；查无边框/透明窗口消息路径；诊断字段；issue 写法 | P0-1 **无收益有风险**；P0-3 **同族动作已被实测证伪**；P2 **前提不成立**；物理像素混用**已核实不存在**；**诊断字段 / issue 写法可吸收** |
| ③ | 与 ② 同源（分层框架 + 代码级抓手：PerMonitorV2 / bounds 物理像素 / 无边框透明） | 判定同上；新增诊断字段清单已吸收 |
| ④ | 对我方资料的复核（8 条判定） | **2 条成立**（「第二次自愈」表述过简；最小复现应由我方自证）、4 条错或多余、1 条口径不可比。**含 1 条方向性风险**：漏读「WorkBuddy 20+ 分钟零异常」对照，因而得出「编辑器代码可正式出局」——那会把**窗口形态**这条唯一自证的最强线索一起丢掉 |
| ⑤ | 解决方案 v1（先造尺子：热键取证器 → 2 周基线 → 候选干预） | **五份里质量最高**：结构、标注纪律、留/撤规则都对，主线「先测量后修法」**成立**。但有 **1 处硬错误**（`#5676` 实为 mouseleave/dragover 问题，**非同族**，不要 @ 联动）+ 1 处无法背书（`TSFImeSupport` 一手来源打不开 ⇒ 风险应上调）+ 3 处口径瑕疵 + 1 处落地成本漏算（W1 需新增 2~3 个依赖与 capability）。**方向可采纳，细节须修订** |

---

## 11. 跨 agent 双向核对（2026-09-24，4 争议**全部闭合**）

> 双方：WorkBuddy（W）/ OpenCode（O）。**对等核对，不做裁决。**

| 争议 | 结论 |
|---|---|
| ① 是否撤掉 `TSFImeSupport` flag | **已一致：不撤**。O 的理由＝症状先于 flag，撤了等于把原始 bug 请回来；W 撤回自己「低风险」的定性（默认路径即原始 bug 所在路径） |
| ② `(782,706)` 是候选窗还是 `cmd.exe` 滚动条 | **O 已认输撤回**。铁证：滚动条不可能 51 帧都在、不可能宽随内容跳档、不可能底部伸到 750（cmd 底在 720）。**`WindowFromPoint` 会「穿透」无 HWND 的候选窗** ⇒ 命中 cmd 恰是「候选窗在此」的自证 |
| ③ flag 是否有正面效果 | **已一致：无任何证据**。O 自行作废其引用的 `ime-ab` 数据（env 注入从未生效，两次测的都是 TSF 基线） |
| ④ 「抖鼠标」补丁是否值得做 | **「该做」已一致**（事后证明无效，见 §8）；当时分歧仅为时机（O 主张立即 / W 主张改代码须用户授权） |

**认账清单（双方各自撤回的错误，防止重犯）**：`ime-ab` 数据作废（O）· 「低风险」定性不准（W）· 「撤了就好」因果方向错（W）· A/B 零分辨力（双方）· 帧数口径「50 帧」漏计 1 帧（W）· 「`(782,706)` 是 cmd 滚动条」（O，认输）· 「病可能不存在」的隐忧（O，撤回）。

**遗留 4 问（未决，按影响权重排序）**
1. 「残留窗位置 ＝ 组字期位置」这一等号是否成立？（不成立则 45 帧锚点数据的证明力需重估）
2. 「TSF 与 IMM32 在拿不到有效坐标时各自回退到固定位」是否为已知上游机制？（未核实）
3. Runtime 152→153 与 flag 引入**时间重叠**，跨期坐标差异如何归因？（均承认受混淆，未解决）
4. 补丁验收标准如何设定（在无法截取组字中帧的前提下）？（均未给出可操作判据）

---

## 12. 若重启：执行顺序与候选干预

> **全部待拍板、未执行。** 总原则：先造尺子（取证）再谈修法，每项挂「测不出就撤」。

```
W0 环境地基（发版清单加「记录 WebView2 版本 + 人工 IME 冒烟」；可选锁 152；每周 release-notes 探针扫 IME/candidate/composition）
   ↓
W1 取证器落地 → 攒 30 个会话段基线（量当前 flag 是否已生效）
   ├─ 0 命中 → flag 有效，标 [已缓解]，观察期继续 → 完
   └─ 有命中 → 进 W3
W2 最小复现自证（stock Tauri 默认配置 + 裸 <input> + 锁版本 + resize→零鼠标打字，>30 轮）
   ├─ 复现   → 窗口形态划掉，「平台缺陷」结论加固
   └─ 不复现 → 窗口形态成 solo 独有差异 → 长期观察（C5）
W3 候选干预按 C1 → C2 → C3 →（C5/C6）逐个：先过 ime-ab 无回归 → 再开测量窗口 → 30 会话段判定
```

**统计判定**：`0/30` 相对历史 16% 基线＝**单样本二项检验** `0.84³⁰ ≈ 0.005`（非 Fisher）。有显著改善 → 留；无改善或不可测 → **撤**。

| 候选 | 内容 | 风险 | 备注 |
|---|---|---|---|
| **C1** | Rust：`WM_EXITSIZEMOVE` 后 `put_Bounds(当前值)` 强刷几何（真动 controller bounds，不需 fork wry，`window.rs` 已有 `with_webview`） | 低～中 | ⚠️ **「先试同值」顺序可能反了**：`#2290` 官方绕法恰恰是「改值再还原」，同值很可能被内部按「未变化」短路 ⇒ 大概率要直接上 ±1px |
| **C2** | Rust：几何/焦点边界后预防性注入一次合成 `WM_MOUSEMOVE`（`PostMessage` 到 `Chrome_RenderWidgetHostHWND`） | 中 | ⚠️ **已被 v1/v2 实测证否**（事前注入防不住）；且目标 HWND 有 3 个候选，机制小实验须三选全试 |
| **C3** | 前端：focus / 切文档 / resize 结束后延迟 300ms `view.focus()` | 中 | **唯一触碰前端组字敏感区**（AGENTS 禁令第 8 条）⇒ 降到最后，或限定「仅 `!view.composing` 时」 |
| C4 | 保留现状 flag，纳入 W1 基线测量 | — | 测不出独立贡献再考虑撤 |
| C5 | 视 W2 结果：切 `decorations:true` + `transparent:false` 跑一轮 W1 | 中 | 仅当 W2 不复现时启用 |
| C6 | 兜底：`put_IsVisible(false→true)` 闪切 | 高 | 强制 surface 重建，**可见闪烁**，与「丝滑」铁律冲突，默认不动 |

**明确不做**：换 Electron/CEF/换内核 · 换 WebView2 · 升级 Tauri/wry · `ImmSetCandidateWindow` 钳制 · JS 组字期抑制 DOM · 高 DPI 归一化 · 输入代理层 · **长期挂无证据开关**。

---

## 13. 历史测试数据

| 项 | 数据 |
|---|---|
| 现场采样（63 分钟探针） | 1606 候选窗帧 / 真失锚 **21 帧**（全在 solo）/ 命中率 **16%** / 对照组零失锚 |
| 自动化复现 | 7 场景 × 5 轮 = **35 次零复现**；确定性复现 **120 次键盘注入 / 14 试次零复现**；累计有效试次 **12 次零复现** |
| 相关性（弱，勿当结论） | 「首次组字前窗口被移动过」失锚段 100% vs 正常段 20%，Fisher 单尾 `p≈0.039`——但 **n=2**；换紧口径（移动后 ≤2.2s 内组字）→ `p≈0.41`，**不显著** |
| A/B 测量 | 基线 6/6 判定成功、偏移恒定 `(dx=8, dy=27)`；**但对 flag 零分辨力** |

**原理性结论**：用「干净新实例 + 理想时序」的自动化复现，**原理上打不到这个 bug**。它只在用户**长时间运行的真实实例 + 真实操作序列**（含鼠标、滚轮、拖窗、长时间停顿）下偶发。

### 13.1 实验方法论坑（取证前必读）

| 坑 | 说明 |
|---|---|
| 判据会**假阴性** | 蓝色壁纸上全屏蓝像素 bbox 会把天空/湖面圈进来 ⇒ 明明有候选窗却报「未检出」。对策：基线差分 + 逐行最长连续 run 聚簇（**基线必须在移窗之后抓**） |
| 判据也会**假阳性** | 曾把候选窗本体误判为「背景窗口 UI」。**教训：判据的「位置先验」（必须在角落）会把真实但形态不同的现场判成噪声；下结论前必须裁剪放大肉眼复核** |
| CDP 表达式语法错误会**静默吞真相** | 对象字面量写成 `{ce:…, s=getSelection()…}` 是语法错误 ⇒ `Runtime.evaluate` 抛异常被 try 吞掉。**必须用 `key:value`** |
| 抢前台静默失败 | `SetForegroundWindow` 从后台进程调用会被系统拒绝 ⇒ 需「轻点 ALT 解锁」再抢 |
| 页面节流伪造现象 | 窗口不在前台 → Chromium 节流页面 → 滚动/输入根本没执行 ⇒ **实验前必须校验 `GetForegroundWindow() == 目标`**（曾因此得出错误结论并撤回） |
| 拖标题栏后丢键盘焦点 | WebView 可能丢键盘焦点 ⇒ 组字不再触发（`SetFocus` 到 `Chrome*` 子窗可交还，且不产生鼠标事件） |
| 反复 Shift 切中英会把实例搞到死状态 | **换干净实例**比继续试快得多 |

---

## 14. 我们明确知道自己**不知道**什么

| 项 | 状态 |
|---|---|
| 精确根因（哪一行 / 哪个时序） | ❌ **未定位**。无观测通道，微软未确认 |
| 「病灶在 WebView2 托管层」 | ⚠️ **强推断，非定论**（三重证据指向，但微软 0 回复） |
| 「solo 窗口形态放大了命中率」 | ⚠️ **候选假设，无实验证据**（上游默认配置也复现 ⇒ 非必要条件） |
| 「运行时 153 导致最近失锚」 | ⚠️ **嫌疑，非已证**（153 已确认症状是「交互冻结」，与飘角不同） |
| `TSFImeSupport` flag 的有效性 | ❌ **无任何证据** |
| 「WebView2 构建是否仍响应 `TSFImeSupport`」 | ❌ **未核实**（Chromium issue 40489775 / commit `ddcdbef` 打不开；旁路检测 `msedge.dll` 中该串 0 命中，但同法检 `ImmGetContext` 亦为 0 ⇒ 此法不能证否） |
| 「锚点 = 鼠标屏幕位置」 | ❌ **不获支持、未排除**。唯一支撑已撤销；抓帧结束实测鼠标 `(1097,211)` ≠ `(782,706)`。残留线索只有「鼠标一动即自愈」（说明鼠标是**刷新触发器**，不必然是**锚点来源**） |
| 「禁用 TSF 后中文 IME 忽略 `ImmSetCandidateWindow()`、改用 `GetCaretPos()`」 | ❌ 未核实（未打开 Chromium 源码逐字核对） |
| 「VSCode / MarkText 等同族软件也会中招」 | ❌ 未核实 |
| 社区做法（Google Docs 隐藏 textarea 当锚 / ProseMirror `domchange.ts`） | ❌ 仅有检索旁证，未逐条打开一手来源 |
| 「残留窗位置 = 组字期位置」 | ❌ **未自证**（热键取证器抓不到组字现场） |

---

## 15. 档案索引

### 15.1 文档

| 路径 | 性质 |
|---|---|
| [`docs/IME-CANDIDATE-WINDOW.md`](./IME-CANDIDATE-WINDOW.md) | **本文**（主题唯一入口） |
| [`docs/archive/IME-CANDIDATE-WINDOW-PLAN.md`](./archive/IME-CANDIDATE-WINDOW-PLAN.md) | 原件：工作起点（规划 + 4 轮复查 + 全量档案清单） |
| [`docs/archive/IME-CANDIDATE-WINDOW-REPORT.md`](./archive/IME-CANDIDATE-WINDOW-REPORT.md) | 原件：**对外自包含交接报告**（给外部专家） |
| [`docs/archive/IME-CANDIDATE-WINDOW-SOLUTION-2026-09-23.md`](./archive/IME-CANDIDATE-WINDOW-SOLUTION-2026-09-23.md) | 原件：解决方案 v1 + 我方复核记录（§12） |
| [`docs/archive/IME-CANDIDATE-WINDOW-观点对照-2026-09-24.md`](./archive/IME-CANDIDATE-WINDOW-观点对照-2026-09-24.md) | 原件：跨 agent 双向观点对照（含 O 的认输回执） |
| [`.workbuddy/memory/topics/ime-candidate-window.md`](../.workbuddy/memory/topics/ime-candidate-window.md) | ⭐ **证据真理源**：原始取证 / 实验流水 |
| [`docs/solo输入法合成冻结总闸方案-2026-09-13.md`](./archive/solo输入法合成冻结总闸方案-2026-09-13.md) | 历史提案（千问「合成冻结总闸」），**部分前提已被证据推翻**，留痕用 |

### 15.2 相关章节

| 位置 | 内容 |
|---|---|
| [`docs/KNOWN-ISSUES.md`](./KNOWN-ISSUES.md) §一 **#4** | IME 候选栏变箭头（`ime-mode: active`，已删除） |
| 同文件 §一 **#15** | 失锚三层修复（事务层装饰重建 / 渲染层 `content-visibility` / 布局层 `ErrorBoundary` 丢 class） |
| 同文件 §二 **#8** | **判定外部缺陷、编辑器层封顶**（止损决策 + 最完整的历史叙述） |
| [`docs/cjk-boundary.md`](./cjk-boundary.md):153 / :172 / :182 | `ime-mode: active` 的加入与 2026-07-20 撤销 |
| [`docs/CHANGELOG.md`](./CHANGELOG.md):46 / :52 / :175 / :186 | v1.2.x 各版修复条目 |

### 15.3 代码（真相源，改动前必读）

| 位置 | 作用 |
|---|---|
| [`src/components/Editor/tiptap/composition-freeze.ts`](../src/components/Editor/tiptap/composition-freeze.ts) | **组字态唯一真相源** |
| [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json):23-27 | 窗口配置：`decorations` / `transparent` / `additionalBrowserArgs` |
| [`src/components/Layout/CustomTitlebar.vue`](../src/components/Layout/CustomTitlebar.vue):17-34 | 自绘标题栏 + `data-tauri-drag-region` |
| `src-tauri/src/commands/window.rs::ime_nudge` | 鼠标注入补丁（v3，无效但留在代码里） |

### 15.4 测试资产 `.sandbox-ime/`（672 MB · 2297 张截图 · 2271 份日志）

> ⚠️ **含已抓到的失锚现场原始帧（不可再生），请勿清理。**

| 资产 | 说明 |
|---|---|
| `ime-watch.py` + `run-ime-watch.bat` | 候选窗像素监视探针（**首次抓到现场靠它**） |
| `wb-cand-detect.py` / `wb-cand-scan.py` | 候选窗定位（`#A6D8FF` 容差 24 / 行 run 聚簇）+ 全量 png 扫描 → `wb-cand-scan-out.csv` |
| `wb-cand-out/` | 候选窗裁图（含 `chk-0222-783x707.png` / `chk-0202-underlay.png`，**§2.2 争议的可复核证据**） |
| `ime-ab.py` + `ime-ab-baseline.json` / `ime-ab-imm32.json` | A/B 偏移测量（**已复核：除 label 外完全相同 ⇒ 无分辨力**） |
| `det-repro.py` / `auto-repro.py` / `auto_repro_lib.py` / `trigger-rate.py` | 确定性复现与触发率测量 |
| `exp-focus.py` / `exp-scroll.py` / `exp-viewport.py` | 焦点 / 滚动 / 视口三变量实验 |
| `judge2.py` / `judge3.py` / `recap.py` | 判据脚本（⚠️ `recap.py` 判据有缺陷：要求「蓝条贴右下角」，把 38 帧真失锚判成 OK） |
| `cdp.mjs` | **零依赖** CDP 求值客户端（Node 内置 WebSocket） |
| `crop-A-full.png` / `crop-C-cand.png` / `crop-F-784.png` / `abnormal-10x.png` | **现场证据图** |
| `logs/ime-watch-20260913-195550.log` | **63 分钟原始日志**（全部定量结论的来源） |

> **可复用技巧**：`.ProseMirror` DOM 元素上**直接挂着 TipTap `editor` 实例**（`document.querySelector('.ProseMirror').editor`）⇒ 无需绕 Vue 内部结构即可编程驱动编辑器。
> **依赖口径**：读图脚本需 PIL + numpy ⇒ 用**系统 Python** `D:\Python312\python.exe`（WorkBuddy 托管 Python 3.13 无这两个包）。

### 15.5 工作日志（按时间序，★ = 核心取证轮）

| 日志 | 内容 |
|---|---|
| `.workbuddy/memory/2026-09-05.md` | 起点：真机组字期诊断（`ime-diag.ts`），应用层干净 |
| `.workbuddy/memory/2026-09-12.md` | 用户诉求首次明确成型 |
| `.workbuddy/memory/2026-09-13.md` ★ | **首次抓到失锚现场** + 全量采样定量分析 + 35 次零复现 |
| `.workbuddy/memory/2026-09-14.md` ★ | 确定性复现实验 + A/B 测量台 + 总闸/flag 落地 + 上游「双胞胎」检索 |
| `.workbuddy/memory/2026-09-17.md` | 第一、二轮复查（含运行时漂移到 153） |
| `.workbuddy/memory/2026-09-23.md` ★ | 五份第三方建议评估 + 对外表述纪律 |
| `.workbuddy/memory/2026-09-24.md` ★ | 三轮取证 + 补丁 v1/v2/v3 + 跨 agent 双向核对 |

> ⚠️ 早期日志（06-30 / 07-19~07-23 / 08-04 / 08-21 / 08-31 / 09-11）中的「命中」经复核为**误匹配**（子串 `composition` / `IME` 出现在字体、parser 等无关行），**无 IME 专题内容**。

### 15.6 上游链接

| 用途 | 链接 |
|---|---|
| 候选窗飘角（**战略转折点**） | https://github.com/MicrosoftEdge/WebView2Feedback/issues/5675 |
| contentEditable 吃字（JS 层无效铁证） | https://github.com/MicrosoftEdge/WebView2Feedback/issues/5625 |
| 同族 | `#1611` / `#2241` / `#5570` / `#1610`（同仓库） |
| 微软官方 workaround | `#2290`（`Margin ±1px` + `UpdateLayout()`） |
| Edge 153 输入冻结 | 微软 Edge 已知问题页 + https://status.salesforce.com/generalmessages/20000264 |
| Tauri 侧同族 | `tauri-apps/tauri#15436` |
| CEF 同症状先例（供推上游加接口用） | CEF issue `#4070`（微软拼音 / 首次输入位置错 / 报告者明写 `ImmSetCandidateWindow` 无效） |
| 「吃字」族的 Chromium 本体单 | Chromium Issue `#523134891`（149+ 回归，**已修于 Chrome 151.0.7888.0**）⇒ 反向印证 §2.4 切分：**吃字族上游已修；飘角族只在 WebView2Feedback 有单、零修复** |

---

**合并**：2026-09-30（由 PLAN / REPORT / SOLUTION / 观点对照 四份蒸馏，原件移入 `docs/archive/`）
**代码基线**：solo v1.2.56 ｜ **问题封存**：2026-09-24 04:34
