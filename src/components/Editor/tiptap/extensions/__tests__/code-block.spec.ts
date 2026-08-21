import { EditorState } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import javascript from 'highlight.js/lib/languages/javascript';
import { createLowlight } from 'lowlight';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMarkdownCompatSchema } from '../../markdown/compat-schema';
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
      expect(s.from >= 8 && s.to <= 20, `stale decoration survived: ${JSON.stringify(s)}`).toBe(true);
    }
    expect(highlightSpy).toHaveBeenCalledTimes(1);
    expect(autoSpy).toHaveBeenCalledTimes(1);
  });
});
