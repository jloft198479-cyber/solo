---
title: solo 项目工作手册
type: core
audience: agent
status: active
tags: [核心文档, 纪律, 导航, 文档地图]
summary: AI/开发者必读第一站：工作纪律、文档地图、SSOT 规范、历史经验沉淀
updates:
  [
    ARCHITECTURE.md,
    BUILD_GUIDE.md,
    docs/KNOWN-ISSUES.md,
    docs/INDEX.md,
    docs/project_rules：工作原则和纪律.md,
  ]
---

# solo 项目工作手册

> 给 AI 和开发者的快速入门 + 纪律约束 + 文档地图。

---

## 项目一句话

solo 是一个 **Tauri v2 桌面端 Markdown 编辑器**（Vue 3 + TipTap + Rust），纯本地、无后端、单文件编辑。

## 工作纪律（不可违反）

> 工作原则与执行纪律（通用底线，不可违反）见 `docs/project_rules：工作原则和纪律.md`（真理源）；本节只列 solo 项目特有的操作纪律与导航。

### 改代码前

- 先读实际代码行为，不以注释为准
- 确认影响范围：改了这个文件，还有哪些文件受影响？逐个检查

### 改 parser/serializer 后

1. `bun run test` — 所有 roundtrip 测试必须通过
2. `vue-tsc --noEmit` — 类型检查通过
3. `bun run build` — 前端构建通过

### 代码验证（多层自检）

- 改动完成前按 **函数 / 集成 / 用户 / 异常** 四层自检，并**跨端互验**（改后端必验前端，改前端必验后端）——完整框架见团队通用《技术规范》。
- solo 特有必做：
  - **Rust 改动必跑 `cargo check`**：本机缺 MSVC 时不能跳过，CI 是最终闸门（曾因本地跳过导致发版编译失败）。
  - 改 parser/serializer 必跑上节三步（roundtrip + 类型 + 构建）。
  - **退化安全**：任何加载/优化必有 fallback（字体、图片、主题切换等），不假设环境永远正常。

### 发版前（🛑 常见踩坑区）

1. **先升版本号**（3 个文件：[package.json](./package.json) / [Cargo.toml](./src-tauri/Cargo.toml) / [tauri.conf.json](./src-tauri/tauri.conf.json)）
2. **检查 `replaceAll`**：TS target ES2020，用 `.split().join()` 替代
3. 确认 tag 名与版本号一致（`v1.x.x`）
4. 完整流程见 [docs/RELEASE_PROCESS.md](./docs/RELEASE_PROCESS.md)

### 提交前

- 不要提交 secrets / key
- 不要提交 `node_modules` / `target`
- 先看 `git status` 再 commit

### 环境 / 依赖纪律（铁律）

- **绝不擅自下载、安装软件**：任何软件 / 依赖安装前先查本机是否已有（Rust 在 `M:\rust`、MSVC 在 `M:\VS` 等，复用不重装）；需安装须先获明确同意，且尽量装到非系统盘（如 `M:` 盘）。
- **信息更新要及时**：最新信息通过 wiki / 互链保持同步，陈旧无用信息及时清理；改动及时留记录、及时 `git` 提交。

### 经验沉淀（标注可复用）

> 通用纪律见 `docs/project_rules：工作原则和纪律.md` 二、执行纪律；以下为 solo 项目细化。

- 跑通的有效做法（无论源自别人验证还是自己验证），只要预判还会再用，就在收尾时标注可复用标签并归入分类记忆 / 技能库，方便下次检索复用。
- 重点标四类：跨任务通用模式、踩过的坑、项目特有约定、第三方库陷阱。
- 未验证的猜测不标——只有「看」到的、验证过的才配打标（连修多版都在「猜」原因的教训）。

## 文档管理规范（SSOT + DRY + L2 减文件）

> 目标：每件事只在一处写真版，别处只引用不复制，根除信息冗余、版本不一致与 AI 读取无效上下文。

### 一、单一真实源（SSOT）

- 每个事实只在一处写（真理源），别处只放「一句指向它的话 + 链接」，不抄内容。
- 已知真理源地图：技术栈/版本 → `ARCHITECTURE.md`；发版流程 → `docs/RELEASE_PROCESS.md`；bug 易发区 → `ARCHITECTURE.md §11`；问题排查 → `docs/debugging.md` + `docs/KNOWN-ISSUES.md`；文档索引 → `docs/INDEX.md`；版本历史 → `docs/CHANGELOG.md`；代码真相 → 以代码为准（不以注释/文档/记忆）。
- 代码层面的 SSOT 细则（命令名/定义/字体/主题等真理源）见 `ARCHITECTURE.md` §11.6。

### 二、不要重复自己（DRY）

- 信息拆成原子可复用内容，全局统一引用而非复制。
- 纯指针/索引类文件（无独家内容）应并入真理源后删除，不留空壳。
- 多语言 README（zh-CN/ja-JP/ko-KR）是必要本地化，不算冗余，保留。

### 三、L2 减文件纪律（实操）

1. 合并/删文件前，先确认独有价值内容已存在于真理源。
2. 先把所有引用它的链接改指真理源。
3. 再删文件。
4. 删后用「含隐藏目录的递归 grep」跑死链扫描，确认零孤儿引用。

- **两层受众区分**：人类文档（README / CONTRIBUTING / SECURITY / 多语言 README）保持可读、不碎片化；agent 文档（ARCHITECTURE / AGENTS / HANDOVER / docs/\*）可激进原子化以省 AI 上下文。
- **禁止为做「原子 include」引入构建工具/新脚本**（守「不擅自装软件」纪律）；Markdown 的 DRY 用链接引用实现，不引 preprocessor。

### 四、死链即 Bug

- 任何指向已删/已改名文件的链接都是 Bug，发现即修。
- 文档若与代码不符，以代码为准并更新文档（见 AGENTS 黄金法则 / CONTRIBUTING）。

### 五、改动即自查

- 每改一处，立刻复查语法、逻辑、交叉引用（死链）——不止改完才查。

### 六、frontmatter 标准（每份文档必带，AI 识别第一道门）

> 全仓库 markdown 文档（README 系列除外——它们是对外产品页）顶部必须有 YAML frontmatter，字段如下：

```yaml
---
title: 文档名（人类可读）
type: core | guide | principle | proposal | archive | product
audience: user | dev | agent | maintainer
status: active | proposal | archive | deprecated
tags: [主题标签，小写英文，逗号分隔]
summary: 一句话摘要（≤40 字，说明本文是什么、给谁用）
updates: [本文事实来源 / 联动对象——改这些代码或文档必须回查本文]
---
```

- `type` 取值：**core**（全项目真理源：ARCHITECTURE/BUILD_GUIDE/AGENTS/KNOWN-ISSUES/CHANGELOG/RELEASE_PROCESS/INDEX）· **guide**（指南/手册）· **principle**（原则/理念）· **proposal**（未执行提案）· **archive**（历史快照/归档）· **product**（对外产品导览）
- `audience`：**user**（终端用户）· **dev**（开发者）· **agent**（AI 代理）· **maintainer**（维护者/发布者）
- 标准定义真理源在本节；文档全量清单、每份的 tag/摘要见 [docs/INDEX.md](./docs/INDEX.md)。

### 七、文档联动纪律（每次修改必走，保证信息同步）

> 目标：改一处，牵一发动全身的文档自动跟上，不再出现"代码改了文档没改"。

1. **改代码前**：查目标文件相关的文档 frontmatter `updates` 字段——凡是 `updates` 里列了本文档/代码的，必须一起检查是否需要同步更新。
2. **改完跑死链扫描**：`grep -rn "<改动文件名>" 仓库 --include="*.md"`，确认所有引用仍然有效；删文件走 §三 L2 纪律（先改引用再删）。
3. **事实变化时**：更新对应文档 frontmatter 的 `status`（如 active→archive）与 `summary`，不硬撑过期内容。
4. **新增文档**：必须带完整 frontmatter + 在 `docs/INDEX.md` 登记一行 + 在本文档地图（如需）加一行。
5. **最小联动矩阵**（改 X 必查 Y）：

| 改什么                       | 必查/必改                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Tauri 命令（新增/改名/删除） | `src/services/tauri/command-names.ts`（命令名真理源）→ `ARCHITECTURE.md`（命令清单 22）→ `docs/HANDOVER.md` 真理源表 |
| 字体/主题/排版 CSS           | `ARCHITECTURE.md`（技术栈/目录）→ `docs/font-handling.md` → `docs/ui-typography-eval.md`                             |
| parser/serializer            | roundtrip 测试 + `docs/cjk-boundary.md`（CJK 边界）                                                                  |
| 发版相关（版本号/tag/CI）    | `CHANGELOG.md` → `docs/RELEASE_PROCESS.md` → `docs/PUBLISH_GUIDE.md` → `docs/发布流程科普*.md`                       |
| 设置项/面板                  | `docs/archive/settings-audit-report.md`（历史审计结论）→ `KNOWN-ISSUES.md`                                           |
| 版本号变更                   | `package.json` / `Cargo.toml` / `tauri.conf.json` 三处同步 → `CHANGELOG.md` → `docs/SECURITY.md`（当前版本字段）     |

---

## 文档地图

| 读者                  | 先读这个                                                 | 再看这个                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **新接手**            | [docs/HANDOVER.md](./docs/HANDOVER.md)                   | [AGENTS.md](./AGENTS.md) → [ARCHITECTURE.md](./ARCHITECTURE.md)                                                                                                                                                     |
| **找 bug / 定位问题** | [ARCHITECTURE.md §11](./ARCHITECTURE.md)（敏感区速查表） | [docs/KNOWN-ISSUES.md](./docs/KNOWN-ISSUES.md) → [docs/debugging.md](./docs/debugging.md)                                                                                                                           |
| **查技术决策**        | [.opencode/PROFILE.md](./.opencode/PROFILE.md)           | [ARCHITECTURE.md](./ARCHITECTURE.md)                                                                                                                                                                                |
| **改 CJK 边界**       | [docs/cjk-boundary.md](./docs/cjk-boundary.md)           | [src/components/Editor/tiptap/markdown/parser.ts](./src/components/Editor/tiptap/markdown/parser.ts) / [src/components/Editor/tiptap/markdown/serializer.ts](./src/components/Editor/tiptap/markdown/serializer.ts) |
| **发新版本**          | [docs/PLAYBOOK.md](./docs/PLAYBOOK.md)                   | [docs/RELEASE_PROCESS.md](./docs/RELEASE_PROCESS.md) → [.github/workflows/release.yml](./.github/workflows/release.yml)                                                                                             |
| **编译不通过**        | [BUILD_GUIDE.md](./BUILD_GUIDE.md) §7 故障排查           | [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)                                                                                                                                                                |
| **想贡献代码**        | [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)           | [docs/SECURITY.md](./docs/SECURITY.md) / [.github/](./.github/) 模板                                                                                                                                                |

### 快速链接

> 完整文档索引与术语表见 [docs/INDEX.md](./docs/INDEX.md)（唯一索引真理源，本文不再复述链接表）。

## 关键约束速查

- **TS target**: ES2020（禁止 `replaceAll`，用 `.split().join()` 替代）—— 编码纪律，详见 `tsconfig.json`
- **构建 / 测试 / 工具链版本 / 环境变量 / 编译命令**：以 [BUILD_GUIDE.md](./BUILD_GUIDE.md)（构建手册唯一真理源）为准，本文不重复罗列
- **技术栈与精确依赖版本**：以 [ARCHITECTURE.md §1](./ARCHITECTURE.md)（技术栈实测表）为准

## 积压待办

> 完整待办清单见 [docs/KNOWN-ISSUES.md §二](./docs/KNOWN-ISSUES.md)（真理源），本文不复述。
> agent 接手时请优先查看该清单，可主动认领修复。

当前待办（2026-08-14 更新）：

- **（已修复）打开含 Mermaid 的文档，未作任何修改却显示「未保存」**：交互门控方案已落地（2026-08-14），`onUpdate` 改为只有用户真实交互过才标脏，免疫插件后台事务。详情见 [KNOWN-ISSUES.md §一 #8](./docs/KNOWN-ISSUES.md)。**注**：A1 重构后脏态统一由 `file.ts` 的 `syncEditedContent()` 语义比对抗源（不再依赖 `markUserEdit`/交互门控），旧方案已成历史实现——现状以 [ARCHITECTURE.md §7.1/§11.1](./ARCHITECTURE.md) 为准。
- **字体 @font-face 优化的 prod CSP 验证**：CSS @font-face + asset URL 方案已落地（2026-08-14），有 `readFontBytes` fallback 兜底，但 prod CSP 验证待发版时做。

## 历史经验沉淀

- **mermaid 全黑问题**（2026-07-19）：`securityLevel: 'strict'` 导致 DOMPurify 删主题 `<style>`，改为 `'loose'`。本地优先单文件编辑器，loose 安全风险可忽略。
- **拖拽单例互斥覆盖 bug**（2026-07-19）：[src/services/tauri/events.ts](./src/services/tauri/events.ts) 的 `activeDragDropHandler` 是单值变量，后注册覆盖前者。改为 `Set<DragDropHandler>` 广播分发。
- **图片 IPC 合并**（2026-07-19）：新增 `resolve_image_display` 命令，把“路径判别 + authorize”合并为单命令，[src/components/Editor/MarkdownEditor.vue](./src/components/Editor/MarkdownEditor.vue) 调用点从 5 行 if/else 简化为 1 行。
- **代码审查修复**（2026-07-20）：4 处问题修复，全部源自对 `7b8687d` 提交的审查。
  1. `main.rs` 启动清理 EBWebView 目录改回只删 >24h 残留——原实现无条件删全部，双开 solo 时新进程会删掉老进程活动目录导致崩溃。**教训**：清理「按进程隔离」的资源时，必须考虑多进程并存场景，staleness 守卫比「全删」更安全。
  2. `resolve_image_display` 恢复 `assets/` 守卫——合并时丢了「src 以 assets/ 开头走文档目录」的判断，导致设了 `imageStoragePath` 后 `![x](assets/y.png)` 解析错位。**教训**：合并重构时，原有守卫规则必须列出对照清单，逐条确认新逻辑覆盖；判别规则集中在 Rust 侧（真理源），前端不重复实现。
  3. `resolve_image_display` 补 containment 校验——相对路径必须落在基目录之内，防 `../../secret.png` 越权。**教训**：本地优先不等于无边界，路径授权接口都该断言 `starts_with(允许基目录)`；绝对路径放行是本地编辑器的合法用例（用户引用 D:/photos 这类外部图片）。
  4. `events.ts` 广播加 try/catch + Set 迭代复制——单个 handler 抛错会断后续广播。**教训**：广播/分发模式必加 per-handler try/catch，迭代时复制快照防「handler 在回调里动订阅集合」的边缘情况。
- **Slash 命令中文场景失效**（2026-07-20）：用户报告「`/` 命令发挥不出作用」，核实属实。根因是 TipTap Suggestion 的 `allowedPrefixes` 默认值 `[' ']`，只允许 `/` 出现在空格或行首之后——中文没有词间空格习惯，用户在「你好」或「hello」后敲 `/` 完全无反应。修复：`SlashCommands.configure` 显式传 `allowedPrefixes: null`。**教训**：接入第三方库时，对默认值要做「中文场景适用性」评估——很多库的默认假设（如「词间空格」「ASCII 标点」）对中文不成立。回归测试直接测库导出的 `findSuggestionMatch` 函数，避免起完整 editor 的复杂 mock。
- **Mermaid / 数学公式块无法删除**（2026-07-20）：用户反馈「创建了 mermaid 块但不知道怎么删除」。根因是两个块都用 `isolating: true` + `contentDOM: undefined`（为支持「点击进入 textarea 编辑」交互），副作用是标准 Backspace 在块外不删块、块内 textarea 又是原生 DOM——整个块没有删除入口。修复：textarea 内加 `Mod+Backspace` 快捷键删除整块，placeholder 同步提示。**教训**：选 `isolating: true` 这种「光标隔离」设计时，必须同步提供「显式删除入口」——快捷键、按钮或菜单任选其一，否则用户会陷入「能创建能创建不能删除」的死胡同。对比 code-block 用非 isolating + contentDOM=`<code>`，光标能进出、空行 Backspace 自然删块，没有这个问题。
- **体感丝滑优化（基于 workbuddy 方案审核后执行）**（2026-07-20）：
  1. **统一动效 token**（`main.css`）：把分散的 `0.15s ease` / `0.2s ease` / `0.25s ease` 收敛为 `--motion-fast: 120ms` / `--motion-base: 200ms` + `--ease-out: cubic-bezier(.2,.8,.2,1)`。**教训**：丝滑的核心不是「动效多」而是「一致」——Linear / Raycast 用同一时长、同一曲线贯穿全局，比「这儿弹那儿滑」的不一致感更跟手。统一 token 后再加任何交互都顺其自然用 token，不会出现新的偏差。
  2. **乐观保存**（`useDocumentSession.ts`）：原实现等 IPC 返回才清脏标，状态栏有可感知滞后。改为进 `saveCurrentDocument` 主分支后立即 `markSaved()`，IPC 飞行期间用户继续编辑则后续 `syncEditedContent` 会重新标脏，成功后保留脏标仅更新 mtime；失败/conflict取消都回滚。**教训**：业界共识（Notion / Linear / Google Docs）「体感来自开始而非结束」——本地原子写几乎不败，乐观 UI 比真快更影响体感。但要补全所有失败回滚路径，包括 conflict 弹框取消这个中间态。（注：原文 `hasUserEdit=true` 为 A1 前表述，A1 后由 `syncEditedContent` 语义比对接管标脏，思路不变。）
  3. **搜索/跳转命中脉冲**（`useEditorSearch.ts` 的 `pulseJumpTarget`）：跳转后给目标加 300ms 背景淡入淡出动画。**教训**：跳转后明确的视觉反馈比静默滚动更让用户「知道到这儿了」——这是 UX 研究硬结论。同一元素连续跳转要强制重排（`void el.offsetWidth`）让动画能再次触发，否则浏览器会跳过重复 animation。
  4. **主题/字体切换内容 crossfade**（`themes/manager.ts` 的 `triggerContentCrossfade`）：CSS 变量重绘会让内容「闪一下」，给 `.mk-editor` 加 200ms opacity 0.6→1 淡入抹平闪烁。**教训**：crossfade 不完全 opacity=0→1，从 0.6 起避免用户失去位置感（Notion / Linear 的做法）。helper 放在真理源模块（manager.ts）export，避免跨模块依赖反向。
  5. **FontFace `display:'swap'`**（`fontLoader.ts`）：JS API `new FontFace(family, url)` 加第三参数 `{display:'swap'}`。**教训**：FontFace JS API 不吃 CSS `@font-face` 的 `font-display` 属性——必须通过构造函数第三参数控制。显式声明意图比依赖默认行为更清晰。
  6. **`prefers-reduced-motion`**（`main.css`）：全局把动画时长降到 0.01ms。**教训**：动效优化时必须同步加无障碍底线，不能只考虑视觉而忽略用户的「减少动效」系统偏好（WCAG 标准）。
- **首次启动弹窗 bug 修复不完整（v1.2.26 → Unreleased）**：v1.2.26 曾修过"启动时目标文件不存在弹错误框"，在 `handleOpenPayload` 加了 os error 2 静默跳过逻辑，但 `loadDocumentFromPath` 的内层 catch 先 `await message(...)` 弹窗并 `return false`，错误被吃掉传不到外层 try/catch，静默逻辑形同虚设。修复：给 `loadDocumentFromPath` / `openDocumentWithPrompt` / `handleOpenFile` 加 `silent` 参数，启动链路传 `true` 让错误透传给外层处理。**教训**：错误处理要分层——内层函数不知道调用场景（启动 vs 用户主动），不应该擅自决定是否弹窗；应该把错误抛给外层，由知道场景的调用方决定。修复 bug 时要追完整调用链，确认每一层的行为与预期一致，不能只改最外层。**复查阶段发现两个关键问题**：①`handleOpenPayload` 用 `String(err)` 转换错误对象，但 `invokeCommand` 抛的是 `TauriAppError` 对象 `{code, message}`，`String()` 得到 `"[object Object]"`，正则无法匹配 os error 2——**教训**：错误对象经过 `normalizeTauriError` 包装后是对象不是字符串，提取 message 必须用 `.message` 属性而非 `String()`；②非 os error 2 的错误 `throw err` 会中断 setup 函数，导致 `setupDragDrop()` 不执行、拖拽功能失效——**教训**：启动流程中的错误处理不能 throw 中断后续步骤，应该弹窗提示用户但不 throw，让 setup 继续执行。
- **字体下载回归：注释与代码不符 + reqwest 缺 system-proxy**（Unreleased）：v1.2.28 的 `font.rs` 注释说"无扩展名导致 Content-Type 推断失败"，但查 v1.2.27 源码发现用 family（无扩展名）命名缓存文件**能正常加载**，反证了注释的错误。真正原因是 v1.2.28 改了缓存 key 命名规则导致旧缓存失效 + reqwest 配 `rustls-tls` 未开 `system-proxy` feature 不读系统代理。**教训**：写注释/CHANGELOG 时要核实历史代码行为，不能凭推测写"原因"；`reqwest` 配 `default-features = false` + `rustls-tls` 时，`system-proxy` feature 不在 rustls-tls 里自动开启，需要显式加——否则 rustls-tls 既不读系统证书也不读系统代理，网络受限环境必败。
- **SSOT 违规：`read_clipboard_html` 未登记命令名**（v1.2.29）：v1.2.27 新增 `read_clipboard_html` 命令时，`clipboard.ts` 用硬编码字符串 `invoke('read_clipboard_html')` 而非通过 `command-names.ts` 真理源。**教训**：新增 Rust 命令时，必须同步更新 `command-names.ts`（命令名真理源）+ `client.ts` 的 `invokeCommand` 调用方式——不能只在 Rust 侧注册命令就完事，前端调用侧也要走统一入口。
- **字体不生效根因：CSP `font-src` 漏 `asset:` 协议**（v1.2.30）：v1.2.13 把字体加载从 IndexedDB + `blob:` URL 改为 `convertFileSrc` + asset.localhost URL，同时给 `assetProtocol.scope` 加了 font-cache 目录，但**忘了同步更新 CSP 的 `font-src`**——`img-src` 一直有 `asset:`，`font-src` 从第一天起就漏了。结果：首次下载用 `blob:` URL（CSP 允许）能临时生效，但重启读缓存用 `convertFileSrc` 转成 asset.localhost URL 时被 CSP 拦截，字体永不生效。v1.2.29 修了 reqwest system-proxy / 旧缓存兼容 / silent 参数透传等周边问题，但都没碰到核心；v1.2.30 才真正修复根因。**教训**：架构切换（加载方式变更）时必须同步审查 CSP / assetProtocol scope / 命令名 SSOT 等**配置类真理源**——不能只改代码不改配置。CSP 的 `font-src` / `img-src` / `connect-src` 等协议白名单是「资源能加载的最后一道闸门」，代码改了加载方式，CSP 没改等于白改。审查这类问题时要从第一天起查 git log，不能只看近期改动——本 bug 从 v1.2.13 一直潜伏到 v1.2.30，跨越 17 个版本。
- **SSOT 违规复发：`detect_proxy_for_update` 命令名硬编码**（v1.2.30）：`App.vue` 和 `AboutSettingsPanel.vue` 用 `invoke('detect_proxy_for_update')` 直接 invoke，违反「前端不直接 invoke」铁律。与 v1.2.27 的 `read_clipboard_html` 是**同类 bug 复发**。**教训**：新增 Rust 命令后必须立即 grep 全代码库 `invoke('` 字符串，确认没有遗漏的硬编码调用点；CI 可加一条 lint 规则禁止 `from '@tauri-apps/api/core'` 的 `invoke` 直接调用（白名单 `invokeCommand`）。
- **打印时 focus-mode 会丢段落**（v1.2.30）：focus mode 开着时打印，未聚焦段落 `opacity: 0.22` 仍生效，打印结果几乎丢段落——这是数据丢失级别 bug。**教训**：`@media print` 必须显式覆盖所有运行时视觉状态类（focus-mode dimmed、selected、editing 等），不能假设打印时这些 class 不存在。打印样式是「最后一公里」，必须独立测试 focus mode 开 / 关两种场景下的打印输出。
- **排版设计系统性审查**（v1.2.30）：对照 iA Writer / Obsidian / Typora 做全面排版审查，发现 line-height 过松（1.9）、letter-spacing 正值反潮流（0.02em）、标题字距反人类（h1 0.04em 应为负值）、容器偏宽（760px 超过 CJK 黄金行宽）、段落间距偏紧（0.75em）等问题。**教训**：排版参数不能凭感觉定，要对照行业天花板产品的实测数据——iA Writer 的 640px / 18px / line-height 1.5 是基于阅读光学研究的硬结论，不是审美随意值。CJK 场景下 line-height 可略松（1.6-1.7），但不应超过 1.8；letter-spacing 应为 0 或负值（字体设计师已做视觉间距调整，正值等于二次放宽）。设计审查要分维度：节奏（字号差值均匀递减）/ 对比（h5 不应小于正文）/ 惯例（marker 用 muted 色、blockquote italic、图片无 border）三个维度缺一不可。
- **字体不生效真正根因：CSP ≠ CORS，FontFace API 强制走 CORS**（v1.2.32）：v1.2.30 修了 CSP `font-src` 漏 `asset:` 协议（只解决「是否允许发起请求」），但没解决 FontFace API 自身的 CORS 限制（「是否允许读取响应」）。**两道闸门是独立的**：CSP 放行请求不代表 CORS 放行响应。`new FontFace(family, "url('http://asset.localhost/...')")` 的 `fontFace.load()` **默认强制走 CORS 模式**，而 Tauri asset protocol 不返回 `Access-Control-Allow-Origin` 头，字体加载被拦截。**为什么图片正常但字体失败**：图片用 `<img src="assetUrl">`（不走 CORS），字体用 `new FontFace`（强制走 CORS）。修复：新增 `read_font_bytes` Rust 命令读取字体字节，前端用 `blob:` URL 加载 FontFace——blob URL 同源，完全绕过 CORS。三条加载路径（readCache / downloadAndCache 主路径 / fallback）全部改用 blob URL。**教训**：CSP 和 CORS 是两道独立的闸门，修了 CSP 不等于修了 CORS。FontFace API 默认走 CORS 模式，用 asset URL 加载字体必然失败，必须用 blob URL 绕过。排查「资源加载失败」时，先区分资源类型——`<img>`/`<script>`/`<link>` 是普通加载（不走 CORS），`fetch()`/`FontFace`/`XMLHttpRequest` 强制走 CORS；CORS 资源失败时检查响应头有没有 `Access-Control-Allow-Origin`，没有就用 blob URL 绕过。**更深层教训**：连续两版（v1.2.29 修 system-proxy / v1.2.30 修 CSP）都没修对根因，因为都在「猜」失败原因而非「看」失败原因——正确做法是先在 DevTools Network 面板看 FontFace 请求的实际报错（CORS 错误会有明确提示），再定位修复方向，而不是从代码层面推测可能的原因。
- **新增 Rust 命令必须同步三处**（v1.2.32）：v1.2.31 新增 `read_font_bytes` 命令时，只改了 `font.rs`（定义函数）和 `lib.rs`（`generate_handler!` 注册），**漏了 `commands/mod.rs` 的 re-export**，导致 CI cargo check 报 `cannot find function read_font_bytes in this scope` + 连锁触发 never type fallback 错误，v1.2.31 编译失败未发布。**教训**：新增 Rust 命令时三处缺一不可——①`commands/xxx.rs` 定义 `pub async fn`；②`commands/mod.rs` 的 `pub use xxx::{...}` re-export 列表加函数名；③`lib.rs` 的 `generate_handler!` 注册。本次还暴露一个发版流程漏洞：本地因缺 MSVC 环境没真正跑 `cargo check`，误判"已验证通过"——发版前必须真正跑通 `cargo check`，不能因本地环境受限就跳过 Rust 编译验证，CI 是最终闸门。
- **FontFace API vs CSS @font-face：blob URL 绕过 CORS 仍有边缘问题**（v1.2.33）：v1.2.32 用 blob URL 绕过 FontFace API 的 CORS 限制，但 dev 模式实测仍失败——`FontFace.load()` 报 `NetworkError`，且 IPC 传输 `Vec<u8>` 有破坏字体数据的风险（`OTS parsing error`）。**根本原因**：JavaScript `FontFace API` 强制走 CORS 模式，无论 asset URL 还是 blob URL 都有边缘问题；IPC 传输 1.4MB 字节可能被 JSON 序列化破坏。**最终修复**：改用 CSS `@font-face { src: url("assetUrl") }` 注入 `<style>` 标签——CSS `@font-face` 的 `url()` 加载字体**不走 CORS**（W3C 标准行为，和 `<img src>` 一样），用 `document.fonts.load()` 检测加载是否成功。同时移除被 GitHub CDN CORS 拦截的前端 `fetch` 下载路径，直接用 Rust `fetch_font_data` 下载落盘。**教训**：`FontFace API`（JavaScript）和 `@font-face`（CSS）是两套机制——前者强制走 CORS，后者不走。Tauri asset protocol 不返回 CORS 头，`FontFace API` 必然失败，**必须用 CSS `@font-face` 注入**。v1.2.29→v1.2.30→v1.2.32→v1.2.33 连修四版才修对，根因是每次都在「猜」失败原因（network-proxy → CSP → CORS → blob URL）而非「看」实际报错。正确做法：**先在 DevTools Console 加诊断日志看真实报错**，再定位修复方向。字体加载这类问题，第一步就应该试 CSS @font-face 注入（最简单、不走 CORS），而不是绕路用 FontFace API + blob URL。
- **字体不生效终极根因：GitHub release 字体文件被截断**（v1.2.33 深度排查）：v1.2.29→v1.2.33 四版分别修了 system-proxy / CSP / CORS / FontFace API，代码层面都修对了，但字体始终不生效。最终通过 PowerShell 大端序解析 OTF/TTF 表目录发现：GitHub release `fonts-v1` 的 5 个字体文件全部只有 1.4 MB 左右，但内部表（glyf、CFF、GPOS 等）的 offset 指向 800 万字节位置——**文件被截断到只剩头部 + 表目录，表数据全部丢失**。CJK 字体正常应为 8-15 MB。**这才是四版都没修对的终极根因**——文件本身就是坏的，再怎么修加载逻辑也没用。**教训**：遇到「资源加载失败」问题，**第一步应该验证资源本身是否完整**（检查文件大小、magic bytes、表目录 offset+length ≤ 文件大小），而不是从加载机制上猜原因。验证字体完整性：OTF 用 `OTTO` magic，TTF 用 `00 01 00 00` magic；表目录在偏移量 12 开始，每 16 字节一张表（4 字节 tag + 4 字节 checksum + 4 字节 offset + 4 字节 length），所有表 offset+length 必须 ≤ 文件大小。
- **mermaid 生产构建纯黑：Tauri CSP nonce + manualChunks 两个问题叠加**（v1.2.36→v1.2.38 三版才修对）：
  1. **v1.2.36**：修了主题切换残留黑块（NodeView 登记遍历重渲）+ subgraph 标题不可见（themeVariables）+ 放大 lightbox + 清除按钮可见性。但这些都是 dev 能复现的问题，**没碰 prod 黑块的根因**。
  2. **v1.2.37**：修了 `manualChunks` 用 `id.includes('mermaid')` 强制合并 mermaid 内部懒加载 chunk 的问题——这是真问题（打坏 mermaid 11 的 `await import()` 链路），**但不是 prod 黑块的根因**。dev 正常 prod 黑依旧。
  3. **v1.2.38 才修对真正根因**：Tauri 在 `tauri build` 时自动往 CSP 的 `style-src` 注入随机 nonce。按浏览器规范，一旦 `style-src` 含 nonce，`'unsafe-inline'` 被忽略。mermaid `render()` 时通过 innerHTML 注入 `<style>` 到 SVG，没带 nonce → 被 CSP 静默拦截 → 所有形状回退到黑色填充。
     **为什么三版才修对**：① **Tauri dev 不附加 CSP，prod 才附加**——`tauri dev` 走 localhost 不附加 CSP，`tauri build` 走 `tauri://localhost` 才附加含 nonce 的 CSP。所以 dev 永远验证不了 CSP 问题，这是"dev 正常 prod 黑"的根本机制。② **又在猜原因而非看报错**——1.2.37 修 manualChunks 是基于"chunk 加载失败"的推测，没在 prod 开 DevTools 看 Console。CSP 违规会有明确报错，看了直接就能定位。AGENTS.md 已有"连续两版都没修对因为都在猜"的教训（字体问题），本次又犯一次。
     **教训**：① **CSP 相关问题不能用 `tauri dev` 验证**，必须 `tauri build` 后跑真实 release 二进制。② **任何"运行时 innerHTML 注入 `<style>`"的库**（mermaid/lit/KaTeX 等）在 Tauri prod 下都会踩 CSP nonce 的坑，解法是 `dangerousDisableAssetCspModification: ["style-src"]`（`script-src` 的 nonce 保留，XSS 防护不降级）。③ **prod-only 问题必须在 prod 开 DevTools 看真实报错**，不能靠猜。证据：frenetik.mdlite PR #68（完全相同现象）+ Tauri 官方 issue #3831（lit 库同类问题，促成了 `dangerousDisableAssetCspModification` 选项）+ Tauri CSP 文档。
- **性能优化批量修复（2026-08-14）**：对照两轮排查出的 12 项性能问题清单逐项落地，9 项已修复、3 项经评估跳过。完整方案见 git 历史（性能优化修复方案文档已退役删除，9 项修复均已落地）。
  1. **#1 Mermaid 误标脏 → 交互门控（已被 A1 取代）**：早期 `onUpdate` 里 `markUserEdit()` 无条件标脏，Mermaid 异步渲染等插件后台事务触发误标。当时的修复：文档加载/切换时武装门控（`userInteracted = false`），capture 阶段监听 keydown/pointerdown/beforeinput/compositionstart，首个用户事件放行后才允许标脏。**教训**：不去纠结后台事务从哪来，换个判定标准（用户是否真实交互过）更彻底——对触发源免疫，不依赖定位那个"幽灵事务"。KNOWN-ISSUES 给的修法①（判断 preventUpdate meta）无效，因为 TipTap 在 emit update 之前已过滤掉带 preventUpdate 的事务，`onUpdate` 回调里拿到的事务必然不带 preventUpdate。
     **现状（A1 重构）**：脏态已统一改由 `file.ts::syncEditedContent()` 语义比对（规范化尾换行后比较）作为唯一真相源，`markUserEdit`/`userInteracted` 交互门控均已废弃——A1 同时根治漏标脏（拖入图片）与误标脏（Mermaid 后台事务），比交互门控更彻底。详见 [ARCHITECTURE.md §7.1/§11.1](./ARCHITECTURE.md)。
  2. **#2 Rust 同步命令阻塞 → async + spawn_blocking**：9 个同步命令（open/save/rename/import/clipboard/authorize/resolve）全在 Tauri 主线程跑，大文件 IO 卡死 UI。修复：全部改 `async fn`，IO 逻辑进 `tauri::async_runtime::spawn_blocking`，校验逻辑（trim/非法字符/stem 剥离/parse_data_url）留主线程，9 个测试改 `#[tokio::test]`。**教训**：Tauri 同步命令跑在主线程，异步命令才跑在 tokio 线程池——大文件读写必须异步化；`generate_handler!` 和 `commands/mod.rs` re-export 不用改（函数名不变，Tauri 自动识别 async）。
  3. **#3 markdown-input 双扫 → WeakMap 缓存**：`view.update` 和 `appendTransaction` 各调一次 `scanHeadings`（全树 `descendants`），同一 doc 扫两遍。修复：`WeakMap<PMNode, Result>` 缓存，`findPendingHeading` 委托 `scanHeadings(doc).pendingHeading` 共享缓存。**教训**：ProseMirror doc 是不可变的，doc 引用没变 = 内容没变，WeakMap 缓存绝对安全——这跟大纲的 `WeakMap<EditorState>` 缓存是同一个成熟套路。
  4. **#4 远程图片 base64 往返 → Rust 落盘 + asset URL**：`fetch_remote_image` 下载后 base64 编码走 IPC，前端 `atob` 逐字符解码建 Blob，10MB 图片来回搬 ~23MB。修复：Rust 下载后写入 `$APPLOCALDATA/remote-image-cache/{url_hash}.{ext}`，`allow_file` 授权 scope，只回传路径；前端 `toAssetUrl(filePath)` 转 asset URL；`tauri.conf.json` scope 加 `"$APPLOCALDATA/remote-image-cache/*"`；`mime_to_extension` 改 `pub(crate)` 供 `image.rs` 复用。**教训**：IPC 是窄门，大块二进制数据应落盘后传路径让浏览器内核自己读，不要走 IPC 传字节。
  5. **#5 字体 IPC 传字节 → CSS @font-face + asset URL**：`readFontBytes` 走 IPC 传 8-15MB 字体字节，前端 `new FontFace` 加载。修复：新增 `registerFontViaCss(family, cachedPath)` 注入 `<style>@font-face{src:url(assetUrl)}`，`readCache` 优先走此路径，失败回退 `readFontBytes`。**教训**：CSS `@font-face` 的 `url()` 不走 CORS（W3C 标准，v1.2.33 血泪教训）；FontFace API 强制走 CORS，Tauri asset protocol 不返回 CORS 头所以必败。字体有"连修四版才修对"历史，必须保留 fallback + prod 验证 CSP。
  6. **#6 resolve_image_display 无缓存 → Map 缓存**：每张本地图片每次渲染都重新 IPC + canonicalize + metadata + allow_file。修复：前端 `Map<string, string>` 缓存，key 为 `${src}|${docPath}|${storagePath}`，文件切换和 storagePath 变化分别 watch 清空。**教训**：`allow_file` 幂等无害，缓存只省 IPC 往返和磁盘校验；缓存失效条件要拆成独立 watch（文件切换 / 存储路径变化），而非合并成一个——虽然合并写法更短，但两个 watch 各司其职更清晰。
  7. **#7 字数统计全文拷贝 → descendants 逐节点计数**：`editor.state.doc.textContent` 拼全文大字符串 + `replace` 再生成一个。修复：`descendants` 遍历文本节点逐段 `replace(/\s+/g, '').length` 累加。**教训**：不要为了统计生成全文大字符串——遍历文本节点逐段处理，内存峰值从 O(全文 × 2) 降到 O(最长单节点)。
  8. **#8 OutlinePanel scroll-spy O(n) → 二分查找**：每帧 `for` 循环遍历所有标题做 `getBoundingClientRect`。修复：二分查找（标题按文档序排列，`top` 单调），O(n) → O(log n)。**教训**：有序数据用二分是基本功——`getBoundingClientRect` 触发样式计算，调用次数从每帧 n 次降到 log n 次。
  9. **#9 releaseRemoteImageBlobs 未接线 → onBeforeUnmount 调用**：函数定义并导出但从未被调用。修复：`onBeforeUnmount` 里加一行 `releaseRemoteImageBlobs()`。**教训**：定义了清理函数就要接线，否则等于没写——好在有 50MB LRU 上限兜底不是无界泄漏。
  10. **#10/#11/#12 跳过**：① lowlight 17 种语言静态注册——需先量化首包占比再决定；② 焦点模式 decoration 重建——`forEach` 只遍历顶层块开销极小，改造插件结构风险大于收益；③ `findCommandByShortcut` 线性查找——几十条命令微秒级开销可忽略。**教训**：不是所有"理论缺陷"都值得修——开销极小的路径优化不如把精力花在高频高开销的路径上；遵循「不过度优化」纪律，先量化再决定。
- **🚫 丝滑体验优化 P0-P3（已主动舍弃，勿重新提交）**：commit `bb76c25`（P0 动效 token 统一）+ `612ddb5`（P0-P3 丝滑体验）+ `828b18c`（审查修复），共 25 文件 816 行。已被 `git reset --hard` 回退到 `9782c0d`，三个 commit 以 dangling 状态留在 reflog 中。**舍弃原因**：workbuddy 审查发现核心方案 `useSmoothScroll.ts` 用 JS 拦截原生 wheel 事件做 lerp 插值，导致滚动体验倒退（比原生更卡顿）——这是负优化，不是优化不充分。其余改动（统一动效 token、搜索脉冲、crossfade 等）本身无问题，但与 `useSmoothScroll.ts` 绑在同一批 commit 中，整体回退。**后续处理**：`87f8542` 已单独 cherry-pick 了动效 token 统一中安全的部分（0.15s → `var(--motion-fast)`）；`useSmoothScroll.ts` 的逻辑完整且有参考价值，若要救回需连带 `main.css` 中的 token 定义一起处理，且必须**放弃 JS 拦截 wheel 方案**，改用 CSS `scroll-behavior: smooth` 或其他原生方案。**⚠️ 任何 Agent 看到 reflog 中这三个 commit，不要误以为是"未提交的待办工作"而重新提交。**

## 沟通风格

- 说人话，言简意赅
- 实事求是，不臆想不编造
- 先想后做，共识前置
- 完成自检再通报
- 被批评后经验必须沉淀到文档
