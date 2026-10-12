// @vitest-environment happy-dom
import { Editor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@tiptap/pm/view';
import { DOC_START, posOutsideContent } from '../editor-dom';

/**
 * `posOutsideContent` 契约锁 —— 拖拽落点与空白点击兜底**共用**的「内容外贴靠」判据。
 * happy-dom 无真实布局，故 stub 几何矩形。
 */

type Rect = { top: number; bottom: number; left: number; right: number };

function stubRect(el: Element, r: Rect): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: r.left,
    y: r.top,
    top: r.top,
    left: r.left,
    right: r.right,
    bottom: r.bottom,
    width: r.right - r.left,
    height: r.bottom - r.top,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('posOutsideContent', () => {
  let editor: Editor;
  let view: EditorView;

  beforeEach(() => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>aaa</p><p>bbb</p>' });
    view = editor.view;
    // 首块 60-90，末块 100-130
    const paras = view.dom.querySelectorAll('p');
    stubRect(paras[0], { top: 60, bottom: 90, left: 0, right: 800 });
    stubRect(paras[1], { top: 100, bottom: 130, left: 0, right: 800 });
  });

  afterEach(() => {
    editor.destroy();
    vi.restoreAllMocks();
  });

  it('首块顶边之上 → 文档首（DOC_START）', () => {
    expect(posOutsideContent(view, 20)).toBe(DOC_START);
  });

  it('末块底边之下 → 文档末（content.size）', () => {
    expect(posOutsideContent(view, 500)).toBe(view.state.doc.content.size);
  });

  it('落在内容纵向范围内 → null（交调用方按自身语义处置）', () => {
    expect(posOutsideContent(view, 95)).toBeNull();
    expect(posOutsideContent(view, 87)).toBeNull();
  });

  it('边界处取严（等于顶边 / 底边不算内容外）', () => {
    expect(posOutsideContent(view, 60)).toBeNull();
    expect(posOutsideContent(view, 130)).toBeNull();
  });

  it('⭐ 与「编辑器盒子是否撑满可视区」解耦：view.dom 盒子被撑到整屏时结论不变', () => {
    // 模拟 `min-height` 生效（盒子 = 整屏）：旧写法（拿 view.dom 底边当内容底边）
    // 会把「末块下方」误判成内容内 → 一律贴文档首；新写法按末块真实底边，不受影响
    stubRect(view.dom, { top: 0, bottom: 800, left: 0, right: 800 });
    expect(posOutsideContent(view, 500)).toBe(view.state.doc.content.size);
    expect(posOutsideContent(view, 20)).toBe(DOC_START);
  });
});
