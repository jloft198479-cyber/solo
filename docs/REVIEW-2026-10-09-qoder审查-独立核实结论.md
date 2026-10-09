---
title: qoder 第三方审查 · 独立核实结论（只核不修）
type: review
audience: agent
status: active
tags: [审查报告, 复查, 核实, 勘误, 落点映射]
summary: 对《第三方全面审查·问题总账》逐条独立取证：基线/三闸门核对、P1-P3 抽样与全量复核、勘误表与正面清单抽验，并记录报告自身的 4 处计数/行号偏差；文末附决策记录
updates: [docs/REVIEW-2026-10-09-第三方全面审查-问题总账.md]
---

# qoder 第三方审查 · 独立核实结论

> **性质**：**只核不修**。对 [问题总账](./REVIEW-2026-10-09-第三方全面审查-问题总账.md) 逐条独立取证（重跑 grep / 读实现原文 / 数实例），**未改动任何代码或既有文档**（本文为新增）。
> **核实时间**：2026-10-09 · 基准同一（`master @ 53fc08d`）。
> **一句话结论**：**报告质量高、可采信**。抽样未发现「假阳性」（没有一条被验证为不成立）；发现 **3 处报告自身偏差**（计数/行号，均为记账瑕疵，不影响结论）。

## 1. 基线核对（4/4 准确）

| 报告声称 | 实测 | 判定 |
|---|---|---|
| `master @ 53fc08d` | HEAD = `53fc08d` | ✅ 准确 |
| `v1.2.58` 三处同步 | `package.json` / `Cargo.toml` / `tauri.conf.json` 均为 `1.2.58` | ✅ 准确 |
| tag `v1.2.58` 已存在 | `git tag` 命中 | ✅ 准确 |
| 三闸门：`51 文件 / 1547 测试` | `npx vitest run` → **51 passed / 1547 passed** | ✅ 准确 |

> 小注：`git describe` 为 `v1.2.58-11-g53fc08d`，即 HEAD 比 tag 超前 11 个 commit；报告写「master @ 53fc08d · v1.2.58」略含糊但可接受。

## 2. P1（7/7 静态成立，其中 2 条报告已自标待实测）

| ID | 判定 | 取证要点 |
|---|---|---|
| M-01 编码 | ✅ 成立 | `document.rs:54` `fs::read_to_string`（严格 UTF-8）；`:20` 白名单含 `.txt`；全仓 `BOM\|ufeff\|from_utf8\|encoding_rs` **零命中** |
| M-02 注册表 | ✅ 成立 | `desktop.rs:212` `delete_subkey_all(.md)` 整键递归删、无所有权判断；`:211-219` 全 `let _ =` 吞错；`:221` 无条件 `Ok(())`；注销侧无 `notify_shell_change`（注册侧 `:188` 有） |
| M-03 Ctrl+S 无门 | ✅ 成立 | `saveCurrentDocument`（`useDocumentSession.ts:217-273`）全程无 `isDirty`；`App.vue` 命令路径 `handleSave`（`:205`）无门，而按钮（`:407`）与自动保存（`:467`）**有门** |
| M-04 复制为HTML | ✅ 成立 | `markdown-to-html.ts` 仅 `.use()` 6 个官方插件（task-lists/mark/sub/sup/texmath/footnote），**无** callout/wikilink/mermaid/frontmatter |
| M-05 文档误导 | ✅ 成立 | `TROUBLESHOOTING.md:71-72`「2s 自动保存」vs `settings.ts:50` `autoSave:false` |
| M-06 Ctrl+H | ⚠️ 静态成立·待实测 | `menu.rs:61` 硬编码 `CmdOrCtrl+H`；`:172` 吞 `app.hide` 事件；`update_shortcuts_in_items` 只 `set` 不清 ⇒ 死项加速键永留 |
| M-07 Word 粘贴 | ⚠️ 静态成立·待实测 | `stripMsoMarkup` 唯一调用链 = `parseHtmlSlice`（`:422`）→ 仅 Layer 4「无 text/html」分支（`:521`）；全仓 `transformPastedHTML` **零命中**；函数确不删段首 `•`/`1.` |

## 3. P2（19 条：18 静态成立 / 1 待实测 / 1 计数偏差）

| ID | 判定 | 取证要点 |
|---|---|---|
| M-11 折叠入口 | ✅ | `list-fold.ts` chevron `click`（`:161-174`）；`editor.css:456` `opacity:0` |
| M-12 菜单兜底键位 | ✅ | `menu.rs:32/33/36` `CmdOrCtrl+G`/`Shift+G`/`Shift+F` vs `registry.ts:377/387/421` `Mod-f`/`Mod-h`/`F11` |
| M-13 无一致性测试 | ✅（措辞准） | `registry.spec.ts`（8 例）**确**测菜单**派生**（`getMenuShortcuts`），但**不比对 `menu.rs`** Rust 兜底值；`useMenuShortcutsSync.spec.ts`（2 例）只测「调了 IPC」 |
| M-14 IME 临时开关 | ✅ | `ime-anchor.ts:55-61` 自陈「验证完成后必须删除」；`:66-72/171` 读 `localStorage['solo:imeAnchorGuard']` **无 DEV 门控**；`ime-anchor-probe.ts:2` 自陈待删 |
| M-15 假订阅 | ✅ | `subscribeTauriGeometry` 全仓仅在 `ime-anchor.ts`（`:84` 定义 / `:232` 使用）；**spec 零命中** |
| M-16 图片绕过 SSRF | ✅ | `image.ts:203-208` `.catch(() => … return src)`；`:366` 赋 `image.src`；CSP `img-src … http:` |
| M-17 重定向不复核 | ✅ | `image.rs:78-93` `Client::builder()` 无 redirect 设置；全仓 `redirect\|Policy` **零命中** |
| M-18 冲突检查薄弱 | ✅（**行号错**） | 无锁 TOCTOU `:125-148`；`as_millis()` 毫秒精度；另存为/改名 `useDocumentSession.ts:291/332` 均 `force=true, expected=null`。⚠️ 报告引的 `document.rs:814-821` **实为 `validate_image_asset_path`/`read_modified_time_ms`，非冲突代码** |
| M-19 崩溃恢复原料 | ✅ | `atomic_write` `:711-746` `create→write_all→sync_all→rename`；清理仅删 >1h 静默（`:750-789`）；`temp_path` 前缀 `.`（Windows 非隐藏） |
| M-20 mermaid loose | ⚠️ 待实测 | `mermaid-block.ts:193` `securityLevel:'loose'` + `:490-494` 自动渲染；CSP `style-src 'unsafe-inline'` + `dangerousDisableAssetCspModification:["style-src"]` |
| M-21 图片扩权 | ✅ | `:791` `canonicalize()` 防软链；`:626-628` 绝对路径**显式放行**（仅相对路径做 containment）；`:643` `allow_file` 只增不减 |
| M-22 三处静默 | ✅ | `clipboard.rs:22-27` 无 HTML 与出错合并同一 `Ok(None)`；`StatusbarQuickActions.vue:45-47` `catch{}` 静默；`document.rs:397-399` 写失败 `continue` 不计数 |
| M-23 结构语义丢失 | ✅ | `footnote.ts` `parseHTML` 仅 `sup[data-footnote-ref]` ⇒ 别处 `<sup id>` 退化；`handleClipboardImagePaste` 文字仅 `insertText`（`:587-590`） |
| M-24 折叠×换位 | ✅（qoder 探针落锤） | `mapFolded`（`list-fold.ts:213-221`）只留 `!mapped.deleted`；`list-move.ts:83-86` |
| M-25 保真网盲区 | ✅ | `serializerMarkCases`（`mark-delimiter-coverage.spec.ts:32-41`）正则**只抽 `case` 名**、不读返回值；fixtures 目录无 `mk-dim`；`roundtrip.spec.ts:309-315` 用 `toContain` 弱断言 |
| M-26 隐式全局态 | ✅ | `foldedByPath` 模块级 Map（`list-fold.ts:45`）；`clearFoldedMemory` 自陈「生产代码不需要调用」；`document-scale` 消费者实测 **7** 个 |
| M-27 O(n²) 无防线 | ✅ | `git show 8e369af` 仅改 serializer；全 spec `perf\|benchmark` **零命中** |
| M-28 幽灵依赖 | ✅（**计数错**） | `lib.rs:9 use commands::*` 无关；前端 import 的未声明 `@tiptap/*` 子包实测 **8 个**（core / bold / bullet-list / code / heading / italic / ordered-list / strike）。⚠️ 报告写「**7 个**」却自己列了 8 个名字 |
| M-29 mac 臂编译失败 | ✅（静态） | `window.rs:173`(mac)/`:188`(非mac) 双定义；`commands/mod.rs:16-18` re-export **不含** `apply_macos_window_background`；`lib.rs:102` 限定路径可编 vs `:340` 裸名调用（`use commands::*` 解析不到）⇒ E0425；CI（`test.yml:11` / `release.yml:13-16`）**仅 windows-latest + x86_64-pc-windows-msvc** |

## 4. P3（抽样 12 条，全部成立）

| ID | 判定 | 取证要点 |
|---|---|---|
| M-31 | ✅ | `menu.rs:61-67` 三个 mac 死项无 `#[cfg]` |
| M-32 | ✅ | `App.vue:405`「(Ctrl+S)」、`:419`「(Ctrl+,)」、`OutlinePanel.vue:157`「(Ctrl+/)」硬编码 |
| M-33 | ✅ | `useAppDomEvents.ts:75` `Escape` 未登记 registry |
| M-34 | ✅ | `registry.ts` 全文 0 处 `editor.link`/`editor.clearFormat` |
| M-35 | ✅ | `StatusbarQuickActions.vue:31` 取**整篇** `getContent()` 双槽复制 vs `registry.ts:392-404` 文案「**选区**以 Markdown 源码」 |
| M-36 | ✅ | `registry.ts:562` `parts[last].toUpperCase()` ⇒ `Alt-ArrowUp`→`Alt+ARROWUP` |
| M-37 | ✅ | `restoreScroll` 命中 `ime-anchor.ts:143/202`（`FEATURE-MATRIX:252` 判据已失真） |
| M-38 | ✅ | `cjk-boundary.md:42`「829」/`:177`「978（27 文件）」、`CHANGELOG.md:39`「1510」—— 均陈旧 |
| M-39 | ✅（**计数错**） | 实测 **6 处** `var(--token, #死兜底)`：`editor.css:552/673/794/1050` + `BubbleMenu.vue:333` + `assets/styles/main.css:42`。⚠️ 报告写「**5 处**」却列了 6 个路径 |
| M-40 | ✅（抽查） | `src/components/Editor/themes/` **不存在**（死链①成立） |
| M-41 | ✅ | DOC-STANDARD 枚举 `core\|guide\|principle\|proposal\|archive\|product` **不含** `brief`/`record`；`IME-问题简报` 在 `INDEX.md` 零登记；`IME-ANCHOR-GUARD-2026-10-09.md` 存在 |
| M-42/M-43/M-44 | ✅ | `CHANGELOG` 顶部序 `[1.2.58]:23 → [1.2.57]:41 → [Unreleased]:68`；`vitest.config.ts:11-38` 有 50/50/40/50 而 CI **无 `--coverage`**；`lib.rs:66` label=`editor-N` vs `:272` 判 `main-*`（永不命中） |

## 5. §2 勘误表（抽核 5/8，均成立）

| # | 判定 | 取证 |
|---|---|---|
| E-1 | ✅ | `CHANGELOG.md:25-29` 确登记折叠；`FEATURE-MATRIX` 无列表折叠条目。⚠️ 引用 `:253` 实为「**标题**折叠」行，非列表折叠，引用略偏 |
| E-3 | ✅ | `ThemeState` 仅在 `themes/types.ts:183` 定义处出现，**零引用** = 真死码 1 处 |
| E-4 | ✅ | `.archive-档案室/docs/ARCHITECTURE.md` **存在** ⇒ `AGENTS.md:37` 非死链 |
| E-5 | ✅ | 8 个 preset：文件名无 `-light`、JSON `id` 有（如 `cinnabar.json → cinnabar-light`） |
| E-7 | ✅ | `markdown-to-html.ts:1-13` 头注释 + `PRIVATE_TAG_RE` 证实 `dim` **有意剥壳** |
| E-2 / E-6 / E-8 | — | 依赖探针/实测，本次未独立复现（E-8 由 qoder 探针落锤） |

## 6. §6 正面清单（抽核硬禁令，全部准确）

`String.replaceAll(` **0**（2 处命中是自定义事件名 `replaceAll`，非方法调用）｜前端直接 `invoke('` **0** ｜命令名 `command-names.ts` **26** 键 ｜Rust 非测试 `unwrap` **0**（`document.rs` 全部 unwrap 在 `:861` 起的 `#[cfg(test)]` 模块内）。

## 7. 报告自身的偏差（记账瑕疵，不影响结论）

1. **M-28 计数**：写「7 个幽灵依赖」，实为 **8 个**（报告自己列了 8 个名字）。
2. **M-39 计数**：写「5 处」，实为 **6 处**（报告自己列了 6 个路径）。
3. **M-18 行号**：引 `document.rs:814-821` 作冲突检查代码，**该区间实为 `validate_image_asset_path`/`read_modified_time_ms`**；冲突代码在 `:125-148`（已正确引用）。
4. **命令计数**（补录）：报告在 3 处写「registry.ts 全文 **43 条**命令」，实测 **45 条**（逐条列出 45 个 id 核对）。不影响其「命令全部可达」的结论。

## 8. 未独立复现的项（需真机 / release / mac 环境）

- **待实测 4 条**：M-06（Ctrl+H）、M-07（Word 粘贴真实形态）、M-20（prod CSP 下 mermaid）、M-01/M-04 的**文案/渲染产物证据**。→ **用户 2026-10-09 决定：不做专项验证**（苹果环境测不了；未亲历的现象不专程去测，浪费时间且不一定复现）。
- **M-29**：本机无 `aarch64-apple-darwin` 目标，未跑 `cargo check --target`，但静态链条完整。→ **用户明确「不做 mac 考虑」，不处理。**
- **三闸门**：核实阶段只跑了 `vitest`（51 文件 / 1547 实例）；**修复阶段已补跑** `vue-tsc`（0 错）与 `vite build`（通过），并跑 `cargo check`（Finished，本机需 cmd+vcvars64，走 bat）。

## 9. 总体判断

1. **可采信**：P1-P3 抽样与全量取证中，**无一条被验证为「不成立」**；报告 §2 的自我勘误（推翻了批 1/批 2 的多个结论）经抽核也站得住。
2. **§9 综合判断成立**：P1 七条里六条确为「边界与账目」类（编码 / 注册表 / 写盘门控 / 导出通道失真 / 文档骗人 / 键位抢占），代码本身质量硬（三闸门全绿、真死码 1 处）。
3. **已落账**：核实后按「代码优先、文档顺手」修复 **22 项**，见 [`CHANGELOG`](./CHANGELOG.md) `[Unreleased]`。

## 10. 决策记录（2026-10-09，简乐拍板）

| 项 | 决定 | 大白话理由 |
|---|---|---|
| M-01 / M-02 / M-03 / M-04 / M-05 / M-06 / M-07 / M-12 / M-14 / M-16 / M-22 / M-26 / M-31 / M-32 / M-35 / M-36 / M-38 / M-39 / M-40 / M-41 / M-42 / M-43 / M-45 | **已修** | 都属于「能安全修、不影响别处」 |
| M-24 折叠 × 换位 | **不改** | 挪完正好看清挪了啥；修它要在两个功能间立契约，风险大于收益（此前也定过「先不管」） |
| M-29 mac 编译失败 | **不处理** | 用户不用苹果电脑、无法测试；只要不影响 Windows 即可 |
| M-33 Esc / `Mod+Backspace` 未登记 | **不登记** | Esc 是「多层级联关闭」（提示→全屏→图片→焦点模式），不是普通快捷键，塞进总表容易搞乱；退格删块同理 |
| M-34 插入链接（`editor.link`） | **不登记** | 它必须先让用户输入网址，而应用内没有输入框类对话框，光靠命令面板完成不了 |
| M-34 取消链接 / 清除格式 | **已登记** | 无需输入、可直接执行 ⇒ 收进 registry，命令面板可搜到、可点 |
| M-44 覆盖率检查未生效 | **暂不动** | 对用户零影响；补上要装一个新的开发工具包 ⇒ 按纪律需先获同意 |
| M-28 幽灵依赖（8 个）+ `clipboard-manager` 死依赖 | **暂不动** | 本机已装、打包后与最终用户无关；改动依赖清单需先获同意 |
| 真机 / release / mac 专项验证 | **不做** | 见 §8 |

## 11. 报告缺陷汇总

报告质量高、结论可采信；唯一系统性瑕疵是**计数与行号**（共 4 处，见 §7）。另：其 §8「落点映射」把本文（核实结论）也纳入了登记范围，实际由本次修复直接落进 `CHANGELOG` + 各权威文档。

## 12. 真机核查结论（2026-10-09 用户实测反馈 + 代码复核）

> 用户实测 4 项后反馈，逐条核查如下。**纪律提醒**：用户观察是第一现场，代码推断只是假说——本节的 1 与 4 就是按这条办的。

| # | 用户反馈 | 核查结论 |
|---|---|---|
| 1 | 菜单里**从来（以往和现在）都没有**「隐藏 solo / 隐藏其他」 | ⚠️ **成立，但与改动不矛盾**。窗口是**无边框**（`tauri.conf.json` `decorations:false`）⇒ Windows 上原生菜单栏**本就不可见**；而 `menu.rs::setup_menu` 仍会**无条件创建**这些项（`app.set_menu`）。故「看不到」≠「没被创建」，两者可以同时成立。本改动把它们从创建源头去掉，**两种情况下都不会变坏**。但必须更正口径：**「它的 `CmdOrCtrl+H` 真抢过 Ctrl+H」属静态推断、未实测**——已在 CHANGELOG 改为推断措辞。旁证：项目自己的 `docs/debugging.md` 把「原生菜单加速器(Tauri)」列为**真实拦截层**，故不能凭「看不见」断定其加速键不存在。**未实测的部分只能这样结案**（无 GUI 观测通道）。 |
| 2 | Ctrl+H 查找替换 = **正常** | ✅ **通过**。与 registry 的 `Mod-h` 一致（`menu.rs` 兜底也已同步、并有 `menu-consistency.spec.ts` 防漂移）。 |
| 3 | Ctrl+S = **未发现异常**（用户平时用状态栏「未保存」入口） | ✅ **代码复核通过**。门控只在「有路径 + 非改名 + `!force && !isDirty`」时早退；`path` 为空仍走「另存为」、改名待保存仍走 `saveRenamedDocument`、冲突重试（`force=true`）不受影响；自动保存/按钮行为**完全不变**。**新增 2 条回归锁**：clean 不写盘 / dirty 必写盘（`useDocumentSession.spec.ts` 23→25 例）。 |
| 4 | 网络图片**无法实测**（测试环境） | ✅ 代码复核 + **修掉一处体验倒退**。原方案用透明占位图，但占位图是 data URL、会**立刻 complete** ⇒ 骨架屏被白白丢掉（违反「改动不可降低体验」）。已改为**取回前不给 `<img>` 设 `src`**：骨架屏保留（CSS `min-height:80px` 保证可见）、原始 URL 绝不落到 `<img>`、失败时落到占位图并由 load 事件收起骨架。单测（图片 14 例 + NodeView 销毁 6 例）全绿。**真机观感仍是唯一未验项**（本机无法起 GUI）。 |

## 13. 第二轮审查（提交前自查，2026-10-09）

> 按 `easy-code-review` 四查（需求符合性 / 非必要修改 / 代码质量 / 变更影响）+ 用户指定的三重点（过度修复 / 回退与冗余僵尸 / 是否真提升体验）。**未实测项不追究**。

### 13.1 本轮新发现并已修（3 处）

| # | 问题 | 性质 | 处置 |
|---|---|---|---|
| 1 | **复制失败的「提示」只改了 tooltip，按钮外观不变** | 修不完整（M-22 的原始抱怨正是「按钮不变样」） | 加 `.is-failed` 视觉态（`color: var(--error-color)`）并绑定 class ⇒ 不悬停也看得见 |
| 2 | **`editor.unlink` / `editor.clearFormat` 的实现被写了两遍**（浮动菜单一处、命令分发一处） | 冗余（语义漂移隐患：改一处漏一处） | 命令分发改为**复用** `runBubbleMenuAction` 的唯一定义，净减代码 |
| 3 | **Rust 的 `.tmp` 命名测试仍断言旧格式**（生产已改「毫秒.pid」两段，测试只覆盖一段） | **测试/生产漂移 ⇒ 假绿**：就算新格式永远清不掉，测试也照样绿 | 用例改用新格式 + 新增「旧格式（无 pid）仍应清理」与「含非数字段应保留」两条；**实跑 `cargo test` 84/84 通过** |

> 第 3 条附带收获：新断言第一版把前缀写成 `.demo.`（实际文件名含扩展名，应为 `.demo.md.`）⇒ **当场转红**，证明这套测试不是摆设，也证明「只看 `cargo check` 不够、必须真跑 `cargo test`」。

### 13.2 过度修复评估（逐项取舍）

| 项 | 是否过度 | 结论 |
|---|---|---|
| M-01 **UTF-16 解码**（超出「给一句可读文案」的最小要求） | 略超 | **保留**。只对带 BOM 的文件生效、零副作用，且「记事本另存为 Unicode」恰是 UTF-16，实用。**代价需登记**：UTF-8 BOM 文件保存后 BOM 会消失（改前 BOM 会作为首字符进入正文并被写回）。两者相权：正文里混入零宽字符更糟 ⇒ 去 BOM 正确 |
| M-02 **Rust 改为如实返回 Err** | 不是 | Rust 侧修对了（不再假装成功）；但 `App.vue` 只 `console.warn`，**用户可见面没变**。**取舍：不改成弹窗**——该 watcher 也会在「设置加载后置为 true」时触发注册，弹窗会变成启动期骚扰；注册/注销失败极罕见，日志足够 |
| M-04 **剥 frontmatter** | 不是（克制的部分修复） | 另 3 种（callout / wikilink / mermaid）需合并两条 markdown-it 管线，成本与风险都高 ⇒ 不做。**已知代价**：`utils/markdown-to-html.ts` 反向 import `components/.../plugins/frontmatter.ts`（跨层）。**取舍：保留**——替代方案是复制正则，违反「真理源一处」；且该模块是纯 `import type`、零运行时依赖，实际代价为零 |
| M-39 **去掉 6 处 CSS 兜底值** | 不是 | **已核验不会失效**：这些变量在 `main.css` 的浅色/深色两套里都定义；且 `themes/manager.ts::injectColors` 只 `setProperty`、**从不删除**变量 ⇒ 即使用户自定义主题缺某个颜色，变量仍是样式表里的值，`var(--x)` 照常有值 |
| M-32 / M-36 / M-26 / M-14 / M-45 | 不是 | 均为必要且最小改动（`M-45` 加 PID 时同步放宽清理判据属**必要连带**） |

### 13.3 回退 / 冗余 / 僵尸 / 衍生 bug

- **修复回退：无**。逐条核对本轮全部删除行（25 个源文件、97 行删除），**全部是本次有意替换的内容**，没有误删任何既有防护（幂等短路、冲突检查、组字守卫、单例互斥等均在位）。
- **优化回退：无**。未触碰任何性能路径：序列化 `chunks` 方案、按块高亮、`content-visibility`、防抖分层、IME 冻结全在；新增的都是 O(1) 判断（`Map.has`、对象查表）或 computed（有缓存）。
- **冗余**：第 2 条已消除；其余新增注释均为「为什么这么做」的必要说明（无复述代码的废话注释）。
- **僵尸代码**：无。逐个反查新增标识符均被引用——`REMOTE_IMAGE_PLACEHOLDER`（生产 2 处 + 测试）、`shortcutHint`（2 个组件）、`FRONTMATTER_RE`（解析侧 + 导出侧）、`DISPLAY_KEY_ALIASES`、`FOLDED_MEMORY_LIMIT`、`read_text_file`、`IsMenuItem`。删除的 `ThemeState` 已确认零引用。
- **衍生 bug：1 处已修**（骨架屏丢失，见 §12 #4）；**2 处保留的取舍**：① 前端不弹窗（见 13.2）；② 就地改远程图片地址时会短暂显示上一张图，直到新图取回（Rust 有磁盘缓存，实测感知极小）。

### 13.4 是否真提升体验（不是表面修补）

- **正面**：能打开 UTF-16 文件并给出可读失败原因；关开关不再连累系统关联；Ctrl+S 不再偷改文件；Word 粘贴多一道清理；复制不再吐明文 frontmatter；远程图片不再绕过安全检查。
- **代价已登记**：BOM 保存后消失、跨层 import、前端不弹窗、换图瞬间显示旧图 —— **四项均为「已知且可接受」，无一项是用户可见的功能退化**。
- **闸门（本轮全跑，不只跑 check）**：`eslint` **0 error**（125 warning 全为既有、逐行确认不在本次改动行上）｜`vitest` **53 文件 / 1554**｜`vue-tsc` **0 错**｜`vite build` ✓｜`cargo test` **84/84**。
