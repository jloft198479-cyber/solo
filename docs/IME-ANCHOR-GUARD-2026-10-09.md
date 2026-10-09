---
title: IME 候选窗失锚 · 重锚护栏修复档案（可追溯）
type: record
audience: agent
status: active
tags: [ime, 输入法, 候选窗, 修复档案, 分支, 可回滚, webview2]
summary: 「blur → 隔 60ms → focus」重锚护栏的修复过程档案：分支/回滚点/验收判据（提前定死）/阶段记录/退出条件。跟随分支 fix/ime-anchor-guard，未验证前不合并 master。
updates: [docs/IME-CANDIDATE-WINDOW.md, docs/KNOWN-ISSUES.md, src/components/Editor/tiptap/composition-freeze.ts]
---

# IME 候选窗失锚 · 重锚护栏修复档案

> **本档案跟随分支 `fix/ime-anchor-guard`，与代码同进退。**
> 目标：验证「窗口缩放后把可编辑元素重锚一次」能否根治候选窗飘角。
> **未经验证不得合并 master。**

---

## 0. 一句话与当前状态

| 项 | 值 |
|---|---|
| **做法** | 窗口尺寸稳定后（防抖 120ms）把可编辑元素重锚一次：`blur()` → 隔 60ms → `focus({preventScroll:true})` + 还原选区与滚动 |
| **来源** | [`observer130/lanmark` commit `ba451f0`](https://github.com/observer130/lanmark/commit/ba451f06178dbb08d6f97b9f5d53b46b26aca5e9)（2026-10-07），引用同一上游 `MicrosoftEdge/WebView2Feedback#5675` |
| **分支** | `fix/ime-anchor-guard`（自 `55bbbc1` 开出） |
| **基线提交** | `55bbbc1` |
| **当前阶段** | 阶段 2（实现 + 闸门）—— **已完成**，代码已提交本分支 |
| **状态** | 🟢 **待真机验收**（阶段 3，简乐执行） |

---

## 1. 分支与回滚（安全网）

| 目的 | 命令 / 说明 |
|---|---|
| 回到修复前 | `git checkout master` |
| 丢弃本次修复（不留痕） | `git branch -D fix/ime-anchor-guard` |
| 保留档案但回滚代码 | `git checkout master -- src/` （档案在 `docs/`，不受影响） |
| 查看本分支改了什么 | `git diff master..fix/ime-anchor-guard --stat` |
| 阶段性存档 | 每阶段结束 `git commit`（本地），**按项目约定不 push** |

> **证据不随分支回滚**：外部解法已另存于 master 的 `docs/IME-CANDIDATE-WINDOW.md` §16 与 `docs/IME-问题简报与资料汇编.md`，分支删除也不丢。

---

## 2. ⭐ 验收判据（**提前定死，不许事后改**）

> 本项目 2026-09 的死穴是「**不可证真**」：35 次自动实验零复现 ⇒ 修没修好说不清。
> 本次用**临时 A/B 开关**绕过该死穴——同一台机器、同一操作，开/关各测，直接对比。

### 2.1 真机操作（简乐执行）

1. 打开 solo，打开任意一个 md 文档，把光标点进正文。
2. **用鼠标拖窗口边框缩放**（不是最大化；拖完松手）。
3. 松手后**立刻**敲中文（拼音），**全程不碰鼠标、不点别处**。
4. 看候选框落点：

| 观察 | 判定 |
|---|---|
| 候选框**贴在光标下方** | ✅ OK（护栏有效） |
| 候选框**飞到屏幕角 / 远离光标** | ❌ HIT（失锚） |

### 2.2 A/B 对照（关键）

同一操作，**护栏关** 做 2 轮、**护栏开** 做 2 轮，填入 §4 记录表。

**判定标准**：
- 关 = HIT、开 = OK，且 ≥2 轮一致 → ✅ **有效**，进入阶段 4（定案）。
- 关 = HIT、开 = HIT → ❌ **无效**（护栏没起作用）。
- 关 = OK、开 = OK → ⚠️ **本轮未触发失锚，数据作废**，改天重测（不判定成败）。

> ⚠️ **"关也要能测出 HIT"是有效性的前提**。若连"关"都测不出失锚，说明本次没触发 bug，不能据此说护栏有效。

### 2.3 必录字段（每轮）

| 字段 | 说明 |
|---|---|
| WebView2 运行时版本 | 当场实测，勿抄本文档（见 §6 查法） |
| solo 版本 | 设置/关于页 |
| 护栏开关状态 | 开 / 关 |
| 缩放前 → 缩放后窗口尺寸 | 拖边框改变大小 |
| 打的拼音串 | 如 `nihao` |
| 候选框落点 | 光标下方 / 屏幕角（大致坐标可选） |
| 判定 | OK / HIT / 作废 |

### 2.4 不退化检查（护栏开时同步确认）

- [ ] 拖窗口不丢字、不打断正在打的字
- [ ] 光标位置、选区、滚动位置**没有被护栏改变**（这是护栏必须保证的）
- [ ] 正常打字（不拖窗口）无任何异样
- [ ] 大文档（≥50 万字符）下无卡顿

---

## 3. 阶段划分（每阶段结束汇报，等指令再进下一步）

| 阶段 | 内容 | 是否碰产品代码 | 状态 |
|---|---|---|---|
| **0** | 证据进 master + 开分支 + 建本档案 + 判据定死 | ❌ 否 | ✅ 完成 |
| **1** | 实现护栏：新建 `tiptap/ime-anchor.ts`，走 `composition-freeze.ts`；挂 resize 防抖；带**临时 A/B 开关** | ✅ 是 | ✅ 完成 |
| **2** | 闸门：`vue-tsc --noEmit` / `vitest` / `vite build`（沙盒）/ `eslint` | ❌ 否 | ✅ 完成 |
| **3** | **真机验收**（简乐按 §2.1 操作，A/B 各 2 轮），结果写入 §4 | ❌ 否 | ⬜ 待做 |
| **4** | 定案：有效 → 删临时开关、合并 master、更新文档；无效 → 保留档案、回滚、转观察 | ✅ 视结果 | ⬜ 待做 |

---

## 4. 真机验收记录表（阶段 3 填写）

| # | 日期 | WebView2 版本 | solo 版本 | 护栏 | 窗口缩放 | 拼音串 | 候选框落点 | 判定 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | 关 | → | | | | |
| 2 | | | | 关 | → | | | | |
| 3 | | | | 开 | → | | | | |
| 4 | | | | 开 | → | | | | |

**汇总**：关 = ___ HIT / ___ OK；开 = ___ HIT / ___ OK ⇒ 结论：__________

---

## 5. 实现要点（阶段 1 动手前必读）

### 5.1 敏感区（硬约束）

- ⚠️ **触碰 AGENTS.md 禁令第 8 条（组字态）** ⇒ 必须走 `src/components/Editor/tiptap/composition-freeze.ts`，**不得**再造第 5 份 `let liveView`。
- ⚠️ 禁令第 13 条：属「时序 / UI / IME / 异步」改动 ⇒ 单测只是入场券，**真机手感是通行证**。
- ⚠️ 禁令第 11 条：不许用"加守卫"掩盖根因 —— 本项是**宿主层缺陷下的止损绕法**（与微软 `#2290` 同级），须挂「测不出就撤」。

### 5.2 待定设计点（阶段 1 定，记录在此）

| 点 | 方案 | 理由 |
|---|---|---|
| 触发事件 | 先**只挂 `resize`**（与 Lanmark 一致） | 最小改动、最可对照；我们的"切文档/切焦点"触发留给后续扩展 |
| 防抖 | 120ms（Lanmark 实测值） | 拖动期间 resize 连发，须等稳定 |
| blur→focus 间隔 | 60ms | 同步/`setTimeout(0)` 会被渲染进程合并；ProseMirror 对间隔不敏感 ⇒ 60ms 够稳 |
| 平台门控 | 仅 Windows（UA 判 `Windows`） | Linux/macOS 输入法行为不同，不做 |
| 合成中 | pending → 等 `compositionend` 补做 | 不打断组字、不吞预编辑 |
| **临时 A/B 开关** | `localStorage['solo:imeAnchorGuard']==='off'` 即停用（**即时生效，无需刷新/重启**） | Console 一行命令即可开/关；验证完**必须删除**，不留无证据开关进产品 |
| 大文档 | 是否随 `isHeavyDocument()` 降级 | 待定 |

### 5.3 已知风险

| 风险 | 概率 | 影响 | 措施 |
|---|---|---|---|
| 无效（本 bug 触发面比 Lanmark 宽） | 中 | 白做一轮 | 按 §2.2 判定，无效即回滚，档案保留 |
| 60ms 的 blur 窗口打断输入 | 低 | 吞字 | pending 机制规避；阶段 3 重点验 |
| 误改选区/滚动 | 低 | 体验瑕疵 | 护栏自带保存/还原；阶段 3 的不退化检查覆盖 |
| 只治"缩放"、没治"切文档/切焦点" | **中高** | 部分缓解 | 阶段 3 若 resize 有效，再评估是否扩展触发面 |

---

## 6. 环境查法（版本号一律当场实测，勿抄本节）

| 项 | 查法 |
|---|---|
| WebView2 运行时版本 | 目录 `C:\Program Files (x86)\Microsoft\EdgeWebView\Application\` 下的版本目录；或注册表 `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-…-E4C5}` 的 `pv` |
| solo 版本 | 应用内设置/关于页；或 `package.json` |

---

## 7. 退出条件（什么情况下放弃）

出现**任一**即停止投入、保留档案、回到观察：

1. 按 §2.2 判定护栏**无效**（关=HIT 且 开=HIT）；
2. 连续 **3 次**验收均因"关=OK"而作废（说明本机已难触发该 bug，无法证真）；
3. 上游微软修复本族 issue 或给出官方方案（直接改走官方路线）。

---

## 8. 外部线索核实记录（2026-10-09，简乐带来 4 条，逐条查证）

> **纪律**：第三方材料一律回第一现场核实后再采信（本项目惯例）。本轮 4 条**全部查证**，结果 3 真 1 真但转述有误；其中**两条引述未被证实**。

### 8.1 核实结果速览

| 线索 | 真实性 | 关键事实 | 对 solo 的价值 |
|---|---|---|---|
| **Blender PR `#132102`**「Enhance the support for IME in Windows.」 | ✅ **真实存在**（作者 Arius / 阿弩斯，2024-12 提交；commit `43f38b34df`） | 原生 C++ 重构，走 **Win32 IMM 路线**：`GHOST_BeginIME` / `GHOST_MoveIME`（内部即 `ImmSetCandidateWindow` 一族）；`GHOST_ImeWin32` 类**源自旧版 Chromium** | ⚠️ **中低（不可直接搬，见 8.2）** |
| 引述①:「必须在 `WM_IME_STARTCOMPOSITION` 之前定位候选窗」 | ❓ **未能核实** | 页面/检索片段中**未见此句**（PR 代码只见到 `WM_IME_COMPOSITE_START/EVENT/END` 的处理） | 存疑，勿当结论 |
| 引述②:「部分 IME 会忽略组字结束前的 reposition 请求」 | ❓ **未能核实** | 同上，**未见原文** | 存疑，勿当结论 |
| **xterm.js `#5839`**「IME offset」 | ✅ **真实**（2026-04-24；Tauri 2.0 + WebView2 + Win11；候选窗弹到**右下角**） | ⚠️ 但**根因在 xterm.js 自身**：① TUI 把 buffer cursor 停在输出区；② 右键 `moveTextAreaUnderMouseCursor` 把 textarea 移走。评论区自述**在应用层于 `compositionstart` 重定位 textarea 无效** | **中**：佐证「宿主 + 嵌入式 webview」普遍；**其解法不可抄**（solo 无 xterm 的 textarea 问题） |
| **paseo `#3511`** | ✅ **真实**（2026-08-18；**Electron** + xterm.js + Win11） | 明确写「**chat composer（普通 textarea）不受影响**，只有终端不正常」；引用 xterm `#5454/#5734/#5839` + `electron/electron#4539` | **低**：是**终端库**问题，且其情形与 solo **相反**（solo 是裸 `<input>` 也复现）。仅作旁证 |
| **VSCode `#259380`** | ✅ **真实**，但**转述两处有误** | ⚠️ ① 症状是「候选窗**不出现**」(`does not appear`)，**不是"位置错乱"**；② 缓解方向**说反了**——原文是让你**关掉**"使用以前版本的微软拼音"兼容开关（因问题**由旧版引起**），**不是打开**；③ 该建议出自**用户评论**，**非 VSCode 官方** | **低**（且具误导性）：不可照抄 |

### 8.2 ⚠️ 关键辨析一：Blender 的经验**不能直接搬到 solo**（架构不同）

- **Blender = 原生 C++ 应用**，自己拥有 GHOST 窗口层 ⇒ 可以**直接调 Win32 IMM API** 控制候选窗（候选窗是自己实现的 IME 支持产物）。
- **solo = WebView2 托管**，键盘焦点在 **WebView2 的子窗口**（`Chrome_WidgetWin_1`），IMM 上下文**属于那个子窗口**，候选窗由 **WebView2/Chromium 内部**绘制与管理 ⇒ **solo 顶层窗口调 `ImmSetCandidateWindow` 够不着**。
- ⇒ 第三方建议的动作「抄 Blender 用 `ImmSetCandidateWindow` 预定位」**撞上本项目 §7 已列死路**（原文：「宿主层 `ImmSetCandidateWindow` 钳制候选窗 —— **前提不成立**：候选窗无 HWND ⇒ 只能像素采样；且与已落地 `TSFImeSupport` 路径交互」）。
- **结论：不建议做该项。** 理由不是"没试过"，而是**IMM 上下文不在我们手里**（同族动作上游亦已实测无效）。
- 📌 **唯一可借鉴处**：Blender 证明「用 IMM 路线控制候选窗」在**原生层**可行且已成功落地——但**那正是我们碰不到的一层**。

### 8.3 ⚠️ 关键辨析二：「事后重锚无效」**不适用于本方案**（防误杀主线）

- 第三方称 Blender 证明「组字中 reposition 被忽略」⇒ 推广成「**事后重锚一律无效**」。
- **但本方案（Lanmark 路线）根本不是"请 IME 移动候选窗"**：
  - Blender 说的是给**已存在的候选窗**发"移动"请求（`ImmSetCandidateWindow`），组字中会被忽略；
  - Lanmark 做的是**让渲染进程重发 `TextInputState`**（`blur`→`focus`）来**重建文本输入布局**，且 pending 到 `compositionend` **之后**执行，**作用于下一次组字**。
- ⇒ **两条路解决的不是同一环节，不矛盾**。第三方把"某条具体手段受阻"**过度推广**成了"任何事后操作都无效"——**若照此采信，会误杀当前唯一有 A/B 验证的解法**。
- ✅ **必须保留主线**：`blur()` → 隔 60ms → `focus()`（Lanmark 实测有效）。

### 8.4 有采纳价值的一条：验证 `TSFImeSupport` flag 是否真生效

- 第三方提出的**诊断思路**成立：挂消息钩子看 `WM_IME_*` 是否到达。
- ⚠️ **须修正**：若 flag 生效（IMM32），消息到达的是 **WebView2 子窗口**（真正的 IME 目标窗口），**不是** solo 顶层窗口 ⇒ 监听范围须含子窗口。
- 📌 **更廉价的替代判据（不需写钩子）**：本项目 **O9** 已确认候选窗由 **`TextInputHost.exe`** 绘制 ⇒ **若 flag 真回退到 IMM32，候选窗应改由输入法自身进程绘制**。此观测（2026-09-13）在 flag 落地**之前** ⇒ **flag 生效后重新采一次失锚现场、看画候选窗的进程是否变了**即可侧证。代价远低于写 Win32 钩子。
- **处置**：列为**可选诊断**（见 §3 的 0.5），**不阻塞主线**；主线失败或需深挖时再做。

### 8.5 方案调整结论

| 项 | 处置 |
|---|---|
| 主线：Lanmark 护栏（`blur`→60ms→`focus`，挂 resize） | ✅ **不变**，仍是最可信、同栈、有 A/B 的路线 |
| Blender 式 `ImmSetCandidateWindow` 预定位 | ❌ **不做**（架构不成立，撞 §7 死路） |
| 挂钩子验证 flag | 🟡 **可选诊断**（0.5），不阻塞主线；优先用 O9 的廉价替代判据 |
| 给用户"兼容模式"自救指引 | ⚠️ **暂缓**：第三方转述方向说反；须先自行核实哪个方向真有效，再决定是否写进 KNOWN-ISSUES |
| xterm.js / paseo 围观 | 🟡 记录备查（它们是**终端库**问题，解法不可抄，仅作同族旁证） |
| Blender「WM_IME_STARTCOMPOSITION 前定位」「组字中 reposition 被忽略」两句 | ❓ **未核实**，登记为待核，**不得当结论引用** |

## 9. 阶段 1 / 2 实施记录（2026-10-09）

### 9.1 落地文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/components/Editor/tiptap/ime-anchor.ts` | 新建 | 护栏模块；`installImeAnchorGuard()` 返回卸载函数 |
| `src/components/Editor/MarkdownEditor.vue` | 改（3 处） | `onMounted` 装、`onBeforeUnmount` 卸；import + 模块级句柄 |
| `src/components/Editor/tiptap/__tests__/ime-anchor.spec.ts` | 新建 | 契约锁 **11 例** |

### 9.2 对外接口（冻结）

- 常量：`IME_ANCHOR_DEBOUNCE_MS = 120`、`IME_ANCHOR_FOCUS_DELAY_MS = 60`
- `installImeAnchorGuard({ getView, enabled?, debounceMs?, focusDelayMs?, target? }) → dispose()`
- 门控：默认仅 `isWindows`；其它平台**整段空操作**（连监听都不挂）。
- 组字态：走 `composition-freeze.ts::isFrozen`（唯一真相源，勿另造判断）。
- 退化安全：无 view / 已销毁 / 焦点不在编辑器 → 空操作。
- **A/B 开关键**：`solo:imeAnchorGuard` —— Console：`localStorage.setItem('solo:imeAnchorGuard','off')` 停用；`localStorage.removeItem('solo:imeAnchorGuard')` 恢复。

### 9.3 闸门结果

| 闸门 | 结果 |
|---|---|
| `vitest run`（全量） | ✅ 49 文件 / **1521 例全绿**（含新增 11 例） |
| `vue-tsc --noEmit` | ✅ exit 0 |
| `eslint`（改动 3 文件） | ✅ exit 0 |
| `vite build`（沙盒 `.sandbox-build`，已清理） | ✅ `built in 32.62s` |

> 📌 **基线更新**：本档案 §2 撰写时套件为「1484 通过 / 3 失败」（`composition-freeze` 的 fakeView 缺 `dom` 字段，属**旧基线**）。其后已由 commit `19cea95` 补全修至全绿。**当前零失败是最新基线**，本次改动**未引入任何失败**。

---

**档案建立**：2026-10-09 ｜ **分支**：`fix/ime-anchor-guard`（基线 `55bbbc1`）
**当前阶段**：2 / 4 ｜ **下一步**：阶段 3 真机验收（简乐按 §2.1，A/B 各 2 轮，结果填 §4）
