---
title: 已知问题与技术债
type: core
audience: agent
status: active
tags: [核心文档, 待办, 已知坑]
summary: 待办/已知问题真理源：§一 已修复、§二 待办
updates: [AGENTS.md, ARCHITECTURE.md, src/, src-tauri/src, docs/RELEASE_PROCESS.md]
---

# docs/KNOWN-ISSUES.md — 已知问题与技术债

> 接手者 / agent 排查问题时先查本表：能区分「这是已知坑」还是「新 bug」。
> 状态图例：`[已修复]` 供溯源 ｜ `[部分缓解]` ｜ `[未解决]` 待办 ｜ `[文档坑]` 文档类陷阱 ｜ `[设计取舍]` 非 bug

## 一、已修复（保留供溯源，勿误当现状）

| # | 现象 | 根因 | 修复 | 文件 |
|---|---|---|---|---|
| 1 | mermaid 图表全黑 | `securityLevel:'strict'` 使 DOMPurify 删掉主题 `<style>` | 改 `'loose'`（本地优先单文件，风险可忽略） | [`src/components/Editor/tiptap/extensions/mermaid-block.ts`](../src/components/Editor/tiptap/extensions/mermaid-block.ts) |
| 2 | 拖入 `.md` 不打开新窗口 | [`src/services/tauri/events.ts`](../src/services/tauri/events.ts) 的 `activeDragDropHandler` 单值变量，后注册覆盖前者 | 改为 `Set<DragDropHandler>` 广播分发 | [`src/services/tauri/events.ts`](../src/services/tauri/events.ts) |
| 3 | 图片拖入调用点 5 行 if/else | 路径模式判别 + authorize 分散 | 新增 `resolve_image_display` 单命令合并 | [`src-tauri/src/commands/document.rs`](../src-tauri/src/commands/document.rs) |
| 4 | IME 候选栏变箭头 | `editor.css` 的 `ime-mode: active`（IE 遗留，WebView2 上致候选窗变形） | 删除该属性 | [`src/components/Editor/tiptap/editor.css`](../src/components/Editor/tiptap/editor.css) |
| 5 | 文档干净度矛盾（导出功能/测试数） | 多份文档与代码脱节 | 2026-07-20 文档对账，导出功能按代码为准对齐 | [`README.md`](../README.md)×4 / [`ARCHITECTURE.md`](../ARCHITECTURE.md) / [`.opencode/PROFILE.md`](../.opencode/PROFILE.md) / [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) |
| 6 | 字体缓存文档脱节（IndexedDB vs 文件系统） | [`ARCHITECTURE.md`](../ARCHITECTURE.md) 原写 IndexedDB，[`.opencode/PROFILE.md`](../.opencode/PROFILE.md) 说 v1.2.10 后改文件系统，两说打架 | 2026-07-21 文档规范化：以 `fontLoader.ts` 实际机制（文件系统缓存）为准，ARCHITECTURE 改文件系统、PROFILE 删除重复段改指针 | [`ARCHITECTURE.md`](../ARCHITECTURE.md):489/574 / [`.opencode/PROFILE.md`](../.opencode/PROFILE.md) |
| 7 | 字体不显示（下载完成却显示不出来） | 渲染层用 `asset://` 的 `@font-face` 被 CORS **静默拦截**（不报错）；叠加「霞鹜文楷」文件名标 Regular 但内部是 Lite 轻便版、与代码 `value` 不符的资源错配 | 渲染改走字节通道（`readFontBytes` IPC 取字节 → `new FontFace(family, bytes)` 同源加载）；霞鹜对齐为 Lite 真名（`value='LXGW WenKai Lite'`） | [`src/services/fontLoader.ts`](../src/services/fontLoader.ts) + [字体手册](./font-handling.md) |
| 8 | 打开含 Mermaid 的文档，未作修改却显示「未保存」 | 旧 `onUpdate` 无条件调 `markUserEdit()`；含 Mermaid 文档因异步 NodeView 渲染时机叠加，产生非 `preventUpdate` transaction → 误标脏 | A1 重构：脏态改由 `useEditorSync` → `syncEditedContent()` 按「内容是否变化」判定（2026-08-14），不再依赖交互门控 / `markUserEdit` | [`src/components/Editor/MarkdownEditor.vue`](../src/components/Editor/MarkdownEditor.vue):189 / [`ARCHITECTURE.md`](../ARCHITECTURE.md) §7.1 |
| 9 | 恶意文档可诱导越权读写文件 / 向内网发请求（代码审查发现，未见用户报障） | `open_document` / `save_document` / `import_document_image` / `fetch_remote_image` 直接采信前端传入的路径与 URL，无扩展名约束、无协议与主机限制 | 读/写各加扩展名白名单；import 的 source 改走 `validate_image_asset_path`（canonicalize + is_file + 图片扩展名）；新增 `validate_remote_image_url`（限 http/https + 拦截字面量内网主机）与 `validate_font_url`（限 https）。**残留风险见 §二 #5** | [`src-tauri/src/commands/document.rs`](../src-tauri/src/commands/document.rs) / [`image.rs`](../src-tauri/src/commands/image.rs) / [`font.rs`](../src-tauri/src/commands/font.rs) |
| 10 | 代码块 / 图片 NodeView 事件监听器泄漏 | `code-block.ts` / `image.ts` 加了监听器却没有 `destroy()`，节点销毁后监听器与闭包仍存活；异步 src 解析还会在销毁后回写 `image.src` | 沿用仓库既有 `AbortController` 套路（对齐 `math-block.ts` / `mermaid-block.ts`）：监听器带 `signal`，`destroy()` 里 `abort()`；异步回调额外查 `signal.aborted`——`requestId` 活在同一个已死闭包里会自匹配，单靠它挡不住 | [`src/components/Editor/tiptap/extensions/code-block.ts`](../src/components/Editor/tiptap/extensions/code-block.ts) / [`image.ts`](../src/components/Editor/tiptap/extensions/image.ts) |
| 11 | 复制引用块 / 表格内容粘到外部编辑器，多出 `\=` `\$` 等反斜杠 | `blockquote` 与表格单元格各自新建内层序列化 state 时用了默认构造（文件落盘的严格转义模式），把外层 clipboard 轻量转义标记丢掉 | 两处改 `state.createChild()` 继承模式（`callout.ts` 早已这么写，这两处漏改）。`cellToText` 需拿到父 state，列宽统计与输出两个调用点必须同步改，否则 `padEnd` 宽度与实际字符串不一致、表格错位 | [`src/components/Editor/tiptap/markdown/serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts) |
| 12 | 图片保存后重开丢失（文件名含空格 / 中文路径） | serializer 把 src/href 原样写入，CommonMark 不允许 `(...)` 内未转义空格 → 含空格 src 重开解析失败退化成字面文本；markdown-it `normalizeLink` 对中文路径百分号编码、parser 未解码 → 每次保存静默改写 + 零编辑误标脏 | serializer 加 `escapeLinkDestination`（平衡括号保留反斜杠转义，含空白/尖括号用 `<...>` 包裹）；parser 加 `decodeLinkDestination`（仅解非 ASCII 编码与 `%20`）；Rust 粘贴命名 `Pasted image {}`→`pasted-image-{}` 消灭空格源头 | [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts) / [`parser.ts`](../src/components/Editor/tiptap/markdown/parser.ts) / [`document.rs`](../src-tauri/src/commands/document.rs) |
| 13 | 保存失败 / 冲突取消后脏标被洗白，未保存编辑静默丢失 | `persistDocument` 保存**发起前**就回写 store 基线，失败/取消后基线已污染，`syncEditedContent` 语义比对因「内容未变」把 `isDirty` 洗成 false | 基线只在保存**成功后**同步：`persistDocument` 返回 `{ result, content }`，`markSaved(mtime, content)` / `setFile(content,...)` 在成功分支落地；失败/取消基线不动 | [`useDocumentSession.ts`](../src/composables/useDocumentSession.ts) / [`file.ts`](../src/stores/file.ts) |
| 14 | 同路径外部修改重载不刷新编辑器，用户一保存反向覆盖外部改动 | 编辑器 watch 只监 `path`，同路径重载（path 不变、content 变）不触发文档替换；旧 doc 延迟序列化把旧内容写回 store 误标脏 | store 加 `reloadToken`（仅 `setFile` 递增），watch 源改 `[path, reloadToken]`；不直接 watch content（编辑期 `syncEditedContent` 也写它，会在 store 滞后时回退正在编辑的内容） | [`file.ts`](../src/stores/file.ts) / [`MarkdownEditor.vue`](../src/components/Editor/MarkdownEditor.vue) |
| 15 | 输入法候选窗失锚偶发复发（横条塌成小方块） | 三层：① 事务层——v1.2.41 只给 `markdown-input` 加组字闸门，搜索高亮 / 焦点模式 / 代码块高亮在组字期仍重建装饰改 DOM；② 渲染层——P5-02 `content-visibility:auto` 无条件作用于 `.tiptap-editor > *`，隐含 `contain:layout style paint` 干扰 WebView2/TSF 组字光标矩形（兼容性清单漏验 IME）；③ 布局层（解释「时好时坏」）——`<ErrorBoundary class=editor-area>` 双根 fragment 致 class 被 Vue 丢弃，`.editor-area` 的 `min-width:0` 不生效，编辑区宽度随内容重排、组字光标矩形抖动、稳定后自愈 | ① 组字期装饰插件统一「只平移不重建」；② 档位映射 `<html class=doc-heavy>`，content-visibility 仅大文档启用；③ App.vue 用独立 `<div class=editor-area>` 包裹 ErrorBoundary 承载布局 class | [`useEditorSearch.ts`](../src/components/Editor/tiptap/useEditorSearch.ts) / [`search-highlight.ts`](../src/components/Editor/tiptap/extensions/search-highlight.ts) / [`paragraph-focus.ts`](../src/components/Editor/tiptap/extensions/paragraph-focus.ts) / [`code-block.ts`](../src/components/Editor/tiptap/extensions/code-block.ts) / [`editor.css`](../src/components/Editor/tiptap/editor.css) / [`document-scale.ts`](../src/components/Editor/document-scale.ts) / [`App.vue`](../src/App.vue) |

## 二、未解决 / 待办（[未解决]）

| # | 现象 | 说明 | 相关文件 |
|---|---|---|---|
| 1 | 崩溃时 `.tmp` 文件未清理 | `save_document` 原子写产生 `.tmp`，崩溃路径无清理 | [`src-tauri/src/commands/document.rs`](../src-tauri/src/commands/document.rs) |
| 2 | mermaid 中文标签体验有限 | 已加错误提示 + 5 个单测，但中文/特殊字符标签仍需用户自加引号 `A["文本"]` | [`src/components/Editor/tiptap/extensions/mermaid-block.ts`](../src/components/Editor/tiptap/extensions/mermaid-block.ts) |
| 3 | 测试数曾多处不一致 | 2026-07-20 已治理（README/PROFILE/ARCHITECTURE 去硬编码），但**新增文档请勿再硬编码测试数**，统一写「以 `bun run test` 实际输出为准」 | 全局 |
| 4 | （可选）最近文件快开 | 来源：已退役的 UI/交互优化提案 P9（本项未做、非必须）。在不引入应用内 tab 模型前提下，提供「最近文件」快开——可挂在命令面板（Ctrl+K）增「最近文件」分组，数据源依赖 Rust 侧是否已有最近文件记录。保持 solo 多窗口哲学。 | 待定（Rust 侧最近文件记录可用性） |
| 5 | 远程图片 URL 校验挡不住 DNS rebinding | §一 #9 的 `validate_remote_image_url` 只判断**字面量**主机（回环/私有/链路本地/组播、`localhost`、`.local`/`.internal`、云元数据 `169.254.169.254`）。若攻击者掌握一个公网域名，让其 A 记录解析到内网 IP，请求仍会打到内网。彻底修法需要「解析后 IP 再校验 + 用该 IP 建连」，会破坏 TLS SNI 与虚拟主机，且 reqwest 需自定义 resolver；本地优先单文件编辑器 threat model 下暂不付出这个复杂度。同理 `validate_font_url` 只限 https，刻意不做主机白名单——GitHub release 会 302 跳到 `objects.githubusercontent.com`，白名单会打断下载。取舍已写入 Rust 注释 | [`src-tauri/src/commands/image.rs`](../src-tauri/src/commands/image.rs) / [`font.rs`](../src-tauri/src/commands/font.rs) |
| 6 | 表格 resizable 拖拽列宽不持久 | TipTap Table 配置了 `resizable: true`，用户可拖拽调整列宽，但 `serializer.ts` 用文本长度算列宽对齐（`colWidths` 局部变量），完全忽略 `node.attrs.colwidth`。保存后重新打开，拖过的列宽丢失。修复需 serializer 读取 `colwidth` 属性写入 GFM 表格（GFM 本身无列宽语义，可能需要 HTML `<col>` 或自定义属性），同时 parser 要能还原。当前 #9 仅补齐行列操作入口，此项留待后续 | [`src/components/Editor/tiptap/markdown/serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts):438-459 |
| 7 | 国内用户自动更新走 GitHub，慢；CNB 镜像只供手动下载（**[待用户拍板]** A 维持现状 / B 启用 CNB 自动更新） | **现状**：updater 唯一端点写死 GitHub（[`tauri.conf.json`](../src-tauri/tauri.conf.json):74），CNB 那份 `latest.json` 是 GitHub 原样副本，其 `platforms.windows-x86_64.url` **仍指 GitHub** ⇒ 仅把 CNB 加进 endpoints 不会有加速效果。**启用 B 的前置条件**（缺一不可）：① 上传前改写 `latest.json` 的 `url` 指向 CNB 下载链接（`.sig` 无需重签——签的是同一个 exe）；② 保证两侧 `version` 字段一致（同一份清单天然满足）；③ **先实测 Tauri v2 多端点 fallback 行为**（据理解是顺序尝试、取首个成功返回，但**未实测**，CNB 在前还是 GitHub 在前需据此定）。两侧 exe 字节完全一致（v1.2.41 实测 sha256 相同），故用户手动从 CNB 覆盖安装不影响后续自动更新——这是 A 方案的兜底 | [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json):74 ／ 流程见 [RELEASE_PROCESS §7.5](./RELEASE_PROCESS.md) |
| 8 | IME 候选窗失锚**残留（判定为外部缺陷，编辑器层封顶）**：偶发候选窗甩到屏幕底部 / 塌成小方块 | 真机取证 + 组字期诊断（2026-09-05）证明**应用层干净**：组字期光标矩形从未退化（`badSampleCount:0`）、DOM 仅组字文本自身 characterData、无装饰重建、无 refocus（`setupWindowFocusHandlers` 编辑器存在即 return，其余 `.focus()` 均用户主动）、非组字期矩形有效、祖先链无 transform/contain、content-visibility 已关、Console 0 警告、WebView2 运行时为新版 152.0.4191.62；合成输入 3/3 正常、真实输入偶发 → 锚点失效发生在 WebView2/TSF 可见层之下、依赖真实输入时序/焦点条件 | **止损决策**：编辑器层不再加守卫；临时诊断 `ime-diag.ts` 已完成使命并删除；§一 #15 三层修复与组字守卫保留（它们正是组字期 DOM 保持干净的原因）。缓解：发作时按 Esc 或切换焦点即恢复；根治需携证据向 WebView2/Chromium 上游反馈 | [`editor.css`](../src/components/Editor/tiptap/editor.css) / [`App.vue`](../src/App.vue) / [`paragraph-focus.ts`](../src/components/Editor/tiptap/extensions/paragraph-focus.ts) |

## 三、设计取舍（[设计取舍]，非 bug，勿"修"）

| 项 | 说明 |
|---|---|
| 导出系统 v1.2.18 删除 | 改为状态栏「复制为 HTML」（剪贴板），无独立导出/PDF/微信。PDF 实为浏览器打印（[`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) §5） |
| `html:false` / `linkify:false` | 解析器刻意不保留原始 HTML、不自动链接裸 URL，保真优先 |
| 多进程架构（v1.2.5+） | 每双击一个 `.md` 起独立进程；关最后一个窗口默认不退出，需菜单「退出」 |

## 四、文档类已知坑（[文档坑]，agent 必读）

- **`.trae/documents/`**：旧架构文档（文件树/workspace watcher/fs.rs 等），**已失效，忽略**（不要链接、不要读取）。
- **[`.opencode/PROFILE.md`](../.opencode/PROFILE.md)**：技术档案，含历史快照，可能与当前代码有延迟；以 [`ARCHITECTURE.md`](../ARCHITECTURE.md) + 代码为准。
- **[`ARCHITECTURE.md`](../ARCHITECTURE.md) 附录 C**：已固化「文档-代码差异」清单，遇到矛盾先查此表。
- 任何文档若与代码不符，**以代码为准并更新文档**。

## See also

- [bug 易发区地图（ARCHITECTURE §11）](../ARCHITECTURE.md)
- [调试指南](./debugging.md)
- [文档索引与术语表](./INDEX.md)
- [接手指南](./HANDOVER.md)
- [项目工作手册](../AGENTS.md)
- [架构权威地图](../ARCHITECTURE.md)
