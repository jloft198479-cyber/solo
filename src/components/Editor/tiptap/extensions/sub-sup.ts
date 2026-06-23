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
          const captureStart = range.from + match.index!;
          const markType = this.type;
          const text = match[1];
          if (!text) return;

          const fullStart = captureStart;
          const innerStart = fullStart + 1; // skip opening ~
          const innerEnd = innerStart + text.length;
          const closingEnd = innerEnd + 1; // skip closing ~

          tr.delete(innerEnd, closingEnd);
          tr.delete(fullStart, innerStart);
          tr.addMark(fullStart, fullStart + text.length, markType.create());
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
      const captureStart = range.from + match.index!;
      const text = match[1];
      if (!text) return;

      const fullStart = captureStart;
      const innerStart = fullStart + match[0].indexOf(text);
      const innerEnd = innerStart + text.length;
      const closingEnd = fullStart + match[0].length;

      tr.delete(innerEnd, closingEnd);
      tr.delete(fullStart, innerStart);
      tr.addMark(fullStart, fullStart + text.length, config.type.create());
      tr.removeStoredMark(config.type);
    },
  });
}
