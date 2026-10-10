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
import { describe, it, expect } from 'vitest';
import type { Editor as TiptapEditor } from '@tiptap/vue-3';
import { parseMarkdown } from '../markdown/parser';
import { createTestSchema } from '../markdown/__tests__/test-utils';
import { extractEditorOutline, getEditorWordCount } from '../editor-metadata';

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
