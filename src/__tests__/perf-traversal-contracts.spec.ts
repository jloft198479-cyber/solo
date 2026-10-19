/**
 * 整篇遍历静态锁（台账 §一 #72 收口，2026-10-19）
 *
 * 防的事故：`apply()` / `appendTransaction()` / `decorations()` / 每键回调里塞进
 * 「代价随文档长度增长」的整篇读取（descendants / textContent / textBetween(0…)），
 * 且没有按变更区间限定。历史上已三次漏网：list-fold 每键全量重建、光标行号
 * O(光标前全部节点)、字数/大纲无防抖——全是「肉眼审不出、真机才能感到卡」的慢性病。
 *
 * 规则：receiver 是整篇 doc 的读取，命中行**必须带 `perf-allow:` 标注**（写明为何
 * 整篇扫是安全的：防抖 / 缓存 / 一次性 init / 事件驱动 / 有界于粘贴内容……）。
 * 没标注 = 红。新代码要么改增量，要么显式声明理由——把「记得吗」变成「看得见」。
 *
 * 本锁只拦「无意识引入」；有意为之的整篇扫描标注后放行，与 icon/menu 白名单同构。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../components/Editor/tiptap', import.meta.url));

/** 递归收集 tiptap/ 下的 .ts（排除 __tests__） */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * 整篇文档级读：receiver 是整篇 doc（doc / state.doc / tr.doc / editor.state.doc /
 * view.state.doc）时的 descendants / textContent / textBetween(0…)。
 * 只匹配这些 receiver，避免误伤 `parent.textBetween`（单块有界）、
 * `slice.content.textBetween`（粘贴分片有界）、`inner.textBetween`（块内）这类合法局部读取。
 */
const WHOLE_DOC_READ =
  /(?:\bstate\.doc|\btr\.doc|editor\.state\.doc|view\.state\.doc|editor\.view\.state\.doc|\bdoc)\s*\.\s*(?:descendants\b|textContent\b|textBetween\s*\(\s*0\b)/;

describe('整篇遍历静态锁：全文扫描必须 perf-allow 标注', () => {
  it('tiptap/ 源码内所有整篇读取都带标注', () => {
    const offenders: string[] = [];
    const files = collectTsFiles(ROOT);
    // 扫描范围有效性自检：目录没收错（防将来目录挪空导致假绿）
    expect(files.length).toBeGreaterThan(10);

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!WHOLE_DOC_READ.test(line)) return;
        // 认「本行或紧邻下一行」：prettier 会把跟在 `{` 后面的行尾注释挪到下一行（实测），
        // 只认本行的话，谁跑一次 `bun run format`，已标注的合法调用点会集体转红。
        // 换来的代价是「整篇读取紧挨着一句无关 perf-allow 注释」能蒙过去——本锁只拦
        // 无意识引入，蒙混属主动作弊，与「拆了标注」同级，不在这里防。
        if (line.includes('perf-allow') || (lines[i + 1] ?? '').includes('perf-allow')) return;
        offenders.push(`${file.replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`);
      });
    }

    expect(
      offenders,
      '以下整篇遍历没有 perf-allow 标注——要么改成按变更区间的增量，要么在该行写明理由：\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
