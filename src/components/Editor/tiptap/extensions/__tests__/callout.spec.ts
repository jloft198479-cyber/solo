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
