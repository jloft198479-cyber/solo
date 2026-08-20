# ColaMD vs solo 对比报告

> 分析对象：marswaveai/ColaMD（v1.8.2，The Agent Native Markdown Editor）
> 对照基线：solo（v1.2.38，本地优先极简 Markdown 编辑器，Tauri 2 + Vue 3 + TipTap）
> 数据来源：ColaMD 通过 GitHub API / raw 在线读取（本地网络无法直连 GitHub，未能 git clone，改用 WebFetch 读源码）；solo 读本地仓库实际代码与文档。

---

## TL;DR（一句话结论）

两个项目**设计基因几乎同源**（都信"极简 / 内容优先 / 语义化 CSS 变量 / YAGNI"），但**目标用户不同**：
- **solo = 人 + 文字**：服务中文沉浸式写作，性能与排版是命根子。
- **ColaMD = 人 + AI 智能体**：服务"人和 AI 协作写 md"，杀手锏是 Agent 实时同步。

**solo 领先**：体积/性能、中文排版、语法丰富度、多窗口、工程纪律。
**solo 最大空白**：不监听外部文件变更 → 没有 Agent Sync，在 2026 的"智能体时代"落后一个身位。

---

## 一、定位与设计哲学（高度同源）

| 维度 | solo | ColaMD |
|---|---|---|
| 一句话定位 | 本地优先、极简、沉浸写作 | Agent Native，人和 AI 协作的 md 编辑器 |
| 设计原则 | 减法原则（一个文件就是一个文件）、内容优先 | "如非必要勿增实体"、内容优先、一致性优先 |
| 常驻 UI | 无工具栏/侧栏/状态栏 | 无工具栏/状态栏，仅一个可隐藏文件面板 |
| 内容宽度 | 720px 居中 | 780px 居中 |
| 行高 | ~1.7 | 1.75 |
| 主题机制 | 语义 CSS 变量驱动 | 语义 CSS 变量驱动（12 套） |
| 图标 | 线性 SVG | 线性 SVG（明文禁用 Emoji/Unicode 替图标） |
| 动效 | 短促 ease-out，prefers-reduced-motion | ~0.15s 克制过渡，不装饰 |

**结论**：两边的审美与克制程度是"同一位老师教出来的"。差异不在品味，在**受众**。

---

## 二、技术栈对比

| 层 | solo | ColaMD |
|---|---|---|
| 桌面框架 | **Tauri 2（Rust 原生）** | **Electron 34** |
| 构建/打包 | Vite 7 + bun | electron-vite 3 + Vite 6 + electron-builder |
| 前端 | Vue 3 + Pinia + Tailwind 4 | 原生 TS（无框架） |
| 编辑器内核 | TipTap 3.26 / ProseMirror | Milkdown 7（@milkdown/kit）/ ProseMirror |
| Markdown 链路 | **自研 markdown-it parser/serializer**（roundtrip 测试 618 pass / 34 约束） | Milkdown 默认 remark-stringify（commonmark + gfm） |
| 数学 | KaTeX（懒加载） | KaTeX + @milkdown/plugin-math |
| 图表 | **Mermaid 11** | **已移除**（v1.8.1，为保代码块原生可编辑） |
| 自动更新 | 自带更新 | electron-updater |
| 跨平台 | mac/win/linux | mac/win/linux |
| 安装包/内存 | 极小（吃系统 WebView2） | 偏重（Electron 套壳） |
| 许可 | Apache 2.0（fork 自 MarkLight） | MIT |

> 两边编辑器**都基于 ProseMirror**，都用了 KaTeX，都做 WYSIWYG、都本地优先、都开源免费。区别在"封装层"（TipTap vs Milkdown）和"框架"（Tauri vs Electron）。

---

## 三、功能逐项对比

| 功能 | solo | ColaMD | 备注 |
|---|---|---|---|
| WYSIWYG | ✅ | ✅ | 都拒绝左右分屏 |
| 实时 Agent 同步 | ❌ | ✅ **（招牌）** | ColaMD 目录级 fs.watch + 内部/外部保存区分 |
| Agent 活动指示 | ❌ | ✅ 标题栏活动点 | active→cooldown→idle 状态机 |
| 多窗口 | ✅ 并排对比 | ❌ 未提 | solo 独有 |
| 文件夹/文件浏览 | ❌ 刻意不做 | ✅ 220px 轻量面板（agent 增删自动刷新） | 哲学分歧 |
| 源码模式切换 | ❌ | ✅ | solo 仅内部 getMarkdown/setMarkdown |
| 斜杠命令 | ✅ 含**拼音首字母检索**（/bg 表格） | ❌ 无 | 中文发现性 solo 友好 |
| 扩展语法 | ✅ Mermaid/Callouts12色/WikiLinks/脚注/Frontmatter/上下标 | ⚠️ commonmark+gfm+==高亮== | solo 更丰富；ColaMD 删了 Mermaid |
| 任务列表 | ✅ | ✅ 可点击 | 都有 |
| 搜索 | ✅（命令面板/大纲） | ✅ ⌘F | 都有 |
| 富文本复制 | ✅ Copy as HTML（跟随主题） | ✅ 内联样式（适配微信/邮件） | 都有 |
| 主题数量 | **3 套**（手作） | **12 套**（Bear/Notion/iA Writer/Dracula/Nord/Gruvbox…） | ColaMD 多 |
| 自定义主题 | ❌ | ✅ load-custom-theme 加载 CSS | ColaMD 灵活 |
| 导出 | PDF / HTML | PDF / HTML | 都有 |
| 图片路径 | 字节通道+规范化，绝对路径放行 | 显示转 `file://`、保存转相对（可移植） | 思路类似 |
| VS Code 集成 | ❌ | ✅ 独立扩展 | ColaMD 有 |
| 新功能演示页 | ❌ | ✅ Help→演示（onboarding） | ColaMD 引导好 |
| 中文本地化 | ✅ 沉浸式中文本位 | ✅ 双语 README（英为主） | 受众不同 |
| 社区/星数 | 中文小众，星少 | 819★ / 51 fork，全球智能体开发者 | ColaMD 声量大 |

---

## 四、solo 的优势（相对 ColaMD）

1. **体积与性能**：Tauri 2 + Rust 原生，安装包和内存比 Electron 小一个量级。solo 明确"排斥 Electron 套壳臃肿"，这是它的立身之本。
2. **中文排版专精**：CJK 字体（思源宋体/霞鹜文楷）、衬线优先、字节通道加载字体绕开 CORS、严苛行距段距。ColaMD 排版是通用模板（代码字体 Menlo/Monaco，无 CJK 专项打磨）。
3. **语法更丰富**：Mermaid（ColaMD 反而删了）、Callouts 12 色、WikiLinks、脚注、Frontmatter、上下标——技术文档/长文写作更强。
4. **多窗口并排**：solo 支持多窗口对比文档；ColaMD 未提。
5. **工程纪律**：solo 三层架构（Rust 核心 / IPC 服务层 / Vue）+ SSOT + 严格文档 + roundtrip 测试；ColaMD 结构简单（适配其体量），但规范化和测试沉淀弱。
6. **中文交互友好**：斜杠命令拼音首字母检索（/bg→表格、/dmk→代码块），中文用户"发现功能"成本低。

---

## 五、solo 的劣势 / ColaMD 领先之处

1. **缺 Agent Sync（最大战略空白）**：2026 智能体时代，ColaMD 的"AI 改 .md → 实时同步 + 标题栏活动点"是杀手锏。solo **完全不监听外部文件变更**（已确认 Rust 无 watcher）。你本人用 AI 编程工具，若让 Claude/Codex 改了正打开的 .md，solo 不会感知——这是最该补的一处。
2. **无文件夹浏览**：solo 坚持"单文件"。ColaMD 有 220px 轻量文件面板，且 agent 增删文件自动刷新。多文件资料库场景 solo 不便。**但这是哲学取舍，非纯劣势**。
3. **无源码模式**：ColaMD 可一键切原始 markdown 源码；solo 纯 WYSIWYG（自定义序列化，无实时源码视图）。硬核用户想直接改 md 源码时不便。
4. **无 VS Code 集成 / 扩展**：ColaMD 有扩展从 VS Code 打开当前文件；solo 无。
5. **主题偏少**：3 套 vs 12 套，视觉选择少（solo 胜在"手作 + CJK 排版"，但数量吃亏）。
6. **社区与国际化**：ColaMD 819★、中英双语、瞄准全球智能体开发者；solo 中文小众、星少。生态与传播力弱（但契合其定位）。
7. **引导体验**：ColaMD 有"新功能演示"可玩 demo 页；solo 未见同类 onboarding。

---

## 六、最值得借鉴的可落地建议（按 ROI 排序）

1. **补外部文件监听（Agent Sync 轻量版）**——优先级最高。
   - 做法：Rust 侧用目录级监听（Tauri 的 fs-watch 插件或 `notify`），复用 ColaMD 已验证的"内部保存 flag 屏蔽回弹 + 100ms 防抖 + 启动 300ms 抑制"机制。
   - 理由：solo 本地优先单文件模型与此天然契合，改动小、收益大。补齐后你用 AI 改 .md 也不会"看不见"。
2. **加可切换源码模式**：solo 已有 `getMarkdown`/`setMarkdown` 内部能力，前端加个切换即可，零内核改动，照顾硬核用户。
3. **主题做成"可加载 CSS"**：保留默认 3 套精简，但允许用户放自定义主题 CSS（ColaMD 的 `load-custom-theme` 思路），既守精简又补选择少。
4. **可选轻量文件面板**：不做常驻侧栏、不做持久 workspace，但加一个可隐藏的"同目录文件切换"（参考 ColaMD 220px 面板），守住 solo"一个文件就是一个文件"底线的同时，照顾多文件场景。

---

## 七、最终判断

solo 和 ColaMD 是**同一套极简设计哲学下、面向不同人群的两兄弟**。solo 在性能、中文排版、语法丰富度、工程纪律上占优；ColaMD 在"智能体协作"这个 2026 的新战场领先一个身位，且社区、主题、集成更全。

对"用 AI 工具的中文写作者"这个真实身份而言，solo 最该补的就是 **Agent Sync**——否则你用 AI 改 .md 时，solo 会"视而不见"。其余多是口味与取舍差异，不必照抄。
