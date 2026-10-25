// @vitest-environment happy-dom
/**
 * 互链输入规则的 `!` 前缀守卫锁（审计 2026-10-25 C-7）。
 *
 * 我防的事故：手打 `![[foo]]`（Obsidian 嵌入语法，solo 不支持）走 InputRule——
 * 它没有 `!` 判别，会把尾部 `[[foo]]` 转成互链节点、留下孤零零的 `!`，产物正是
 * suggestion-guard 注释里明确要防的「语义错误的伪嵌入」。同型修法先例：#22 给
 * `convertPendingLink` 加 `!` 前缀判别（`![图片](…)` 不当链接转）。
 *
 * 反向校准（准入②，执行时已做）：撤掉前缀守卫 ⇒ 第 1 条转红。
 */
import { Editor } from '@tiptap/vue-3';
import { ref } from 'vue';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorExtensions } from '../../editor-extensions';
import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';

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

/** 与 list-input-guard / sub-sup-input 同款：逐字符走 handleTextInput 生产链路 */
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

function wikilinkCount(doc: PMNode): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === 'wikilink') n += 1;
    return true;
  });
  return n;
}

describe('互链输入规则：`![[` 前缀守卫（C-7）', () => {
  it('手打 ![[甲]] 不产生「伪嵌入」（! + 互链），保持字面文本', () => {
    const editor = makeEditor('');
    typeChars(editor, '![[甲]]');
    expect(wikilinkCount(editor.state.doc)).toBe(0);
    expect(editor.state.doc.textContent).toContain('![[甲]]');
  });

  it('普通 [[甲]] 照常转互链（不得误伤）', () => {
    const editor = makeEditor('');
    typeChars(editor, '[[甲]]');
    expect(wikilinkCount(editor.state.doc)).toBe(1);
  });
});
