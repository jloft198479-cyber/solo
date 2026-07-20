// @vitest-environment happy-dom
/**
 * Slash 命令触发规则的回归测试。
 *
 * 锁住的不变量：`/` 在**任意前缀**后都能触发 Suggestion 匹配
 * （包括中文、英文字母、行首、空格）。
 *
 * 历史背景：TipTap Suggestion 的 `allowedPrefixes` 默认值是 `[' ']`，
 * 即只允许空格或行首作为 `/` 的前缀。这在英文环境勉强可用，但中文没有
 * 词间空格习惯——用户在「你好」后敲 `/` 期望唤出菜单，结果完全无反应。
 * editor-extensions.ts 里 SlashCommands.configure 显式传 `allowedPrefixes: null`
 * 修复此问题，本测试锁死该契约，防止以后误改回默认值。
 */
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { findSuggestionMatch } from '@tiptap/suggestion';

import { createMarkdownCompatSchema } from '../../markdown/compat-schema';

const schema = createMarkdownCompatSchema();

/**
 * 构造一个 paragraph 文档，光标停在文本末尾，调用 findSuggestionMatch
 * 检查在给定 char/allowedPrefixes/startOfLine 配置下是否匹配。
 *
 * 注意：allowedPrefixes 必须显式传，不能用 `??` 默认值——因为 null 是合法值
 * （表示"允许所有前缀"），`null ?? [' ']` 会错误地退回默认值。
 */
function matchAtTextEnd(text: string, opts: {
  char?: string;
  allowedPrefixes: string[] | null;
  startOfLine?: boolean;
}) {
  const paragraph = schema.nodes.paragraph.create(null, text ? [schema.text(text)] : []);
  const doc = schema.nodes.doc.create(null, [paragraph]);
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 1 + text.length),
  });
  const $position = state.selection.$from;
  return findSuggestionMatch({
    char: opts.char ?? '/',
    allowSpaces: false,
    allowToIncludeChar: false,
    allowedPrefixes: opts.allowedPrefixes,
    startOfLine: opts.startOfLine ?? false,
    $position,
  });
}

describe('slash command 触发规则 - allowedPrefixes', () => {
  // 项目实际使用的配置（editor-extensions.ts）
  const PROJECT_CONFIG = { allowedPrefixes: null as string[] | null, startOfLine: false };

  it('行首敲 / 触发（基线）', () => {
    expect(matchAtTextEnd('/', PROJECT_CONFIG)).not.toBeNull();
  });

  it('空格后敲 / 触发', () => {
    expect(matchAtTextEnd('hello /', PROJECT_CONFIG)).not.toBeNull();
  });

  it('英文字母后敲 / 触发（默认配置下不会触发，是原 bug 场景）', () => {
    // 默认 allowedPrefixes=[' ']，'hello/' 的前缀是 'o'，不匹配
    expect(matchAtTextEnd('hello/', { allowedPrefixes: [' '], startOfLine: false })).toBeNull();
    // 项目配置 allowedPrefixes=null，应该触发
    expect(matchAtTextEnd('hello/', PROJECT_CONFIG)).not.toBeNull();
  });

  it('中文字符后敲 / 触发（核心修复场景）', () => {
    // 默认配置下，'你好/' 的前缀是 '好'，不匹配 → 这是中文用户遇到的真实 bug
    expect(matchAtTextEnd('你好/', { allowedPrefixes: [' '], startOfLine: false })).toBeNull();
    // 项目配置下应该触发
    expect(matchAtTextEnd('你好/', PROJECT_CONFIG)).not.toBeNull();
  });

  it('中文标点后敲 / 触发', () => {
    expect(matchAtTextEnd('你好，/', PROJECT_CONFIG)).not.toBeNull();
  });

  it('多个 / 时匹配最后一个', () => {
    const match = matchAtTextEnd('a/b/', PROJECT_CONFIG);
    expect(match).not.toBeNull();
    // 匹配的 range 应该是最后一个 / 的位置：
    // doc 结构 doc(0) > paragraph(1) > text('a/b/')，text 内容从 pos 1 开始
    // 'a/b/' 长度 4，最后一个 / 在 text 内 index 3，对应 doc pos 1+3=4
    if (match) {
      expect(match.range.from).toBe(4);
      expect(match.range.to).toBe(5);
      expect(match.text).toBe('/');
    }
  });

  it('没有 / 时不触发', () => {
    expect(matchAtTextEnd('hello world', PROJECT_CONFIG)).toBeNull();
  });

  it('空段落不触发', () => {
    expect(matchAtTextEnd('', PROJECT_CONFIG)).toBeNull();
  });

  it('query 字段正确：/ 后的文本作为 query', () => {
    // '/cod' 的 query 应该是 'cod'
    const match = matchAtTextEnd('/cod', PROJECT_CONFIG);
    expect(match).not.toBeNull();
    if (match) {
      expect(match.query).toBe('cod');
    }
  });
});
