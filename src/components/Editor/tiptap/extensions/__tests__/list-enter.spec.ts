// @vitest-environment happy-dom
import { Editor } from '@tiptap/vue-3';
import { ref } from 'vue';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorExtensions } from '../../editor-extensions';
import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';

/**
 * 列表回车「新建同级项」的行为契约锁（2026-10-19 用户报告）。
 *
 * 病：`- A /   - A1`，光标在 A 末尾按 Enter，上游 `splitListItem` 在段落末尾切整项
 * ⇒ 子列表整体归新项，屏幕上得到「A / A0（抱着 A1）」——用户原话「却创建了一个父项」。
 * 期望（幕布 / Workflowy 同款）：A1 留在 A 名下，新空项是 A 的**同级兄弟**。
 *
 * ⚠️ 跑在 happy-dom，不是 WebView2 真机（AGENTS §4）：单测只是入场券，手感需真机复核。
 */

const schema = createTestSchema();
const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

function makeEditor(md: string): Editor {
  return makeEditorFromDoc(parseMarkdown(schema, md));
}

/** 直接给 PM doc（markdown 表达不出的形状用：代码块作项首块 + 子列表） */
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

/** 丢掉 StarterKit `TrailingNode` 补的末尾空段落（环境噪声，与本契约无关） */
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

/** 结构签名：保留嵌套层次，一眼看出「谁是谁的孩子」 */
function sig(node: PMNode): string {
  const name = node.type.name;
  if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') {
    const items: string[] = [];
    node.forEach((item) => items.push(sig(item)));
    return `${name}(${items.join(' / ')})`;
  }
  if (name === 'listItem' || name === 'taskItem') {
    const parts: string[] = [];
    node.forEach((child) => parts.push(sig(child)));
    return `[${parts.join(' + ')}]`;
  }
  return `「${node.textContent}」`;
}

function docSig(doc: PMNode): string {
  return topNodes(doc).map(sig).join(' + ');
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
  if (found < 0) throw new Error(`找不到文本「${text}」`);
  return found;
}

/** 光标放到某段文字末尾，打一次真实 keydown（走 PM/DOM 全链路） */
function pressEnterAtEnd(editor: Editor, text: string): void {
  editor.commands.setTextSelection(posOfText(editor.state.doc, text) + text.length);
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
  );
}

describe('列表回车 = 新建同级项（2026-10-19 用户报告）', () => {
  it('父项行尾回车：子项留在父项名下，新项是同级的空项', () => {
    const editor = makeEditor('- A\n  - A1\n');
    pressEnterAtEnd(editor, 'A');
    expect(docSig(editor.state.doc)).toBe('bulletList([「A」 + bulletList([「A1」])] / [「」])');
  });

  it('光标落进新项（不是留在父项里）', () => {
    const editor = makeEditor('- A\n  - A1\n');
    pressEnterAtEnd(editor, 'A');
    const $from = editor.state.selection.$from;
    expect($from.parent.textContent).toBe('');
    expect($from.parentOffset).toBe(0);
    // 光标所在列表项必须是空的同级项，而不是 A
    let itemDepth = -1;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'listItem') {
        itemDepth = d;
        break;
      }
    }
    expect(itemDepth, '光标必须落在列表项内').toBeGreaterThan(0);
    expect($from.node(itemDepth).textContent).toBe('');
  });

  it('无子项时保持上游行为（基准，证明没有误伤）', () => {
    const editor = makeEditor('- A\n- B\n');
    pressEnterAtEnd(editor, 'A');
    expect(docSig(editor.state.doc)).toBe('bulletList([「A」] / [「」] / [「B」])');
  });

  it('嵌套项同样只提升一级：新项留在它自己的那一层', () => {
    const editor = makeEditor('- A\n  - A1\n    - A1a\n');
    pressEnterAtEnd(editor, 'A1');
    expect(docSig(editor.state.doc)).toBe(
      'bulletList([「A」 + bulletList([「A1」 + bulletList([「A1a」])] / [「」])])',
    );
  });

  it('待办项：新项是同类型、未勾选的空待办', () => {
    const editor = makeEditor('- [ ] A\n  - [ ] A1\n');
    pressEnterAtEnd(editor, 'A');
    const list = topNodes(editor.state.doc)[0];
    expect(list.type.name).toBe('taskList');
    const second = list.child(1);
    expect(second.type.name).toBe('taskItem');
    expect(second.attrs.checked).toBe(false);
    expect(second.textContent).toBe('');
    // 子项仍挂在父项名下（第一项里仍有子列表）
    expect(list.child(0).childCount).toBe(2);
  });

  it('行中回车不接管：列表容器不被劈开（行为归属是独立议题）', () => {
    const editor = makeEditor('- ABC\n  - A1\n');
    editor.commands.setTextSelection(posOfText(editor.state.doc, 'ABC') + 1);
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
    );
    expect(topNodes(editor.state.doc).length).toBe(1);
    expect(topNodes(editor.state.doc)[0].type.name).toBe('bulletList');
  });

  /**
   * 列表项内的代码块：Enter 必须是在代码里换行，不得拆项。
   *
   * 2026-10-20 复审实测（两条独立成因，都要治）：
   * ① 本守卫原来只看「光标在项内首块末尾」，没看首块是不是代码块 ⇒ 直接接管；
   * ② 即使把守卫让开，上游 tiptap 按**反转扩展序**收集 keymap（`core/dist:5225`），
   *    同 priority 下 ListItem 的 Enter 排在 core Keymap 的 `newlineInCode` 之前 ⇒
   *    仍会 `splitListItem` 拆项，且子列表被新项带走。
   * 故修法是本扩展按 `newlineInCode` 语义补一个换行，而不是「让回上游」。
   */
  it('代码块作项首块（带子列表）：Enter 换行，不拆项、子列表不动', () => {
    const doc = schema.node('doc', null, [
      schema.node('bulletList', null, [
        schema.node('listItem', null, [
          schema.node('codeBlock', { language: '' }, [schema.text('code')]),
          schema.node('bulletList', null, [
            schema.node('listItem', null, [schema.node('paragraph', null, [schema.text('A1')])]),
          ]),
        ]),
      ]),
    ]);
    const editor = makeEditorFromDoc(doc);
    pressEnterAtEnd(editor, 'code');

    const list = topNodes(editor.state.doc)[0];
    expect(list.type.name).toBe('bulletList');
    expect(list.childCount, '代码块末尾回车不该产生新的列表项').toBe(1);
    expect(list.child(0).firstChild?.type.name).toBe('codeBlock');
    expect(list.child(0).firstChild?.textContent, '代码块里应插入换行').toBe('code\n');
    expect(list.child(0).childCount, '子列表必须留在原项').toBe(2);
  });

  it('代码块是项里唯一子块（最常见的真实形状）：Enter 换行，不拆项', () => {
    const doc = schema.node('doc', null, [
      schema.node('bulletList', null, [
        schema.node('listItem', null, [
          schema.node('codeBlock', { language: '' }, [schema.text('code')]),
        ]),
      ]),
    ]);
    const editor = makeEditorFromDoc(doc);
    pressEnterAtEnd(editor, 'code');

    const list = topNodes(editor.state.doc)[0];
    expect(list.childCount, '只有一个子块的项也不该被拆开').toBe(1);
    expect(list.child(0).firstChild?.textContent).toBe('code\n');
  });
});
