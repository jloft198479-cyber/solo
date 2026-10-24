/**
 * 上标 (Superscript) 和下标 (Subscript) Mark 扩展
 *
 * Markdown 语法：
 * - 上标：^text^  → <sup>text</sup>
 * - 下标：~text~  → <sub>text</sub>
 *
 * 注意：下标使用单波浪线 ~text~，删除线使用双波浪线 ~~text~~。
 * 为避免与 Strikethrough 冲突，Subscript 的 input rule 排除前面紧跟 ~ 的情况。
 */
import { Mark, markPasteRule } from '@tiptap/vue-3';
import { InputRule } from '@tiptap/vue-3';
import type { MarkType } from '@tiptap/pm/model';

export const Superscript = Mark.create({
  name: 'superscript',

  parseHTML() {
    return [{ tag: 'sup' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', HTMLAttributes, 0];
  },

  addInputRules() {
    return [
      markInputRuleCompat({
        find: /\^([^^]+)\^$/,
        type: this.type,
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: /\^([^^]+)\^/g,
        type: this.type,
      }),
    ];
  },
});

export const Subscript = Mark.create({
  name: 'subscript',

  parseHTML() {
    return [{ tag: 'sub' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['sub', HTMLAttributes, 0];
  },

  addInputRules() {
    return [
      // 排除 ~~text~~（删除线语法）：要求 ~ 前面不是 ~
      new InputRule({
        find: /(?<!~)~([^~]+)~$/,
        handler: ({ state, range, match }) => {
          const { tr } = state;
          const markType = this.type;
          const text = match[1];
          if (!text) return;
          // range.from 已是 fullMatch 起点的文档坐标（TipTap runner：
          // `from - (match[0].length - text.length)`）。match 内偏移必须用
          // indexOf 求出——match.index 是「匹配在 textBefore 里的下标」，加上它
          // = 双重计入 ⇒ 越界 RangeError，段中根本做不出下标（审计 P1-3）。
          const fullMatch = match[0];
          const start = range.from + fullMatch.indexOf(text);
          const end = start + text.length;
          tr.addMark(start, end, markType.create());
          // 从高位删到低位（先闭合定界符后开启定界符），坐标不漂移；删除只到
          // range.to（＝刚敲的闭合符），不越过匹配区吃掉后续内容
          if (end < range.to) tr.delete(end, range.to);
          if (range.from < start) tr.delete(range.from, start);
          tr.removeStoredMark(markType);
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: /(?<!~)~([^~]+)~/g,
        type: this.type,
      }),
    ];
  },
});

/**
 * 兼容版 markInputRule，与 TipTap 的 markInputRule 行为一致，
 * 但使用标准 InputRule 以便支持 lookbehind 等高级正则。
 */
function markInputRuleCompat(config: { find: RegExp; type: MarkType }) {
  return new InputRule({
    find: config.find,
    handler: ({ state, range, match }) => {
      const { tr } = state;
      const text = match[1];
      if (!text) return;
      // 位置数学与上面的 Subscript handler 同源（对齐上游 markInputRule）：
      // range.from 已是匹配起点，match 内偏移用 indexOf 求，不得加 match.index
      const fullMatch = match[0];
      const start = range.from + fullMatch.indexOf(text);
      const end = start + text.length;
      tr.addMark(start, end, config.type.create());
      if (end < range.to) tr.delete(end, range.to);
      if (range.from < start) tr.delete(range.from, start);
      tr.removeStoredMark(config.type);
    },
  });
}
