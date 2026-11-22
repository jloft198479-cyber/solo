# 复查：字体作用域改动 + 顺带发现的存量问题（2026-10-17）

> 范围：本轮 A 方案改动（`--font-ui` 拆分）**本身是否合理 / 简洁优雅**，以及复查过程中撞见的**存量**冗余、僵尸代码、全局与性能隐患。
> **本次只记录，未改任何代码**（除复查前已落地的 A 方案）。所有断言带文件与行号。

---

## 一、本轮改动自评：合理，但有 2 处可优化

**结论：改动方向与实现都站得住 —— 最小侵入（5 文件 / 30 行）、零运行时开销、零新增依赖、可机器验证。**

| # | 改动 | 判据 | 结论 |
|---|---|---|---|
| 1 | `--font-ui` 新增 + `body` 改用它 | 界面字体独立变量，编辑区继续用 `--font-text` | ✅ 合理 |
| 2 | `editor.css` 三处提示文字固定 `--font-ui` | 就地覆盖，未引入新类 / 新选择器层级 | ✅ 合理 |
| 3 | 三处文案改为「正文字体」 | 与实际作用域一致 | ✅ 合理 |
| 4 | 新增契约锁 `font-scope.spec.ts` | 已反向校准（撤修复→红，还原→绿） | ✅ 合理 |

**可优化（不改也成立，记着即可）**

- **a. 中文字体 fallback 段在两处重复**：`--font-ui` 与 `--font-text` 都写了 `'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB'`（`main.css:6-12` / `:14-18`）。将来加中文字体要改两处。**建议等真要加字体时再抽 `--font-cjk` 片段** —— 现在抽只会让 CSS 变量多一层间接、调 DevTools 时更绕。
- **b. `--font-text` 默认值里含 `'Inter'`，但它是僵尸项** —— 见 §二.4。

---

## 二、顺带发现的存量问题（按优先级）

### P1｜建议修（有用户可感差异，且违反项目硬禁令）

**1. 导出端 mono 字体栈硬编码，且与 `--font-mono` 漂移**

- 事实：`externalize-html.ts:96` 写死 `'ui-monospace, SFMono-Regular, Menlo, monospace'`；而 `main.css:5` 的 `--font-mono` 是 `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`。全仓只有这两处字体栈**字面量**（已 grep 实证）。
- 影响：这个函数作用于 mermaid / math 的**纯源码块**，把内容送进剪贴板（Word / 浏览器）⇒ 外部消费者看到的代码字体与编辑器内**可能不同**（且这两处都属"代码块"，本该一致）。
- 性质：违反 `AGENTS.md` §1 硬禁令 2（不许硬编码），lint 未拦。
- ⚠️ 注意它在**剪贴板出站**路径（`ARCHITECTURE.md §11.8` 敏感区）⇒ 真改要跑剪贴板相关锁，且要确认「外部消费者没有 JetBrains Mono」时 fallback 链仍然通。

### P2｜冗余 / 真理源重复（无用户可见影响，但违反"一处定义"）

**2. 字体状态逻辑两处重复，且两处能力不齐**

- `FontPopover.vue:17-62` 与 `SettingsFontSelect.vue:9-29` 各自实现一遍「批量 `isFontAvailable` + `onProgress` 订阅 + 进度/失败状态」。
- 能力差异（**不一致本身就是隐患**）：
  - FontPopover 有竞态防护（`disposed` 标志）＋ 失败态（`isFontFailed`）；
  - SettingsFontSelect **两者都没有** ⇒ 组件卸载后迟到的 `isFontAvailable(...).then` 仍会写 ref（Vue 卸载后写入的警告/引用残留），且下载失败在设置页只显示"需下载"、不显示失败。
- 建议：抽 `useFontStatus()` composable（顺带补齐竞态防护与失败态），两处共用。

**3. `SYSTEM_FONTS` 与 `fonts.ts` 的自定规则冲突**

- 事实：`fontLoader.ts:17` 硬编码 `new Set(['system-ui', 'Microsoft YaHei UI'])`，但 `constants/fonts.ts:9` 的注释明确写着「『是否需下载』统一用 `fileName !== undefined` 推导，UI 与 fontLoader 共用此判定」。
- 而且它还有第三重冗余：`ensureFontLoaded`（`:153-157`）与 `isFontAvailable`（`:179-180`）里 `REMOTE_FONTS[family]` 缺项分支已经能兜住系统字体。
- 影响：**当前无害**（三条判断结果一致）；新增系统字体时漏进 Set 也不会出错。属"注释说一套、代码做一套"，后来者按注释读会误判。

**4. `--font-text` 默认栈里的 `'Inter'` 是僵尸项**

- 实证：`constants/fonts.ts` / `utils/fontStack.ts` / `services/fontLoader.ts` 全无 `Inter`（已 grep）；而默认设置是 `fontFamily: 'Microsoft YaHei UI'`，`useEditorAppearance` 会用 `buildFontStack()` 整串覆盖 `--font-text`。
- 双重后果：① Inter 从未被加载，几乎永远 fallback；② 这个默认值只在"JS 尚未执行"的极短窗口生效。
- 处置建议：留着无害，删掉更诚实（或改注释说明它只是"如果系统装了就用"）。

**5. 字号 / 行高变量注入两处**

- `settings.ts:279-284`（主题切换后覆盖主题值）与 `useEditorAppearance.ts:46-69`（watch 设置变化）两条路径写同一对变量，靠注释维持优先级。
- 当前**无 bug**（值一致），但属"同一事实两处写"；真正的真理源是 `--mk-font-size` 的默认值（`editor.css:32-34`：# `:root` 里给默认，主题和设置页都用 inline style 覆盖）。

### P3｜可读性 / 抛光（记着就行）

**6. `applyFontFamily` 对系统字体也无差别触发 crossfade**

- 切到「系统默认 / 微软雅黑 UI」时不存在"字体到位闪一下"的问题，却仍走 200ms 淡入（`useEditorAppearance.ts:23`）。影响极小。

**7. 魔法数字 600ms**：`FontPopover.vue:50` 等字体注册完成的缓冲值硬编码，注释有解释但值未抽常量（违反"阈值走常量"）。

**8. 进度哨兵 `-1`**：`fontLoader.ts` 用 `notifyProgress(family, -1)` 表示"结束"，但 `ProgressListener` 的类型注释里没有这个约定 ⇒ 后来者读不出语义。建议命名常量。

**9. `isFontAvailable` 只判"缓存文件存在"，不校验完整性**

- 事实：`:182-183` 拿 `getCachedFontPath(...) !== null` 即判可用。
- 风险：下载中断留下残缺文件时，UI 会显示「可用」，而实际注册失败只走 `console.warn`（`readCache` 的 fallback 链全败后返回 false）⇒ **UI 说可用、字体实际没生效**的静默类缺口。低概率（下载走 Rust 落盘），但属"静默"性质，值得在册。

---

## 三、未发现

- ❌ 未发现本轮引入的全局污染：改的是 CSS 变量归属，无新增全局选择器。
- ❌ 未发现性能退化：零新增 listener / 定时器 / IPC；`--font-ui` 是静态声明。
- ❌ 未发现新僵尸代码或重复实现（三处 `--font-*` 变量均有真实消费者：`--font-ui` → body + 3 处占位；`--font-text` → `.tiptap-editor`；`--font-mono` → 17 处代码类）。
- ✅ 已核对「编辑区内无其它漏网的界面文字」：H1–H6 角标已是 `--font-mono`；代码块无文字标签；`p.is-empty` 类只调高度不含文字。

---

## 四、建议处置顺序（待拍板）

| 优先级 | 事项 | 规模 | 备注 |
|---|---|---|---|
| 1 | P1-1 导出端 mono 栈对齐 `--font-mono` | 1 行 | 动剪贴板路径，需跑剪贴板锁 + 反向校准 |
| 2 | P2-2 抽 `useFontStatus()` composable | ~60 行 | 顺手补齐竞态防护与失败态 |
| 3 | P2-3 删 `SYSTEM_FONTS`，改由 `fileName` 推导 | ~5 行 | 与自家注释对齐 |
| 4 | P2-4 / P2-5 / P3-6~9 | — | 记录在册，碰到再修；不建议现在集中动 |

> 以上已同步登记 `docs/KNOWN-ISSUES.md` §二（#67–#69），避免只活在报告里。

---

## 五、处置结果（2026-10-17 晚，已执行）

> 来源：用户令「执行，将你发现的 bug 顺手清掉」。顺序按 §四（67 → 68 → 69），P3 微观项同批顺手清完。

| # | 项 | 处置 | 落点 |
|---|---|---|---|
| 67 | 导出端 mono 硬编码 | ✅ 已修：改走 `resolveMonoFontStack()`（运行时读 `--font-mono` 真理源，读不到回落 `MONO_FALLBACK_STACK`）；锁＝font-scope（常量⟷CSS 逐字一致 + 归一源内禁字体栈字面量）＋ 外部化 `1-C+`（math / mermaid 两类块都验） | `src/utils/fontStack.ts` · `src/components/Editor/tiptap/externalize-html.ts` |
| 68 | 字体状态两处重复 | ✅ 已修：抽 `useFontStatus()` 两处共用；设置页补竞态防护 + 「下载失败」显示 | `src/composables/useFontStatus.ts` · `FontPopover.vue` · `SettingsFontSelect.vue` |
| 69 | `SYSTEM_FONTS` + `Inter` 僵尸 | ✅ 已修：删 Set（统一由 `REMOTE_FONTS` 缺项推导，行为等价）；默认栈删 `'Inter'`（grep 复验零残留） | `src/services/fontLoader.ts` · `src/assets/styles/main.css` |
| 7 | `600ms` 硬编码 | ✅ 顺手修：抽为 `SETTLE_HOLD_MS` | `FontPopover.vue` |
| 8 | 进度哨兵 `-1` | ✅ 顺手修：命名 `PROGRESS_DONE` + 类型注释写明契约（「≥0 下载中 / 其余落定」） | `src/services/fontLoader.ts` |
| 6 | 系统字体也 crossfade | ⏸ **复核后维持现状（判为设计取舍，非缺陷）**：crossfade 的语义是「切换时的重绘平滑」——`--font-text` 变量变化本身就会重绘，系统字体切换同样受益；只给它跳过反而造成「有的切换有平滑、有的没有」的不一致 | `useEditorAppearance.ts` 不动 |
| 9 | 缓存完整性 | ⏸ **复核后关闭（已有防线）**：Rust 下载 / 保存两路都过 `validate_font_bytes`（拒绝截断入缓存），落盘走 `tmp → rename` 原子替换；万一缓存事后损坏，`readCache` 失败会让 `ensureFontLoaded` 自动重下（自愈）⇒ 前端逐字节校验不值当 | `src-tauri/src/commands/font.rs`（佐证，无需改动） |
| P2-5 / §一·a | 字号行高双写 / fallback 段重复 | ⏸ 维持现状（前者无 bug、改它＝重排两条注入路径；后者等真要加字体时再抽）——均在册 | — |

**验证读数（2026-10-17 晚）**

- 专项：25 例全绿（font-scope 6 / fontStack 2 / useFontStatus 5 / externalize-html 12）
- 反向校准：撤 #67 修复 → 对应 2 条锁转红；撤 #68 `disposed` 防护 → 2 条锁转红；均还原复绿（非假绿）
- 全量：**1876 通过 / 0 失败**（1 skip＝保真体检；已显式补跑：19 份 md、0 渲染变化、0 二轮不收敛）
- 类型：`vue-tsc --noEmit` exit 0
- 回滚锚点：`git tag backup/20261017-0720-pre-fontcleanup`（指向动手前未提交工作树的 stash 提交，可 `git checkout <tag> -- <文件>` 取回）

**台账同步**：`docs/KNOWN-ISSUES.md` §二 #67–#69 已标 `[已修复 2026-10-17]` 并附证据；`CHANGELOG.md` Unreleased 补两条 Fixed。
