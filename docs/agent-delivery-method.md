---
title: Agent 交付方法——从接单到收工的 7 段 SOP
type: guide
audience: agent
status: active
tags: [agent, 工作方法, sop, 真机验收, 提交卫生]
summary: 本次设计审核修复验证有效的任务执行法：计划/改码/验证/提交/沟通全链路
updates: [AGENTS.md, docs/agent-playbook.md, docs/handoff-design-p3-2026-10-13.md]
---

# Agent 交付方法——从接单到收工的 7 段 SOP

> 本文是 2026-10-12/13 设计审核 P1/P2 + About 清理两轮任务**实际跑通并被用户认可**的执行方法的固化。
> 不是新规矩——项目规矩的真理源仍是 [AGENTS.md](../AGENTS.md) 与 [agent-playbook.md](./agent-playbook.md)；
> 本文只回答一个问题：**一次多步任务，具体怎么一步一步做完、不出事。**
> 配套实例见 [P3 交接文件](./handoff-design-p3-2026-10-13.md)。

## 〇、心法三句

1. **过程是我的活，不是用户的。** 用户只要「现在什么状态 / 要我做什么 / 做完有什么用」。中间核销表、探索失败记录，留给工具调用和文档，不堆进回复。
2. **代码文件和 git 历史都是给用户看的交付物。** 净删行、无僵尸代码、独立问题独立 commit——和功能正确同等重要。
3. **看到的 bug 不一定是代码的 bug。** 先测量再下结论：几何测量、computed style、DOM 断言——本次就有「快捷键断行」实为人的验收窗口被压到 484px，flex 本身没毛病。

## 一、开工：先建坐标系，再动手

1. **读最小契约**：`AGENTS.md`（禁令清单）→ 按改动类型查 `docs/agent-playbook.md`（真理源地图）和 `docs/sensitive-areas.md`。不读就改是本轮最大风险来源——本项目最贵的事故是 parser/serializer 静默丢内容。
2. **确认真理源**：动任何一个事实（圆角档位、命令名、类型联合）前，先确认它的单一真理源在哪。本次把 `SettingsTabKey` 从组件移到 settings store，就是因为「关于直达 about」需要 store 与 modal 共用类型，真理源必须唯一。
3. **TodoWrite 拆步**：≥3 步的任务先出计划，每完成一阶段通报「本阶段结果 + 下阶段打算」，按阶段停。计划粒度到「能直接动手」，比如「白名单暂存 10 个文件」而不是「处理样式」。
4. **范围锁死**：只做被要求的。发现的额外问题（本次是 App.vue 旧 About 弹窗 10px 结尾）**只报告不动手**，等用户拍板再做——后来它确实成为用户批准的独立 commit。

## 二、沟通：一条回答只给三件事

1. **现在什么状态**（一句）；**要用户做什么**（具体到能直接动手，没事就明说「不用做什么」）；**做完有什么用**（一句）。
2. 结论先行，坏消息直说；比喻先行、术语不许裸奔；正文超 ~15 行就砍，细节落文件，正文只说「文件在哪 + 里面是什么」。
3. 交互设计成**二选一**：「同意我提交 / 要调整指出哪页」，不要开放式反问。产品决策（如暗色留哪套）必须交还用户，不替用户选。
4. 汇报改动给**具体文件路径**（可点击链接）；验收结论写「用户这么操作得到 X」，不写「1842 测试转绿」——测试是兜底证据，不是交付语言。

## 三、改码：干净比聪明重要

1. **成对删除**：删一个 UI 模块 = 模板节点 + `ref`/状态 + 事件函数 + import + CSS + 类型/常量，**一次删净**。删完全局 grep 旧类名/变量名确认零残留（本次删 About 弹窗：7 处锚点逐对清，133 行一次出清）。
2. **不硬编码**：颜色走 `--*` token，尺寸/动效/圆角走设计 token，超时阈值走常量。圆角档位：`--radius-sm` 4 / `--radius-md` 6 / `--radius-lg` 8 / `--radius-xl` 10；拟物控件（开关、色点、头像、圆钮、骨架条）用 999px 是规则内的，别「统一」掉。
3. **复用优先于新增**：状态栏图标共用 `.icon-btn`，透明度改一处全覆盖；不为单点需求加新类、新文件、新依赖。
4. **注释写「为什么」不写「是什么」**：如 `/* min-width:0 允许在窄空间收缩换行，避免把右侧快捷键框挤断 */`。
5. **NodeView 监听器挂 `AbortController`**，`destroy()` 里 `abort()`，异步回写查 `signal.aborted`（硬禁令）。

## 四、提交卫生：白名单 + 部分暂存 + 不 push

1. **永远白名单 `git add <具体文件>`，禁止 `git add -A`**——用户工作区常有并行在制品（本次有 8 个）。提交后 `git status` 复核，确认没夹带。
2. **独立逻辑独立 commit**，message 走 Conventional Commits：`fix(scope): …` / `style(settings): …` / `refactor(about): …`。主题行 + 分组条目，中文描述改动理由，不只写「改了样式」。
3. **同一文件混入用户改动时，用补丁式部分暂存隔离**（本次实战有效）：
   ```powershell
   git diff src/App.vue                       # 先分清哪些 hunk 是谁的
   # 手写只含自己 hunk 的 patch（LF 换行！见坑 1）
   git apply --cached --recount --check x.patch   # 先 dry-run 校验
   git apply --cached --recount x.patch           # 只进 index
   git add <其他干净文件>
   git diff --cached --stat                   # 复核 index 内容
   ```
   提交后 `git diff <文件>` 应只剩用户的改动（`git status` 显示 `MM` 就是分离成功）。
4. **中文多行 message 用文件传**：写 `.git/COMMIT_MSG_TMP.txt` → `git commit -F` → 删除。避免 PowerShell 引号转义把中文搞坏。
5. **不 push，除非用户明确说 push**。用户说「提交」就是本地 commit。
6. 提交后 `git log --oneline -3` 自证；给用户报 commit 短 hash。

**坑 1（Windows）**：手写 patch 文件必须 **LF 换行**（PowerShell 写出默认可能带 CR，git apply 会报上下文行尾 `?` 不匹配）；行号对不上时加 `--recount` 让 git 重算，不要硬改 hunk 头。
**坑 2**：判断 commit message 是否乱码，用 `git log` 重定向到文件再读，别信终端渲染——证据闭环前绝不 amend/force push。

## 五、真机验收SOP：真实 Tauri + CDP

**为什么不能省**：裸浏览器开 Vite 地址，Tauri API 缺失会连环报错，编辑器崩进 ErrorBoundary，设置弹窗在 dev 组件树异常下不重渲——看到的全是假现场。

```powershell
# 终端 A：前端 dev（走源码，免 Rust 重编译）
bun run dev                         # http://localhost:1420

# 终端 B：带 CDP 端口启动 debug 壳（env 只在本终端有效）
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
src-tauri/target/debug/solo.exe
```

```python
# Python playwright 连真实窗口（脚本放临时目录，别污染工作区）
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    page = p.chromium.connect_over_cdp("http://localhost:9222").contexts[0].pages[0]
    client = page.context.new_cdp_session(page)
    win = client.send("Browser.getWindowForTarget")
    client.send("Browser.setWindowBounds", {           # 必做！窗口会恢复成 484px
        "windowId": win["windowId"],
        "bounds": {"windowState": "normal", "width": 1280, "height": 860}})
```

验收纪律：

1. **断言优先读 DOM/computed，不靠肉眼**：`getComputedStyle(el).borderRadius === '8px'`、`querySelectorAll('.settings-nav-btn--active').length === 1`、`!document.querySelector('.about-overlay')`。截图只是给用户看的佐证。
2. **双路径都要点**：新入口（命令面板→关于直达 about）和旧入口（齿轮→默认外观）分别实测，防止「修了直达、忘了默认」。
3. **Playwright 坑**（Python 版）：不支持 `get_by_role(name=lambda...)`，用 CSS 选择器；切 tab 用 `.click(force=True)` 避开动画稳定性检测；开关用 `[role="switch"][aria-label="..."]`。
4. **别按 Escape 退出局部编辑态**——弹窗的全局 Escape 监听会关掉整个弹窗，后续定位全部超时；靠切 tab 触发 blur 取消编辑。
5. 截图存 `outputs/`（已 gitignore，是工作产物目录），回复里用 `computer://` 链接给用户。

## 六、静态验证：三层 + 基线对比

改完按改动半径跑（分级见 playbook §C），本次纯 UI/设置层的口径：

```bash
bunx vue-tsc --noEmit      # 必须 0 错
bun run lint               # 0 error；warnings 数要与基线持平（132 → 132，涨了就是你引入的）
bun run test               # 1842 passed / 1 skipped；数字要能解释差异
```

- 「通过」不等于「无新增」——**warning 数与基线持平**才算干净，存量警告不是你引入的但也不许涨。
- 动 parser/serializer/schema 前必跑 5 套契约锁（playbook §C），这是硬禁令，没有例外。
- 静态全绿只代表不回归；**用户能不能用，必须真机点一遍**。两层都过才算验收。

## 七、收尾：零残留离场

1. 停掉后台进程（dev server、solo.exe），确认端口释放；注意可能有上一会话的残留进程占用 1420——先查 PID 命令行确认是本项目的 Vite 再决定复用还是杀。
2. 删除临时验收脚本/补丁（工作区外的 `%TEMP%` 文件也要清）；保留的产物只在 `outputs/`。
3. `git status` 最终自查：改动文件数与计划一致，用户的在制品原样未暂存。
4. 最后一条回复仍是三件事：状态 + 要用户做什么（没事就明说）+ 结果在哪。
