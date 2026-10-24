/**
 * 「成对触发」转义的计数锁（审计 2026-10-25 P2-1，核实后按 P1 对待）。
 *
 * 我防的事故：`computePairEscape` 只数 `parent.textContent` —— 序列化器自己
 * 写出的 `$` / `^` / `==` 定界符不在里面 ⇒ 「一个字面 `$` + 一个行内公式」被
 * 数成单个 ⇒ 不转义 ⇒ 重开时定界符与字面量重新配对。中文形态
 * `价格\$5 对比 $x$ 公式` 整段「$5 对比 $x」被吞成一个公式（核实报告真跑复现）。
 *
 * 同族修法顺带：行内 code 的内容**不**参与计数（它在反引号里，重开不参与
 * 配对；旧版计入会让 `` `a^b` x^2 `` 首存平白多出 `\^`，属「首存即改文件」族）。
 *
 * 反向校准（准入②，执行时已做）：计数退回 textContent 版 ⇒ 本文件全部转红。
 */
import { describe, expect, it } from 'vitest';
import { behaviorSignature, roundTrip } from './test-utils';

describe('成对转义计数：按「写出的形态」算（P2-1）', () => {
  it('字面 $ 与行内公式同段：\\$ 保住，公式内容不搬家（字节保真）', () => {
    const md = '价格\\$5 对比 $x$ 公式';
    expect(roundTrip(md)).toBe(md + '\n');
  });

  it('a\\$b$x$：同族最小形态字节保真', () => {
    const md = 'a\\$b$x$';
    expect(roundTrip(md)).toBe(md + '\n');
  });

  it('字面 ^ 与上标同段：上标内容不搬家', () => {
    const md = '甲\\^1^2^ b';
    const r1 = roundTrip(md);
    expect(r1, '字面 ^ 必须转义').toContain('\\^');
    expect(behaviorSignature(r1), '重开后 mark 归属不变').toEqual(behaviorSignature(md));
    expect(roundTrip(r1), '二轮收敛').toBe(r1);
  });

  it('字面 == 与高亮同段：高亮内容不搬家', () => {
    const md = '甲\\==乙==丙== 丁';
    const r1 = roundTrip(md);
    // 既有转义形态是逐个 `=` 转义（`\=\=`），这里只锁「转义发生 + mark 不搬家」
    expect(r1).toContain('\\=\\=');
    expect(behaviorSignature(r1)).toEqual(behaviorSignature(md));
    expect(roundTrip(r1)).toBe(r1);
  });

  it('行内 code 不参与计数：单个 ^ 不再平白转义（首存零字节漂移）', () => {
    const md = '`a^b` x^2 y';
    expect(roundTrip(md)).toBe(md + '\n');
  });
});
