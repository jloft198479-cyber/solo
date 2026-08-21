/**
 * 守卫版 findSuggestionMatch（P4-04）
 *
 * 与 @tiptap/suggestion 默认实现语义等价，但把「对光标前整段文本跑 regex
 * matchAll + Array.from 全量展开再 pop」换成「从后往前找最后一个触发字符」
 * （lastIndexOf，无分配）。大段落连续打字时，默认实现每次事务都全量展开
 * 所有匹配，是主线程热点。
 *
 * 等价性前提（slash / emoji 两个插件均满足）：allowSpaces=false、
 * allowToIncludeChar=false、startOfLine=false。此时匹配以 char 开头且
 * 匹配内不含第二个 char → 最后一个匹配的起点必然 = char 的最后一次出现位置，
 * lastIndexOf 找到的位置即为默认实现的 match.index。
 */
import type { SuggestionMatch, Trigger } from '@tiptap/suggestion';

// 与 regex \s 集合一致的空白判断（字面量只创建一次，test 无分配）
const whitespaceRe = /\s/;

export function guardedFindSuggestionMatch(config: Trigger): SuggestionMatch {
  const { char, allowedPrefixes, $position } = config;
  const nodeBefore = $position.nodeBefore;
  const text = nodeBefore?.isText ? nodeBefore.text : undefined;
  if (!text) return null;
  const pos = $position.pos;
  const textFrom = pos - text.length;

  // O(最近触发点距离)：从后往前找最后一个触发字符，找不到即无匹配
  const charIndex = text.lastIndexOf(char);
  if (charIndex === -1) return null;

  // 前缀合法性（与库实现同款：允许前缀之一，或行首）
  if (allowedPrefixes !== null) {
    const prefix = charIndex === 0 ? '\0' : text[charIndex - 1];
    if (prefix !== '\0' && !allowedPrefixes.includes(prefix)) return null;
  }

  // 匹配文本：char 起，到下一个 char / 空白 / 末尾止
  let end = charIndex + char.length;
  while (end < text.length) {
    if (text[end] === char || whitespaceRe.test(text[end])) break;
    end += 1;
  }

  const matchText = text.slice(charIndex, end);
  const from = textFrom + charIndex;
  const to = from + matchText.length;
  if (!(from < pos && to >= pos)) return null;

  return { range: { from, to }, query: matchText.slice(char.length), text: matchText };
}
