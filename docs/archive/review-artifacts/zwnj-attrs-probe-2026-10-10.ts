/**
 * 第三方审核 · 2026-10-10 保真链路修复复审的可复现探针
 * 生成时间：2026-10-10 ｜ 基准 commit 8f0a5f6
 *
 * 运行：
 *   npx vite-node docs/review-artifacts/zwnj-attrs-probe-2026-10-10.ts
 *
 * 口径声明：
 *   - 全部走**生产代码**（`parseMarkdown` / `serializeMarkdown` / `createTestSchema`），
 *     不复制、不重写任何 parser / serializer 逻辑（项目禁令 12）。
 *   - `[A]` 验证「ZWNJ 是否存活在**属性**里并被写盘」—— §4 覆盖枚举
 *     （只查 `textContent` / `textBetween`）视野外的一整类。
 *   - `[B]` 对照：围栏 / mermaid / frontmatter / 缩进式代码块的内存态 vs 落盘态。
 *   - `[C]` 验证「ZWNJ 路线覆盖了哪些定界符形态」—— 答材料 §11.1。
 *   - `[D]` 全仓影响面 + 幂等性。
 *   - `[E]` 根因语义核验（反引号 / NUL 的 Unicode 类别）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { createTestSchema } from '../../src/components/Editor/tiptap/markdown/__tests__/test-utils';
import { parseMarkdown } from '../../src/components/Editor/tiptap/markdown/parser';
import { serializeMarkdown } from '../../src/components/Editor/tiptap/markdown/serializer';
import type { Node as PMNode } from '@tiptap/pm/model';

const ZW = '\u200C';

function repoRoot(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(d, 'package.json'))) return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  throw new Error('[probe] 找不到仓库根');
}

const schema = createTestSchema();

/** doc 里所有**属性 / mark 属性**中携带 ZWNJ 的位置（文本节点之外的通道） */
function zwnjInAttrs(doc: PMNode): string[] {
  const hits: string[] = [];
  doc.descendants((n) => {
    if (n.isText) {
      for (const m of n.marks) {
        for (const [k, v] of Object.entries(m.attrs)) {
          if (typeof v === 'string' && v.includes(ZW)) hits.push(`mark.${m.type.name}.${k}`);
        }
      }
      return true;
    }
    for (const [k, v] of Object.entries(n.attrs)) {
      if (typeof v === 'string' && v.includes(ZW)) hits.push(`${n.type.name}.${k}`);
    }
    return true;
  });
  return hits;
}

function collectMarks(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.isText) for (const m of n.marks) out.push(m.type.name);
    return true;
  });
  return out;
}

function probe(md: string) {
  const doc = parseMarkdown(schema, md);
  const out = serializeMarkdown(doc);
  return {
    docDirty: JSON.stringify(doc.toJSON()).includes(ZW),
    attrs: zwnjInAttrs(doc),
    outHasZw: out.includes(ZW),
    zwCount: out.split(ZW).length - 1,
    marks: collectMarks(doc),
    out,
  };
}

/** 把输出里的 ZWNJ 显示成可见标记，便于人工核对 */
function vis(s: string): string {
  return JSON.stringify(s.split(ZW).join('[ZW]'));
}

// ───────────────────── [A] 属性携带的文本 ─────────────────────
const ATTR_FORMS: [string, string][] = [
  ['image.alt（正文）', '![甲**乙**，丙](x.png)\n'],
  ['image.alt（列表内）', '- ![甲**乙**，丙](x.png)\n'],
  ['image.alt（表格内）', '| A |\n|---|\n| ![甲**乙**，丙](x.png) |\n'],
  ['image.title', '![a](x.png "他**说**，好")\n'],
  ['link mark.title', '[a](u "他**说**，好")\n'],
  ['footnote label', '句子[^甲**乙**，丙]\n\n[^甲**乙**，丙]: 注释\n'],
  ['对照：alt 无标点触发', '![甲**乙**丙](x.png)\n'],
];

console.log('══ [A] ZWNJ 是否存活在属性里并被写盘 ══');
for (const [name, md] of ATTR_FORMS) {
  const r = probe(md);
  console.log(
    `  ${name.padEnd(22)} doc脏=${String(r.docDirty).padEnd(5)} 脏属性=${JSON.stringify(r.attrs).padEnd(40)} 落盘含ZWNJ=${r.outHasZw}(×${r.zwCount})  ${vis(md)} -> ${vis(r.out)}`,
  );
}

// ───────────────────── [B] 容器对照 ─────────────────────
const CONTAINER_FORMS: [string, string][] = [
  ['围栏代码块', '```\n甲**乙**，丙\n```\n'],
  ['波浪号围栏', '~~~\n甲**乙**，丙\n~~~\n'],
  ['mermaid 围栏', '```mermaid\ngraph TD; 甲**乙**，丙\n```\n'],
  ['缩进式代码块', '    甲**乙**，丙\n'],
  ['frontmatter', '---\nt: 甲**乙**，丙\n---\n\n正文\n'],
  ['行内代码', '`**甲，**`\n'],
  ['math 行内', '$a**——b$\n'],
  ['math 块', '$$a**——b$$\n'],
  ['math fence', '```math\n甲**乙**，丙\n```\n'],
];

console.log('\n══ [B] 容器内容：内存态 vs 落盘态（验 §4「刻意不做」）══');
for (const [name, md] of CONTAINER_FORMS) {
  const r = probe(md);
  console.log(
    `  ${name.padEnd(14)} doc脏=${String(r.docDirty).padEnd(5)} 落盘含ZWNJ=${String(r.outHasZw).padEnd(5)} -> ${vis(r.out)}`,
  );
}

// ───────────────────── [C] 定界符形态 ─────────────────────
const DELIMITER_FORMS = [
  '甲**乙，**丙',
  '甲*乙，*丙',
  '甲^乙，^丙',
  '甲==乙，==丙',
  '甲~~乙，~~丙',
  '甲==乙==丙',
  '甲~~乙~~丙',
];

console.log('\n══ [C] 各定界符在中文标点边界是否成立（答 §11.1）══');
const ref = new MarkdownIt('commonmark').enable(['strikethrough']);
for (const f of DELIMITER_FORMS) {
  const r = probe(`${f}\n`);
  const refHasTag = /<(strong|em|s|sup|mark)[ >]/.test(ref.render(`${f}\n`));
  console.log(
    `  ${vis(f).padEnd(22)} soloMarks=${JSON.stringify(r.marks).padEnd(20)} 落盘=${vis(r.out).padEnd(34)} GFM参照成立=${refHasTag}`,
  );
}

// ───────────────────── [D] 全仓影响面 + 幂等 ─────────────────────
const SKIP = new Set(['node_modules', 'dist', 'src-tauri', 'target', 'website', 'design-samples', 'public']);
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

const root = repoRoot();
const files = walk(root);
const leaked: string[] = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (!src.includes('**')) continue;
  const out = serializeMarkdown(parseMarkdown(schema, src));
  if (out.includes(ZW)) leaked.push(`${relative(root, f)} (×${out.split(ZW).length - 1})`);
}
console.log('\n══ [D] 全仓影响面 ══');
console.log(`  扫描 ${files.length} 份 md；保存后落盘含 ZWNJ 的：${leaked.length} 份`);
for (const l of leaked) console.log(`    ${l}`);

console.log('\n══ [D2] 幂等性（首存后会继续增生吗）══');
for (const md of ['![甲**乙**，丙](x.png)\n', '句子[^甲**乙**，丙]\n\n[^甲**乙**，丙]: 注释\n']) {
  const o1 = probe(md).out;
  const o2 = probe(o1).out;
  const o3 = probe(o2).out;
  console.log(`  收敛=${o1 === o2 && o2 === o3} 稳定后 ZWNJ 数=${o3.split(ZW).length - 1}  ${vis(o3)}`);
}

// ───────────────────── [E] 根因语义核验 ─────────────────────
const RE_SP = new RegExp('\\p{S}', 'u');
const RE_PP = new RegExp('\\p{P}', 'u');
const RE_WS = new RegExp('\\s', 'u');
const BACKTICK = String.fromCharCode(0x60);
const NUL = String.fromCharCode(0x00);
console.log('\n══ [E] 根因语义核验（材料 §3 的三个断言）══');
console.log(`  反引号 U+0060 属 \\p{S}          : ${RE_SP.test(BACKTICK)}`);
console.log(`  NUL 属 \\p{P} / \\p{S} / \\s     : ${RE_PP.test(NUL)} / ${RE_SP.test(NUL)} / ${RE_WS.test(NUL)}`);
console.log(`  ⇒ NUL 既非标点亦非空白 ⇒ 会被当成「普通字」: ${!RE_PP.test(NUL) && !RE_SP.test(NUL) && !RE_WS.test(NUL)}`);
console.log('\n  判定：#35 的修法本身成立——下列两形态应「无 ZWNJ 且字节保真」');
for (const md of ['**加粗 `代码`**——后文\n', '`a`**b\n']) {
  const r = probe(md);
  console.log(`    ${vis(md).padEnd(30)} doc脏=${r.docDirty} 落盘含ZWNJ=${r.outHasZw} -> ${vis(r.out)}`);
}
