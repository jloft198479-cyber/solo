// @vitest-environment happy-dom
import { Editor } from '@tiptap/vue-3';
import { ref } from 'vue';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorExtensions } from '../../editor-extensions';
import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';

/**
 * 列表「行首 Backspace 劈开列表」的**行为契约锁**（方案 `PROPOSAL-list-structure-fix.md` §六 阶段 1）。
 *
 * 为什么要有这一份：`- 甲 / - 乙 / - 丙` 里把光标放到「乙」行首按一次 Backspace，
 * 上游 `liftOutOfList`（`prosemirror-schema-list`）会把列表**切成两个 `bulletList`、
 * 中间夹一个 doc 层孤立段落**——而且原样落盘、重开结构不变。它正是用户报的
 * 「列表里母主题无法用 `Alt+↑/↓` 换位」的真因（`moveListItem` 只挪同容器兄弟）。
 *
 * 本文件锁的是**期望的新行为**（§七 九条决定）：行首 Backspace ＝ **并回上一行**，
 * 永不劈开列表。**修复前应当是红的**——红灯即「劈开」这一禁止态的现形。
 *
 * ⚠️ 跑在 happy-dom，不是 WebView2 真机（AGENTS §4：键位/UI 改动单测只是入场券，
 *    阶段 3 必须真机复核）。
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

/**
 * 顶层块列表 —— 丢掉 StarterKit `TrailingNode` 补的那个空段落。
 * 它是环境噪声（文档以列表结尾时必然补一个），与本契约无关；
 * 不丢的话每条断言都会被它带红，红得没有信息量。
 */
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

/** 顶层块类型序列——「劈开」的特征就是 doc 层凭空多出一个 paragraph */
function topLevelTypes(doc: PMNode): string[] {
  return topNodes(doc).map((n) => n.type.name);
}

/** 人类可读的结构签名：失败报文里一眼看得出劈没劈 */
function treeSig(doc: PMNode): string {
  const parts: string[] = [];
  for (const n of topNodes(doc)) {
    if (n.type.name === 'bulletList' || n.type.name === 'taskList') {
      const items: string[] = [];
      n.forEach((li) => items.push(`「${li.textContent}」`));
      parts.push(`${n.type.name}(${items.join(' / ')})`);
    } else {
      parts.push(`${n.type.name}「${n.textContent}」`);
    }
  }
  return parts.join(' + ');
}

/** 某段文本的起点绝对位置（descendants 给的 pos 即文本自身起点） */
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
  if (found < 0) throw new Error(`找不到文本「${text}」`);
  return found;
}

/** 把光标放到某段文本开头，然后打一次真实 keydown（走 PM/DOM 全链路） */
function pressAt(editor: Editor, text: string, init: KeyboardEventInit): void {
  editor.commands.setTextSelection(posOfText(editor.state.doc, text));
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
  );
}

const THREE = '- 甲\n- 乙\n- 丙\n';

describe('列表行首 Backspace 契约（修复前应红）', () => {
  it('基准：结构与坐标（后面的断言都依赖它）', () => {
    const doc = parseMarkdown(schema, THREE);
    expect(treeSig(doc)).toBe('bulletList(「甲」 / 「乙」 / 「丙」)');
    expect(posOfText(doc, '乙')).toBe(8);
  });

  it('【禁止劈开】中间项行首 Backspace ⇒ 并进上一项，列表仍是一个容器', () => {
    const editor = makeEditor(THREE);
    pressAt(editor, '乙', { key: 'Backspace' });
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲乙」 / 「丙」)');
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });

  it('【禁止劈开】末项行首 Backspace ⇒ 并进上一项', () => {
    const editor = makeEditor(THREE);
    pressAt(editor, '丙', { key: 'Backspace' });
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「乙丙」)');
  });

  it('顶层首项行首 Backspace：前面是段落 ⇒ 并进那个段落', () => {
    const editor = makeEditor('正文\n\n- 甲\n- 乙\n');
    pressAt(editor, '甲', { key: 'Backspace' });
    expect(treeSig(editor.state.doc)).toBe('paragraph「正文甲」 + bulletList(「乙」)');
  });

  it('顶层首项行首 Backspace 且列表是文档第一块（无前驱）⇒ 不动', () => {
    const editor = makeEditor('- 甲\n- 乙\n');
    pressAt(editor, '甲', { key: 'Backspace' });
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「乙」)');
  });

  it('回归锁：单项列表行首 Backspace ⇒ 退出列表变普通段落（保持现状）', () => {
    const editor = makeEditor('- 甲\n');
    pressAt(editor, '甲', { key: 'Backspace' });
    expect(treeSig(editor.state.doc)).toBe('paragraph「甲」');
  });

  it('回归锁：嵌套子项行首 Backspace ⇒ 只提升一级，不劈开', () => {
    const editor = makeEditor('- 甲\n  - 甲1\n- 乙\n');
    pressAt(editor, '甲1', { key: 'Backspace' });
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「甲1」 / 「乙」)');
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });

  it('【禁止劈开】Mod-Backspace 与 Backspace 同罪，必须同批治', () => {
    const editor = makeEditor(THREE);
    pressAt(editor, '乙', { key: 'Backspace', ctrlKey: true });
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲乙」 / 「丙」)');
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });

  it('【禁止劈开】Shift+Tab 不得把列表切成两段（只锁「不许劈」，不锁具体行为）', () => {
    const editor = makeEditor(THREE);
    pressAt(editor, '乙', { key: 'Tab', shiftKey: true });
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });

  it('【组字门控】中文组字期间按 Backspace 不得改动结构', () => {
    const editor = makeEditor(THREE);
    editor.commands.setTextSelection(posOfText(editor.state.doc, '乙'));
    editor.view.dom.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    );
    expect(editor.view.composing, '前置条件：组字态没置上，后面的断言就是假的').toBe(true);

    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' }),
    );
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「乙」 / 「丙」)');
  });
});

describe('删光一项文字后退格 ⇒ 空项整行消失（2026-10-10 用户报告「列表删不掉」）', () => {
  /** 用户操作：选中某项文字删除（行内容删光），再按退格想删掉这一行 */
  function clearTextThenBackspace(editor: Editor, text: string): void {
    const from = posOfText(editor.state.doc, text);
    editor.commands.setTextSelection({ from, to: from + text.length });
    editor.commands.deleteSelection();
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' }),
    );
  }

  it('【圆点不留壳】末项删空后退格 ⇒ 整个空项消失', () => {
    const editor = makeEditor('- 甲\n- 乙\n');
    clearTextThenBackspace(editor, '乙');
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」)');
  });

  it('【圆点不留壳】中间项删空后退格 ⇒ 空项消失、列表不劈', () => {
    const editor = makeEditor(THREE);
    clearTextThenBackspace(editor, '乙');
    expect(treeSig(editor.state.doc)).toBe('bulletList(「甲」 / 「丙」)');
    expect(topLevelTypes(editor.state.doc)).toEqual(['bulletList']);
  });
});
