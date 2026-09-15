// @vitest-environment happy-dom
import { EditorState } from '@tiptap/pm/state';
import { EditorView, type DecorationSet } from '@tiptap/pm/view';
import javascript from 'highlight.js/lib/languages/javascript';
import { createLowlight } from 'lowlight';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { setDocumentTier } from '../../../document-scale';
import { clearIdleRenderQueue } from '../idle-render-scheduler';
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
    const schema = createTestSchema();
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
    const schema = createTestSchema();
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

// 打开时的同步高亮上限 + 空闲分批补算。
//
// 背景：按块字符上限只解决「单个大块」；「块数多」此前仍是同步全量——
// 未标注语言的块要跑 17 种 tokenizer（实测 1k 字 6.6ms、WebView2 ×2~3），
// 一份从 AI 对话粘来的笔记常有 30~60 个未标注块 ⇒ 打开首帧被拖 0.3~1s。
// 现改为：同步只跑首屏量级（8 个），其余排空闲队列逐步上色。
describe('createIncrementalLowlightPlugin 打开时分批高亮', () => {
  const testLowlight = createLowlight({ javascript });
  const autoSpy = vi.spyOn(testLowlight, 'highlightAuto');
  const highlightSpy = vi.spyOn(testLowlight, 'highlight');

  const BLOCKS = 20;
  const INITIAL_LIMIT = 8;

  let view: EditorView | null = null;
  let mount: HTMLElement | null = null;
  const originalRic = (globalThis as unknown as { requestIdleCallback?: unknown })
    .requestIdleCallback;

  beforeEach(() => {
    autoSpy.mockClear();
    highlightSpy.mockClear();
    clearIdleRenderQueue();
    // 空闲调度器在有 requestIdleCallback 时走 rIC；测试环境改为 setTimeout 兜底，
    // 让「等待补算完成」可确定地驱动
    delete (globalThis as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    if (view && !view.isDestroyed) view.destroy();
    view = null;
    if (mount) mount.remove();
    mount = null;
    if (originalRic) {
      (globalThis as unknown as { requestIdleCallback?: unknown }).requestIdleCallback =
        originalRic;
    }
    clearIdleRenderQueue();
    setDocumentTier('normal');
  });

  /** 造一篇含 n 个未标注语言代码块的文档 */
  function makeDoc(n: number) {
    const schema = createTestSchema();
    const children = [schema.node('paragraph', null, schema.text('head'))];
    for (let i = 0; i < n; i++) {
      children.push(
        schema.node('codeBlock', { language: null }, schema.text(`const v${i} = ${i} + 1;`)),
      );
    }
    return schema.node('doc', null, children);
  }

  /** 排空空闲队列（每轮一个宏任务，够跑完若干批次） */
  async function drainIdle(rounds = 20) {
    for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
  }

  /** 覆盖到高亮装饰的代码块数（按块范围逐个查） */
  function coveredBlocks(doc: import('@tiptap/pm/model').Node, set: DecorationSet | undefined) {
    let covered = 0;
    doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock' && (set?.find(pos, pos + node.nodeSize).length ?? 0) > 0) {
        covered++;
      }
      return true;
    });
    return covered;
  }

  it('init 只同步高亮首屏量级：20 块文档仅跑 8 次 auto 检测', () => {
    const schema = createTestSchema();
    const doc = makeDoc(BLOCKS);
    const plugin = createIncrementalLowlightPlugin('codeBlock', null, testLowlight);
    const state = EditorState.create({ schema, doc, plugins: [plugin] });

    expect(autoSpy).toHaveBeenCalledTimes(INITIAL_LIMIT);
    expect(coveredBlocks(doc, plugin.getState(state))).toBe(INITIAL_LIMIT);
  });

  it('空闲分批补齐：最终 20 块全部上色，且总检测次数恰好 20（无重复计算）', async () => {
    const schema = createTestSchema();
    const doc = makeDoc(BLOCKS);
    const plugin = createIncrementalLowlightPlugin('codeBlock', null, testLowlight);
    const state = EditorState.create({ schema, doc, plugins: [plugin] });
    view = new EditorView(mount!, { state });

    await drainIdle();

    expect(autoSpy).toHaveBeenCalledTimes(BLOCKS);
    expect(coveredBlocks(view.state.doc, plugin.getState(view.state))).toBe(BLOCKS);
    // 队列已排空：再等也不会有新增计算
    await drainIdle(3);
    expect(autoSpy).toHaveBeenCalledTimes(BLOCKS);
  });

  it('块数不超上限：一次同步跑完，行为与优化前一致（回归锁）', () => {
    const schema = createTestSchema();
    const doc = makeDoc(INITIAL_LIMIT);
    const plugin = createIncrementalLowlightPlugin('codeBlock', null, testLowlight);
    const state = EditorState.create({ schema, doc, plugins: [plugin] });

    expect(autoSpy).toHaveBeenCalledTimes(INITIAL_LIMIT);
    expect(coveredBlocks(doc, plugin.getState(state))).toBe(INITIAL_LIMIT);
  });

  it('整篇替换（文件切换）：单事务命中全部块，仍分批补算且最终完整', async () => {
    const schema = createTestSchema();
    const plugin = createIncrementalLowlightPlugin('codeBlock', null, testLowlight);
    let state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [schema.node('paragraph', null, schema.text('a'))]),
      plugins: [plugin],
    });
    view = new EditorView(mount!, { state });

    autoSpy.mockClear();
    // 整篇替换：变更区间覆盖全文 ⇒ affected 收集到全部代码块
    const big = makeDoc(BLOCKS);
    state = state.apply(state.tr.replaceWith(0, state.doc.content.size, big.content));
    view.updateState(state);

    expect(autoSpy).toHaveBeenCalledTimes(INITIAL_LIMIT);

    await drainIdle();
    expect(coveredBlocks(view.state.doc, plugin.getState(view.state))).toBe(BLOCKS);
  });

  it('组字期间空转：空闲补算不下发新装饰，组字结束后自动补齐（IME 防御）', async () => {
    const schema = createTestSchema();
    const doc = makeDoc(BLOCKS);
    const plugin = createIncrementalLowlightPlugin('codeBlock', null, testLowlight);
    const state = EditorState.create({ schema, doc, plugins: [plugin] });
    view = new EditorView(mount!, { state });

    const initialDetects = autoSpy.mock.calls.length; // init 的 8 次
    // 模拟浏览器组字中
    let browserComposing = true;
    Object.defineProperty(view, 'composing', {
      configurable: true,
      get: () => browserComposing,
    });

    // 组字期间排空空闲队列：补算必须整体推迟（合并装饰会改动组字中的 <code> DOM）
    await drainIdle();
    expect(autoSpy.mock.calls.length).toBe(initialDetects);
    expect(coveredBlocks(view.state.doc, plugin.getState(view.state))).toBe(INITIAL_LIMIT);

    // 组字结束后：推迟的补算自动接上，最终全覆盖
    browserComposing = false;
    await drainIdle();
    expect(coveredBlocks(view.state.doc, plugin.getState(view.state))).toBe(BLOCKS);
  });
});
