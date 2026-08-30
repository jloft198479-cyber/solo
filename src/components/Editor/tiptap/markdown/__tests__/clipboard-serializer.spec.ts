// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { NodeSelection } from '@tiptap/pm/state';
import { Slice } from '@tiptap/pm/model';

import { parseMarkdown } from '../parser';
import { serializeClipboardSlice, serializeMarkdown, serializeMarkdownForClipboard } from '../serializer';
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

// blockquote 与表格单元格各自新建内层序列化 state，此前用的是默认构造（文件模式），
// 会把 clipboard 模式丢掉，导致复制出来的文本多出 `\=` `\$`。
describe('clipboard 模式向嵌套 state 传播', () => {
  const schema = createTestSchema();
  // 三种容器放同一段正文，输出应当只有容器标记不同
  const TEXT = 'x = 1 与 100$ 报价';

  function clipboardOf(md: string): string {
    return serializeMarkdownForClipboard(parseMarkdown(schema, md));
  }

  it('基准：顶层段落走轻量转义', () => {
    expect(clipboardOf(TEXT)).toBe(`${TEXT}\n`);
  });

  it('引用块内的正文沿用轻量转义', () => {
    const out = clipboardOf(`> ${TEXT}`);
    expect(out).toBe(`> ${TEXT}\n`);
  });

  it('表格单元格内的正文沿用轻量转义', () => {
    const out = clipboardOf(['| 列 |', '| --- |', `| ${TEXT} |`].join('\n'));
    expect(out).toContain(`| ${TEXT} `);
    expect(out).not.toContain('\\');
  });

  it('文件保存模式仍严格转义（反向保护：别把落盘也放松了）', () => {
    const file = serializeMarkdown(parseMarkdown(schema, `> ${TEXT}`));
    expect(file).toContain('x \\= 1');
    expect(file).toContain('100\\$');
  });
});
