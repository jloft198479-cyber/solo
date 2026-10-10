/**
 * CommonMark spec roundtrip 测试
 *
 * 对 spec 中 652 条用例执行 parse→serialize→parse→serialize 两轮稳定性验证。
 * 目标是确保 parser + serializer 能正确处理所有 CommonMark 规范的语法组合，
 * 不会崩溃或产生非稳定输出。
 *
 * 不验证 HTML 输出正确性（那不是 roundtrip 关心的），
 * 只验证 md → PM doc → md → PM doc 是否收敛。
 *
 * ⚠️ 本文件**不是保真防线**：「收敛」不等于「内容没丢」——丢了内容的输出同样可以稳定
 * （两轮丢同一份 ⇒ 依然收敛）。保真由 `fixtures.spec.ts`（重开等价 + 双向锁）与
 * `roundtrip.spec.ts`（md' === md）负责。详见 KNOWN-ISSUES §二 #12。
 */
import { describe, it, expect, onTestFailed } from 'vitest';
import spec from 'commonmark-spec';
import { createTestSchema } from './test-utils';
import { parseMarkdown } from '../parser';
import { serializeMarkdown } from '../serializer';
import { SKIP } from './commonmark-skips';

const schema = createTestSchema();

function roundTrip(md: string): string {
  const doc = parseMarkdown(schema, md);
  return serializeMarkdown(doc);
}

// ── 已知限制 / 设计约束（skip） ────────────────────────────────
// 跳过表本体在 `./commonmark-skips.ts`（与 `safety-net.spec.ts` 共用同一份定义，
// 避免「两处清单漂移」）。2026-10-10 批次 4 · G6 已清理 22 条陈旧条目（34 → 12）。

/** 将 spec 用例按 section 分组 */
const groups: Record<string, typeof spec.tests> = {};
for (const example of spec.tests) {
  if (!SKIP[example.number]) {
    (groups[example.section] ??= []).push(example);
  }
}

describe('CommonMark spec roundtrip', () => {
  for (const [section, examples] of Object.entries(groups)) {
    describe(section, () => {
      for (const example of examples) {
        it(`Example ${example.number}`, () => {
          const input = example.markdown;

          // 第 1 轮：parse → serialize
          let out1: string;
          try {
            out1 = roundTrip(input);
          } catch (e) {
            throw new Error(
              `Parse1 failed (ex ${example.number}): ${e instanceof Error ? e.message : e}`,
              { cause: e },
            );
          }

          // 异常检测：序列化输出不应为空（除非输入本身就是空的）
          if (input.trim()) {
            expect(out1.trim()).toBeTruthy();
          }

          // 第 2 轮：parse → serialize（验证稳定性）
          let out2: string;
          try {
            out2 = roundTrip(out1);
          } catch (e) {
            throw new Error(
              `Parse2 failed (ex ${example.number}): ${e instanceof Error ? e.message : e}`,
              { cause: e },
            );
          }

          if (out1 !== out2) {
            // 在断言前附加 diff 信息
            onTestFailed(() => {
              const maxLen = 200;
              const trunc = (s: string) => s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
              console.log(`[Ex ${example.number}] R1 !== R2`);
              console.log(`  INPUT:  ${JSON.stringify(input)}`);
              console.log(`  R1:     ${JSON.stringify(trunc(out1))}`);
              console.log(`  R2:     ${JSON.stringify(trunc(out2))}`);
            });
            expect(out1).toBe(out2);
          }
        });
      }
    });
  }
});
