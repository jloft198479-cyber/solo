// @vitest-environment happy-dom
import { EditorState } from '@tiptap/pm/state';
import { EditorView, type DecorationSet } from '@tiptap/pm/view';
import javascript from 'highlight.js/lib/languages/javascript';
import { createLowlight } from 'lowlight';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMarkdownCompatSchema } from '../../markdown/compat-schema';
import { setDocumentTier } from '../../../document-scale';
import {
  createIncrementalLowlightPlugin,
  getCodeBlockLanguageLabel,
  normalizeCodeBlockLanguage,
} from '../code-block';

describe('normalizeCodeBlockLanguage', () => {
  it('normalizes language ids for storage', () => {
    expect(normalizeCodeBlockLanguage(' TypeScript ')).toBe('typescript');
  });

  it('returns null for empty values', () => {
    expect(normalizeCodeBlockLanguage('')).toBe(null);
    expect(normalizeCodeBlockLanguage('   ')).toBe(null);
    expect(normalizeCodeBlockLanguage(null)).toBe(null);
    expect(normalizeCodeBlockLanguage(undefined)).toBe(null);
  });
});

describe('getCodeBlockLanguageLabel', () => {
  it('returns the language when present', () => {
    expect(getCodeBlockLanguageLabel('java')).toBe('java');
  });

  it('falls back to plain text for empty values', () => {
    expect(getCodeBlockLanguageLabel('')).toBe('plain text');
    expect(getCodeBlockLanguageLabel('   ')).toBe('plain text');
    expect(getCodeBlockLanguageLabel(null)).toBe('plain text');
    expect(getCodeBlockLanguageLabel(undefined)).toBe('plain text');
  });
});

describe('createIncrementalLowlightPlugin 增量高亮', () => {
  // 文档结构（固定坐标便于断言）：
  //   [0, 7)   paragraph "hello"
  //   [7, 21)  codeBlock javascript "const x = 1;"（内容区 [8, 20)）
  //   [21, 33) codeBlock 无语言 "plain text"（内容区 [22, 32)）
  //   [33, 40) paragraph "world"
  const testLowlight = createLowlight({ javascript });
  const highlightSpy = vi.spyOn(testLowlight, 'highlight');
  const autoSpy = vi.spyOn(testLowlight, 'highlightAuto');

  afterEach(() => {
    highlightSpy.mockClear();
    autoSpy.mockClear();
    setDocumentTier('normal');
  });

  interface DecoSummary {
    from: number;
    to: number;
    cls: string | undefined;
  }

  function decoSummaries(set: DecorationSet | undefined): DecoSummary[] {
    return (set?.find() ?? [])
      .map((d) => ({ from: d.from, to: d.to, cls: d.type.attrs.class as string | undefined }))
      .sort((a, b) => a.from - b.from || a.to - b.to);
  }

  function setup() {
    const schema = createMarkdownCompatSchema();
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('hello')),
      schema.node('codeBlock', { language: 'javascript' }, schema.text('const x = 1;')),
      schema.node('codeBlock', { language: null }, schema.text('plain text')),
      schema.node('paragraph', null, schema.text('world')),
    ]);
    const plugin = createIncrementalLowlightPlugin('codeBlock', null, testLowlight);
    const state = EditorState.create({ schema, doc, plugins: [plugin] });
    return { state, plugin };
  }

  it('init：注册语言走 highlight，未注册走 highlightAuto', () => {
    const { state, plugin } = setup();

    const summaries = decoSummaries(plugin.getState(state));
    expect(summaries.length).toBeGreaterThan(0);
    for (const s of summaries) {
      expect(s.cls !== undefined && /^hljs/.test(s.cls)).toBe(true);
      expect(
        (s.from >= 8 && s.to <= 20) || (s.from >= 22 && s.to <= 32),
        `decoration outside code blocks: ${JSON.stringify(s)}`,
      ).toBe(true);
    }
    expect(highlightSpy).toHaveBeenCalledTimes(1);
    expect(autoSpy).toHaveBeenCalledTimes(1);
  });

  it('段落内打字：零次高亮调用，装饰整体平移复用', () => {
    const { state, plugin } = setup();
    const before = decoSummaries(plugin.getState(state));

    const next = state.apply(state.tr.insertText('X', 2));

    const after = decoSummaries(plugin.getState(next));
    expect(highlightSpy).toHaveBeenCalledTimes(1);
    expect(autoSpy).toHaveBeenCalledTimes(1);
    expect(after.map((s) => ({ ...s, from: s.from - 1, to: s.to - 1 }))).toEqual(before);
  });

  it('代码块内打字：仅重渲该块，其他块零计算', () => {
    const { state, plugin } = setup();

    const next = state.apply(state.tr.insertText('y', 20)); // js 块内容区末尾

    expect(highlightSpy).toHaveBeenCalledTimes(2); // init 1 次 + 该块 1 次
    expect(autoSpy).toHaveBeenCalledTimes(1); // plain 块未被触碰
    const summaries = decoSummaries(plugin.getState(next));
    expect(
      summaries.some((s) => s.from === 8 && s.to === 13 && /hljs-keyword/.test(s.cls ?? '')),
      `summaries=${JSON.stringify(summaries)}`,
    ).toBe(true);
  });

  it('language 属性变更：setNodeMarkup 走 ReplaceStep，变更区间检测天然命中并重渲', () => {
    const { state, plugin } = setup();

    // 无语言块改为 javascript：应改走 highlight 重渲该块，无需任何额外通知
    state.apply(
      state.tr.setNodeMarkup(21, undefined, { language: 'javascript', languageLabel: null }),
    );

    expect(highlightSpy).toHaveBeenCalledTimes(2); // init 1 次 + 该块 1 次
    expect(autoSpy).toHaveBeenCalledTimes(1);
  });

  it('language 属性改为未注册值：改走 highlightAuto 重渲对应块', () => {
    const { state, plugin } = setup();

    state.apply(state.tr.setNodeMarkup(7, undefined, { language: null, languageLabel: null }));

    expect(autoSpy).toHaveBeenCalledTimes(2); // init 1 次 + 该块 1 次
    expect(highlightSpy).toHaveBeenCalledTimes(1);
  });

  it('整块删除：其装饰随映射自动丢弃，剩余装饰不受影响', () => {
    const { state, plugin } = setup();

    const next = state.apply(state.tr.delete(21, 33)); // 删除 plain 块

    // 新文档：hello [0,7) + js [7,21) + world [21,28)
    const summaries = decoSummaries(plugin.getState(next));
    expect(summaries.length).toBeGreaterThan(0);
    for (const s of summaries) {
      expect(s.from >= 8 && s.to <= 20, `stale decoration survived: ${JSON.stringify(s)}`).toBe(
        true,
      );
    }
    expect(highlightSpy).toHaveBeenCalledTimes(1);
    expect(autoSpy).toHaveBeenCalledTimes(1);
  });

  it('大文档降级（heavy）：无语言块不再走 highlightAuto，标注语言的块仍正常高亮', () => {
    setDocumentTier('heavy');
    const { state, plugin } = setup();

    expect(highlightSpy).toHaveBeenCalledTimes(1); // js 块照常高亮
    expect(autoSpy).not.toHaveBeenCalled(); // 17 种语言全量试跑是最贵的路径
    for (const s of decoSummaries(plugin.getState(state))) {
      expect(s.from >= 8 && s.to <= 20, `降级后残留自动检测装饰: ${JSON.stringify(s)}`).toBe(true);
    }

    state.apply(state.tr.insertText('y', 32)); // 编辑无语言块内容区末尾
    expect(autoSpy).not.toHaveBeenCalled();

    state.apply(state.tr.insertText('y', 20)); // 编辑 js 块内容区末尾
    expect(highlightSpy).toHaveBeenCalledTimes(2);
  });
});

// 组字冻结回归锁（IME 候选窗失锚防御）：真 EditorView + 覆盖 view.composing，
// 复用 paragraph-focus / markdown-input-ime 同款套路。锁住「组字期间只平移高亮
// 装饰、不重建（不重新调 lowlight）」——重建会 remove+add 改动正在组字的 <code> DOM，
// 是 WebView2 下 IME 候选窗变形（横条塌成小方块）的诱因之一。
describe('createIncrementalLowlightPlugin 组字冻结（IME 防御）', () => {
  const testLowlight = createLowlight({ javascript });
  const highlightSpy = vi.spyOn(testLowlight, 'highlight');
  const autoSpy = vi.spyOn(testLowlight, 'highlightAuto');
  let view: EditorView | null = null;
  let mount: HTMLElement | null = null;

  beforeEach(() => {
    highlightSpy.mockClear();
    autoSpy.mockClear();
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });
  afterEach(() => {
    if (view && !view.isDestroyed) view.destroy();
    view = null;
    if (mount) mount.remove();
    mount = null;
    setDocumentTier('normal');
  });

  function mountView() {
    const schema = createMarkdownCompatSchema();
    // hello [0,7) + js codeBlock [7,21)（内容区 [8,20)）
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('hello')),
      schema.node('codeBlock', { language: 'javascript' }, schema.text('const x = 1;')),
    ]);
    const plugin = createIncrementalLowlightPlugin('codeBlock', null, testLowlight);
    const state = EditorState.create({ schema, doc, plugins: [plugin] });
    view = new EditorView(mount!, { state });
    return { v: view, plugin };
  }

  it('组字期间在代码块内打字：冻结高亮重建（只平移装饰）；组字结束后恢复重建', () => {
    const { v, plugin } = mountView();
    expect(highlightSpy).toHaveBeenCalledTimes(1); // init 对 js 块高亮一次

    // 模拟浏览器组字中（EditorView.composing 是原型 getter，装实例 getter 覆盖）
    let browserComposing = true;
    Object.defineProperty(v, 'composing', { configurable: true, get: () => browserComposing });

    // 组字期间在 js 块内容区末尾打字：绝不重新调 highlight
    // （重建会 remove+add 改动组字中的 <code> DOM → WebView2 IME 失锚）
    v.dispatch(v.state.tr.insertText('y', 20));
    expect(highlightSpy).toHaveBeenCalledTimes(1); // 仍是 init 那一次，未新增
    // 装饰未丢：map 平移后仍有高亮装饰覆盖 js 块
    expect((plugin.getState(v.state)?.find().length ?? 0)).toBeGreaterThan(0);

    // 组字结束后再打字：恢复正常重建（高亮不漏，只是推迟到组字结束）
    browserComposing = false;
    v.dispatch(v.state.tr.insertText('z', 21));
    expect(highlightSpy).toHaveBeenCalledTimes(2);
  });
});
