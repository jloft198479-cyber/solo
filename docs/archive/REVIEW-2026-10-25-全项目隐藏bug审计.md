---
title: 全项目隐藏 bug 审计（5 分区并行 + 基线复跑）
type: review
audience: maintainer
status: active
tags: [审核, 全项目, 数据安全, 剪贴板, Rust 后端, round-trip]
summary: 2026-10-25 对 solo 全仓做只读审计：5 个并行分区（Rust 后端 / markdown 管线 / TipTap 扩展 / 前端服务状态 / 剪贴板与安全配置），全部发现对照 KNOWN-ISSUES.md §一/§二逐条排除在案项。基线：vitest --mode full 2105 全绿、eslint 0 error。新发现 4 条 P1（表格内属性通道 `|` 裸写首存切列毁公式/互链；`[![alt](img)](url)` 外链静默消失；sub-sup InputRule 位置数学错致行中打上下标内容消失；改名只换路径触发 watch 旧基线回灌丢未序列化编辑——四条均经主会话二次源码复核）＋ 5 条 P2 ＋ 约 28 条 P3。8 条标⚠️待实测（附最小复现思路）。font.rs 路径校验缺口由两个独立分区交叉命中。未改任何被审代码。
updates: [docs/KNOWN-ISSUES.md]
---

# 全项目隐藏 bug 审计（2026-10-25 · 只读）

> 范围：`src-tauri/src` 全部、`src/components/Editor/tiptap`（markdown 管线 + 扩展层）、`src/services` / `src/stores` / `src/composables` / `src/commands` / `App.vue` / Layout / Settings、剪贴板与 HTML 出站管线、`tauri.conf.json` + capabilities。
> 方法：5 个并行只读审计（互不知晓对方结论），逐条 grep `docs/KNOWN-ISSUES.md` 排除在案项；P1 级发现由主会话对照源码二次复核后才收录。
> 已知排除：§一 54 条已修复（视为现状正常）＋ §二在册/拍板暂不修项（#5 DNS rebinding、#13、#33-36、#38-43、#53、#54、#62 等）；`docs/archive/REVIEW-2026-10-20-互链设计评估与残留缺陷.md` 已报的 3 条互链 P1（旧路径窗口复活旧文件、文件名含 `#` 造死链、文件名含 `]` 丢链接）不重复列。

---

## 0. 基线

| 检查 | 结果 |
|---|---|
| `bun run lint` | 0 error / 70 warning（全为格式类） |
| `bun run test:full`（vitest --mode full） | **96 files / 2105 tests 全绿**（56.6s） |
| `cargo test --lib` | 本会话 Git Bash 缺 MSVC（cc-rs 找不到 cl.exe）；已按 BUILD_GUIDE §2.3 用 `M:\VS\BuildTools\VC\Auxiliary\Build\vcvars64.bat` 环境补跑，结果见文末附录 |

结论：**全部新发现都是现有 2105 条测试照不到的**——再次印证台账 #12「保真只有一个安全网」的结构性缺陷。

---

## 1. P1（4 条，均经主会话二次源码复核）

### P1-1 表格单元格内「属性通道」的 `|` 全部裸写 —— 首存即切列，公式/互链被毁

- **点位**：`markdown/plugins/math.ts:216-219`（mathInline）、`markdown/plugins/wikilink.ts:44-57`、`serializer.ts:518-525`（link href）、`serializer.ts:839-840`（image title）、`markdown/plugins/footnote.ts:40-44`
- **输入**（Obsidian 用户在表格里写公式/互链的合法形态）：
  ```markdown
  | a | b |
  | --- | --- |
  | $p\|q$ 的值 | x |
  | [[甲\|乙]] | y |
  ```
- **机理**：markdown-it 的 `escapedSplit`（table.mjs:20-54）切列时把 `\|` 还原成裸 `|` 再交给行内解析 ⇒ 解析侧节点正确（`mathInline(latex="p|q")`、`wikilink(target=甲, alias=乙)`）；但写出侧这 5 个通道把 `|` 原样写回 ⇒ 重开时裸 `|` 被当切列符 ⇒ 该行多一列、`$` 不再配对（公式整体变字面文本）、互链劈成 `[[甲` + `乙]]`。**首次保存即毁**，之后在损坏形态上收敛，无告警。
- **对照**：#42 只修了 code span 的 `\|` 与 image alt 的 `\|`——唯独属性通道漏了。
- **修法**：5 个写出点在 `state.isInTableCell` 下把输出中的 `|` 替换为 `\|`（wikilink/footnote 需让 `createChild()` 继承并暴露该状态）；读侧零改动（escapedSplit 会还原）。

### P1-2 `[![alt](img)](url)` 打开→保存后**外链静默消失**

- **点位**：`markdown/parser.ts:327-328`（`addNode`）
- **机理**：`addNode` 的 `type.createAndFill(attrs, content)` **没传第三参 marks**（对照同文件 `closeNode`:313 是传的）。markdown-it 对 `[![a](i)](u)` 产出 `link_open → image → link_close`，`handlers.image` 在 link mark 已开的语境下调 `addNode` ⇒ image 节点不带 link mark 落树 ⇒ 序列化写出 `![a](i)`，`(u)` 整条链接从文件里消失。加粗里包图片（`**![a](i)**`）同型丢加粗。
- **已核实**：prosemirror-model 的 `markSet = null` 默认放行全部 mark（image 无 `marks:""` 限制），序列化侧 `renderInline` 对非文本子节点走 `renderMarks` 已就绪——纯解析侧丢失。README 徽章、博客缩略图高频形态。
- **修法**：`addNode` 对 `type.isInline` 分支改传 `this.marks`（仅行内分支；块级勿传，否则 createAndFill 失败反丢内容）。

### P1-3 sub-sup InputRule 位置数学双重计入 —— 行中打上下标**内容静默消失、相邻字符被吃**

- **点位**：`extensions/sub-sup.ts:63` 与 `:101`（`const captureStart = range.from + match.index!`）
- **机理**（已对照安装版 `@tiptap/core/dist/index.js:4791-4794` 复核）：官方 runner 传入的 `range.from = from - (match[0].length - text.length)` **本身已是匹配起点的文档坐标**；`match.index` 是匹配在 textBefore 里的下标，二者相加 = 双重计入。段落中打 `x^2^`（match.index=1）：`fullStart` 右偏 1 ⇒ `delete(innerEnd, closingEnd)` 吃掉闭合符**之后**的一个位置（块边界/下一块首字符）、`delete(fullStart, innerStart)` 删掉的是内容 `2` 本身、`addMark` 落在空位。上游 `markInputRule` 从不用 `match.index`（用 `range.from + fullMatch.indexOf(captureGroup)`，删除只到 `range.to`）。段首打（index=0）才恰好正常——这也是日常没踩爆的原因。
- **状态**：⚠️待实测（静态链已闭合；真机在段落中间输入 `x^2^` / `H~2~O` 一行即可复现）。现有 `markdown-input.spec` 只测了从 index 0 开始的纯函数路径，这条 InputRule 无测试。
- **修法**：两处 handler 全盘对齐上游 `markInputRule` 的位置数学（`textStart = range.from + fullMatch.indexOf(text)`，删除只到 `range.to`）。

### P1-4 改名「只换路径」触发 `[path]` watch 用旧基线整体回灌 —— **未序列化编辑静默丢失**

- **点位**：`MarkdownEditor.vue:562-584`（watch）＋ `useDocumentSession.ts:545`（`handleFileRenamed` → `renamePath`）、`:405`（`saveRenamedDocument` 失败分支 `renamePath`）＋ `stores/file.ts:100-107`（`renamePath` 只换路径不动 content）
- **机理**：watch 的注释（:574-575）假设「改名必先 persistDocument→getContent 刷新缓存，必走缓存命中分支，不受影响」。两条路径打破该假设：
  1. **跨窗口改名跟随**：同一篇开在 A、B 两窗，B 窗改名保存 → `emitFileRenamed` 广播 → A 窗 `handleFileRenamed`（只查 isSaving/isOpeningFile，无脏态检查）→ `renamePath` 改 store.path → watch 视为跨文件切换。A 窗若有**尚未序列化落 store 的编辑**（500ms 防抖 + 至多 2s 空闲兜底，后台窗口节流时窗口更长），缓存必然过期 ⇒ `currentMarkdown = null` ⇒ 无条件 `replaceDocumentWithoutHistory(旧基线)`，`cancelPending()` 顺手作废那笔编辑的唯一载体。丢失量 = 自上次成功序列化以来的全部编辑。
  2. **本窗改名保存失败**：rename 成功但写内容抛错 → catch 里 `renamePath` → 缓存新鲜（含用户编辑）但 store 基线旧 ⇒ 比对必不等 ⇒ 回灌旧基线——把 catch 注释承诺的「isDirty 保持 true、编辑保留」整个推翻，之后自动保存把旧内容写回磁盘。
- **与台账关系**：#38 拍板的是「成功分支 setFile(快照) 回灌」；本条是 `renamePath`（不 bump reloadToken、不动 content）的旁路，机制不同，台账无「改名跟随/renamePath」条目。
- **修法**：`renamePath` 走「路径跟随」专用标记（不触发跨文件回灌分支），或 watch 在 crossFileSwitch 且缓存过期时先 `flushPendingSerialize` 再比对、脏则只换路径不替换内容。

---

## 2. P2（5 条）

### P2-1 `computePairEscape` 只数文本内容 —— 字面 `$`/`^`/`==` 与真 mark 定界符共处一段时该转不转，公式/上标/高亮内容「搬家」（⚠️待实测：重解析行为由 texmath/sub/mark 源码推得）

- `serializer.ts:31-45` + `:258`。`pairNeeded = computePairEscape(parent.textContent)`——textContent **不含**将由序列化器另行写出的 `$`/`^`/`==` 定界符 ⇒ 「一个字面 `$` + 一个行内公式」按 1 计 → 字面 `$` 不转义 → 写回 `a$b$x$` → 重开 texmath 在第一个 `$` 处配对 ⇒ **字面文本 `b` 被吞进公式、原公式内容 `x` 掉出来**。`^`（上标）、`==`（高亮）同理。属 #28 修复自身的新漏洞。镜像问题：计数又**包含行内 code 内容**（`` `a^b` x^2 `` 首存被改写为 `` `a^b` x\^2 ``，渲染不变、字节漂移）。
- 修法：计数输入改「文本内容 + 本块将写出的成对定界符个数」（mathInline 计 2、sup 计 1、highlight 计 2），并扣除 code mark 文本。

### P2-2 跨型列表切换被「第二次按 = 退出列表」劫持 —— 有序↔无序 toggle 变成整项脱出为正文

- `editor-commands.ts:15-17,121-127` + `slash-commands.ts:108,123,138`。`isInsideListOf` 按**项节点类型**判定，而 bulletList/orderedList 的项同为 `listItem` ⇒ 在 `1. 甲` 里点「无序列表」（浮动菜单/命令面板/斜杠）本应上游 `toggleList` 原地换标记，现在被劫持成托孤降级为正文段落 + 子列表提升一级。关联 #50（其契约只应覆盖**同型**二次按）。taskItem 不受影响。修法：`exitList` 加容器类型判定，仅同容器类型才走托孤。

### P2-3 设置持久化多窗口 last-writer-wins —— 静默回滚其他窗口的配置改动

- `stores/settings.ts:199-245,322-340` + `services/tauri/store.ts:16-19`。`initFull` 仅启动读一次；每次变更把**整个 settings 快照**写回磁盘，无跨窗口事件、无写前重读合并。窗 A 改主题、窗 B 改字体 → 磁盘上主题回到旧值，重启后消失，全程无提示。修法：写回前 read-modify-write 按字段合并，或订阅文件变更重载。

### P2-4 出站内联样式 `toPx` 静默解析坏 `clamp()`/百分比 —— 自定义主题复制出 1.5px 隐形标题（新功能 cbcf1e5 引入）

- `external-styles.ts:92-97` + `themes/manager.ts:225-231`。`injectTypography` 对主题 JSON 的排版值**原样写入 CSS 变量**（合法：`heading1Size: "clamp(1.5em, 2vw, 2.2em)"` 编辑器内正常渲染）；但 `toPx` 的 `parseFloat` 停在 `1.5` 且不以 em 结尾 → **1.5px**；`120%` → 120px。坏点集中在自定义主题的 `heading1~6Size`（设置 UI 写死 `Npx` 的正文是安全的）。Ctrl+A 复制全文粘到公众号：标题肉眼隐形。修法：`toPx` 对 clamp()/calc()/% 回落 `getComputedStyle` 实测值或 FALLBACK，不把 parseFloat 首数字当 px。

### P2-5 入站 `<img>` 无协议白名单 —— `file://` 图粘贴破图、落盘重开静默丢图

- `extensions/image.ts:298-330`（`pickImageSrc`/`normalizeImageSrc`）+ `:280-284`（`isLocalRelativePath`）。排除表只有 `data:`/`blob:`（占位）与 https/asset/盘符——`file:///D:/photos/cat.png` 与 `javascript:` 都**不命中**，被当「本地相对路径」join 文档目录、永远解析不出；粘贴时收下（CSP 无 `file:` 破图），落盘 `![](file:///...)` 后重开被 markdown-it `validateLink` 拒绝 ⇒ **图片退化成字面文本**。粘时接受、重开丢弃，round-trip 不一致且无提示。触发：Outlook 本地邮件/本地网页复制。修法：`pickImageSrc` 加协议白名单，file:/javascript: 入站即丢弃或降级为链接文本。

---

## 3. P3（约 28 条，按分区）

### 3.1 markdown 管线

| # | 点位 | 问题 | 修法 |
|---|---|---|---|
| B-1 | `parser.ts:42-43` | 引用/callout 内与 ≥4 缩进的围栏代码不受 `protectCodeRegions` 保护 ⇒ ZWNJ 可插进**内存态**代码内容（落盘被 serializer 兜底剥净；影响高亮/搜索/从代码块复制），与台账 #36「围栏类 ✓」口径矛盾 | `handlers.fence` 补一次 `stripZwnj`（一行），可并入 #36 一并处置 |
| B-2 | `serializer.ts:740-742` | blockquote 空行写出 `> ` 尾随空格（callout.ts:247 已修同类，此处漏） | 对齐 callout 写法：`line ? '> '+line : '>'` |
| B-3 | `markdown/plugins/wikilink.ts:8` | `parseWikilinkText` 正则 `[^\]|]+` 允许 `[` 且贪吃回溯，单行数万 `[` 可 O(n²) 卡打开 | 字符类排除 `[` |
| B-4 | `serializer.ts:816-818` ⚠️待实测 | 标题内 hardBreak 写出 `  \n` 劈开标题；段末 hardBreak 被重开剥掉（R1≠R2） | heading 内 hardBreak 降级为空格 |

### 3.2 TipTap 扩展/交互

| # | 点位 | 问题 | 修法 |
|---|---|---|---|
| C-1 | `extensions/image.ts:468/495→515` | src 未变、其它 attrs 变时早退跳过 `sourceText` 更新 → undo alt 后源码文本与图题不一致，焦点掠过源码框即回写、undo 被静默撤销 | 早退只跳过异步解析分支，`sourceText` 更新照跑 |
| C-2 | `markdown-paste.ts:521-527,608-620` ⚠️待实测 | 两条异步回写（Layer 4 升级/图片落盘）无 `isFrozen` 门控，粘贴后立刻组字可撞候选窗失锚（对照 `useEditorSearch.ts:74` 同场景有门控） | 回调里查 `isFrozen`，冻结则延迟/放弃升级 |
| C-3 | `markdown-paste.ts:481-487` | Layer 3 的 `inCode` 只判块级 code 漏 **code mark** → 行内代码中间粘 `[[链接]]`/`$$…$$` 劈开 code span（InputRule runner 自己就同时查两处，此处漏） | 补 `\|\| $from.nodeBefore?.marks.some(m => m.type.spec.code)` |
| C-4 | `mermaid-block.ts:536` | 某块 `destroy()` 无条件关**全局** lightbox：删 A 块会误关 B 块的放大预览 | 删该行或记录来源 handle 再比对 |
| C-5 | `list-demote.ts:237-245` ⚠️待实测 | `dissolveShell` 之后才用旧 `seg1List.nodeSize` 算落点，窗口整体偏移约 6 字节（退化嵌套+纯壳输入才触发，可能误转相邻块类型） | dissolve 移到落点计算后，或用 `tr.mapping` 修正 |
| C-6 | `suggestion-guard.ts:118-139` | 触发串在文本节点开头（charIndex=0）时 `!` 前缀/URL/scheme 守卫全部跳过；互链开放态只扫当前文本节点 | charIndex=0 时向 `nodeBefore` 之前再取上下文 |
| C-7 | `extensions/wikilink.ts:103-118` | InputRule 缺 `!` 前缀守卫：手打 `![[foo]]` 产出 guard 注释明确要防的「伪嵌入」（`!` + 互链节点，语义错误但 round-trip 稳定） | handler 查 `range.from` 前一字符是否 `!`（对齐 #22 修法） |
| C-8 | `useEditorSearch.ts:172-200` ⚠️待实测 | 替换/跳转用防抖窗口（120/500ms）内的旧坐标，编辑后立刻替换删错范围 | 替换前同步 `findMatches` 重取坐标 |
| C-9 | `math-inline.ts:35-75` | NodeView 无 `destroy()`、异步渲染无 abort（铁律一致性缺口；实害有限——写入目标是已脱离 DOM） | 补 `destroy() { renderVersion += 1; }`（对齐 math-block:250-255） |

### 3.3 前端服务/状态

| # | 点位 | 问题 | 修法 |
|---|---|---|---|
| D-1 | `useDocumentSession.ts:290-331` ⚠️待实测 | 保存 catch 分支内 `confirm`/`message` 若 reject → `isSaving`/`_savePromise` 永不复位 → 整条保存管线（含自动保存）死到重启 | IIFE 外再包 try/finally 复位两把锁 |
| D-2 | `useCommandDispatcher.ts:66-68` + `useDocumentSession.ts:333-337` | 另存为遇 `isSaving` 静默 `return false` 且分发器吞返回值 → 冲突模态期间 Ctrl+Shift+S 零反应 | 失败时提示「保存进行中」或排队 |
| D-3 | `CommandPalette.vue:154-168` | Esc 只 `preventDefault` 不 `stopPropagation` → 关面板同时触发全局 Esc 链（退焦点模式/图片视图）；对照 SettingsModal:63 有显式 stop | 补一行 `stopPropagation()` |
| D-4 | `App.vue:438-440` | 状态栏保存按钮用滞后 `isDirty` **门外**短路，绕过 #36 的实时评估修复（Ctrl+S 入口已修，按钮入口仍吃 0.5-2.5s 滞后量） | 点击直接调 `saveCurrentDocument(false, true)`（函数内已能判） |
| D-5 | `fontLoader.ts:61-77,153-158` | 注册失败的 `<style>` 永不回收 + 入口每次清失败标记 → 反复失败的远程字体在编辑器重挂载时累积死 style + 重试风暴 | 复用同一 style 节点；失败重试仅限显式用户动作 |
| D-6 | `stores/file.ts:128-129` + `useDocumentSession.ts:267-278` | `markSaved` 无条件把 displayName 拍回 originalBaseName → 保存 IPC 往返期间提交的标题改名被静默吞掉 | 复位前比对捕获时的 displayName |
| D-7 | `services/tauri/events.ts:41-67` | `subscribeDragDrop` 缓存 rejected promise 永不重试 → 一次注册失败后本窗口拖拽永久失效（+unhandled rejection） | reject 时把 `sharedUnlisten` 置回 null |

### 3.4 Rust 后端与安全配置

| # | 点位 | 问题 | 修法 |
|---|---|---|---|
| R-1 | `document.rs:352-358` | 仅大小写改名被 `same` 判定提前 return，`fs::rename` 不执行（NTFS 目录项大小写不变）。主路径靠后续保存自愈；**保存失败分支**留磁盘/UI 不一致 | `same` 且字符串不同时仍执行 rename |
| R-2 | `image.rs:38-59` ⚠️待实测 | `is_blocked_host` 用 Rust 严格 `IpAddr::parse`，Windows Winsock 宽松变体（`0x7f000001`、`127.1`、`0177.0.0.1`、纯整数）可绕过直连内网/云元数据（与 #5 DNS rebinding 不同向量） | 解析失败前先识别数字/0x/点组成的主机名并拒绝 |
| R-3 | `image.rs:64-87` | `validate_remote_image_url` 只校验首跳，reqwest 默认跟 10 次重定向（跨协议也跟）→ 302 跳板绕过 SSRF 白名单 | `redirect::Policy::custom` 每跳重跑 `is_blocked_host` |
| R-4 | `font.rs:90,111-121,148-155,174-200,213-246` 🔺双分区交叉命中 | font 命令族入参直接 `join` 无路径校验（`..` 可越出 font-cache 目录；`read_font_bytes` 连扩展名白名单都没有，任意文件读）+ 下载无大小上限 + https 可经 302 降级。与 #9 给 document/image 加的治理形成反差；前提是前端已有 XSS，属纵深防御缺口 | join 前拒绝路径分隔符/`..`；canonicalize 后必须 starts_with 缓存目录；下载加上限并禁跨协议重定向 |
| R-5 | `main.rs:65-85` ⚠️待实测 | stale 清理按**顶层目录 mtime** 判 1h，双开场景可把「挂起空闲超 1h 的另一进程」WebView2 目录判 stale 并部分误删 | 目录名解析 PID，`OpenProcess` 探活则跳过 |
| R-6 | `document.rs:351-361,1110-1131,762-769` | exists 检查与 rename/copy/write 之间的 TOCTOU 覆盖家族；`unique_asset_target`（`pasted-image-{毫秒}`）双窗同毫秒粘贴互覆（tmp 命名已防同问题，assets 没防） | 文件名纳入 pid+原子序号（与 `temp_path` 同法） |
| R-7 | `state.rs:162-168` + `window.rs:20,70` | CloseGuard 的 ack 是单向门：ack 之后 JS **挂死**（非异常——异常有 abort 兜底）则逃生舱永不触发、窗口永久关不掉。#38 修复的盲区边界 | Waiting 分支在 ack 时间戳上叠加次级宽限（如 60s）后可 Force |
| R-8 | `document.rs:719-728` ⚠️待实测 | 粘贴图片 `mime_to_extension` 白名单外一律存 `.png`：tiff/heic/avif 内容与扩展名不符（HEIC 无解码器必破图），错名文件永久留在 assets | 白名单外拒绝并提示，不伪造扩展名 |
| R-9 | `clipboard.rs:22` ⚠️待实测 | CF_HTML 非 UTF-8 源（老 WPS/GBK 写入）可能 U+FFFD 乱码入文或降级纯文本（arboard 解码行为待证） | 实测定性；必要时按 Header charset 声明解码 |
| R-10 | `tauri.conf.json:31` | CSP 残留放宽：`connect-src`/`img-src`/`font-src` 的 `https: http:` 自 M-16（远程图改走 Rust 抓取）后已无使用方，纯放大纵深防御风险 | 收缩为实际来源；跑一遍图片/字体/复制链验收 |
| R-11 | `capabilities/*.json` + `lib.rs:317` | clipboard-manager 插件 Rust init + 三份 capability 授权，全仓**零调用**（读写剪贴板走 navigator.clipboard 与自研命令）——最小权限原则 | 确认无隐藏调用后摘除插件与授权 |
| R-12 | `markdown-paste.ts:421` vs `:557-560` | 主粘贴路径（text/html 可用）无体积熔断，Layer 4 反而有 2MB——不对称，超大 HTML 粘贴可卡 UI 数秒 | `transformPastedHTML` 入口补同一条熔断 |

---

## 4. 已排查、未发现问题（给后续审计者留底）

- **Rust**：panic 向量（生产代码仅 lib.rs:453 一处框架标准 expect，其余 unwrap/expect 全在 `#[cfg(test)]`）；扩展名白名单大小写/尾随点/ADS（在 Rust `Path::extension()` 语义下安全方向失败）；原子写（symlink 解析、sync_all、tmp 含 pid+序号）；mtime 乐观锁（双侧同源毫秒 u64）；desktop.rs #22 修复复核无新洞；native_resize 的 GDI 配对/子类清理/DPI/负坐标；updater 签名链路。
- **markdown 管线**：markdown-it token 映射缺口（texmath 全家族、task-lists、sub/sup/mark/dim、autolink 逐一核对，无静默跳过）；放置校验绕过（除 P1-2 外无新路径）；表格 colCount/align 自洽；剪贴板/文件模式分叉（createChild 继承无漏判）；ZWNJ 属性通道 11 个写出点已剥。
- **扩展层**：快捷键无重复绑定；装饰四件套（search-highlight/paragraph-focus/code-block/list-fold）组字冻结实现正确；wikilink-existence 异步竞态不可达；监听器清理除 C-9 外成对；callout #20 无同类新实例。
- **服务/状态**：CloseGuard 前端链（#38 修复完整）；listen/unlisten 配对；useEditorSync 代际机制自洽；settings 版本迁移无丢配置。
- **安全**：绕过 client.ts 的 `invoke` 全仓零命中；命令四处登记 28↔28 一致；XSS 无存活路径（markdown-it `html:false` + schema 白名单 + link `isAllowedUri` + link-open 白名单；出站全经 setAttribute/textContent；package.json 声明的 dompurify 实际未被使用）；暗色主题复制不读主题色变量（EXTERNAL_TINT 中性常量）；asset 协议 containment 完整；updater/release devtools/withGlobalTauri 无暴露。

---

## 5. 建议处置顺序

1. **P1-1 / P1-2**：写文件即坏、用户无感；修法小、回归锁易补（roundtrip spec 加对应用例）。
2. **P1-4**：数据丢失线，走「路径跟随不回灌」；与 #38 家族一起收口。
3. **P1-3**：先真机一行复现坐实（待实测清单首条），再按上游数学对齐。
4. **P2-4**（新功能尽快止血）→ **P2-5 / P2-2** → **P2-1**（先实测）→ **P2-3**。
5. P3 批量：R-4（font 治理补齐 #9 反差）与 C-3/D-4（一行修、收益明确）优先；其余按接触面排期。

---

## 附录 A：⚠️待实测清单（8 条）

| 条目 | 最小复现 |
|---|---|
| P1-3 | 段落中间输入 `x^2^` / `H~2~O`，观察内容是否消失 |
| P2-1 | `a\$b$x$` / `甲\^1^2^ b` 存为 .md 打开→保存→重开，比对渲染 |
| B-4 | 标题内 Shift+Enter 输入文字，保存重开 |
| C-2 | 粘贴富文本后 50ms 内起拼音组字 |
| C-5 | `- `（空）嵌套 `- A1(标题)`，对 A1 执行「转正文」 |
| C-8 | 搜索替换：输入一个字后 120ms 内点「替换」 |
| R-2 | `![](http://0177.0.0.1:端口/x.png)`，本机起 HTTP 服务观察请求 |
| R-5 / R-8 / R-9 / D-1 | 双开挂 1h 后开新进程 / 粘贴 tiff 图 / 老 WPS 复制中文富文本 / stub dialog reject |

## 附录 B：cargo 基线补跑结果

（本会话 Git Bash 缺 MSVC：cc-rs `failed to find tool "cl.exe"`。已按 BUILD_GUIDE §2.3 加载 `vcvars64.bat` 后补跑 `cargo test --lib`，结果：**全绿**。）

```
test result: ok. 106 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
```

## 附录 C：方法与未覆盖面

- 5 个并行只读审计（general-purpose agent），互不知晓对方结论；`font.rs` 路径校验缺口（R-4）被 Rust 分区与剪贴板/安全分区**独立各报一次**，交叉置信。
- 未覆盖：运行时实测（附录 A 的 8 条）；`themes/presets` 深审、`marketing/`、`图片/`（非代码）；2026-10-20 互链 review 已报 3 条 P1 的现状（未验证是否已修）。
- 本报告未改任何被审代码；落盘即归档，处置以 KNOWN-ISSUES 台账登记为准。
