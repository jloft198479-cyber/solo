/**
 * Fuzz 保真测试（随机组合压测）
 *
 * 与 fixtures 测试互补：fixtures 覆盖「人工列举的典型写法」，fuzz 覆盖「组合爆炸」——
 * 结构块随机拼接，容易撞出人手想不到的交互。
 *
 * 历史上本文件只断言「稳定性」（round2 === round1），而生成器只产**段落 + 行内样式**，
 * 结构语法（列表 / 表格 / 任务列表 / 引用 / 代码块 / 标题）**零覆盖**——
 * 所以它能一直绿，却对混排列表丢内容毫无察觉。
 *
 * 现在三处都补上：
 *   ① 生成器扩展到结构块；
 *   ② 断言加「重开等价」（内容不丢，独立参照系）与「稳定性」；
 *   ③ 随机源**种子化**（同种子 → 同序列）——失败可原样重放，不再「偶发红无法定位」。
 *
 * 注：字节保真**不做硬断言**——结构语法必然带来格式规整（表格对齐、列表松散化等），
 * 那些是设计选择，不是事故。内容不丢才是底线。
 *
 * 复现某条失败：报文里会打印 `seed`，设 `FUZZ_SEED=<seed>` 单跑即可。
 */
import { describe, it, expect } from 'vitest';
import { roundTrip, reopenDrift, makeRand, randInt, pick, type Rand } from './test-utils';

/** 基种子：固定值保证 CI 可复现；`FUZZ_SEED` 可覆盖，用于本地探索新组合 */
const BASE_SEED = Number(process.env.FUZZ_SEED ?? 0x5eed);
const CASES = 200;

// ── 随机 markdown 生成器（全部走种子化随机源）────────────────────

/**
 * 词表（G5 扩充：CJK 标点 / `_` / 表格竖线 —— 这些都是「组合叠加」的触发剂）。
 *
 * 为什么词表本身就是判据的一部分：历史上 #35（强调里包行内代码 + 闭合符后接标点）
 * 的病灶就是「该组合不在生成器词表里」——生成器看不见的形态，fuzz 永远撞不到。
 */
const WORDS = [
  'hello', 'world', 'test', 'markdown', '中文', '测试', '文档',
  'alpha', 'beta', 'code', 'data', 'note', 'foo', 'bar', 'baz',
  '重点', '说明', '示例', '参数', '配置', '部署', '优化',
  // CJK 标点（属 \p{P}，正是 flanking / 转义规则最敏感的一类）
  '重点、说明', '「引用」', '（括号）', '甲；乙', '问题？', '第一：',
  // `_` 选择性转义的对象（B1）
  'snake_case', 'a_b_c', 'foo_bar',
  // 表格竖线（转义形态 \| ，跨单元格必须保住）
  'x\\|y', '甲\\|乙',
];

function randomText(rng: Rand): string {
  const len = randInt(rng, 2, 6);
  return Array.from({ length: len }, () => pick(rng, WORDS)).join(' ');
}

/**
 * 行内片段生成器（G5 扩充）。
 *
 * 新增三类此前**零覆盖**的形态：
 *  - `_斜体_`（B1 的选择性转义对象）、`^上标^` / `~下标~`（sup/sub 容器）；
 *  - 链接 / 图片 / 行内 `$数学$`；
 *  - **mark 套 mark**：`**`code`**`、`==[文](url)==` —— 外层更长、内层更短，
 *    正是 §2 #1（定界符开启序）的病灶区；旧生成器从不把 code 嵌进别的 mark。
 */
function randomSegment(rng: Rand): string {
  const text = randomText(rng);
  const r = rng();

  if (r < 0.07) return `\`${text}\``;
  if (r < 0.12) return `***${text}***`;
  if (r < 0.24) return `**${text}**`;
  if (r < 0.32) return `*${text}*`;
  if (r < 0.38) return `~~${text}~~`;
  if (r < 0.44) return `==${text}==`;
  if (r < 0.48) return `_${text}_`;
  if (r < 0.52) return `^${text}^`;
  if (r < 0.56) return `~${text}~`;
  if (r < 0.64) return `[${text}](https://x.com/a)`;
  if (r < 0.68) return `![${text}](https://x.com/a.png)`;
  if (r < 0.72) return `$${text.replace(/\s/g, '')}$`;
  if (r < 0.80) return `**\`${text}\`**`;
  if (r < 0.86) return `==[${text}](https://x.com/a)==`;
  return text;
}

function genParagraph(rng: Rand): string {
  const segmentCount = randInt(rng, 2, 7);
  return Array.from({ length: segmentCount }, () => randomSegment(rng)).join(' ');
}

function genHeading(rng: Rand): string {
  return `${'#'.repeat(randInt(rng, 1, 3))} ${randomText(rng)}`;
}

function genBulletList(rng: Rand): string {
  return Array.from({ length: randInt(rng, 2, 4) }, () => `- ${randomSegment(rng)}`).join('\n');
}

function genOrderedList(rng: Rand): string {
  return Array.from({ length: randInt(rng, 2, 4) }, (_, i) => `${i + 1}. ${randomSegment(rng)}`).join('\n');
}

function genTaskList(rng: Rand): string {
  return Array.from(
    { length: randInt(rng, 2, 4) },
    () => `- [${rng() < 0.5 ? ' ' : 'x'}] ${randomText(rng)}`,
  ).join('\n');
}

function genNestedList(rng: Rand): string {
  const lines: string[] = [];
  for (let i = 0, n = randInt(rng, 2, 3); i < n; i++) {
    lines.push(`- ${randomText(rng)}`);
    if (rng() < 0.6) {
      for (let j = 0, m = randInt(rng, 1, 2); j < m; j++) lines.push(`  - ${randomText(rng)}`);
    }
  }
  return lines.join('\n');
}

function genFence(rng: Rand): string {
  const lang = pick(rng, ['', 'js', 'ts', 'bash']);
  const body = Array.from({ length: randInt(rng, 1, 3) }, () => randomText(rng)).join('\n');
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

function genBlockquote(rng: Rand): string {
  return Array.from({ length: randInt(rng, 1, 3) }, () => `> ${randomText(rng)}`).join('\n');
}

function genTable(rng: Rand): string {
  const cols = randInt(rng, 2, 3);
  const row = () => `| ${Array.from({ length: cols }, () => randomText(rng)).join(' | ')} |`;
  const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
  const body = Array.from({ length: randInt(rng, 1, 3) }, row);
  return [row(), sep, ...body].join('\n');
}

/**
 * 含**转义竖线**的表格（G5）：单元格里出现 `\|` 或 `` `x\|y` ``。
 * 这是 #3 / §2 那条「单元格内裸竖线会切断该行」的**合法对照形态**——裸竖线属已知
 * 读取侧缺口（由 `safety-net.spec.ts` 单独锁定），这里只压**转义形态必须往返保住**。
 */
function genTableWithPipe(rng: Rand): string {
  const cols = randInt(rng, 2, 3);
  const cell = () => (rng() < 0.5 ? '`x\\|y`' : '甲\\|乙');
  const row = () => `| ${Array.from({ length: cols }, () => (rng() < 0.45 ? cell() : randomText(rng))).join(' | ')} |`;
  const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
  const body = Array.from({ length: randInt(rng, 1, 2) }, row);
  return [row(), sep, ...body].join('\n');
}

/**
 * 脚注（定义 + 引用）（G5）：`[^n]: …` 的多段形态曾是 #6 的病灶。
 *
 * ⚠️ 标签必须**逐块唯一**（用块序号当后缀）。原因：solo 对**重复标签**的多个定义
 * 会静默丢掉较早那个的正文（见 `safety-net.spec.ts` 的登记锁）。生成器若随机撞出
 * 重复标签，fuzz 会红在一个已知缺口上，把「新问题」的信号淹掉。
 */
function genFootnote(rng: Rand, seq: number): string {
  const n = randInt(rng, 1, 2);
  const labels = Array.from({ length: n }, (_, i) => `f${seq}${i}`);
  const body = labels.map((lb, i) => `文字${i}[^${lb}]`).join(' ');
  const defs = labels.map((lb) => `[^${lb}]: ${randomText(rng)}`).join('\n\n');
  return `${body}\n\n${defs}`;
}

/** 块级数学（G5）：`$$…$$` 独占块，旧版在容器内会逐轮加深缩进（#5） */
function genMathBlock(rng: Rand): string {
  return `$$\nE = mc^${randInt(rng, 1, 9)}\n$$`;
}

/** 结构块生成器（`seq` = 块序号，供脚注标签去重） */
function genBlock(rng: Rand, seq: number): string {
  const r = rng();
  if (r < 0.18) return genParagraph(rng);
  if (r < 0.26) return genHeading(rng);
  if (r < 0.36) return genBulletList(rng);
  if (r < 0.43) return genOrderedList(rng);
  if (r < 0.49) return genTaskList(rng);
  if (r < 0.56) return genNestedList(rng);
  if (r < 0.63) return genFence(rng);
  if (r < 0.70) return genBlockquote(rng);
  if (r < 0.78) return genTable(rng);
  if (r < 0.84) return genTableWithPipe(rng);
  if (r < 0.90) return genFootnote(rng, seq);
  if (r < 0.95) return genMathBlock(rng);
  return '---';
}

/**
 * 自由拼接结构块。
 *
 * 注意：相邻的两个「`-` 标记族」列表块会被 markdown-it 合并为**同一个列表**
 * （空行分隔也一样）——合并后可能出现「普通项 + 任务项同层混排」。这曾是 #10 的
 * 触发形态，为此生成器一度用段落强制隔离；#10 修复后约束已去掉，让该形态重新
 * 进入覆盖范围（若哪天回退，这里会立刻刷红）。
 */
function generateFuzzMarkdown(rng: Rand): string {
  const blockCount = randInt(rng, 1, 5);
  return Array.from({ length: blockCount }, (_, i) => genBlock(rng, i)).join('\n\n');
}

describe('Fuzz 保真', () => {
  for (let i = 0; i < CASES; i++) {
    // 每条用例独立种子 ⇒ 彼此不耦合，失败报文里的 seed 可直接重放
    const seed = BASE_SEED + i;
    it(`case ${i + 1} (seed ${seed})`, () => {
      const input = generateFuzzMarkdown(makeRand(seed));

      // 第 1 轮：parse → serialize，不应抛异常
      const round1 = roundTrip(input);

      // 稳定性：序列化器收敛
      expect(roundTrip(round1), `收敛性失败，seed=${seed}`).toBe(round1);

      // 重开等价：内容不丢（独立参照系，抓列表/表格等结构块被吞）
      expect(reopenDrift(input, round1), `保真失败，seed=${seed}，输入：\n${input}`).toEqual([]);
    });
  }
});
