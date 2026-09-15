/**
 * Fixture 保真测试（19 个 fixture）
 *
 * 本文件过去只断言「稳定性」（round2 === round1），导致「**稳定地丢内容**」永久绿灯
 * —— 混排列表整段消失就是这么漏网 3 个月的（KNOWN-ISSUES §二 #10）。
 *
 * 现分两层判据：
 *  ① 重开等价（硬底线，零容忍）—— 输出重新打开后，**可见文字**与**块结构**须与原文一致。
 *     参照系是 markdown-it（第三方标准实现），不是 solo 自己——否则 parser 的缺陷会
 *     对称复制到参照侧，丢了也说「等价」。
 *  ② 字节保真 —— 输出 === 原文（尾换行归一）。允许「格式规整」类差异，但必须登记。
 *
 * 未登记的文件：两层都必须通过。
 * 已登记的文件：按 kind 分类放行，且带**双向锁**——修好了测试转红，提示删除登记。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundTrip, reopenDrift } from './test-utils';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

const fixtureFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.md'));

/**
 * 已知保真缺口登记表。
 *
 * kind:
 *   - `LOSS`   内容丢失（**必须修**，登记只为让坏状态可见并锁定；禁止新增）
 *   - `FORMAT` 仅格式差异（设计选择，内容不丢；可接受，但**不得退化成 LOSS**）
 *
 * 双向锁：修好后测试会转红，提示删除登记。
 */
const KNOWN_FIDELITY_GAPS: Record<string, { kind: 'LOSS' | 'FORMAT'; note: string }> = {
  'all-marks.md': {
    kind: 'FORMAT',
    note: 'mark 顺序按 PM schema 归一（~~**x**~~ → **~~x~~**）。原「上标语境 `=` 过逃逸」已于 2026-09-15 修复',
  },
  'blockquotes.md': { kind: 'FORMAT', note: '空引用行 `>` 补尾随空格（渲染等价）' },
  'edge-cases.md': {
    kind: 'FORMAT',
    note: '方括号 `[` 保守转义（防字面 `[label]` 与文内参考式定义意外配对成链接）。原「`( ) $ | < > . =` 过逃逸」已于 2026-09-15 修复',
  },
  'footnotes.md': { kind: 'FORMAT', note: '脚注定义位置重排 + 插空行' },
  'lists.md': {
    kind: 'FORMAT',
    note: '松散列表的项间空行被移除（归一为紧凑；schema 不存 tightness，方向不可两全）。嵌套缩进 3→内容列、父项后插空行已于 2026-09-15 修复',
  },
  'real-world.md': {
    kind: 'FORMAT',
    note: '松散列表归一为紧凑（项间空行移除）+ 表格列宽规整 + 脚注定义位置重排。原「tight → loose 插空行」已于 2026-09-15 修复',
  },
  'table.md': { kind: 'FORMAT', note: '表格分隔线宽度与单元格对齐空格规整化' },
};

describe('Fixture 保真', () => {
  for (const file of fixtureFiles) {
    it(file, () => {
      const md = readFileSync(resolve(FIXTURES_DIR, file), 'utf-8');

      // 序列化（不应抛异常）
      const out = roundTrip(md);

      // 稳定性：序列化器收敛
      expect(roundTrip(out)).toBe(out);

      // ① 重开等价：内容不丢
      const textDrift = reopenDrift(md, out);
      // ② 字节保真
      const byteExact = out.trimEnd() === md.trimEnd();

      const gap = KNOWN_FIDELITY_GAPS[file];
      const hint = gap ? `（已登记：${gap.note}）` : '';

      if (!gap) {
        expect(textDrift, `「${file}」重开后内容与原文不一致`).toEqual([]);
        expect(byteExact, `「${file}」输出与原文有字节差异且未登记`).toBe(true);
        return;
      }

      if (gap.kind === 'FORMAT') {
        // 格式类缺口不得夹带内容丢失
        expect(textDrift, `「${file}」登记为格式类缺口，但内容已不一致${hint}`).toEqual([]);
      } else {
        // LOSS 类：确认它确实仍在丢；修好后转红提示删除登记
        expect(
          textDrift.length,
          `「${file}」已登记为内容丢失${hint}，但内容侧已无差异——若已修好，请删除该登记`,
        ).toBeGreaterThan(0);
      }

      // 缺口仍在 → 字节仍应不一致；已修好 → 转红提示清理登记
      expect(
        byteExact,
        `「${file}」已登记的缺口似乎已修好${hint}，请删除该登记`,
      ).toBe(false);
    });
  }
});
