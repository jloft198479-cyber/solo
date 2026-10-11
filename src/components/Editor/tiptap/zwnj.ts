/**
 * 零宽非连接符（ZWNJ，U+200C）—— 解析期修正 CJK flanking 的临时手段。
 *
 * ── 为什么单独成模块（真理源一处）──────────────────────────────
 * 这个字符是 `parser.ts` §1.5 在**解析前**插进正文的，用来让 markdown-it 按中文
 * 书写习惯判定强调的开合（`**沉浸式体验，**继续` 这类）。它是**仅供解析使用的中间物**，
 * 不该出现在任何对外产出里。
 *
 * 但「插进去」和「剥干净」是一对**跨模块契约**，不是 serializer 的内部细节：
 * 序列化器只是**剥得最早**的那一处，后续还有字数统计 / 大纲 / 剪贴板等读数点。
 * 历史教训（台账 §一 #35 复查）：剥离逻辑先前只存在于 `serializer.ts` 内部，
 * 于是「打开文档字数就多算」「复制正文粘出隐形字符」两处长期漏着。
 *
 * ⇒ 任何**读解析期产物**后要对外呈现 / 计数 / 写盘的地方，都必须过 `stripZwnj`。
 * 「解析期产物」＝ 正文文本 ＋ 由正文衍生的属性（alt / title / label / target /
 * alias / latex 等 attrs）——ZWNJ 不只存在于文本节点，也会固化进节点 attrs，而
 * attrs 的序列化**不经过** `escapeInline`，必须在各写出点显式剥（台账 §二 #32）。
 * 详见 `docs/sensitive-areas.md` #23。
 */

/** 唯一来源：不要在各处再写 `'\u200C'` 字面量 */
export const ZWNJ = '\u200C';

/**
 * 剥离 ZWNJ。
 *
 * 用 `split/join` 而非正则：无 `lastIndex` 状态、无 `replaceAll`（本项目 TS target
 * 是 ES2020），且 `includes` 短路让「无 ZWNJ」的常见路径零额外**分配**（不含扫描——
 * `includes` 本身仍是一次 O(len) 判断）——本函数在
 * `escapeInline` 里是**逐文本节点**调用的热点。
 */
export function stripZwnj(text: unknown): string {
  // 属性通道可能非字符串（Tiptap fromString 把往返 HTML 里的 `attr="1"` 强转成数字 1），
  // 直接 .includes 会抛 TypeError；这里统一收口：非字符串走 String()，既防崩又不静默丢值。
  if (typeof text !== 'string') return text == null ? '' : String(text);
  return text.includes(ZWNJ) ? text.split(ZWNJ).join('') : text;
}
