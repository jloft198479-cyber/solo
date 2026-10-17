/**
 * 图标使用锁（防回退，2026-10-17 · 批 3 第 2 步）
 *
 * 防的事故：统一前全仓 32 处内联 `<svg>` 分属 7 种画布 / 8 种线宽，同一界面里线条
 * 实际粗细 1.12–1.80px（差 61%）；同一个按钮切状态时粗细还会突变。
 *
 * 判据：**除了图标库本身，谁都不许再内联 `<svg>`** —— 想加图标就去 `svg.ts` 加一条。
 * 内联一处就少一处统一性，而且没有任何机制能发现它又长出来了，所以用「按文件的
 * 允许清单 + 计数」做棘轮：清单外新增即红，清单内的数量只许减不许增。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../../..', import.meta.url));

/** 允许继续内联 `<svg>` 的文件 → 允许的最大处数 */
const ALLOWED: Record<string, number> = {
  // 窗口控制按钮（最小化 / 最大化 / 关闭）：10px 画布是 Windows 标题栏的惯例尺寸，
  // 用 24 画布图标会显得又小又细，故**永久排除在图标体系之外**（见方案 §二「不纳入」）
  'components/Layout/CustomTitlebar.vue': 3,
  // 第 3 步（2026-10-17）已把 code-block / math-block / mermaid-block / list-fold
  // 四处 `.ts` 内联 svg 全部改成 `iconSvg()`，清单**已清空到只剩标题栏**。
  // 不得回填：再往 `.ts` 里内联 svg 就是又开了一套定义，测试会当场拦下。
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.vue') || entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('图标使用锁：一律走图标库，不许内联 svg', () => {
  const files = walk(SRC_DIR).filter((f) => {
    const rel = relative(SRC_DIR, f).replace(/\\/g, '/');
    // 图标库自身（定义处）与测试不在此列
    return !rel.startsWith('components/icons/');
  });

  const counts = new Map<string, number>();
  for (const file of files) {
    const rel = relative(SRC_DIR, file).replace(/\\/g, '/');
    const n = readFileSync(file, 'utf8').match(/<svg\b/g)?.length ?? 0;
    if (n > 0) counts.set(rel, n);
  }

  it('允许清单之外没有任何内联 svg', () => {
    const outside = [...counts].filter(([rel]) => !(rel in ALLOWED));
    expect(outside, `以下文件内联了 <svg>，请把图标加进 icons/svg.ts 后改用 <Icon>`).toEqual([]);
  });

  it('允许清单内的处数只许减不许增（迁移完成请删掉对应条目）', () => {
    const grown = [...counts]
      .filter(([rel, n]) => rel in ALLOWED && n > ALLOWED[rel])
      .map(([rel, n]) => `${rel}: ${ALLOWED[rel]} → ${n}`);
    expect(grown, '清单内文件的内联 svg 数量增加了').toEqual([]);
  });
});
