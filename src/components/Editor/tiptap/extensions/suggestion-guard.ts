/**
 * 守卫版 findSuggestionMatch（P4-04）
 *
 * 与 @tiptap/suggestion 默认实现语义等价，但把「对光标前整段文本跑 regex
 * matchAll + Array.from 全量展开再 pop」换成无分配的原生字符串扫描
 * （lastIndexOf / indexOf）。大段落连续打字时，默认实现每次事务都全量展开
 * 所有匹配，是主线程热点。
 *
 * 等价性前提（slash / emoji / wikilink 三个插件均满足）：allowSpaces=false、
 * allowToIncludeChar=false、startOfLine=false。
 *
 * - 单字符 char（'/'、':'）：匹配文本不含 char（排除字符类保证）→ 匹配之间
 *   不可能重叠 → 最后一个匹配的起点 = char 的最后一次出现位置，lastIndexOf
 *   一步定位（O(最近触发点距离)，无分配）。
 * - 多字符 char（'[['）：用 indexOf 循环复刻库 matchAll 的「非重叠、从左到
 *   右」语义取最后一个匹配——lastIndexOf 会命中与前一匹配触发串重叠的出
 *   现（'[[[' 时 lib 只匹配 @0，lastIndexOf 却找到 @1），语义漂移。
 *
 * 四个有意偏离默认实现的守卫（见下方注释）：URL 上下文、Windows 盘符、
 * '![' 前缀、开放互链上下文。
 */
import type { SuggestionMatch, Trigger } from '@tiptap/suggestion';

// 与 regex \s 集合一致的空白判断（字面量只创建一次，test 无分配）
const whitespaceRe = /\s/;

// URL scheme 词表：':' 前是这些词时判定为正在输入 URL（如「看这个 https:…」）
const URL_SCHEME_RE = /([a-z][a-z0-9+.-]*)$/i;
const URL_SCHEME_WORDS = new Set(['http', 'https', 'ftp', 'file', 'mailto', 'tel']);

/** 从触发串末尾向后扫：到「char 中任一字符」或空白处停（等价于库的排除字符类）。 */
function scanMatchEnd(text: string, char: string, start: number): number {
  let end = start + char.length;
  while (end < text.length) {
    if (char.includes(text[end]) || whitespaceRe.test(text[end])) break;
    end += 1;
  }
  return end;
}

export function guardedFindSuggestionMatch(config: Trigger): SuggestionMatch {
  const { char, allowedPrefixes, $position } = config;
  const nodeBefore = $position.nodeBefore;
  const text = nodeBefore?.isText ? nodeBefore.text : undefined;
  if (!text) return null;
  const pos = $position.pos;
  const textFrom = pos - text.length;

  // 定位最后一个匹配：
  // - 单字符 char（'/'、':'）：lastIndexOf 一步到位。匹配文本不含 char
  //   （排除字符类保证），匹配之间不可能重叠 → 最后一个匹配的起点必然
  //   是 char 的最后一次出现位置。
  // - 多字符 char（'[['）：必须复刻库 matchAll 的「非重叠、从左到右」语义
  //   取最后一个匹配——lastIndexOf 会命中与前一匹配触发串重叠的出现
  //   （'[[[' 时 lib 只匹配 @0 并消费前两个 [，lastIndexOf 却找到 @1），
  //   对 '[[[a' 一个 null 一个命中，语义漂移。indexOf 循环无分配，且多字符
  //   触发频率低，性能无虞。
  let charIndex: number;
  let matchEnd: number;
  if (char.length === 1) {
    charIndex = text.lastIndexOf(char);
    if (charIndex === -1) return null;
    matchEnd = scanMatchEnd(text, char, charIndex);
  } else {
    charIndex = -1;
    matchEnd = 0;
    let scanFrom = 0;
    for (;;) {
      const start = text.indexOf(char, scanFrom);
      if (start === -1) break;
      const end = scanMatchEnd(text, char, start);
      charIndex = start;
      matchEnd = end;
      scanFrom = end; // 非重叠：下一匹配从本匹配末尾起（与 matchAll 一致）
    }
    if (charIndex === -1) return null;
  }

  // 反斜杠紧跟冒号：Windows 路径分隔（':' + '\'）——表情名只含 [a-z0-9_+-]，
  // 不可能以 '\' 开头，故一律不触发。独立于 charIndex > 0：':' 在行首（':\foo'）
  // 同样成立。
  if (char === ':' && text[charIndex + 1] === '\\') return null;

  // URL 上下文守卫：触发字符落在 URL 里不弹菜单——敲 https://a.com 时
  // ':' 会唤出 Emoji 菜单、'/' 会唤出 Slash 菜单，此时按 Enter 会执行命令
  // 把 URL 文本替换掉。判定：'/' 的前一字符是 ':' 或 '/'（://、// 的斜杠）；
  // ':' 的前一个词是 URL scheme（https/ftp/file…，'note:' 这类普通词放行）
  if (charIndex > 0) {
    const prev = text[charIndex - 1];
    if (char === '/' && (prev === ':' || prev === '/')) return null;
    if (char === ':') {
      const wordBefore = URL_SCHEME_RE.exec(text.slice(0, charIndex))?.[1] ?? '';
      if (URL_SCHEME_WORDS.has(wordBefore.toLowerCase())) return null;
      // Windows 盘符守卫：'G:\skills' / 'C:/Users'——':' 前是孤立单字母即盘符，
      // 冒号后整条路径会沦为表情搜索词（弹「没有匹配的表情」空窗，干扰输入）。
      // URL scheme 词表只覆盖 http/ftp 等，盘符不在其内，故单独判。
      if (wordBefore.length === 1) return null;
    }
    // '![' 前缀守卫：Obsidian 嵌入语法 ![[x]] 与互链同前缀，但 solo 不支持
    // 嵌入——'![[foo' 不应唤出互链补全（否则插入的 wikilink 与 '!' 组合出
    // 语义错误的伪嵌入）
    if (char === '[[' && prev === '!') return null;
  }

  // 开放互链守卫：'[[' 已出现且未闭合（lastIndexOf('[[') > lastIndexOf(']]')）
  // 时，抑制 '/' 与 ':' 菜单——'[[sub/page' 是合法互链子路径输入，Slash 菜单
  // 在同一位置弹出会劫持 Enter、遮挡互链补全；也顺带修掉 ':x/' 类双菜单叠
  // 弹的旧问题（互链场景内）。'[[' 自身触发不受影响。
  if (char === '/' || char === ':') {
    if (text.lastIndexOf('[[') > text.lastIndexOf(']]')) return null;
  }

  // 前缀合法性（与库实现同款：允许前缀之一，或行首）
  if (allowedPrefixes !== null) {
    const prefix = charIndex === 0 ? '\0' : text[charIndex - 1];
    if (prefix !== '\0' && !allowedPrefixes.includes(prefix)) return null;
  }

  const matchText = text.slice(charIndex, matchEnd);
  const from = textFrom + charIndex;
  const to = from + matchText.length;
  if (!(from < pos && to >= pos)) return null;

  return { range: { from, to }, query: matchText.slice(char.length), text: matchText };
}
