---
title: zcode 修复审核（第三轮：#65–#68，13 项）
type: review
audience: dev
status: active
tags: [修复审核, 审计收口, 回归锁]
summary: 通过可合并；13 项全落地、无越界、锁经反向校准承重、全量测试与保真体检全绿；C-4 有行为回退需补，R-12/B-2 措辞需修正
updates: []
---

# zcode 修复审核（第三轮）

> **审核对象**：`8102888`（markdown 内核管线）· `48dcd06`（app 交互与生命周期）· `4f7bbe1`（rust）· `178a7e8`（台账 #65–#68）。范围 `1a44075..178a7e8`。
> **基线**：HEAD `178a7e8`，工作区干净，v1.2.65。
> **审核方式**：逐行读 diff 对台账声称 → 独立跑全量测试 / lint / 保真体检 → **反向校准 4 项**（撤掉修复必须转红，证明锁不是假绿）→ 临时改动均已 `git checkout` 还原，未留任何产物。

---

## 一、总判定：**通过，可合并**

| 维度 | 结果 |
|---|---|
| 13 项是否全落地 | ✅ 全部落地，代码形态与台账描述一致 |
| 越界改动 | ✅ 无。18 个文件全部对应台账项（含 5 个测试文件） |
| 既有测试期望被改 | ✅ 仅 2 处，均为**修正错误期望**（见 §四），不是洗绿 |
| 全量测试 | ✅ **107 files / 2167 全绿**（1 skipped）；较上轮 104/2155 = +3 files / +12 条，与新增锁对账吻合 |
| lint | ✅ **0 error** / 70 warning（无新增 error） |
| 保真体检（`SOLO_FIDELITY_SCAN=1`） | ✅ 19 份 md，**渲染有变化 0 份、二轮不收敛 0 份** |
| 反向校准（锁是否承重） | ✅ 4 项撤修复全转红（详见 §三） |

---

## 二、反向校准明细（审核的核心证据）

| 项 | 撤掉什么 | 结果 |
|---|---|---|
| B-2 引用块空行 | `line ? \`> ${line}\` : '>'` → 复原为 `\`> ${line}\`` | ✅ `blockquote-empty-line` **1 红**（另一条「内容行不误伤」仍绿，符合预期） |
| D-1 保存锁 | try/catch/finally → 复原为 `await _savePromise; isSaving=false; …` | ✅ `useDocumentSession` D-1 用例 **1 红** |
| C-3 行内 code 守卫 | 去掉 `nodeBefore.marks` 半句 | ✅ `paste-code-mark-guard` **1 红** |
| C-7 `![[` 前缀 | 判据改成恒不命中（`=== ''`） | ✅ `wikilink-input-rule` **2 红**（伪嵌入 + 「不误伤普通 `[[`」） |

结论：**没有假锁**。C-7 那两条一起红尤其说明「不误伤」也在被守护，不是只测了目标行为。

---

## 三、必须处理的问题（1 条）

### P1 · C-4 的修法把「该关的场景」一起放掉了（行为回退）

- **现状**：`mermaid-block.ts` 的 NodeView `destroy()` 删掉了 `if (lightboxState) closeMermaidLightbox()`。而 `closeMermaidLightbox` 全仓只有本文件 4 处调用（开启时先关旧的 `:46`、关闭按钮 `:114`、点遮罩 `:118`、Esc `:154`）——**没有任何外部关闭入口**。
- **后果**：mermaid 全屏预览打开时，
  - **切文档**（`replaceDocumentWithoutHistory` 整篇替换 ⇒ 全部 NodeView destroy）→ 预览**留在屏幕上**，显示的是上一篇的图；
  - **删除/撤销该块** → 预览留在屏幕上，显示已不存在的内容。
  - 修复前这两个场景都会自动关。
- **定性**：不丢数据、Esc 与点遮罩都能关，属**轻微**回退；但违反「改动只许提升体验、不可衍生回归」的纪律，且这是用户**看得见**的现象变化。
- **根因**：把「误关他块」的修法做成了「一律不关」，而不是「只关自己」。
- **建议改法**（一两行）：`lightboxState` 里增记来源 —— 开预览时存 `sourceSvg`，`destroy()` 里 `if (lightboxState?.sourceSvg === 本块渲染出的 svg) closeMermaidLightbox()`。这样删自己会关、删别人不关，两头都对。
- **若决定不修**：至少登记一条 KNOWN-ISSUES，否则下一个来报「删了图预览还挂着」的会是用户。

---

## 四、需修正的措辞（3 条，不影响合并）

### R-12 熔断「名不副实」

```ts
if (html.length > HTML_VOLUME_LIMIT) {
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
```

- 超限后**仍然全量过 `DOMParser`**，只省掉了后面的 ProseMirror 解析与建文档。注释与台账写「超大 HTML 全量过 DOMParser + PM 解析会卡 UI 数秒」，读起来像两半都省了 —— 实际只省了后一半（而 PM 那半确实是大头，2MB 的 DOMParser 约 50–200ms，可接受）。
- 另一处要写清：`textContent` 会把多段压成一行（`<p>a</p><p>b</p>` → `ab`），「内容还在、只是没了格式」的准确含义是**连段落分隔也没了**。
- 建议：注释改成「跳过 PM 解析（大头），DOM 解析仍在，可接受」。

### B-2 是「单向规范化」，不是「任何输入都不改字节」

- 修复把漂移方向从「`>` → `> `」翻成「`> ` → `>`」。
- 用户文件若用的是**带尾随空格**形态（部分编辑器会这么写），打开后首存**仍会改一次字节**，只是这次往干净形态走；同时我方不再主动制造尾随空格。
- 台账「首存即改文件字节」若被后人理解为「彻底解决」会误判。建议补一句：「我方输出不再制造尾随空格；外部带空格形态仍会被规范化一次（serializer 只能选一侧）」。
- 这是**取舍正确、但不是双向保真**，与 callout 同款，不必改代码。

### B-3 正则收窄是能力变化

- `[^\][|]+` 使 `[[a[b]]`（target 含 `[`）不再被识别为互链，降级为纯文本。
- 这种写法罕见且非标准，收窄合理；但台账「不影响正常互链」宜补半句「target 含 `[` 的非标准写法不再识别」。

---

## 五、两处「改既有测试期望」的判定：**合理，不是洗绿**

| 位置 | 改动 | 判定 |
|---|---|---|
| `roundtrip.spec.ts` ×2 | `'> 正文\n> \n> $$…'` → `'> 正文\n>\n> $$…'` | ✅ 旧断言钉的就是那个尾随空格，属**修正错误期望**；且同时新增了独立锁 `blockquote-empty-line` |
| `fixtures.spec.ts` | 删除 `blockquotes.md` 的 `FORMAT` 登记 | ✅ 这是**收紧**（登记表里的文件免于字节保真检查，删掉=必须保真），不是放宽 |

---

## 六、其余项抽查（均实现到位）

| 项 | 核实要点 |
|---|---|
| D-1 | try/catch/finally 包住 `await _savePromise`，两把锁在 `finally` 复位 ✔；测试同时 mock 掉 `saveDocument` 与 `message` 两个 reject，靶子对 |
| D-4 | `App.vue` 去掉门外 `isDirty &&` 后，`saveCurrentDocument` 开头有 `!force && !isDirty && !evaluateDirtyFromEditor()` 短路 ⇒ 不脏不写盘、不 IPC ✔；顺带修好「新建空文档点保存无反应」（现在会走另存为） |
| D-3 | `stopPropagation()` 补齐，对齐 SettingsModal ✔ |
| C-9 | `math-inline` 的 `destroy()` bump `renderVersion`，而异步回调处确有 `version !== renderVersion` 比对（`:47`/`:54`）⇒ 闸门真实有效，不是假修复 ✔ |
| D-7 | `registration.catch` 置回 `null` 且赋值顺序正确（catch 在微任务里跑，晚于 `sharedUnlisten = registration`）✔ |
| R-4 | 4 个 font 命令 8 处校验全覆盖（`fetch_font_data:163-164`、`get_cached_font_path:189-190`、`save_font_cache:230-231`、`read_font_bytes:271-272`）✔；32MB 上限是**真流式**（`response.chunk()` 逐块累加，不是先 `bytes()` 再判）✔；重定向 `attempt.url().scheme() != "https"` 判的是**下一跳**，能挡 https→http ✔ |
| R-6 | 命名掺 `pid + TMP_SEQ`，与 `temp_path` 同法；`unique_asset_target` 的 -1/-2 兜底未动 ✔ |

**无异议的小观察**（不必改）：D-7 在「首次注册失败、catch 尚未执行的微任务窗口」内第二次订阅会认为已注册而不重试（概率极低）；32MB 上限未读 `Content-Length`，会读满 32MB 才断（不是提前拒）；`validate_font_file_name` 挡 `..` 会误杀含 `..` 的合法名（现实中无此字体名），Windows 保留设备名（CON/NUL）未挡，属纵深防御下一层。

---

## 七、给下一轮的建议顺序

1. **C-4 补「只关自己」**（1–2 行 + 可加 1 条锁：删 A 块不关 B 块的预览 / 删自己才关）。
2. **R-12 注释与台账措辞**修正（纯文档，零风险）。
3. **B-2 / B-3 台账补半句**（说明是单向规范化 / 非标准写法不再识别）。
4. 其余不动。

---

## 八、矫正记录（2026-10-25 10:20，授权「适度矫正」后执行）

| 项 | 动作 | 验证 |
|---|---|---|
| **C-4** | `lightboxState` 增记 `sourceSvg`；`destroy()` 由「一律不关」改为 `dom.contains(sourceSvg)` 才关 —— **删自己关、删别人不关、切文档跟着关**，两头都对 | 新增锁 `mermaid-lightbox-lifecycle.spec.ts`（两块场景）；**双向反向校准**：退回「一律不关」→ 红在「删发起方后必须关」；退回「无条件关」→ 红在「删别的块不得关」。锁双向承重，不是单向假绿 |
| R-12 措辞 | 代码注释 + 台账 #66 改为「只省掉 PM 解析这一半，DOM 解析仍在（2MB 约 50–200ms）；`textContent` 会连段落分隔一起丢」 | — |
| B-2 措辞 | 台账 #65 补「单向规范化：外部带尾随空格的形态首存仍会被规范化一次，双向保真做不到」 | — |
| B-3 措辞 | 台账 #65 补「`[[a[b]]` 这类 target 含 `[` 的非标准写法不再识别」 | — |

**改后基线**：
- vitest **108 files / 2168 全绿**（较矫正前 +1 file / +1 条 = 新锁）
- `npx vue-tsc --noEmit` **0 错误**
- lint 改动文件 **0 error**（3 个 warning 均为既有 `no-explicit-any`，不在改动行）
- 工作区仅含本次矫正的 3 个文件改动 + 2 个新增文件（本报告 + 新锁），无其他残留

**未做（维持现状，均为可接受低概率项）**：字体下载 `Content-Length` 预判、Windows 保留设备名（CON/NUL）拦截、D-7 并发订阅的微任务窗口。
