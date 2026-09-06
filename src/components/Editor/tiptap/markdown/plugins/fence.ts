/**
 * 围栏（fence）长度计算（共享逻辑）。
 *
 * codeBlock / mermaid 块 / math 块的 fence 形式共用：内容含独立 fence 行
 * （如 ``` 或 ````）时，固定 3 字符围栏会被提前闭合，落盘即损坏。按
 * 「内容最长同字符 run + 1」起算，逐级加长直到无整行冲突。
 * 独立成模块以避免插件运行时 import serializer 造成循环依赖。
 */

/** 计算文本中最长的连续字符运行 */
export function maxCharRun(text: string, ch: string): number {
  let max = 0, cur = 0;
  for (const c of text) {
    if (c === ch) { cur++; max = Math.max(max, cur); }
    else { cur = 0; }
  }
  return max;
}

/** 检查内容中是否含整行连续 fenceChar >= fenceLen（会被误判为 closing fence） */
export function lineClash(content: string, fenceChar: string, fenceLen: number): boolean {
  const escaped = fenceChar === '`' ? '\\`' : '\\~';
  const re = new RegExp(`(^|\\n) {0,3}${escaped}{${fenceLen},}[ \\t]*$`, 'm');
  return re.test(content);
}

/** 计算能安全包裹 content 的最小 fence 串 */
export function computeFence(content: string, fenceChar = '`'): string {
  let len = Math.max(3, maxCharRun(content, fenceChar) + 1);
  while (lineClash(content, fenceChar, len)) len++;
  return fenceChar.repeat(len);
}
