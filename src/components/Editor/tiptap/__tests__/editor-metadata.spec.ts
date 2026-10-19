/**
 * editor-metadata：ZWNJ 剥离契约（字数统计 / 大纲文本）
 *
 * 背景：`parser.ts` §1.5 会在**解析期**往正文插 U+200C（让中文标点边界的强调成立），
 * 而 ZWNJ **不是空白**（`\s` 不匹配）⇒ 任何「读正文文本后对外呈现 / 计数」的地方
 * 都必须过 `stripZwnj`，否则：
 *  - 字数统计每个 ZWNJ 多加 1 字（打开文档即虚高）；
 *  - 大纲文本带隐形字符。
 * 见 `docs/sensitive-areas.md` #23 与台账 §二 #32。
 */
import { describe, it, expect, vi } from 'vitest';
import type { Editor as TiptapEditor } from '@tiptap/vue-3';
import { Node as PMNodeClass } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { parseMarkdown } from '../markdown/parser';
import { createTestSchema } from '../markdown/__tests__/test-utils';
import {
  extractEditorOutline,
  getEditorSelectionLength,
  getEditorWordCount,
} from '../editor-metadata';

/** 这两个函数只用到 `editor.state.doc`，用最小替身即可（免起真实 Editor） */
const fakeEditor = (md: string) =>
  ({ state: { doc: parseMarkdown(createTestSchema(), md) } }) as unknown as TiptapEditor;

describe('editor-metadata · ZWNJ 不得外溢到读数', () => {
  it('字数统计：中文标点边界的强调不再虚高', () => {
    // 解析期会插 2 个 ZWNJ（开合各一处）；剥离后应等于可见字数 7
    const doc = parseMarkdown(createTestSchema(), '他说：「**重点**」');
    expect(doc.textContent, '前置条件：该写法确实会被解析期插入 ZWNJ').toContain('\u200C');
    expect(getEditorWordCount({ state: { doc } } as unknown as TiptapEditor)).toBe(7);
    expect(getEditorWordCount(fakeEditor('嘿**「注意**'))).toBe(4);
  });

  it('字数统计：不含强调的文档不受影响（防「顺手改坏」）', () => {
    expect(getEditorWordCount(fakeEditor('普通一句话，没有任何强调。'))).toBe(13);
  });

  it('大纲文本：标题里的 ZWNJ 被剥掉', () => {
    const outline = extractEditorOutline(fakeEditor('# 他说：「**重点**」\n'));
    expect(outline).toHaveLength(1);
    expect(outline[0].text).toBe('他说：「重点」');
    expect(outline[0].text).not.toContain('\u200C');
  });
});

/**
 * 选区字数（状态栏「N 字选中」的数据源）与它的**性能契约**。
 *
 * 为什么要单独立锁：这个函数原来还算「光标行号」，实现是「数光标前的所有顶层块、
 * 每块再 descendants」⇒ O(光标前全部节点)，而算出来的行号没有任何 UI 读取
 * （台账 §一 #72，2026-10-19 删除）。这里的判据是**可观测的遍历次数**：
 * 只要有人把行号那种「无范围全文遍历」加回来，spy 立刻有调用 ⇒ 红。
 * 用收集器而不是计时：计时在 CI 上不稳，遍历次数是确定性事实。
 */
describe('editor-metadata · 选区字数（只扫选区，绝不全文遍历）', () => {
  const schema = createTestSchema();

  /** 带选区的替身：这几个函数只用 editor.state（doc + selection） */
  const editorWithSelection = (md: string, from: number, to = from) => {
    const doc = parseMarkdown(schema, md);
    return {
      state: { doc, selection: TextSelection.create(doc, from, to) },
    } as unknown as TiptapEditor;
  };

  it('空选区返回 0，且一次文档级遍历都不做', () => {
    const descSpy = vi.spyOn(PMNodeClass.prototype, 'descendants');
    const ed = editorWithSelection('甲乙丙丁\n', 3);
    expect(getEditorSelectionLength(ed)).toBe(0);
    expect(descSpy, '空选区不该产生任何无范围遍历').not.toHaveBeenCalled();
    descSpy.mockRestore();
  });

  it('非空选区：按交集计数，跨块不把换行算进去', () => {
    const md = '甲乙\n\n丙丁\n';
    const doc = parseMarkdown(schema, md);
    const ed = editorWithSelection(md, 1, doc.content.size - 1);
    expect(getEditorSelectionLength(ed)).toBe(4);
  });

  it('非空选区也只走 nodesBetween，不调 descendants（行号那种全文遍历会红）', () => {
    const descSpy = vi.spyOn(PMNodeClass.prototype, 'descendants');
    const rangeSpy = vi.spyOn(PMNodeClass.prototype, 'nodesBetween');
    const ed = editorWithSelection('甲乙\n\n丙丁\n', 1, 7);
    expect(getEditorSelectionLength(ed)).toBe(4);
    expect(descSpy, '选区字数不许走无范围遍历').not.toHaveBeenCalled();
    // 最外层那次 nodesBetween 的窗口必须落在选区内（不是 0..docSize）。
    // 只查第一次：PM 的 nodesBetween 会递归调用子节点，递归那几次是相对坐标，会从 0 起。
    const [from, to] = rangeSpy.mock.calls[0] as unknown as [number, number];
    expect(from).toBeGreaterThanOrEqual(1);
    expect(to).toBeLessThanOrEqual(7);
    descSpy.mockRestore();
    rangeSpy.mockRestore();
  });
});
