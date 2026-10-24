// @vitest-environment happy-dom
/**
 * 上/下标输入规则的位置数学锁（审计 2026-10-25 P1-3）。
 *
 * 我防的事故：`sub-sup.ts` 两个 handler 把 `range.from`（TipTap runner 给的
 * **已经是匹配起点**的文档坐标）再加上 `match.index`（匹配在 textBefore 里的
 * 下标）⇒ 双重计入 ⇒ 除「整段恰好就是 ^2^」外全部越界。真实表现（核实报告
 * 真跑）：抛 RangeError、闭合符进不了文档——**段落中间根本做不出上/下标**
 * （段首 `x^2^` 也炸，只有整段内容恰为 `^2^` 才幸免）。
 *
 * 修法 = 对齐上游 `markInputRule` 的位置数学：match 内偏移用
 * `fullMatch.indexOf(text)` 求，删除只删到 `range.to`。
 *
 * 反向校准（准入②，执行时已做）：退回 `range.from + match.index` 写法 ⇒ 全部转红。
 */
import { Editor } from '@tiptap/vue-3';
import { ref } from 'vue';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorExtensions } from '../../editor-extensions';
import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';
import { serializeMarkdown } from '../../markdown/serializer';

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

/**
 * 逐字符走**生产同一条路**：先问各插件的 `handleTextInput`（输入规则就挂在这儿），
 * 没人接管才真的插入字符 —— 与 PM 在浏览器里的次序一致（与 list-input-guard 同款）。
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

/** 段内是否存在指定文本节点（供 mark 断言） */
function textWithMark(doc: PMNode, text: string, mark: string): boolean {
  let found = false;
  doc.descendants((n) => {
    if (n.isText && n.text === text && n.marks.some((m) => m.type.name === mark)) found = true;
    return true;
  });
  return found;
}

/** 把光标放到首段末尾（新 Editor 默认在文档开头，typing 从光标处发生） */
function cursorToEnd(editor: Editor): void {
  editor.commands.setTextSelection(editor.state.doc.content.size);
}

describe('上/下标输入规则（P1-3：段中可用）', () => {
  it('段中输入 x^2^ → x + 上标(2)，不抛错不丢字', () => {
    // 注：markdown-it 解析会剥掉段落尾随空格，故前缀无空格、产物紧连
    const editor = makeEditor('ab');
    cursorToEnd(editor);
    typeChars(editor, 'x^2^');
    expect(textWithMark(editor.state.doc, '2', 'superscript')).toBe(true);
    expect(serializeMarkdown(editor.state.doc)).toBe('abx^2^\n');
  });

  it('段首输入 x^2^ 同样成立（修复前段首也炸，只有整段恰为 ^2^ 才幸免）', () => {
    const editor = makeEditor('');
    typeChars(editor, 'x^2^');
    expect(serializeMarkdown(editor.state.doc)).toBe('x^2^\n');
  });

  it('中文语境 H~2~O 下标', () => {
    const editor = makeEditor('化学');
    cursorToEnd(editor);
    typeChars(editor, 'H~2~O');
    expect(textWithMark(editor.state.doc, '2', 'subscript')).toBe(true);
    expect(serializeMarkdown(editor.state.doc)).toBe('化学H~2~O\n');
  });

  it('删除线 ~~x~~ 不被下标规则劫持（防误伤回归）', () => {
    const editor = makeEditor('');
    typeChars(editor, '~~删除~~');
    expect(serializeMarkdown(editor.state.doc)).toBe('~~删除~~\n');
  });
});
