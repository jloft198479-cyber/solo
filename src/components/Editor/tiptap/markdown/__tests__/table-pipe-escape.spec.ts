/**
 * 表格单元格内「属性通道」的 `|` 转义锁（审计 2026-10-25 P1-1）。
 *
 * 我防的事故：单元格里的公式/互链/链接/图片（Obsidian 用户的标准写法
 * `$p\|q$`、`[[甲\|乙]]`）首次保存把 `\|` 还原成裸 `|` 写回 ⇒ 重开整行
 * 切列、公式劈成两半变字面、互链劈开——损坏不可逆（第二轮在坏形态上收敛）。
 * 文本 / 行内 code / 图片 alt 通道已有同款转义（`serializer` 的 inTableCell
 * 分支），这批漏的是**不经 escapeInline 的属性与定界符通道**：latex /
 * wikilink 别名 / link 的 href 与 title / image 的 src 与 title / 脚注 label。
 *
 * 反向校准（准入②，执行时已做）：撤掉任一写出点的 escapeCellPipe ⇒ 对应用例转红。
 */
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseMarkdown } from '../parser';
import { serializeMarkdown } from '../serializer';
import { createTestSchema, reopenDrift, roundTrip, roundTripClipboard } from './test-utils';

const TABLE = (cell: string) => `| a | b |\n| --- | --- |\n| ${cell} | x |`;

function findNodes(md: string, name: string): PMNode[] {
  const doc = parseMarkdown(createTestSchema(), md);
  const out: PMNode[] = [];
  doc.descendants((n) => {
    if (n.type.name === name) out.push(n);
    return true;
  });
  return out;
}

function findMarks(md: string, name: string): Array<Record<string, unknown>> {
  const doc = parseMarkdown(createTestSchema(), md);
  const out: Array<Record<string, unknown>> = [];
  doc.descendants((n) => {
    if (n.isText) {
      const m = n.marks.find((mk) => mk.type.name === name);
      if (m) out.push(m.attrs as Record<string, unknown>);
    }
    return true;
  });
  return out;
}

describe('表格单元格内属性通道的 `|` 转义（P1-1）', () => {
  it('行内公式：$p\\|q$ 首存保留 \\|，重开仍是同一格里的一条公式', () => {
    const md = TABLE('$p\\|q$ 的值');
    const r1 = roundTrip(md);
    expect(r1, '写出必须保留 \\|（裸 | 重开切列）').toContain('$p\\|q$ 的值');
    expect(reopenDrift(md, r1), '内容不得漂移').toEqual([]);
    const maths = findNodes(r1, 'mathInline');
    expect(maths, '重开后公式仍是一条（不被切列劈开）').toHaveLength(1);
    expect(maths[0].attrs.latex).toBe('p|q');
    expect(roundTrip(r1), '二轮稳定').toContain('$p\\|q$ 的值');
  });

  it('互链别名：[[甲\\|乙]] 首存保留转义，重开 target/alias 不劈', () => {
    const md = TABLE('[[甲\\|乙]]');
    const r1 = roundTrip(md);
    expect(r1).toContain('[[甲\\|乙]]');
    expect(reopenDrift(md, r1)).toEqual([]);
    const links = findNodes(r1, 'wikilink');
    expect(links).toHaveLength(1);
    expect(links[0].attrs.target).toBe('甲');
    expect(links[0].attrs.alias).toBe('乙');
  });

  it('链接 href（round-trip）：解析侧 normalizeLink 把 | 编成 %7C，往返稳定不切列', () => {
    const md = TABLE('[t](a\\|b)');
    const r1 = roundTrip(md);
    expect(r1).toContain('](a%7Cb)');
    const ls = findMarks(r1, 'link');
    expect(ls).toHaveLength(1);
    expect(ls[0].href).toBe('a%7Cb');
  });

  it('链接 href（写出侧构造）：attrs 含裸 | 时必须写 \\|，不得切列', () => {
    const schema = createTestSchema();
    const text = schema.text('t', [schema.marks.link.create({ href: 'a|b' })]);
    const p = schema.nodes.paragraph.create(null, [text]);
    const cell = schema.nodes.tableCell.create(null, p);
    const row = schema.nodes.tableRow.create(null, cell);
    const table = schema.nodes.table.create(null, row);
    const out = serializeMarkdown(schema.nodes.doc.create(null, table));
    expect(out).toContain('](a\\|b)');
  });

  it('链接 title：[t](u "i\\|j") 首存保留转义', () => {
    const md = TABLE('[t](u "i\\|j")');
    const r1 = roundTrip(md);
    expect(r1).toContain('"i\\|j"');
    expect(findMarks(r1, 'link')[0].title).toBe('i|j');
  });

  it('图片 src（round-trip）：解析侧 normalizeLink 把 | 编成 %7C，往返稳定不切列', () => {
    const md = TABLE('![a](s\\|t.png)');
    const r1 = roundTrip(md);
    expect(r1).toContain('(s%7Ct.png)');
    const imgs = findNodes(r1, 'image');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].attrs.src).toBe('s%7Ct.png');
  });

  it('图片 src（写出侧构造）：attrs 含裸 | 时必须写 \\|，不得切列', () => {
    const schema = createTestSchema();
    const img = schema.nodes.image.create({ src: 's|t.png', alt: '' });
    const p = schema.nodes.paragraph.create(null, [img]);
    const cell = schema.nodes.tableCell.create(null, p);
    const row = schema.nodes.tableRow.create(null, cell);
    const table = schema.nodes.table.create(null, row);
    const out = serializeMarkdown(schema.nodes.doc.create(null, table));
    expect(out).toContain('(s\\|t.png)');
  });

  it('图片 title：![a](s.png "i\\|j") 首存保留转义', () => {
    const md = TABLE('![a](s.png "i\\|j")');
    const r1 = roundTrip(md);
    expect(r1).toContain('"i\\|j"');
    expect(findNodes(r1, 'image')[0].attrs.title).toBe('i|j');
  });

  it('脚注 label（写出侧构造）：格内 label 含 | 必须写出 [^a\\|b]', () => {
    const schema = createTestSchema();
    const ref = schema.nodes.footnoteRef.create({ label: 'a|b' });
    const p = schema.nodes.paragraph.create(null, [ref]);
    const cell = schema.nodes.tableCell.create(null, p);
    const row = schema.nodes.tableRow.create(null, cell);
    const table = schema.nodes.table.create(null, row);
    const out = serializeMarkdown(schema.nodes.doc.create(null, table));
    expect(out).toContain('[^a\\|b]');
  });

  it('剪贴板模式同口径：复制表格出站也带 \\|（GFM 切列语义与粘贴目标无关）', () => {
    const out = roundTripClipboard(TABLE('$p\\|q$ 的值'));
    expect(out).toContain('$p\\|q$');
  });
});
