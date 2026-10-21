/**
 * docs 死链自动检查（task 2）。
 *
 * 用途：文档搬家 / 改名后，任何指向已不存在文件的相对链接都会让 Agent 全文检索命中
 * 过时结论。本 spec 在 `bun run test:full` 时随全量回归一起跑，把死链挡在合并前。
 *
 * 范围：仓库根下的文档 .md（docs/、wiki/、根级 README/AGENTS/ARCHITECTURE 等）。
 * 跳过：node_modules / dist / src-tauri / target / website / design-samples / public /
 *       outputs（agent 生成物）/ archive（历史快照，内部链接冻结不查）/ src（源码，其 .md 是测试夹具非文档）。
 * 不查：外部链接(http/邮件)、纯锚点(#sec)、wiki 互链([[...]])、脚注定义([^1]:)、
 *       代码块/行内代码里的「语法举例」、不像文件路径的目标(无 / 也无 . 的裸词)。
 */
import { describe, it, expect } from 'vitest';
import { resolve, dirname, relative } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function findRepoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('[docs-lint] 找不到仓库根');
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'src-tauri', 'target', 'website', 'design-samples', 'public', 'outputs', 'archive', 'src',
]);

// 行内链接 [label](path) 与图片 ![alt](path)
const INLINE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// 参考式定义 [label]: path —— 排除脚注定义 [^1]:
const REFDEF = /^\s*\[(?![\^])[^\]]+\]:\s*(\S+)/gm;

/** 去掉围栏代码块与行内代码，避免把「举例 markdown 语法」当成真链接 */
function stripCode(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith('.md')) yield p;
  }
}

function extractTargets(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(INLINE)) out.push(m[1]);
  for (const m of md.matchAll(REFDEF)) out.push(m[1]);
  return out;
}

const isExternal = (t: string): boolean =>
  /^(https?:|mailto:|tel:)/i.test(t) || t.startsWith('//');

/** 像文件路径：含 / 或含 .(扩展名感) 或就是 ./ ../ . .. */
const looksLikePath = (t: string): boolean =>
  /[./]/.test(t) || /^\.\.?$/.test(t);

describe('docs 死链检查', () => {
  it('所有相对链接应指向存在的文件', () => {
    const dead: string[] = [];
    for (const file of walk(ROOT)) {
      const md = stripCode(readFileSync(file, 'utf8'));
      const rel = relative(ROOT, file).split(/[\\/]/).join('/');
      for (const raw of extractTargets(md)) {
        // 去掉锚点 / 查询串，只判文件是否存在
        const target = raw.split('#')[0].split('?')[0];
        if (!target || target.startsWith('#')) continue;
        if (isExternal(target)) continue;
        if (!looksLikePath(target)) continue;
        // 以 / 开头按仓库根解析，否则按当前文件目录解析
        const abs = target.startsWith('/')
          ? resolve(ROOT, target.replace(/^\/+/, ''))
          : resolve(dirname(file), target);
        // 目标落在被忽略 / 非文档目录（outputs/archive/src-tauri/…）内时不查：
        // 这些目录不进版本库或仅生成物，CI/克隆环境本就不存在，属预期，不应判死链
        // （SKIP_DIRS 已把它们排除在扫描源之外，这里对「指向它们的链接」做对称处理）。
        if (SKIP_DIRS.has(relative(ROOT, abs).split(/[\\/]/)[0])) continue;
        if (!existsSync(abs)) dead.push(`${rel}  →  ${raw}`);
      }
    }
    expect(dead, `发现 ${dead.length} 处死链：\n` + dead.join('\n')).toEqual([]);
  });
});
