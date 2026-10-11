// @vitest-environment happy-dom
import type { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { Callout } from '../callout';

interface NodeViewLike {
  dom: HTMLElement;
  update?: (node: PMNode) => boolean;
}

/**
 * 回归锁：NodeView 的 DOM 不会自动应用 addAttributes 的 renderHTML，
 * 必须手动同步 data-callout-type / data-title / data-fold——
 * 此前裸 div 丢属性，真实编辑器里类型配色与 B10 标题 CSS 从未生效。
 */
function makeView(node: PMNode): NodeViewLike {
  const renderer = Callout.config.addNodeView?.() as
    | ((props: { node: PMNode }) => NodeViewLike)
    | undefined;
  if (typeof renderer !== 'function') throw new Error('Callout 未提供 NodeView 工厂');
  return renderer({ node });
}

const schema = createTestSchema();

describe('callout NodeView attrs 同步', () => {
  it('创建时挂 data-callout-type / data-title / data-fold', () => {
    const node = schema.nodes.callout.create(
      { calloutType: 'warning', title: '注意', fold: '+' },
      schema.nodes.paragraph.create(null, schema.text('内容')),
    );
    const view = makeView(node);
    expect(view.dom.className).toBe('mk-callout');
    expect(view.dom.getAttribute('data-callout-type')).toBe('warning');
    expect(view.dom.getAttribute('data-title')).toBe('注意');
    expect(view.dom.getAttribute('data-fold')).toBe('+');
  });

  it('无标题/无折叠标记时不输出对应属性', () => {
    const node = schema.nodes.callout.create(
      { calloutType: 'note' },
      schema.nodes.paragraph.create(null, schema.text('内容')),
    );
    const view = makeView(node);
    expect(view.dom.getAttribute('data-callout-type')).toBe('note');
    expect(view.dom.hasAttribute('data-title')).toBe(false);
    expect(view.dom.hasAttribute('data-fold')).toBe(false);
  });

  it('update 同步属性变化（类型切换 / 标题增删）', () => {
    const node = schema.nodes.callout.create(
      { calloutType: 'note', title: '旧标题' },
      schema.nodes.paragraph.create(null, schema.text('内容')),
    );
    const view = makeView(node);

    const updated = schema.nodes.callout.create(
      { calloutType: 'danger' },
      schema.nodes.paragraph.create(null, schema.text('内容')),
    );
    expect(view.update?.(updated)).toBe(true);
    expect(view.dom.getAttribute('data-callout-type')).toBe('danger');
    // 标题删除后属性同步移除
    expect(view.dom.hasAttribute('data-title')).toBe(false);
  });

  it('update 拒绝非同类型节点', () => {
    const node = schema.nodes.callout.create(
      { calloutType: 'note' },
      schema.nodes.paragraph.create(null, schema.text('内容')),
    );
    const view = makeView(node);
    const other = schema.nodes.blockquote.create(null, schema.nodes.paragraph.create(null, schema.text('x')));
    expect(view.update?.(other)).toBe(false);
  });
});

/**
 * 就地编辑锁（2026-10-12）：点标题文字应在原文字上改，不是弹空框重打。
 * 反向校准：撤掉「预填 displayedAtEntry」→ 前两条红；
 * 撤掉「next === displayedAtEntry 不写库」→ 第三条红。
 */
describe('callout 标题就地编辑', () => {
  function renderInteractive(node: PMNode) {
    const renderer = Callout.config.addNodeView?.() as
      | ((props: { node: PMNode; getPos?: () => number; editor?: unknown }) => NodeViewLike)
      | undefined;
    if (typeof renderer !== 'function') throw new Error('Callout 未提供 NodeView 工厂');
    const written: Array<Record<string, unknown>> = [];
    const tr = {
      setNodeMarkup: (_pos: number, _type: unknown, attrs: Record<string, unknown>) => {
        written.push(attrs);
        return tr;
      },
    };
    const editor = {
      view: { state: { tr }, dispatch: () => {} },
      commands: { focus: () => {} },
    };
    const view = renderer({ node, getPos: () => 0, editor });
    return {
      view,
      button: view.dom.querySelector('.mk-callout-title-button') as HTMLElement,
      input: view.dom.querySelector('.mk-callout-title-input') as HTMLInputElement,
      written,
    };
  }

  it('无标题时点击标题钮：输入框预填类型名，不是空框', () => {
    const node = schema.nodes.callout.create(
      { calloutType: 'warning' },
      schema.nodes.paragraph.create(null, schema.text('内容')),
    );
    const { button, input } = renderInteractive(node);
    expect(input.style.display).toBe('none');
    button.click();
    expect(button.style.display).toBe('none');
    expect(input.style.display).not.toBe('none');
    expect(input.value).toBe('warning');
  });

  it('有标题时点击标题钮：预填原标题', () => {
    const node = schema.nodes.callout.create(
      { calloutType: 'note', title: '观点一' },
      schema.nodes.paragraph.create(null, schema.text('内容')),
    );
    const { button, input } = renderInteractive(node);
    button.click();
    expect(input.value).toBe('观点一');
  });

  it('未改动失焦不写库；改动后失焦才写', () => {
    const node = schema.nodes.callout.create(
      { calloutType: 'note' },
      schema.nodes.paragraph.create(null, schema.text('内容')),
    );
    const { button, input, written } = renderInteractive(node);
    // 无标题：预填的是类型名 note，原样失焦 ⇒ 不写冗余 title=note
    button.click();
    expect(input.value).toBe('note');
    input.dispatchEvent(new Event('blur'));
    expect(written).toHaveLength(0);
    // 无标题时把预填的类型名清空再失焦 ⇒ title 本就是 ''，不发空事务（双守卫第二道）
    button.click();
    input.value = '';
    input.dispatchEvent(new Event('blur'));
    expect(written).toHaveLength(0);
    // 改为真标题 ⇒ 落库
    button.click();
    input.value = '观点一';
    input.dispatchEvent(new Event('blur'));
    expect(written).toHaveLength(1);
    expect(written[0].title).toBe('观点一');
  });

  it('有标题时清空失焦：删除标题照常落库，守卫不拦正常删除', () => {
    const node = schema.nodes.callout.create(
      { calloutType: 'note', title: '观点一' },
      schema.nodes.paragraph.create(null, schema.text('内容')),
    );
    const { button, input, written } = renderInteractive(node);
    button.click();
    input.value = '';
    input.dispatchEvent(new Event('blur'));
    expect(written).toHaveLength(1);
    expect(written[0].title).toBe('');
  });
});
