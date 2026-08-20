/**
 * 文字变浅 (Dim) Mark 扩展
 *
 * Markdown 语法：内联 HTML `<span class="mk-dim">文字</span>` → <span class="mk-dim">文字</span>。
 * 视觉上以次要文字色（`--muted-color`）显示，用于弱化非重点内容。
 *
 * 运行时（编辑器）识别 + 命令 `toggleDim()`；parser/serializer 的编解码
 * 见 `compat-schema.ts`（mark 声明）与 `markdown/parser.ts`（inline ruler）、
 * `markdown/serializer.ts`（markDelimiter）。
 */
import { Mark } from '@tiptap/vue-3';

export const Dim = Mark.create({
  name: 'dim',

  parseHTML() {
    return [{ tag: 'span.mk-dim' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'mk-dim' }, 0];
  },
});