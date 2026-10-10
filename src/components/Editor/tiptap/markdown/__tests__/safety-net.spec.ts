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

/**
 * Trae 第二轮对抗探针 N1~N5 + N6（2026-10-11 本方逐条实跑复现）
 *
 * 共同特征：**都是「批次 1~3 的修复打开的新路径」**——以前这些输入整块解析不进去、
 * 或者根本进不了这个分支；修好之后能进去了，于是走到了没有测试覆盖的角落。
 *
 * 现状：**N1 / N3 已修**（同批修好，判据已翻成「必须正确」，见下）；
 *       **N2 / N4 / N5 待修**，判据写成「**确认它仍然坏**」——修好即转红（提示删登记 + 移出台账）。
 *
 * 逐条实跑值（两轮 roundTrip，2026-10-11）：
 *   N1 `| x $$b$$ y |`      → 修前：R1 `x $$<br>b<br>$$<br> y` → R2 每行再多一层 `<br>`，
 *                             **R1≠R2≠R3，永不收敛、每存一次文件变异一次**（P1）
 *   N2 `[^1]: 首段` + 4 空格缩进列表 → R1 第二项逃到列 0；R2 **整项迁移到脚注节之前**（换位）
 *   N3 `正文 $$a$$ 续文` / `## 标题 $$a$$` → 修前 R1≠R2（首轮漂移 + 段落被拆）
 *   N4 `[^1]: 首段` + 4 空格缩进围栏 → 围栏与**语言名 `js` 两个内容字符**一起丢，降级为缩进段落
 *   N5 callout 内嵌 callout → 内层 `[!TIP]` 退化成字面 `\[!TIP]`（类型丢失，收敛）
 */
describe('Trae 第二轮 N1~N6（N1/N3 已修；N2/N4/N5 待修）', () => {
  it('【已修】N1 单元格内块级数学：降级为行内公式、不再每存一次变异', () => {
    // 修法：`math_inline_double` 在「单行容器」（表格单元格 / 标题）里落**行内**公式。
    // 单元格装不下块级内容，硬塞会被 cellToText 把换行换成 <br>、再看回来又被当成
    // 公式 ⇒ 每轮多一层。降级后落盘是单行 `$b$`，内容与数学语义都不丢。
    const src = '| a | b |\n| --- | --- |\n| x $$b$$ y | z |\n';
    const r1 = roundTrip(src);
    expect(r1, '必须一次收敛（原文每存一次变异一次）').toBe(roundTrip(r1));
    expect(r1).not.toContain('<br>');
    expect(r1).toContain('$b$');
    // `$$`→`$` 是行内化的必然归一；**内容字符一个都不能少**
    expect(reopenDrift(src, r1).join('\n'), '不得丢内容字符').not.toContain('正向包含');
  });

  it('【已修】N1b 单元格独占 / N3b 标题内：同样降级行内', () => {
    const cell = roundTrip('| a | b |\n| --- | --- |\n| $$b$$ | z |\n');
    expect(cell).toBe(roundTrip(cell));
    expect(cell).toContain('$b$');

    const heading = roundTrip('## 标题 $$a$$\n');
    expect(heading, '标题不得被从中切断').toBe(roundTrip(heading));
    expect(heading).toContain('$a$');
  });

  it('【回归】独占一行的 $$ 仍必须是行间公式（F2 原形态不许改坏）', () => {
    const src = '正文\n$$\nE=mc^2\n$$\n';
    const r1 = roundTrip(src);
    expect(r1).toBe(roundTrip(r1));
    expect(r1, '独占一行 ⇒ 仍是行间公式').toContain('$$\nE=mc^2\n$$');
    // 容器内同理（列表项 / 引用）
    for (const s of ['- 项\n\n  $$\n  E=mc^2\n  $$\n', '> 正文\n> $$\n> E=mc^2\n> $$\n']) {
      const o = roundTrip(s);
      expect(o, `应保持行间公式：${JSON.stringify(s)}`).toBe(roundTrip(o));
      expect(o).toContain('$$');
    }
  });

  it('【已修】N3 行中间的 $$ 视为行内公式、段落不再被切断', () => {
    // 修法：用前一个兄弟 token 判定「是否独占一行」——行中间写的 `$$a$$` 是行内公式。
    for (const src of ['正文 $$a$$ 续文\n', '> 引用 $$a$$\n']) {
      const r1 = roundTrip(src);
      expect(r1, `应一次收敛：${JSON.stringify(src)}`).toBe(roundTrip(r1));
      expect(r1, '不应再切成公式块').not.toContain('$$');
    }
  });

  it('N2 脚注续块为列表：列表项逃逸 + 换位、不收敛（待修）', () => {
    const src = '文字[^1]\n\n[^1]: 首段\n\n    - x\n    - y\n';
    const r1 = roundTrip(src);
    const r2 = roundTrip(r1);
    expect(r1, 'N2 已修好？请删登记并同步台账 §二').not.toBe(r2);
    expect(r1, '第二项应仍逃到列 0').toContain('\n- y');
  });

  it('N4 脚注续块为围栏代码：围栏与语言名一起丢（待修）', () => {
    const src = '文字[^1]\n\n[^1]: 首段\n\n    ```js\n    x\n    ```\n';
    const r1 = roundTrip(src);
    expect(r1, 'N4 已修好？请删登记并同步台账 §二').not.toContain('js');
    expect(r1).toContain('x'); // 正文内容仍在（丢的是围栏与语言名）
  });

  it('N5 callout 内嵌 callout：内层类型退化成字面量', () => {
    const src = '> [!NOTE]\n> > [!TIP]\n> > 内容\n';
    const r1 = roundTrip(src);
    expect(r1, 'N5 已修好？请删登记并同步台账 §二').toContain('\\[!TIP]');
  });

  /**
   * N6 单独判：**不能**用 `behaviorSignature`（它是对「自身 parse vs 重开后 parse」，
   * 而 `==` 的配对在 solo 的**首次解析**就已经失败 ⇒ 两个 doc 一样 ⇒ 判据报绿）。
   * 与 B1 同源的失明。改用「是否被字面转义」这个直接证据 —— 与台账 §二 #33 同一根因
   * （`==` 配对失败即被按字面转义），属其**跨型交叉姊妹形态**。
   */
  it('N6 跨型交叉 mark：highlight 静默丢、== 被字面转义', () => {
    const src = '**foo ==bar** baz==\n';
    const r1 = roundTrip(src);
    expect(r1, 'N6 已修好（== 能配对了）？请删登记并同步台账 §二').toContain('\\=\\=');
  });
});
