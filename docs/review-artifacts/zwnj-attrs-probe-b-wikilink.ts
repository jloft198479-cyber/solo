/**
 * 第三方审核 · 补充探针 B：互链（wikilink）的 attrs 是否构成 ZWNJ 落点
 * 生成时间：2026-10-10 ｜ 基准 commit 8f0a5f6
 *
 * 运行：
 *   npx vite-node docs/review-artifacts/zwnj-attrs-probe-b-wikilink.ts
 *
 * 背景：主探针（`zwnj-attrs-probe-2026-10-10.ts`）的 `[A]` 段确认了 6 个「属性携带
 * ZWNJ 并写盘」的落点。原改动者补测后**排除**了 `wikilink.target` / `wikilink.alias`，
 * 理由是「含 `*` 的互链根本不解析成 wikilink 节点」。
 *
 * `plugins/wikilink.ts:44-52` 的序列化器确实**直接 `state.write()` attrs**、不过
 * `escapeInline` ⇒ 只要节点能建成，attrs 就是第 7、8 个落点。本探针实测「目标 / 别名」
 * 两种形态各自能否建节点，把这条排除的**成立条件**钉死。
 */
import { createTestSchema } from '../../src/components/Editor/tiptap/markdown/__tests__/test-utils';
import { parseMarkdown } from '../../src/components/Editor/tiptap/markdown/parser';
import { serializeMarkdown } from '../../src/components/Editor/tiptap/markdown/serializer';

const ZW = '\u200C';
const schema = createTestSchema();

function vis(s: string): string {
  return JSON.stringify(s.split(ZW).join('[ZW]'));
}

function probe(md: string) {
  const doc = parseMarkdown(schema, md);
  const out = serializeMarkdown(doc);
  const wikilinks: { target: string; alias: string }[] = [];
  doc.descendants((n) => {
    if (n.type.name === 'wikilink') {
      wikilinks.push({ target: String(n.attrs.target ?? ''), alias: String(n.attrs.alias ?? '') });
    }
    return true;
  });
  const dirtyAttrs = wikilinks
    .map((w, i) => {
      const hits: string[] = [];
      if (w.target.includes(ZW)) hits.push('target');
      if (w.alias.includes(ZW)) hits.push('alias');
      return hits.length ? `wikilink[${i}].${hits.join('/')}` : '';
    })
    .filter(Boolean);
  return {
    built: wikilinks.length,
    attrs: wikilinks.map((w) => `${w.target}|${w.alias}`),
    dirtyAttrs,
    outHasZw: out.includes(ZW),
    out,
  };
}

const FORMS: [string, string][] = [
  ['对照：纯目标无强调', '[[笔记甲乙丙]]\n'],
  ['目标含强调（无标点触发）', '[[笔记甲**乙**丙]]\n'],
  ['目标含强调 + 中文标点触发', '[[笔记甲**乙**，丙]]\n'],
  ['别名含强调 + 中文标点触发', '[[目标|甲**乙**，丙]]\n'],
  ['目标+别名都含触发', '[[甲**乙**，丙|显示**名**，字]]\n'],
  ['别名含行内代码 + 触发', '[[目标|看 `码`**甲**，乙]]\n'],
];

console.log('══ [B] 互链 attrs 能否成为 ZWNJ 落点 ══');
for (const [name, md] of FORMS) {
  const r = probe(md);
  console.log(
    `  ${name.padEnd(24)} 建节点=${String(r.built).padEnd(3)} attrs=${JSON.stringify(r.attrs).padEnd(34)} 脏属性=${JSON.stringify(r.dirtyAttrs).padEnd(22)} 落盘含ZWNJ=${r.outHasZw}\n${' '.repeat(26)}${vis(md)} -> ${vis(r.out)}`,
  );
}
