import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../parser';
import { serializeMarkdown } from '../serializer';
import { createTestSchema } from './test-utils';

function getDoc(md: string) {
  const schema = createTestSchema();
  return parseMarkdown(schema, md);
}

function checkBoldInDoc(doc: any): boolean {
  let hasBold = false;
  doc.descendants((n: any) => {
    if (n.marks?.some((m: any) => m.type.name === 'bold')) hasBold = true;
  });
  return hasBold;
}

describe('CJK bold diagnostic', () => {
  const cases = [
    '**「hello world」**',
    '**「网页转电脑软件的超级瘦身工具」**',
    '**「hello」** world',
    'hello **「world」**',
    '嘿**「你好」**',
    '嘿，**「你好」**。',
    '嘿 **「你好」** 吗',
    '**「你好」**吗',
  ];

  for (const md of cases) {
    it(md, () => {
      const doc = getDoc(md);
      const hasBold = checkBoldInDoc(doc);
      const serialized = serializeMarkdown(doc);
      console.log(`INPUT: ${md}`);
      console.log(`BOLD: ${hasBold}`);
      console.log(`OUT:  ${JSON.stringify(serialized.trim())}`);

      const doc2 = getDoc(serialized);
      const hasBold2 = checkBoldInDoc(doc2);
      const serialized2 = serializeMarkdown(doc2);

      expect(hasBold).toBe(true);
      expect(hasBold2).toBe(true);
      expect(serialized2).toBe(serialized);
    });
  }
});
