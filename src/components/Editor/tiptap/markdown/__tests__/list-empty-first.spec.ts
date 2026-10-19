/**
 * 空首子项不得被写成 setext 下划线（2026-10-19 体检 P1）。
 *
 * 病：父项下有**第一个子项为空**的列表，旧序列化写成
 *   `- A`
 *   `  - `          ← 这一行只剩一个 `-`
 * 紧跟段落的一行 `-` 在 CommonMark 里是 **setext 二级标题下划线** ⇒ 重开时
 * 「A」变成 H2（任务项连勾选框一起变成标题文字），再存成 `- ## A`。
 *
 * 药：`renderContent` 遇到「前一块是有文字的段落 + 子列表是 bulletList 且首项为
 * 空 listItem」⇒ 用空行断开。其余嵌套列表保持紧凑单换行（输出一个字节不变）。
 *
 * 本文件是**行为级**锁：走真实 `parse → serialize → parse`，既断言落盘形态，
 * 也断言重开后没有凭空多出 heading（只比字符串会漏掉「字符串合法但语义变了」）。
 */
import { describe, it, expect } from 'vitest';
import { createTestSchema, roundTrip } from './test-utils';
import { parseMarkdown } from '../parser';

const schema = createTestSchema();

/** 文档里所有标题（重开后不该凭空出现） */
function headingTexts(md: string): string[] {
  const out: string[] = [];
  parseMarkdown(schema, md).descendants((node) => {
    if (node.type.name === 'heading') out.push(`H${node.attrs.level}:${node.textContent}`);
    return true;
  });
  return out;
}

describe('空首子项：用空行断开 setext 歧义（2026-10-19 P1）', () => {
  it('父项 + 空首子项：落盘带空行，重开不变标题', () => {
    const out = roundTrip('- A\n\n  - \n');
    expect(out).toBe('- A\n\n  - \n');
    expect(headingTexts(out)).toEqual([]);
  });

  it('两轮稳定：空行不被收紧（第二、三次保存都不漂）', () => {
    const once = roundTrip('- A\n\n  - \n');
    const twice = roundTrip(once);
    expect(twice).toBe(once);
    expect(headingTexts(twice)).toEqual([]);
  });

  it('空首子项后面还有兄弟：仍然断开', () => {
    const out = roundTrip('- A\n\n  - \n  - A2\n');
    expect(out).toBe('- A\n\n  - \n  - A2\n');
    expect(headingTexts(out)).toEqual([]);
  });

  it('任务项同样处理（勾选框不能被读成标题文字）', () => {
    const out = roundTrip('- [ ] A\n\n  - \n');
    expect(headingTexts(out)).toEqual([]);
    expect(out).toContain('\n\n  - ');
  });

  it('普通嵌套列表不受影响：仍是紧凑单换行', () => {
    expect(roundTrip('- A\n  - A1\n')).toBe('- A\n  - A1\n');
    expect(roundTrip('- A\n  - A1\n  - A2\n')).toBe('- A\n  - A1\n  - A2\n');
  });

  it('空项不在首位：不加空行（无 setext 风险）', () => {
    expect(roundTrip('- A\n  - A1\n  - \n')).toBe('- A\n  - A1\n  - \n');
  });
});
