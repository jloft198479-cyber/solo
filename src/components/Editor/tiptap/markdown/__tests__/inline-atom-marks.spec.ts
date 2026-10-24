/**
 * 行内原子节点携带 marks 的保真锁（审计 2026-10-25 P1-2）。
 *
 * 我防的事故：`[![alt](img)](url)` 打开→保存后 `[…](url)` 整条外链**静默消失**
 * —— `parser.addNode` 建行内节点时不带当前 marks（`closeNode` 一直带，唯独这里
 * 漏了第三参），图片丢 link mark ⇒ 序列化时外层链接定界符无处安放。README 徽章、
 * 博客缩略图的高频形态。同族：`**![a](i)**` / `**$x$**` 丢加粗。
 *
 * 反向校准（准入②，执行时已做）：addNode 撤掉 marks 第三参 ⇒ 本文件转红。
 */
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseMarkdown } from '../parser';
import { createTestSchema, roundTrip } from './test-utils';

function findNodes(md: string, name: string): PMNode[] {
  const doc = parseMarkdown(createTestSchema(), md);
  const out: PMNode[] = [];
  doc.descendants((n) => {
    if (n.type.name === name) out.push(n);
    return true;
  });
  return out;
}

describe('行内原子节点携带 marks（P1-2）', () => {
  it('[![alt](img)](url)：图片带 link mark，外链字节保真', () => {
    const md = '[![alt](i.png)](https://x.com)';
    const imgs = findNodes(md, 'image');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].marks.map((m) => m.type.name)).toContain('link');
    expect(roundTrip(md)).toBe(md + '\n');
  });

  it('**![alt](img)**：图片带 bold mark，字节保真', () => {
    const md = '**![alt](i.png)**';
    expect(findNodes(md, 'image')[0].marks.map((m) => m.type.name)).toContain('bold');
    expect(roundTrip(md)).toBe(md + '\n');
  });

  it('**$x$**：行内公式带 bold mark，字节保真', () => {
    const md = '**$x$**';
    expect(findNodes(md, 'mathInline')[0].marks.map((m) => m.type.name)).toContain('bold');
    expect(roundTrip(md)).toBe(md + '\n');
  });

  it('裸图片行为不变：无 mark 图片照常往返', () => {
    const md = '![a](i.png)';
    expect(findNodes(md, 'image')[0].marks).toHaveLength(0);
    expect(roundTrip(md)).toBe(md + '\n');
  });
});
