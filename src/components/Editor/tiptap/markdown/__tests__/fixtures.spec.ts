import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundTrip } from './test-utils';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

const fixtureFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.md'));

describe('Fixture roundtrip stability', () => {
  for (const file of fixtureFiles) {
    it(file, () => {
      const md = readFileSync(resolve(FIXTURES_DIR, file), 'utf-8');

      // 第 1 轮：parse → serialize，不应抛异常
      const round1 = roundTrip(md);

      // 第 2 轮：用 round1 输出再走一遍 parse → serialize
      const round2 = roundTrip(round1);

      // 两轮输出一致 = 序列化器稳定
      expect(round2).toBe(round1);
    });
  }
});
