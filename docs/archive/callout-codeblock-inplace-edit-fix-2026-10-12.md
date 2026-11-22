# 「点标签弹白框」修复说明（供第三方检测）

> 对象：solo 编辑器两处徽章式标签的就地编辑修复。提交均在 master、**未 push**。
> 检测人无需项目背景，按「怎么检测」逐条验即可。

## 一、问题（修复前）

1. **重点格式（callout）顶部标题**，如 `> [!NOTE]` 显示的 NOTE：点击后不在原文字上编辑，而是弹出一个**白底输入框**；没设过标题时框是空的，要整个重打；且按钮显示大写 `NOTE`，点开框里是小写 `note`（大小写翻转）。
2. **代码块语言标签**，如 `JAVASCRIPT`：同样弹白底定宽框；无语言时按钮显示 `PLAIN TEXT` 而点开是空框；同样大小写翻转。
3. 根因：交互照搬了「按钮整个换成 input」的旧模式，预填的是存储的原始值而非屏幕上显示的文字，输入框是独立的白底框样式。

## 二、修复内容（2 个提交，6 文件）

- `5b56e8e` fix(callout)：点标题文字**就地**变成输入框，预填当前显示的文字（有标题填标题，无标题填类型名 NOTE）；文字没动就什么都不写；输入框改透明无边框、宽度跟随内容、大写规则与按钮同源（存的仍是小写）。
- `0a6e95b` fix(code-block)：同款修法应用到语言标签；并修掉一个特有坑——无语言时显示的 `plain text` 是"无语言"的人话标签而非真语言，原样失焦会被误存成 highlight.js 不认识的假语言、导致高亮行为改变，现已加守卫不会写库。
- 改动文件：`src/components/Editor/tiptap/extensions/callout.ts`、`src/components/Editor/tiptap/extensions/code-block.ts`、`src/components/Editor/tiptap/editor.css`、`src/components/Editor/tiptap/extensions/__tests__/callout.spec.ts`、`src/components/Editor/tiptap/extensions/__tests__/code-block.spec.ts`（`3d60b35` 是顺带的 lint 红灯修复，与本次无关）。

## 三、怎么检测

**手动（用户已确认通过，可复核）**：
1. 打开含 callout 的文档，点顶部 `NOTE` → 应在**原位置**出现输入框、预填 `NOTE`（大写不变）→ 直接改字、回车即存；不改点走 → 无任何变化。
2. 点代码块语言标签 → 同上；无语言块（显示 `PLAIN TEXT`）→ 点开预填 `plain text`，原样失焦不写入。

**自动化**：
3. `bun run vitest run src/components/Editor/tiptap` → 应 1654 过 / 1 跳。
4. `npx vue-tsc --noEmit` → 0 错误。
5. 反向证据：把 `5b56e8e`/`0a6e95b` 的代码改动撤掉（`git revert` 后不重跑提交、或 `git stash` 对应文件），新加的 7 条行为锁中各有 2 条会转红——证明锁不是假绿。

## 四、回滚

`git revert 5b56e8e 0a6e95b`（`3d60b35` 可留）。
