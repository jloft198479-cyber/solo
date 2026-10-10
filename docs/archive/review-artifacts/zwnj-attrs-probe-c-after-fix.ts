/**
 * 第三方复审 · 补测探针 C：验证 d1b7cd7「属性通道补口」是否收干净
 * 运行：npx vite-node docs/review-artifacts/zwnj-attrs-probe-c-after-fix.ts
 *
 * 三件事：
 *   [A] 复现改动者对我 F-1 的**推翻**——`[[a，**b]]`（未闭合 `**` + 标点）是否
 *       当下就建节点并落盘带 ZWNJ（我的探针 B 只测了闭合形态）。
 *   [B] 修复后同一形态是否已干净。
 *   [C] 我全枚举出的 14 个 attrs 读取点里，**未被本轮补剥**的三个字符串 attrs
 *       （link `href` / image `src` / codeBlock `language`）能否吃到 ZWNJ。
 *   [D] 存量脏文件（正文里已有 U+200C）重开后是否被清洗——入口/写出两侧都要净。
 */
import { createTestSchema } from '../../src/components/Editor/tiptap/markdown/__tests__/test-utils';
import { parseMarkdown } from '../../src/components/Editor/tiptap/markdown/parser';
import { serializeMarkdown } from '../../src/components/Editor/tiptap/markdown/serializer';

const ZW = '\u200C';
const schema = createTestSchema();

const vis = (s: string) => JSON.stringify(s.split(ZW).join('[ZW]'));

function probe(md: string) {
  const doc = parseMarkdown(schema, md);
  const out = serializeMarkdown(doc);
  const attrs: Record<string, string> = {};
  doc.descendants((n) => {
    if (!n.isText) {
      for (const [k, v] of Object.entries(n.attrs)) {
        if (typeof v === 'string' && v.length) attrs[`${n.type.name}.${k}`] = v;
      }
    }
    for (const m of n.marks) {
      for (const [k, v] of Object.entries(m.attrs)) {
        if (typeof v === 'string' && v.length) attrs[`mark.${m.type.name}.${k}`] = v;
      }
    }
    return true;
  });
  const dirty = Object.entries(attrs)
    .filter(([, v]) => v.includes(ZW))
    .map(([k]) => k);
  return { built: Object.keys(attrs).length, attrs, dirty, outZw: out.includes(ZW), out };
}

const CASES: [string, string][] = [
  // [A]/[B] 未闭合 ** + 标点（改动者声称的「当下就触发」）
  ['wikilink 未闭合', '[[a，**b]]\n'],
  ['wikilink 别名未闭合', '[[页|文，**章]]\n'],
  ['callout 标题未闭合', '> [!note] 甲，**乙\n'],
  ['callout 标题闭合带标点', '> [!note] 甲**乙**，丙\n'],
  // [C] 三个未补剥的字符串 attrs
  ['link href 未闭合', '[x](u，**b)\n'],
  ['link href 闭合+标点', '[x](u**b，c)\n'],
  ['image src 未闭合', '![i](p，**q.png)\n'],
  ['image src 闭合+标点', '![i](p**q，.png)\n'],
  ['link title 未闭合', '[x](u "甲，**乙")\n'],
  ['code fence language', '```js，**x\n代码\n```\n'],
  // [D] 存量脏：文件里已经躺着 U+200C
  ['存量 wikilink', '[[a' + ZW + 'b]]\n'],
  ['存量 image alt', '![' + ZW + '图](x.png)\n'],
  ['存量 href', '[x](u' + ZW + 'b)\n'],
  ['存量 src', '![i](p' + ZW + 'q.png)\n'],
  ['存量 footnote', '[^a' + ZW + 'b]\n\n[^a' + ZW + 'b]: 注\n'],
  ['存量 language', '```' + 'js' + ZW + '\n代码\n```\n'],
];

console.log('══ [C] 修复后属性通道落点全表（dirty=内存脏，outZw=落盘脏）══');
for (const [name, md] of CASES) {
  const r = probe(md);
  console.log(
    `  ${name.padEnd(20)} 内存脏属性=${JSON.stringify(r.dirty).padEnd(30)} 落盘含ZWNJ=${String(r.outZw).padEnd(5)} attrs=${JSON.stringify(Object.entries(r.attrs).map(([k, v]) => k + '=' + vis(v).slice(1, -1)))}\n${' '.repeat(22)}${vis(md)} -> ${vis(r.out)}`,
  );
}
