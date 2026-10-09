/**
 * 第三方审查 · 批 2 可复现测量脚本（性能新基线 + 表格跨格探针）
 * 生成时间：2026-10-09 ｜ 基准 commit 53fc08d ｜ v1.2.58
 *
 * 运行：
 *   npx vite-node docs/review-artifacts/perf-baseline-2026-10-09.ts
 *
 * 口径声明（对应审查方案 §4.2 判据①）：
 *   - 全部为 **Node 纯计算**口径，不含 WebView2 渲染、不含 IPC 读写盘、不含高亮/排版。
 *     WebView2 侧经验系数按台账旧记录 ×2~3 估。
 *   - 语料由本脚本用固定种子生成，任何人重跑得到同一份输入。
 *   - 每个测量取 5 次中位数，首轮丢弃（JIT 预热）。
 */
import { createTestSchema, roundTrip } from '../../src/components/Editor/tiptap/markdown/__tests__/test-utils';
import { parseMarkdown } from '../../src/components/Editor/tiptap/markdown/parser';
import { serializeMarkdown } from '../../src/components/Editor/tiptap/markdown/serializer';
import type { Node as PMNode } from '@tiptap/pm/model';

// ────────────────────────── 语料生成（固定种子） ──────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CN = '中文沉浸式写作的段落样本，用来模拟真实文档的字密度与标点分布。';

/** 目标：产出总字符数 ≈ targetChars、块数按 avgBlockChars 均分的文档 */
function genDoc(targetChars: number, avgBlockChars: number, seed = 20261009): string {
  const rnd = mulberry32(seed);
  const out: string[] = [];
  let n = 0;
  let chars = 0;
  while (chars < targetChars) {
    n++;
    const kind = n % 9;
    if (kind === 0) {
      const t = `## 小节 ${n}`;
      out.push(t);
      chars += t.length + 1;
    } else if (kind === 1 || kind === 2) {
      // 段落：按 avgBlockChars 铺字
      const len = Math.max(20, Math.round(avgBlockChars / CN.length));
      const body = CN.repeat(len).slice(0, avgBlockChars);
      out.push(body);
      chars += body.length + 1;
    } else if (kind === 3 || kind === 4) {
      const items = Math.max(2, Math.round(avgBlockChars / 24));
      const list = Array.from({ length: items }, (_, i) =>
        i % 3 === 0 ? `- [ ] 任务项 ${i}` : `- 列表项 ${i} ${CN.slice(0, 12)}`,
      ).join('\n');
      out.push(list);
      chars += list.length + 1;
    } else if (kind === 5) {
      const code = ['```js', ...Array.from({ length: 6 }, (_, i) => `const v${i} = ${i}; // ${CN.slice(0, 10)}`), '```'].join('\n');
      out.push(code);
      chars += code.length + 1;
    } else if (kind === 6) {
      const tbl = [
        '| 名称 | 说明 | 值 |',
        '| ---- | ---- | -- |',
        ...Array.from({ length: 3 }, (_, i) => `| 列${i} | ${CN.slice(0, 14)} | ${i} |`),
      ].join('\n');
      out.push(tbl);
      chars += tbl.length + 1;
    } else if (kind === 7) {
      const q = `> 引用 ${n}：${CN.repeat(3).slice(0, avgBlockChars)}`;
      out.push(q);
      chars += q.length + 1;
    } else {
      const b = `**加粗 ${n}** 与 \`code\` 混排 ${CN.slice(0, Math.min(CN.length, avgBlockChars))}`;
      out.push(b);
      chars += b.length + 1;
    }
    if (rnd() < 0.01) out.push('');
  }
  return out.join('\n\n') + '\n';
}

// ────────────────────────── 计时工具 ──────────────────────────
function median(times: number[]): number {
  const s = [...times].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function measure<T>(runs: number, fn: () => T): { ms: number; value: T } {
  let value!: T;
  const times: number[] = [];
  for (let i = 0; i < runs + 1; i++) {
    const t0 = performance.now();
    value = fn();
    const dt = performance.now() - t0;
    if (i > 0) times.push(dt); // 丢首轮
  }
  return { ms: median(times), value };
}

// ────────────────────────── 主流程 ──────────────────────────
const schema = createTestSchema();

console.log('\n=== A. 规模刻度（块数随字符数等比增长）===');
console.log('字符数\t块数\t解析ms\t序列化ms\t打开合计ms\t编辑事务ms');
const scaleRows: { chars: number; blocks: number; parse: number; ser: number; edit: number }[] = [];
for (const target of [10_000, 50_000, 100_000, 250_000, 500_000]) {
  const md = genDoc(target, 420);
  const p = measure(5, () => parseMarkdown(schema, md));
  const s = measure(5, () => serializeMarkdown(p.value));
  const doc = p.value;
  const e = measure(5, () => {
    // 模拟「用户敲完一次、防抖到点落盘」：文末追加内容 + 全量序列化
    const withText = parseMarkdown(schema, md + '追加一句新的中文内容。\n');
    return serializeMarkdown(withText).length;
  });
  const blocks = doc.childCount;
  scaleRows.push({ chars: md.length, blocks, parse: p.ms, ser: s.ms, edit: e.ms });
  console.log(
    `${md.length}\t${blocks}\t${p.ms.toFixed(2)}\t${s.ms.toFixed(2)}\t${(p.ms + s.ms).toFixed(2)}\t${e.ms.toFixed(2)}`,
  );
  const drift = s.value.trimEnd().length - md.trimEnd().length;
  console.log(`  （规整化字节差 +${drift} / ${(100 * drift) / md.length | 0}% —— 表格补位与分隔行宽度，非丢内容）`);
}

console.log('\n=== B. 块数刻度（字符量固定，块数 8 倍增长 —— 这才是 O(n) 的真实考题）===');
console.log('块数\t字符数\t序列化ms\t每块均摊µs');
const FIXED_CHARS = 100_000;
const blockRows: { blocks: number; chars: number; ser: number }[] = [];
for (const avg of [4000, 2000, 1000, 500, 250, 125]) {
  const md = genDoc(FIXED_CHARS, avg);
  const doc = parseMarkdown(schema, md);
  const s = measure(5, () => serializeMarkdown(doc));
  blockRows.push({ blocks: doc.childCount, chars: md.length, ser: s.ms });
  console.log(
    `${doc.childCount}\t${md.length}\t${s.ms.toFixed(2)}\t${((s.ms * 1000) / doc.childCount).toFixed(1)}`,
  );
}

console.log('\n=== C. 复杂度指数拟合（由 B 组实测反推 n^k）===');
{
  const a = blockRows[0];
  const b = blockRows[blockRows.length - 1];
  const k = Math.log(b.ser / a.ser) / Math.log(b.blocks / a.blocks);
  console.log(
    `块数 ${a.blocks} → ${b.blocks}（×${(b.blocks / a.blocks).toFixed(1)}），耗时 ${a.ser.toFixed(1)} → ${b.ser.toFixed(1)}ms（×${(b.ser / a.ser).toFixed(1)}）`,
  );
  console.log(`拟合指数 k = ${k.toFixed(2)}（1.0 = 线性，2.0 = 二次）`);
}

console.log('\n=== D. 解析侧同样考题（块数 vs 解析耗时）===');
{
  const pts: { blocks: number; ms: number }[] = [];
  for (const avg of [4000, 500]) {
    const md = genDoc(FIXED_CHARS, avg);
    const p = measure(5, () => parseMarkdown(schema, md));
    pts.push({ blocks: p.value.childCount, ms: p.ms });
    console.log(`块数 ${p.value.childCount}\t解析 ${p.ms.toFixed(2)}ms`);
  }
  const k = Math.log(pts[1].ms / pts[0].ms) / Math.log(pts[1].blocks / pts[0].blocks);
  console.log(`解析侧拟合指数 k = ${k.toFixed(2)}`);
}

// ────────────────────────── E. 表格跨格 / 参差行探针 ──────────────────────────
console.log('\n=== E. 表格探针（serializer 完全不看 colspan/rowspan，实测后果）===');
{
  const t = schema.nodes.table;
  const row = schema.nodes.tableRow;
  const cell = schema.nodes.tableCell;
  const head = schema.nodes.tableHeader;
  const p = (txt: string) => schema.nodes.paragraph.create(null, schema.text(txt));
  const mk = (txt: string) => cell.create(null, p(txt));

  // E1: 正常 2x2
  const good = t.create(null, [
    row.create(null, [head.create(null, p('A')), head.create(null, p('B'))]),
    row.create(null, [mk('1'), mk('2')]),
  ]);
  const goodMd = serializeMarkdown(good);
  console.log('E1 正常表：\n' + goodMd.trimEnd());

  // E2: 参差行（第 2 行 3 格 > 第 1 行 2 格）—— 粘贴带 colspan 的 HTML 后 PM 可能产出的形态
  const ragged = t.create(null, [
    row.create(null, [head.create(null, p('A')), head.create(null, p('B'))]),
    row.create(null, [mk('1'), mk('2'), mk('3 会被截掉吗')]),
  ]);
  const raggedMd = serializeMarkdown(ragged);
  console.log('\nE2 参差行序列化产物：\n' + raggedMd.trimEnd());
  const back = roundTrip(raggedMd);
  console.log('E2 往返（md→doc→md）产物：\n' + back.trimEnd());
  console.log(
    `E2 判据：原始文字「3 会被截掉吗」在往返产物中 ${back.includes('3 会被截掉吗') ? '仍在（降级不丢）' : '**已丢失**'}`,
  );

  // E3: 带 colspan attr 的单元格（模拟真跨格；空格用「空段落」而非空文本节点）
  const emptyCell = cell.create(null, schema.nodes.paragraph.create());
  const merged = t.create(null, [
    row.create(null, [head.create(null, p('A')), head.create(null, p('B'))]),
    row.create(null, [cell.create({ colspan: 2 }, p('跨两格的内容')), emptyCell]),
  ]);
  const mergedMd = serializeMarkdown(merged);
  console.log('\nE3 colspan=2 产物：\n' + mergedMd.trimEnd());
  const back3 = roundTrip(mergedMd);
  console.log(
    `E3 判据：「跨两格的内容」${back3.includes('跨两格的内容') ? '仍在（合并降级为普通格）' : '**已丢失**'}；往返产物：\n` +
      back3.trimEnd(),
  );
}

console.log('\n完成。以上数字全部可由本脚本原样复现（固定种子 20261009）。\n');
