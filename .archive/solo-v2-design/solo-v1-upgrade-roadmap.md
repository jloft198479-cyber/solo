# solo V1 升级规划 - 基于 V2 架构蓝图

> 本文件位于代码外部(`F:\fzz-Project\md-editor\`),是 solo 项目的**升级路线图**,
> 不在 git 跟踪范围内,仅供规划与评审使用。
>
> 最后更新:2026-07-19

---

## 0. 背景与定位

| 项 | 说明 |
|----|------|
| **V1** | 生产版本(`md-editor/md-editor/`),Tauri v2 + Vue 3 + TipTap,~989 个测试守门,功能完整可运行 |
| **V2** | 架构原型(`md-editor/md-editor/solo-v2/`),**不可运行**(解析器/编辑器扩展/导出是 stub),本质是 V1 的"减法设计"草图 |
| **本规划** | 把 V2 蓝图里的**架构优化点**逐步合进 V1,**V1 现有功能一个不动**(表格/列表/mermaid/导出等全部保留) |

**核心原则**(来自项目纪律 + V2 设计哲学):
1. **渐进实施**--每阶段独立、可单独回滚,不一次性大改。
2. **测试守门**--每阶段结束,`bun run test` 必须全绿,功能零倒退。
3. **功能零损失**--V2 的"保持原样"清单(见 §4)一律不动。
4. **取得共识再行动**--每个阶段动代码前,先与用户确认实施方案。

---

## 1. V2 优化点 × V1 现状核实（核心）

下表每一项都**实测过 V1 源码**，不是凭印象。结论分三档：
- ✅ **已完成**：V1 已实现，无需再做
- 🔶 **待实施**：V1 还没做，是有价值的改造点
- ➖ **无需做**：V1 现状已满足目标，或 V2 描述的前提在 V1 不成立

> **2026-07-19 阶段 0 摸底已更新**：拖拽单例、设置分级均已发现已实现（但拖拽单例有互斥覆盖 bug）。

| # | V2 优化点 | V2 目标 | V1 现状（实测） | 结论 |
|---|-----------|---------|----------------|------|
| 1 | 五级启动分级 | 启动路径只做必要事，端口探测/更新推迟到首次网络请求 | `lib.rs` 已有 `startup_ready` 命令；`updater.rs` 代理检测仅手动触发；`settings.ts` 已有 `initThemeOnly()` + `initFull()` L1/L2 分级 | ✅ **已完成**（阶段 3 不再需要） |
| 2 | IPC 合并（图片 resolve+authorize → 单命令） | 前端 1 次调用拿 `asset://` URL，Rust 内部完成路径判别+canonicalize+authorize | `lib.rs:346` 注册 `resolve_image_display` 新命令；`MarkdownEditor.vue` `setLocalSrcResolver` 改用单命令（从 5 行简化到 1 行）；其他调用点（拖入/粘贴/预览）传绝对路径仍用 `authorizeImageAsset`，不需改 | ✅ **已完成**（2026-07-19） |
| 3 | 缓存统一 / 删除 data-attr 去重 | 废除零散缓存 | `asset.ts` 仅 5 行，无任何 data-attr 去重逻辑 | ✅ **已完成** |
| 4 | 菜单一次构建 + diff 更新 | 菜单建一次，快捷键变更只更新 accelerator | `menu.rs:200` `update_menu_shortcuts` 已只 set_accelerator | ✅ **已完成** |
| 5 | 拖拽事件单例 + 前端分发 | 统一一个 Tauri 订阅，前端按 src 分发 | `events.ts:31` 已有 `sharedUnlisten` 单例订阅；**已修复**：`activeDragDropHandler` 从单值改为 `Set<DragDropHandler>`，多 handler 广播式分发，不再互斥覆盖 | ✅ **已完成**（2026-07-19） |
| 6 | 默认关闭自动更新 | 启动不触发网络请求 | `updater.rs` 注释明确“仅手动触发” | ✅ **已完成** |

**关键结论**（2026-07-19 摸底后更新）：
- V1 已自发吸收 V2 的**绝大部分**思想。
- 真正待实施 **0 项**。
- 阶段 1（图片 IPC 合并）**已完成**（2026-07-19）。
- 阶段 2（拖拽单例互斥覆盖 bug）**已完成**（2026-07-19）：`activeDragDropHandler` 改为 `Set`，多 handler 广播分发。
- 阶段 3（设置分级）**已无需做**。

---

## 2. 真正待实施的范围(节流后)

### A. 图片 IPC 合并 🔶
- **目标**:新增 Rust 命令 `resolve_image_display(document_path, storage_dir, src) -> asset:// URL`,内部完成路径判别 + `canonicalize` + `authorize` + 返回 URL。
- **前端**:`asset.ts` / `document.ts` / 图片导入 / 剪贴板保存 统一走单命令,去掉 `authorize_image_asset` 的显式调用。
- **收益**:图片粘贴/拖入/打开链路少一次 IPC 往返,前端代码更简单。
- **风险**:中(涉及 Rust 命令 + 多个前端调用点,需保证路径判别逻辑与现有 `authorize_image_asset` 行为一致)。

### B. 拖拽事件单例 🔶
- **目标**:只注册一个 Tauri `subscribeDragDrop`,前端按 `src` 分发:图片 → 插入;`.md` → 打开新窗口。
- **前提**:阶段 0 需先确认 V1 当前是否真有 3 处订阅,以及各自职责。
- **收益**:消除重复订阅导致的竞态/重复处理。
- **风险**:低(纯前端事件分发重构)。

### C. 设置分级加载 L1/L2(可选)🔶
- **目标**:`settings` store 的 `init()` 拆 `initL1()`(theme + imageStoragePath,启动必需)+ `initL2()`(其余异步)。
- **收益**:理论启动更快,但 V1 启动已快,**收益有限**,优先级最低。
- **风险**:低。

---

## 3. 实施阶段(按风险排序,每阶段有测试门)

### 阶段 0:现状摸底与测试基线
- **任务**:
  1. 确认拖拽 3 处订阅的真实代码位置与职责(`App.vue` / `MarkdownEditor.vue` / `useAppWindowSession`)。
  2. 确认 `settings` store 当前加载方式(是否全量同步)。
  3. 跑一次 `bun run test` 记录基线(当前 ~989 passed)。
- **交付**:本规划 §1 / §2 的"待确认"项全部坐实。
- **门**:无代码改动,仅调研。

### 阶段 1:图片 IPC 合并(🔶 中风险) ✅ 已完成 2026-07-19
- **已完成改动**:
  - `src-tauri/src/commands/document.rs`:新增 `resolve_image_display` 命令(复用 `validate_image_asset_path` + `asset_protocol_scope().allow_file()`),返回 `ImageAssetAuthorizationResult`(canonical path)。
  - `src-tauri/src/lib.rs`:注册新命令(第 19 个命令)。
  - `src/services/tauri/command-names.ts`:加 `resolveImageDisplay: 'resolve_image_display'`。
  - `src/services/tauri/document.ts`:加 `resolveImageDisplay()` 封装。
  - `src/components/Editor/MarkdownEditor.vue`:`setLocalSrcResolver` 从 5 行 if/else 简化到 1 行调用。
- **保留**:`authorize_image_asset` 命令保留(其他调用点传绝对路径,改与不改无区别)。
- **验收**:`vitest run` 964/964 全绿(2026-07-19)。
- **后续**:Rust 侧 `cargo test` 待用户环境验证(本机无 cargo)。

### 阶段 2:拖拽事件单例(🔶 低风险) ✅ 已完成 2026-07-19
- **根因**:`events.ts` 的 `activeDragDropHandler` 是单值变量,`subscribeDragDrop` 后注册的 handler 覆盖前者。导致 `useAppWindowSession`(处理 .md 文件打开)被 `MarkdownEditor.vue`(处理图片拖入)覆盖,.md 文件拖入静默失灵。
- **修复**:`activeDragDropHandler: DragDropHandler | null` → `activeDragDropHandlers: Set<DragDropHandler>`,事件广播给所有订阅者。
- **改动文件**:`src/services/tauri/events.ts`(单值 → Set)
- **验证**:`vitest run` 969/969 全绿(新增 5 个单测);`vue-tsc --noEmit` 通过。
- **手动验证待做**:.md 文件拖入→新窗口打开;图片拖入→插入编辑器;两者并行不冲突。

### 阶段 3:设置分级加载(🔶 可选,低风险)
- **前提**:阶段 0 确认 settings 加载为全量同步且确有可感知启动延迟时才做。
- **改动点**:`settings` store `init()` 拆 L1/L2。
- **验收门**:启动可见性无回归;主题/图片路径在窗口显示前已就绪。

### 阶段 4:收尾
- ✅ ~~把 `solo-v2/` 原型整体移入 `md-editor/.archive/`~~ → **已于 2026-07-19 完成**:关键文档备份到 `.archive/solo-v2-design/`(ARCHITECTURE.md + REVIEW.md + solo-v1-upgrade-roadmap.md + README.md),stub 代码已删。
- 把 `solo-v2-design/ARCHITECTURE.md` + `REVIEW.md` 复制到 `md-editor/docs/v2-design/` 作为参考设计(可选)。
- 更新 `docs/` 或 `AGENTS.md` 标注本次升级已完成的点。

---

## 4. 不在范围内(V2 明确"保持原样")

以下模块**本次升级一律不动**,理由同 V2 第 11 节:

| 模块 | 理由 |
|------|------|
| Tiptap 核心编辑器 | 依赖深,重写不值 |
| Markdown 解析器(`parser.ts` / `serializer.ts`) | 无性能问题,已做 CJK 优化,989 测试守着 |
| KaTeX / Mermaid 渲染 | 第三方库(mermaid 全黑 bug 已单独修,见记忆) |
| 导出渲染器 | 偶尔用,不影响核心 |
| window_state 插件 | Tauri 插件,启动读一次 size/position 没问题 |
| 主题系统 | 已做 theme-paint 优化,无冗余 |

---

## 5. 风险与回滚策略

| 风险 | 应对 |
|------|------|
| 图片 IPC 合并改错路径判别 | 阶段 1 单独 commit;保留旧 `authorize_image_asset` 命令至阶段 1 验证通过后再删 |
| 拖拽分发遗漏某场景 | 阶段 2 手动验证覆盖"图片 / .md / 非 md 文件"三类 |
| 设置分级导致主题闪烁 | 阶段 3 仅当阶段 0 确认有延迟才做;L1 必含 theme |
| 跨阶段改动纠缠 | 每阶段独立分支/commit,禁止阶段间代码混合 |
| 测试门失效 | 以 `bun run test` + `vue-tsc` 双门禁,任一不过不进下一阶段 |

---

## 6. 与目录整理的关系

本规划与"外层目录整理"是两件独立但协同的事:
- 目录整理(已在做):删外层垃圾、icons 工具链已删、`.archive/solo-v2-design/` 已完成归档(2026-07-19)。
- 本规划:在 V1 代码内部做架构优化。
- 协同点:阶段 4 的 v2 归档已完成,升级过程中如需参考原型代码,查 `.archive/solo-v2-design/` 即可。

---

## 附:V1 现状核实索引(供实施阶段 0 复核)

| 核实项 | 文件 | 行/证据 |
|--------|------|---------|
| 启动防黑闪 | `md-editor/src-tauri/src/lib.rs` | `startup_ready` 命令(26-52),前端渲染完才 `show()` |
| 自动更新手动 | `md-editor/src-tauri/src/updater.rs` | 注释"仅在用户手动检查更新时运行,零启动开销" |
| 菜单 diff | `md-editor/src-tauri/src/menu.rs` | `update_menu_shortcuts`(200-205)只 set_accelerator |
| 图片 authorize 命令 | `md-editor/src-tauri/src/lib.rs` | `authorize_image_asset` 注册(345) |
| 前端 asset 极简 | `md-editor/src/services/tauri/asset.ts` | 仅 5 行,无 data-attr |
| V2 设计蓝本 | `md-editor/md-editor/solo-v2/ARCHITECTURE.md` | 第 10 节改造顺序、第 11 节保持原样 |
