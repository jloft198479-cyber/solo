/**
 * 阶段 0 · 换行现状钉子（docs/PROPOSAL-file-fidelity.md §2.2）
 *
 * 只钉「现在是什么」，不修任何东西。这组测试回答一个问题：
 * **Windows 换行（CRLF）的文件，是在哪一步被改成 LF 的？**
 *
 * 结论在这里被固定下来，W1 才有落脚点：如果归一发生在「解析」（markdown-it），
 * 那说明写盘时拿到的已经是 LF 全文 —— 光靠「不回写换行」修不了，
 * 必须在打开时把磁盘的换行方式单独记下来（就是方案里的 `layout`）。
 *
 * 纯函数级，不建编辑器（同 roundtrip.spec.ts）。
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../parser';
import { serializeMarkdown } from '../serializer';
import { createTestSchema } from './test-utils';

const schema = createTestSchema();
const pipeline = (md: string) => serializeMarkdown(parseMarkdown(schema, md));

describe('阶段 0 钉子：换行归一发生在哪一步', () => {
  it('LF 文件往返后与原文一致（回归基线，不改动）', () => {
    expect(pipeline('# a\n\nb\n')).toBe('# a\n\nb\n');
  });

  it('CRLF 文件：解析→序列化 已经变成 LF（归一是解析做的，不是写盘做的）', () => {
    const out = pipeline('# a\r\n\r\nb\r\n');
    expect(out).not.toContain('\r');
    expect(out).toBe('# a\n\nb\n');
  });

  it('CRLF 文件：序列化结果与磁盘原文不相等 ⇒ 打开那一刻布局信息就没了', () => {
    const disk = '# a\r\n\r\nb\r\n';
    // 这一条是 W1 必须新增 layout 字段的直接原因：编辑器内存里再也找不到原始换行。
    expect(pipeline(disk)).not.toBe(disk);
  });

  it('CRLF 归一后往返稳定：再跑一轮不再产生新差异（不是每次保存都掉一点）', () => {
    const once = pipeline('# a\r\n\r\nb\r\n');
    expect(pipeline(once)).toBe(once);
  });

  it('单独 CR（老 Mac 换行）同样被归一为 LF', () => {
    expect(pipeline('# a\r\rb\r')).toBe('# a\n\nb\n');
  });

  it('正文里的中文与行内格式不受归一影响（确认只动了换行字节）', () => {
    expect(pipeline('# 标题\r\n\r\n**加粗** 与 `代码`\r\n')).toBe('# 标题\n\n**加粗** 与 `代码`\n');
  });
});
