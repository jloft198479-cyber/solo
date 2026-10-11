import { EditorState, TextSelection } from '@tiptap/pm/state';
import { findSuggestionMatch } from '@tiptap/suggestion';
import type { Trigger } from '@tiptap/suggestion';
import { describe, expect, it } from 'vitest';

import { createTestSchema } from '../../markdown/__tests__/test-utils';
import { guardedFindSuggestionMatch } from '../suggestion-guard';

const schema = createTestSchema();

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

describe('Windows 路径守卫（盘符冒号不唤出 Emoji 菜单）', () => {
  // 场景：正文里敲 G:\skills-pi\volc-web-search——':' 唤出 Emoji 菜单后，'：'
  // 之后整条路径成为 query，列表恒空 → 弹「没有匹配的表情」空窗，且菜单会一直
  // 挂到用户打空格才消失（用户实测报障 2026-09-12）。
  it('盘符冒号不触发（反斜杠 / 正斜杠分隔均覆盖）', () => {
    expect(guardedFindSuggestionMatch(trigger('G:\\skills-pi\\volc-web-search', ':', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('C:\\Users\\a.md', ':', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('D:\\', ':', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('路径 G:\\skills', ':', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('G:/skills', ':', null))).toBeNull();
  });

  it('冒号后紧跟反斜杠一律不触发（含行首 :\\foo）', () => {
    expect(guardedFindSuggestionMatch(trigger(':\\foo', ':', null))).toBeNull();
  });

  it('正常表情触发不受影响', () => {
    expect(guardedFindSuggestionMatch(trigger(':smile', ':', null))).not.toBeNull();
    expect(guardedFindSuggestionMatch(trigger('你好:微笑', ':', null))).not.toBeNull();
    expect(guardedFindSuggestionMatch(trigger('hello :smile', ':', null))).not.toBeNull();
    // 多字母普通词前缀仍放行（既有 URL 守卫的既有语义）
    expect(guardedFindSuggestionMatch(trigger('note:', ':', null))).not.toBeNull();
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

/**
 * URL / 路径上下文守卫（2026-10-11，台账 §二 #57）。
 *
 * **病**：本仓把 `allowedPrefixes` 设成 `null`（中文无词间空格，刚需）⇒ 上游「前一字符
 * 必须是空格」那道**天然闸门没了**；只判「前一个字符」的旧规则挡不住 URL **路径**里的
 * 斜杠 —— `看这个 https://a.com/path` 的第三个 `/` 前一字符是 `m` ⇒ 唤出 Slash 菜单，
 * 此时按 Enter 会 `deleteRange` 吃掉那个斜杠并执行「正文」命令（真机实测）。
 *
 * **药**：新增 `URL_CONTEXT_RE` —— 取「最后一个空白之后的整段」判形态
 * （`scheme://` / `www.` / 盘符路径），命中即对 `/` 与 `:` 一律不触发；
 * 旧的单字符规则保留作兜底（网址刚敲到 `https:/` 还没写出 `//` 时靠它顶）。
 *
 * ⚠️ **反向校准**：删掉 `isUrlContext` 那一行 ⇒ 本组第 1 条必须转红。
 */
describe('URL / 路径上下文守卫：路径里的斜杠不再误弹（2026-10-11）', () => {
  it('【禁止误弹】网址路径里的斜杠不触发（修复前会弹菜单、按 Enter 吃掉斜杠）', () => {
    // 中文前缀 + 网址：真机复现的原始形态
    expect(guardedFindSuggestionMatch(trigger('看这个 https://a.com/', '/', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('看这个 https://a.com/path', '/', null))).toBeNull();
    // 行首就是网址
    expect(guardedFindSuggestionMatch(trigger('https://a.com/', '/', null))).toBeNull();
    // www 形态
    expect(guardedFindSuggestionMatch(trigger('看 www.a.com/x', '/', null))).toBeNull();
    // 盘符路径与网址同病同治
    expect(guardedFindSuggestionMatch(trigger('打开 D:/work/a', '/', null))).toBeNull();
    // 冒号同理：网址里的冒号（如端口）不唤表情菜单
    expect(guardedFindSuggestionMatch(trigger('看这个 https://a.com:8080', ':', null))).toBeNull();
  });

  it('【不许误伤】中文前缀 / 普通文本 / 空格后的斜杠照常触发', () => {
    expect(guardedFindSuggestionMatch(trigger('你好/', '/', null))).not.toBeNull();
    expect(guardedFindSuggestionMatch(trigger('你好:', ':', null))).not.toBeNull();
    expect(guardedFindSuggestionMatch(trigger('甲 /', '/', null))).not.toBeNull();
    expect(guardedFindSuggestionMatch(trigger('甲/乙', '/', null))).not.toBeNull();
  });

  it('【旧规则兜底】网址刚敲到 scheme 冒号 / 路径未成形态时不触发', () => {
    expect(guardedFindSuggestionMatch(trigger('看这个 https:', ':', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('看这个 https:/', '/', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('看这个 https://', '/', null))).toBeNull();
  });
});

/**
 * URL 上下文守卫的**残留误报**：网址后面紧跟中文（2026-10-11，台账 §二 #57 残余）。
 *
 * **病**：判据是「最后一个空白之后的整段」，而 URL 余部的字符类原来是 `[^\s]*`——中文
 * 没有词间空格，用户写完网址紧接着写中文时（`https://x.com然后/`），`然后` 被吞进「URL」
 * ⇒ 这个斜杠被判成 URL 路径、菜单**该弹不弹**（用户敲 `/` 想插命令，毫无反应）。
 *
 * **药**：把 CJK / 全角标点从「URL 余部」字符类里排除（网址尾部不会出现它们）。
 *
 * ⚠️ **反向校准**：把 `URL_CONTEXT_RE` 的字符类改回 `[^\s]*` ⇒ 本组第 1 条 4 个断言转红。
 */
describe('URL 守卫残留误报：网址后紧跟中文仍要弹菜单（2026-10-11）', () => {
  it('【禁止误报】网址后紧跟中文时，斜杠照常触发', () => {
    expect(guardedFindSuggestionMatch(trigger('https://x.com然后/', '/', null))).not.toBeNull();
    expect(guardedFindSuggestionMatch(trigger('详见 www.a.com然后/', '/', null))).not.toBeNull();
    expect(guardedFindSuggestionMatch(trigger('参考https://x.com然后/', '/', null))).not.toBeNull();
    expect(guardedFindSuggestionMatch(trigger('，https://a.com的说明然后/', '/', null))).not.toBeNull();
  });

  it('【对照】网址后带空格再写中文，本来就该弹（既有语义不变）', () => {
    expect(guardedFindSuggestionMatch(trigger('https://a.com 然后/', '/', null))).not.toBeNull();
  });

  it('【不许误伤】真 URL 路径里的斜杠仍被抑制（全 ASCII 形态不受影响）', () => {
    expect(guardedFindSuggestionMatch(trigger('看这个 https://a.com/path', '/', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('https://a.com/path?q=1&r=2', '/', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('D:/work/a/b', '/', null))).toBeNull();
    expect(guardedFindSuggestionMatch(trigger('看这个 https://a.com:8080', ':', null))).toBeNull();
  });
});
