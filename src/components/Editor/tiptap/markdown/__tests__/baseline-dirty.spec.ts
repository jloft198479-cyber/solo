/**
 * 载入基线 → 脏标记 回归锁
 *
 * 锁定的契约：`fileStore` 的基线必须是「编辑器序列化产物」，不能是磁盘原文。
 * 因为 parse→serialize 不是字节等价往返（markdown-it 归一 CRLF/CR、PM 按 schema
 * 顺序重排同范围 marks），基线存原文会让「零编辑文档」在关窗语义比对时永远不等，
 * 表现为「什么都没改却提示保存」。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { parseMarkdown } from '../parser';
import { serializeMarkdown } from '../serializer';
import { createTestSchema } from './test-utils';
import { useFileStore } from '../../../../../stores/file';

/** 模拟一次「打开文档」：返回 { doc, 磁盘原文 } */
function openDocument(raw: string) {
  const schema = createTestSchema();
  const doc = parseMarkdown(schema, raw);
  return { doc, raw, live: serializeMarkdown(doc) };
}

/** 模拟关窗时的脏判定：evaluateDirtyFromEditor → syncEditedContent(live) */
function closeAndCheckDirty(baseline: string, live: string) {
  const store = useFileStore();
  store.setContent(baseline);
  return store.syncEditedContent(live);
}

describe('载入基线与脏标记', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('CRLF 文档（Windows 换行，必现场景）', () => {
    const raw = '# 标题\r\n\r\n正文第一段。\r\n\r\n- 列表项 A\r\n- 列表项 B\r\n';

    it('序列化产物已归一为 LF，与磁盘原文必然不等', () => {
      const { live } = openDocument(raw);

      expect(live).not.toBe(raw);
      expect(live.includes('\r')).toBe(false);
    });

    it('以磁盘原文做基线会误判脏（旧行为，锁死不再回退）', () => {
      const { raw: baseline, live } = openDocument(raw);

      expect(closeAndCheckDirty(baseline, live)).toBe(true);
    });

    it('以序列化产物做基线，零编辑不判脏', () => {
      const { live } = openDocument(raw);

      expect(closeAndCheckDirty(live, live)).toBe(false);
    });
  });

  describe('marks 顺序需重排的文档', () => {
    const raw = '~~**hello**~~\n';

    it('序列化把 bold 排到 strike 外层', () => {
      const { live } = openDocument(raw);

      expect(live.trim()).toBe('**~~hello~~**');
    });

    it('以序列化产物做基线，零编辑不判脏', () => {
      const { live } = openDocument(raw);

      expect(closeAndCheckDirty(live, live)).toBe(false);
    });
  });

  describe('基线稳定性（重新载入不再二次漂移）', () => {
    // MarkdownEditor 重建时会用 store 里的基线再次 parse，
    // 因此 serialize(parse(serialize(doc))) 必须等于 serialize(doc)。
    const samples = [
      '# 标题\r\n\r\n正文\r\n',
      '~~**hello**~~\n',
      '**a *b* c**\n\n> 引用\r\n\r\n```js\r\nconst x = 1;\r\n```\r\n',
      '| 甲 | 乙 |\r\n| --- | --- |\r\n| 1 | 2 |\r\n',
      '---\r\ntitle: frontmatter\r\n---\r\n\r\n正文\r\n',
    ];

    it.each(samples)('幂等：二次往返结果不变 %j', (raw) => {
      const first = openDocument(raw).live;
      const second = serializeMarkdown(parseMarkdown(createTestSchema(), first));

      expect(second).toBe(first);
    });
  });
});
