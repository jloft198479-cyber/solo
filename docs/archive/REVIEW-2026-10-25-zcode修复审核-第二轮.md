---
title: zcode 修复执行审核（第二轮）— P2-4 字号折算 / P2-5 file: 图片
type: review
audience: maintainer
status: active
tags: [审核, 代码评审, 修复验收, 出站样式, 图片协议, 安全]
summary: 对第二轮 3 个提交（8ba6efa toPx 重写 / f3be78b 图片协议门禁 / 6a0d575 台账 #61-#62）做独立审核。需求符合 2/2，无越界改动，既有测试 0 行删除，新增 14 条测试与 2141→2155 精确对账，lint 0 error / 72 warning（比上轮少 1）。独立真跑 13 组协议边界 + 13 组 toPx 形态：clamp/%/vw/em 折算全部符合预期，file: 图片与链接往返稳定，javascript:/vbscript: 仍拒，C:/、//cdn、asset:、data:、相对路径、https 全部不误伤。额外做安全核查三项（CSP img-src 不含 file:、link-open 白名单无 file:、opener capability 默认 scope）全部闭合。发现 2 处可改进：min()/max() 被并入 clamp 取上界语义偏大（min(2em,3em)→48px 应为 32px）；无单位数字（`heading1Size: "1.5"`）仍产 1.5px 隐形字，与「宁可平庸不出隐形字」的宣称有缺口。均不阻塞。
updates: [docs/KNOWN-ISSUES.md, docs/archive/REVIEW-2026-10-25-zcode修复审核.md]
---

# zcode 修复执行审核 · 第二轮（2026-10-25）

> 审核对象：`8ba6efa`（#61 字号折算）· `f3be78b`（#62 file: 图片两段治理）· `6a0d575`（台账）
> 需求基准：[核实结论 §3 P2-4 / P2-5](./REVIEW-2026-10-25-核实结论-全项目隐藏bug审计.md)
> 前置：第一轮审核 [REVIEW-2026-10-25-zcode修复审核.md](./REVIEW-2026-10-25-zcode修复审核.md)

---

## 1. 需求符合性：2/2

### #61 toPx 符号折算（P2-4）

独立真跑（走 `serializeDocumentHtml` 真实出站链路，不测私有函数）：

| CSS 变量值 | 出站 h1 字号 | 判定 |
|---|---|---|
| `clamp(1.5em, 2vw, 2.2em)` | **35.2px** | ✅ 取上界 2.2em，不再 1.5px |
| `clamp(12px, 1.5vw, 18px)` | **18px** | ✅ px/em 混合也对 |
| `120%` | **19.2px** | ✅ 字号语义，不再是 120px |
| `100%` / `150%` | 16 / 24 | ✅ |
| `2vw` | **16px** | ✅ 回落正文字号 |
| `10vh` | 16px | ✅ 回落 |
| `calc(1em + 2px)` | 16px | ✅ 合理 |
| `1.6em` / `2EM` / `" 2em "` | 25.6 / 32 / 32 | ✅ em 语义与大小写、空格都不误伤 |
| `2rem` | 32px | ✅（`endsWith('em')` 对 rem 巧合正确，按 base 近似，注释已声明） |
| `""`（空） | 25.6px | ✅ 走 readVar 的 fallback |

### #62 图片协议两段治理（P2-5 / P2-5b）

独立真跑 13 组：

| 场景 | 结果 | 判定 |
|---|---|---|
| `![](file:///D:/photos/cat.png)` | 解析成 image 节点；R1 = R2 = 原字节 | ✅ 存量不再逐次恶化 |
| `[本地](file:///D:/a.md)` | 链接节点保真往返 | ✅ |
| `file:///D:/a.png#x` / `FILE:///` | 都稳定往返 | ✅ 大小写与锚点无碍 |
| `![](javascript:alert(1))` | 退化成 `!\[](...)` 字面 | ✅ 仍拒 |
| `![](vbscript:msgbox(1))` | 同 | ✅ 仍拒 |
| `![](https://…)` / `![](images/a.png)` / `![](//cdn/…)` / `![](asset://…)` / `![](data:…)` / `![](C:/x.png)` / `![](D:\x.png)` | 全部正常往返，无误伤 | ✅ |

`file-url-roundtrip` 是报告外**多修的一层**（只堵入站不救存量，用户已有的 file: 图仍会每存坏一层）。这个扩展判断正确。

---

## 2. 非必要修改检查：无越界

| 类别 | 内容 | 判定 |
|---|---|---|
| 源文件 | `external-styles.ts`（toPx 重写）+ `image.ts`（协议门禁 + 相对路径判据）+ `parser.ts`（validateLink 放行 file:） | ✅ 三项都直接对应需求 |
| 测试 | `external-styles.spec.ts` **追加 4 条、删除 0 行**；`image-src-protocol.spec.ts` 7 条；`file-url-roundtrip.spec.ts` 3 条 | ✅ 未改既有断言 |
| 配置 / 依赖 / Rust | **0** | ✅ |

**测试数对账**：2141 → **2155** = +14；新增 4 + 7 + 3 = **14** ✓ 精确吻合。

**基线**：`vitest --mode full` 104 files / 2155 tests 全绿；`eslint src/` 0 error / **72 warning**（第一轮后 73，本次反降 1，说明 toPx 重写顺手消掉一条）。Rust 未改动。

---

## 3. 额外安全核查（本轮修复引入的协议放行，重点核）

放行 `file:` 到 markdown-it 的 `validateLink` 会让 `<a href="file:///…">` 出现在 DOM 里。三条链路逐一核：

| 面 | 实测/源码 | 结论 |
|---|---|---|
| 编辑器内图片加载 | `tauri.conf.json` CSP `img-src` = `'self' asset: http://asset.localhost data: blob: https: http:` —— **不含 `file:`** | ✅ file: 图必是破图占位，不读本地文件 |
| Ctrl+Click 跳转 | `link-open.ts` `ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:']`，`file:` 走「白名单外提示」分支 | ✅ 不会 `openUrl` |
| Rust 侧双保险 | capabilities 只有 `opener:allow-default-urls` + `opener:allow-open-url`，默认 scope 是 http/https/mailto/tel | ✅ 即便前端漏挡也到不了系统 |

`javascript:` / `vbscript:` 维持 markdown-it 默认拒绝 ✓，`BLOCKED_SRC_RE` 在入站侧再拦一层 ✓。

**结论：放行 file: 只影响「解析成节点 + 字节往返」，不构成本地文件读取或命令执行面。**

---

## 4. 两处可改进（均不阻塞）

### ① `min()` / `max()` 被并入 clamp 分支取上界 —— 语义偏大

实测 `min(2em, 3em)` → **48px**（正确语义应 32px）。根因是 `/^(?:clamp|min|max|calc)\(/` 共用「取 candidates 最大值」这一条规则。

影响：字号变量里写 `min()/max()` 极罕见；且偏大方向不会产出隐形字或残缺内容，只多几像素。若修，`min()` 分支取最小值即可，两行。

### ② 无单位数字仍产隐形字 —— 与修复宣称有缺口

实测 `--mk-heading1-size: 1.5` → 出站 **1.5px**。

这正是 #61 要防的那种不一致：`font-size: 1.5` 在 CSS 里是非法值 ⇒ 编辑器回落到默认字号（看起来正常），复制出去却是 1.5px 隐形标题。修复注释写「宁可平庸字号，不出隐形/巨型字」，但 `/^-?[\d.]+$/` 这一支直接 `return n`，没走回落。

严重性低（用户得手搓非法 CSS 才会中招；`clamp()`/`%` 这类合法写法的真实场景已覆盖）。若要收口：无单位数字一律回落 `base`（CSS 里本来也无效）。

---

## 5. 一处需要知情的行为不一致（不是 bug）

同一个 `file:` 图，两个入口待遇不同：

- **粘贴 HTML**（网页/Outlook）→ `pickImageSrc` 返回 null → **整图丢弃**
- **磁盘 md 或粘贴 markdown 源码**（`![](file:///…)`）→ markdown 管线放行 → **保留成节点、字节往返**

逻辑上自洽：HTML 入口里 file: 必然是破图（用户看不到内容），md 入口里它是用户文件里的既有内容，丢它就是数据损坏。但**用户视角会疑惑**「同一个地址，粘贴进来没有、打开文件却有」。可接受，记一笔。

---

## 6. 审核结论

**通过，可合并。**

- 需求符合 2/2，两项修复都经独立真跑验证（不止看代码）
- 无越界改动、既有测试 0 行删除、测试增量精确对账
- 协议放行的三条安全链路全部闭合，没有引入本地文件读取面
- 台账 #61/#62 登记完整，且 #62 把「入站丢弃」与「存量往返」拆成两段写，比原报告更细

**建议（不阻塞）**：
1. `min()`/`max()` 单独取最小值 —— 两行，顺手做掉
2. 无单位数字回落 `base` —— 一行，补上「不出隐形字」的最后缺口
3. 第一轮遗留的两项真机验收仍未做：#59 列表多选、#60 **双窗改名**

**第二轮之后仍未修的（来自审计报告）**：P2-3 设置多窗口覆盖、P3 全组约 28 条、Rust 分区 R-2/R-3/R-4/R-5 等。
