// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { NodeSelection } from '@tiptap/pm/state';
import { Slice } from '@tiptap/pm/model';

import { parseMarkdown } from '../parser';
import { serializeClipboardSlice, serializeMarkdownForClipboard } from '../serializer';
import { createTestSchema } from './test-utils';

// 出站复制修复：选区序列化为 Markdown 纯文本，确保 solo 扩展语法粘到外部
// Markdown 编辑器时不丢标记（见 markdown-paste 审查报告「问题 1」）。
describe('serializeClipboardSlice（出站复制）', () => {
  const schema = createTestSchema();

  const MD = [
    '> [!NOTE]',
    '> 这是一个 callout',
    '',
    '行内公式 $E=mc^2$ 与块公式：',
    '',
    '$$',
    '\\int_0^1 x^2\\,dx',
    '$$',
    '',
    '```mermaid',
    'flowchart TD',
    '  A --> B',
    '```',
    '',
    '参考 [[我的页面]] 和脚注[^1]。',
    '',
    '[^1]: 这是脚注定义',
  ].join('\n');

  it('整篇选区保留全部扩展语法标记', () => {
    const doc = parseMarkdown(schema, MD);
    const slice = new Slice(doc.content, 0, 0);
    const out = serializeClipboardSlice(doc, slice);

    // 核心回归：扩展语法标记必须完整出现在 text/plain 里
    expect(out).toContain('> [!NOTE]');
    expect(out).toContain('$E=mc^2$');
    // 块公式保留为 $$ 围栏（多行标准形式），内容与标记均不丢
    expect(out).toContain('$$');
    expect(out).toContain('\\int_0^1 x^2\\,dx');
    expect(out).toContain('```mermaid');
    expect(out).toContain('[[我的页面]]');
    expect(out).toContain('[^1]:');
  });

  it('整篇选区等价于整篇文档的剪贴板序列化', () => {
    const doc = parseMarkdown(schema, MD);
    const slice = new Slice(doc.content, 0, 0);
    const out = serializeClipboardSlice(doc, slice);
    // doc.copy(doc.content) 内容等同 doc，结果应与整篇剪贴板序列化一致
    expect(out).toBe(serializeMarkdownForClipboard(doc));
  });

  it('仅选中 callout 节点时，输出只含该 callout 的 Markdown', () => {
    const doc = parseMarkdown(schema, MD);
    // 节点选择第一个顶层节点（callout）
    const sel = NodeSelection.create(doc, 0);
    const slice = sel.content();
    const out = serializeClipboardSlice(doc, slice);

    expect(out).toContain('> [!NOTE]');
    expect(out).toContain('这是一个 callout');
    // 不应泄漏后续的数学 / mermaid 内容
    expect(out).not.toContain('mermaid');
    expect(out).not.toContain('$$');
  });
});
