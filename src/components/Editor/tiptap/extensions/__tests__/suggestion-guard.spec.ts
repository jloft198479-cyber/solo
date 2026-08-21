import { EditorState, TextSelection } from '@tiptap/pm/state';
import { findSuggestionMatch } from '@tiptap/suggestion';
import type { Trigger } from '@tiptap/suggestion';
import { describe, expect, it } from 'vitest';

import { createMarkdownCompatSchema } from '../../markdown/compat-schema';
import { guardedFindSuggestionMatch } from '../suggestion-guard';

const schema = createMarkdownCompatSchema();

/** 构造光标在文本末尾的 $position（段落内坐标从 1 起）。 */
function cursorAtEnd(text: string) {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, text ? [schema.text(text)] : []),
  ]);
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 1 + text.length),
  });
  return state.selection.$from;
}

function trigger(text: string, char: string, allowedPrefixes: string[] | null): Trigger {
  return {
    char,
    allowSpaces: false,
    allowToIncludeChar: false,
    allowedPrefixes,
    startOfLine: false,
    $position: cursorAtEnd(text),
  };
}

describe('guardedFindSuggestionMatch（P4-04）', () => {
  it('与库默认实现语义等价：slash（allowedPrefixes=null，任意前缀）', () => {
    const cases = [
      '你好/',
      'hello/foo',
      'foo /bar',
      'foo/bar',
      'foo/bar baz',
      'no char here',
      '',
      '/a/b',
      'a/b/c d',
      '/',
      '/ foo',
    ];
    for (const text of cases) {
      const cfg = trigger(text, '/', null);
      expect(guardedFindSuggestionMatch(cfg), text).toEqual(findSuggestionMatch(cfg));
    }
  });

  it('与库默认实现语义等价：emoji（allowedPrefixes=[" "]，需空格/行首）', () => {
    const cases = [
      'hello :smile',
      'hello:smile',
      ':smile',
      'hello :smile x',
      ':',
      'a:b:c',
      'a :b: c',
      '　:smile', // 全角空格不算半角空格前缀
    ];
    for (const text of cases) {
      const cfg = trigger(text, ':', [' ']);
      expect(guardedFindSuggestionMatch(cfg), text).toEqual(findSuggestionMatch(cfg));
    }
  });

  it('slash 触发语义：中文后直接输入 / 即可唤出菜单', () => {
    const cfg = trigger('你好/', '/', null);
    expect(guardedFindSuggestionMatch(cfg)).toEqual({
      range: { from: 1 + '你好'.length, to: 1 + '你好/'.length },
      query: '',
      text: '/',
    });
  });

  it('query 取 char 后非空白内容', () => {
    const cfg = trigger('hello/foo', '/', null);
    expect(guardedFindSuggestionMatch(cfg)).toMatchObject({ query: 'foo', text: '/foo' });
  });

  it('无触发字符时快速返回 null（不跑 regex）', () => {
    expect(guardedFindSuggestionMatch(trigger('no trigger', '/', null))).toBeNull();
  });
});
