// @vitest-environment happy-dom
/**
 * 粘贴来源嗅探的「行内代码」上下文守卫锁（审计 2026-10-25 C-3）。
 *
 * 我防的事故：Layer 3 来源嗅探只判**块级** code（`$from.parent.type.spec.code`），
 * 不查光标前文本的 **code mark**——光标在 `` `说明` `` 行内代码中间粘贴含
 * `[[链接]]` 的 markdown 时，`replaceSelection(mdSlice)` 会把 wikilink 原子节点
 * 插进 code span，行内代码语法当场劈开（写出即坏）。上游 InputRule runner 自己
 * 就同时查两处（@tiptap/core run：parent.spec.code ∥ nodeBefore 的 code mark）。
 *
 * 反向校准（准入②，执行时已做）：撤掉 code mark 半句 ⇒ 第 1 条转红。
 */
import { Editor } from '@tiptap/vue-3';
import { ref } from 'vue';
import type { Node as PMNode } from '@tiptap/pm/model';
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

function wikilinkCount(doc: PMNode): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === 'wikilink') n += 1;
    return true;
  });
  return n;
}

/** 直接调插件的 handlePaste（生产同一条路），伪造「markdown 源 + html 同在」剪贴板 */
function runPaste(editor: Editor, text: string): unknown {
  const view = editor.view;
  const fakeEvent = {
    clipboardData: {
      types: ['text/plain', 'text/html'],
      getData: (type: string) =>
        type === 'text/plain' ? text : type === 'text/html' ? '<p>x</p>' : '',
      files: [],
      items: [],
    },
  } as unknown as ClipboardEvent;
  const pos = view.state.selection.from;
  const slice = view.state.doc.slice(pos, pos);
  let result: unknown;
  view.someProp('handlePaste', (handler) => {
    result = handler(view, fakeEvent, slice);
    return result === true;
  });
  return result;
}

describe('粘贴来源嗅探：行内代码上下文守卫（C-3）', () => {
  it('光标在行内代码内：嗅探不接管，code span 不被原子节点劈开', () => {
    const editor = makeEditor('`说明`');
    // 光标放进 code span 的文本里（「说」之后）——$from.parent 是段落、不是 code 块，
    // 但 nodeBefore 带着 code mark，正是漏判的那半边
    let textPos = -1;
    editor.state.doc.descendants((n, p) => {
      if (textPos < 0 && n.isText) {
        textPos = p;
        return false;
      }
      return true;
    });
    editor.commands.setTextSelection(textPos + 1);

    runPaste(editor, '看[[链接]]');

    expect(wikilinkCount(editor.state.doc), '不得把 wikilink 插进 code span').toBe(0);
    expect(serializeMarkdown(editor.state.doc)).toBe('`说明`\n');
  });

  it('普通段落里照常接管（不得误伤 markdown 源粘贴路径）', () => {
    const editor = makeEditor('正文');
    editor.commands.setTextSelection(editor.state.doc.content.size);

    const handled = runPaste(editor, '看[[链接]]');

    expect(handled).toBe(true);
    expect(wikilinkCount(editor.state.doc)).toBe(1);
  });
});
