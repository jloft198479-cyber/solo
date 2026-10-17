// @vitest-environment happy-dom
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { parseMarkdown } from '../../markdown/parser';
import { setDocumentTier } from '../../../document-scale';
import { createParagraphFocusPlugin, refreshParagraphFocus } from '../paragraph-focus';

const schema = createTestSchema();

/**
 * 覆盖全部列表形态 + 容器：普通项、嵌套、待办（勾/未勾）、项内标题、混排、引用块。
 * 这些正是「幕布大纲式」调了很久才稳定的结构，锁的就是它们。
 */
const DOC = [
  '- A',
  '  - A1',
  '  - A2',
  '- B',
  '',
  '- [ ] 待办一',
  '- [x] 待办二',
  '',
  '- ## 项内标题',
  '- 正文项',
  '',
  '> 引用一',
  '>',
  '> 引用二',
  '',
  '普通段落',
].join('\n');

/** 剥掉聚焦装饰的 class —— 结构锁只关心「除了这个 class，DOM 有没有变」 */
function stripFocusClass(html: string): string {
  return (
    html
      .replace(/\s*paragraph-(?:active|dimmed)(?=["\s])/g, '')
      // 装饰撤掉后 ProseMirror 会把空 class 属性留在元素上（两边归一，不算结构变化）
      .replace(/\s*class=""/g, '')
  );
}

/** 标签序列：class 之外的第二重保险（万一 class 剥离写错，结构变化仍能被抓到） */
function tagSequence(html: string): string[] {
  return [...html.matchAll(/<([a-z0-9]+)[\s>]/gi)].map((m) => m[1].toLowerCase());
}

describe('聚焦装饰不得改变列表 DOM 结构（幕布大纲结构守护）', () => {
  let view: EditorView | null = null;
  let host: HTMLElement | null = null;

  beforeEach(() => {
    document.documentElement.classList.remove('focus-mode');
    setDocumentTier('normal');
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (view && !view.isDestroyed) view.destroy();
    view = null;
    host?.remove();
    host = null;
    document.documentElement.classList.remove('focus-mode');
    setDocumentTier('normal');
  });

  function mount(md: string, cursor: number): EditorView {
    const doc = parseMarkdown(schema, md);
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, cursor),
      plugins: [createParagraphFocusPlugin()],
    });
    view = new EditorView(host!, { state });
    return view;
  }

  it('开/关聚焦：DOM 逐字一致（只多出 paragraph-active / paragraph-dimmed）', () => {
    const v = mount(DOC, 3);
    const off = v.dom.innerHTML;

    // 关聚焦态必须干净——否则「两份都为空」会让下面的比对假绿
    expect(off).not.toContain('paragraph-active');
    expect(off).not.toContain('paragraph-dimmed');

    document.documentElement.classList.add('focus-mode');
    refreshParagraphFocus(v);
    const on = v.dom.innerHTML;

    // 装饰必须真的生效（防假锁：两边都没装饰时 strip 后当然相等）
    expect(on).toContain('paragraph-active');
    expect(on).toContain('paragraph-dimmed');

    expect(stripFocusClass(on)).toBe(off);
    expect(tagSequence(on)).toEqual(tagSequence(off));
  });

  it('列表骨架原样保留：任务项仍是 li>label+div，项内标题仍在 li 直属层', () => {
    const v = mount(DOC, 3);
    document.documentElement.classList.add('focus-mode');
    refreshParagraphFocus(v);

    const dom = v.dom;
    // 待办项：正文被 TaskItem 包在 div 里（上游 renderHTML），聚焦后仍然如此。
    // 注意本文件的 DOC 里普通项与待办项相邻 ⇒ markdown-it 合并成**一个** ul，
    // 待办项以 `li[data-type=taskItem]` 混排在同一层（正是 schema 放开 content 的原因）
    const taskItems = [...dom.querySelectorAll("li[data-type='taskItem']")];
    expect(taskItems.length).toBe(2);
    for (const li of taskItems) {
      expect(li.querySelector(':scope > label')).not.toBeNull();
      expect(li.querySelector(':scope > div > p')).not.toBeNull();
    }
    // 普通项：段落是 li 的直属子节点（折叠箭头的定位锚靠这一层）
    const plainItems = [...dom.querySelectorAll("li:not([data-type='taskItem'])")];
    expect(plainItems.length).toBeGreaterThan(0);
    expect(plainItems.some((li) => li.querySelector(':scope > p'))).toBe(true);
    // 项内标题：仍是 li 的直属子节点，没有被 div 包起来
    expect(dom.querySelector('li > h2')).not.toBeNull();
  });

  it('装饰落点是段落级：li 自身不带 class，段的 class 不覆盖整个列表', () => {
    const v = mount('- A\n- B\n- C\n', 3);
    document.documentElement.classList.add('focus-mode');
    refreshParagraphFocus(v);

    const items = [...v.dom.querySelectorAll('ul > li')];
    expect(items).toHaveLength(3);
    for (const li of items) expect(li.className).toBe('');
    expect(v.dom.querySelectorAll('p.paragraph-active')).toHaveLength(1);
    expect(v.dom.querySelectorAll('p.paragraph-dimmed')).toHaveLength(2);
  });
});
