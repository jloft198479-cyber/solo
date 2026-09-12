---
title: solo 核心逻辑与结构审查报告（2026-09-12）
type: proposal
audience: maintainer
status: active
tags: [架构审查, 代码质量, 测试, 安全]
summary: 一次只读架构审查：核心逻辑清晰度优、结构稳定、扩展性内核强外壳弱，附分优先级改进建议（已按产品定位筛过，处置见文末）
updates: [ARCHITECTURE.md, docs/KNOWN-ISSUES.md, .github/workflows/test.yml]
---

# solo（md-editor）核心逻辑与结构审查报告

> 审查日期：2026-09-12 · 纯只读审查，未改动任何代码。
> 代码规模：前端 src/ 约 2.3 万行源码（另 7 千行测试），后端 src-tauri 约 4 千行 / 26 个 Tauri 命令；测试合计约 620 个用例。
> 审查方法：三路并行探索（前端 / Rust 后端 / 横切面与测试体系）交叉印证 + 关键文件人工抽核（`stores/file.ts`、`markdown/plugins/index.ts`、`services/tauri/command-names.ts`）。

## 总体结论

**核心逻辑清晰度是这个项目的强项，结构整体稳定，扩展性在「编辑器内核」维度优秀、在「应用外壳」维度偏弱。** 主要风险不在核心逻辑本身，而集中在外围结构：分层倒置、双管线、多处「双源事实」靠注释人工同步，以及 CI 缺 `cargo test` 使 Rust 回归锁处于离线状态。

---

## 一、逻辑清晰度 —— 优

核心数据流是一条清晰的单线：磁盘载入 → `fileStore.setFile`（重置脏态 + `reloadToken` 通知编辑器替换文档，`src/stores/file.ts:77-92`）→ 编辑经 `useEditorSync` 单出口（防抖 + requestIdleCallback，序列化移出输入关键路径）→ `syncEditedContent` 语义比对 → 保存走 mtime 乐观锁。

三处关键设计均已核实且契约写明：

1. **脏态唯一真相源**（`src/stores/file.ts:66-75`）：序列化结果去尾换行后与基线比对，相等不标脏——同时根治「误标脏」（Mermaid 后台事务）和「漏标脏」（拖图）。基线只在保存成功后更新（`file.ts:109-114`），注释把「提前更新会洗白脏标导致静默丢失」的因果写透。
2. **markdown 语法的插件内聚**（`src/components/Editor/tiptap/markdown/plugins/index.ts:41-57`）：`MarkdownSyntaxPlugin` 接口把同一语法的解析与序列化收在单文件，单数组注册，双向转换不会分叉。
3. **错误通道端到端闭环**：Rust `AppError` 五变体（`error.rs:5-16`）→ `{code,message}` 序列化 → 前端 `normalizeTauriError`（`client.ts:29-55`）→ 两侧测试锁定。26 个命令中 25 个走此通道。

**清晰度瑕疵**：

- `detect_proxy_for_update` 是全库唯一 `Result<String, String>` 命令，且把「未检测到代理」这个正常结果编码为 `Err`，还直接改进程级环境变量（`lib.rs:136-147`）——语义脱节的孤例。
- `MarkdownEditor.vue`（828 行）承担装配/气泡菜单/表格右键/复制压平/拖放成链/互链建文档/图片缓存 7+ 项职责，是事实上的 god component。

## 二、结构稳定性 —— 良

**稳定面（已核实）**：

- 前端 `command-names.ts` 26 条与 Rust `generate_handler!`（`src-tauri/src/lib.rs:353-380`）一一对齐零漂移，全 src 仅 `client.ts:62` 一处裸 invoke。
- Rust 侧 Mutex 临界区均为一两行集合操作、无嵌套锁、阻塞 IO 全走 `spawn_blocking`。
- CloseGuard 看门狗（`state.rs:142-196`）用纯 Rust 状态机解决大文档序列化占死 JS 线程的关窗问题，设计干净。
- 防御纵深（扩展名闸门 → canonicalize → containment → SSRF 黑名单 → 字体 magic bytes）层层独立且注释写明威胁模型。

**风险面**：

1. **多处「双源/三源事实」靠注释人工同步**：图片扩展名清单 ×3（document.rs:16 自认）、stale 清理阈值 ×2（main.rs:7 / document.rs:761）、`MIN_AUTOSAVE_INTERVAL_SECONDS` ×2（settings.ts:70 / useDocumentSession.ts:59）、字体旧缓存迁移逻辑 ×2（font.rs 内）、`assets/` 解析规则 ×2。均有提醒注释但无编译期/测试期强制——这是「改一处漏一处」bug 的温床。
2. **分层倒置**：composables 反向依赖 components 深层（`useEditorSync.ts:10-12`、`useDocumentSession.ts:15-20`、`useAppWindowSession.ts:5`）；全局单例 `document-scale.ts` 错放在组件目录。无路径别名（最深 `../../../../`），移动文件即断链。
3. **markdown 层与 extensions 层互缠**：`markdown-paste.ts:38 → parser`、`parser.ts:26 → extensions/image`、`plugins/callout.ts:20 → extensions/callout`，无单向边界；`serializer.ts:41-43` 已有为躲循环依赖改设计的痕迹。
4. **安全闸门不一致**：`rename_file` 不校验 `old_path` 扩展名、两个图片命令的 `storage_dir` 从前端直信无 containment（document.rs:423/485），与 `resolve_image_display` 的严密形成落差。

## 三、灵活性 —— 中上

**强项**：主题 = 1 个 JSON + 1 行登记；字体 = 清单加 1 项；命令元数据表（`src/commands/registry.ts`）同时驱动命令面板、快捷键匹配、原生菜单三套消费方。

**弱项**：

- 命令 dispatcher 是手写 switch（`useCommandDispatcher.ts:54-99`，加命令第 3 处改动）。
- Slash/Emoji/Wikilink 三个 Suggestion 菜单的 render 回调近乎复制粘贴三份，注释自证已产生过「Emoji 漏修」类 bug（editor-extensions.ts:212/261）。
- 三条游离的裸 window 自定义事件（`solo:editor-ready` / `image-paste-warning` / `editor:image-dblclick`）绕过 events.ts，形成无类型的迷你事件总线。

## 四、可扩展性 —— 核心强、外壳弱

| 扩展场景 | 改动成本 | 评价 |
|---|---|---|
| 新 markdown 语法 | 1 新文件 + 2 处登记（含 roundtrip 测试） | **最优**，有 131 条 roundtrip + 652 条 CommonMark + 19 fixture + 100 fuzz 护栏 |
| 新块级编辑扩展 | 2 新文件 + 4 处修改 / 6 文件 | 路径清晰 |
| 新 Tauri 命令 | 4 处（定义/re-export/generate_handler/command-names.ts） | 可接受，但纯手工同步，Rust 侧漂移无编译期拦截 |
| 新侧边栏/面板 | 7-9 处 / 5-6 文件，无面板注册表抽象 | **最弱维度** |

另有一个结构性隐患：`utils/markdown-to-html.ts:66` 是独立于主管线的第二套 markdown-it 渲染（仅复制 HTML 功能用），与 parser/serializer 行为一致性无测试保障，存在语法渲染分叉风险。

## 五、测试与 CI（支撑重构的能力）

- 前端安全网教科书级：43 个 spec / 约 543 用例，markdown 保真三层防线（手写 roundtrip + CommonMark 全量收敛 + fixture/fuzz）。
- Rust 78 个测试质量好，但 **CI（test.yml）只跑到 `cargo check`，没有 `cargo test`**——`sync_wikilinks_on_rename` 等高风险回归锁实际只在开发者本机生效。
- `release.yml`（tag 触发）零质量门禁直接构建发布。
- 安全关键纯函数（containment 本体、`validate_font_bytes`、`mime_to_extension`）零测试。
- eslint 不进 CI；前端覆盖率门槛 50/50/40/50 偏保守。

---

## 建议的后续动作（暂不执行，待拍板）

**P0（低成本、消真实风险）**

1. `test.yml` 补 `cargo test` 与 eslint 步骤——让 78 个 Rust 回归锁在 CI 生效。
2. 补安全盲区测试：containment 检查、`validate_font_bytes`、`mime_to_extension`（均为纯函数，项目已有现成测试模式可套）。

**P1（结构收敛）**

3. 配 `@` 路径别名，消灭 ≥3 级相对导入；`document-scale.ts` 上移出组件目录，解开 composables→components 倒置。
4. 抽取共享的 Suggestion 菜单工厂，消灭三份复制粘贴回调。
5. `detect_proxy_for_update` 改走 AppError 通道、去掉 env 全局副作用。

**P2（扩展性投资）**

6. 面板注册表抽象（对标 `commands/registry.ts`）；dispatcher switch 声明式化。
7. 双源事实收敛：扩展名清单、stale 阈值、`MIN_AUTOSAVE_INTERVAL_SECONDS` 各收敛到单一真理源 + 测试锁定；`utils/markdown-to-html` 并入主管线或明确隔离边界。

---

## 处置记录（2026-09-12，维护者复核后追加）

本报告的**事实层经逐条抽核，准确度高**（8 项抽查 7 项与代码完全吻合，含行号）。但它是**通用软件工程视角**的审查，未纳入 solo「个人阅读 + 写作工具、非协作、非长文档处理器」的产品定位，故 P1/P2 需用 YAGNI 过滤后执行。结论如下：

**已采纳**

- P0-1 CI 补 `cargo test` + `eslint` → 已落地（`test.yml`）；顺带清零了因此暴露的 6 个存量 lint error。
- P2-7 双源事实收敛 → **部分采纳**：`prosemirror-model` / `prosemirror-view` 已用 `overrides` 钉死单一版本（起因是本次 Tiptap 升级实测触发了多版本副本故障）；`stale` 阈值与 `MIN_AUTOSAVE_INTERVAL_SECONDS` 的收敛**暂缓**，留待有实际 bug 触发时再做。

**暂不执行**（撞 YAGNI，收益与改动成本不匹配）

- P1-3 路径别名 + `document-scale.ts` 上移；P1-4 Suggestion 菜单工厂；P2-6 面板注册表抽象、dispatcher 声明式化。

**本轮未覆盖的更高优先项**

- **运行时依赖漏洞**（本报告未扫描）：`bun audit` 查出 `@tiptap/core` 的 Markdown 解析 ReDoS 等 5 个运行时包漏洞，已随 v1.2.53 升级修复。教训：**代码质量审查不替代依赖漏洞扫描**，两者是独立维度。

**一处指控力度偏重（供后续引用时注意）**

- 「`rename_file` 不校验 old_path 扩展名」字面成立，但实现是**继承**旧扩展名（`format!("{}.{}", stem, extension)`），用户无法指定新扩展名，与图片命令的 `storage_dir` containment 缺口**不属同一等级**。
