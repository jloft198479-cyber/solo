// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';

import { parseMarkdown } from '../parser';
import {
  serializeClipboardSlice,
  serializeClipboardText,
  serializeMarkdown,
  serializeMarkdownForClipboard,
} from '../serializer';
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

// 开口 slice 剥层：选区落在表格/引用块/列表等容器内时，slice 的边界节点是
// 「部分包含」的容器，doc.copy(slice.content) 丢掉开口标记后会被序列化器当
// 闭合节点整段渲染——格内选两个字粘出去变成整张 GFM 表格（v1.2.43 只压平
// 了 CellSelection 的 text/html，没修 text/plain 管道这一层）。
// 修复后：剥开口层，只序列化完全包含的内容，粘出「选什么粘什么」。
describe('serializeClipboardSlice 开口 slice 剥层（容器内选区）', () => {
  const schema = createTestSchema();
  const TABLE_MD = ['| 应用 |', '| --- |', '| 剪映 |', '| 美图 |'].join('\n');
  const doc = parseMarkdown(schema, TABLE_MD);

  function textPos(d: ReturnType<typeof parseMarkdown>, needle: string): [number, number] {
    let from = -1;
    d.descendants((node, pos) => {
      if (from < 0 && node.isText && node.text === needle) from = pos;
    });
    return [from, from + needle.length];
  }

  it('格内 TextSelection 两个字：只粘出选中的文字，不带表格语法', () => {
    const [from, to] = textPos(doc, '剪映');
    const slice = TextSelection.create(doc, from, to).content();
    // 核心回归：此前输出 `| 剪映 |\n| ---- |\n`
    expect(serializeClipboardSlice(doc, slice)).toBe('剪映\n');
  });

  it('格内三击选整段：同样只粘出该格文字', () => {
    const [from] = textPos(doc, '剪映');
    const $from = doc.resolve(from);
    const slice = TextSelection.create(doc, $from.before($from.depth), $from.after($from.depth)).content();
    expect(serializeClipboardSlice(doc, slice)).toBe('剪映\n');
  });

  it('CellSelection 同构 slice（row 开口 1,1）：不带表格语法', () => {
    // prosemirror-tables 的 CellSelection.content() 返回 Slice(Fragment.from(rows), 1, 1)；
    // 真实复制时 text/plain 由 MarkdownEditor 的 onEditorCopy 用 TSV 覆盖，
    // 这里守护 serializer 兜底路径至少不输出表格语法。
    const table = doc.firstChild!;
    const slice = new Slice(Fragment.from(table.firstChild!), 1, 1);
    const out = serializeClipboardSlice(doc, slice);
    expect(out).not.toContain('|');
    expect(out).toContain('应用');
  });

  it('CellSelection 覆盖整表（content() 返回整表，开口 1,1）：逐格平铺', () => {
    const table = doc.firstChild!;
    const slice = new Slice(Fragment.from(table), 1, 1);
    const out = serializeClipboardSlice(doc, slice);
    expect(out).not.toContain('|');
    expect(out).toContain('应用');
    expect(out).toContain('剪映');
    expect(out).toContain('美图');
  });

  it('引用块内选两个字：剥掉容器标记，只粘出文字', () => {
    const doc2 = parseMarkdown(schema, '> 这是引用');
    const [from, to] = textPos(doc2, '这是引用');
    const slice = TextSelection.create(doc2, from, to).content();
    const out = serializeClipboardSlice(doc2, slice);
    expect(out).toBe('这是引用\n');
    expect(out).not.toContain('>');
  });

  it('列表项内选两个字：剥掉列表标记', () => {
    const doc2 = parseMarkdown(schema, '- 苹果\n- 香蕉');
    const [from, to] = textPos(doc2, '苹果');
    const slice = TextSelection.create(doc2, from, to).content();
    expect(serializeClipboardSlice(doc2, slice)).toBe('苹果\n');
  });

  it('顶层跨段选区：两段各保留截断后的段落与分隔', () => {
    const doc2 = parseMarkdown(schema, '第一段内容\n\n第二段内容');
    const [from1] = textPos(doc2, '第一段内容');
    const [from2] = textPos(doc2, '第二段内容');
    // 段 1 从「第一」之后起、段 2 到「第二」止（文字 pos 内部偏移）
    const slice = TextSelection.create(doc2, from1 + 2, from2 + 2).content();
    const out = serializeClipboardSlice(doc2, slice);
    expect(out).toBe('段内容\n\n第二\n');
  });

  it('闭合 slice（整篇）不受剥层影响：扩展语法标记不丢', () => {
    const doc2 = parseMarkdown(schema, '> [!NOTE]\n> 提示\n\n[链接](https://a.b)');
    const slice = new Slice(doc2.content, 0, 0);
    const out = serializeClipboardSlice(doc2, slice);
    expect(out).toContain('> [!NOTE]');
    expect(out).toContain('[链接](https://a.b)');
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

// 默认复制照 Typora 范式：纯文本槽 = 渲染后的文字（去掉标记、不补反斜杠），
// 只有选区含 solo 专有语法时才回落 Markdown 源码——这些语法纯文本表达不了，
// 与其静默丢公式，不如给源码。
describe('serializeClipboardText（纯文本槽：干净文字 / 专有语法回落）', () => {
  const schema = createTestSchema();
  const whole = (md: string): string => {
    const doc = parseMarkdown(schema, md);
    return serializeClipboardText(doc, new Slice(doc.content, 0, 0));
  };

  it('文本型内容只留文字，不留标记', () => {
    expect(whole('## 标题')).toBe('标题');
    expect(whole('**粗体** 与 *斜体*')).toBe('粗体 与 斜体');
    expect(whole('> 引用一句')).toBe('引用一句');
    expect(whole('`code`')).toBe('code');
  });

  it('关键回归：`=` `$` `*` 不再被补反斜杠', () => {
    expect(whole('x = 1 与 100$ 报价')).toBe('x = 1 与 100$ 报价');
    expect(whole('a*b')).toBe('a*b');
    expect(whole('C:\\Users\\me\\notes')).toBe('C:\\Users\\me\\notes');
  });

  it('真实场景：整篇笔记复制出去零反斜杠', () => {
    const md = ['# 标题', '', '价格 100$ 与 x=1，含 `代码` 与 *强调*。', '', '- 甲', '- 乙'].join('\n');
    expect(whole(md)).not.toContain('\\');
  });

  it('列表项逐行给出，不残留 marker', () => {
    expect(whole('- 苹果\n- 香蕉')).toBe('苹果\n\n香蕉');
    expect(whole('1. 第一\n2. 第二')).toBe('第一\n\n第二');
  });

  it('分隔线用 --- 占位（属可纯文本化，不触发回落）', () => {
    const out = whole('第一段\n\n---\n\n第二段');
    expect(out).toContain('---');
    expect(out).not.toContain('\\');
  });

  it('硬换行保留为换行', () => {
    expect(whole('上一行\\\n下一行')).toBe('上一行\n下一行');
  });

  it('含专有语法 → 回落 Markdown 源码', () => {
    expect(whole('行内公式 $E=mc^2$ 在此')).toContain('$E=mc^2$');
    expect(whole('参考 [[我的页面]]')).toContain('[[我的页面]]');
    expect(whole('> [!NOTE]\n> 提示')).toContain('> [!NOTE]');
    expect(whole('```mermaid\nflowchart TD\n```')).toContain('```mermaid');
    expect(whole('![图](a.png)')).toContain('![图](a.png)');
    expect(whole('文本[^1]\n\n[^1]: 脚注')).toContain('[^1]');
    expect(whole('---\ntitle: x\n---\n\n正文')).toContain('title: x');
  });

  it('专有节点藏在容器里也能识别（不漏判）', () => {
    expect(whole('- 列表里塞公式 $x^2$')).toContain('$x^2$');
    expect(whole('> 引用里塞 [[链接]]')).toContain('[[链接]]');
  });

  it('开口 slice 剥层对两条路都生效', () => {
    const doc = parseMarkdown(schema, ['| 应用 |', '| --- |', '| 剪映 |'].join('\n'));
    let from = -1;
    doc.descendants((node, pos) => {
      if (from < 0 && node.isText && node.text === '剪映') from = pos;
    });
    const slice = TextSelection.create(doc, from, from + 2).content();
    expect(serializeClipboardText(doc, slice)).toBe('剪映');
  });
});
