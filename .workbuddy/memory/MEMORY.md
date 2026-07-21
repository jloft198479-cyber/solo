# 项目记忆 - solo 项目

> 本文档记录项目的核心原则、关键决策和历史经验。每次会话开始时读取此文档。

---

## 核心文档

### 1. 架构原则 (`architecture.md`)

**文件路径**: `F:/fzz-Project/md-editor/architecture.md`

#### 核心原则

1. **真理源自一处，全局引用**
   - 配置、状态、常量只有一份，其他地方只引用
   - 状态管理中心唯一，单向数据流

2. **高内聚、低耦合**
   - 一个文件只做一件事
   - 组件不直接操作其他组件的 DOM
   - 控制器不直接知道视图的细节，视图不直接调 API

3. **模块化、组件化、原子化**
   - UI 组件可独立渲染、独立销毁（有 `init/destroy`）
   - 工具函数是纯函数，不依赖全局状态
   - 功能单元可单独测试

4. **更轻、更快、更强**
   - 不引入不必要的依赖
   - DOM 操作节流（requestAnimationFrame）
   - 错误边界保护，一处崩溃不影响全局

5. **重结构，轻代码**
   - 好的结构比多的代码重要十倍
   - 先搭架子，再填内容
   - 拆分优于堆砌

6. **资源节约原则**
   - 产品设计要替用户节约资源——省内存、省 CPU、省磁盘
   - 功能完成 ≠ 任务完成，资源消耗也是质量指标
   - 堆砌代码 = 浪费用户资源 = 工作不合格
   - 重复逻辑必须合并，双重处理必须消除

7. **决策阶梯**（写代码前必须过）
   - 1. 这东西需要存在吗？（YAGNI）
   - 2. 标准库/运行时能做吗？
   - 3. 平台原生功能能覆盖吗？
   - 4. 已安装的依赖能解决吗？
   - 5. 能一行搞定吗？
   - 6. 以上都不行 → 写最少能工作的代码

8. **绝不硬编码**
   - 任何数据、配置、路径都不允许写死在代码中
   - 所有动态内容必须从单一数据源派生

9. **契约设计**
   - 模块间交互必须通过明确契约（接口签名、事件格式、数据结构）
   - 契约一旦确定，消费者只依赖契约，不依赖实现细节

10. **退化安全**
    - 任何外部依赖都可能失败，**必须有 fallback**
    - 降级策略必须提前设计
    - 用户永远不应看到空白页面或无响应

11. **简化标记约定**
    - 当按决策阶梯做了刻意简化时，用 `simp:` 注释标记
    - 格式：`simp: <已知上限>, <升级触发条件>`

---

### 2. 项目工作原则 (`project_rules.md`)

**文件路径**: `F:/fzz-Project/md-editor/project_rules.md`

#### 一、工作原则

1. **实事求是**
   - 充分调研，以事实为基础
   - 不瞎蒙，不猜测——不确定的事情必须验证后再说
   - 读源码、读文档、读实际文件，不准凭空推断

2. **第一性原理**
   - 思考问题的本质，抓关键，不被表面现象迷惑
   - 从用户角度出发，问"用户到底要什么"，而非"技术上能做什么"

3. **最佳实践**
   - 务必结合成功实践，绝不闭门造车
   - 参考成熟开源项目的优秀架构

4. **策略大于行动**
   - 最佳策略远胜于反复琢磨细节
   - 先想清楚整体方案，再动手。方向对了，细节才会对
   - 想透再执行，不急着写代码

5. **结构性看问题**
   - 结构性思维才能换来极简操作
   - 先看全局依赖关系，再动局部代码

6. **取得共识再行动**
   - 任何改动前必须与用户沟通确认
   - **绝不允许"用户一说完就噼里啪啦敲代码"**

7. **分步骤行动**
   - 不要一次性完成所有工作
   - 每阶段完成后停下来，确认无误再继续
   - 每步都要复查验证

8. **消除理解偏差**
   - 动手前必须复述理解，确认与用户意图一致
   - 术语和概念必须精确对齐
   - 遇到模糊指令，先问清含义再行动
   - 读代码时以实际行为为准，不以注释或文档为准
   - 修改前先确认影响范围

9. **渐进实现**
   - 先跑通最小可用版本，再逐步增强
   - 每一步必须可独立验证
   - 不为假设的未来需求提前编码（YAGNI）
   - 功能分层：核心路径 → 错误处理 → 边界优化 → 体验打磨
   - 重构也是渐进的：先提取、再优化、最后删旧代码

#### 二、执行纪律

1. **搞清楚再执行**
   - 搞清楚指令、搞清楚问题、搞清楚影响范围再动手
   - 不理解的地方必须问，不准猜

2. **自检与验证**
   - 每改一处，立刻复查语法、逻辑、交叉引用
   - 修改完成后必须站在用户角度体验结果
   - 改了前端就刷新页面实测，不要假设"应该没问题"
   - **过度工程自检**：每次提交前问自己——这段代码有没有违反决策阶梯？

3. **任务不是结果，能用、好用才是结果**
   - 提交了代码 ≠ 完成了工作
   - 用户打不开、点不动、没反应 = 工作不合格
   - 每一步完成后必须站在用户角度实测

4. **沉淀经验**
   - 每次被批评后，必须把教训沉淀到记忆和经验里
   - **同样的错误不犯第二次**

5. **多层验证**
   - 函数级：输入输出是否符合预期？边界条件是否处理？
   - 集成级：组件间数据流是否正确？事件是否正确触发和接收？
   - 用户级：站在用户角度，点得动、看得清、反馈及时？
   - 异常级：网络断开、文件不存在、数据为空——是否都有合理降级？
   - **改了后端必须验证前端，改了前端必须验证后端**

---

## 项目关键信息

### 项目身份
- **正式名称**: solo
- **版本**: v1.2.24（以 `package.json` 为准；ARCHITECTURE.md 同步到此版本）
- **历史残留**: `marklight` 字样 → 已清理（见 2026-06-30 工作记录）
- **定位**: 本地优先桌面 Markdown 编辑器，面向中文沉浸式写作

### 本机目录结构（2026-07-21 拍平后，重要）
- **项目根 = 仓库根 = `F:\fzz-Project\md-editor`**（`.git` 在此层）。已消除历史上的 `md-editor/md-editor` 双层同名嵌套。
- **注意**：本记忆的历史日志（2026-07-19 / 2026-07-21）里凡出现「内层 `md-editor/md-editor` 才是 git 仓库」「外层非 git」的叙事，均为**拍平前的旧状态**，已作废；当下只有单层。
- 仓库根同时寄生三份未提交且已 gitignore 的原则草稿（architecture：产品开发总原则.md / project_rules：工作原则和纪律.md / solo产品精神.md）+ 辅助文件（.trash-垃圾站/ / .archive-档案室/ / .write-the-fuck-*.json / .sig），均不进公开仓库。

### 本机目录结构（2026-07-21 拍平）
- **项目根 = 仓库根 = `F:\fzz-Project\md-editor`**（单层，无嵌套）。
- 历史：曾因 Trae 工作区开在父层导致 `md-editor/md-editor` 双层嵌套（外层非 git，内层才是仓库），2026-07-21 已拍平消除。
- 仓库根同级的本机辅助/私有文件（已 gitignore，不提交）：`.trash-垃圾站/`（软删中转）、`.archive-档案室/`（MarkLight 时代历史）、`.write-the-fuck-*.json`（笔记工具缓存）、三份原则草稿（`architecture：产品开发总原则.md` / `project_rules：工作原则和纪律.md` / `solo产品精神.md`，待比对吸收后软删）。
- 仓库内 `.archive/`（solo v2 设计存档，本地未跟踪）与外层 `.archive-档案室/` 不同，勿混。
- **IDE 锁铁律**：WorkBuddy 打开的项目目录被 IDE 锁占用，agent 侧无法对其 `.git`/根目录做 rename/move；结构性改名/搬迁必须在项目未在 IDE 中打开时进行。

### 技术栈
- **桌面框架**: Tauri 2.x
- **前端**: Vue 3.5 + TypeScript ~6.0 + Pinia 3.x
- **编辑器**: TipTap/ProseMirror 3.26
- **样式**: Tailwind CSS 4.3
- **包管理**: bun 1.3.14
- **测试**: Vitest + happy-dom 4.x

### 三层架构
```
Rust 核心 (src-tauri/)   ← 20 个命令 + 2 类事件
        ▲ invoke/emit
IPC 服务层 (src/services/tauri/)  ← 契约封装，前端不直接碰 invoke
        ▲
Vue 前端 (src/)  ← App.vue 协调层 + 10 个 composables + 2 个 Pinia store
```

> 命令清单以 `src-tauri/src/lib.rs` 的 `generate_handler!` 为准。

### 关键约束
1. **脏态机制**: `setContent()` vs `markUserEdit()` 分离 → 动它会重新引入脏态闪烁
2. **保存冲突检测**: 在 Rust 侧（`document.rs`），原子写 + mtime 校验
3. **序列化尾换行**: `serializeMarkdown()` 强制恰好一个 `\n`
4. **图片资产安全**: `validate_image_asset_path` 先做 `canonicalize` 再校验扩展名
5. **启动开打竞态**: 三层缓冲（`EARLY_OPEN_REQUEST` + `StartupOpenRequests` + `LoadedWindows`）
6. **Rust 改动必须 `cargo check`（环境陷阱）**：PowerShell 工具禁止 `cmd.exe`，无法用 `vcvars64.bat`；`Enter-VsDevShell` 本机亦失败（参数/路径问题，cl.exe 不进 PATH）。手动设 `$env:PATH/$env:INCLUDE/$env:LIB` 指向 `M:\VS\BuildTools\VC\Tools\MSVC\14.44.35207` + Windows SDK `10.0.26100.0` 后跑 `cargo check`（`CARGO_HOME=M:\rust\.cargo`）。`cargo check` 也会编译 C++ 构建依赖（vswhom-sys 需 cl.exe），故 MSVC 工具链不可省，不能裸跑。

### 真理源自一处（配置集中点）
- 命令名: `command-names.ts`
- 命令定义: `registry.ts`
- 字体清单: `fonts.ts`
- 字体栈: `fontStack.ts`
- 主题色彩映射: `types.ts::CSS_VAR_MAP`

### 字体机制（2026-07-20 核实，重要）
solo 字体是「两套体系 + 远程下载缓存」模式，并非简单缺失：
- **体系 A（UI 层，固定栈）**：`main.css` 的 `--font-text` = `'Inter', 系统字体..., 'Microsoft YaHei UI'/'PingFang SC'..., sans-serif`。Inter 排首但**全代码无加载路径**（不打包、不下载），纯系统回退；Windows 上回退 Segoe UI。仅此层"碰运气"。
- **体系 B（正文可选字体，有下载机制）**：`src/constants/fonts.ts` 的 `FONT_OPTIONS` 共 7 项，5 项带 `fileName`（思源宋体/朱雀仿宋/小赖/霞鹜文楷/汇文明朝）为下载型，2 项（system-ui / 微软雅黑 UI）为系统字体不下载。
  - 加载：`src/services/fontLoader.ts` 的 `ensureFontLoaded(family)`：先查本地缓存(`getCachedFontPath`→`convertFileSrc`)→否则 `downloadAndCache` 从 `https://github.com/jloft198479-cyber/solo/releases/download/v${pkg.version}/${fileName}` 下载并 `saveCachedFont` 落盘；失败兜底走 Rust `fetchFontData`。用 `new FontFace(family,url,{display:'swap'})` 注册（`fontLoader.ts:43`，无 FOUT）。
  - 栈拼接：`src/utils/fontStack.ts` 的 `buildFontStack(primary)` 按字体类型拼 CJK fallback 链；编辑器与导出端共用，所见即所得。
- **分发风险**：字体随每个 `v${pkg.version}` GitHub Release 发布；国内网络首次下载可能慢/不稳；首次冷启无网→回退系统 CJK（fallback 链兜底，可用但失书卷感）。
- **修正旧误判**：此前设计评审①称"Inter、CJK 字体都没打包"不准确——CJK 正文字体有完整下载+缓存机制（不进安装包、运行期获取），仅 UI 栈的 Inter 是纯回退。

---

## 文档 initiative 真实目的（2026-07-20 校正 — 重要）

- **真实受众是 AI agent，不是人类用户**。整个「接手能力 / agent 友好」文档工作（P0 接手文档 + P1 协作规范）的目的是让 **AI agent（接盘团队可能是其他开发者，也可能是其他 agent）能快速定位问题、熟悉项目和代码**。
- **人看不看得懂无所谓，agent 能读懂才是硬指标**。写文档时以 agent 可解析、可检索、信息密度为优先，不必为人类可读性做额外修饰。
- **P2（用户侧诊断/重置 GUI 面板）已否决**：原设计是给「人类用户」用的自救工具（环境卡片/日志重置/导出诊断包）。但 agent 不会点 GUI，它直接读文件 + 调 IPC 命令就能拿版本/日志/设置。故 P2 人类 UI 与 agent 目标错位 → **不做**，除非未来出现具体 agent 需求（如「需要一条命令把诊断信息 dump 成 agent 可读的 JSON」）才考虑，且那是 agent-facing 而非人类 UI。
- 现有 P0/P1 文档（HANDOVER.md / defect-hotspots / KNOWN-ISSUES / debugging / CONTRIBUTING / CHANGELOG / SECURITY / AGENTS.md）已是 agent 的「快速上手 + 找问题」包，无需再为人类加 GUI。

---

## 历史经验

### mermaid 全黑问题（2026-07-19）
- **现象**：solo 中 mermaid 图表渲染为黑矩形 + 黑字。
- **根因**：`mermaid-block.ts` 初始化用 `securityLevel: 'strict'`，mermaid 11 把主题样式生成成 `<style>` 内联进 SVG，但非 `loose` 模式过 DOMPurify（`ADD_TAGS` 不含 `style`）→ 主题 `<style>` 被删 → 节点回退到 SVG 默认样式（黑填充）。
- **修复**：`securityLevel: 'strict'` → `'loose'`。本地优先单文件编辑器，loose 安全风险可忽略。

### 拖拽单例互斥覆盖 bug（2026-07-19）
- **现象**：拖入 `.md` 文件到编辑器不会打开新窗口。
- **根因**：`events.ts` 的 `activeDragDropHandler` 是单值变量，`subscribeDragDrop` 后注册的 handler 覆盖前者。`useAppWindowSession`（处理 .md 打开）被 `MarkdownEditor.vue`（处理图片拖入）覆盖。
- **修复**：`activeDragDropHandler: DragDropHandler | null` → `activeDragDropHandlers: Set<DragDropHandler>`，事件广播给所有订阅者。新增 `events.spec.ts` 5 个测试守门。

### 图片 IPC 合并（2026-07-19）
- **问题**：`MarkdownEditor.vue` 的 `setLocalSrcResolver` 需 5 行 if/else 判别路径模式（storage/相对/绝对），再分别调 `authorize_image_asset`。
- **修复**：Rust 新增 `resolve_image_display` 命令，一步完成路径判别 + canonicalize + authorize。前端调用点简化为 1 行。`lib.rs` 命令数 19 → 20（新增 `resolve_image_display`）。

---

### v1.2.24 发版（2026-07-20）
- **内容**：命令面板（CommandPalette）+ 大纲面板（OutlinePanel + useOutline，scroll-spy）+ 体感丝滑优化（统一动效 token、乐观保存、搜索/跳转脉冲、主题字体 crossfade、font-display swap、prefers-reduced-motion）+ 代码审查修复（Slash 中文触发、mermaid/数学块删除入口、菜单视口边界、图片 containment 校验、双开 EBWebView 清理守卫）。
- **发版流程复盘**：按 RELEASE_PROCESS.md——两笔提交（feat + bump version）、本地门禁（`bun run test` 992 全过 / `bun run build` 通过）、tag v1.2.24 触发 CI（~14.5min，Rust 编译占大头）、核对三件套资产 + latest.json 版本号、转 published。CI 跑在 GitHub windows-latest，无需本地 MSVC 工具链（cargo check 的环境陷阱只在本地 Rust 改动时适用；本次仅 TS/Vue/CSS + 版本号，未触 Rust 源码）。
- **教训**：`gh release download -D /tmp/...` 在 Git Bash 下，gh（Windows 二进制）把 `/tmp` 解析成当前盘 `F:\tmp`，与 MSYS 的 `/tmp` 不是同一目录，导致下载"成功"但 cat 找不到。解决：用项目相对路径（如 `./_reltmp`）下完即删。

---

### 发布流程规范化（2026-07-21）
- **总纲**：`docs/PLAYBOOK.md` —— 全生命周期 6 阶段（A 文档梳理 / B 问题盘点 / C 优化提案 / D 提交纪律 / E 发布 / F 上线验证），每段「入口/动作/出口关卡」。前半段四环节正式固化。
- **核心原则**：判断归人，机械归脚本。
- **发版机制细节**：`RELEASE_PROCESS.md` 现为 Phase E 子文档；手动回归见 `RELEASE-CHECKLIST.md`。
- **机械闸门**：`scripts/release-gate.ps1`（`-Stage PreTag` 查版本三处一致+replaceAll+test/build；`-Stage PostCI [-Publish]` 等 CI+核资产+latest.json+翻转发布）。
- **铁律**：`-Publish` 默认关闭防误发；`/tmp` 错位坑用项目内 `.reltmp` 规避。

---

**最后更新**: 2026-07-21
