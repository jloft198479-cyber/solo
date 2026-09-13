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

const WORDS = [
  'hello', 'world', 'test', 'markdown', '中文', '测试', '文档',
  'alpha', 'beta', 'code', 'data', 'note', 'foo', 'bar', 'baz',
  '重点', '说明', '示例', '参数', '配置', '部署', '优化',
];

function randomText(rng: Rand): string {
  const len = randInt(rng, 2, 6);
  return Array.from({ length: len }, () => pick(rng, WORDS)).join(' ');
}

function randomSegment(rng: Rand): string {
  const text = randomText(rng);
  const r = rng();

  // code 优先返回（排除其他嵌套）
  if (r < 0.08) return `\`${text}\``;
  // bold + italic
  if (r < 0.15) return `***${text}***`;
  // bold
  if (r < 0.35) return `**${text}**`;
  // italic
  if (r < 0.5) return `*${text}*`;
  // strikethrough
  if (r < 0.6) return `~~${text}~~`;
  // highlight
  if (r < 0.7) return `==${text}==`;
  // plain
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

/** 结构块生成器 */
function genBlock(rng: Rand): string {
  const r = rng();
  if (r < 0.22) return genParagraph(rng);
  if (r < 0.32) return genHeading(rng);
  if (r < 0.44) return genBulletList(rng);
  if (r < 0.53) return genOrderedList(rng);
  if (r < 0.61) return genTaskList(rng);
  if (r < 0.69) return genNestedList(rng);
  if (r < 0.77) return genFence(rng);
  if (r < 0.85) return genBlockquote(rng);
  if (r < 0.92) return genTable(rng);
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
  return Array.from({ length: blockCount }, () => genBlock(rng)).join('\n\n');
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
