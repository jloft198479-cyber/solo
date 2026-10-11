---
title: solo Agent 细则（按需加载）
type: core
audience: agent
status: active
tags: [核心文档, 真理源, 敏感区, 工作流, 禁令理由]
summary: AGENTS.md 的展开层：真理源地图 / 敏感区 / 工作流验收 / 禁令理由
updates: [AGENTS.md, ARCHITECTURE.md, docs/sensitive-areas.md, docs/KNOWN-ISSUES.md]
---

# solo Agent 细则（按需加载）

> 本文件是 [AGENTS.md](../AGENTS.md) 的**展开层**。**AGENTS.md 是最小集合，必读；本文按需加载** —— 动手前按你要改的东西点开对应小节，不必通读。

---

## A. 真理源地图（改 X → 只改这里）

每个事实只在一处写，别处只放指针。

| 你要改什么 | 唯一真理源 |
|---|---|
| Tauri 命令名 | [`src/services/tauri/command-names.ts`](../src/services/tauri/command-names.ts) |
| 应用命令定义（命令面板 / 快捷键） | [`src/commands/registry.ts`](../src/commands/registry.ts) |
| 前端 IPC 入口 | [`src/services/tauri/client.ts`](../src/services/tauri/client.ts) |
| Rust 命令注册（命令数真值） | [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs) 的 `generate_handler!` |
| 编辑器扩展清单 | [`src/components/Editor/tiptap/editor-extensions.ts`](../src/components/Editor/tiptap/editor-extensions.ts) |
| 组字态（IME）判定 | [`src/components/Editor/tiptap/composition-freeze.ts`](../src/components/Editor/tiptap/composition-freeze.ts) |
| 脏态判定 | [`src/stores/file.ts`](../src/stores/file.ts) 的 `syncEditedContent` |
| 字体清单 / 字体栈 | [`src/constants/fonts.ts`](../src/constants/fonts.ts) / [`src/utils/fontStack.ts`](../src/utils/fontStack.ts) |
| 主题色彩映射 / 预设 | [`src/themes/types.ts`](../src/themes/types.ts) `CSS_VAR_MAP` + [`src/themes/presets/*.json`](../src/themes/presets/) |
| 待办清单 | [`docs/KNOWN-ISSUES.md` §二](./KNOWN-ISSUES.md) |
| 文档索引 / 术语表 | [`docs/INDEX.md`](./INDEX.md) |
| frontmatter 标准 | [`docs/DOC-STANDARD.md`](./DOC-STANDARD.md) |
| 发版流程 | [`docs/RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) |
| 构建 / 工具链 / 环境变量 | [`BUILD_GUIDE.md`](../BUILD_GUIDE.md) |
| 技术栈与依赖版本 | [`ARCHITECTURE.md` §1](../ARCHITECTURE.md) |

**快捷键一律登记 [`registry.ts`](../src/commands/registry.ts)**：全局快捷键不许在别处硬编码（曾散落三处：键位在 `useAppDomEvents.ts`、文案在 `CustomTitlebar.vue`）。入口键若必须固定不可改，标 `fixedShortcut: true` —— 它不进可自定义列表，**但仍参与冲突检测**。

---

## B. 敏感区速查

完整表（含原因与禁忌）在 [docs/sensitive-areas.md](./sensitive-areas.md)。**改任何编辑内核 / 序列化 / NodeView / 生命周期代码前，先查那张表。**

最高危六条（漏了必出静默事故）：

| 你要动 | 一句话判据 |
|---|---|
| 脏态 / 保存 | 真相源是 `syncEditedContent` 语义比对；`setContent` 只建基线不标脏 |
| 剪贴板出站 | `text/html` 与 `text/plain` 是**两条独立管道** |
| parser / serializer | 列表容器判定（#15）+ mark 定界符开合（#16）+ 新增 mark 必须有载体（#16b） |
| CJK 强调 / ZWNJ | `stripZwnj` 唯一来源在 `tiptap/zwnj.ts`；代码区与 `$$…$$` 必须先清洗，否则写进用户文件 |
| NodeView / decoration / 浮动菜单 | 必须走 `composition-freeze.ts` |
| Windows 文件关联 | 注册必须幂等；注销不得整键删除 |

---

## C. 工作流与验收

**改前**：① 读**实际代码行为**（不以注释为准）② 查本文件 §B / `docs/sensitive-areas.md` 定位敏感区。

**改后必跑（按改动半径分流 —— 半径多大，门禁多大）**

| 改动半径 | 必跑 | 实测耗时 |
|---|---|---|
| **小改动**（样式 / 文案 / 单组件内部） | `bun run test:changed`（只跑与改动文件相关的测试） | ~9s |
| **前端任意改动** | `vue-tsc --noEmit` | ~6s |
| 任意 Rust | `cargo check`（本机缺 MSVC 也不许跳过，CI 是最终闸门） | — |
| **动 parser / serializer / schema**（共享内核） | `vue-tsc` + `bun run test`（**全量**）+ **全仓保真体检**（命令见下） | ~14s + 体检 |
| 时序 / UI / IME / 异步 | 上述 + **真机手感**（人工或 CDP 探针） | — |
| **发版前 / 大规模重构 / 跨模块改动** | `bun run test:full`（全量 + 体检）+ `bun run build` | — |
| 新增 / 改名 / 删除 Rust 命令 | `command-names.ts` → `commands/mod.rs` → `lib.rs` 三处同步 | — |

> ⚠️ **`vite build` 不在日常门禁里**：只在**发版前、动构建配置、跨模块重构**时才跑。日常改动 `vue-tsc`（类型）+ 相关测试已够。
> ⚠️ **`test:changed` 省的是"信号聚焦"，不是时间**：实测全量 13.6s vs 只跑相关 8.9s，**只差 4.7 秒**——因为本项目核心模块被依赖太广，依赖图一算还是一大片。它的真正价值是"红的那条就是你的锅"，不是提速。
> ⚠️ **动文档（搬家 / 改名 / 删文件）后必须跑一次 `bun run test:full` 或单独 `bun run vitest run src/__tests__/docs-lint.spec.ts`** —— `test:changed` 只跑代码相关测试，**不查死链**，纯文档改动会漏。

**全仓保真体检**（动 parser / serializer / schema 必跑，`bun run test` **默认不跑它**）：

```
bun run test:full          # 全量 + 体检，跨平台安全（不再用 SOLO_FIDELITY_SCAN=1 直跑，Windows cmd 不认 VAR=命令）
```

拿 `fixtures/` 里的**真实用户内容**当输入（docs/、wiki/、根级项目文档已移出扫描范围——它们含刻意不往返的语法，不是用户写作内容），对比「打开 → 保存」前后渲染是否缩水。单测是人工列举的，漏网 bug 长在没人想到的形态叠加处 —— **两者互补，缺一个就漏**。

**三条硬规矩**

- **新形态必须回灌用例**：排查中发现的每个新形态当场补进对应 spec，否则下次照样漏。
- **「已修复」需独立复核**：台账标 `已修复` 必须由**改动者以外**按最小复现重跑并贴结果；AI 自称修好不算证据。
- **验收结论写产品行为，不写锁数**：写「用户这么操作，得到 X」，不写「N 条锁从红转绿」。集合守恒类锁（如 `mark-delimiter-coverage`）只兜底，**不许当交活依据**（在册教训：#31 underline 当年锁绿着、bug 还在）。

### 锁的分级与去留（2026-10-12 立）

> 锁既有用（自动化、边界清晰）也会成枷锁。**判据不是"要不要锁"，是"这条锁配几级证据资格"。**

| 级 | 验的是什么 | 典型 | 地位 |
|---|---|---|---|
| **A · 行为锁** | 模拟用户操作后的**产品行为**（打开→保存加粗还在不在；刚敲一个字马上 `Ctrl+S` 落不落盘） | `roundtrip` / `fixtures` | ✅ **唯一可当交活依据** |
| **B · 守恒锁** | 集合比对 / 名单覆盖（有没有这个分支） | `mark-delimiter-coverage` / `schema-contract` | ⚠️ 只当**警报器**，不证明行为对 |
| **C · 棘轮锁** | 只许变好不许变坏（签名 / 计数不上升） | `fidelity-scan` G3 | ⚠️ 只防回归，不证明功能对 |

**新建锁的准入（缺一不加）**：① 能一句话说清「**我防的是哪个已发生的事故**」—— 答不上来的不是护栏，是税；② 做过**反向校准**（下条）；③ 能归到上表某一级。

**⭐ 假绿的唯一解药：反向校准** —— 加锁时**必须把修复撤掉，确认这条锁转红**。不转红 = 它没碰到病灶 = 等于没有。

三种典型假绿，都不是"锁太少"造成的：
1. **量错地方** —— 测"字还在不在"，而病是"格式没了"（#31 underline：文本在、下划线没了，锁绿着）。
2. **测"稳不稳"不测"对不对"** —— `R1===R2` 只证明两次结果一致；两次都错成一样也叫收敛（`买奶写码` 完美收敛）。
3. **样本里没有病灶形状** —— 构造的输入恰好避开了出问题的那种结构，撤掉修复照样绿。

**退化安全**：任何加载 / 优化必有 fallback（字体 / 图片 / 主题），不假设环境永远正常。

**发版前**：升版本号三处同步（[`package.json`](../package.json) / [`Cargo.toml`](../src-tauri/Cargo.toml) / [`tauri.conf.json`](../src-tauri/tauri.conf.json)）→ 查 `replaceAll` → tag 与版本号一致 → 完整流程见 [RELEASE_PROCESS.md](./RELEASE_PROCESS.md)。

> ⚙️ Agent 在本机跑验证的坑（`bun` segfault、`bun run build` 清 `dist/` 被安全闸门拦）：对策见 [RELEASE_PROCESS.md §11.2 / §11.3](./RELEASE_PROCESS.md)，别自己重新发明。

---

## D. AGENTS §1 硬禁令：理由与补充纪律

硬禁令的**浓缩版在 [AGENTS.md §1](../AGENTS.md)**，这里是「为什么」和补充的软性纪律。**不确定某条为什么要这么干时，看这里。**

### D1. AGENTS §1 五条硬禁令的理由

- **禁直接 `invoke`** —— 曾复发两次（v1.2.27 `read_clipboard_html`、v1.2.30 `detect_proxy_for_update`）。新增 Rust 命令后立即全库 grep `invoke('`（日常由 lint 拦）。
- **禁硬编码计数** —— 命令数 / 扩展数 / 测试数一律写「以 `generate_handler!` / `bun run test` 实际为准」，否则文档与代码必漂。

### D2. 低频架构约定（**不进必读**，改到相关模块时看这里）

> 这三条**曾经是硬禁令**，2026-10-12 按「低频 + 有机器锁 / 损害可逆」降级：经验留在这里，**不占每次必读**。

- **不许新增无 markdown 载体的 mark** —— `markDelimiter()` 无对应 `case` 会落 `default: return ''`，**开闭都不写** ⇒ 文本在、格式静默消失、不报错（比"不支持"更糟，`underline` 即漏网案例）。`StarterKit` 默认成员必须**显式关**。**已有机器锁**：`mark-delimiter-coverage`（只证明"有分支"）+ `mark-matrix`（才证明"写出去能重开"），两个都要跑。
- **嵌套序列化用 `state.createChild()`**，不许 `new MarkdownSerializerState()` —— 否则外层剪贴板转义标记丢失（粘出多出 `\=` `\$`）。
- **组字态一律走 [`composition-freeze.ts`](../src/components/Editor/tiptap/composition-freeze.ts)** —— 历史上同一件事被重复造了 4 份才抽出总闸（提交 `21a028b`）。**别再造第 5 份**：新增 decoration / appendTransaction / NodeView / 浮动菜单都走它（现有 11 个模块在用，测试锁见 `composition-freeze.spec.ts`）。
  ⚠️ 两个信号不是一回事，**别互相替换也别删**：`view.composing` = 浏览器 DOM 组字的权威信号；`isFrozen(view)` = 我们自己决定"这段窗口别动文档"的闸门（如代码高亮补算期间）。`markdown-input.ts` 里两套并存是**有意设计**（`pluginState.composing || isFrozen(view)`），不是重复造轮子。
  ⚠️ **组字态冻结 ≠ IME 候选窗失锚**：后者是输入法弹窗位置飘（宿主 WebView 的锅，**2026-09-24 已终审封存、停止投入**）；前者是我们自己能治的，仍在服役。别混为一谈而误删。

**补充软性纪律（不是禁令，但违反会返工）**

1. 不许用 `tauri dev` 验证 **CSP / prod-only** 问题 —— dev 不附加 CSP，必须 `tauri build` 后跑 release 二进制。
2. 不许**猜**失败原因 —— 先看真实报错（DevTools Console / Network / 日志）再定方向。
3. 不许用**加守卫**掩盖根因 —— 在 N 处各塞判断是加法、会扩散复杂度；优先**减 / 门控**惹祸特性。
4. 不许手抄库函数重写 —— 先 profiling 证明热点，重写必附**等价性对照测试**；重构类改动要交「旧版 vs 新版」逐字节 diff。
5. 动**时序 / UI / IME / 异步**不许只跑单测就交 —— 单测是入场券，**真机手感（人工或 CDP 探针）是通行证**。
6. 不许重新提交已主动舍弃的 commit（`bb76c25` / `612ddb5` / `828b18c`）—— reflog 里的 dangling commit **不是待办**。

---

## E. 开工最小读取清单（治过度检索）

> 动手前**只**读下表对应行，不要全库 grep 找上下文——真要查的，先看这里有没有，没有再点开 §A/§B。

| 你要改什么 | 必读（最小集） |
|---|---|
| parser / serializer / schema | `serializer.ts` + 对应 parser 入口 + `fixtures/` + `sensitive-areas.md` §15/§16/§16b + 本文件 §C 锁分级 |
| Rust 命令 | `command-names.ts` + `lib.rs` 的 `generate_handler!` + `commands/mod.rs` + `client.ts`（不许直 `invoke`） |
| UI / 主题 | `themes/manager.ts` + `CSS_VAR_MAP` + `presets/*.json`（颜色/尺寸/动效走 token，禁硬编码） |
| 快捷键 / 命令面板 | `registry.ts`（唯一键位真理源） |
| 剪贴板出站 | `sensitive-areas.md` §11.8 + 剪贴板出站代码（`text/html` 与 `text/plain` 双管道） |
| NodeView / 组字态 / 浮动菜单 | `composition-freeze.ts`（总闸，别造第 5 份） |
| CJK 强调 / ZWNJ | `tiptap/zwnj.ts`（`stripZwnj` 唯一来源；代码区与 `$$…$$` 先清洗） |
| 一般 bug / 不知道改哪 | AGENTS 最高原则 + `sensitive-areas.md` 对应行 + **目标文件实际代码**（不以注释为准） |

> ⚠️ 检索时**默认跳过隐藏目录**（`.archive-档案室/`、`.opencode/`、`.trae/`、`.dumate/` 已 gitignore 且 ripgrep 跳隐藏目录）——这些里的"第二份 AGENTS/CHANGELOG/ARCHITECTURE"是过期副本，**不是规则来源**，照 AGENTS 现行文件来。

---

## F. A 方案：CDP 自验真实 UI（debug-only，2026-10-12 端到端实测通过）

> 痛点：Agent 改完 UI / 主题 / IME，「我看不到界面」就只能靠单测 + 文字推断，手感类回归漏在最后一公里。A 方案 = debug 构建默认暴露一个仅本机的 WebView2 CDP 端口，Agent 用 Playwright 连上真实 solo 窗口截图 / 读 DOM 自验。**2026-10-12 已端到端实测：截图 + DOM 文本读取均成功。**

**机制**（事实在 `src-tauri/src/main.rs::setup_webview2_data_dir()`）：

- debug 构建**默认**注入 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`（端口可用 `SOLO_CDP_PORT` 覆盖），**不需要任何额外环境变量**。
- 注入时机在 `solo_lib::run()` **之前**，与既有 `WEBVIEW2_USER_DATA_FOLDER` 注入同生命周期 —— WebView2 环境在首个窗口 build 时创建，所以端口 env 必须在 run 之前设好（已验证生效）。
- 整段包在 `#[cfg(debug_assertions)]` 里，**release 构建被完全剪除，永不暴露任何端口**；正常用户双击打开 release 版无任何端口、零副作用。
- 与 lib.rs 的嵌入式 devtools 面板解耦：面板仍由 `SOLO_OPEN_DEVTOOLS=1` 门控（人工按需开），CDP 端口 debug 常开（给 Agent 自验用）。

**自验流程**（动时序 / UI / 主题 / IME 后，单测是入场券、CDP 截图是通行证）：

```bash
# 1) 起 debug 构建（无需任何环境变量，CDP 端口 9222 自动开）
npx tauri dev
# 2) 另开探针连 CDP 端口截图 / 读 DOM（playwright 库已装在托管 venv）
python - <<'PY'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://localhost:9222")
    page = b.contexts[0].pages[0]   # title 应为 "solo"
    page.screenshot(path="outputs/verify-ui.png")
    print(page.evaluate("() => document.body.innerText[:200]"))  # 读 DOM 文本
PY
# 3) Read outputs/verify-ui.png（Agent 多模态）确认渲染 / 主题 / 布局对
```

**实测记录（2026-10-12）**：起 debug 版 → `curl http://localhost:9222/json/version` 返回 `Edg/154.0.4258.62` → Playwright `connect_over_cdp` 连上 → `page.title()="solo"`、`body.innerText` 含「未命名/大纲/0 字/已保存」→ 截图 `outputs/verify-ui.png` 确认完整 UI 渲染。**可用，已验证。**

⚠️ `tauri dev` 走完整构建（含 link），**必须在本机 MSVC 环境**跑（见下）；release 构建**没有**这个端口（被剪除），要自验只能用 debug 版。若 9222 被占，起第二个实例前用 `SOLO_CDP_PORT` 换端口。

### F1. 沙箱里跑 Rust 验证（cmd.exe 被拦的绕法）

WorkBuddy 沙箱的 Bash / PowerShell **都禁止调用 `cmd.exe`**，而文档写的 `vcvars64.bat` 路线走 cmd。已验证可行的纯 PowerShell 原生注入（DevShell 模块本机解析异常 `M:\VS\BuildToolsX`，弃用）：

```powershell
$msvcVer = (Get-ChildItem "M:\VS\BuildTools\VC\Tools\MSVC").Name | Sort-Object -Descending | Select-Object -First 1
$sdkVer  = (Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\Lib").Name | Sort-Object -Descending | Select-Object -First 1
$msvcRoot = "M:\VS\BuildTools\VC\Tools\MSVC\$msvcVer"; $msvcBin = "$msvcRoot\bin\Hostx64\x64"
$sdkInc = "C:\Program Files (x86)\Windows Kits\10\Include\$sdkVer"; $sdkLib = "C:\Program Files (x86)\Windows Kits\10\Lib\$sdkVer"
$env:VCINSTALLDIR = "M:\VS\BuildTools\VC"
$env:PATH = "$msvcBin;M:\rust\.cargo\bin;" + $env:PATH
$env:INCLUDE = "$msvcRoot\include;$sdkInc\ucrt;$sdkInc\um;$sdkInc\shared"
$env:LIB = "$msvcRoot\lib\x64;$sdkLib\ucrt\x64;$sdkLib\um\x64"
$env:CARGO_HOME = "M:\rust\.cargo"; $env:RUSTUP_HOME = "M:\rust\.rustup"
Set-Location "F:\fzz-Project\md-editor\src-tauri"
cargo check 2>&1   # 只类型检查、不调 link.exe，故无 Git Bash 下 link 抢占问题
```

> `cargo check` 不触发最终链接 ⇒ 不要 `link.exe`，纯 PowerShell 注入 MSVC 的 INCLUDE/LIB/PATH 即够（已实测 `Finished` exit 0）。真要 `tauri build`（含 link），仍建议在本机裸 `launch-dev.bat`（vcvars64）跑，别在沙箱硬刚。
