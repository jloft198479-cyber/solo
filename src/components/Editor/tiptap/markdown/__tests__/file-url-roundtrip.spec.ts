/**
 * file: 目的地可往返锁（审计 2026-10-25 P2-5b）。
 *
 * 我防的事故：markdown-it 默认 validateLink 拒绝 file:，磁盘上已有的
 * `![](file:///D:/photos/cat.png)` 打开时被当**字面文本**，serializer 又把
 * `[` 恒转义成 `\[` ⇒ 每存一次坏一层、**二次不可逆**（连手改回原文的机会都没了，
 * 核实报告实测坐实）。修法：parser 放行 file: 目的地成节点——src/href 原样往返
 * （字节稳定），跳转仍被 link-open 的 http/https/mailto 白名单挡住，图片在编辑器
 * 里是「破图占位」而非内容损坏。javascript:/vbscript: 维持默认拒绝。
 *
 * 反向校准（准入②，执行时已做）：撤掉 validateLink 放行 ⇒ 前两条转红。
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

function linkHrefs(md: string): string[] {
  const doc = parseMarkdown(createTestSchema(), md);
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.isText) {
      const m = n.marks.find((mk) => mk.type.name === 'link');
      if (m) out.push(m.attrs.href as string);
    }
    return true;
  });
  return out;
}

describe('file: 目的地可往返（P2-5b）', () => {
  it('![](file:///…) 打开是图片节点、落盘字节稳定、二轮收敛', () => {
    const md = '![猫](file:///D:/photos/cat.png)';
    const imgs = findNodes(md, 'image');
    expect(imgs, '必须是图片节点，不是字面文本').toHaveLength(1);
    expect(imgs[0].attrs.src).toBe('file:///D:/photos/cat.png');
    expect(imgs[0].attrs.alt).toBe('猫');
    const r1 = roundTrip(md);
    expect(r1, '首存字节保真（不出现 \\[ 转义噪音）').toBe(md + '\n');
    expect(roundTrip(r1), '二轮收敛').toBe(r1);
  });

  it('[本地](file:///…) 链接节点保真往返', () => {
    const md = '[本地笔记](file:///C:/notes/a.md)';
    const hrefs = linkHrefs(md);
    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toBe('file:///C:/notes/a.md');
    expect(roundTrip(md)).toBe(md + '\n');
  });

  it('javascript: 仍被默认 validateLink 拒绝（放行只给 file:）', () => {
    expect(findNodes('![](javascript:alert(1))', 'image')).toHaveLength(0);
  });
});
