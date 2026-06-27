import { describe, it, expect } from 'vitest';
import { roundTrip, randInt, pick } from './test-utils';

// ── 随机 markdown 生成器 ────────────────────────────────────────

const WORDS = [
  'hello', 'world', 'test', 'markdown', '中文', '测试', '文档',
  'alpha', 'beta', 'code', 'data', 'note', 'foo', 'bar', 'baz',
  '重点', '说明', '示例', '参数', '配置', '部署', '优化',
];

function randomText(): string {
  const len = randInt(2, 6);
  return Array.from({ length: len }, () => pick(WORDS)).join(' ');
}

function randomSegment(): string {
  const text = randomText();
  const r = Math.random();

  // code 优先返回（排除其他嵌套）
  if (r < 0.08) return `\`${text}\``;
  // bold + italic
  if (r < 0.15) return `***${text}***`;
  // bold
  if (r < 0.35) return `**${text}**`;
  // italic
  if (r < 0.50) return `*${text}*`;
  // strikethrough
  if (r < 0.60) return `~~${text}~~`;
  // highlight
  if (r < 0.70) return `==${text}==`;
  // plain
  return text;
}

function generateFuzzMarkdown(): string {
  const paragraphCount = randInt(1, 5);
  const paras: string[] = [];

  for (let i = 0; i < paragraphCount; i++) {
    const segmentCount = randInt(2, 7);
    const parts = Array.from({ length: segmentCount }, () => randomSegment());
    paras.push(parts.join(' '));
  }

  return paras.join('\n\n');
}

describe('Fuzz roundtrip stability', () => {
  for (let i = 0; i < 100; i++) {
    it(`case ${i + 1}`, () => {
      const input = generateFuzzMarkdown();

      // 第 1 轮：parse → serialize，不应抛异常
      const round1 = roundTrip(input);

      // 第 2 轮：用 round1 再走一遍
      const round2 = roundTrip(round1);

      // 两轮输出一致 = 稳定
      expect(round2).toBe(round1);
    });
  }
});
