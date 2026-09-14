---
title: solo 功能全表（Agent 核查用）
type: core
audience: agent
status: active
tags: [核心文档, 功能清单, 核查, 验收, 状态表]
summary: 逐项功能 × 实现锚点 × 状态 × 已知缺口，供其他 Agent 核查功能完善程度
updates: [ARCHITECTURE.md, docs/KNOWN-ISSUES.md, src/commands/registry.ts, src/components/Editor/tiptap/editor-extensions.ts, wiki/]
---

# solo 功能全表（供 Agent 核查）

> **基准**：`v1.2.54`（`package.json`）· commit `bcbfd0f` · 分支 `master` · 2026-09-14
> **本文只回答一件事**：solo 有哪些功能、每项做到什么程度、去哪儿核查。
> **与 `KNOWN-ISSUES.md` 的分工**：本文是「全量清单 + 状态」，KNOWN-ISSUES 是「问题台账」。缺口列的数字即 KNOWN-ISSUES 的条目号（`一/` 已修复供溯源，`二/` 待办，`三/` 设计取舍）。

## 0. 怎么用这张表

**状态图例**

| 标记 | 含义 |
| --- | --- |
| ✅ | 完整 —— 实现 + 测试/文档齐备，无已知缺口 |
| ⚠️ | 有边界 —— 功能可用，但有明确已知限制（见缺口列） |
| ⛔ | 未实现 / 已删除 |

**核查三步（缺一不可）**

1. **代码层** —— 打开「实现锚点」列的文件，确认逻辑真实存在。**一律以代码为准**，不采信注释、本文档、旧文档、`git` 历史记忆。
2. **测试层** —— `bun run test <spec 路径>`。无 spec 的功能只能走第 3 步。
3. **行为层** —— `bun run dev:tauri` 起应用，按「已知缺口」列给的反例手试。

**数量类事实一律不硬编码**（纪律见 KNOWN-ISSUES §二 #3）：

- 命令数 → `src-tauri/src/lib.rs` 的 `generate_handler!`
- 编辑器扩展数 → `src/components/Editor/tiptap/editor-extensions.ts` 的 `createEditorExtensions` 返回数组
- 快捷键全集 → `src/commands/registry.ts` 的 `defaultShortcut` + `src/composables/useAppDomEvents.ts` 的固定键位
- 测试数 → `bun run test` 输出

---

## 1. 文件与文档生命周期

| 功能 | 状态 | 实现锚点 | 已知缺口 / 边界 |
| --- | --- | --- | --- |
| 新建 / 打开 / 保存 / 另存为 | ✅ | [`registry.ts`](../src/commands/registry.ts) `file.new`/`file.open`/`file.save`/`file.saveAs` → [`useDocumentSession.ts`](../src/composables/useDocumentSession.ts) | — |
| 原子写（防写一半损坏） | ✅ | [`document.rs`](../src-tauri/src/commands/document.rs) `atomic_write`（先 `.tmp` 再 `MoveFileExW` rename） | 不做「先删后改名」，避免竞态窗口（ARCHITECTURE §11.2） |
| 保存冲突检测（mtime） | ✅ | [`document.rs`](../src-tauri/src/commands/document.rs) `save_document` + [`useDocumentSession.ts`](../src/composables/useDocumentSession.ts) | 冲突 → 弹「强制覆盖」，非静默（§11.2） |
| 外部修改提示 + 重载 | ✅ | [`file.ts`](../src/stores/file.ts) `reloadToken` + `App.vue` `externalFileWarning` | 同路径重载靠 `reloadToken`（KNOWN-ISSUES 一/14） |
| 重命名（含改标题即另存） | ✅ | [`document.rs`](../src-tauri/src/commands/document.rs) `rename_file` + `handleRename` | 实际改名走 save-as 流程 |
| 改名后同步入链文档 | ✅ | `document.rs` `sync_wikilinks_on_rename`（`dry_run` 预览 → 用户确认 → 原子改写） | **仅同目录、裸名与 `.md`**；手打的 `[[子/文]]`、`[[x.markdown]]` 不覆盖；缩进/行内代码不保护（§二 一/23 已知限制） |
| 自动保存 | ⚠️ | [`useDocumentSession.ts`](../src/composables/useDocumentSession.ts) 递归 `setTimeout`；[`settings.ts`](../src/stores/settings.ts) `autoSave` / `autoSaveInterval` | **默认关闭**（`autoSave: false`），默认间隔 **30 秒**，下限 5 秒。⚠️ wiki 写「2 秒自动保存」是错的，见附录 B-1 |
| 崩溃 / 意外退出恢复 | ⚠️ | 只靠 `.tmp` 残留兜底：[`document.rs`](../src-tauri/src/commands/document.rs) `cleanup_stale_tmp_files`（>1h 才清） | **无自动备份/会话恢复**（§二 一/19 是残留清理，不是恢复） |
| 最近文件快开 | ⛔ | 无 | §二 #4，可选未做 |
| 阅读位置记忆 | ⛔ | 无 | 无任何 scroll 恢复代码 |
| 拖 `.md` 进窗口打开 | ✅ | [`events.ts`](../src/services/tauri/events.ts) `Set<DragDropHandler>` 广播 | KNOWN-ISSUES 一/2 已修（原单值变量被覆盖） |
| Windows 文件关联（右键新建） | ✅ | [`desktop.rs`](../src-tauri/src/commands/desktop.rs) `register_shell_new` | 需在设置「保存策略」里手动开启 |
| 扩展名白名单（读 md/markdown/txt，写多 json） | ✅ | `document.rs` `validate_document_extension` + `lib.rs` `supported_open_path` | **新增可编辑类型须两处同改**（§11.4）。`json` 是给主题模板导出复用的 |

> **核查要点**：开两个窗口改同一文件 → 应弹冲突/外部修改提示，不许静默覆盖；崩一次看同目录是否有 `.tmp` 且在 1h 后被清。

## 2. 编辑与输入

| 功能 | 状态 | 实现锚点 | 已知缺口 / 边界 |
| --- | --- | --- | --- |
| 所见即所得（无分栏预览） | ✅ | [`MarkdownEditor.vue`](../src/components/Editor/MarkdownEditor.vue) + TipTap | 产品定位，非缺陷 |
| TipTap 实例复用（切文件不重建） | ✅ | `MarkdownEditor.vue` `shallowRef` + `setContent` | 性能关键路径，勿改成重建 |
| 懒初始化（无焦点不建编辑器） | ✅ | 同文件；`solo:editor-focus` 事件 + `requestAnimationFrame` 兜底 | — |
| 撤销 / 重做 | ✅ | `registry.ts` `editor.undo`/`editor.redo`（PM history） | — |
| 粘贴 Markdown 自动转换 | ✅ | [`markdown-paste.ts`](../src/components/Editor/tiptap/extensions/markdown-paste.ts) | ⚠️ 兜底判据 `isLowQualityParse` 会被 `font-weight` 骗过 → 漏救援（**§二 #13 未修**） |
| 粘贴 Word 列表 | ⚠️ | `markdown-paste.ts` `stripMsoMarkup` | **放弃重建**：塌成平段落（§三 设计取舍，非 bug） |
| 输入法组字期冻结（防候选窗失锚） | ⚠️ | [`composition-freeze.ts`](../src/components/Editor/tiptap/composition-freeze.ts)（`isFrozen`/`mapFrozenDecorations`/`createCompositionTracker`） | 机制完整；但**候选窗失锚仍未复现根治**（§二 #8，判定为 WebView2/TSF 上游缺陷，已加 IMM32 规避待真机验证）。**新增 decoration/NodeView 必须走它** |
| Slash 命令菜单 | ✅ | [`slash-commands.ts`](../src/components/Editor/tiptap/extensions/slash-commands.ts) | 中文前缀可唤出（`allowedPrefixes: null`）；代码块内不弹 |
| Emoji 菜单（`:`） | ✅ | [`emoji-suggest.ts`](../src/components/Editor/tiptap/extensions/emoji-suggest.ts) | 盘符 `G:` 误触发已修（一/25） |
| 互链补全（`[[`） | ✅ | [`wikilink-suggest.ts`](../src/components/Editor/tiptap/extensions/wikilink-suggest.ts) + `list_markdown_files` | 一/21 已修（曾因扩展级 option 漏递永久失效）；未保存文档也弹，候选为空给引导 |
| 代码上下文不弹菜单 | ✅ | [`suggestion-guard.ts`](../src/components/Editor/tiptap/extensions/suggestion-guard.ts) | `![[` 嵌入语法不触发 `[[`（一/18、一/22） |
| 查找 / 替换 | ✅ | [`useEditorSearch.ts`](../src/components/Editor/tiptap/useEditorSearch.ts) + [`SearchPanel.vue`](../src/components/Editor/views/SearchPanel.vue) + [`search-highlight.ts`](../src/components/Editor/tiptap/extensions/search-highlight.ts) | 快捷键是 `Mod-f`/`Mod-h`（wiki 写 `Mod-g` 是错的，附录 B-2） |
| 焦点模式 | ✅ | [`paragraph-focus.ts`](../src/components/Editor/tiptap/extensions/paragraph-focus.ts) + `<html>.focus-mode` | 非当前段落整体变淡；组字期装饰只平移不重建（一/15） |
| 字数统计（含大文档降级） | ✅ | [`editor-metadata.ts`](../src/components/Editor/tiptap/editor-metadata.ts) + `App.vue` `degradedWordCountTitle` | 150ms 防抖；大文档显示 `≈` 前缀 |
| 大纲面板 | ✅ | [`useOutline.ts`](../src/composables/useOutline.ts) + [`OutlinePanel.vue`](../src/components/Editor/OutlinePanel.vue) | `Mod+/` 开合（`view.toggleOutline`，**可在设置自定义**） |
| 命令面板 | ✅ | [`CommandPalette.vue`](../src/components/CommandPalette.vue) | `Mod+K`（`view.commandPalette`，`fixedShortcut` **不可自定义**）；**无「最近文件」分组**（§二 #4） |
| 上下文菜单 | ✅ | [`ContextMenu.vue`](../src/components/Editor/views/ContextMenu.vue) | — |
| 特殊块整体删除（`Mod+Backspace`） | ✅ | [`code-block.ts`](../src/components/Editor/tiptap/extensions/code-block.ts) / `math-block.ts` / `mermaid-block.ts` | 隔离区，标准退格不删块 |

> **核查要点**：中文输入法下敲「你好/」「标题/」「你好[[」三个场景都必须弹菜单（`allowedPrefixes: null` 的意义）；代码块里敲 `// 注释` 不许弹。

## 3. 格式与语法（mark 级）

| 功能 | 状态 | 实现锚点 | 已知缺口 / 边界 |
| --- | --- | --- | --- |
| 粗体 / 斜体 / 删除线 / 高亮 | ✅ | `registry.ts` `editor.bold`/`italic`/`strike`/`highlight` | 高亮单色（`multicolor: false`，刻意） |
| 行内代码（可与粗斜体共存） | ✅ | [`editor-extensions.ts`](../src/components/Editor/tiptap/editor-extensions.ts) `Code.extend({ excludes: '' })` | 一/26 已修：曾因 `excludes` 截断粗体并改坏文件 |
| 上标 / 下标 | ✅ | [`sub-sup.ts`](../src/components/Editor/tiptap/extensions/sub-sup.ts) | — |
| 文字变浅（Dim） | ✅ | [`dim.ts`](../src/components/Editor/tiptap/extensions/dim.ts) | **正式功能，勿误删为死代码**（TRAE「文字变浅」）；无默认快捷键 |
| mark 定界符「后开先关」契约 | ✅ | [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts) `renderMarks` | 一/26 已修，`roundtrip.spec.ts` Phase E 12 条锁死。**改 renderMarks 前必读** |
| 标题 1–6 / 普通段落 | ✅ | [`semantic-heading.ts`](../src/components/Editor/tiptap/extensions/semantic-heading.ts) + `registry.ts` | 自定义 heading 替代 StarterKit 内置 |
| 链接 + Ctrl 单击打开 | ✅ | [`link-open.ts`](../src/components/Editor/tiptap/extensions/link-open.ts) | 一/17 已修（曾是 PM 4px 门控 + 光标语义矛盾）；非 http/https/mailto 会提示 |
| 列表：无序 / 有序 / 任务 / 嵌套 / 同层混排 | ✅ | [`parser.ts`](../src/components/Editor/tiptap/markdown/parser.ts) `areAllTopLevelItemsTasks` + `editor-extensions.ts` `BulletList`/`OrderedList` content 放开 | 一/10 已修（曾是**数据丢失级**，整段消失含有序任务列表）。**改列表 schema/parser 前必读 §11 敏感区 #15** |
| 引用块 | ✅ | StarterKit `blockquote` + [`serializer.ts`](../src/components/Editor/tiptap/markdown/serializer.ts) `state.createChild()` | 一/11 已修（内层 state 曾丢 clipboard 标记，粘出去多出 `\$`） |
| 代码块（语法高亮 + 语言标签） | ✅ | [`code-block.ts`](../src/components/Editor/tiptap/extensions/code-block.ts) | 高亮色走主题 token，禁止外部配色 |
| 表格（GFM 管道） | ✅ | [`table.ts`](../src/components/Editor/tiptap/extensions/table.ts) + `registry.ts` `editor.table*` | 拖拽列宽**不持久**（§二 #6，GFM 无列宽语义） |
| 水平分隔线 | ✅ | StarterKit `horizontalRule` | — |

> **核查要点**：`*foo [bar](/url)*` 保存后必须仍是这个顺序（不能变成 `*foo [bar*](/url)`）；`- 甲` + `- [ ] 乙` 同层混排**三项内容都不许丢**。

## 4. 扩展语法（节点级）

注册全表以 [`editor-extensions.ts`](../src/components/Editor/tiptap/editor-extensions.ts) `createEditorExtensions` 返回数组为唯一真相源，**勿信任何硬编码数字**（旧文档的 14 / 21 均已过时）。

| 功能 | 状态 | 实现锚点 | 已知缺口 / 边界 |
| --- | --- | --- | --- |
| Frontmatter（YAML） | ✅ | [`frontmatter.ts`](../src/components/Editor/tiptap/extensions/frontmatter.ts) | 抽取占位 → 还原，不走 markdown-it 热路径 |
| 脚注（`[^1]` + 定义） | ✅ | [`footnote.ts`](../src/components/Editor/tiptap/extensions/footnote.ts)（Ref/Section/Def 三节点） | — |
| Callout（12 类型配色） | ✅ | [`callout.ts`](../src/components/Editor/tiptap/extensions/callout.ts) | 一/20 已修（NodeView 曾从不挂 `data-callout-type`，所有类型渲染成 note） |
| KaTeX 行内 / 块级 | ✅ | [`math-inline.ts`](../src/components/Editor/tiptap/extensions/math-inline.ts) / [`math-block.ts`](../src/components/Editor/tiptap/extensions/math-block.ts) | KaTeX 懒加载，解析器传空壳引擎 |
| Mermaid 图表 | ⚠️ | [`mermaid-block.ts`](../src/components/Editor/tiptap/extensions/mermaid-block.ts) | 中文/特殊字符标签需用户自加引号 `A["文本"]`（**§二 #2**） |
| WikiLink `[[ ]]`（补全/跳转/不存在则创建/拖入成链） | ✅ | [`wikilink.ts`](../src/components/Editor/tiptap/extensions/wikilink.ts) + [`wikilink-drop.ts`](../src/components/Editor/tiptap/extensions/wikilink-drop.ts) | 拖入落点已修但**真机 OS 拖拽手感未人工确认**（§二 #9 待发布） |
| 任务列表（含嵌套） | ✅ | `TaskList` / `TaskItem.configure({ nested: true })` | 嵌套 `- 父\n  - [ ] 子` 曾整层误判（一/10 同批修） |
| 图片节点（含尺寸私有语法） | ✅ | [`image.ts`](../src/components/Editor/tiptap/extensions/image.ts) + `serializer.ts` `![alt\|WxH](src)` | ⚠️ `\|WxH` 是 **solo 私有扩展**，非标准 Markdown，粘到别家编辑器会暴露（属设计选择，未见台账） |
| 表格节点（自定义 4 件套） | ✅ | `CustomTable` / `Row` / `Header` / `Cell` | 与 `table.ts` 配套 |
| 语义标题 | ✅ | `semantic-heading.ts` | — |
| 占位符（空文档提示） | ✅ | `Placeholder.configure` | — |
| 删除 callout / 公式 / 图表整块 | ✅ | 三个 NodeView 的 `destroy()` + `AbortController` | 一/10（NodeView 泄漏）已修；**新增 NodeView 必须成对清理**（§11.7） |

> **核查要点**：12 类 callout 逐一切换看配色是否真的不同（一/20 就是这么漏掉的）；Mermaid 里写中文标签看是否报错提示。

## 5. 外观：主题、字体、排版

| 功能 | 状态 | 实现锚点 | 已知缺口 / 边界 |
| --- | --- | --- | --- |
| 8 套内置主题 | ✅ | [`presets/`](../src/themes/presets/) + [`manager.ts`](../src/themes/manager.ts) | `scholar-light`/`scholar-dark`/`elegant-light`/`cinnabar-light`/`cinnabar-dark`/`default-light`/`jade-light`/`orchid-light`（部分文件名无 `-light` 后缀，但 JSON 内 `id` 有）；**无 `gray-domain`** |
| 自定义主题 CRUD / 导入导出 | ✅ | `manager.ts` `importTheme` + `ThemeSelector.vue` | 兼容 legacy（light/dark 双色）旧格式 |
| 明暗独立 + 系统主题跟随 | ✅ | `applyDarkClass` + `ensureThemeId()` 回退 | 主题 id 失效按当前外观回退，不黑屏 |
| 排版随主题（行高/字号/段距/字距） | ✅ | `manager.ts` `injectTypography` → `--mk-*` → [`editor.css`](../src/components/Editor/tiptap/editor.css) | 先 `removeProperty` 再注入；`editor.css` 13 处全量消费 |
| 字号 / 行高手动调节 | ✅ | [`AppearanceSettingsPanel.vue`](../src/components/Settings/AppearanceSettingsPanel.vue) | `null` = 用主题默认（v12 迁移改的） |
| 7 款字体 + 按需下载 | ✅ | [`fonts.ts`](../src/constants/fonts.ts) + [`fontLoader.ts`](../src/services/fontLoader.ts) | `fileName` 有值=下载型；`undefined`=系统字体 |
| 字体加载双通道 | ✅ | `fontLoader.ts` `registerFontViaCss`（asset:// 首选）→ `readFontBytes`（字节兜底） | 一/7 已修 CORS 静默拦截；**永不删兜底通道** |
| 编辑器与导出共用字体栈 | ✅ | [`fontStack.ts`](../src/utils/fontStack.ts) `buildFontStack` | 真理源自一处 |
| 全格式色走主题 token | ✅ | [`types.ts`](../src/themes/types.ts) `CSS_VAR_MAP`（68 字段） | §11.6 硬规矩：hljs / mermaid / KaTeX 颜色也须走 token，禁止硬编码 |
| 主题切换过渡动效 | ✅ | `.theme-transitioning` 200ms + 编辑区 220ms 淡入 | `prefers-reduced-motion` 需自行核对 |

> **核查要点**：新建自定义主题只许写「性格差异」字段，共享值必须走 `SHARED_LIGHT/DARK_COLORS`；切换主题后状态栏「未保存」指示色也要跟着变（历史 bug：`--dirty-color` 漏登记）。

## 6. 图片

| 功能 | 状态 | 实现锚点 | 已知缺口 / 边界 |
| --- | --- | --- | --- |
| 粘贴 / 拖入图片 | ✅ | [`editor-image-drop.ts`](../src/components/Editor/tiptap/editor-image-drop.ts) + `save_clipboard_image` / `import_document_image` | 编辑器外粘贴图片会提示「请拖入」，属刻意行为 |
| 图片存储路径可配置 | ✅ | `settings.imageStoragePath` + `resolve_image_display` | 未设置时按文档目录规则 |
| 远程图片本地缓存 | ✅ | [`image.rs`](../src-tauri/src/commands/image.rs) `fetch_remote_image`（≤10MB）→ 缓存目录 | ⚠️ **挡不住 DNS rebinding**（§二 #5，已声明取舍） |
| 扩展名白名单（8 种） | ✅ | `document.rs` `IMAGE_EXTENSIONS` | **三处硬编码必须一致**：Rust 白名单 / `editor-image-drop.ts` / `mime_to_extension`（曾因漏 `.bmp/.ico` 出现「能存不能显」） |
| 路径信任边界（防越权读文件） | ✅ | `document.rs` `validate_image_asset_path`（canonicalize → is_file → 扩展名） | 一/9 已修 |
| 图片预览视图 + 全屏浮层 | ✅ | [`ImagePreviewView.vue`](../src/components/Editor/ImagePreviewView.vue) + `ImageFullscreenOverlay.vue` + [`useImagePreview.ts`](../src/composables/useImagePreview.ts) | 双击图片进预览 |
| 文件名含空格 / 中文路径 | ✅ | `serializer.ts` `escapeLinkDestination` + `parser.ts` `decodeLinkDestination` | 一/12 已修；Rust 侧粘贴命名已改为无空格 |

> **核查要点**：拖一张 `.ico` 或 `.bmp` 进去 → 必须既能落盘又能显示；图片名带空格 + 中文目录重开不丢。

## 7. 剪贴板与输出

| 功能 | 状态 | 实现锚点 | 已知缺口 / 边界 |
| --- | --- | --- | --- |
| `Ctrl+C` 默认给干净纯文本 | ✅ | `serializer.ts` `serializeClipboardText` + `PLAIN_TEXT_SAFE_NODES` 白名单 | 一/24 已修（曾是单向棘轮式加转义）；白名单=退化安全，新节点默认回落 |
| 选区含专有节点 → 回落 Markdown 源码 | ✅ | 同上（公式/图表/互链/脚注/frontmatter/callout/图片） | 链接**不**回落（mark 有合格纯文本替身） |
| 「复制为 Markdown」显式入口 | ✅ | `registry.ts` `edit.copyAsMarkdown`（`Mod+Shift+M`，app scope） | scope 必须 app，标 editor 会彻底按不动 |
| 状态栏复制按钮 | ✅ | [`StatusbarQuickActions.vue`](../src/components/StatusbarQuickActions.vue) | 实际写**双槽**：`text/plain` = Markdown 源码、`text/html` = 渲染富文本。UI `title` 却写「复制 Markdown」，ARCHITECTURE 称「复制为 HTML」→ 口径不一（附录 B-4） |
| 表格跨格 / 单元格复制 | ✅ | `MarkdownEditor.vue` `onEditorCopy` + `serializer.ts` `stripOpenLayers` | 一/16 已修：压平为 TSV + 逐行 `<p>` |
| solo → solo 粘贴保真 | ✅ | 走各扩展 `parseHTML` + `text/html`，**不依赖 text/plain** | — |
| 文件落盘 vs 剪贴板两套转义 | ✅ | `serializer.ts` `escapeInline` 按 `clipboard` 标记分流 | **故意不同，别互相「修正」**；嵌套序列化必须 `state.createChild()`（§11.8） |
| 打印 / PDF 导出 | ⛔ | 全仓无实现（`src/` 无 print 调用、Rust 菜单无该项） | v1.2.18 随导出系统整块删除（§三 设计取舍）。⚠️ wiki 与 TROUBLESHOOTING 仍写「菜单『打印』」→ 已失效，见附录 B-3 |
| 导出系统（HTML/PDF/微信 / `buildExportTree`） | ⛔ | 已删（净删 ~2500 行） | 替代品＝状态栏复制按钮 + 命令面板 `edit.copyAsMarkdown` |

> **核查要点**：复制 `G:\skills-pi\x` 粘到记事本必须是原样一个反斜杠（一/25 反例）；复制含斜体链接的段落不许夹带 `\*`。

## 8. 窗口与系统集成

| 功能 | 状态 | 实现锚点 | 已知缺口 / 边界 |
| --- | --- | --- | --- |
| 无边框窗口 + 自定义标题栏 | ✅ | [`CustomTitlebar.vue`](../src/components/Layout/CustomTitlebar.vue) + `WindowResizeHandles.vue` | 双击标题栏最大化 |
| 多窗口（每 `.md` 独立进程） | ✅ | `lib.rs` `new_editor_window` + `PendingWindowPaths` | 关最后一个窗口**默认不退出**（§三 设计取舍，需菜单「退出」） |
| 关闭未保存确认（多窗口串联退出） | ✅ | [`window.rs`](../src-tauri/src/commands/window.rs) `request_app_quit` / `report_window_close` + [`useAppWindowSession.ts`](../src/composables/useAppWindowSession.ts) | 任一窗口点「取消」→ 中止整个退出 |
| 窗口置顶 | ✅ | `settings.alwaysOnTop` + 标题栏按钮 | 不在设置面板里，只在标题栏 |
| 标题栏自动隐藏 | ✅ | `settings.titlebarAutoHide` | 编辑器偏好页可关 |
| 窗口尺寸/位置/最大化记忆 | ✅ | tauri-plugin-window-state | — |
| 全屏 | ✅ | `registry.ts` `view.fullscreen`（`F11`） | — |
| 启动开打竞态（CLI / OS open / 新窗口） | ✅ | [`state.rs`](../src-tauri/src/state.rs) 五类 managed state + `lib.rs` `startup_ready` | 五类：`StartupOpenRequests`/`PendingWindowPaths`/`LoadedWindows`/`FocusedWindow`/`CloseGuard`（关窗看门狗）。**动事件顺序前必读 §11.5** |
| 菜单事件定向到焦点窗口 | ✅ | `menu.rs` + `FocusedWindow` | 防多窗口重复执行同一菜单动作 |
| 启动诊断日志 | ✅ | `lib.rs` `reveal_startup_open_log` + 菜单「打开启动诊断日志」 | 写 `startup-open.log` |
| 错误边界（编辑器崩溃不白屏） | ✅ | [`ErrorBoundary.vue`](../src/components/Layout/ErrorBoundary.vue) | ⚠️ 是双根 fragment，布局 class 必须由外层 `div.editor-area` 承载（豁免 IME 相关的历史坑） |
| WebView2 内存回收（失焦降档） | ✅ | [`window.rs`](../src-tauri/src/commands/window.rs) `SetMemoryUsageTargetLevel` | Windows 专属 |
| 系统代理检测（给更新用） | ✅ | `lib.rs` `detect_proxy_for_update` + [`updater.rs`](../src-tauri/src/updater.rs) | **不存在 `proxy.rs`**（旧文档误导） |
| macOS 适配 | ⚠️ | `isMac` / `set_window_background_color` / `Opened{urls}` | 代码在位但**无 Mac 环境实测**，不可标 ✅ |
| IME 候选窗失锚（系统级） | ⚠️ | `tauri.conf.json` `additionalBrowserArgs` 禁用 TSF 回退 IMM32 | **有效性未验证**（§二 #8）。注意：设了 `additionalBrowserArgs` 会完全替换 wry 默认值，必须自带三个 OOUI flag |

> **核查要点**：连开三个窗口 → 关最后一个不该退出进程；菜单动作只作用于焦点窗口。

## 9. 更新与发布

| 功能 | 状态 | 实现锚点 | 已知缺口 / 边界 |
| --- | --- | --- | --- |
| 启动自动检查更新 | ✅ | [`update.ts`](../src/services/tauri/update.ts) `checkUpdateAvailability` + tauri updater | 可在「关于」页关闭（`enableAutoUpdateCheck`） |
| 手动检查更新 | ✅ | AboutSettingsPanel「检查更新」 | 成功只提示「去软件里更新」，**不对外发链接**（协作纪律） |
| 更新代理检测 | ✅ | `updater.rs` `detect_github_proxy` | 环境变量/注册表/端口探测 |
| CNB 国内镜像自动更新 | ⛔ | CNB 仅作手动下载镜像 | **待用户拍板 A/B**（§二 #7）：启用需改写 `latest.json` 的 `url` + 实测多端点 fallback |
| 三平台 CI 发版 | ✅ | [`.github/workflows/release.yml`](../.github/workflows/release.yml) | 流程真理源 `docs/RELEASE_PROCESS.md`（Agent 侧见 §11） |

> **核查要点**：更新检查失败必须静默降级，不许弹错误框骚扰用户。

## 10. 性能与大文档

| 功能 | 状态 | 实现锚点 | 已知缺口 / 边界 |
| --- | --- | --- | --- |
| 防抖分层（字数150/光标100/大纲500/序列化500） | ✅ | [`useEditorSync.ts`](../src/composables/useEditorSync.ts) | **刻意分层，改前先理解**（§6.3）；空闲序列化撞上续打会推迟回防抖 |
| 大文档降级开关 | ✅ | [`document-scale.ts`](../src/components/Editor/document-scale.ts) `HEAVY_DOC_CHARS` | `content-visibility` **仅大文档启用**（曾被无条件应用，是 IME 失锚的一环，一/15） |
| 大文档性能方案（P0/P1 已做，P2 砍，P3 简化） | ⚠️ | `docs/archive/large-document-performance.md`（已归档） | 后续项**未排期** |
| 编辑器懒初始化 / 组件异步加载 | ✅ | `MarkdownEditor` 用 `defineAsyncComponent` | — |
| KaTeX / Mermaid 懒加载 | ✅ | 解析器只分词不渲染 | 保住解析热路径 |
| 轻量安装包（用系统 WebView2） | ✅ | `tauri.conf.json` | — |

> **核查要点**：开一篇 10 万字文档 → 输入不卡、字数带 `≈`、切文件不重建编辑器。

## 11. 质量防线（改代码前先看这节）

| 防线 | 状态 | 实现锚点 | 边界 / 注意 |
| --- | --- | --- | --- |
| roundtrip 真保真（手写用例，断 `md' === md`） | ✅ | [`roundtrip.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/roundtrip.spec.ts) | 唯一断真保真的网；Phase E 锁「后开先关」 |
| fixtures「重开等价」+ 双向锁 | ✅ | [`fixtures.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/fixtures.spec.ts) | 参照系是 **markdown-it**（第三方），不是 solo 自己；缺口登记在 `KNOWN_FIDELITY_GAPS`，**修好也红** |
| fuzz 种子化 + 结构块生成 | ✅ | [`fuzz.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/fuzz.spec.ts) | `FUZZ_SEED` 可覆盖，失败报文带种子可原样重放 |
| CommonMark 652 条收敛 | ⚠️ | [`commonmark.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/commonmark.spec.ts) | **只验收敛，不是保真防线**（收敛 ≠ 不丢）；`list` 类 SKIP 最多 |
| schema 正向契约锁 | ✅ | [`schema-contract.spec.ts`](../src/components/Editor/tiptap/__tests__/schema-contract.spec.ts) | 防「约束被一致地改错」；差异集变化即红。`compat-schema.ts` 已删（死代码） |
| NodeView 清理回归锁 | ✅ | [`nodeview-destroy.spec.ts`](../src/components/Editor/tiptap/extensions/__tests__/nodeview-destroy.spec.ts) | 配套 §11.7 的 `AbortController` 套路 |
| 剪贴板序列化回归锁 | ✅ | [`clipboard-serializer.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/clipboard-serializer.spec.ts) | 含「开口 slice 剥层」7 条 |
| 脏态基线回归锁 | ✅ | [`baseline-dirty.spec.ts`](../src/components/Editor/tiptap/markdown/__tests__/baseline-dirty.spec.ts) + [`file.spec.ts`](../src/stores/__tests__/file.spec.ts) | A1 语义比对的护栏 |
| 测试策略（免责声明 + 覆盖缺口） | ⚠️ | — | **§二 #12**：机制层已修（fixtures 补「重开等价」、fuzz 补结构块），但 GFM 扩展语法仍缺规范级用例 |
| 命令注册表自检 | ✅ | [`registry.spec.ts`](../src/commands/__tests__/registry.spec.ts) | 快捷键冲突检测 |
| 改 parser/serializer 三步闸门 | ✅ | 纪律见 [`AGENTS.md`](../AGENTS.md) | `bun run test` + `vue-tsc --noEmit` + `bun run build` |
| Rust 改动闸门 | ✅ | 纪律见 [`BUILD_GUIDE.md`](../BUILD_GUIDE.md) | 本机缺 MSVC 时 `cargo check` 不能跳，**CI 是最终闸门** |

> **核查要点**：任何「改 X 必查 Y」的联动矩阵见 [`AGENTS.md`](../AGENTS.md) §5；bug 易发区见 [`ARCHITECTURE.md`](../ARCHITECTURE.md) §11 速查表（条目数以该表实际为准）。

---

## 附录 A：未实现 / 已删清单

**未实现（可作功能缺口核查靶子）**

> 判定方式：已落台账的给出条目号；标「无」的为 `grep -ri` 全 `src/` + `src-tauri/src/` 无任何命中（命中即证明我判错，请直接改本表）。

| # | 缺口 | 出处 / 依据 |
| --- | --- | --- |
| 1 | 最近文件快开（依赖 Rust 侧最近文件记录） | §二 #4 |
| 2 | 阅读位置记忆（重开回到上次位置） | 无（`scrollPosition` / `restoreScroll` 零命中） |
| 3 | 崩溃恢复 / 会话自动备份 | 无（仅 `.tmp` 残留兜底） |
| 4 | 标题折叠（Markdown 标题层级折叠） | 无（`collapse` 命中仅 callout 的 `fold` 属性） |
| 5 | 跳转历史（前进/后退） | 无（`goBack` / `historyStack` 零命中） |
| 6 | 表格列宽持久化 | §二 #6 |
| 7 | 粘贴兜底 `isLowQualityParse` 漏救援修正 | §二 #13 |
| 8 | CNB 自动更新镜像 | §二 #7（待拍板） |
| 9 | macOS / Linux 安装包 | 无（CI 矩阵仅 Windows x64） |

**已删（勿按旧文档去「修」）**

| 功能 | 删除时点 | 现状替代 |
| --- | --- | --- |
| 导出系统（HTML / PDF / 微信 / `buildExportTree` / `wechat-themes.ts`） | v1.2.18 | 状态栏复制按钮 + `edit.copyAsMarkdown` |
| 文件树 / workspace watcher / `fs.rs` / `watch.rs` / `config.rs` | 更早 | 无（产品减法） |
| `utils/shortcuts.ts`、`compat-schema.ts`（203 行死代码） | 2026-09-14 | registry 内联 / 测试复用生产 schema |
| 单实例模型 | v1.2.5 | 多进程多窗口 |

## 附录 B：文档与代码不一致（本次核查发现，**以代码为准**）

| # | 文档写什么 | 代码是什么 | 影响 |
| --- | --- | --- | --- |
| 1 | `wiki/快速上手.md` / `wiki/图片与文档管理.md`：「文档修改后 **2 秒自动保存**」 | `settings.ts` `autoSave: false`（默认**关闭**）、`autoSaveInterval: 30`（30 秒）；`2000ms` 只是「已保存」提示的显示时长（`AUTOSAVE_STATUS_DISPLAY_MS`） | 🔴 高：用户以为有自动保存，实际默认不保存，**可能丢稿** |
| 2 | `wiki/快捷键速查.md` / `wiki/编辑器功能指南.md` / `wiki/快速上手.md`：查找 `Mod+G`、替换 `Mod+Shift+G` | `registry.ts:350/360`：`Mod-f` / `Mod-h`（代码注释明确写了「旧默认 Mod-g 与跳转行心智冲突」） | 🟡 中：用户按键无效，文档三处同错 |
| 3 | `wiki/编辑器功能指南.md`「菜单『打印』」、`docs/TROUBLESHOOTING.md §5`「工具栏『导出 PDF』改名『打印』」 | **全仓无打印实现**（`src/` 无 print、Rust 菜单无该项）；v1.2.18 已连导出系统一起删 | 🟡 中：文档描述不存在的功能，用户会去找 | 
| 4 | `wiki/快捷键速查.md` 声称「全部默认快捷键」 | 仅剩 `Mod+Backspace`（删特殊块）定义在块组件内（不在 registry）；**大纲 / 命令面板已于 2026-09-14 收编进 registry** | 🟢 低 |
| 5 | `README.md` / `wiki/Home.md`：「618 pass / 34 design constraints」（硬编码测试数） | `KNOWN-ISSUES §二 #3` 明令**任何文档不要再硬编码测试数**，统一写「以 `bun run test` 为准」 | 🟢 低：违反自身纪律，数字必然漂移 |
| 6 | `registry.ts` `help.diagnostics` 描述：「在 **Finder** 中定位冷启动诊断日志」 | `reveal_startup_open_log` 走系统文件管理器；Windows 用户看到 macOS 文案 | 🟢 低：文案残留 |

> 修法纪律：文档与代码不符，**改文档**（除非代码确实错）。改完按 [`AGENTS.md`](../AGENTS.md) §5 跑死链扫描。

## 附录 C：核查常用命令

```bash
bun run test                          # 全量测试（含 markdown 保真四网）
bun run test src/.../roundtrip.spec.ts  # 单跑某张网
FUZZ_SEED=123 bun run test src/.../fuzz.spec.ts   # 复现随机失败
npx vue-tsc --noEmit                  # 类型闸门
bun run build                         # 前端构建闸门
bun run dev:tauri                     # 行为层核查（起真应用）
```

Rust 侧（本机缺 MSVC 时不能跳过，CI 是最终闸门）与全部命令以 [`BUILD_GUIDE.md`](../BUILD_GUIDE.md) §8.5 为唯一真理源。

## See also

- [架构真相地图](../ARCHITECTURE.md)（§11 敏感区 16 条）
- [已知问题与技术债](./KNOWN-ISSUES.md)
- [文档索引](./INDEX.md) · [接手指南](./HANDOVER.md)
- [项目工作手册](../AGENTS.md)
