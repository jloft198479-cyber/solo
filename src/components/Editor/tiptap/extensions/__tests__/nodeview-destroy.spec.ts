// @vitest-environment happy-dom
import type { Node as PMNode } from '@tiptap/pm/model';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { CustomCodeBlock } from '../code-block';
import { CustomImage } from '../image';

interface NodeViewLike {
  dom: HTMLElement;
  destroy?: () => void;
}

type NodeViewFactory = (props: {
  node: PMNode;
  getPos: () => number;
  editor: unknown;
}) => NodeViewLike;

/**
 * 直接取出扩展的 NodeView 工厂，绕开挂载完整 editor。
 * 工厂体内只用到 node.attrs / node.textContent 与 editor.commands，stub 足够。
 */
function nodeViewFactory(extension: { config: { addNodeView?: () => unknown } }): NodeViewFactory {
  const renderer = extension.config.addNodeView?.();
  if (typeof renderer !== 'function') {
    throw new Error('扩展未提供 NodeView 工厂');
  }
  return renderer as NodeViewFactory;
}

const schema = createTestSchema();
const stubEditor = { commands: { focus: vi.fn() }, state: {}, view: {} };

function createView(extension: { config: { addNodeView?: () => unknown } }, node: PMNode) {
  const view = nodeViewFactory(extension)({ node, getPos: () => 0, editor: stubEditor });
  document.body.appendChild(view.dom);
  return view;
}

/** 等 clipboard.writeText 的 .then 回调跑完 */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('code-block NodeView destroy 清理', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  function makeView() {
    const node = schema.nodes.codeBlock.create({ language: 'js' }, schema.text('const x = 1;'));
    const view = createView(CustomCodeBlock, node);
    const copyButton = view.dom.querySelector('.mk-code-block-copy-button') as HTMLButtonElement;
    return { view, copyButton };
  }

  it('复制按钮在 destroy 后不再响应点击', async () => {
    const { view, copyButton } = makeView();

    copyButton.click();
    await flushMicrotasks();
    expect(writeText).toHaveBeenCalledTimes(1);

    view.destroy?.();

    copyButton.click();
    await flushMicrotasks();
    // 次数不变 = 监听器真的被摘掉了
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('destroy 会取消 2s 复制回显定时器', async () => {
    vi.useFakeTimers();
    try {
      const { view, copyButton } = makeView();

      copyButton.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(copyButton.classList.contains('is-copied')).toBe(true);

      view.destroy?.();

      await vi.advanceTimersByTimeAsync(2000);
      // 定时器已 clearTimeout，回显不会被静默回滚
      expect(copyButton.classList.contains('is-copied')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('语言按钮在 destroy 后不再进入编辑态', () => {
    const node = schema.nodes.codeBlock.create({ language: 'js' }, schema.text('const x = 1;'));
    const view = createView(CustomCodeBlock, node);
    const button = view.dom.querySelector('.mk-code-block-language-button') as HTMLButtonElement;
    const input = view.dom.querySelector('.mk-code-block-language-input') as HTMLInputElement;

    // 对照：未 destroy 时点击会切到输入态
    button.click();
    expect(input.style.display).toBe('block');
    input.style.display = 'none';

    view.destroy?.();

    button.click();
    expect(input.style.display).toBe('none');
  });
});

describe('image NodeView destroy 清理', () => {
  function makeView() {
    const node = schema.nodes.image.create({ src: '', alt: '' });
    const view = createView(CustomImage, node);
    const sourceText = view.dom.querySelector('.mk-image-source-text') as HTMLElement;
    const image = view.dom.querySelector('img.mk-image') as HTMLImageElement;
    return { view, sourceText, image };
  }

  it('destroy 前聚焦编辑区会进入编辑态', () => {
    const { view, sourceText } = makeView();

    sourceText.dispatchEvent(new Event('focus'));
    expect(view.dom.classList.contains('is-editing')).toBe(true);
    view.destroy?.();
  });

  it('编辑区在 destroy 后不再进入编辑态', () => {
    const { view, sourceText } = makeView();

    view.destroy?.();
    sourceText.dispatchEvent(new Event('focus'));
    expect(view.dom.classList.contains('is-editing')).toBe(false);
  });

  it('图片在 destroy 后不再派发双击预览事件', () => {
    const { view, image } = makeView();
    const handler = vi.fn();
    document.body.addEventListener('editor:image-dblclick', handler);

    view.destroy?.();
    const dblclick = new Event('dblclick', { bubbles: true, cancelable: true });
    image.dispatchEvent(dblclick);
    expect(handler).not.toHaveBeenCalled();

    document.body.removeEventListener('editor:image-dblclick', handler);
  });
});
