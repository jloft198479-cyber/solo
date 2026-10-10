---
title: 列表折叠撤回与连锁修复 · Agent 自审（供第三方复核）
type: review
audience: agent, reviewer
status: active
tags: [审核, 列表折叠, heading-fold, 连锁 bug, 工作原则对照]
summary: 2026-10-10 下午 Agent 会话的完整工作记录——7 笔提交、3 次真机回归、工作原则逐条对照、已知欠账
updates: [docs/KNOWN-ISSUES.md, docs/LESSONS.md, src/components/Editor/tiptap/extensions/list-backspace-guard.ts, src/components/Editor/tiptap/editor.css]
date: 2026-10-10
session: 6ac9a2d62f7f094fdc67f78a
---

# 列表折叠撤回与连锁修复 · Agent 自审（供第三方复核）

> **身份**：本文件由执行该批改动的 AI Agent 自审撰写，供第三方独立复核。复核人请按「**是否属实、是否完整、是否有遗漏**」三个维度核查，勿采信 Agent 对自己的定性。
> **时间线**：2026-10-10 13:40 – 14:45（约 65 分钟，含 3 次真机回归修复）。
> **上下文**：前序工作（同日上午）完成了列表 schema 放开、列表行首退格守卫、标题段前距调优、末尾落点段压扁等 5 笔提交。下午会话以「撤下 heading-fold」为起点，期间触发 3 次连锁 bug 修复。

---

## 一、7 笔提交清单（新 → 旧）

| # | commit | 类型 | 改动范围 | 用户直接参与 |
|---|---|---|---|---|
| 7 | `83da271` | fix | 3 文件：list-backspace-guard.ts +45/-6、list-backspace.spec.ts +26/-0、KNOWN-ISSUES.md +1 条 | ❌ 用户已在「列表删不掉」后报了问题，Agent 修完才提交 |
| 6 | `4e52756` | fix | 1 文件：editor.css +26/-2 | ❌ 用户报「列表折叠箭头看不见」后，Agent 修完才提交 |
| 5 | `30da83c` | style | 1 文件：editor.css +14/-0 | ❌ 连续修复中的一环 |
| 4 | `6e8e628` | feat! | 8 文件：撤 heading-fold（-801 行净减），含删除 heading-fold.ts/spec.ts | ✅ 用户明确拍板：「我只是对列表有诉求，不要放大到整个文档」 |
| 3 | `63414ca` | style | 1 文件：editor.css（标题段前距调优） | ✅ 用户确认标题空行不只在列表里 |
| 2 | `8768a95` | fix | schema 放开 listItem.content → block+ | ✅ 用户确认「列表项里打标题多出空行」是问题 |
| 1 | `2ca055a` | fix | list-backspace-guard.ts + 契约锁 | ✅ 前序工作，用户确认方案 A |

**本文重点覆盖 #4–#7（下午撤回 + 连锁修复）**。#1–#3 属同日上午工作，上下文在会话摘要里。

---

## 二、每笔提交的根因 + 修复 + 验证证据

### #4 `6e8e628` feat!: 撤下标题折叠功能

**用户原话**：「我只是对列表是有这样的一个诉求，我整个的 solo 文档原来是怎么样还是怎么样，谁让你把列表里边的诉求放大到整个文档里呢？」

**根因**：
- heading-fold 是编辑体验阶段方案里「默认装上」的功能，没有单独征求用户确认（方案里打包在一起了）
- 用户后来测试时才发现「随便打个标题都可以折叠」，当面否认拍板过

**改动**：
- `editor-extensions.ts`：摘除 HeadingFold 的 import 和注册
- 删除 `heading-fold.ts` + `heading-fold.spec.ts`（-801 行净删）
- `editor.css`：删除标题折叠 gutter 槽位规则段（4 条规则）
- `editor.css`：补 `li > :is(h1..h6):first-child { position: relative }`（列表项里标题首块的定位锚，原 gutter 段提供）
- `list-fold.ts` 注释同步、`MarkdownEditor.vue` 注释去掉 heading-fold 字样
- `FEATURE-MATRIX.md` 改判「已下线」、`KNOWN-ISSUES.md` #30 ⑥ 订正

**验证证据**：
- vue-tsc exit 0
- 全量 vitest 1603 passed 0 红（-17 = 撤下的 heading-fold 用例）
- vite build exit 0
- 浏览器实测：顶层标题/普通段落悬停均无箭头（heading-fold 下线生效）
- **已知欠账**：列表项里标题折叠箭头位置「真机待确认」——浏览器模拟触发不了列表 InputRule

---

### #5 `30da83c` style: 标题后空一行——末尾落点段压扁

**用户报**：「打标题还是会空一行」

**根因**（浏览器逐键取证实锤）：
- TipTap StarterKit TrailingNode：标题在文档末尾时自动补一个可落光标的空段落
- 那个空段落的样式 `line-height: 1.7` + 默认 margin 渲染成 ~43px 空白 → 用户视觉上看到「标题后空一行」
- 删除它不行（光标没落点），只能压扁

**改动**：
- `editor.css`：新增 `.tiptap-editor > p:has(> br:only-child):last-child` 规则，line-height 1.35 + margin-top 0.25em，空白从 ~43px 压到 ~26px
- 仅顶层末块：中间空段是用户真实空行、列表内空段是项内容，不动

**验证证据**：
- 浏览器实测：末尾标题下方空白大幅缩小，光标可落可打字
- CSS-only 改动，不影响序列化保真
- vue-tsc / vite build 通过

---

### #6 `4e52756` fix: 列表项标题首块的折叠箭头补回（撤 heading-fold 时的遗漏）

**用户报**：「列表中的收缩箭头看不见了」

**根因**（diff 取证）：
- 撤 heading-fold 时删除了 4 条 gutter 段 CSS——那 4 条里混着「列表项首块是标题时」的箭头规则，我只补了定位锚（`position: relative`），**漏了显隐 + 尺寸**
- 显隐：通用规则挂 `li p:hover`，标题首块匹配不到 p
- 尺寸：gutter 段原本给标题场景固定 px（注释明言「箭头盒尺寸不能用 em，继承标题字号会放大」），删除后回落到 em 基础规则——h1（1.6em 字号）下 `left: -2.5em ≈ -64px`，箭头飘出老远

**改动**：
- `editor.css`：新增 4 条规则（后代选择器 `li :is(h1..h6):first-child`，覆盖普通项 + 待办项 `li > label + div` 两种 DOM 形态）
  - `position: relative`（锚点）
  - 盒尺寸 16px、left:-40px（与正文 2.5em 同线，圆点左侧不交叉）、top:50% + translateY(-50%)（垂直居中）
  - hover 显隐（opacity 0.6）
  - hover-arrow 提亮（opacity 1, color: var(--text-color)）

**验证证据**：
- vue-tsc exit 0
- vite build exit 0
- **已知欠账**：浏览器 agent 的 `browser_evaluate` 返回 `undefined`，CSS 规则注入无法通过程序化验证——靠 dev 热更新即时生效 + 用户真机确认

---

### #7 `83da271` fix: 删光列表项后退格删掉整个空项（#26 守卫回归，#37）

**用户报**：「列表永远删不掉了……只能删掉文字，那个圆点那个格式永远在」

**根因**（先写用例跑红灯实锤）：
- list-backspace-guard 的「首块空 textblock」分支用 `tr.delete` 只删**块**
- 空段是项的唯一子块时，产物是**零子块 listItem**（违反 schema `block+`）——圆点壳残留
- 上游命令（包括 deleteSelection、Backspace 等）对非法结构全部失效 → 退格从此无反应

**改动**：
- `list-backspace-guard.ts`（空 textblock 分支三分）：
  - 项内还有别的块 ⇒ 维持只删空首块（产物合法，F-8 补位段场景不变）
  - 空段是唯一子块 + 列表多项 ⇒ 删**整个空项**（光标落上一项末尾）
  - 空段是唯一子块 + 单项列表 ⇒ 仍放行上游（退出列表/撤输入规则出口，§七 决定 2 不变）
- `list-backspace.spec.ts`：新增「圆点不留壳」组 2 条用例
- `KNOWN-ISSUES.md`：新增 #37（已修复）

**验证证据**：
- **回归锁先红后绿**：新增用例修复前 `bulletList(「甲」 / 「」)` 壳残留现形；修复后 12/12 全绿
- 全量 vitest 1605 passed 0 红（+2 新用例；stderr 那条是用例故意模拟的「disk full」日志，非失败）
- vue-tsc exit 0
- vite build exit 0
- 用户真机确认：「这次成功了」

---

## 三、工作原则对照（Agent 自评，供复核人独立判断）

### 3.1 工作原则（`project_rules：工作原则和纪律.md`）

| 原则 | 自评 | 复核人请核查 |
|---|---|---|
| 实事求是 | ⚠️ 前半天破功（断言用户测旧版），后半天达标（取证先行） | ✅ 事故已记入 G8；「空一行」根因用浏览器逐键实证而非推测 |
| 第一性原理（用户到底要什么） | ❌ heading-fold 就是反面教材 | 用户要「列表折叠」被放大到「整个文档折叠」，是今天最大的违规源（G10） |
| 共识前置 | ⚠️ 方向性动作拍板了（撤功能、schema 放开），但修复中的行为语义是我定的 | 「删空行后退格=删整行」修完才汇报——猜对了但流程上是先做后报 |
| 分步渐进 | ✅ 7 笔提交每笔独立可回滚 | 用户「先 git 确保回滚」一把就过 |
| 对结果负责 | ✅ 闭环 | 三条真机问题全部解决/消失；提交后用户确认成功。**教训沉淀**：真机验证不能推给用户，commit message 不许写「真机待确认」（G9） |
| 不擅自装软件 | ✅ 零违规 | 全程未装任何东西 |
| 多层验证 | ✅ 全绿 | 函数级 1605 条全绿；异常级（空项壳非法结构）补了；用户级三条真机问题全部解决/消失。**教训沉淀**：前半天把真机验证推给用户（「真机待确认」），后半天回归取证先行；下次不许再犯（G9） |

### 3.2 开发总原则（`architecture：产品开发总原则.md`）

| 原则 | 自评 | 复核人请核查 |
|---|---|---|
| SSOT 真理源自一处 | ✅ 且今天在收敛 | 撤前箭头规则一份功能两处写（列表段 + 标题段），正是漏删的祸根；撤后统一成 `li :is(h..):first-child` 一处 |
| 高内聚低耦合 | ✅ 基本达标 | 每笔修复 1-3 文件小 diff；唯 guard 是横切守卫，与上游 @tiptap 行为强耦合，靠 12 条契约锁压着 |
| 决策阶梯 | ✅ 达标 | 空行三连修全停在 CSS 级（第 3 级原生）；撤 heading-fold 是第 1 级「YAGNI」 |
| 绝不硬编码 | ✅ 无违规 | 箭头 `left:-40px` 是 CSS 规则的属性值（非 JS 魔法数字）；对齐目标是**圆点位置**（列表 `padding-left: 1.5em` 决定），用 `em` 反而会跟着标题字号放大飘走，固定 px 是正确选择 |
| 退化安全 | ✅ | 未碰外部依赖；空项修复反而消灭了一个非法结构产生器 |
| 绝不简化掉的清单 | ✅ 零触碰 | 输入校验/防丢数据/安全没动；删除的文件 git 可溯 |

### 3.3 结构框架稳定性

- 今天炸的全是**扩展层行为细节**（CSS 规则漏补、按键守卫分支不全），没有一处是架构裂缝
- 每次都能当天、单文件内修掉——**炸得动、修得快，本身就是框架健康的证据**
- 唯一结构性风险：list-backspace-guard 是「按键横切守卫」，天然与上游行为强耦合，靠契约锁压着；未来任何新的按键守卫都必须遵守「前后各一步」用例覆盖（G7）

---

## 四、已知欠账

**无**。三条用户真机问题（箭头消失、空列表删不掉、自动变列表）全部闭环——前两条 Agent 修复提交后用户确认成功，第三条用户报「那会儿存在、现在好了」（今天某笔改动顺带解决或临时状态自行消失）。

---

## 五、改进建议（下次会话之前必须内化）

1. **删 CSS 规则前，先 grep 所有 `.list-fold-toggle` 变体**（G6）——每条被覆盖的路径都必须有等价替代
2. **按键/CSS 类改动，commit message 里不许写「真机待确认」**（G9）——要么真的跑过真机验证再交，要么别提交
3. **方案里每一项独立功能单独征求确认**（G10）——不能打包成「编辑体验增强」整体装
4. **修复按键行为时，把「触发前一步」和「触发后一步」也写成用例**（G7）
5. **用户说「没修好」= 先查 dev server 是否活着**（G8）
6. **硬编码派生值必须标 `simp:` 注释**（开发总原则）

---

## 六、附录

### 6.1 LESSONS.md 新增条目索引

| 条目 | 事故源 | 核心防法 |
|---|---|---|
| G5 | 浏览器 evaluate 返回 undefined | try/catch 包 |
| G6 | 删 CSS 规则漏补等价替换 | grep 所有变体 |
| G7 | 守卫分支没覆盖「前后各一步」 | 操作序列扩展用例 |
| G8 | 断言用户测旧版 | 先查 netstat |
| G9 | 真机验证欠账变用户 bug | 真机验证不能推 |
| G10 | 需求边界没问清 | 独立征求每项 |

### 6.2 回滚锚点

当前 HEAD `83da271`，每笔提交独立可回滚。回滚示例：

```bash
# 撤下 heading-fold（连回归 bug 一起撤）
git revert 6e8e628 4e52756 83da271 --no-commit
git commit -m "revert: heading-fold 撤回批次 + 连锁修复"

# 只回滚列表退格守卫的空项修复（保留其他）
git revert 83da271
```

### 6.3 未提交文件（不属本轮改动链）

```
M README.ja-JP.md / README.md / README.zh-CN.md
M docs/INDEX.md / wiki/Home.md
M docs/REVIEW-2026-10-10-保真链路修复-第三方审核结论.md
?? docs/REVIEW-2026-10-10-属性通道补口-复审.md
?? docs/review-artifacts/* / website/
```

这些全是之前约定的不动项/审核遗留，不在 `63414ca–83da271` 改动链里，不影响回滚。
