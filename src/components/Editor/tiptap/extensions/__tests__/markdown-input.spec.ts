import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';
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
 * 父块接纳方式契约（KNOWN-ISSUES §二 #25 / §二 #30）。
 *
 * listItem / taskItem 首格已放开为 `block+`：**所有**能含段落的父块都能原地改型，
 * 不产生占位空段落（读盘 `- # 标题` 与手打同构，均为 listItem[heading]）。
 * 判不过的位置（没有 paragraph 的父块等）整步不做，绝不允许「先删前缀再失败」——
 * 旧实现正是这样丢过 `# `（§二 #25）。
 */
describe('convertPendingHeading 的父块接纳方式', () => {
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
    return { tr, state, next: tr ? state.apply(tr).doc : doc };
  }

  /** 列表项首块打标题（#30 放开后与读盘同构的主形态） */
  function listItemDoc() {
    const schema = createTestSchema();
    return schema.nodes.doc.create(null, [
      schema.nodes.bulletList.create(null, [
        schema.nodes.listItem.create(null, [schema.nodes.paragraph.create(null, [schema.text('# 标题')])]),
      ]),
    ]);
  }

  it('列表项首格原地转 heading，不产生占位空段落（#30）', () => {
    const { tr, next } = convertInDoc(listItemDoc());

    expect(tr).not.toBeNull();
    expect(next.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] }],
            },
          ],
        },
      ],
    });
    // `# ` 被吃掉、正文一个字不少
    expect(next.textContent).toBe('标题');
  });

  it('任务项首格同理（taskItem 同约束）', () => {
    const schema = createTestSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.taskList.create(null, [
        schema.nodes.taskItem.create(null, [schema.nodes.paragraph.create(null, [schema.text('# 标题')])]),
      ]),
    ]);

    const { tr, next } = convertInDoc(doc);
    expect(tr).not.toBeNull();

    const item = next.firstChild?.firstChild;
    expect(item?.childCount).toBe(1);
    expect(item?.child(0).type.name).toBe('heading');
    expect(item?.child(0).textContent).toBe('标题');
  });

  /**
   * 单行容器（表格单元格）里**不许**把 `# 标题` 转 heading（2026-10-11，台账 §二 #56）。
   *
   * 理由不是「装不下」——schema 收得下（`tableCell.content = block+`，`canReplaceWith` 为真）——
   * 而是 Markdown 里单元格只能表达行内文本：转了能显示，**写出去重开必然降级成字面量**
   * （`| # 标题 |` ⇒ 重开是普通文字）+ 二次落盘多一层转义（R1≠R2），属「能渲染 ≠ 能存住」。
   *
   * ⚠️ 反向校准：删掉 `canConvertHeadingInPlace` 里的 `isInSingleLineContainer` 早退 ⇒
   * 本组第一条必须转红。
   */
  it('【禁止】表格单元格内的 `# 标题` 不转 heading（存不住的形态不产出）', () => {
    const schema = createTestSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.table.create(null, [
        schema.nodes.tableRow.create(null, [
          schema.nodes.tableCell.create(null, [schema.nodes.paragraph.create(null, [schema.text('# 标题')])]),
        ]),
      ]),
    ]);

    const { tr } = convertInDoc(doc);
    expect(tr, '单元格内不该改型').toBeNull();
    // 前缀一个字都不能被吞（§二 #25 的教训：改型 no-op 却已删前缀）
    expect(doc.textContent).toBe('# 标题');
  });

  it('【不许误伤】同一判据下，引用块 / 顶层段落仍照常转（只有单行容器被挡）', () => {
    const schema = createTestSchema();
    const quoteDoc = schema.nodes.doc.create(null, [
      schema.nodes.blockquote.create(null, [schema.nodes.paragraph.create(null, [schema.text('# 标题')])]),
    ]);
    const { tr: quoteTr } = convertInDoc(quoteDoc);
    expect(quoteTr, '引用块应照常转（blockquote 不是单行容器）').not.toBeNull();

    const topDoc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [schema.text('# 标题')]),
    ]);
    const { tr: topTr } = convertInDoc(topDoc);
    expect(topTr, '顶层段落应照常转').not.toBeNull();
  });

  it('列表项内第二块可原地改型 ⇒ 不产生多余空段落', () => {    const schema = createTestSchema();
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

  it('引用块可原地改型 ⇒ 不产生多余空段落（探针不得误伤合法父块）', () => {
    const schema = createTestSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.blockquote.create(null, [schema.nodes.paragraph.create(null, [schema.text('# 标题')])]),
    ]);

    const { tr, next } = convertInDoc(doc);
    expect(tr).not.toBeNull();

    expect(next.firstChild?.childCount).toBe(1);
    expect(next.firstChild?.firstChild?.type.name).toBe('heading');
    expect(next.firstChild?.firstChild?.textContent).toBe('标题');
  });

  it('手打产物与 parse(`- # 标题`) 逐字一致（手打 / 读盘 同一条路）', () => {
    const schema = createTestSchema();
    const { next } = convertInDoc(listItemDoc());

    expect(next.toJSON()).toEqual(parseMarkdown(schema, '- # 标题\n').toJSON());
  });

  it('整步一条事务、一次撤销即回滚', () => {
    const { tr } = convertInDoc(listItemDoc());
    // in-place = delete + setBlockType 两步，但同处一条事务 ⇒ 一次撤销即回滚
    expect(tr!.steps.length).toBe(2);
  });

  it('转换后光标落在标题正文末尾（接着打字不跳位）', () => {
    const schema = createTestSchema();
    const doc = listItemDoc();
    // 生产形态：用户刚打完「标题」，光标停在段落正文末尾；转换删掉的是
    // 光标**前方**的 `# `，选区随 delete 映射保持在正文末尾
    const pending = pendingOf(doc, '# 标题');
    const textEnd = pending.paragraphPos + 1 + (doc.nodeAt(pending.paragraphPos)?.content.size ?? 0);
    const state = EditorState.create({
      schema: doc.type.schema,
      doc,
      selection: TextSelection.create(doc, textEnd),
    });
    const tr = convertPendingHeading(state.tr, state.doc, schema.nodes.heading, pending);
    const $from = state.apply(tr!).selection.$from;

    expect($from.parent.type.name).toBe('heading');
    expect($from.parent.textContent).toBe('标题');
    expect($from.parentOffset).toBe($from.parent.content.size);
  });
});

/**
 * 装饰层必须与转换层同判据。装饰的含义是「这一段马上会变成标题」的预览，
 * 所以**能转换**的位置都得挂（列表项首格与文档级现在都走 in-place）；
 * 挂不上却硬挂，会按标题字号渲染出一段永远变不了的死文本。
 */
describe('pending heading 装饰的父块接纳方式', () => {
  function docOf() {
    const schema = createTestSchema();
    return schema.nodes.doc.create(null, [
      schema.nodes.bulletList.create(null, [
        schema.nodes.listItem.create(null, [schema.nodes.paragraph.create(null, [schema.text('# 列表标题')])]),
      ]),
      schema.nodes.paragraph.create(null, [schema.text('正文')]),
      schema.nodes.paragraph.create(null, [schema.text('# 真标题')]),
    ]);
  }

  function paragraphPos(doc: PMNode, text: string): number {
    let hit = -1;
    doc.descendants((node, pos) => {
      if (hit >= 0) return false;
      if (node.type.name === 'paragraph' && node.textContent.startsWith(text)) hit = pos;
      return true;
    });
    return hit;
  }

  function decoratedPositions(state: EditorState): number[] {
    return markdownInputPluginKey.getState(state)?.decorations.find().map((d) => d.from) ?? [];
  }

  function setup() {
    const doc = docOf();
    return { doc, state: EditorState.create({ schema: doc.type.schema, doc, plugins: [markdownInputPlugin()] }) };
  }

  /** 在 `text` 那个段落的末尾插入一个字 */
  function typeAtEndOf(state: EditorState, doc: PMNode, text: string) {
    const target = paragraphPos(doc, text);
    const at = target + 1 + (doc.nodeAt(target)?.content.size ?? 0);
    return state.apply(state.tr.insertText('字', at));
  }

  it('初始全量构建：列表项与文档级两处都挂装饰（每段 2 条）', () => {
    const { doc, state } = setup();
    const froms = decoratedPositions(state);

    expect(froms.length).toBe(4);
    expect(froms).toContain(paragraphPos(doc, '# 列表标题'));
    expect(froms).toContain(paragraphPos(doc, '# 真标题'));
  });

  it('增量：改动画落在别的块上，pending 装饰照旧留存（mapped 平移不误删）', () => {
    const { doc, state } = setup();
    const next = typeAtEndOf(state, doc, '正文');

    const froms = decoratedPositions(next);
    expect(froms.length).toBe(4);
    expect(froms).toContain(paragraphPos(next.doc, '# 列表标题'));
    expect(froms).toContain(paragraphPos(next.doc, '# 真标题'));
  });

  it('增量：在列表项 pending 段落里继续打字 ⇒ 当场落成真 heading，装饰随之退役', () => {
    const { doc, state } = setup();
    const next = typeAtEndOf(state, doc, '# 列表标题');

    const item = next.doc.firstChild?.firstChild;
    expect(item?.childCount).toBe(1);
    expect(item?.child(0).type.name).toBe('heading');
    expect(item?.child(0).textContent).toBe('列表标题字');

    // 转换落地后该处不再是 pending，装饰只剩文档级那一处
    expect(decoratedPositions(next).length).toBe(2);
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
