// @vitest-environment happy-dom
/**
 * Mermaid 全屏预览的生命周期锁（审计 2026-10-25 C-4 副作用矫正）。
 *
 * 我防的事故：修「删 A 块误关 B 块预览」时，把 NodeView `destroy()` 里的关灯动作
 * **整个删掉** —— 于是该关的场景也不关了：删除/撤销发起方、以及切文档（整篇替换
 * ⇒ 所有 NodeView destroy）之后，全屏预览继续留在屏幕上显示已不存在的内容。
 * 正确语义是**只关「本块开的那一个」**。
 *
 * 判据全是可观测事实：`document.body` 里还有没有 `.mk-mermaid-lightbox`。
 *
 * 反向校准（2026-10-25 实测）：撤掉 `dom.contains(sourceSvg)` 判定 ⇒ 退回
 * 「一律不关」⇒ 第 2 条红；退回「无条件关」⇒ 第 1 条红。
 */
import { Editor } from '@tiptap/vue-3';
import { ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorExtensions } from '../../editor-extensions';
import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg data-mock="mermaid"></svg>' })),
  },
}));

const schema = createTestSchema();
const editors: Editor[] = [];

function makeEditor(md: string): Editor {
  const editor = new Editor({
    extensions: createEditorExtensions({
      slashMenuRef: ref(null),
      slashMenuItems: ref([]),
      slashMenuCommand: ref(() => {}),
      emojiMenuRef: ref(null),
      emojiMenuItems: ref([]),
      emojiMenuCommand: ref(() => {}),
      wikilinkItems: ref([]),
      wikilinkMenuCommand: ref(() => {}),
      searchHighlightOptions: {} as never,
    }),
    content: parseMarkdown(schema, md).toJSON(),
  });
  editors.push(editor);
  return editor;
}

const lightbox = () => document.querySelector('.mk-mermaid-lightbox');

function deleteMermaidBlock(editor: Editor, index: number): void {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'mermaidBlock') positions.push(pos);
    return true;
  });
  const pos = positions[index];
  if (pos == null) throw new Error(`第 ${index} 个 mermaidBlock 不存在`);
  const node = editor.state.doc.nodeAt(pos);
  if (!node) throw new Error('nodeAt 取不到节点');
  editor.commands.deleteRange({ from: pos, to: pos + node.nodeSize });
}

const TWO_BLOCKS = '```mermaid\ngraph TD\nA-->B\n```\n\n```mermaid\ngraph TD\nC-->D\n```\n';

afterEach(() => {
  // 清掉可能残留的预览（模块级单例），避免污染下一条
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = '';
});

describe('Mermaid 预览生命周期：只关自己开的那一个', () => {
  it('删别的块不关预览，删发起方才关', async () => {
    const editor = makeEditor(TWO_BLOCKS);

    await vi.waitFor(
      () => {
        // 注意选 `.mk-mermaid-render svg`：header 里的放大图标也是 svg，
        // 用 `.mk-mermaid-block svg` 会被图标提前满足，渲染其实还没完成
        if (editor.view.dom.querySelectorAll('.mk-mermaid-render svg').length < 2) {
          throw new Error('两块尚未渲染出 svg');
        }
      },
      { timeout: 2000, interval: 10 },
    );

    const blocks = editor.view.dom.querySelectorAll('.mk-mermaid-block');
    expect(blocks.length).toBe(2);

    // 用第 1 块打开全屏预览
    const zoomBtn = blocks[0]?.querySelector<HTMLButtonElement>('.mk-block-zoom-button');
    expect(zoomBtn, '放大按钮必须存在').not.toBeNull();
    zoomBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(lightbox(), '点击放大后预览应打开').not.toBeNull();

    // 删第 2 块（不是发起方）⇒ 预览必须还在
    deleteMermaidBlock(editor, 1);
    expect(lightbox(), '删别的块不得关掉正在看的预览').not.toBeNull();

    // 删发起方 ⇒ 预览必须关闭
    deleteMermaidBlock(editor, 0);
    expect(lightbox(), '删掉发起方后预览必须一起关闭').toBeNull();
  });
});
