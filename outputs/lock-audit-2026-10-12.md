---
title: 锁体检台账（63 份 spec · 897 用例 · 实跑 1829 条）
type: proposal
status: active
date: 2026-10-12
audience: 人
summary: 每条锁回答「防什么事故 / 哪一级 / 有没有反向校准」，据此定去留
---

# 锁体检台账

> 排查对象：`src/**/__tests__/**/*.spec.ts`，共 **63 份 / 897 个用例定义 / 实跑 1829 条**。
> 分级标准（见 `docs/agent-playbook.md` §C）：
> **A 行为锁**（模拟用户操作，验产品行为）= 唯一可当交活依据 ｜ **B 守恒锁**（名单/结构比对）= 只当警报器 ｜ **C 棘轮锁**（只许变好）= 只防回归。

---

## 一、总览

| 指标 | 数 | 说明 |
|---|---|---|
| spec 文件 | 63 | |
| 用例定义 / 实跑 | 897 / 1829 | 差值来自 `it.each` 等参数化展开 |
| 最大的一份 | `roundtrip.spec.ts` **238 条** | 占用例定义 **27%**，是头号税源也是头号保障 |
| **自带反向校准 / 防假绿声明** | **21 / 63（33%）** | 关键词：修复前应红 / 旧行为 / 锁死不再回退 / 修好后 / 不得误伤 / 【已修】/【回归】/ 防假绿 |
| **无声明（不知是不是摆设）** | **42 / 63（67%）** | ⚠️ 本次最大的发现 |

---

## 二、A 级 · 行为锁（可当交活依据）

### A1 保真类（最贵的事故类型：静默丢内容 / 保存即改文件）

| 文件 | 用例 | 防什么 | 反向校准 |
|---|---|---|---|
| `markdown/__tests__/roundtrip.spec.ts` | 238 | 解析→序列化往返不变（打开再保存文件不变） | 部分（Phase N/O 有） |
| `markdown/__tests__/fixtures.spec.ts` | 1* | 真实文档 fixture 保真 | — |
| `markdown/__tests__/fuzz.spec.ts` | 1* | 随机输入不崩不丢（**种子化**） | — |
| `markdown/__tests__/commonmark.spec.ts` | 1* | CommonMark 官方用例不回归 | — |
| `markdown/__tests__/_cjk-diag.spec.ts` | 1*（8 case） | CJK 加粗往返 | ⚠️ **有真断言，但名字像临时诊断、疑似与 roundtrip 重复** |
| `markdown/__tests__/table-ops.spec.ts` | 7 | 表格增删后仍是合法 GFM | 有（双向 toggle） |
| `extensions/__tests__/code-block.spec.ts` | 17 | 围栏语言名不被压小写（打开→保存即改文件） | — |
| `extensions/__tests__/image.spec.ts` | 14 | 图片语法往返（含尺寸 / 标题） | — |

### A2 编辑交互类

| 文件 | 用例 | 防什么 | 反向校准 |
|---|---|---|---|
| `extensions/__tests__/markdown-input.spec.ts` | 31 | 输入即转换（打 `**` 变加粗） | — |
| `extensions/__tests__/markdown-input-ime.spec.ts` | 14 | 中文输入法上屏不被吞 / 不残留拼音 | — |
| `extensions/__tests__/markdown-paste.spec.ts` | 79 | 粘贴表格正确解析 | — |
| `extensions/__tests__/list-backspace.spec.ts` | 21 | 行首退格不把列表劈成两个 | ✅ 标题写明「修复前应红」 |
| `extensions/__tests__/list-demote.spec.ts` | 21 | 清除格式不动层级 / 转段落真脱出 | ✅ 有「旧行为会误伤父项」 |
| `extensions/__tests__/list-input-guard.spec.ts` | 11 | 项内敲标记不缩进 | ✅ 有「不许误伤」对照 |
| `extensions/__tests__/list-fold.spec.ts` | 23 | 折叠装饰与跨文档记忆 | — |
| `tiptap/__tests__/list-move.spec.ts` | 15 | Alt+方向同层换位、子项跟随 | — |
| `extensions/__tests__/cell-content-guard.spec.ts` | 5 | 单元格里造不出块级结构 | ✅ 有「格外不受影响」对照 |
| `extensions/__tests__/callout.spec.ts` | 4 | callout 属性同步（类型/标题/折叠） | — |
| `tiptap/__tests__/composition-freeze.spec.ts` | 10 | 组字态总闸（不吞合成文字） | ✅ 退化安全断言 |
| `tiptap/__tests__/ime-anchor.spec.ts` | 15 | 重锚护栏（blur→60ms→focus） | ✅ 「默认间隔不为 0」即防假绿 |
| `extensions/__tests__/paragraph-focus.spec.ts` | 10 | 聚焦装饰增量更新 | — |
| `extensions/__tests__/nodeview-destroy.spec.ts` | 6 | NodeView 销毁后不留监听器/定时器 | ✅ 有「destroy 前会」对照 |
| `tiptap/__tests__/editor-metadata.spec.ts` | 3 | 字数统计不被 ZWNJ 抬高 | ✅ 有「不含强调不受影响（防顺手改坏）」 |

### A3 保存与数据安全类（不可逆，最高危）

| 文件 | 用例 | 防什么 | 反向校准 |
|---|---|---|---|
| `composables/__tests__/useDocumentSession.spec.ts` | 28 | 未修改不写盘 / 防抖窗口内 Ctrl+S 必落盘 | ✅ 明写「M-03 回归锁」「P1-① 复现锁」 |
| `stores/__tests__/file.spec.ts` | 26 | 脏态判定（语义比对，不是字符串比对） | — |
| `markdown/__tests__/baseline-dirty.spec.ts` | 5 | 载入基线不误判脏（CRLF 场景） | ✅ 「旧行为，锁死不再回退」 |
| `utils/__tests__/markdown-to-html.spec.ts` | 5 | 导出降级清洗（变浅剥壳） | ✅ 有「通用格式不受影响」 |

### A4 UI / 命令 / 服务类

| 文件 | 用例 | 防什么 | 反向校准 |
|---|---|---|---|
| `extensions/__tests__/suggestion-guard.spec.ts` | 20 | 斜杠/emoji 菜单触发规则 | ✅ 「与库默认实现语义等价」 |
| `extensions/__tests__/slash-commands.spec.ts` | 9 | 中文后敲 `/` 能唤出菜单 | ✅ 注明「原 bug 场景」 |
| `extensions/__tests__/wikilink*.spec.ts` | 33 | 互链解析 / 拖入 / 候选 | — |
| `tiptap/__tests__/editor-extensions.spec.ts` | 12 | 浮动菜单 size+flip 定位 | ✅ 「★ 永不超出理想高度」 |
| `composables/__tests__/useFloatingListMenu.spec.ts` | 19 | 浮动菜单状态机 | — |
| `views/__tests__/ContextMenu.spec.ts` | 11 | 右键菜单开合、不叠加监听 | — |
| `composables/__tests__/useAppDomEvents.spec.ts` | 6 | Esc 优先级（提示 > 焦点模式） | ✅ 有连按两次的序列断言 |
| `composables/__tests__/useCommandDispatcher.spec.ts` | 7 | 命令作用域门控 | — |
| `composables/__tests__/useEditorSync.spec.ts` | 15 | 序列化空闲调度（打字中途不硬跑） | — |
| `commands/__tests__/registry.spec.ts` | 8 | 自定义键覆盖默认 / fixedShortcut 仍参与冲突检测 | — |
| `services/tauri/__tests__/*.spec.ts` | 21 | IPC 封装（含错误处理） | — |
| `themes/__tests__/manager.spec.ts` | 7 | 主题注入 / 旧格式导入 | — |
| 其余小项（`useClickOutside` / `useImagePreview` / `useMenuShortcutsSync` / `settings` / `document-scale` / `mermaid` / `editor-commands`） | 31 | 组件与工具行为 | — |

---

## 三、B 级 · 守恒 / 结构锁（**只当警报器，不许当交活依据**）

| 文件 | 用例 | 防什么 | 反向校准 | 备注 |
|---|---|---|---|---|
| `markdown/__tests__/mark-delimiter-coverage.spec.ts` | 3 | 每个 mark 都有 markdown 载体（防静默吞格式） | ✅ 有「本防线本身有效」自检 | **只证明有分支**，不证明写出去能重开 |
| `tiptap/__tests__/schema-contract.spec.ts` | 8 | schema 容器 / mark 契约不漂移 | — | 结构断言 |
| `commands/__tests__/menu-consistency.spec.ts` | 3 | menu.rs 兜底键 ⟷ registry 默认键一致 | ✅ 「防正则抽不出来 → 空数组 → 假绿」 | 名单比对 |
| `commands/__tests__/shortcut-consistency.spec.ts` | 4 | 注册表承诺的键在编辑器里真生效 | 部分（含抽样行为） | 名单 + 抽样 |
| `markdown/__tests__/plugins.spec.ts` | 3 | 插件注册顺序 / hook 聚合 | — | 结构 |
| `markdown/__tests__/serializer-perf-guard.spec.ts` | 2 | 输出缓冲不退回字符串累加（O(n²)） | ⚠️ **弱** | ⚠️ **它验的是「源码长什么样」（正则查 `this.output +=`），不是「跑得多快」。改变量名就失效 ⇒ 不能当性能证据，只能当结构锚点** |

---

## 四、C 级 · 棘轮锁（只防回归）

| 文件 | 用例 | 防什么 | 备注 |
|---|---|---|---|
| `markdown/__tests__/fidelity-scan.spec.ts` | 1 | 全仓真实文档：ZWNJ 不出站 / 二轮收敛 / 变化签名只降不升 | **默认不跑**（需 `SOLO_FIDELITY_SCAN=1`）⇒ 容易被忘，需显式跑 |
| `markdown/__tests__/safety-net.spec.ts` | 21 | **判据自检**（防"参照系两侧同丢"的隐形丢失）+ **登记锁**（已知未修 bug） | ⭐ **本项目质量最高的一套**，见下 |

### ⭐ safety-net 值得推广的三个设计

1. **判据自检**：先证明"这个检查真能抓到丢失"，再拿它去查别人（防假绿的治本做法）。
2. **【已修】/【回归】成对**：每修一个 bug，同时加一条"既有形态不许改坏"——这就是**反向校准的制度化**。
3. **登记自带过期提示**：`登记项必须仍不守恒（修好了请删登记并放开 SKIP）` —— **锁自己会提醒你删它**，不会变僵尸。

---

## 五、发现的问题（按严重度）

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | **67% 的锁（42/63）看不出"防什么事故"** | 不知道该留该删，也没法判断是不是摆设 | **逐份补一行注释**（成本低） |
| 2 | `serializer-perf-guard` 验源码结构不验性能 | 可能假绿（改变量名即失效） | 保留（便宜）但**明写"不许当性能证据"**；要真性能证据另做基准测试 |
| 3 | `_cjk-diag.spec.ts` 名字像临时文件，实际有真断言 | 容易被后人误删 / 误以为是垃圾 | 改名去掉下划线前缀；**核对是否与 roundtrip 的 CJK 部分重复**，重复则合并 |
| 4 | `fidelity-scan` 默认不跑 | 最容易漏的保真防线 | 已在 AGENTS 用醒目块标注；可考虑加进 `bun run test`（需评估耗时） |
| 5 | `roundtrip` 238 条占 27% | 头号执行耗时来源 | **不建议删**（它是保真的主力）；可优化启动开销 |

---

## 六、建议动作（按性价比排序）

1. **给 42 份缺声明的 spec 补「防什么事故」一行注释** —— 半天，永久收益：以后任何人都能判断这条锁该不该留。
2. **改名 `_cjk-diag` + 核对是否与 roundtrip 重复** —— 10 分钟。
3. **给 `serializer-perf-guard` 加一句"本锁只验结构，不验性能"** —— 5 分钟，防误导。
4. **把 safety-net 的三个设计写进规范**（判据自检 / 已修+回归成对 / 登记自带过期提示）—— 已写入 `docs/agent-playbook.md` §C，新锁照此办理。
5. **对 B 级 6 份做一次真正的反向校准**（撤修复看是否转红）—— 成本较高，建议只对 `serializer-perf-guard` 和 `schema-contract` 先做。

---

## 七、本次不确定的两处

1. `roundtrip.spec.ts` 238 条里**有没有重复/等价的 case** —— 需要逐条比对，本次没做。
2. 42 份"无声明"的锁里，有多少其实是**摆设**（撤修复也不红）—— 只能靠反向校准实测，本次未实测（成本太高）。
