/**
 * 安全网自检（批次 4 · G1）
 *
 * 为什么单列一个文件：判据本身也要被证明「能抓到东西」。上一轮 `mark-delimiter-coverage`
 * 的教训（台账 §四 B7）就是——只证明「有分支」，不证明「写出去能重开」，于是 18 组
 * 不守恒全绿。本文件专门证明 **G1 的正向包含检查确实会响**，并顺手证明它**不误报**。
 *
 * 反向校准（验证口径 §8.3-4 要求）：把 `test-utils.ts` 里 G1 那段 `missingContentChars`
 * 检查注掉 → 本文件第 1 条必须转红。若它仍绿，说明防线是假的。
 */
import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import spec from 'commonmark-spec';
import { roundTrip, behaviorSignature, reopenDrift } from './test-utils';
import { SKIP } from './commonmark-skips';

describe('安全网自检 · G1 正向包含检查', () => {
  /**
   * B1 的典型形态（台账 §一 #29 / 本轮 §2 #3）：
   * 表格单元格里的**行内代码含裸竖线** —— markdown-it 切列时会把该行后半段丢掉，
   * **原文与输出都丢同一份** ⇒ 旧判据（可见文字多重集）差值恒为 0，报绿。
   *
   * ⚠️ 这条目前**应当被抓到**：批次 1 的 F3 只修了**写出侧**（序列化时把单元格内
   * code 的 `|` 转义），**读取侧**（切列前保护 code span 内的 `|`）未修 ⇒ 打开这类
   * 文件时内容仍会丢。谁修了读取侧，本条会转红 —— 转红即代表这个已知缺口消失，
   * 请把本用例改成「不得报错」并把台账对应条目移出待办。
   */
  it('能抓到「参照系两侧同丢」的隐形丢失（表格单元格里的裸竖线）', () => {
    const src = '| 列 A | 列 B |\n| --- | --- |\n| 说明 | `WM_MOVE|WM_MOVING` 调它 |\n';
    const out = roundTrip(src);

    const drift = reopenDrift(src, out);
    expect(drift.length, `应当抓到内容丢失，实际：${JSON.stringify(drift)}`).toBeGreaterThan(0);
    expect(drift.join('\n')).toContain('正向包含');
  });

  it('格式规整不得误报（必须返回空数组）', () => {
    // 分隔线归一（***→---）、列表序号归一、表格补空格、尾随空格 —— 全是设计选择
    const cases = [
      '***\n\n- 甲\n- 乙\n',
      '1. 甲\n2. 乙\n\n1. 丙\n2. 丁\n',
      '| a | b |\n|---|---|\n| 1 | 2 |\n',
      '正文   行尾两空格  \n下一行\n',
      '- [x] 已完成\n- [ ] 未完成\n',
    ];
    for (const src of cases) {
      const out = roundTrip(src);
      expect(reopenDrift(src, out), `误报：${JSON.stringify(src)}`).toEqual([]);
    }
  });

  it('真丢字（整段消失）必须双向被抓', () => {
    const src = '甲段落\n\n乙段落\n';
    // 人为构造「输出丢了乙段落」：直接喂一个缺内容的输出
    const drift = reopenDrift(src, '甲段落\n');
    expect(drift.join('\n')).toContain('正向包含');
  });
});

/**
 * 登记锁 · 脚注重复标签（2026-10-10 批次 4 · G5 撞出）
 *
 * 现象（P1 静默丢内容）：**同一个脚注标签出现多个定义时，较早那个定义的正文被整段丢弃**。
 *   输入 `文字[^1]\n\n[^1]: 甲定义\n\n[^1]: 乙定义\n`
 *   输出 `文字[^1]\n\n[^1]: 乙定义\n`   ← 「甲定义」连同它的段落一起消失，不报错
 * 正常情形（不同标签、同标签多次引用）不受影响 —— 见第 2 条。
 *
 * 双向锁：谁修好（两个定义都保住）就转红 → 请删掉本 describe 并同步台账。
 */
describe('登记锁 · 脚注重复标签丢正文（待修）', () => {
  const DUP = '文字[^1]\n\n[^1]: 甲定义\n\n[^1]: 乙定义\n';

  it('重复标签时较早定义仍被丢弃（修好后本用例转红）', () => {
    const out = roundTrip(DUP);
    expect(
      out,
      '脚注重复标签的丢失似乎已修好 —— 请删除本登记并同步 docs/KNOWN-ISSUES.md',
    ).not.toContain('甲定义');
  });

  it('不同标签 / 同标签多次引用不得受影响', () => {
    const ok = [
      '文字[^1] 又[^2]\n\n[^1]: 甲定义\n\n[^2]: 乙定义\n',
      '文字[^1] 又[^1]\n\n[^1]: 甲定义\n',
    ];
    for (const src of ok) {
      expect(roundTrip(src).trimEnd(), `不应丢内容：${JSON.stringify(src)}`).toBe(src.trimEnd());
    }
  });
});

/**
 * 登记锁 · CommonMark「静默丢格式」类 SKIP（G6）
 *
 * 为什么单独立锁：这 7 条长期只活在 `commonmark.spec.ts` 的 `SKIP` 注释里——
 * 既没进台账，也没人会发现「哪天修好了」。本处做**双向锁**：
 *   ① 登记项必须仍在 SKIP 表里（防两份清单漂移）；
 *   ② 登记项必须**仍真的丢格式**（行为签名不守恒）—— 修好了会转红，提示删登记 + 放开 SKIP。
 */
const KNOWN_SPEC_GAPS: Record<number, string> = {
  207: 'link ref: 引用定义整行被丢弃（`[foo]: /url` 存盘后整行消失 → 输出为空）',
  418: 'emphasis: 嵌套同型 marks 无法区分深度（strong 净丢 + 不收敛，模型限制）',
  432: 'emphasis: 同型 marks 嵌套无法序列化（同上）',
  484: 'link: 空 label 链接 `[](url)` 整行被丢弃（输出为空）',
  487: 'link: 空 label 链接 `[]()` 整行被丢弃（输出为空）',
};

describe('安全网自检 · G6 CommonMark 丢格式 SKIP 双向锁', () => {
  it('登记项必须仍在 commonmark 的 SKIP 表里', () => {
    const missing = Object.keys(KNOWN_SPEC_GAPS)
      .map(Number)
      .filter((n) => !SKIP[n]);
    expect(
      missing,
      `以下例子已不在 commonmark.spec.ts 的 SKIP 表里（两份清单漂移了）：${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('登记项必须仍不守恒（修好了请删登记并放开 SKIP）', () => {
    // 判据取「正反两面」——只判一面会误报「已修好」：
    //   ① 行为签名（自身 parse vs 重开后 parse）——抓「两侧同丢」以外的结构性差异；
    //   ② 参照系标签数下降（markdown-it 渲染原文 vs 渲染输出）——抓「格式静默降级」，
    //      这类差异在 ① 里看不见（原文自己 parse 时就已经丢了那层格式）。
    const ref = new MarkdownIt('commonmark', { html: false }).enable(['table', 'strikethrough']);
    const cnt = (html: string, tag: string) => (html.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;
    const TAGS = ['strong', 'em', 'code', 's', 'a', 'img', 'li', 'table'];

    const fixed: string[] = [];
    for (const numStr of Object.keys(KNOWN_SPEC_GAPS)) {
      const num = Number(numStr);
      const ex = spec.tests.find((t) => t.number === num);
      if (!ex) {
        fixed.push(`#${num} 在 commonmark-spec 里找不到该用例`);
        continue;
      }
      const out = roundTrip(ex.markdown);
      const behaviorDiff =
        JSON.stringify(behaviorSignature(out)) !== JSON.stringify(behaviorSignature(ex.markdown));
      const tagDrop = TAGS.some((tag) => cnt(ref.render(ex.markdown), tag) > cnt(ref.render(out), tag));
      // ③ 正向包含（同 G1）——抓「两侧参照系都看不见」的整行丢弃（#207/#484/#487 就是这类）
      const contentLoss = reopenDrift(ex.markdown, out).length > 0;
      if (!behaviorDiff && !tagDrop && !contentLoss) {
        fixed.push(`#${num} 已看不出缺口（原登记原因：${KNOWN_SPEC_GAPS[num]}）`);
      }
    }
    expect(fixed, `以下用例的缺口似乎已修好：\n  ${fixed.join('\n  ')}`).toEqual([]);
  });
});
