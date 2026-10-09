import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

import { createTestSchema } from '../../markdown/__tests__/test-utils';
import {
  convertPendingHeading,
  convertPendingInlineMarks,
  convertPendingLink,
  markdownInputPlugin,
  markdownInputPluginKey,
  revertEmptyHeading,
} from '../markdown-input';

function convertInlineSyntax(text: string) {
  const schema = createTestSchema();
  const paragraph = schema.nodes.paragraph.create(null, [schema.text(text)]);
  const doc = schema.nodes.doc.create(null, [paragraph]);
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 1 + text.length),
  });

  const tr = convertPendingInlineMarks(state.tr, state);
  return tr ? state.apply(tr).doc.toJSON() : state.doc.toJSON();
}

function markedText(text: string, markName: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', marks: [{ type: markName }], text }],
      },
    ],
  };
}

describe('convertPendingInlineMarks', () => {
  it('converts bold markdown (star) with Chinese text', () => {
    expect(convertInlineSyntax('**加粗**')).toEqual(markedText('加粗', 'bold'));
  });

  it('converts bold markdown (underscore)', () => {
    expect(convertInlineSyntax('__加粗__')).toEqual(markedText('加粗', 'bold'));
  });

  it('converts italic markdown (star and underscore)', () => {
    expect(convertInlineSyntax('*斜体*')).toEqual(markedText('斜体', 'italic'));
    expect(convertInlineSyntax('_斜体_')).toEqual(markedText('斜体', 'italic'));
  });

  it('converts strike markdown', () => {
    expect(convertInlineSyntax('~~删除~~')).toEqual(markedText('删除', 'strike'));
  });

  it('converts code markdown', () => {
    expect(convertInlineSyntax('`code`')).toEqual(markedText('code', 'code'));
  });

  it('converts highlight markdown', () => {
    expect(convertInlineSyntax('==高亮==')).toEqual(markedText('高亮', 'highlight'));
  });

  it('converts superscript and subscript markdown', () => {
    expect(convertInlineSyntax('^sup^')).toEqual(markedText('sup', 'superscript'));
    expect(convertInlineSyntax('~sub~')).toEqual(markedText('sub', 'subscript'));
  });

  it('preserves leading whitespace before markdown markers', () => {
    expect(convertInlineSyntax('hello **world**')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hello ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'world' },
          ],
        },
      ],
    });
  });

  it('does not convert incomplete markdown', () => {
    expect(convertInlineSyntax('**未完成*')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '**未完成*' }],
        },
      ],
    });
  });
});

function convertLinkSyntax(text: string) {
  const schema = createTestSchema();
  const paragraph = schema.nodes.paragraph.create(null, [schema.text(text)]);
  const doc = schema.nodes.doc.create(null, [paragraph]);
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 1 + text.length),
  });

  const tr = convertPendingLink(state.tr, state);
  return tr ? state.apply(tr).doc.toJSON() : state.doc.toJSON();
}

describe('convertPendingLink', () => {
  it('converts `[text](url)` into a link mark with href', () => {
    expect(convertLinkSyntax('[OpenAI](https://openai.com)')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              // 生产 Link 扩展对站外链接自动补安全和打开方式属性（rel/target），
              // 并带 HTMLAttributes.class —— 三者皆为生产真实输出，非测试臆造。
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://openai.com',
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: '',
                    title: null,
                  },
                },
              ],
              text: 'OpenAI',
            },
          ],
        },
      ],
    });
  });

  it('converts a link with Chinese link text', () => {
    const json = convertLinkSyntax('[中文链接](https://a.com)');
    const textNode = json.content[0].content[0];
    expect(textNode.text).toBe('中文链接');
    expect(textNode.marks[0].type).toBe('link');
    expect(textNode.marks[0].attrs.href).toBe('https://a.com');
  });

  it('keeps text before the link unmarked', () => {
    const json = convertLinkSyntax('see [docs](https://x.com)');
    expect(json.content[0].content).toEqual([
      { type: 'text', text: 'see ' },
      {
        type: 'text',
        marks: [
          {
            type: 'link',
            attrs: {
              href: 'https://x.com',
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
              class: '',
              title: null,
            },
          },
        ],
        text: 'docs',
      },
    ]);
  });

  it('does not convert incomplete or empty link syntax', () => {
    expect(convertLinkSyntax('[text](')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '[text](' }] }],
    });
    expect(convertLinkSyntax('[text]()')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '[text]()' }] }],
    });
    expect(convertLinkSyntax('[](https://x.com)')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '[](https://x.com)' }] }],
    });
  });

  it('does not convert when a url contains whitespace', () => {
    expect(convertLinkSyntax('[text](https://x.com a)')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '[text](https://x.com a)' }] }],
    });
  });

  it('does not eat image syntax `![alt](url)` (regression: was mangled into "!" + link)', () => {
    expect(convertLinkSyntax('![图](https://x.com/i.png)')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '![图](https://x.com/i.png)' }] },
      ],
    });
    // 守卫只挡 `!` 紧邻：前置非 `!` 的普通链接仍正常转换，不被误伤
    const ok = convertLinkSyntax('看 [docs](https://x.com)');
    expect(ok.content[0].content[1].marks[0].type).toBe('link');
  });
});

describe('convertPendingHeading', () => {
  it('converts a `# 文字` paragraph into a heading once it has content', () => {
    const schema = createTestSchema();
    const state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('# Hello')]),
      ]),
    });

    const tr = convertPendingHeading(state.tr, state.doc, schema.nodes.heading);
    expect(tr).not.toBeNull();

    const heading = state.apply(tr!).doc.firstChild;
    expect(heading?.type.name).toBe('heading');
    expect(heading?.attrs.level).toBe(1);
    expect(heading?.textContent).toBe('Hello');
  });

  it('does not convert a `# ` prefix with no content yet', () => {
    const schema = createTestSchema();
    const state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [schema.text('# ')]),
      ]),
    });

    expect(convertPendingHeading(state.tr, state.doc, schema.nodes.heading)).toBeNull();
  });
});

/**
 * 父块可行性契约（KNOWN-ISSUES §二 #25）。
 *
 * 旧实现「先 `tr.delete(前缀)` 再 `setBlockType`」：改型一旦被父块拒绝，
 * 前缀已经删掉且事务照发 ⇒ `# ` 静默消失、标题也不生成（用户可见的字符丢失）。
 * 契约：**改型不成立时整步不做**，标记原样留着；成立时照常转换。
 */
describe('convertPendingHeading 的父块可行性', () => {
  /** 复现生产调用形态：`appendTransaction` 恒显式传 pending。 */
  function pendingOf(doc: PMNode, text: string): { level: number; paragraphPos: number; prefixLength: number } {
    let hit: { level: number; paragraphPos: number; prefixLength: number } | null = null;
    doc.descendants((node, pos) => {
      if (hit) return false;
      if (node.type.name !== 'paragraph' || node.textContent !== text) return true;
      const match = /^(#{1,6})\s/.exec(text);
      if (match) hit = { level: match[1].length, paragraphPos: pos, prefixLength: match[1].length + 1 };
      return false;
    });
    if (!hit) throw new Error(`测试文档里找不到段落：${text}`);
    return hit;
  }

  function convertInDoc(doc: PMNode) {
    const schema = doc.type.schema;
    const state = EditorState.create({ schema, doc });
    const tr = convertPendingHeading(state.tr, state.doc, schema.nodes.heading, pendingOf(doc, '# 标题'));
    return { tr, next: tr ? state.apply(tr).doc : doc };
  }

  it('列表项首块只收 paragraph ⇒ 整步不做，`# ` 原样保留', () => {
    const schema = createTestSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.bulletList.create(null, [
        schema.nodes.listItem.create(null, [schema.nodes.paragraph.create(null, [schema.text('# 标题')])]),
      ]),
    ]);

    const { tr, next } = convertInDoc(doc);
    expect(tr).toBeNull();
    expect(next.textContent).toBe('# 标题');
  });

  it('任务项首块同理（taskItem 同约束）', () => {
    const schema = createTestSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.taskList.create(null, [
        schema.nodes.taskItem.create(null, [schema.nodes.paragraph.create(null, [schema.text('# 标题')])]),
      ]),
    ]);

    const { tr, next } = convertInDoc(doc);
    expect(tr).toBeNull();
    expect(next.textContent).toBe('# 标题');
  });

  it('列表项内第二块收 heading ⇒ 照常转换（不得一刀切禁止）', () => {
    const schema = createTestSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.bulletList.create(null, [
        schema.nodes.listItem.create(null, [
          schema.nodes.paragraph.create(null, [schema.text('甲')]),
          schema.nodes.paragraph.create(null, [schema.text('# 标题')]),
        ]),
      ]),
    ]);

    const { tr, next } = convertInDoc(doc);
    expect(tr).not.toBeNull();

    const item = next.firstChild?.firstChild;
    expect(item?.childCount).toBe(2);
    expect(item?.child(0).textContent).toBe('甲');
    expect(item?.child(1).type.name).toBe('heading');
    expect(item?.child(1).attrs.level).toBe(1);
    expect(item?.child(1).textContent).toBe('标题');
  });

  it('引用块收 heading ⇒ 照常转换（探针不得误伤合法父块）', () => {
    const schema = createTestSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.blockquote.create(null, [schema.nodes.paragraph.create(null, [schema.text('# 标题')])]),
    ]);

    const { tr, next } = convertInDoc(doc);
    expect(tr).not.toBeNull();
    expect(next.firstChild?.firstChild?.type.name).toBe('heading');
    expect(next.firstChild?.firstChild?.textContent).toBe('标题');
  });
});

/**
 * 装饰层必须与转换层同判据：变不成标题的段落若仍套 `mk-pending-heading`，
 * 它会按标题字号/字重渲染、`# ` 停在装订线里——看着像标题、实际是死文本。
 */
describe('pending heading 装饰的父块可行性', () => {
  function docOf() {
    const schema = createTestSchema();
    return schema.nodes.doc.create(null, [
      schema.nodes.bulletList.create(null, [
        schema.nodes.listItem.create(null, [schema.nodes.paragraph.create(null, [schema.text('# 标题')])]),
      ]),
      schema.nodes.paragraph.create(null, [schema.text('# 真标题')]),
    ]);
  }

  function paragraphPos(doc: PMNode, prefix: string): number {
    let hit = -1;
    doc.descendants((node, pos) => {
      if (hit >= 0) return false;
      if (node.type.name === 'paragraph' && node.textContent.startsWith(prefix)) hit = pos;
      return true;
    });
    return hit;
  }

  it('初始全量构建：只给文档级那个段落挂装饰（每个 pending 段 2 条）', () => {
    const doc = docOf();
    const state = EditorState.create({ schema: doc.type.schema, doc, plugins: [markdownInputPlugin()] });
    const froms = markdownInputPluginKey.getState(state)?.decorations.find().map((d) => d.from) ?? [];

    expect(froms.length).toBe(2);
    expect(froms.every((from) => from >= paragraphPos(doc, '# 真标题'))).toBe(true);
  });

  it('增量路径：在列表项那个段落里打字，也不给它补装饰', () => {
    const doc = docOf();
    const state = EditorState.create({ schema: doc.type.schema, doc, plugins: [markdownInputPlugin()] });

    const target = paragraphPos(doc, '# 标题');
    const inner = doc.nodeAt(target);
    expect(inner).not.toBeNull();
    const at = target + 1 + (inner?.content.size ?? 0);

    const next = state.apply(state.tr.insertText('字', at));
    const froms = markdownInputPluginKey.getState(next)?.decorations.find().map((d) => d.from) ?? [];

    expect(froms.length).toBe(2);
    expect(froms.every((from) => from >= paragraphPos(doc, '# 真标题'))).toBe(true);
  });
});

describe('revertEmptyHeading', () => {
  it('reverts an empty heading back to a `# ` paragraph', () => {
    const schema = createTestSchema();
    const state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [schema.nodes.heading.create({ level: 2 })]),
    });

    const tr = revertEmptyHeading(state.tr, state.doc);
    expect(tr).not.toBeNull();

    const para = state.apply(tr!).doc.firstChild;
    expect(para?.type.name).toBe('paragraph');
    expect(para?.textContent).toBe('## ');
  });

  it('does not revert a heading that still has content', () => {
    const schema = createTestSchema();
    const state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [
        schema.nodes.heading.create({ level: 1 }, [schema.text('Hello')]),
      ]),
    });

    expect(revertEmptyHeading(state.tr, state.doc)).toBeNull();
  });
});
