// @vitest-environment happy-dom
import { Editor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { blankClickFallbackPos, installBlankClickFocus } from '../blank-click-focus';

/**
 * 空白点击落光标兜底契约锁。
 *
 * happy-dom 没有真实布局（getBoundingClientRect 全 0、posAtCoords 不可用），
 * 所以判据走「stub posAtCoords + stub 几何矩形 → 断言落点」；
 * 端到端验证「mousedown 挂在滚动容器（纸面）上」且真的派发选区事务、并吞掉默认行为。
 * 真机坐标几何（WebView2 留白点击）靠人工实测验收。
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

function mouse(init: { button?: number; clientX?: number; clientY?: number; shiftKey?: boolean } = {}): MouseEvent {
  return new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 400,
    clientY: 400,
    ...init,
  });
}

describe('blankClickFallbackPos 判定（纸面 = 滚动容器）', () => {
  let editor: Editor;
  let view: EditorView;
  let paper: HTMLElement;

  beforeEach(() => {
    editor = new Editor({
      extensions: [StarterKit],
      content: '<p>aaa</p><p>bbb</p>',
    });
    view = editor.view;
    paper = document.createElement('div');
    // 纸面（滚动容器）：0,0 - 800,800；内容只占上边一小条，下方全是留白
    stubRect(paper, { top: 0, bottom: 800, left: 0, right: 800 });
    // 第一段 60-90，第二段 100-130
    const paras = view.dom.querySelectorAll('p');
    stubRect(paras[0], { top: 60, bottom: 90, left: 0, right: 800 });
    stubRect(paras[1], { top: 100, bottom: 130, left: 0, right: 800 });
    // 默认：留白处 posAtCoords 取不到位置
    vi.spyOn(view, 'posAtCoords').mockReturnValue(null);
  });

  afterEach(() => {
    editor.destroy();
    vi.restoreAllMocks();
  });

  it('点末块下方留白 → 落文档末尾（content.size）', () => {
    expect(blankClickFallbackPos(view, mouse({ clientY: 500 }), paper)).toBe(
      view.state.doc.content.size,
    );
  });

  it('点首块上方留白 → 落文档开头（1）', () => {
    expect(blankClickFallbackPos(view, mouse({ clientY: 20 }), paper)).toBe(1);
  });

  it('点两块之间的留白 → 不接管（返回 null）', () => {
    expect(blankClickFallbackPos(view, mouse({ clientY: 95 }), paper)).toBeNull();
  });

  it('posAtCoords 有值（点到真实内容）→ 一律放行', () => {
    vi.mocked(view.posAtCoords).mockReturnValue({ pos: 5, inside: 4 } as never);
    expect(blankClickFallbackPos(view, mouse({ clientY: 75 }), paper)).toBeNull();
    expect(blankClickFallbackPos(view, mouse({ clientY: 500 }), paper)).toBeNull();
  });

  it('右键（button=2）→ 放行，不影响右键菜单', () => {
    expect(blankClickFallbackPos(view, mouse({ button: 2, clientY: 500 }), paper)).toBeNull();
  });

  it('Shift+点击（扩展选区语义）→ 维持原状不接管', () => {
    expect(blankClickFallbackPos(view, mouse({ clientY: 500, shiftKey: true }), paper)).toBeNull();
  });

  it('坐标在纸面外 → 不接管（横向 / 纵向各一）', () => {
    expect(blankClickFallbackPos(view, mouse({ clientX: 900, clientY: 500 }), paper)).toBeNull();
    expect(blankClickFallbackPos(view, mouse({ clientY: -10 }), paper)).toBeNull();
  });

  it('组字中（view.composing）→ 不接管，防 IME 候选窗失锚', () => {
    Object.defineProperty(view, 'composing', { configurable: true, get: () => true });
    expect(blankClickFallbackPos(view, mouse({ clientY: 500 }), paper)).toBeNull();
  });
});

describe('installBlankClickFocus 端到端（事件挂在纸面上）', () => {
  let editor: Editor;
  let view: EditorView;
  let paper: HTMLElement;
  let dispose: () => void;

  beforeEach(() => {
    editor = new Editor({
      extensions: [StarterKit],
      content: '<p>aaa</p><p>bbb</p>',
    });
    view = editor.view;
    paper = document.createElement('div');
    stubRect(paper, { top: 0, bottom: 800, left: 0, right: 800 });
    const paras = view.dom.querySelectorAll('p');
    stubRect(paras[0], { top: 60, bottom: 90, left: 0, right: 800 });
    stubRect(paras[1], { top: 100, bottom: 130, left: 0, right: 800 });
    vi.spyOn(view, 'posAtCoords').mockReturnValue(null);
    dispose = installBlankClickFocus({ getView: () => view, getPaperEl: () => paper });
  });

  afterEach(() => {
    dispose();
    editor.destroy();
    vi.restoreAllMocks();
  });

  it('纸面留白 mousedown → 选区落末段末尾，且吞掉默认行为', () => {
    const size = view.state.doc.content.size;
    const ev = mouse({ clientY: 500 });
    paper.dispatchEvent(ev);
    // 最后段落内容末尾 = size - 1（doc 末位置本身在 doc 层，near 向前落 textblock）
    expect(view.state.selection.head).toBe(size - 1);
    expect(view.state.selection.empty).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('点首块上方 → 选区真的落到开头', () => {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)));
    expect(view.state.selection.head).toBe(6);
    const ev = mouse({ clientY: 20 });
    paper.dispatchEvent(ev);
    expect(view.state.selection.head).toBe(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('点击落在纸面子元素上（冒泡）同样接管 —— 留白常在 mk-editor-inner 上', () => {
    const inner = document.createElement('div');
    paper.appendChild(inner);
    const size = view.state.doc.content.size;
    inner.dispatchEvent(mouse({ clientY: 500 }));
    expect(view.state.selection.head).toBe(size - 1);
  });

  it('点到真实内容（posAtCoords 有值）→ 不接管、不吞默认行为', () => {
    vi.mocked(view.posAtCoords).mockReturnValue({ pos: 5, inside: 4 } as never);
    const ev = mouse({ clientY: 75 });
    paper.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('卸载后不再接管（退回原行为）', () => {
    dispose();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)));
    const ev = mouse({ clientY: 500 });
    paper.dispatchEvent(ev);
    expect(view.state.selection.head).toBe(6);
    expect(ev.defaultPrevented).toBe(false);
  });
});
