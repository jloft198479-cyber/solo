// @vitest-environment happy-dom
/**
 * Mermaid / 公式块「退出编辑」行为锁（台账 §一 #73，2026-10-19 修）
 *
 * 锁两件事（判据全是可观测事实：mock 库调用次数 + view.dispatch 计数）：
 * 1. **内容没变就退出**：不发事务、不重渲。
 *    旧代码无脑 dispatch（docChanged，跑一整条插件链路 + 脏态误标）再 renderMermaid。
 * 2. **内容变了退出**：只发一个事务、只渲**一遍**。
 *    旧代码 dispatch 后 NodeView.update() 渲一遍，exitEdit 尾部再手动渲一遍 = 双渲染。
 *
 * 反向校准（2026-10-19 实测）：把 exitEdit 退回旧实现（去早退 + dispatch 后顺流补渲），
 * 四条中三条红（Mermaid 两变 + 公式块不变更）。公式块「变更」用例不红是事实而非漏锁：
 * renderKatex 的版本守卫会把多余渲染在调 mock 之前拦下，公式块的退化由
 * 「不变更」用例兜住。锁承重，不是假绿。
 *
 * 「内容没变不重渲」的安全性前提：enterEdit 只藏不清 renderDiv，旧渲染还在 DOM 里。
 */
import { Editor } from '@tiptap/vue-3';
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorExtensions } from '../../editor-extensions';
import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';

const { mermaidRender, katexRenderToString } = vi.hoisted(() => ({
  mermaidRender: vi.fn(async () => ({ svg: '<svg data-mock="mermaid"></svg>' })),
  katexRenderToString: vi.fn(() => '<span data-mock="katex"></span>'),
}));

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: mermaidRender },
}));
vi.mock('katex', () => ({ default: { renderToString: katexRenderToString } }));
vi.mock('katex/dist/katex.min.css', () => ({}));

const schema = createTestSchema();

function makeEditor(md: string): Editor {
  return new Editor({
    extensions: createEditorExtensions({
      slashMenuRef: ref(null),
      slashMenuItems: ref([]),
      slashMenuCommand: ref(() => {}),
      emojiMenuRef: ref(null),
      emojiMenuItems: ref([]),
      emojiMenuCommand: ref(() => {}),
      wikilinkMenuRef: ref(null),
      wikilinkItems: ref([]),
      wikilinkMenuCommand: ref(() => {}),
      searchHighlightOptions: {} as never,
    }),
    content: parseMarkdown(schema, md).toJSON(),
  });
}

/** happy-dom 无 requestIdleCallback，空闲调度器降级 setTimeout(0) ⇒ 轮询等它跑完 */
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  await vi.waitFor(() => {
    if (!cond()) throw new Error('condition not met yet');
  }, { timeout: ms, interval: 10 });
}

interface BlockDom {
  render: HTMLElement;
  edit: HTMLElement;
  textarea: HTMLTextAreaElement;
}

function blockDom(editor: Editor, blockClass: string): BlockDom {
  const dom = editor.view.dom.querySelector(`.${blockClass}`);
  if (!dom) throw new Error(`找不到 .${blockClass}，NodeView 未创建`);
  const render = dom.querySelector<HTMLElement>('[class*="-render"]');
  const edit = dom.querySelector<HTMLElement>('[class*="-edit"]');
  const textarea = dom.querySelector<HTMLTextAreaElement>('[class*="-textarea"]');
  if (!render || !edit || !textarea) throw new Error('NodeView DOM 结构不完整');
  return { render, edit, textarea };
}

function enterEdit(d: BlockDom): void {
  d.render.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(d.edit.style.display).toBe('block');
}

function exitEdit(d: BlockDom): void {
  d.textarea.dispatchEvent(new Event('blur'));
}

beforeEach(() => {
  mermaidRender.mockClear();
  katexRenderToString.mockClear();
});

describe('退出编辑：内容没变', () => {
  it('Mermaid：不发事务、不重渲', async () => {
    const editor = makeEditor('```mermaid\ngraph TD\nA-->B\n```\n');
    await until(() => mermaidRender.mock.calls.length >= 1); // 等初始空闲渲染
    const d = blockDom(editor, 'mk-mermaid-block');
    const dispatchSpy = vi.spyOn(editor.view, 'dispatch');
    const baseline = mermaidRender.mock.calls.length;

    enterEdit(d);
    // textarea.value 由 enterEdit 从 node.textContent 填入 ⇒ 不改就是「内容没变」
    exitEdit(d);

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(mermaidRender.mock.calls.length).toBe(baseline);
    expect(d.render.style.display).toBe('block');
    dispatchSpy.mockRestore();
    editor.destroy();
  });

  it('公式块：不发事务、不重渲', async () => {
    const editor = makeEditor('$$\nE=mc^2\n$$\n');
    await until(() => katexRenderToString.mock.calls.length >= 1);
    const d = blockDom(editor, 'mk-math-block');
    const dispatchSpy = vi.spyOn(editor.view, 'dispatch');
    const baseline = katexRenderToString.mock.calls.length;

    enterEdit(d);
    exitEdit(d);

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(katexRenderToString.mock.calls.length).toBe(baseline);
    dispatchSpy.mockRestore();
    editor.destroy();
  });
});

describe('退出编辑：内容变了', () => {
  it('Mermaid：只发一个事务、只渲一遍', async () => {
    const editor = makeEditor('```mermaid\ngraph TD\nA-->B\n```\n');
    await until(() => mermaidRender.mock.calls.length >= 1);
    const d = blockDom(editor, 'mk-mermaid-block');
    const dispatchSpy = vi.spyOn(editor.view, 'dispatch');
    const baseline = mermaidRender.mock.calls.length;

    enterEdit(d);
    d.textarea.value = 'graph LR\nB-->A';
    exitEdit(d);

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(editor.state.doc.textContent).toContain('B-->A');
    // update() 回调渲恰好一遍；旧代码这里是 +2（双渲染）
    await until(() => mermaidRender.mock.calls.length === baseline + 1);
    expect(mermaidRender.mock.calls.length).toBe(baseline + 1);
    dispatchSpy.mockRestore();
    editor.destroy();
  });

  it('公式块：只发一个事务、只渲一遍', async () => {
    const editor = makeEditor('$$\nE=mc^2\n$$\n');
    await until(() => katexRenderToString.mock.calls.length >= 1);
    const d = blockDom(editor, 'mk-math-block');
    const dispatchSpy = vi.spyOn(editor.view, 'dispatch');
    const baseline = katexRenderToString.mock.calls.length;

    enterEdit(d);
    d.textarea.value = 'a^2+b^2=c^2';
    exitEdit(d);

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(editor.state.doc.textContent).toContain('a^2+b^2=c^2');
    await until(() => katexRenderToString.mock.calls.length === baseline + 1);
    expect(katexRenderToString.mock.calls.length).toBe(baseline + 1);
    dispatchSpy.mockRestore();
    editor.destroy();
  });
});
