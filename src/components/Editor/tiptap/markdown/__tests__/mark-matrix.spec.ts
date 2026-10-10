/**
 * 行为级 mark 矩阵（批次 4 · G4，治 B7）
 *
 * 为什么需要它：`mark-delimiter-coverage.spec.ts` 是**从源码正则抠 `case 'xxx'` 名**，
 * 只能证明「序列化器里有个分支」，**证明不了「写出去还能重开」**——于是 §2 #1 的
 * 18 组不守恒（外层 mark 与内层 mark 同起点、外层更长 ⇒ 定界符交叉）在它眼下**全绿**。
 * 本文件改成**行为级**：构造 → 落盘 → 重开 → 比对两个 PM doc 的「文本 ⊕ mark 集合」。
 *
 * 判据（比字节更强也更准）：
 *   `parse(src)` 与 `parse(serialize(parse(src)))` 摊平后的 `文本|mark集合` 序列必须一致。
 *   —— 字节层面允许格式规整（定界符顺序归一、多余空格），只要**每个字的 mark 集合不变**。
 *
 * 未登记的用例必须全绿；已登记的（ProseMirror 平铺 mark 模型限制，短期修不了）
 * 带**双向锁**：真修好了会转红，提示把该行删掉。
 */
import { describe, it, expect } from 'vitest';
import { roundTrip, behaviorSignature } from './test-utils';

/**
 * 已知模型限制（ProseMirror 平铺 marks 不记嵌套深度）——登记即**锁定**，不得新增。
 * 判据与 fixtures 的 `KNOWN_FIDELITY_GAPS` 同款：修好了转红提示删行。
 */
const KNOWN_UNCONSERVED: Record<string, string> = {};

/** 矩阵：[用例名, 源 markdown] */
const CASES: Array<[string, string]> = [
  // ── 单 mark 基线（都应守恒） ─────────────────────────────
  ['单 strong', '**加粗**\n'],
  ['单 em', '*斜体*\n'],
  ['单 del', '~~删除~~\n'],
  ['单 mark', '==高亮==\n'],
  ['单 code', '`代码`\n'],
  ['单 sup', '^上标^\n'],
  ['单 sub', '~下标~\n'],
  ['单 link', '[文字](https://x.com)\n'],

  // ── 外层长 / 内层短（#1 的主病灶：定界符交叉） ───────────
  ['link 在 strong 内（外层更长）', '**[文字](https://x.com) 后文**\n'],
  ['link 在 em 内（外层更长）', '*[文字](https://x.com) 后文*\n'],
  ['link 在 del 内（外层更长）', '~~[文字](https://x.com) 后文~~\n'],
  ['link 在 mark 内（外层更长）', '==[文字](https://x.com) 后文==\n'],
  ['link 在 strong 内（外层更短）', '**前文 [文字](https://x.com)**\n'],

  // ── 同起点同终点（同范围）─────────────────────────────
  ['mark 包 code（同范围）', '==`代码`==\n'],
  ['strong 包 code（同范围）', '**`代码`**\n'],
  ['del 包 code（同范围）', '~~`代码`~~\n'],
  ['strong 包 del（同范围）', '**~~文字~~**\n'],
  ['mark 包 del（同范围）', '==~~文字~~==\n'],

  // ── 嵌套：外层长、内层短 ───────────────────────────────
  ['strong 内嵌 em', '**前 *内* 后**\n'],
  ['em 内嵌 strong', '*前 **内** 后*\n'],
  ['strong 内嵌 code', '**前 `内` 后**\n'],
  ['mark 内嵌 code', '==前 `内` 后==\n'],
  ['del 内嵌 strong', '~~前 **内** 后~~\n'],

  // ── 三件套叠加（组合爆炸区）────────────────────────────
  ['strong 内嵌 link 与 code', '**前 [文](https://x.com) `码` 后**\n'],
  ['strong 内嵌 link 与 code（短）', '**`码` [文](https://x.com)**\n'],
  ['mark 内嵌 link 与 del', '==前 [文](https://x.com) ~~删~~ 后==\n'],
  ['同日多层：strong>mark>code', '**==`码`==**\n'],

  // ── 同型相邻（CommonMark 下 `**a **b** c**` 本就**不是**嵌套，而是两段平铺
  //    strong + 中间无 mark —— 锁住「别把它当嵌套修」）────────────────
  ['strong 相邻同型', '**前 **内** 后**\n'],
  ['em 相邻同型', '*前 *内* 后*\n'],

  // ── 跨型交叉（Trae 第二轮 N6）────────────────────────────
  ['跨型交叉 mark（N6）', '**foo ==bar** baz==\n'],

  // ── 跨行 / 语境（表格单元格、列表项、引用）──────────────
  ['表格单元格内 code 含竖线', '| a | b |\n| --- | --- |\n| `x\\|y` | z |\n'],
  ['列表项内 strong+link', '- **前 [文](https://x.com) 后**\n'],
  ['引用内 mark+code', '> ==前 `码` 后==\n'],
  ['标题内 link', '## [标题](https://x.com)\n'],
];

describe('行为级 mark 矩阵（G4）', () => {
  for (const [name, src] of CASES) {
    it(name, () => {
      const out = roundTrip(src);
      const got = behaviorSignature(out);
      const expected = behaviorSignature(src);
      const gap = KNOWN_UNCONSERVED[name];

      if (gap) {
        expect(
          got,
          `「${name}」已登记为模型限制（${gap}），但现在已守恒 —— 若确已修好，请删掉该登记`,
        ).not.toEqual(expected);
        return;
      }
      expect(got, `「${name}」落盘重开后 mark/文本不守恒。源：${JSON.stringify(src)} 输出：${JSON.stringify(out)}`).toEqual(expected);
    });
  }
});
