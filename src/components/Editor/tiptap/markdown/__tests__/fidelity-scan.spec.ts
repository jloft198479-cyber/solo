/**
 * 全仓保真体检（**报告工具，非门禁**）
 *
 * 为什么存在：`roundtrip.spec.ts` 这类用例是**人工列举**的，只能覆盖作者想到的形态；
 * 「强调里包行内代码 + 闭合符后接标点」这种三条件叠加的形态就长期漏网（台账 §一 #35）。
 * 本工具反过来做——**拿真实文档当输入**，把「打开 → 保存」前后**渲染结果**比一遍，
 * 哪份文档、哪类元素变了，直接列出来。
 *
 * 用法（默认跳过，避免污染 `bun run test`）：
 *   SOLO_FIDELITY_SCAN=1 bunx vitest run src/components/Editor/tiptap/markdown/__tests__/fidelity-scan.spec.ts
 *
 * 口径说明（别误读成"字节保真"）：
 *  - 判据是**独立参照系**（`markdown-it` commonmark + table + strikethrough）渲染出的 HTML 是否变化。
 *  - 表格补空格、实体解码这类**语义等价**的改写**不计**（它们不改变渲染）。
 *  - 只统计「内联 / 结构元素**净减少**」——即真的丢了东西。
 *
 * ⚠️ 已知局限：参照系未启用 solo 的 mark / footnote / sub / sup / texmath 插件，
 * 故极少数用例会因插件差异产生噪声，逐个复核后再下结论。
 */
import { describe, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { parseMarkdown } from '../parser';
import { serializeMarkdown } from '../serializer';
import { createTestSchema } from './test-utils';

/**
 * 仓库根：从**本文件位置向上找 `package.json`**。
 *
 * 为什么不用 `__dirname`：项目是 `"type": "module"`，`__dirname` 不属于 ESM
 * （现在能跑只是靠打包器的 interop 兜着）。也不要硬编码 `..` 层数——目录一挪就
 * **静默指错**，工具会照样"通过"却根本没扫该扫的东西；**静默指错比直接报错危险**。
 */
function findRepoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`[fidelity-scan] 找不到仓库根：从 ${from} 向上 12 层无 package.json`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const SKIP_DIRS = new Set(['node_modules', 'dist', 'src-tauri', 'target', 'website', 'design-samples', 'public']);
const WATCHED = ['strong', 'em', 'code', 'table', 'li', 'h1', 'h2', 'h3'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith('.md')) out.push(path);
  }
  return out;
}

const count = (html: string, tag: string) => (html.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;

describe.skipIf(!process.env.SOLO_FIDELITY_SCAN)('全仓保真体检', () => {
  it('列出「打开 → 保存」后渲染结果发生变化的文档', () => {
    const ref = new MarkdownIt('commonmark', { html: false }).enable(['table', 'strikethrough']);
    const schema = createTestSchema();
    const files = walk(ROOT);
    const rows: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const out = serializeMarkdown(parseMarkdown(schema, src));
      const before = ref.render(src);
      const after = ref.render(out);
      const lost = WATCHED.map((tag) => ({ tag, diff: count(before, tag) - count(after, tag) }))
        .filter((entry) => entry.diff > 0)
        .map((entry) => `${entry.tag}-${entry.diff}`);
      if (lost.length) rows.push(`${relative(ROOT, file)}  →  ${lost.join(' ')}`);
    }

    console.log(`\n扫描 ${files.length} 份 md；渲染结果有变化的 ${rows.length} 份：`);
    for (const row of rows) console.log('  ' + row);
    console.log('\n（本工具只报告不断言；门禁仍是 bun run test。）');
  });
});
