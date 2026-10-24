// @vitest-environment happy-dom
/**
 * toggle 家族「第二次按 = 退出」的接管判据锁（审计 2026-10-25 P2-2 升 P1，
 * 简乐真机报：选中 A/B/C 三项列表点列表按钮，只有 A 取消格式，B/C 不动）。
 *
 * 我防的事故：接管判据只看「光标所在项是不是 listItem」，而有序/无序的项
 * 同为 `listItem` ⇒ ① 多项选区只托孤 `selection.from` 那一项（B/C 原地不动）；
 * ② 跨型切换（有序→无序）被劫持成「整项脱出成正文」，而原生 `toggleList`
 * 本来就能整块退出 / 原地换标记（核实报告真编辑器实测六行矩阵）。
 *
 * 修法 = 两条收窄判据：选区跨了多个列表项 ⇒ 交回原生；项所在**列表容器** ≠
 * 目标容器 ⇒ 交回原生。单项内（含子列表托孤，台账 #50 契约）仍接管。
 *
 * 反向校准（准入②，执行时已做）：去掉两条判据 ⇒ 「多选整块退出」「跨型换标记」
 * 两族用例转红。
 */
import { Editor } from '@tiptap/vue-3';
import { ref } from 'vue';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorExtensions } from '../../editor-extensions';
import { executeEditorCommand, runBubbleMenuAction } from '../../editor-commands';
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

function cursorAt(editor: Editor, text: string): void {
  editor.commands.setTextSelection(posOfText(editor.state.doc, text));
}

/** 拖选跨项文字（简乐真机场景：鼠标从 A 拖到 C，TextSelection 而非全选） */
function selectSpan(editor: Editor, fromText: string, toText: string): void {
  const from = posOfText(editor.state.doc, fromText);
  const to = posOfText(editor.state.doc, toText) + toText.length;
  editor.commands.setTextSelection({ from, to });
}

const md = (editor: Editor) => serializeMarkdown(editor.state.doc);

describe('列表 toggle 的接管判据（P2-2 升 P1）', () => {
  it('拖选跨项点无序：整块退出（原生），不再只退第一项（简乐真机报）', () => {
    const editor = makeEditor('- A\n- B\n- C\n');
    selectSpan(editor, 'A', 'C');
    executeEditorCommand(editor, 'editor.bulletList');
    expect(md(editor)).toBe('A\n\nB\n\nC\n');
  });

  it('全选（Ctrl+A）点无序：选区归一后整块退出，不再 wrap 出空壳嵌套', () => {
    const editor = makeEditor('- A\n- B\n- C\n');
    editor.commands.selectAll();
    executeEditorCommand(editor, 'editor.bulletList');
    expect(md(editor)).toBe('A\n\nB\n\nC\n');
  });

  it('拖选跨型（有序三项 → 无序）：原地换标记', () => {
    const editor = makeEditor('1. A\n1. B\n1. C\n');
    selectSpan(editor, 'A', 'C');
    executeEditorCommand(editor, 'editor.bulletList');
    expect(md(editor)).toBe('- A\n- B\n- C\n');
  });

  it('全选跨型（有序三项 → 无序）：原地换标记', () => {
    const editor = makeEditor('1. A\n1. B\n1. C\n');
    editor.commands.selectAll();
    executeEditorCommand(editor, 'editor.bulletList');
    expect(md(editor)).toBe('- A\n- B\n- C\n');
  });

  it('跨型单选（光标在有序 B → 点无序）：原地换标记，B 不再脱出正文', () => {
    const editor = makeEditor('1. A\n1. B\n1. C\n');
    cursorAt(editor, 'B');
    executeEditorCommand(editor, 'editor.bulletList');
    expect(md(editor)).toBe('- A\n- B\n- C\n');
  });

  it('同型二次按仍走托孤（#50 契约不回潮）：光标在 B 退出为正文', () => {
    const editor = makeEditor('- A\n- B\n- C\n');
    cursorAt(editor, 'B');
    executeEditorCommand(editor, 'editor.bulletList');
    expect(md(editor)).toBe('- A\n\nB\n\n- C\n');
  });

  it('单项内文字选区仍托孤：选中 A 的文字 → 只退 A', () => {
    const editor = makeEditor('- A\n- B\n');
    selectSpan(editor, 'A', 'A');
    executeEditorCommand(editor, 'editor.bulletList');
    expect(md(editor)).toBe('A\n\n- B\n');
  });

  it('项含子列表的托孤（#50）不受收窄影响：直属下级减一级', () => {
    const editor = makeEditor('- A\n  - A1\n- B\n');
    cursorAt(editor, 'A');
    executeEditorCommand(editor, 'editor.bulletList');
    expect(md(editor)).toBe('A\n\n- A1\n- B\n');
  });

  it('任务列表二次按仍退出（taskItem 判定不受容器混编影响）', () => {
    const editor = makeEditor('- [ ] 甲\n');
    cursorAt(editor, '甲');
    executeEditorCommand(editor, 'editor.taskList');
    expect(md(editor)).toBe('甲\n');
  });

  it('浮动菜单入口同口径：拖选跨项点无序按钮整块退出', () => {
    const editor = makeEditor('- A\n- B\n- C\n');
    selectSpan(editor, 'A', 'C');
    runBubbleMenuAction(editor, 'bulletList');
    expect(md(editor)).toBe('A\n\nB\n\nC\n');
  });
});
