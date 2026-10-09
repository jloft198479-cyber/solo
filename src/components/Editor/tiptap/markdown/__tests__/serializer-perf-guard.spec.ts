/**
 * 序列化「不得退回 O(n²)」回归闸门（M-27）
 *
 * 背景：`MarkdownSerializerState.output` 曾用字符串 `+=` 累加，而 `ensureNewline()` /
 * `blankLine()` 每次都读 `output.length` / `endsWith(…)` ⇒ **读取即强制扁平化整串**，
 * 单块 O(n)、累计 O(n²)。2026-09-15 改成数组 `chunks` 后复杂度回到线性（20k 块 146×），
 * 但**没有任何防线**——改回 `+=` 只会变慢、不会变红。
 *
 * 这里用源码结构断言补上（同 `mark-delimiter-coverage.spec.ts` 的做法）：
 * 比计时断言稳定，且直接钉住根因形态。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('src/components/Editor/tiptap/markdown/serializer.ts', 'utf8');

describe('serializer 不得退回 O(n²) 的字符串累加', () => {
  it('输出缓冲不是字符串形 `this.output += …`', () => {
    expect(SRC).not.toMatch(/this\.output\s*\+=/);
  });

  it('输出缓冲是数组 chunks（结构锚点）', () => {
    expect(SRC).toMatch(/chunks\s*:\s*string\[\]/);
  });
});
