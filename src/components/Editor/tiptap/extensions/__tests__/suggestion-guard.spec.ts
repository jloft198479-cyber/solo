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

  it('与库默认实现语义等价：wikilink（多字符 char "[["，allowedPrefixes=null）', () => {
    // 多字符触发的等价性依赖 end-scan 用 char.includes() 终止——
    // 库默认实现的排除字符类是 [^\s\[\[]（char 里每个字符都排除）
    const cases = [
      '[[foo',
      '你好[[笔记',
      '[[a[b', // 库在第二个 [ 处截断 → query 'a'
      '[[a[[b', // 库 matchAll pop 取最后一个 → query 'b'
      '[[[[',
      '[[[a',
      '[foo',
      '[]foo',
      '[[ foo', // 空格终止匹配，光标在匹配外 → null
      '[[a]b',
      '[[',
      '',
      'a]] b[[c',
    ];
    for (const text of cases) {
      const cfg = trigger(text, '[[', null);
      expect(guardedFindSuggestionMatch(cfg), text).toEqual(findSuggestionMatch(cfg));
    }
  });
});

describe('URL 上下文守卫（敲 URL 不弹菜单）', () => {
  // 场景：正文里敲 https://a.com——':' 唤出 Emoji 菜单、'/' 唤出 Slash 菜单，
  // 按 Enter 会执行命令把 URL 文本替换掉。守卫判定 URL 上下文直接不匹配。
  it('slash：https:// 的两个斜杠都不触发（前缀 :/ 与 //）', () => {
    expect(guardedFindSuggestionMatch(trigger('https:/', '/', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('https://', '/', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('https://a.com', '/', null))).toBeNull();
  });

  it('emoji：https: 的 scheme 冒号不触发', () => {
    expect(guardedFindSuggestionMatch(trigger('https:', ':', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('看这个 ftp:', ':', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('file:', ':', null))).toBeNull();
  });

  it('普通冒号/斜杠不受影响（note: 、中文后 / 照常触发）', () => {
    expect(guardedFindSuggestionMatch(trigger('note:', ':', null))).not.toBeNull();
    expect(guardedFindSuggestionMatch(trigger('你好/', '/', null))).not.toBeNull();
    expect(guardedFindSuggestionMatch(trigger('hello/', '/', null))).not.toBeNull();
  });
});

describe('互链上下文守卫（[[ 补全专属）', () => {
  it('嵌入前缀：![[foo 不触发互链补全（solo 不支持嵌入，防伪嵌入）', () => {
    expect(guardedFindSuggestionMatch(trigger('![[foo', '[[', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('![[', '[[', null))).toBeNull();
    // 无 ! 前缀的正常互链照常触发
    expect(guardedFindSuggestionMatch(trigger('看[[笔记', '[[', null))).not.toBeNull();
  });

  it('开放互链内抑制 / 与 : 菜单（[[sub/page 是合法互链子路径输入）', () => {
    expect(guardedFindSuggestionMatch(trigger('[[sub/page', '/', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('[[a:b', ':', null))).toBeNull();
    // 互链闭合后照常触发
    expect(guardedFindSuggestionMatch(trigger('[[a]] 后 /命令', '/', null))).not.toBeNull();
    expect(guardedFindSuggestionMatch(trigger('[[a]] 后 :微笑', ':', null))).not.toBeNull();
    // 无互链的普通文本照常触发
    expect(guardedFindSuggestionMatch(trigger('foo/bar', '/', null))).not.toBeNull();
  });
});
