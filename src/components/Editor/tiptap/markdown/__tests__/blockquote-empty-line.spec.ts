/**
 * 引用块空行的写出形态锁（审计 2026-10-25 B-2）。
 *
 * 我防的事故：`> 甲\n>\n> 乙`（外部编辑器常见写法）首存把空行写成 `> `（带
 * 尾随空格）——渲染等价、二轮也收敛，但**首存即改文件字节**，且与 callout
 * 序列化器（B10 修过同款）口径不一致。修法：空行输出干净的 `>`。
 *
 * 反向校准（准入②，执行时已做）：撤掉三元分支 ⇒ 全部转红。
 */
import { describe, expect, it } from 'vitest';
import { roundTrip } from './test-utils';

describe('引用块空行：输出干净的 >（B-2）', () => {
  it('> 甲 / > / > 乙：空行不带尾随空格，二轮收敛', () => {
    const r1 = roundTrip('> 甲\n>\n> 乙');
    expect(r1, '空行必须是 ">"').toContain('\n>\n');
    expect(r1, '不得产出 "> "（尾随空格）').not.toContain('> \n');
    expect(roundTrip(r1)).toBe(r1);
  });

  it('内容行照常带前缀（不误伤）', () => {
    const r1 = roundTrip('> 甲\n>\n> 乙');
    expect(r1).toContain('> 甲');
    expect(r1).toContain('> 乙');
  });
});
