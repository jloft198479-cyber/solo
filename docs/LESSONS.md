---
title: 踩坑方法论库
type: guide
audience: agent
status: active
tags: [方法论, 教训, 排查, 契约, 退化安全]
summary: 从历史事故提炼的可复用思维模式（按模式聚类，非时间线）；每条索引到 KNOWN-ISSUES 台账
updates: [docs/KNOWN-ISSUES.md, ARCHITECTURE.md, AGENTS.md]
---

# 踩坑方法论库（LESSONS）

> **这是什么**：solo 踩过的坑提炼出的**可复用思维模式**。不做「第二本账」——**事实细节（现象/根因/修法/文件）在 [docs/KNOWN-ISSUES.md](./KNOWN-ISSUES.md)**，本文只回答「下次遇到同类事，我该怎么想」。
> **怎么读**：按**聚类**（不是时间线）组织。每条格式 = 现象 → 根因一句话 → 可复用教训 → 索引。
> **可执行版**：其中最硬的几条已提炼成 [AGENTS.md §1 禁令清单](../AGENTS.md)。

---

## A. 排查方法论：「猜」vs「看」

> 共同病根：**没看真实报错，从代码层面推测原因**。solo 历史上连修多版的 bug，几乎都是这个病。

### A1 · 资源加载失败，先验证**资源本身**是否完整

- **现象**：字体下载完成却不显示，连修四版（system-proxy → CSP → CORS → blob URL）全不中。终极根因是 GitHub release 的字体文件**被截断**（只剩头部 + 表目录）。
- **根因**：一直在「猜」加载机制哪里错，从没验证「这个文件本身是不是好的」。
- **教训**：① 遇到「资源加载失败」，**第一步验证资源完整性**——文件大小、magic bytes（OTF `OTTO` / TTF `00 01 00 00`）、表目录每条 `offset+length ≤ 文件大小`；② 加载机制问题**先看真实报错再定方向**。
- **索引**：[KNOWN-ISSUES §一 #7](./KNOWN-ISSUES.md)、[敏感区第 11 条](../docs/sensitive-areas.md)、[与 A2 / C1 同源]

### A2 · prod-only 问题不能用 dev 验证

- **现象**：mermaid 图表生产构建全黑，`tauri dev` 一切正常，三版才修对。
- **根因**：Tauri `tauri build` 才给 CSP `style-src` 注入随机 nonce（dev 不附加 CSP）⇒ `'unsafe-inline'` 被忽略 ⇒ mermaid 运行时 innerHTML 注入的 `<style>` 被静默拦截、形状回退黑色。
- **教训**：① **CSP / 打包差异类问题必须 `tauri build` 后跑 release 二进制**；② 任何**运行时注入 `<style>`** 的库（mermaid / lit / KaTeX）在 Tauri prod 都会踩 CSP nonce，解法 `dangerousDisableAssetCspModification: ["style-src"]`（`script-src` 的 nonce 保留，XSS 防护不降级）；③ 真因未定位时**不要基于推测改无关代码**（当时先改了 `manualChunks`，无效）。
- **索引**：[KNOWN-ISSUES §一 #1](./KNOWN-ISSUES.md)、[敏感区第 17 条](../docs/sensitive-areas.md)

### A3 · 跨层 bug：先加运行时诊断，别逐层猜

- **现象**：输入法候选窗失锚（塌成小方块），先后在事务层 / 渲染层 / 布局层修了三层。
- **根因**：跨层症状，每一层单独看都「像是」肇事者，靠推理无法收敛。
- **教训**：① 跨层 bug **第一轮就加运行时诊断**（MutationObserver + 光标矩形采样）「看」真实行为，不要逐层试；② 最终判定为 **WebView2/TSF 外部缺陷**——诊断的价值不只在「修好」，也在**证明我们这层是干净的**，从而止损。
- **索引**：[KNOWN-ISSUES §一 #15](./KNOWN-ISSUES.md)、[KNOWN-ISSUES §二 #8](./KNOWN-ISSUES.md)

### A4 · 总则：先看，再猜；先验输入，再疑机制

- **教训**：① 有报错先看报错（Console / Network / 日志），CSP 违规、CORS 失败都有明确提示；② 先确认「输入是否合法」（文件是否完整、参数是否为 undefined），再怀疑处理逻辑；③ 环境差异（dev vs prod、有无 MSVC）先排除。**未验证的推测不配写进注释和 CHANGELOG**（见 F2）。

---

## B. 契约与顺序（生命周期硬契约）

### B1 · 成对的开合必须「后进先出」

- **现象**：`*foo [bar](/url)*` 保存后变 `*foo [bar*](/url)`，**用户保存一次就改坏文件**（数据事故级）。
- **根因**：关闭 mark 定界符时按 `node.marks` 数组逆序——而该序是 **schema 的定义序**（`link` rank 0 早于 `italic` rank 3），与真实打开层次无关。
- **教训**：① 排序键必须是**实际发生顺序**（打开时间栈），不能用**声明顺序**；② 这类 bug 单测全绿也测不出（原测试用「手抄 schema 镜像」掩盖了），**测试要换真身**（见 F4）。
- **索引**：[KNOWN-ISSUES §一 #26](./KNOWN-ISSUES.md)、[敏感区第 16 条](../docs/sensitive-areas.md)

### B2 · NodeView 不走 Vue 生命周期，必须成对清理

- **现象**：代码块 / 图片 NodeView 的监听器与闭包在节点销毁后仍存活，长会话线性积累内存 + 幽灵回调。
- **根因**：NodeView 的 `dom` 由 ProseMirror 直接增删，没有框架替你收尾。
- **教训**：① 监听器统一挂 `AbortController` 的 `signal`，`destroy()` 里一次 `abort()`；定时器不在 signal 管辖内，**单独清**；② **易漏的第二半**——销毁后的**异步回写**也要守卫：`requestId` 活在同一个已销毁闭包里会自匹配，**单靠它挡不住**，必须额外查 `signal.aborted`。
- **索引**：[KNOWN-ISSUES §一 #10](./KNOWN-ISSUES.md)、[敏感区第 12 条 / §11.7](../docs/sensitive-areas.md)

### B3 · 收紧容器约束 = 静默丢内容

- **现象**：同层混排「普通项 + 待办项」（同为 `-` 标记、中间无段落）打开后**整段消失**，只剩空段。
- **根因**：解析器「容器判定」与「子项判定」用了两套判据 ⇒ `taskList` 里塞进 `listItem` ⇒ `createAndFill` 失败 ⇒ `closeNode()` **静默返回空段落**。
- **教训**：① **「静默丢弃」是最危险的失败模式**——解析失败应给信号，不该悄悄给空；② 容器判定与子项判定**必须同一套判据**；③ 改 schema 约束前先看**正向契约锁**（差异集校验只能发现「多处不一致」，看不出「一起改错」）。
- **索引**：[KNOWN-ISSUES §二 #10](./KNOWN-ISSUES.md)、[敏感区第 15 条](../docs/sensitive-areas.md)

### B4 · 嵌套序列化必须继承外层模式

- **现象**：复制引用块 / 表格单元格粘到外部编辑器，多出 `\=` `\$` 等反斜杠。
- **根因**：内层 state 用了**默认构造**（= 文件落盘的严格转义模式），把外层的剪贴板轻量标记丢了。
- **教训**：块处理器需要嵌套序列化时用 `state.createChild()` 继承模式，**不要 `new MarkdownSerializerState()`**；只有两个真入口允许直接构造。列宽统计与内容输出还必须调**同一个** `cellToText`。
- **索引**：[KNOWN-ISSUES §一 #11](./KNOWN-ISSUES.md)、[敏感区 §11.8](../docs/sensitive-areas.md)

### B5 · ProseMirror slice 的「开口」语义

- **现象**：格内双击选两个字复制，粘到聊天框变成整段 GFM 表格源码。
- **根因**：`doc.copy(slice.content)` 丢掉 slice 的 open 标记；选区落在容器内时，边界处的容器节点是「部分包含」的开口层，被当闭合节点整段渲染。
- **教训**：凡「取选区再序列化」的代码，**先问选区是否落在深层容器内**；序列化前先剥开口层（`stripOpenLayers`）。
- **索引**：[KNOWN-ISSUES §一 #16](./KNOWN-ISSUES.md)

---

## C. 独立闸门：修一条必须验证另一条

### C1 · CSP ≠ CORS，是两道独立闸门

- **现象**：修好 CSP `font-src` 后字体仍不生效。
- **根因**：CSP 管「**能否发起请求**」，CORS 管「**能否读取响应**」。放行请求 ≠ 放行响应。
- **教训**：先区分**资源类型**——`<img>` / `<script>` / `<link>` 是普通加载（不走 CORS），`fetch()` / `FontFace` / `XHR` **强制走 CORS**。Tauri asset protocol 不返回 `Access-Control-Allow-Origin`，所以 `FontFace` 用 asset URL 必然失败。字体最终解法：CSS `@font-face` 注入（`url()` 不走 CORS），字节通道 `readFontBytes` 作兜底。
- **索引**：[KNOWN-ISSUES §一 #7](./KNOWN-ISSUES.md)、[敏感区第 11 条](../docs/sensitive-areas.md)

### C2 · 剪贴板有两条独立管道

- **现象**：表格选区粘到外部带表格壳——修了 `text/html`，`text/plain` 照旧漏。
- **根因**：`text/html` 与 `text/plain` 是**两条独立管道**，只修一条等于没修完。
- **教训**：动剪贴板必须**两条都验**（外加 solo→solo 粘贴，它走 HTML + `parseHTML`，不依赖 `text/plain`）。
- **索引**：[KNOWN-ISSUES §一 #16 / #24](./KNOWN-ISSUES.md)、[敏感区第 13 条 / §11.8](../docs/sensitive-areas.md)

### C3 · 同一份转义函数可能服务两个目标

- **现象**：想「砍掉剪贴板多余转义」，实测证明**文件落盘与剪贴板共用** `escapeInline`，砍了会误伤落盘（79 份真实语料回放，14 份语义漂移）。
- **根因**：一个产出服务多个目标 ⇒ 必然有目标受委屈。
- **教训**：① 对外产出**按目标分流**（富格式走 HTML、纯文本走渲染后文字、源码走显式入口）；② **动产出策略前先查谁还共享这条路径**，用真实语料回放验证，别只看函数名。
- **索引**：[KNOWN-ISSUES §一 #24](./KNOWN-ISSUES.md)、[敏感区 §11.8](../docs/sensitive-areas.md)

### C4 · 「要不要回落」用白名单，不用黑名单

- **教训**：白名单 = **退化安全**方向（新增节点默认回落，忘登记也不会静默丢内容）；黑名单 = 新增节点默认放行，一旦漏登记就静默丢。
- **索引**：[KNOWN-ISSUES §一 #24](./KNOWN-ISSUES.md)（`PLAIN_TEXT_SAFE_NODES`）

---

## D. 减法优于加法

### D1 · 「加守卫」掩盖根因，「移/门控」才是解法

- **现象**：IME 失锚时，做法是在 N 个插件里各塞一个 `view.composing` 判断。
- **根因**：给症状打补丁是**加法**，会随插件数量扩散复杂度且永远补不全。
- **教训**：优先**移除或门控惹祸特性**（如把 `content-visibility` 限定到大文档），或把守卫**收敛到单一中枢**，而不是每处复制一份判断。
- **索引**：[KNOWN-ISSUES §一 #15](./KNOWN-ISSUES.md)

### D2 · 警惕「单向棘轮」：只加不减

- **现象**：剪贴板转义历史上被改了三次（06-27 → 06-28 → 07-21 → 09-06），**全是「加转义」，零次「减」**，累积到用户复制什么都夹带 `a\*b`。
- **根因**：每次都在修补局部，从没人回头质疑「这个产出方向本身对不对」。
- **教训**：当同一处被反复「加东西」修了三次以上，**停下来质疑架构**，别继续打补丁；范式改造（照 Typora 分流）优于第四次加转义。
- **索引**：[KNOWN-ISSUES §一 #24 / #25](./KNOWN-ISSUES.md)

### D3 · 不是所有「理论缺陷」都值得修

- **现象**：性能审查列了 12 项，9 项修、**3 项经评估主动跳过**。
- **教训**：开销极小的路径（线性查找几十条命令、`forEach` 遍历顶层块）优化收益 < 改造风险。**先量化再决定**，不追「理论完美」。
- **索引**：[ARCHITECTURE](../ARCHITECTURE.md)（性能优化条目）

### D4 · 守卫必须收敛到单一中枢

- **教训**：组字态（IME）判定统一走 [`composition-freeze.ts`](../src/components/Editor/tiptap/composition-freeze.ts)——新增 decoration / appendTransaction / NodeView / 浮动菜单**都走它**，别再造第 5 份 `let liveView`。同一判断的 N 份副本 = N 个未来会漂移的地方。
- **索引**：[AGENTS.md §1 禁令 8](../AGENTS.md)

---

## E. 已舍弃，勿重做（防重复劳动）

> **重要**：以下都是**主动放弃**的，不是未完成待办。看到相关 commit 或代码在 reflog / 分支里，**不要重新提交**。

### E1 · 丝滑体验优化（`bb76c25` / `612ddb5` / `828b18c`）

- **舍弃原因**：核心方案 `useSmoothScroll.ts` 用 JS 拦截原生 wheel 做 lerp 插值，导致滚动**比原生更卡**——这是**负优化**，不是优化不充分。
- **后续**：`87f8542` 已单独 cherry-pick 了其中安全的部分（动效 token 统一）。若要救回其余，**必须放弃 JS 拦截 wheel**，改用 CSS `scroll-behavior: smooth` 等原生方案。
- **教训**：**「看似合理的优化」≠ 产品真的变好**。动原生行为（滚动/输入/IME）前必须真机对比，否则可能倒退。

### E2 · 粘 Word 列表「重建回真列表」

- **舍弃原因**：Word 用 `MsoListParagraph` + 段首硬写符号伪装列表，`stripMsoMarkup` 清理后只剩普通段落。**启发式重建的变体多、误判正常文字（如「1. 我先说」）风险高**。
- **定性**：降级为可接受「能用」（不乱码、不坏文档），非 bug。见 [KNOWN-ISSUES §三](./KNOWN-ISSUES.md)。

### E3 · 继续给 IME 加守卫

- **舍弃原因**：2026-09-05 组字期诊断证明**应用层干净**（光标矩形从未退化、无装饰重建、无 refocus），残差判定为 WebView2/TSF 外部缺陷。**编辑器层封顶，不再加守卫**。
- **索引**：[KNOWN-ISSUES §二 #8](./KNOWN-ISSUES.md)

---

## F. 文档与事实脱节

### F1 · 判定「谁在用」必须走调用链，不得采信注释

- **现象**：`compat-schema.ts` 曾被判定为「粘贴路径在用」，据此报「粘贴丢 frontmatter / 图片尺寸」；按调用链复核证明它是**死代码**（生产零调用），那段缺陷描述是**拿死代码测出来的**。
- **教训**：判定使用关系走 **`grep` + 追实参 + `git log -S`**，**文件头注释不算证据**。
- **索引**：[KNOWN-ISSUES §二 #11](./KNOWN-ISSUES.md)

### F2 · 断言与删除，都必须先核实历史行为

- **现象**：① `font.rs` 注释写「无扩展名导致 Content-Type 推断失败」，查历史版本反证该说法错误；真正的改动是缓存 key 命名规则变了。② 反向同错：整理文档时凭「看着像编的数字」删掉「SSOT 违规已复发两次」，回查 CHANGELOG 发现 v1.2.27 `read_clipboard_html`、v1.2.30 `detect_proxy_for_update` 有完整实证 —— 属误删。
- **教训**：写「原因」前先核实代码历史，**不能凭推测写**——错误注释会误导下一轮排查（A1 的四版弯路部分源于此）。**删「结论」同理**：删除本身也是一次未经证实的判断，拿直觉去删证据充足的断言，等于制造新的信息缺失。
- **索引**：[KNOWN-ISSUES §一 #7](./KNOWN-ISSUES.md)、[CHANGELOG](./CHANGELOG.md)

### F3 · 单一真理源（SSOT）违规的两个高频形态

- **形态一 · 硬编码 IPC**：新增 Rust 命令时前端直接 `invoke('xxx')`，绕过 `command-names.ts`（v1.2.27、v1.2.30 **同类复发两次**）。→ 新增命令后立即全库 grep `invoke('`。
- **形态二 · 硬编码计数**：文档里写死命令数 / 扩展数 / 测试数，随即漂移。→ 一律写「以 `generate_handler!` / `bun run test` 实际为准」。
- **形态三 · 同一事实写三处**：`Ctrl+/` 的键位在 `useAppDomEvents.ts` 硬编码、在 `CustomTitlebar.vue` 写文案，而**官方总表 `registry.ts` 里根本没有**。→ 改这类事实**整条链路一起改**；更重要的是**能填的坑要填**——该例已于 2026-09-14 收编进 registry，从此「改一处即可」，不再依赖「记得改三处」。
- **索引**：[AGENTS.md §2 真理源地图](../AGENTS.md)、[KNOWN-ISSUES §二 #3](./KNOWN-ISSUES.md)

### F4 · 测试的「假绿灯」：换真身才现形

- **现象**：① 测试用「手抄 schema 镜像」，与生产 schema 漂移，**12 条失真用例被掩盖**，换用生产 schema 后当场现形；② `fixtures`/`fuzz` 只断言 `round2 === round1`，对「**稳定地丢内容**」完全免疫（丢完两轮依然一致，永远绿）。
- **教训**：① 测试**复用生产对象**，不手抄镜像；② 保真断言的**参照系必须是第三方**（markdown-it），不能拿自己当参照——用自己当参照会把缺陷**对称复制**到参照侧（实测「丢一半内容」也判等价）；③ 随机测试**必须种子化**（mulberry32），失败报文带 `seed` 可原样重放。
- **索引**：[KNOWN-ISSUES §二 #11 / #12](./KNOWN-ISSUES.md)、[敏感区第 15/16 条](../docs/sensitive-areas.md)

---

## See also

- [已知问题与技术债（事实台账）](./KNOWN-ISSUES.md)
- [Agent 契约（禁令清单可执行版）](../AGENTS.md)
- [架构权威地图（敏感区速查）](../docs/sensitive-areas.md)
