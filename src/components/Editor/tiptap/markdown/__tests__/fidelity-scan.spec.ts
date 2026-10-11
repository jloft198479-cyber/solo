/**
 * 全仓保真体检（**硬断言工具**，批次 4 G2/G3 升级版）
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
 *  - 判据是**独立参照系**（`markdown-it` commonmark + table + strikethrough + mark/sub/sup）
 *    渲染出的 HTML 是否变化。
 *  - 表格补空格、实体解码这类**语义等价**的改写**不计**（它们不改变渲染）。
 *  - 只统计「内联 / 结构元素**净减少**」——即真的丢了东西。
 *
 * 硬断言（三条，缺一条就有盲区）：
 *  ① **ZWNJ 不出站**（2026-10-10 起）——落盘结果含 U+200C 即红。
 *  ② **二轮收敛**（批次 4 · G2，治 B5）——`parse→ser` 两轮必须字节相等。
 *     为什么必须独立于 ① ③：① ③ 都只看**一轮**，而「每存一次就再加深一层」这类
 *     不收敛形态（如旧版列表内数学块缩进）一轮之内看不到、多存几次才爆。
 *  ③ **变化签名棘轮**（批次 4 · G3，治 B4/B6）——`WATCHED` 标签补齐 + 逐份文档
 *     锁「丢了哪些**类**元素」，而不是只锁「有变化的**份数**」。
 *     旧口径的两个洞（B6）：一份已标文档内部新增丢失 ⇒ 照样绿；一份修好 + 一份变坏
 *     互相抵消 ⇒ 照样绿。锁到「每份文档的签名」后两者都会红。
 *
 * ⚠️ 签名锁的是**标签种类集合**（不是数量），这是刻意的取舍：数量会随文档正常增删
 * 内容而漂移（多写一段就多个 `strong`），锁数量等于天天误报；种类才是有意义的信号。
 * 数量仍会打印出来供人工判断。
 *
 * 已知局限：参照系未启用 solo 的 footnote / texmath / callout / wikilink 等**私有**插件，
 * 故极少数用例会因插件差异产生噪声，逐份复核后再下结论。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import markPlugin from 'markdown-it-mark';
import subPlugin from 'markdown-it-sub';
import supPlugin from 'markdown-it-sup';
import { parseMarkdown } from '../parser';
import { serializeMarkdown } from '../serializer';
import { createTestSchema } from './test-utils';

/**
 * 变化签名棘轮 —— 逐份文档登记「丢了哪些类元素」。
 *
 * 取值方法：`SOLO_FIDELITY_SCAN=1` 跑一遍，把日志里的 `file → tags` 原样抄进来。
 * 规则：**新出现的文件 = 红**；已登记文件**多出新的丢失类别 = 红**；
 *       少类别（修好了）不红，但请顺手删掉该行收紧棘轮。
 *
 * 2026-10-10 批次 4 实测基线（旧 WATCHED 只 8 个标签时是「7 份」，
 * 补齐 `s/mark/a/img/sup/sub/h4-h6` 后新暴露了 `a` / `mark` 两类——正是 B4）。
 * 7 份里 `INDEX.md` 的 `a-1` 是 B4 点名的那个「工具看不见」的实例。
 */
const KNOWN_SCAN_SIGNATURES: Record<string, string> = {
  'docs/IME-问题简报与资料汇编.md': 'strong',
  'docs/INDEX.md': 'code,a',
  'docs/KNOWN-ISSUES.md': 'strong,code,mark',
  'docs/PROPOSAL-list-outline-experience.md': 'strong',
  'docs/archive/catpaw-2026-08-21/step3-solo 大文档滚动与渲染诊断报告.md': 'strong',
  'docs/archive/catpaw-2026-08-21/step4-solo 编辑器整体架构与扩展机制诊断报告.md': 'strong',
  'docs/archive/catpaw-2026-08-21/step8-solo 多窗口与进程架构诊断报告.md': 'em',
};

/**
 * 二轮不收敛份数棘轮（G2）——只降不升。
 *
 * 2026-10-10 批次 4 实测基线 **2**（批次 1~3 之前是 19 份）。残余两份已定位，
 * **均为既有问题、非本批引入**，且都在**第二轮**收敛（R3 === R2，即「存两次才稳定」）：
 *   - `docs/KNOWN-ISSUES.md` —— 第 62 行那种「行内代码内嵌转义反引号」的畸形写法
 *     （台账 §二 待办项，另案未定位）；
 *   - `docs/IME-问题简报与资料汇编.md` —— 文档**中段**出现 frontmatter 样式块
 *     （`type:` / `audience:` 等 + `[` 被转义成 `\[`），R2 会在其前补一空行。
 * 谁修好哪一份，就把这个数字减一并补注原因。
 */
const KNOWN_NON_CONVERGENT = 2;

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
// outputs/ = codeplan 等 agent 生成的规划产物（含刻意构造的对抗性 markdown 示例：
// 脚注 `[^1]`、`[[互链]]`、嵌套表格），非用户文档、不参与保真棘轮，同 dist/target 一类生成物。
// docs/archive/ = 历史快照 / 已结案文档（含本次归档的 21 份 REVIEW + 3 份 IME），
// 不是用户内容、不当往返用例，与 outputs 同类生成/历史物，跳过。
const SKIP_DIRS = new Set(['node_modules', 'dist', 'src-tauri', 'target', 'website', 'design-samples', 'public', 'outputs', 'archive']);

/** 受监视标签（批次 4 G3 由 8 个扩到 17 个，治 B4） */
const WATCHED = [
  'strong', 'em', 'code', 'table', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  's', 'mark', 'a', 'img', 'sup', 'sub',
];

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
  it('ZWNJ 不出站 + 二轮收敛 + 变化签名棘轮', () => {
    // 参照系补上 mark / sub / sup —— 否则这三个标签恒为 0，加进 WATCHED 也没信号（B4）
    const ref = new MarkdownIt('commonmark', { html: false })
      .enable(['table', 'strikethrough'])
      .use(markPlugin)
      .use(subPlugin)
      .use(supPlugin);
    const schema = createTestSchema();
    const files = walk(ROOT);

    const zwnjHits: string[] = [];
    const nonConvergent: string[] = [];
    const signatures = new Map<string, string[]>();
    const counts = new Map<string, string[]>();

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const out1 = serializeMarkdown(parseMarkdown(schema, src));
      const out2 = serializeMarkdown(parseMarkdown(schema, out1));
      // 路径分隔符归一为 `/`：否则签名表的键在 Windows 是反斜杠、在 CI 是正斜杠，
      // 换平台就整表失配（静默指错比直接报错危险）
      const rel = relative(ROOT, file).split(/[\\/]/).join('/');

      // ① ZWNJ 不出站
      if (out1.includes('\u200C')) zwnjHits.push(rel);

      // ② 二轮收敛（G2）
      if (out1 !== out2) nonConvergent.push(rel);

      // ③ 变化签名（G3）
      const before = ref.render(src);
      const after = ref.render(out1);
      const lostTags: string[] = [];
      const countDetail: string[] = [];
      for (const tag of WATCHED) {
        const diff = count(before, tag) - count(after, tag);
        if (diff > 0) {
          lostTags.push(tag);
          countDetail.push(`${tag}-${diff}`);
        }
      }
      if (lostTags.length) {
        signatures.set(rel, lostTags);
        counts.set(rel, countDetail);
      }
    }

    console.log(`\n扫描 ${files.length} 份 md`);
    console.log(`渲染结果有变化的 ${signatures.size} 份：`);
    for (const [file, tags] of [...signatures].sort()) {
      console.log(`  ${file}  →  [${tags.join(',')}]  (${counts.get(file)!.join(' ')})`);
    }
    console.log(`\n二轮不收敛 ${nonConvergent.length} 份：`);
    for (const f of nonConvergent) console.log('  ' + f);

    // ── 硬断言 ①：ZWNJ 不出站（台账 §二 #32 的回归闸门）
    expect(
      zwnjHits,
      `以下文档「打开 → 保存」的落盘结果仍含 ZWNJ（U+200C），属性通道有漏剥：\n  ${zwnjHits.join('\n  ')}`,
    ).toEqual([]);

    // ── 硬断言 ②：二轮收敛（G2）
    expect(
      nonConvergent.length,
      `二轮不收敛的文档数（${nonConvergent.length}）超出棘轮基线（${KNOWN_NON_CONVERGENT}）——` +
        `「打开→保存→再保存」每轮都在变的文档必须逐个定位：\n  ${nonConvergent.join('\n  ')}`,
    ).toBeLessThanOrEqual(KNOWN_NON_CONVERGENT);

    // ── 硬断言 ③：变化签名棘轮（G3）
    const unknownFiles: string[] = [];
    const worsened: string[] = [];
    for (const [file, tags] of signatures) {
      const known = KNOWN_SCAN_SIGNATURES[file];
      if (known === undefined) {
        unknownFiles.push(`${file}  →  [${tags.join(',')}]`);
        continue;
      }
      const knownSet = new Set(known ? known.split(',') : []);
      const added = tags.filter((t) => !knownSet.has(t));
      if (added.length) worsened.push(`${file}  →  新增丢失类别 [${added.join(',')}]`);
    }
    expect(
      unknownFiles,
      `以下文档此前不在签名登记表里，却出现了净内容减少——逐份复核后决定「修」还是「登记」：\n  ${unknownFiles.join('\n  ')}`,
    ).toEqual([]);
    expect(
      worsened,
      `以下已登记文档出现了**新的**丢失类别（棘轮只收紧不放松）：\n  ${worsened.join('\n  ')}`,
    ).toEqual([]);

    // 收紧提示：修好了请删除/缩减登记
    const improved = [...signatures.keys()].filter((f) => !KNOWN_SCAN_SIGNATURES[f]);
    if (improved.length) {
      console.log(`\n（有 ${improved.length} 份文档已不在登记表里：请核对签名表，把已修好的行删掉收紧棘轮）`);
    }
  });
});
