// @vitest-environment happy-dom
import { Editor } from '@tiptap/vue-3';
import { ref } from 'vue';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorExtensions } from '../../editor-extensions';
import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';
import { serializeMarkdown } from '../../markdown/serializer';

/**
 * 「列表项内敲列表标记不再嵌套」的契约锁（台账 §二 #59，交互内核线审核 F3）。
 *
 * **为什么这份能在 happy-dom 里真测**：上游输入规则挂在 PM 的 `handleTextInput` prop 上
 * （`@tiptap/core` 的 `inputRulesPlugin`），逐字符调这个 prop 就是**生产同一条路**——
 * 不需要浏览器、也不需要真键盘事件。台账 #26 / #30 里「合成 insertText 不触发 InputRule、
 * 此路单测盖不住」说的是 `tr.insertText` 那条路，不是这条。
 *
 * 反向校准（执行时必做）：把 `editor-extensions.ts` 里三个列表容器的 `addInputRules`
 * 覆写去掉 ⇒ 本文件【禁止嵌套】各条必须转红。
 */

const schema = createTestSchema();
const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

function makeEditor(md: string): Editor {
  const editor = new Editor({
    extensions: createEditorExtensions({
      slashMenuRef: ref(null),
      slashMenuItems: ref([]),
      slashMenuCommand: ref(() => {}),
      emojiMenuRef: ref(null),
      emojiMenuItems: ref([]),
      emojiMenuCommand: ref(() => {}),
      wikilinkMenuRef: ref(null),
      wikilinkMenuItems: ref([]),
      wikilinkMenuCommand: ref(() => {}),
      searchHighlightOptions: {} as never,
    }),
    content: parseMarkdown(schema, md).toJSON(),
  });
  editors.push(editor);
  return editor;
}

function makeEditorFromDoc(doc: PMNode): Editor {
  const editor = new Editor({
    extensions: createEditorExtensions({
      slashMenuRef: ref(null),
      slashMenuItems: ref([]),
      slashMenuCommand: ref(() => {}),
      emojiMenuRef: ref(null),
      emojiMenuItems: ref([]),
      emojiMenuCommand: ref(() => {}),
      wikilinkMenuRef: ref(null),
      wikilinkMenuItems: ref([]),
      wikilinkMenuCommand: ref(() => {}),
      searchHighlightOptions: {} as never,
    }),
    content: doc.toJSON(),
  });
  editors.push(editor);
  return editor;
}

/** 顶层块列表（丢掉 StarterKit TrailingNode 补的尾随空段，同 list-backspace.spec） */
function topNodes(doc: PMNode): PMNode[] {
  const nodes: PMNode[] = [];
  doc.forEach((n) => nodes.push(n));
  while (
    nodes.length > 1 &&
    nodes[nodes.length - 1].type.name === 'paragraph' &&
    nodes[nodes.length - 1].textContent === ''
  ) {
    nodes.pop();
  }
  return nodes;
}

/** 结构签名：嵌套会在这里现形（`li > ul > li` 表现为项文本里多出一层括号） */
function treeSig(doc: PMNode): string {
  const render = (node: PMNode): string => {
    const kids: string[] = [];
    node.forEach((child) => {
      const text = child.textContent;
      const nested: string[] = [];
      child.forEach((grand) => {
        if (!grand.isTextblock) nested.push(render(grand));
      });
      kids.push(nested.length ? `「${text}」{${nested.join(',')}}` : `「${text}」`);
    });
    return `${node.type.name}(${kids.join(' / ')})`;
  };
  return topNodes(doc).map(render).join(' + ');
}

function posOfText(doc: PMNode, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text === text) {
      found = pos;
      return false;
    }
    return true;
  });
  if (found < 0) throw new Error(`找不到文本：${text}`);
  return found;
}

/**
 * 逐字符走**生产同一条路**：先问各插件的 `handleTextInput`（输入规则就挂在这儿），
 * 没人接管才真的插入字符 —— 与 PM 在浏览器里的次序一致。
 */
function typeChars(editor: Editor, chars: string): void {
  const view: EditorView = editor.view;
  for (const ch of chars) {
    const { from, to } = view.state.selection;
    let handled = false;
    for (const plugin of view.state.plugins) {
      const props = plugin.props as unknown as {
        handleTextInput?: (v: EditorView, f: number, t: number, s: string) => boolean;
      };
      if (props.handleTextInput && props.handleTextInput(view, from, to, ch)) {
        handled = true;
        break;
      }
    }
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

/** 造一个「第二项为空」的编辑器（＝用户按 Enter 另起一项后的真实形态），光标在空项里 */
function editorWithEmptySecondItem(md = '- 甲\n- 乙\n'): Editor {
  const editor = makeEditor(md);
  const pos = posOfText(editor.state.doc, '乙');
  editor.view.dispatch(editor.state.tr.delete(pos, pos + 1));
  editor.commands.setTextSelection(pos);
  return editor;
}

describe('列表项内敲列表标记：不嵌套（契约公理 2「只有层级动词能改缩进」）', () => {
  it('【禁止嵌套】空项内敲 `- ` ⇒ 仍是同级两项，标记被吃掉', () => {
    const editor = editorWithEmptySecondItem();
    expect(treeSig(editor.state.doc), '前置条件：两项、第二项为空').toBe(
      'bulletList(「甲」 / 「」)',
    );

    typeChars(editor, '- ');

    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「」)');
    expect(serializeMarkdown(editor.state.doc)).toBe('- 甲\n- \n');
  });

  it('【禁止嵌套】有序列表空项内敲 `1. ` ⇒ 不嵌套', () => {
    const editor = editorWithEmptySecondItem('1. 甲\n1. 乙\n');
    typeChars(editor, '1. ');

    expect(treeSig(editor.state.doc)).toBe('orderedList(「甲」 / 「」)');
  });

  it('【禁止嵌套】待办列表空项内敲 `[ ] ` ⇒ 不嵌套', () => {
    const editor = makeEditor('- [ ] 甲\n- [ ] 乙\n');
    const pos = posOfText(editor.state.doc, '乙');
    editor.view.dispatch(editor.state.tr.delete(pos, pos + 1));
    editor.commands.setTextSelection(pos);

    typeChars(editor, '[ ] ');

    expect(treeSig(editor.state.doc)).toBe('taskList(「甲」 / 「」)');
  });

  it('【禁止嵌套】嵌套子项内敲 `- ` 同样不嵌套（判据与深度无关，要更深请用 Tab）', () => {
    const editor = editorWithEmptySecondItem('- 甲\n  - 乙\n- 丙\n');
    typeChars(editor, '- ');

    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」{bulletList(「」)} / 「丙」)');
  });

  it('【禁止嵌套】落盘不再出现 `- 甲\\n- - ` 这种畸形', () => {
    const editor = editorWithEmptySecondItem();
    typeChars(editor, '- ');

    expect(serializeMarkdown(editor.state.doc)).not.toContain('- - ');
  });
});

describe('不许误伤：非列表项路径原样走上游', () => {
  it('顶层空段落敲 `- ` ⇒ 照常建出无序列表', () => {
    const editor = makeEditor('');
    typeChars(editor, '- ');

    expect(treeSig(editor.state.doc)).toBe('bulletList(「」)');
    expect(serializeMarkdown(editor.state.doc)).toBe('- \n');
  });

  it('顶层空段落敲 `1. ` ⇒ 照常建出有序列表', () => {
    const editor = makeEditor('');
    typeChars(editor, '1. ');

    expect(treeSig(editor.state.doc)).toBe('orderedList(「」)');
  });

  it('引用块内敲 `- ` ⇒ 照常建出列表（父块不是列表项，守卫不接管）', () => {
    const editor = makeEditor('> 甲\n');
    editor.commands.setTextSelection(posOfText(editor.state.doc, '甲') + 1);
    editor.commands.splitBlock();
    typeChars(editor, '- ');

    expect(editor.state.doc.firstChild!.type.name).toBe('blockquote');
    expect(editor.state.doc.firstChild!.childCount).toBe(2);
    expect(editor.state.doc.firstChild!.child(1).type.name).toBe('bulletList');
  });

  it('项内已有文字时行首敲 `- ` ⇒ 标记同样被吃掉，文字与结构一字不动', () => {
    const editor = makeEditor('- 甲\n- 乙\n');
    editor.commands.setTextSelection(posOfText(editor.state.doc, '乙'));

    typeChars(editor, '- ');

    // 上游按「光标前文本」匹配（`- ` 匹配的是刚敲出来的那两个字符，不管后面还有没有字），
    // 所以这条路径同样会命中输入规则；守卫接管 ⇒ 吃掉标记、原文字保留、不嵌套。
    expect(editor.state.doc.textContent).toBe('甲乙');
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「乙」)');
  });
});

describe('边界：`listItem > blockquote > paragraph` 里敲标记 ⇒ 放行上游', () => {
  it('待包装块的父节点是引用块（不是列表项）⇒ 照常建列表', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.bulletList.create(null, [
        schema.nodes.listItem.create(null, [
          schema.nodes.blockquote.create(null, [schema.nodes.paragraph.create()]),
        ]),
      ]),
    ]);
    const editor = makeEditorFromDoc(doc);
    // 光标落进引用块里的空段落
    let target = -1;
    editor.state.doc.descendants((node, pos) => {
      if (target < 0 && node.type.name === 'paragraph') target = pos + 1;
      return true;
    });
    editor.commands.setTextSelection(target);

    typeChars(editor, '- ');

    const quote = editor.state.doc.firstChild!.firstChild!.firstChild!;
    expect(quote.type.name, '父块仍是引用块').toBe('blockquote');
    // 放行上游 ⇒ 那个空段落被**就地包进**新列表（childCount 仍为 1，孩子换成 bulletList）；
    // 若守卫误接管，这里会还是一个 paragraph。
    expect(quote.childCount).toBe(1);
    expect(quote.child(0).type.name, '引用块内建出了列表 ⇒ 守卫没接管这条边界').toBe(
      'bulletList',
    );
  });
});

describe('撤销链：敲完标记立刻退格（现状登记，真机需复核）', () => {
  it('空项内 `- ` 被吃掉后按 Backspace ⇒ 结构仍不劈、不嵌套', () => {
    const editor = editorWithEmptySecondItem();
    typeChars(editor, '- ');
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' }),
    );

    expect(topNodes(editor.state.doc).map((n) => n.type.name)).toEqual(['bulletList']);
  });
});
