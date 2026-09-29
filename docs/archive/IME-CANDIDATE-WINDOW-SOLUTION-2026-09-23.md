---
title: IME 候选窗失锚 · 解决方案 v1（待评审，未执行）
type: archive
audience: human
status: archive
merged_into: docs/IME-CANDIDATE-WINDOW.md
tags: [ime, 输入法, 候选窗, webview2, tauri, 解决方案, 评审, forensics]
summary: 在交接报告基础上独立复核后的解决方案：新增证据（TSFImeSupport 语义 / 两周一版官方确认 / 同族新报案 #5676 / 恒坐标机制解释），主张「先测量后修法」——用取证器热键建立现场统计基线，再逐个开关候选干预，每条干预带「留/撤」判定规则；明确拒绝继续在无法证真的修法上加码
updates: [docs/IME-CANDIDATE-WINDOW-REPORT.md, docs/IME-CANDIDATE-WINDOW-PLAN.md, .workbuddy/memory/topics/ime-candidate-window.md, docs/KNOWN-ISSUES.md]
---

# IME 候选窗失锚 · 解决方案（v1 · 供评审）
> 🗄 **本文件已归档（2026-09-30）**：内容已蒸馏合并入 [`docs/IME-CANDIDATE-WINDOW.md`](../IME-CANDIDATE-WINDOW.md)，本文仅作历史原件保留、不再维护。

> **本文状态**：`draft`，只做排查结论与方案，**未改动任何产品代码**。
> **读者**：能对方案拍板的人 + 复核的外部工程师。
> **对上一份交接报告的态度**：它的结论我大部分采信（见 §1.1）；本方案**没有**做的一件事是「再提一个『机制很合理』的修法让人赌」——四份第三方建议的共同缺口就是**没回答怎么知道修好了**，这份方案把这个缺口补上。
>
> 标注沿用交接报告的三分类：**【观测】** 实测事实 ｜**【实验】** 跑过并出结果的 ｜**【推断】** 有合理机制但没被证实、可能错 ｜未核实的标 **【未核实】**。

---

## 0. 三十秒版结论

1. **问题不是 solo 写坏**：强推断是指向 WebView2 宿主层的 TSF 文本输入集成缺陷（裸 `<input>` 在 stock Tauri 里也能复现，`#5675`）。微软 0 回复。**根治在微软手里，不在我们手里。**
2. **唯一有观测疗效的机制是「鼠标事件自愈」**（谁动鼠标谁就把 bug 擦了，这是它难复现的根源）。方案的主线之一 = 把这个已知解药**前置**成「几何/焦点变化后的主动 nudge」，而不是干等用户动鼠标。
3. **方案不是堆修法，是先造尺子**：落地一个「热键取证器」（键盘触发、不碰鼠标，捕获失锚瞬间的完整现场），用它把「当前命中率」变成可统计的数——**先量当前 flag 是否已生效，再决定要不要动任何代码**。30 会话零命中 vs 历史 16% 基线，才能回答「修好了没」。
4. **一个此前没人做的检查已做掉一半**：`TSFImeSupport` 这个 flag **真实存在**，默认启用（Chromium M75 起 Win8+ 默认 TSF），`--disable-features` 语义 = 正确回退 IMM32（§1.2）。「flag 无效」的死结从「连 flag 是不是真的都不知道」推进到「flag 是真的，只剩『在 WebView2 实际构建里是否生效』未验证」。
5. **本轮没有出现能立刻根治的银弹**；但把「赌修法」换成了「可证伪的逐项实验 + 明确留/撤规则」，每步都小、都可回滚、都带测量。

---

## 1. 独立复核：我采信了什么、发现了什么

### 1.1 采信的既有结论（不再重证，直接引用）

| 项 | 出处 |
|---|---|
| 候选窗无独立 HWND，只能屏幕像素取证 | 交接报告 O9 |
| 失锚 21 帧坐标恒为 `(1340,996)`，只在 solo 内，对照零失锚 | O2/O3/O7 |
| 触发集中在「几何/焦点变化后的首次组字」，初期易发随会话衰减 | O5/O6 |
| 任何鼠标移动/点击即清除；自动化 35/46/120 次实验零复现 | 报告 §4.2 / §6.2 |
| DOM 复杂度与飘角无关（裸 input 也中）；**飘角**与 **contentEditable 吃字**是同一子系统的两个不同缺陷，不可互推 | §2.5 |
| 死路清单：`NotifyParentWindowPositionChanged`、`MoveFocus(PROGRAMMATIC)`、JS 组字期抑制 DOM、env 注入 flag、换引擎、升级 wry | §5.4 |

### 1.2 本轮新发现（对我方资料的三处升级）

| 项 | 升级内容 | 证据 |
|---|---|---|
| **`TSFImeSupport` 被实锤是真 flag**，且默认开启 | 交接报告 §9 曾标【未核实】「禁用 TSF 后中文 IME 行为」；现可确认：该 flag 是 Chromium「用 TSF 取代 IMM32 作为 IMF 实现」的开关，**M75 起在 Win8+ 平台默认启用**，`--disable-features=TSFImeSupport` 语义就是回退 IMM32——和我们禁它的意图一致。**只剩一环没验证**：WebView2 实际构建是否仍响应这个 flag（一般应响应，但没在 WebView2 的二进制里逐字核对） | Chromium issue [40489775](https://issues.chromium.org/issues/40489775) + commit `ddcdbef` "Enable TSF support on Windows by default"（2019-03） |
| **「两周一版」被官方确认** | 交接报告标【未核实】；现确认：Chromium 从 153 起两周一版，**Edge 与 WebView2 从 152 起对齐该节奏** ⇒ WebView2 Evergreen 今后约每两周漂移一次，"沙上建塔"会进一步加剧 | WebView2Announcements [Issue #137](https://github.com/MicrosoftEdge/WebView2Announcements/issues/137) |
| **同族出现新报案** | WebView2Feedback `#5676`（2026-08-19 开）标题也是「host window 被 resize 后 IME composition window 跳到屏幕角」——与 `#5675` 同章，**第二个独立报案人**。去 @ 上一起要 recipe / 联动催官方，比单打独斗强 | WebView2Feedback issues 列表 giornata【未核实细节】 |

### 1.3 对「恒坐标」机制的推断加强（仍是【推断】，但比之前更站得住）

交接报告问过：为什么失锚坐标**恒定**右下角，而不是「偏一个位移量」？结论一直含糊。

我的推断：**恒定角位 = 输入法的「无锚点回退位」**。微软拼音没拿到有效 anchor 时的默认位置就在工作区右下角附近；韩文输入法（上游 `#5675`）的默认回退位在左上角。**所以「我们右下 / 上游左上」根本不是矛盾，反而是同一个机制（anchor 丢失/为空 → IME 用自己的默认位）在两种输入法下的不同表现。** 这与 Chromium `GetCaretBounds()` 无 active widget 时返空矩形的机制自洽（`ime-candidate-window.md` L22）。

推论：
- 「偏一个位移量」类假说（窗口坐标缓存过期等）可以直接排除——它解释不了角位恒定；
- 「anchor 为空」是当前**一致性最高**的机制，干预方向应围绕「**让 anchor 在首次组字前是新鲜的**」。

---

## 2. 方案总览：四条工作线，全带测量

> 总原则（对齐 AGENTS.md「优先减 / 门控，不许用加守卫掩盖根因」）：这些不是"给代码打补丁盖 bug"，而是**觉察不到也够不着的宿主层缺陷下的止损/规避**（与微软官方 workaround `#2290` 同级），**且每项都挂「测不出就撤」的规则**，不允许无证据的开关长期悬挂。

| 线 | 干什么 | 交付物 | 是为了回答 |
|---|---|---|---|
| **W0 环境地基** | 把「运行时版本」纳入发版纪律；本机可选用 Fixed Version 锁 152 | RELEASE_PROCESS 一条 + 一个每周检查脚本 | 谁都不能在流沙上判断 |
| **W1 测量先行** | 落地「热键取证器」，先跑 2 周拿**当前（flag 已生效）**的真实命中率 | 取证器（Rust 热键 + 前端字段 + 判读脚本） | **圣杯问题：怎么知道修好了** |
| **W2 判据实验** | 我方自证一次最小复现（stock Tauri + 裸 `<input>` + 锁版本 + resize→ 零鼠标打字） | 一份实验记录 | 窗口形态（无边框/透明）到底是不是「更频繁」的放大器 |
| **W3 候选干预** | 按 C1→C2→C3→(C5)→(C6) 顺序逐个开、每个量一轮 | 每个候选的留/撤判定 | 找到起作用的开关；无效的撤 |

> **为什么 W1 排在最前而不是直接上 W3**：`TSFImeSupport` flag 已于 09-14 落地并入 v1.2.56，但**至今没有任何发版后的现场命中率数据**。我们连"flag 是不是已经默默修好了"都不知道。在没有基线数据的前提下再叠 C1/C2/C3，就是第四、五份「没答案」的第三方方案。

---

## 3. W1 取证器规格（方案的测量骨架，需拍板落地）

> 理由：死结的钥匙是现场数据。平时正常用，**一旦候选窗飘走，按键盘热键**（键盘热键不动鼠标 ⇒ 不会把自己擦了），系统抓一份快照。攒够样本后统计，而不是继续纸面推演。

### 3.1 触发与取值

- **热键**：全局键盘组合（如 `Ctrl+Alt+Shift+D`），Rust 注册（用 `tauri-plugin-global-shortcut` 或裸 win32 `RegisterHotKey`）。**必须纯键盘**——热键本身若产生鼠标事件就把要抓的现场擦掉了。
- **按下时立即抓两路**：
  1. **Rust 侧**：整屏截图 → `.sandbox-ime/forensics/{ts}.png`；当前窗口矩形；前台窗口名；WebView2 运行时版本（注册表 `pv`）；时间戳；
  2. **前端侧**（Rust 发一个 IPC 事件给 renderer，renderer 同步采集）：`view.composing`、`document.hasFocus()`、selection 的 `coordsAtPos`（可取 PM `view.coordsAtPos(state.selection.from)`≈cursor 真实位置）、最近一次 resize/move/focus/doc-switch 时间戳（由现有窗口事件埋点累计）、组字期 DOM 是否被外部改动过（`MutationObserver` 打标）、当前文档字符量、滚动位置。
- **落盘**：`.sandbox-ime/forensics/` 一个 `{ts}.json` 一个 `{ts}.png`，命名同批。
- **RECAP 判定**：判读脚本复用 `.sandbox-ime/ime-watch.py` 的候选窗判据（`#A6D8FF` 高亮 + 形状约束），把 JSON 里「cursor 真实坐标」与 PNG 里「候选窗坐标」做距离判断 → 自动给每条记录打 **HIT** / **OK**。同一时刻截的图与数据必须逐帧对齐，避免再次混入背景窗口假阳性（`ime-candidate-window.md` L95 那个坑）。

### 3.2 统计规则（回答「修好了没」，写死不靠感觉）

| 量 | 定义 |
|---|---|
| **会话段** | 一个「从前台聚焦 + 组字」到「聚焦离开」的最小单位；hit 判定 = 用户按下热键且判读为 HIT |
| 基线 | 历史 16%（2/12 会话段，63 分钟探针）——口径粗，但这是唯一公开基线 |
| **观察窗** | 每个被评估的配置（flag 现状 / 某个候选开 / 关）至少攒 **30 个会话段** |
| 判定 | 配置下 **0/30 HIT** ≠ 历史 16% → Fisher 精确检验 单尾 `p≈0.006`，可判「显著改善」；≥1 HIT → 未显著，执行留/撤规则 |

- **每个候选的「留/撤」规则**（沿用交接报告 R3 纪律）：有显著改善 → 留；无改善或不可测 → **撤**，不养无证据的开关。
- **无回归检查**：任一候选上真机前，先跑 `.sandbox-ime/ime-ab.py` 的「候选窗相对光标偏移」连续量（基线偏移恒 `(8,27)`），确认开关不劣化正常组字体验。

> 诚实备注：这个方案让「修好了吗」有了统计答案，但它有一个磨蹭期——先花约两周拿基线。**这是题目的物理约束**（无法自动触发），没有更快的路。

---

## 4. W3 候选干预清单（按顺序，互相独立，可单独开/关）

> 每个候选都标注：**机制假说 / 与已证伪死路的区别 / 改动点 / 风险 / 验证**。全部是「小 + 可回滚 + 挂测量」。

### C1 · Rust：`WM_EXITSIZEMOVE` 后 `put_Bounds(当前值)` 强刷一次几何

- **假说**：resize/移动结束后，WebView2 controller 的内部几何与 renderer 的锚缓存可能不同步（anchor 算错/算空）。`put_Bounds(同值)` 触发一次 controller 内部布局刷新，把 anchor 重新钉上。
- **与死路的区别**：`NotifyParentWindowPositionChanged()` 已被 `#5675` 实测 ×10 无效；`put_Bounds(同值)` 是**更硬的一层**（真动 controller bounds），且**不需要 fork wry**——在 Tauri 里 `window.with_webview` 直接调 controller 即可（`window.rs` 已有 `with_webview` 用法，见 `set_memory_target`）。交接文档 topics L123 把它列为"备选叠加项"但一直没做。
- **改动点**：`src-tauri/src/commands/window.rs`，挂到 tauri `WindowEvent::Resized` 的 **settle 去抖**（或移窗结束）之后一次性调（**不能每帧**，否则闪）。
- **风险**：低～中。同值 `put_Bounds` 若无视觉效果则风险近零；若有 1px 抖动需降级为「±1px 再还原」（微软官方 workaround `#2290` 同型，但只做**结束一次性**，不做每帧，规避它那个抖/闪副作用）。
- **验证**：W1 统计窗口。

### C2 · Rust：几何/焦点边界后**预防性**注入一次合成 `WM_MOUSEMOVE`

- **假说**：鼠标事件自愈是**唯一有观测疗效**的机制（我们与 `#5675` 都实测）。那么不等用户动鼠标，**系统替用户动一次**——相当于把已知解药前置到「边界之后、首次组字之前」。
- **与死路的区别**：这不属于已被排除的「JS 组字期抑制 DOM」「焦点 resync」——它是一种宿主消息层的预防针，且只在边界后做 1 次。
- **改动点**：Rust 里 `EnumChildWindows` 找到 render 子窗（`Chrome_RenderWidgetHostHWND`，找不到就回落 `WRY_WEBVIEW` 主窗），`PostMessage(WM_MOUSEMOVE, 0, MAKELPARAM(0,0))` 一次。不带动系统的真实光标移动。
- **风险**：中。可能带来多余的 hover 状态翻转 / 轻微重排；**必须先做一次小实验确认它到底会不会触发自愈**（机制成立的前提），再做常驻。若连「注入 MouseMove」都不能复现自愈路径，立即放弃本项。
- **验证**：机制小实验（在已复现的失锚现场/或手动构造最有把握的时刻，注入后看候选窗是否归位）+ W1 统计。

### C3 · 前端：window focus / 文档切换 / resize 结束后**延迟一次** `view.focus()`

- **假说**：失锚的根因若是「renderer 文本输入类型缓存成 NONE、直到某次交互重报」，那么边界后主动重聚焦一次可强制重报 anchor。
- **与死路的区别**：`#5675` 排除的是**宿主层** `MoveFocus(PROGRAMMATIC)`；这是 **JS 侧对 contenteditable 的 `focus()`**，不同的实现层。且 solo 现有代码对 focus 事件是「编辑器在就 return、不做任何事」（`setupWindowFocusHandlers`）——本项是**主动加**，有语义差异。
- **改动点**：`MarkdownEditor.vue` / `useAppWindowSession`，监听 `solo:editor-focus` / 文档切换 / resize 去抖后 300ms `view.focus()`（焦点已在编辑区时可空转，风险小）。必须**只在几何/焦点边界后**触发，不许常规打字路径上有任何 focus 抖动。
- **风险**：中。抢焦点可能打断用户正打的字 → **必须真机手感验收**（AGENTS 组字态敏感区规则），且与 W1 测量并行。
- **验证**：W1 统计 + 手感验收。

### C4 · 保留现状 flag，但纳入 W1 基线测量（不是"做"而是"量"）

- `--disable-features=TSFImeSupport` 已在 v1.2.56 生效。**先不动**，用 W1 的 2 周窗口量出它（顺带量出当前整体水平）的命中率。若 0 命中 → 线索闭合，flag 很可能真有效；若仍有命中 → 进入 C1/C2/C3。
- 判定后可执行：按 R3 纪律，若 C1/C2/C3 证明有效而 flag 无独立贡献，**可考虑撤 flag 简化**（避免长期挂无证据开关）——同样以测量为准，不拍脑袋。

### C5 · （视 W2 结果）无边框/透明窗口形态对照实验

- 只在 **W2 判据实验结果 = stock Tauri（默认装饰）不复现**时启用：说明 solo 的窗口形态是「更频繁」的候选放大因子，值得做一次真正值切换：`decorations:true` + `transparent:false` 跑一轮 W1，看命中率是否掉。反向复现则永远不做（平台缺陷结论加固）。

### C6 · （兜底，尽量不用）controller `put_IsVisible(false→true)` 闪切

- 强制 surface 重建，理论上必然重锚，但风险是可见闪烁，与「丝滑」铁律冲突。写进清单只为体现「退路都有」，默认不动。

---

## 5. W2 判据实验（最小复现自证，一次跑完、二选一）

> 交接报告 §8.3/§8.4 已提出、一直待拍板。我保留它并补操作细节。它是**二分「窗口形态是否必要」的唯一廉价手段**，且能把「引第三方说法」升级为「我方自证」。

| 项 | 内容 |
|---|---|
| 环境 | **锁版本**（W0 的 152）下建 `create-tauri-app --template vanilla` + 一个裸 `<input>`，**默认配置（有边框、不透明）** |
| 配方 | `#5675` 原版：resize → 不碰键盘鼠标 → 立刻组字；**全程零鼠标事件**；重复 >30 轮 |
| 判据 | 候选窗是否出现在角位（像素判据复用 `.sandbox-ime/judge2.py`/`ime-watch.py`） |
| 两种结局 | **复现** → 窗口形态划掉，「WebView2 宿主缺陷」结论加固，直接进 W3 C1/C2/C3；**不复现** → 形态是 solo 独有差异，长期观察它（C5），问题从「玄学」变「可定位」 |

> ⚠️ 已知：我方此前 12 次有效试次零复现（含程序化移窗/resize）。weshalb 本次押注点只有两个：**版本锁定** + **更大轮数与「启动后首次组字」变体**（topics L101 列过的未试变量：切回应用的首次组字、启动后第一次组字、边 resize 边组字）。若还是零，如实记录「我方无法复现」，不硬凑结论。

---

## 6. W0 环境地基（先于一切，风险最低、收益确定）

| 动作 | 内容 | 为什么 |
|---|---|---|
| **发版清单加一条** | 每次发版记录「当时的 WebView2 运行时版本 + 一次人工 IME 冒烟（中文组字 × 5 次）」，写进 `RELEASE_PROCESS.md` | 两周一版已确认，跨版本结论必须先就地核版本；不发版也做不了任何对照 |
| **本机锁 152**（可选，拍板） | 下载 Fixed Version Runtime 152 或配 EdgeUpdate 策略，仅用于**实验期**（W1~W3）消灭环境变量；实验结束恢复 Evergreen | 153 自带已确认的「输入冻结」bug，且让一切对照失真 |
| **每周 release-notes 探针**（小脚本，可放 `.sandbox-ime/`） | 拉 WebView2 最新 release notes，正则扫 `IME` / `candidate` / `composition` / `text input`，命中即报警 | 万一微软悄悄修了，第一时间知道，比每天肉眼看强 |

> 诚实备注：**不要**把「锁 152」当成长期战略——两周一版时代锁版本 = 放弃 Web 平台更新 + 15 万军 Fixed Version 体积。它只是实验期的一件工具。

---

## 7. 明确不做什么（提前把门焊死，避免评审后又绕回去）

| 不做 | 为什么 |
|---|---|
| 换 Electron / CEF / 换内核 | 仍是 Chromium，同族风险不减；代价大 |
| 换掉 WebView2 | wry 在 Windows 只有 WebView2，物理不成立 |
| 升级 Tauri / wry | wry 已与上游复现环境同版本 0.55.1，无收益有风险 |
| 宿主层 `ImmSetCandidateWindow` 钳制候选窗 | 前提已证伪：候选窗无 HWND、且与已落地 flag 路径交互；应用进程拿不到焦点输入上下文 |
| JS 组字期抑制 DOM 当解药 | `#5625` 实测无效 |
| 高 DPI/多屏归一化 | 100% 单屏仍发作，自相矛盾 |
| 透明输入代理层（隐藏 textarea 当锚） | 只对 contentEditable 吃字可能有意义，对飘角无效（裸 input 也中） |
| **长期挂任何无证据的开关** | 本方案的纪律：测不出差别就撤 |

---

## 8. 执行顺序与拍板点（全部待评审）

```
W0 环境地基（发版清单 + 锁 152【可选】+ rules 探针）
   ↓
W1 取证器落地 → 2 周基线（量当前 flag 是否已生效）
   ├─ 基线 0 命中 ? → 线索收敛：flag 有效，标 [已缓解]，观察期继续 → 完
   └─ 基线有命中 ? → 进 W3
W2 最小复现自证（可与 W1 并行）
   ├─ 复现 → 平台缺陷加固
   └─ 不复现 → 窗口形态成差异化嫌疑 → 长期观察 C5
W3 候选干预按 C1 → C2 → C3 →（C5/C6）逐个：
   ├─ 每个先过 ime-ab 无回归 → 再开测量窗口 → 30 会话段判定
   ├─ 显著 ? → 保留，下一个
   └─ 不显著 ? → 撤，如实记录
上游：comment / 开新 issue（§15 写法）附量化数据；@#5676 联动；每周 notes 探针盯修复
```

**拍板清单**（评审会需要逐项确认的）：
1. 锁 152 到实验结束 —— 可接受？代价（发布对用户无影响，仅本机/实验机）？
2. W1 取证器 = 新增热键 + 快照代码，不动核心架构，可回滚 —— 批准落地？
3. C1/C2/C3 的**顺序**与「留/撤」30 会话段规则 —— 认可？
4. 「每次发版加 IME 冒烟」写进 RELEASE_PROCESS —— 认可？
5. 上游联动（comment #5675 / 新开 issue 附数据）—— 由谁来做？

---

## 9. 风险与回滚

| 风险 | 概率 | 影响 | 措施 |
|---|---|---|---|
| C1/C2/C3 全无效 | 中 | 回到现状（16% 偶发） | 方案本身不劣化任何东西；如实宣告「止损 + 等微软」 |
| C1 抖动 / C2 多余 hover 翻转 / C3 抢焦点 | 中 | 视觉/输入小瑕疵 | 每个都是独立开关、一行配置可关；W1 测量前先真机手感验收 |
| 取证器热键误触 | 低 | 无伤害，只是多存一张图 | 热键选冷门组合 |
| 锁 152 后漏掉微软安全更新 | 低（实验期短） | 安全 | 到期即恢复 Evergreen；不长期锁 |
| 「flag 其实已经修好了」但我们不知道而继续加码 | 中 | 白干 | W1 正是为此设计——先量后改 |

**回滚总账**：W1/W3 全部是「新加热键/新加开关」，不触碰编辑器核心渲染与组字冻结契约（`composition-freeze.ts` 一行不动）；任何一步删掉即还原。C3 唯一触及前端行为，但它只在边界后做，正常打字路径零改动。

---

## 10. 标注纪律与【未核实】清单（别把推断当结论）

| 项 | 状态 |
|---|---|
| 恒坐标 = 输入法无锚回退位；「右下 vs 左上」同机制 | ⚠️【推断】（机制自洽，无反证，未开 Chromium 逐字核对微软拼音默认位） |
| `TSFImeSupport` 存在且默认启用、disable 回 IMM32 | ✅ 一手来源（Chromium issue 40489775 / commit ddcdbef）；⚠️「WebView2 构建仍响应此 flag」【未核实】 |
| WebView2 两周一版 | ✅ 官方 announcement #137 |
| `#5676` 细节（是否与 #5675 一字不差、是否有微软回复） | ⚠️【未核实】只确认了列表条目标题 |
| C1 `put_Bounds(同值)` 能否触发内部 re-anchor | ⚠️【未核实】机制推理，未实测——所以 C2 要先做「机制小实验」而不是直接常驻 |
| C2 注入 MouseMove 能否复现「自愈」 | ⚠️【未核实】同理 |
| 微软拼音「无锚回退位就在 (1340,996)」 | ⚠️【推断】（与两次失锚坐标一字不差吻合，但没开 TextInputHost 调参验证） |
| flag 自 09-14 落地后的现场命中率 | ❌ **无数据**（这正是 W1 要补的第一块） |

---

## 11. 附：本轮检索的一手来源（评审可自行打开复核）

| 用途 | 链接 |
|---|---|
| TSF vs IMM32 切换与默认值（flag 语义） | https://issues.chromium.org/issues/40489775 |
| "Enable TSF support on Windows by default" commit | chromium/src `ddcdbef4966de8c02919e76ba9b8862ece1d8624` |
| WebView2 两周一版官方公告 | https://github.com/MicrosoftEdge/WebView2Announcements/issues/137 |
| 同族飘角 issue（我方可 @ 联动） | https://github.com/MicrosoftEdge/WebView2Feedback/issues/5675 · `#5676` · `#1611` · `#2241` |
| 微软官方窗口移动 workaround | `#2290`（`Margin ±1px` + `UpdateLayout()`） |
| WebView2 release notes（无 IME fix 至 152） | https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes |

---

**方案生成**：2026-09-23，基于交接报告 v1.2.56 + 本轮独立阅读全部专题文档/核心源码 + 外部检索取证。
**本方案未改动任何产品代码**；落地需评审通过并按 §8 拍板清单逐项确认。

---

## 12. 复核记录（Buddy，2026-09-23 · 逐条回第一现场 · **未执行任何改动**）

> 复核范围：本文档全部事实性断言（本地代码/配置/依赖 + topics 行号 + 外部 issue/公告）+ W0–W3 的可操作性。
> **总评：五份第三方材料里质量最高的一份** —— 结构、三档标注纪律、留/撤规则、拒绝死路都对；主线「先造尺子（取证器）再谈修法」成立。但有 **1 处硬错误 + 1 处无法背书 + 3 处口径瑕疵 + 1 处落地成本漏算**。**方向可采纳，细节须修订后再进 §8 拍板。**

### 12.1 ✅ 核实通过（7 项）

| # | 断言 | 回查证据 |
|---|---|---|
| 1 | 两周一版（Edge/WV2 自 v152 起） | `WebView2Announcements#137` 原文一致：Chromium 自 Chrome 153（Stable 2026-09-08）起两周一版，Edge 自 v152 对齐，WebView2 随 Edge |
| 2 | `#1611` / `#2241` 为同族 | `#1611`「The "Candidate" window of IME is not moving along with the cursor position」（2021-08，日文 IME，WPF，MSFT「opened it on our backlog」）；`#2241`「Microsoft IME candidates window open in wrong place」（2022-03，微软拼音，WinUI/Win11，MSFT backlog，报案人原话「**When dragging the window without clicking on the WebView2 control, it will be displayed in the old location**」——与本案触发条件吻合）。**两份至今无修复** |
| 3 | `#2290` 是微软官方 workaround | MSFT `champnic` 给出 `Margin ±1px + UpdateLayout()`；但对象是 **HTML `<select>` 下拉窗**、属 **XAML 托管层** ⇒ 对 wry **无移植性**，仅可作「同族 + 有先例」论据 |
| 4 | topics 行号引用 **4/4 准确** | L22（`GetCaretBounds` 空矩形）· L95（`(784,708)` 假阳性）· L101（未试变量①切回首次②启动后首次③边 resize 边组字）· L123（`put_Bounds` 备选叠加项） |
| 5 | **C1 技术前提成立**（不需 fork wry） | `window.rs:26-32` 已有 `with_webview` + `controller.CoreWebView2()`；`window.rs:56` 已有 `on_window_event`（现处理 CloseRequested/Focused/Destroyed，**可挂 Resized**）；`Cargo.toml:41-42` 已直接依赖 `webview2-com 0.38.2` + `windows-core 0.61`。**补充实测**：wry 走**标准** `CreateCoreWebView2Controller`（`mod.rs:408/410`），透明仅 `SetDefaultBackgroundColor(0,0,0,0)`（`:452-454`），**未走 CompositionController** ⇒ `put_Bounds` 有实际语义 |
| 6 | **C2 结构上可行** | `drag_drop.rs:33-59` 用 `EnumChildWindows` 枚举 webview 子窗 ⇒ 子窗确实存在；但「合成消息能否触发自愈」仍未验证（本文档自己已标注） |
| 7 | `setupWindowFocusHandlers` 描述准确 | `MarkdownEditor.vue:633-646`＝编辑器在就 return、否则 `lazyInitEditor()` |

### 12.2 ❌ 硬错误（1 条，必须改）

**`#5676` 不是同族。** 实际标题：`[Problem/Bug]: WebView2CompositionControl not firing mouseleave and dragover events`（2026-08-19 开，WPF + `WebView2CompositionControl`，mouseleave/dragover 不触发）——**与 IME / 候选窗毫无关系**。

- §1.2 断言其「标题也是『host window 被 resize 后 IME composition window 跳到屏幕角』…第二个独立报案人」＝**标题层面即错**（虽自标【未核实细节】，但标题当事实写了）。
- **处置**：① §1.2 该行删除或改用真实同族件；② §11 **不要 @#5676 联动**；③ 同族名单修正为 **`#1611` / `#2241` / `#5675` / `#5625`**。

### 12.3 ⚠️ 无法背书（1 条）

`TSFImeSupport` 属 Chromium feature、M75 起默认启用、disable 即回退 IMM32 —— 本文档从【未核实】升为 ✅ 一手来源（引 chromium issue 40489775 + commit `ddcdbef`），**但我打不开该 issue（fetch failed）**，检索亦无可引用一手材料 ⇒ **我这边仍未核实**（不是判定它错）。

旁证实验（**结论不采用，仅调高风险**）：`msedge.dll`（153.0.4234.48）中 `msWebOOUI` 命中 3 次、**`TSFImeSupport` 命中 0 次**；但同法检 `ImmGetContext`（Chromium 必调）亦为 0 ⇒ **此法不能证否**。

⇒ 建议：① §1.2 该条的 ✅ 降回 **⚠️【未核实】**，或明确标注「待独立复核」；② 把「WebView2 构建是否响应此 flag」的风险**上调**（§10 现写「一般应响应」，旁证不支持这个乐观）；③ 优先用**运行时证据**验（如 `--enable-logging=stderr --v=1` 观察 Chromium 是否解析该 feature 名）。

### 12.4 🔧 口径 / 方法瑕疵（3 条）

| # | 位置 | 问题 | 建议改法 |
|---|---|---|---|
| 1 | §1.1「35/46/120 次实验零复现」（沿自我方 PLAN） | **口径混用**：35＝7 场景×5 轮对照实验；**46＝日志中「窗口 rect 变更次数」，不是实验次数**（我方 REPORT §6.3 原文即写「样本不足，不足以下结论」）；120＝**键盘注入次数 / 14 试次**。把一个"结论不足"的量当证据用 | 改为「**35 次对照实验零复现；14 试次 / 120 次键盘注入零复现；46 次窗口位移样本不足以下结论**」 |
| 2 | §3.2 | **统计方法名错**：`0/30 vs 历史 16%` 是**单样本二项检验**（0.84³⁰ ≈ 0.0054），不是「Fisher 精确检验」（后者比两组 2×2）；数值应为 ≈0.005 而非 0.006 | 改为「单样本二项检验：0/30 相对 16% 基线 ≈ 0.005」 |
| 3 | §1.2 引 153 | **边界丢失**：153 已确认症状是**输入/交互冻结**，不是候选窗飘角（我方上轮已厘清） | 补一句「153 是嫌疑而非已证，其已确认症状为冻结，与飘角症状不同」 |

### 12.5 💰 落地成本漏算（1 条，影响拍板）

W1 写「用 `tauri-plugin-global-shortcut` 或裸 `RegisterHotKey`」「整屏截图」，但 `Cargo.toml` 实测**三者全无**：无 global-shortcut 插件、无截图 crate、无 `windows`(Win32) crate（只有 `windows-core`，不提供 `RegisterHotKey` / `PostMessage` / `EnumChildWindows`）。

⇒ W1 实际成本 = **新增 2~3 个依赖 + 新增 capability 权限**，属「装依赖」类动作（AGENTS 禁令 15：先查本机、需先获同意），但 **§8 拍板清单未列此项**。

**降本方案（建议，可把新增依赖从 3 降到 0）**：

| 环节 | 现设计 | 建议 |
|---|---|---|
| 截图 + HIT 判读 | Rust 截整屏 + 判读脚本 | 交给**常驻的** `.sandbox-ime/ime-watch.py`（21 帧现场本就是它抓的）：判 HIT → 落帧 + 时间戳 |
| 前端状态 | Rust 发 IPC 事件 → renderer 采集 | 保留（无新增依赖，走现有 IPC） |
| 触发 | 全局热键（需新依赖） | **编辑器内快捷键即可**——失锚只发生在 solo 组字时，焦点必在 solo 内 ⇒ 无需全局热键 |

⚠️ 唯一待实测风险：**组字期按键可能被 IME 吞掉**（需先验一下 `Ctrl+Alt+*` 类组合在 composition 期间能否到达页面）。

### 12.6 🔍 C1/C2/C3 技术判断（不执行，只评）

- **C1**：路径成立（见 12.1 #5）。但 **"先试同值"的顺序可能反了** —— `#2290` 官方绕法恰恰是「**改值再还原**」，同值调用很可能被 WebView2 内部按「未变化」短路 ⇒ 应先验证同值是否真触发更新，大概率要直接上 ±1px。
- **C2**：结构可行（12.1 #6）。但它默认「合成 `WM_MOUSEMOVE` ≙ 真实鼠标事件」，而自愈观测**全部来自真实鼠标**；且**目标 HWND 有 3 个候选**（render 子窗 / 顶层窗 / controller 父窗）本身就是 3 个变量 ⇒ 机制小实验**必须三选全试**，否则容易误判「注入无效」。
- **C3**：三项里**唯一触碰前端组字敏感区**的一项，与 AGENTS **禁令第 8 条**（组字态不许绕开 `composition-freeze.ts`）正面相关 ⇒ 建议**降到最后**，或至少限定「仅在 `!view.composing` 时 focus」，否则风险/收益比最差。

### 12.7 ➕ 本文档未收录、但方向对得上的一手材料（建议补进 §11）

| 材料 | 价值 |
|---|---|
| **CEF issue #4070**（2026-01，`osr: windows: Chinese IME position issue with multi-threaded-message-loop`） | 同为**微软拼音**、同为**首次输入时位置错**；报告者明写「`ImmSetCandidateWindow` 无效 / `OnImeCompositionRangeChanged` 尚未完成窗口消息已返回」。**CEF 存在 composition range 回调、WebView2 没有** ⇒ 为「长期推上游加 IME 接口桥接」提供**具体先例** |
| **Chromium Issue #523134891**（`Regression: First IME composition input/punctuation is lost on Windows in Chromium 149+`，2026-06 报，**已修于 Chrome 151.0.7888.0**） | ＝ WebView2Feedback `#5625`「吃字/标点双按」的 Chromium 本体单。⇒ 反向印证我方切分：**「吃字」族在 Chromium 上游有单且已修；「飘角」族只在 WebView2Feedback 有单、零修复** |

### 12.8 ⏱ 复核中当场发生的事实（加强 W0 的分量）

本日早先记录「本机已是 153.0.4234.32」；本次实测 `C:\Program Files (x86)\Microsoft\EdgeWebView\Application\` 下**只剩 `153.0.4234.48`** —— **同一个 153 内小版本又漂了**。

⇒ 「版本漂移」不是理论风险，是**当天正在发生**；所有已写死的版本号（含我方 `IME-CANDIDATE-WINDOW-REPORT.md` 中的 153.0.4234.32）**已过期**，该报告的运行时版本号需就地更新。W0「记录运行时版本」应作为硬流程。